import { detectSecrets } from '../../core/redact.js';
import type { FindingCategory, Severity } from '../../core/schema.js';

/**
 * Built-in, line-based rules for TypeScript/JavaScript. Each rule targets a
 * pattern that is risky in nearly every context, to keep false positives low.
 * Rules see one added line at a time and never execute or import PR code.
 */

/** One added line, raw and with string/comment contents blanked (see mask.ts). */
export interface RuleLine {
  raw: string;
  code: string;
}

export interface LineRule {
  id: string;
  title: string;
  severity: Severity;
  category: FindingCategory;
  /** Heuristic, not calibrated (spec §6). */
  confidence: number;
  explanation: string;
  suggestedFix: string;
  /** Returns a title suffix (may be empty) when the line matches, otherwise undefined. */
  match: (line: RuleLine) => string | undefined;
}

/** Match against code only, so strings and comments that mention the pattern are ignored. */
const inCode =
  (pattern: RegExp) =>
  ({ code }: RuleLine): string | undefined =>
    pattern.test(code) ? '' : undefined;

export const BUILTIN_RULES: readonly LineRule[] = [
  {
    id: 'builtin/hardcoded-secret',
    title: 'Possible hardcoded credential',
    severity: 'high',
    category: 'security',
    confidence: 0.9,
    explanation:
      'This added line matches the format of a real credential. Secrets committed to source control are exposed to everyone with read access and remain in git history even after removal.',
    suggestedFix:
      'Remove the value, load it from an environment variable or secret manager, and rotate the credential if it was ever valid.',
    // Secrets live inside strings and comments, so this rule reads the raw line.
    match: ({ raw }: RuleLine): string | undefined => {
      const kinds = detectSecrets(raw);
      return kinds.length > 0 ? ` (${kinds.join(', ')})` : undefined;
    },
  },
  {
    id: 'builtin/tls-verification-disabled',
    title: 'TLS certificate verification disabled',
    severity: 'high',
    category: 'security',
    confidence: 0.85,
    explanation:
      'Disabling certificate verification lets anyone on the network path impersonate the server and read or modify the traffic.',
    suggestedFix:
      'Keep verification enabled. For private certificate authorities, pass the CA certificate (for example via the `ca` option or NODE_EXTRA_CA_CERTS) instead.',
    match: ({ raw, code }: RuleLine): string | undefined =>
      /\brejectUnauthorized\s*:\s*false\b/.test(code) ||
      // The variable name may itself be a string key (process.env['…']), so check the
      // raw line for the assignment and the code view for a real process.env access.
      (/\bprocess\.env\b/.test(code) &&
        /\bNODE_TLS_REJECT_UNAUTHORIZED\b['"]?\s*\]?\s*=\s*['"`]?0/.test(raw))
        ? ''
        : undefined,
  },
  {
    id: 'builtin/shell-command-interpolation',
    title: 'Shell command built with string interpolation',
    severity: 'high',
    category: 'security',
    confidence: 0.6,
    explanation:
      '`exec`/`execSync` run their argument through a shell. Interpolating values into the command string allows command injection if any value can be influenced by a user.',
    suggestedFix:
      'Use `execFile`/`spawn` with an argument array (no shell), or strictly validate every interpolated value.',
    match: inCode(/\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/),
  },
  {
    id: 'builtin/dynamic-code-execution',
    title: 'Dynamic code execution',
    severity: 'medium',
    category: 'security',
    confidence: 0.7,
    explanation:
      '`eval`, `new Function` and string arguments to `setTimeout`/`setInterval` execute arbitrary code. If any part of the string can be influenced by input, this is a code-injection vector; it also defeats static analysis.',
    suggestedFix:
      'Replace with explicit logic (for example a lookup table or `JSON.parse` for data), or pass a function instead of a string to timers.',
    match: inCode(
      /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|(?<![\w$])set(?:Timeout|Interval)\s*\(\s*['"`]/,
    ),
  },
  {
    id: 'builtin/focused-test',
    title: 'Focused test left in code',
    severity: 'medium',
    category: 'testing',
    confidence: 0.95,
    explanation:
      '`.only` (or `fit`/`fdescribe`) makes the test runner skip every other test in the file or suite, so CI can pass while most tests silently do not run.',
    suggestedFix:
      'Remove `.only` (or rename `fit`/`fdescribe` back to `it`/`describe`) before merging.',
    match: inCode(
      /\b(?:describe|it|test|context|suite)\.only\s*\(|(?<![\w$.])f(?:it|describe)\s*\(/,
    ),
  },
  {
    id: 'builtin/debugger-statement',
    title: 'Debugger statement left in code',
    severity: 'low',
    category: 'reliability',
    confidence: 0.95,
    explanation:
      'A `debugger` statement pauses execution whenever developer tools or an inspector are attached, and is almost always a leftover from debugging.',
    suggestedFix: 'Remove the `debugger` statement.',
    match: inCode(/(?<![\w$.])debugger\s*(?:;|$)/),
  },
];
