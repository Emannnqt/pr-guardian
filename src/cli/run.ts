import { parseArgs } from 'node:util';

import { createBuiltinRulesAnalyzer } from '../analyzers/builtin-rules/index.js';
import {
  failedReport,
  reviewDiff,
  DEFAULT_REVIEW_OPTIONS,
  type ReviewOptions,
} from '../core/review.js';
import { SEVERITIES, SEVERITY_RANK, type Severity } from '../core/schema.js';
import type { ReviewReport } from '../core/types.js';
import { DiffError } from '../diff/types.js';
import { renderMarkdown } from '../report/markdown.js';
import { VERSION } from '../version.js';

/**
 * Exit codes keep review status and policy outcome separate (spec §16.9).
 * The default is advisory: findings never fail the process unless `--fail-on`
 * is given. A failed review always exits non-zero.
 */
export const ExitCode = {
  Success: 0,
  PolicyViolation: 1,
  UsageError: 2,
  ReviewFailed: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type InputResult =
  | { kind: 'ok'; text: string }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'error'; message: string };

/** Process I/O, injected so the CLI can be tested without touching the real process. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Read a file, or stdin for `-`, refusing to buffer more than `maxBytes`. */
  readInput: (source: string, maxBytes: number) => Promise<InputResult>;
  now?: () => Date;
}

export const HELP_TEXT = `pr-guardian ${VERSION}
Evidence-backed pull request reviewer.

Usage:
  pr-guardian review <diff-file | -> [options]
  pr-guardian --help | --version

Review options:
  --format <markdown|json>   Report format (default: markdown)
  --min-severity <level>     Lowest severity listed in the report (default: low)
  --fail-on <level>          Exit 1 if a listed finding is at or above this severity
                             (default: never; reviews are advisory)

Severity levels: ${SEVERITIES.join(', ')}

Exit codes:
  0  review completed (possibly with limitations)
  1  a finding met the --fail-on threshold
  2  usage error
  3  review failed (input rejected or every analyzer failed)

Examples:
  git diff main...HEAD | pr-guardian review -
  pr-guardian review changes.diff --format json
`;

export async function run(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        format: { type: 'string' },
        'min-severity': { type: 'string' },
        'fail-on': { type: 'string' },
      },
    });
  } catch (error: unknown) {
    return usageError(io, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;

  if (values.version === true) {
    io.stdout(`${VERSION}\n`);
    return ExitCode.Success;
  }
  if (values.help === true || positionals.length === 0) {
    io.stdout(HELP_TEXT);
    return ExitCode.Success;
  }

  const [command, ...rest] = positionals;
  if (command !== 'review') return usageError(io, `Unknown command "${command ?? ''}".`);
  if (rest.length !== 1)
    return usageError(io, 'review expects exactly one diff file (or - for stdin).');
  const source = rest[0] ?? '-';

  const format = values.format ?? 'markdown';
  if (format !== 'markdown' && format !== 'json')
    return usageError(io, `Unknown format "${format}".`);
  const minSeverity = parseSeverity(values['min-severity'], 'low');
  const failOn = parseSeverity(values['fail-on'], undefined);
  if (minSeverity === null) return usageError(io, 'Invalid --min-severity.');
  if (failOn === null) return usageError(io, 'Invalid --fail-on.');

  const options: ReviewOptions = { ...DEFAULT_REVIEW_OPTIONS, minSeverity };
  const deps = { analyzers: [createBuiltinRulesAnalyzer()], ...(io.now ? { now: io.now } : {}) };

  const input = await io.readInput(source, options.limits.maxDiffBytes);
  if (input.kind === 'error') return usageError(io, input.message);

  const report: ReviewReport =
    input.kind === 'too-large'
      ? failedReport(
          new DiffError(
            'diff-too-large',
            `Diff is ${String(input.bytes)} bytes or more; the limit is ${String(options.limits.maxDiffBytes)}.`,
          ),
          options,
          deps,
        )
      : await reviewDiff(input.text, options, deps);

  io.stdout(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));

  if (report.status === 'failed') return ExitCode.ReviewFailed;
  if (
    failOn !== undefined &&
    report.findings.some((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn])
  ) {
    return ExitCode.PolicyViolation;
  }
  return ExitCode.Success;
}

/** `undefined` when absent and no default; `null` when invalid. */
function parseSeverity<D extends Severity | undefined>(
  value: string | undefined,
  fallback: D,
): Severity | D | null {
  if (value === undefined) return fallback;
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : null;
}

function usageError(io: CliIo, message: string): ExitCode {
  io.stderr(`pr-guardian: ${message}\nRun "pr-guardian --help" for usage.\n`);
  return ExitCode.UsageError;
}
