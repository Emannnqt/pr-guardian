import { describe, expect, it } from 'vitest';

import { escapeData, errorCommand, outputEntry } from '../../../src/cli/workflow-commands.js';
import type { ReviewFinding } from '../../../src/core/schema.js';
import type { ReviewReport } from '../../../src/core/types.js';
import { parseFilePatch } from '../../../src/diff/parse-diff.js';
import { DiffError } from '../../../src/diff/types.js';
import { GitHubEventError, parsePullRequestEvent } from '../../../src/github/event.js';
import { renderJobSummary } from '../../../src/github/publish-summary.js';

const sha = (c: string) => c.repeat(40);
const payload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: 'synchronize',
    number: 3,
    pull_request: {
      head: { sha: sha('1'), repo: { full_name: 'o/r' } },
      base: { sha: sha('2'), repo: { full_name: 'o/r' } },
    },
    repository: { name: 'r', owner: { login: 'o' } },
    ...overrides,
  });

describe('parsePullRequestEvent', () => {
  it('extracts the pull request reference', () => {
    expect(parsePullRequestEvent('pull_request', payload())).toEqual({
      kind: 'review',
      event: {
        owner: 'o',
        repo: 'r',
        number: 3,
        action: 'synchronize',
        headSha: sha('1'),
        baseSha: sha('2'),
        isFork: false,
      },
    });
  });

  it('detects forks, including deleted ones', () => {
    const fork = (repo: unknown) =>
      parsePullRequestEvent(
        'pull_request',
        payload({
          pull_request: {
            head: { sha: sha('1'), repo },
            base: { sha: sha('2'), repo: { full_name: 'o/r' } },
          },
        }),
      );
    expect(fork({ full_name: 'x/r' })).toMatchObject({ event: { isFork: true } });
    expect(fork(null)).toMatchObject({ event: { isFork: true } });
  });

  it.each([
    ['pull_request_target', /Refusing/],
    ['push', /Unsupported event/],
  ])('rejects %s', (name, message) => {
    expect(() => parsePullRequestEvent(name, payload())).toThrow(message);
  });

  it.each([
    ['not JSON', '{'],
    ['a bad sha', payload({ pull_request: { head: { sha: 'x' }, base: {} } })],
    ['an injected owner', payload({ repository: { name: 'r', owner: { login: 'o/../x' } } })],
    ['oversized', ' '.repeat(10 * 1024 * 1024 + 1)],
  ])('rejects a payload with %s', (_label, text) => {
    expect(() => parsePullRequestEvent('pull_request', text)).toThrow(GitHubEventError);
  });
});

describe('parseFilePatch', () => {
  it('parses hunks without file headers', () => {
    const hunks = parseFilePatch('@@ -1,2 +1,3 @@\n a\n+b\n c\n@@ -10 +11 @@\n-x\n+y', 1000);
    expect(hunks.map((h) => h.addedLines)).toEqual([
      [{ line: 2, content: 'b' }],
      [{ line: 11, content: 'y' }],
    ]);
  });

  it('rejects malformed and oversized patches', () => {
    expect(() => parseFilePatch('+no header', 1000)).toThrow(DiffError);
    expect(() => parseFilePatch('@@ -1 +1 @@\n-a\n+b\n+c', 1000)).toThrow(DiffError);
    expect(() => parseFilePatch('@@ -1 +1 @@\n-a\n+b', 5)).toThrow(/limit is 5/);
  });
});

describe('workflow commands', () => {
  it('escapes data so text cannot start a new command', () => {
    expect(escapeData('50%\r\n::set-output name=x::y')).toBe('50%25%0D%0A::set-output name=x::y');
    expect(errorCommand('a\nb')).toBe('::error title=PR Guardian::a%0Ab');
  });

  it('writes outputs with a random heredoc delimiter', () => {
    const a = outputEntry('status', 'completed');
    expect(a).toMatch(/^status<<(ghadelimiter_[0-9a-f-]{36})\ncompleted\n\1\n$/);
    expect(outputEntry('status', 'completed')).not.toBe(a);
  });
});

describe('renderJobSummary', () => {
  const finding = (i: number): ReviewFinding => ({
    id: `id${String(i)}`,
    fingerprint: `fp${String(i)}`,
    title: `Finding ${String(i)}`,
    severity: i < 5 ? 'high' : 'low',
    category: 'bug',
    confidence: 0.9,
    filePath: 'src/a.ts',
    startLine: i + 1,
    explanation: 'x'.repeat(500),
    evidence: 'y'.repeat(500),
    source: 'static-analysis',
  });
  const report: ReviewReport = {
    reviewerVersion: '0.1.0',
    mode: 'rules-only',
    status: 'completed',
    findings: Array.from({ length: 40 }, (_, i) => finding(i)),
    minSeverity: 'low',
    belowThresholdCount: 0,
    files: { analyzed: ['src/a.ts'], skipped: [] },
    analyzers: [],
    limitations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('keeps everything when it fits', () => {
    expect(renderJobSummary(report)).not.toContain('more findings not shown');
  });

  it('drops the least severe findings to fit the limit, keeping counts and a note', () => {
    const md = renderJobSummary(report, 20_000);
    expect(Buffer.byteLength(md)).toBeLessThanOrEqual(20_000);
    expect(md).toContain('#### High (5)');
    expect(md).toContain('#### Low (35)');
    expect(md).toMatch(/\d+ more findings not shown here to stay within the size limit/);
    expect(md).toContain('PR Guardian is an automated assistant');
  });
});
