import { describe, expect, it } from 'vitest';

import { ExitCode, HELP_TEXT, run } from '../../../src/cli/run.js';
import { VERSION } from '../../../src/version.js';

function invoke(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('cli run', () => {
  it('prints help when invoked without arguments', () => {
    expect(invoke()).toEqual({ code: ExitCode.Success, stdout: HELP_TEXT, stderr: '' });
  });

  it.each(['--help', '-h'])('prints help for %s', (flag) => {
    expect(invoke(flag)).toEqual({ code: ExitCode.Success, stdout: HELP_TEXT, stderr: '' });
  });

  it.each(['--version', '-v'])('prints the version for %s', (flag) => {
    expect(invoke(flag)).toEqual({ code: ExitCode.Success, stdout: `${VERSION}\n`, stderr: '' });
  });

  it('rejects unknown options with a usage error and no stdout', () => {
    const result = invoke('--delete-everything');
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--delete-everything');
    expect(result.stderr).toContain('--help');
  });

  it('rejects unexpected positional arguments', () => {
    const result = invoke('review');
    expect(result.code).toBe(ExitCode.UsageError);
    expect(result.stdout).toBe('');
  });
});
