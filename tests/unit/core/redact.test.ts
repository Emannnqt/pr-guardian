import { describe, expect, it } from 'vitest';

import { detectSecrets, redactSecrets } from '../../../src/core/redact.js';

// Built at runtime so no realistic-looking credential is stored in the repository.
const fake = {
  aws: `AKIA${'Q'.repeat(16)}`,
  github: `ghp_${'a1'.repeat(18)}`,
  githubPat: `github_pat_${'b'.repeat(30)}`,
  slack: `xoxb-${'1'.repeat(12)}-abc`,
  stripe: `sk_live_${'c'.repeat(24)}`,
  google: `AIza${'d'.repeat(35)}`,
  anthropic: `sk-ant-${'e'.repeat(30)}`,
  privateKey: ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' '),
};

describe('detectSecrets', () => {
  it.each(Object.entries(fake))('detects %s', (_name, secret) => {
    expect(detectSecrets(`const value = "${secret}";`)).toHaveLength(1);
  });

  it('ignores ordinary code and low-confidence patterns', () => {
    expect(detectSecrets('const password = "hunter22";')).toEqual([]);
    expect(detectSecrets('const AKIA = 1; // AKIA prefix alone')).toEqual([]);
    expect(detectSecrets('const token = process.env.TOKEN;')).toEqual([]);
  });

  it('is stateless across calls (no shared lastIndex)', () => {
    expect(detectSecrets(fake.aws)).toHaveLength(1);
    expect(detectSecrets(fake.aws)).toHaveLength(1);
  });
});

describe('redactSecrets', () => {
  it('replaces every secret occurrence', () => {
    const text = `a=${fake.aws} b=${fake.github} again=${fake.aws}`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(fake.aws);
    expect(redacted).not.toContain(fake.github);
    expect(redacted).toBe(
      'a=[REDACTED AWS access key ID] b=[REDACTED GitHub token] again=[REDACTED AWS access key ID]',
    );
  });

  it('redacts the value of credential assignments but keeps the name', () => {
    expect(redactSecrets(`const password = "correct-horse";`)).toBe(
      'const password = "[REDACTED]";',
    );
    expect(redactSecrets(`{ "api_key": 'abcdef123456' }`)).toBe(`{ "api_key": '[REDACTED]' }`);
  });

  it('leaves text without secrets unchanged', () => {
    expect(redactSecrets('return eval(expression);')).toBe('return eval(expression);');
  });
});
