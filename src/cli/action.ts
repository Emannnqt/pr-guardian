import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createBuiltinRulesAnalyzer } from '../analyzers/builtin-rules/index.js';
import {
  DEFAULT_REVIEW_OPTIONS,
  failedReport,
  reviewFiles,
  type ReviewOptions,
} from '../core/review.js';
import { SEVERITIES, SEVERITY_RANK, type Severity } from '../core/schema.js';
import type { ReviewReport } from '../core/types.js';
import { DEFAULT_ELIGIBILITY_POLICY } from '../diff/eligibility.js';
import { DEFAULT_DIFF_LIMITS } from '../diff/limits.js';
import { normalizeRepoPath } from '../diff/paths.js';
import { DiffError } from '../diff/types.js';
import { createGitHubClient, GitHubError } from '../github/client.js';
import { GitHubEventError, parsePullRequestEvent } from '../github/event.js';
import { loadPullRequest } from '../github/pull-request.js';
import { writeJobSummary } from '../github/publish-summary.js';
import { escapeInline } from '../report/escape.js';
import { VERSION } from '../version.js';
import { errorCommand, noticeCommand, outputEntry, warningCommand } from './workflow-commands.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface ActionIo {
  /** Workflow log (stdout). */
  log: (line: string) => void;
  now?: () => Date;
  /** Scales GitHub retry waits; tests use a tiny value. */
  retryBaseMs?: number;
}

export interface ActionInputs {
  token: string;
  minSeverity: Severity;
  failOn: Severity | undefined;
  excludePaths: string[];
  maxFiles: number;
  maxFileBytes: number;
}

const API_TIME_LIMIT_MS = 120_000;
const MAX_EXCLUDE_ENTRIES = 100;

/** Action inputs arrive as INPUT_<NAME> with the hyphen kept (e.g. INPUT_MIN-SEVERITY). */
function input(env: Env, name: string): string {
  return (env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
}

export function parseActionInputs(env: Env): ActionInputs | { error: string } {
  const token = input(env, 'github-token');
  if (token === '') return { error: 'Input "github-token" is empty.' };

  const severity = (name: string, fallback: Severity | undefined) => {
    const value = input(env, name);
    if (value === '') return fallback;
    return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : null;
  };
  const minSeverity = severity('min-severity', 'low');
  const failOn = severity('fail-on', undefined);
  if (minSeverity === null || minSeverity === undefined) {
    return { error: `Input "min-severity" must be one of: ${SEVERITIES.join(', ')}.` };
  }
  if (failOn === null)
    return { error: `Input "fail-on" must be one of: ${SEVERITIES.join(', ')}.` };

  // Limits can only be lowered: the defaults are the hard ceiling.
  const limit = (name: string, max: number) => {
    const value = input(env, name);
    if (value === '') return max;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
  };
  const maxFiles = limit('max-files', DEFAULT_DIFF_LIMITS.maxFiles);
  const maxFileBytes = limit('max-file-bytes', DEFAULT_DIFF_LIMITS.maxFileBytes);
  if (maxFiles === null) {
    return {
      error: `Input "max-files" must be a whole number from 1 to ${String(DEFAULT_DIFF_LIMITS.maxFiles)}.`,
    };
  }
  if (maxFileBytes === null) {
    return {
      error: `Input "max-file-bytes" must be a whole number from 1 to ${String(DEFAULT_DIFF_LIMITS.maxFileBytes)}.`,
    };
  }

  const entries = input(env, 'exclude-paths')
    .split('\n')
    .map((e) => e.trim())
    .filter((e) => e !== '' && !e.startsWith('#'));
  if (entries.length > MAX_EXCLUDE_ENTRIES) {
    return { error: `Input "exclude-paths" has more than ${String(MAX_EXCLUDE_ENTRIES)} entries.` };
  }
  const excludePaths: string[] = [];
  for (const entry of entries) {
    try {
      excludePaths.push(normalizeRepoPath(entry.replace(/\/+$/, '')));
    } catch {
      return {
        error: `Input "exclude-paths" has an invalid path: ${JSON.stringify(entry.slice(0, 80))}.`,
      };
    }
  }

  return { token, minSeverity, failOn, excludePaths, maxFiles, maxFileBytes };
}

/**
 * GitHub Action entry point (composition root). Reviews the pull request
 * through the REST API in rules-only mode, publishes the job summary and a
 * JSON report, and returns the process exit code. It never checks out or
 * executes pull request code, and needs only read permissions.
 */
export async function runAction(env: Env, io: ActionIo): Promise<number> {
  // Structured key=value log lines: counts and statuses only, never source text or tokens.
  const log = (fields: Record<string, string | number>): void => {
    const pairs = Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`);
    io.log(`pr-guardian ${pairs.join(' ')}`);
  };
  const summaryPath = env['GITHUB_STEP_SUMMARY'];
  const fail = async (message: string): Promise<number> => {
    io.log(errorCommand(message));
    if (summaryPath) {
      await appendFile(
        summaryPath,
        `## PR Guardian review\n\n**Status:** ❌ Failed\n\n> ${escapeInline(message)}\n`,
      );
    }
    return 1;
  };

  const inputs = parseActionInputs(env);
  if ('error' in inputs) return fail(inputs.error);

  let outcome;
  try {
    const eventPath = env['GITHUB_EVENT_PATH'];
    if (!eventPath)
      return await fail('GITHUB_EVENT_PATH is not set; is this running in GitHub Actions?');
    if ((await stat(eventPath)).size > 10 * 1024 * 1024)
      return await fail('Event payload is too large.');
    outcome = parsePullRequestEvent(
      env['GITHUB_EVENT_NAME'] ?? '',
      await readFile(eventPath, 'utf8'),
    );
  } catch (error: unknown) {
    if (error instanceof GitHubEventError) return fail(error.message);
    return fail('Could not read the workflow event payload.');
  }
  if (outcome.kind === 'skip') {
    io.log(noticeCommand(outcome.reason));
    return 0;
  }
  const event = outcome.event;
  log({
    run: env['GITHUB_RUN_ID'] ?? 'local',
    version: VERSION,
    pr: event.number,
    head: event.headSha.slice(0, 12),
    fork: String(event.isFork),
  });

  const limits = {
    ...DEFAULT_DIFF_LIMITS,
    maxFiles: inputs.maxFiles,
    maxFileBytes: inputs.maxFileBytes,
  };
  const options: ReviewOptions = {
    ...DEFAULT_REVIEW_OPTIONS,
    limits,
    minSeverity: inputs.minSeverity,
    eligibility: {
      ...DEFAULT_ELIGIBILITY_POLICY,
      excludedPrefixes: [...DEFAULT_ELIGIBILITY_POLICY.excludedPrefixes, ...inputs.excludePaths],
    },
  };
  const deps = {
    analyzers: [createBuiltinRulesAnalyzer()],
    mode: 'rules-only' as const,
    ...(io.now ? { now: io.now } : {}),
  };

  const client = createGitHubClient({
    token: inputs.token,
    baseUrl: env['GITHUB_API_URL'] ?? 'https://api.github.com',
    userAgent: `pr-guardian/${VERSION}`,
    ...(io.retryBaseMs === undefined ? {} : { retryBaseMs: io.retryBaseMs }),
  });

  let report: ReviewReport;
  try {
    const pr = await loadPullRequest(client, event, limits, AbortSignal.timeout(API_TIME_LIMIT_MS));
    log({ files: pr.files.length, patch_bytes: pr.files.reduce((n, f) => n + f.patchBytes, 0) });
    report = await reviewFiles(pr.files, options, deps);
    if (pr.headSha !== event.headSha) {
      report.limitations.push(
        `The pull request was updated while this run started; its latest head ${pr.headSha.slice(0, 12)} was reviewed.`,
      );
    }
    report.pullRequest = { number: event.number, headSha: pr.headSha, isFork: event.isFork };
  } catch (error: unknown) {
    if (error instanceof DiffError) {
      report = failedReport(error, options, deps);
    } else if (error instanceof GitHubError) {
      report = failedReport({ code: 'github-api-error', message: error.message }, options, deps);
    } else {
      report = failedReport(
        { code: 'github-api-error', message: 'Unexpected error while loading the pull request.' },
        options,
        deps,
      );
    }
    report.pullRequest = { number: event.number, headSha: event.headSha, isFork: event.isFork };
  }

  for (const run of report.analyzers) {
    log({
      analyzer: run.analyzer,
      status: run.status,
      findings: run.findingCount,
      duration_ms: run.durationMs,
    });
  }
  log({
    status: report.status,
    findings: report.findings.length,
    below_threshold: report.belowThresholdCount,
  });

  if (summaryPath) await writeJobSummary(report, summaryPath);
  const reportPath = join(env['RUNNER_TEMP'] ?? '.', 'pr-guardian-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const outputPath = env['GITHUB_OUTPUT'];
  if (outputPath) {
    await appendFile(
      outputPath,
      outputEntry('status', report.status) +
        outputEntry('finding-count', String(report.findings.length)) +
        outputEntry('report-path', reportPath),
    );
  }

  if (report.status === 'failed') {
    io.log(errorCommand(`Review failed: ${report.error?.message ?? 'no analysis was performed'}`));
    return 1;
  }
  if (report.status === 'partial') {
    io.log(warningCommand('Review completed with limitations; see the job summary.'));
  }
  const failOn = inputs.failOn;
  if (failOn !== undefined) {
    const blocking = report.findings.filter(
      (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn],
    );
    if (blocking.length > 0) {
      io.log(
        errorCommand(
          `${String(blocking.length)} finding(s) at or above "${failOn}" severity (fail-on).`,
        ),
      );
      return 1;
    }
  }
  return 0;
}
