import { describe, expect, it } from 'vitest';

import { classifyFiles, DEFAULT_ELIGIBILITY_POLICY } from '../../../src/diff/eligibility.js';
import { DEFAULT_DIFF_LIMITS } from '../../../src/diff/limits.js';
import type { DiffFile } from '../../../src/diff/types.js';

function file(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    status: 'modified',
    binary: false,
    patchBytes: 100,
    hunks: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        addedLines: [{ line: 1, content: 'x' }],
        removedCount: 0,
      },
    ],
    ...overrides,
  };
}

const classify = (files: DiffFile[], limits = DEFAULT_DIFF_LIMITS) =>
  classifyFiles(files, DEFAULT_ELIGIBILITY_POLICY, limits);

describe('classifyFiles', () => {
  it('accepts supported TypeScript and JavaScript files', () => {
    const { eligible, skipped } = classify([
      file('a.ts'),
      file('b.tsx'),
      file('c.mjs'),
      file('D.JS'),
    ]);
    expect(eligible.map((f) => [f.path, f.language])).toEqual([
      ['a.ts', 'typescript'],
      ['b.tsx', 'typescript'],
      ['c.mjs', 'javascript'],
      ['D.JS', 'javascript'],
    ]);
    expect(skipped).toEqual([]);
  });

  it.each([
    ['.env', 'secret-bearing-path'],
    ['config/.env.production', 'secret-bearing-path'],
    ['certs/server.pem', 'secret-bearing-path'],
    ['home/.npmrc', 'secret-bearing-path'],
    ['id_ed25519', 'secret-bearing-path'],
    ['credentials.json', 'secret-bearing-path'],
    ['node_modules/x/index.js', 'excluded-path'],
    ['dist/cli.js', 'excluded-path'],
    ['types/global.d.ts', 'excluded-path'],
    ['public/app.min.js', 'excluded-path'],
    ['script.py', 'unsupported-language'],
    ['Makefile', 'unsupported-language'],
  ])('skips %s as %s', (path, reason) => {
    expect(classify([file(path)]).skipped).toEqual([{ path, reason }]);
  });

  it('checks secret-bearing paths before anything else', () => {
    expect(classify([file('.env', { status: 'removed' })]).skipped[0]?.reason).toBe(
      'secret-bearing-path',
    );
  });

  it('skips removed, binary, oversized and add-free files', () => {
    const { skipped } = classify(
      [
        file('a.ts', { status: 'removed' }),
        file('b.ts', { binary: true, hunks: [] }),
        file('c.ts', { patchBytes: 10 }),
        file('d.ts', { hunks: [], patchBytes: 1 }),
      ],
      { ...DEFAULT_DIFF_LIMITS, maxFileBytes: 5 },
    );
    expect(skipped.map((s) => s.reason)).toEqual([
      'removed',
      'binary',
      'file-too-large',
      'no-added-lines',
    ]);
  });

  it('drops over-long lines and counts them', () => {
    const long = 'x'.repeat(DEFAULT_DIFF_LIMITS.maxLineLength + 1);
    const { eligible } = classify([
      file('a.js', {
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 2,
            addedLines: [
              { line: 1, content: 'ok' },
              { line: 2, content: long },
            ],
            removedCount: 0,
          },
        ],
      }),
    ]);
    expect(eligible[0]?.addedLines).toEqual([{ line: 1, content: 'ok' }]);
    expect(eligible[0]?.skippedLongLines).toBe(1);
  });
});
