import { parseArgs } from 'node:util';

import { VERSION } from '../version.js';

/**
 * Process exit codes. Review status and policy outcome codes are added with
 * the review command (spec §16.9); a failed review must never exit as Success.
 */
export const ExitCode = {
  Success: 0,
  UsageError: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Output sinks, injected so the CLI can be tested without touching the real process. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const HELP_TEXT = `pr-guardian ${VERSION}
Evidence-backed pull request reviewer.

Usage:
  pr-guardian [options]

Options:
  -h, --help     Show this help text
  -v, --version  Print the version
`;

export function run(argv: readonly string[], io: CliIo): ExitCode {
  let values: { help?: boolean; version?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`pr-guardian: ${reason}\nRun "pr-guardian --help" for usage.\n`);
    return ExitCode.UsageError;
  }

  if (values.version === true) {
    io.stdout(`${VERSION}\n`);
    return ExitCode.Success;
  }

  io.stdout(HELP_TEXT);
  return ExitCode.Success;
}
