import { describe, expect, it } from 'vitest';

import { isLoopback, parseAiOptions } from '../../../src/cli/ai-options.js';
import { ExitCode, run } from '../../../src/cli/run.js';

const base = {
  model: 'qwen2.5-coder:3b',
  endpoint: undefined,
  timeoutSeconds: undefined,
  allowRemote: false,
};

describe('parseAiOptions', () => {
  it('uses safe local defaults', () => {
    expect(parseAiOptions(base)).toEqual({
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen2.5-coder:3b',
      timeoutMs: 300_000,
    });
  });

  it.each([
    ['missing model', { model: undefined }, /needs a model/],
    ['odd model name', { model: 'x; rm -rf /' }, /Invalid --ai-model/],
    ['non-http scheme', { endpoint: 'file:///etc/passwd' }, /only http and https/],
    ['credentials in URL', { endpoint: 'http://user:pass@127.0.0.1:11434' }, /credentials/],
    ['query string', { endpoint: 'http://127.0.0.1:11434/?x=1' }, /query strings/],
    [
      'remote host without opt-in',
      { endpoint: 'https://ollama.example.com' },
      /not on this machine.*--allow-remote-ai/,
    ],
    ['bad timeout', { timeoutSeconds: '0' }, /Invalid --ai-timeout/],
    ['fractional timeout', { timeoutSeconds: '1.5' }, /Invalid --ai-timeout/],
  ])('rejects %s', (_label, overrides, message) => {
    const result = parseAiOptions({ ...base, ...overrides });
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(message);
  });

  it('allows a remote host only with explicit opt-in', () => {
    expect(
      parseAiOptions({ ...base, endpoint: 'https://ollama.example.com/', allowRemote: true }),
    ).toMatchObject({
      endpoint: 'https://ollama.example.com',
    });
  });
});

describe('isLoopback', () => {
  it.each(['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1'])('%s is local', (host) => {
    expect(isLoopback(host)).toBe(true);
  });
  it.each(['0.0.0.0', '10.0.0.1', '127.example.com', 'localhost.evil.com', '::ffff:7f00:1'])(
    '%s is not',
    (host) => {
      expect(isLoopback(host)).toBe(false);
    },
  );
});

describe('CLI AI flags', () => {
  async function cli(argv: string[], env: Record<string, string> = {}) {
    const err: string[] = [];
    const code = await run(argv, {
      stdout: () => undefined,
      stderr: (t) => err.push(t),
      readInput: () => Promise.reject(new Error('must not read input')),
      env,
    });
    return { code, stderr: err.join('') };
  }

  it.each([
    [['review', '-', '--mode', 'smart']],
    [['review', '-', '--mode', 'hybrid']],
    [['review', '-', '--ai-model', 'x']],
    [
      [
        'review',
        '-',
        '--mode',
        'hybrid',
        '--ai-model',
        'x',
        '--ai-endpoint',
        'http://10.0.0.5:11434',
      ],
    ],
  ])('rejects %j before reading input', async (argv) => {
    expect((await cli(argv)).code).toBe(ExitCode.UsageError);
  });

  it('reads the model from PR_GUARDIAN_AI_MODEL', async () => {
    // Passes validation (then fails reading input, which proves validation passed).
    await expect(
      cli(['review', '-', '--mode', 'hybrid'], { PR_GUARDIAN_AI_MODEL: 'qwen2.5-coder:3b' }),
    ).rejects.toThrow('must not read input');
  });
});
