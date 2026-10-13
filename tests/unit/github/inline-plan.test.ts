import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../../../src/core/schema.js';
import { commentableLines } from '../../../src/diff/line-map.js';
import { parseFilePatch } from '../../../src/diff/parse-diff.js';
import type { DiffFile } from '../../../src/diff/types.js';
import { planInlineComments, type ExistingComment } from '../../../src/github/inline-comments.js';
import { INLINE_MARKER_PATTERN, renderInlineComment } from '../../../src/report/markdown.js';

const file = (path: string, patch: string): DiffFile => ({
  path,
  status: 'modified',
  binary: false,
  patchBytes: patch.length,
  hunks: parseFilePatch(patch, 10_000),
});

// Added lines: 2 and 3 (first hunk), 11 (second hunk). Line 1 and 10 are context.
const files = [file('src/a.ts', '@@ -1,1 +1,3 @@\n a\n+b\n+c\n@@ -8,1 +10,2 @@\n x\n+y')];
const commentable = commentableLines(files);

function finding(line: number | undefined, overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: `id-${String(line)}`,
    fingerprint: '0123456789abcdef',
    title: 'Dynamic code execution',
    severity: 'medium',
    category: 'security',
    confidence: 0.7,
    filePath: 'src/a.ts',
    ...(line === undefined ? {} : { startLine: line, endLine: line }),
    explanation: 'Explanation.',
    evidence: 'eval(x)',
    source: 'static-analysis',
    ...overrides,
  };
}

const plan = (findings: ReviewFinding[], existing: ExistingComment[] = [], max = 10) =>
  planInlineComments(findings, commentable, existing, max);

describe('commentableLines', () => {
  it('contains only added lines, across hunks', () => {
    expect([...(commentable.get('src/a.ts') ?? [])]).toEqual([2, 3, 11]);
  });

  it('omits files without added lines', () => {
    expect(commentableLines([file('gone.ts', '@@ -1 +0,0 @@\n-x')]).size).toBe(0);
  });
});

describe('planInlineComments', () => {
  it('comments only on added lines of reviewed files', () => {
    const result = plan([
      finding(2),
      finding(1, { fingerprint: 'aaaaaaaaaaaaaaaa' }), // context line
      finding(99, { fingerprint: 'bbbbbbbbbbbbbbbb' }), // not in the diff
      finding(undefined, { fingerprint: 'cccccccccccccccc' }), // no location
      finding(2, { fingerprint: 'dddddddddddddddd', filePath: 'src/other.ts' }), // other file
    ]);
    expect(result.toPost.map((c) => [c.path, c.line])).toEqual([['src/a.ts', 2]]);
    expect(result.noValidLine).toBe(4);
  });

  it('skips a finding already commented on the same line, but not elsewhere or when outdated', () => {
    const existing: ExistingComment[] = [
      { fingerprint: '0123456789abcdef', path: 'src/a.ts', line: 2 },
      { fingerprint: '0123456789abcdef', path: 'src/a.ts', line: null },
    ];
    const result = plan([finding(2), finding(3), finding(11)], existing);
    expect(result.alreadyPresent).toBe(1);
    expect(result.toPost.map((c) => c.line)).toEqual([3, 11]);
  });

  it('never plans the same comment twice in one run', () => {
    expect(plan([finding(2), finding(2, { id: 'other' })]).toPost).toHaveLength(1);
  });

  it('caps the number of comments, in the order given (most severe first)', () => {
    const result = plan([finding(3, { severity: 'high' }), finding(2), finding(11)], [], 2);
    expect(result.toPost.map((c) => c.line)).toEqual([3, 2]);
    expect(result.overLimit).toBe(1);
  });
});

describe('renderInlineComment', () => {
  it('escapes finding text and ends with a parseable marker', () => {
    const body = renderInlineComment(
      finding(2, {
        title: '@everyone <img src=x onerror=alert(1)> [x](https://evil.example) --> <!-- ',
        suggestedFix: 'Use a parser.',
      }),
    );
    expect(body).not.toMatch(/@everyone|<img|\]\(https:\/\//);
    expect(body).toContain('**Suggested fix:** Use a parser.');
    // The only comment close in the body is the marker's own.
    expect(body.match(/-->/g)).toEqual(['-->']);
    expect(INLINE_MARKER_PATTERN.exec(body)?.[1]).toBe('0123456789abcdef');
    expect(body.trimEnd().endsWith('<!-- pr-guardian fp=0123456789abcdef -->')).toBe(true);
  });
});
