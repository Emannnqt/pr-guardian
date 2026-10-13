import { describe, expect, it } from 'vitest';

import { MAX_PATH_LENGTH, normalizeRepoPath } from '../../../src/diff/paths.js';
import { DiffError } from '../../../src/diff/types.js';

describe('normalizeRepoPath', () => {
  it.each([
    ['src/a.ts', 'src/a.ts'],
    ['./src/a.ts', 'src/a.ts'],
    ['src//nested/./a.ts', 'src/nested/a.ts'],
    ['café/naïve.ts', 'café/naïve.ts'],
    ['dir with spaces/file.ts', 'dir with spaces/file.ts'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizeRepoPath(input)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['windows drive', 'C:/Windows/system32'],
    ['traversal', '../secret'],
    ['nested traversal', 'src/../../secret'],
    ['backslash', 'src\\..\\secret'],
    ['NUL byte', 'src/a\u0000.ts'],
    ['newline', 'src/a\n.ts'],
    ['bidi override', 'src/\u202Egnp.ts'],
    ['only dots', './.'],
    ['too long', 'a/'.repeat(MAX_PATH_LENGTH)],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeRepoPath(input)).toThrow(DiffError);
  });
});
