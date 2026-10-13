import { describe, expect, it } from 'vitest';

import { ExitCode, HELP_TEXT, run, type InputResult } from '../../../src/cli/run.js';
import { VERSION } from '../../../src/version.js';

const DIFF_WITH_FINDING = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 const a = 1;
+debugger;
`;

async function invoke(
  argv: string[],
  input: InputResult = { kind: 'ok', text: DIFF_WITH_FINDING },
) {
  const out: string[] = [];
  const err: string[] = [];
  const reads: { source: string; maxBytes: number }[] = [];
  const code = await run(argv, {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readInput: (source, maxBytes) => {
      reads.push({ source, maxBytes });
      return Promise.resolve(input);
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { code, stdout: out.join(''), stderr: err.join(''), reads };
}

describe('cli', () => {
  it.each([[[]], [['--help']], [['-h']]])('prints help for %j', async (argv) => {
    expect(await invoke(argv)).toMatchObject({
      code: ExitCode.Success,
      stdout: HELP_TEXT,
      stderr: '',
    });
  });

  it.each(['--version', '-v'])('prints the version for %s', async (flag) => {
    expect(await invoke([flag])).toMatchObject({ code: ExitCode.Success, stdout: `${VERSION}\n` });
  });

  it.each([
    [['--delete-everything']],
    [['deploy']],
    [['review']],
    [['review', 'a.diff', 'b.diff']],
    [['review', 'a.diff', '--format', 'html']],
    [['review', 'a.diff', '--min-severity', 'urgent']],
    [['review', 'a.diff', '--fail-on', 'yes']],
  ])('rejects %j as a usage error without reading input', async (argv) => {
    const result = await invoke(argv);
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--help');
    expect(result.reads).toEqual([]);
  });

  it('reviews a diff and prints a Markdown report (advisory by default)', async () => {
    const result = await invoke(['review', 'changes.diff']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('## PR Guardian review');
    expect(result.stdout).toContain('Debugger statement left in code');
    expect(result.reads).toEqual([{ source: 'changes.diff', maxBytes: 1_000_000 }]);
  });

  it('prints JSON when asked', async () => {
    const result = await invoke(['review', '-', '--format', 'json']);
    const report = JSON.parse(result.stdout) as { status: string; findings: unknown[] };
    expect(report.status).toBe('completed');
    expect(report.findings).toHaveLength(1);
  });

  it('applies --fail-on as an opt-in policy', async () => {
    expect((await invoke(['review', '-', '--fail-on', 'low'])).code).toBe(ExitCode.PolicyViolation);
    expect((await invoke(['review', '-', '--fail-on', 'high'])).code).toBe(ExitCode.Success);
  });

  it('exits with ReviewFailed and still prints a report for rejected input', async () => {
    const result = await invoke(['review', '-'], { kind: 'ok', text: 'garbage' });
    expect(result.code).toBe(ExitCode.ReviewFailed);
    expect(result.stdout).toContain('❌ Failed');
  });

  it('reports oversized input as a failed review', async () => {
    const result = await invoke(['review', 'big.diff'], { kind: 'too-large', bytes: 5_000_000 });
    expect(result.code).toBe(ExitCode.ReviewFailed);
    expect(result.stdout).toContain('5000000 bytes or more');
  });

  it('reports unreadable input as a usage error', async () => {
    const result = await invoke(['review', 'missing.diff'], {
      kind: 'error',
      message: 'Cannot read "missing.diff" (ENOENT).',
    });
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stderr).toContain('ENOENT');
  });
});
