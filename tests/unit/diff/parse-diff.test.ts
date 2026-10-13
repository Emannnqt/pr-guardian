import { describe, expect, it } from 'vitest';

import { DEFAULT_DIFF_LIMITS, type DiffLimits } from '../../../src/diff/limits.js';
import { parseUnifiedDiff, unquote } from '../../../src/diff/parse-diff.js';
import { DiffError, type DiffErrorCode } from '../../../src/diff/types.js';

const limits: DiffLimits = DEFAULT_DIFF_LIMITS;

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
@@ -10,2 +11,2 @@ function tail() {
 one
-two
+TWO
`;

function expectDiffError(text: string, code: DiffErrorCode, custom: DiffLimits = limits) {
  let caught: unknown;
  try {
    parseUnifiedDiff(text, custom);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DiffError);
  expect((caught as DiffError).code).toBe(code);
}

describe('parseUnifiedDiff', () => {
  it('parses hunks with correct new-side line numbers', () => {
    const [file] = parseUnifiedDiff(MODIFIED, limits);
    expect(file).toMatchObject({ path: 'src/a.ts', status: 'modified', binary: false });
    expect(file?.hunks).toHaveLength(2);
    expect(file?.hunks[0]?.addedLines).toEqual([
      { line: 2, content: 'const b = 3;' },
      { line: 3, content: 'const c = 4;' },
    ]);
    expect(file?.hunks[0]?.removedCount).toBe(1);
    expect(file?.hunks[1]?.addedLines).toEqual([{ line: 12, content: 'TWO' }]);
  });

  it('handles added, removed, renamed and binary files', () => {
    const text = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+x
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-y
diff --git a/old.ts b/moved.ts
similarity index 100%
rename from old.ts
rename to moved.ts
diff --git a/img.png b/img.png
index 1..2 100644
Binary files a/img.png and b/img.png differ
`;
    const files = parseUnifiedDiff(text, limits);
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ['new.ts', 'added', false],
      ['gone.ts', 'removed', false],
      ['moved.ts', 'renamed', false],
      ['img.png', 'modified', true],
    ]);
    expect(files[2]?.previousPath).toBe('old.ts');
  });

  it('accepts "No newline at end of file" markers, CRLF, and a preamble', () => {
    const text = `From abc Mon Sep 17 00:00:00 2001\r
Subject: [PATCH] x\r
\r
diff --git a/a.js b/a.js\r
--- a/a.js\r
+++ b/a.js\r
@@ -1 +1 @@\r
-old\r
\\ No newline at end of file\r
+new\r
\\ No newline at end of file\r
`;
    const [file] = parseUnifiedDiff(text, limits);
    expect(file?.hunks[0]?.addedLines).toEqual([{ line: 1, content: 'new' }]);
  });

  it('decodes git-quoted non-ASCII paths', () => {
    const text = `diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"
new file mode 100644
--- /dev/null
+++ "b/caf\\303\\251.ts"
@@ -0,0 +1 @@
+x
`;
    expect(parseUnifiedDiff(text, limits)[0]?.path).toBe('café.ts');
  });

  it('handles paths with spaces (trailing tab after ---/+++)', () => {
    const text =
      'diff --git a/my file.ts b/my file.ts\n--- a/my file.ts\t\n+++ b/my file.ts\t\n@@ -1 +1 @@\n-a\n+b\n';
    expect(parseUnifiedDiff(text, limits)[0]?.path).toBe('my file.ts');
  });

  it('rejects empty input', () => {
    expectDiffError('', 'empty-input');
    expectDiffError('  \n\n', 'empty-input');
  });

  it('rejects text that is not a git diff', () => {
    expectDiffError('hello world\n', 'malformed-diff');
    expectDiffError('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', 'malformed-diff');
  });

  it('rejects hunks whose line counts do not match the header', () => {
    const tooFew = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n';
    expectDiffError(tooFew, 'malformed-diff');
    const tooMany = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n+c\n';
    expectDiffError(tooMany, 'malformed-diff');
  });

  it('rejects malformed hunk headers and unknown header lines', () => {
    expectDiffError(
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ bogus @@\n',
      'malformed-diff',
    );
    expectDiffError('diff --git a/a.ts b/a.ts\nrm -rf /\n', 'malformed-diff');
    expectDiffError(
      'diff --git a/a.ts b/a.ts\n--- a/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
      'malformed-diff',
    );
  });

  it('rejects the same file appearing twice', () => {
    const section = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
    expectDiffError(section + section, 'malformed-diff');
  });

  it('enforces the total size limit before parsing', () => {
    expectDiffError(MODIFIED, 'diff-too-large', { ...limits, maxDiffBytes: 50 });
  });

  it('enforces the file count limit', () => {
    const section = (n: number) =>
      `diff --git a/f${String(n)}.ts b/f${String(n)}.ts\n--- a/f${String(n)}.ts\n+++ b/f${String(n)}.ts\n@@ -1 +1 @@\n-a\n+b\n`;
    const text = [1, 2, 3].map(section).join('');
    expect(parseUnifiedDiff(text, { ...limits, maxFiles: 3 })).toHaveLength(3);
    expectDiffError(text, 'too-many-files', { ...limits, maxFiles: 2 });
  });

  it('rejects path traversal in any header', () => {
    expectDiffError(
      'diff --git a/../../etc/passwd b/../../etc/passwd\n--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n',
      'unsafe-path',
    );
    expectDiffError('diff --git a/x b/y\nrename from x\nrename to ../outside\n', 'unsafe-path');
  });
});

describe('unquote', () => {
  it('decodes escapes and leaves unquoted paths alone', () => {
    expect(unquote('plain/path.ts')).toBe('plain/path.ts');
    expect(unquote('"a\\"b\\\\c"')).toBe('a"b\\c');
    expect(unquote('"tab\\there"')).toBe('tab\there');
  });

  it('rejects broken quoting', () => {
    expect(() => unquote('"unterminated')).toThrow(DiffError);
    expect(() => unquote('"bad\\q"')).toThrow(DiffError);
  });
});
