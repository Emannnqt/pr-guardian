import type { Analyzer } from '../analyzers/analyzer.js';
import {
  classifyFiles,
  DEFAULT_ELIGIBILITY_POLICY,
  type EligibilityPolicy,
  type SkipReason,
} from '../diff/eligibility.js';
import { DEFAULT_DIFF_LIMITS, type DiffLimits } from '../diff/limits.js';
import { parseUnifiedDiff } from '../diff/parse-diff.js';
import { DiffError, type DiffFile } from '../diff/types.js';
import { VERSION } from '../version.js';
import { deduplicateFindings } from './deduplicate.js';
import { normalizeFindings } from './normalize-findings.js';
import { SEVERITY_RANK, type ReviewFinding, type Severity } from './schema.js';
import type { AnalyzerRun, ReviewFile, ReviewReport, ReviewStatus } from './types.js';

export interface ReviewOptions {
  limits: DiffLimits;
  eligibility: EligibilityPolicy;
  /** Findings below this severity are counted but not listed. */
  minSeverity: Severity;
  analyzerTimeoutMs: number;
}

export const DEFAULT_REVIEW_OPTIONS: Readonly<ReviewOptions> = {
  limits: DEFAULT_DIFF_LIMITS,
  eligibility: DEFAULT_ELIGIBILITY_POLICY,
  minSeverity: 'low',
  analyzerTimeoutMs: 30_000,
};

export interface ReviewDependencies {
  analyzers: readonly Analyzer[];
  /** Injected for deterministic reports in tests. */
  now?: () => Date;
  /** Monotonic milliseconds, for analyzer durations. */
  clock?: () => number;
}

const MAX_DIAGNOSTIC_LENGTH = 300;

/** Review a raw unified diff. Rejected input yields a `failed` report, never an exception. */
export async function reviewDiff(
  diffText: string,
  options: ReviewOptions,
  deps: ReviewDependencies,
): Promise<ReviewReport> {
  let files: DiffFile[];
  try {
    files = parseUnifiedDiff(diffText, options.limits);
  } catch (error: unknown) {
    if (error instanceof DiffError) return failedReport(error, options, deps);
    throw error;
  }
  return reviewFiles(files, options, deps);
}

/** A `failed` report for input rejected before analysis (e.g. too large to read). */
export function failedReport(
  error: DiffError,
  options: Pick<ReviewOptions, 'minSeverity'>,
  deps: Pick<ReviewDependencies, 'now'>,
): ReviewReport {
  return {
    ...emptyReport(options, deps),
    status: 'failed',
    error: { code: error.code, message: error.message },
    limitations: ['The input was rejected, so no analysis was performed.'],
  };
}

export async function reviewFiles(
  files: readonly DiffFile[],
  options: ReviewOptions,
  deps: ReviewDependencies,
): Promise<ReviewReport> {
  const { eligible, skipped } = classifyFiles(files, options.eligibility, options.limits);
  const report: ReviewReport = {
    ...emptyReport(options, deps),
    files: { analyzed: eligible.map((f) => f.path), skipped },
  };

  if (deps.analyzers.length === 0) {
    return {
      ...report,
      status: 'failed',
      error: { code: 'no-analyzers', message: 'No analyzers are configured.' },
      limitations: ['No analyzers ran, so nothing was reviewed.'],
    };
  }

  const reviewedPaths = new Set(eligible.map((f) => f.path));
  const collected: ReviewFinding[] = [];
  for (const analyzer of deps.analyzers) {
    const { run, findings } = await runAnalyzer(analyzer, eligible, reviewedPaths, options, deps);
    report.analyzers.push(run);
    collected.push(...findings);
  }

  const findings = deduplicateFindings(collected);
  const threshold = SEVERITY_RANK[options.minSeverity];
  report.findings = findings.filter((f) => SEVERITY_RANK[f.severity] <= threshold);
  report.belowThresholdCount = findings.length - report.findings.length;
  report.limitations = describeLimitations(eligible, skipped, report.analyzers, options);
  report.status = deriveStatus(eligible, skipped, report.analyzers);

  if (report.analyzers.every((a) => a.status === 'failed' || a.status === 'timed-out')) {
    report.error = {
      code: 'all-analyzers-failed',
      message: 'Every analyzer failed or timed out, so nothing was reviewed.',
    };
  }
  return report;
}

async function runAnalyzer(
  analyzer: Analyzer,
  files: readonly ReviewFile[],
  reviewedPaths: ReadonlySet<string>,
  options: ReviewOptions,
  deps: ReviewDependencies,
): Promise<{ run: AnalyzerRun; findings: ReviewFinding[] }> {
  const clock = deps.clock ?? (() => performance.now());
  const started = clock();
  const run: AnalyzerRun = {
    analyzer: analyzer.name,
    status: 'succeeded',
    durationMs: 0,
    findingCount: 0,
    diagnostics: [],
  };
  const finish = (findings: ReviewFinding[] = []) => {
    run.durationMs = Math.max(0, Math.round(clock() - started));
    run.findingCount = findings.length;
    return { run, findings };
  };

  if (files.length === 0) {
    run.status = 'skipped';
    run.diagnostics.push('No eligible files to analyze.');
    return finish();
  }

  const outcome = await withTimeout(
    (signal) => analyzer.analyze({ files }, signal),
    options.analyzerTimeoutMs,
  );
  if (outcome.kind === 'timeout') {
    run.status = 'timed-out';
    run.diagnostics.push(`Timed out after ${String(options.analyzerTimeoutMs)} ms.`);
    return finish();
  }
  if (outcome.kind === 'error') {
    run.status = 'failed';
    run.diagnostics.push(`Analyzer error: ${describeError(outcome.error)}`);
    return finish();
  }

  const output = outcome.value;
  if (output.status === 'skipped') {
    run.status = 'skipped';
    run.diagnostics.push(truncate(output.reason));
    return finish();
  }

  const { findings, diagnostics } = normalizeFindings(output.findings, reviewedPaths);
  run.diagnostics.push(...(output.diagnostics ?? []).map(truncate), ...diagnostics);
  return finish(findings);
}

type Outcome<T> =
  { kind: 'ok'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<Outcome<T>> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });
  const work = (async (): Promise<Outcome<T>> => {
    try {
      return { kind: 'ok', value: await task(controller.signal) };
    } catch (error: unknown) {
      return { kind: 'error', error };
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function deriveStatus(
  eligible: readonly ReviewFile[],
  skipped: readonly { reason: SkipReason }[],
  analyzers: readonly AnalyzerRun[],
): ReviewStatus {
  if (analyzers.every((a) => a.status === 'failed' || a.status === 'timed-out')) return 'failed';
  const incomplete =
    eligible.length === 0 ||
    analyzers.some((a) => a.status !== 'succeeded') ||
    skipped.some((f) => f.reason === 'file-too-large') ||
    eligible.some((f) => f.skippedLongLines > 0);
  return incomplete ? 'partial' : 'completed';
}

function describeLimitations(
  eligible: readonly ReviewFile[],
  skipped: readonly { reason: SkipReason }[],
  analyzers: readonly AnalyzerRun[],
  options: ReviewOptions,
): string[] {
  const limitations: string[] = [];
  const count = (reason: SkipReason) => skipped.filter((f) => f.reason === reason).length;

  if (eligible.length === 0) {
    limitations.push('No changed files were eligible for analysis, so no code was reviewed.');
  }
  const tooLarge = count('file-too-large');
  if (tooLarge > 0) {
    limitations.push(
      `${plural(tooLarge, 'file')} exceeded the ${String(options.limits.maxFileBytes)}-byte per-file limit and ${tooLarge === 1 ? 'was' : 'were'} not analyzed.`,
    );
  }
  const longLines = eligible.reduce((n, f) => n + f.skippedLongLines, 0);
  if (longLines > 0) {
    limitations.push(
      `${plural(longLines, 'added line')} longer than ${String(options.limits.maxLineLength)} characters ${longLines === 1 ? 'was' : 'were'} not analyzed.`,
    );
  }
  const unsupported = count('unsupported-language');
  if (unsupported > 0) {
    limitations.push(
      `${plural(unsupported, 'file')} in unsupported languages ${unsupported === 1 ? 'was' : 'were'} not analyzed. Only TypeScript and JavaScript are supported.`,
    );
  }
  for (const run of analyzers) {
    if (
      run.status === 'failed' ||
      run.status === 'timed-out' ||
      (run.status === 'skipped' && eligible.length > 0)
    ) {
      limitations.push(
        `Analyzer ${run.analyzer} ${run.status === 'skipped' ? 'was skipped' : run.status === 'failed' ? 'failed' : 'timed out'}; its checks were not applied.`,
      );
    }
  }
  limitations.push(
    'Only added lines are analyzed, line by line, with a fixed rule set; issues that depend on wider context are not detected.',
  );
  return limitations;
}

function emptyReport(
  options: Pick<ReviewOptions, 'minSeverity'>,
  deps: Pick<ReviewDependencies, 'now'>,
): ReviewReport {
  return {
    reviewerVersion: VERSION,
    mode: 'rules-only',
    status: 'completed',
    findings: [],
    minSeverity: options.minSeverity,
    belowThresholdCount: 0,
    files: { analyzed: [], skipped: [] },
    analyzers: [],
    limitations: [],
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
}

function describeError(error: unknown): string {
  return truncate(error instanceof Error ? error.message : 'unknown error');
}

function truncate(text: string): string {
  return text.length > MAX_DIAGNOSTIC_LENGTH ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…` : text;
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}
