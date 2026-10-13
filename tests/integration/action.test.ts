import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { runAction, type Env } from '../../src/cli/action.js';
import {
  BASE_SHA,
  fileJson,
  HEAD_SHA,
  pullRequestRoute,
  startFakeGitHub,
  type FakeGitHub,
} from '../helpers/fake-github.js';

/**
 * The Action end to end: event file → fake GitHub API → review → job summary,
 * JSON report, outputs and exit code. Mirrors what the runner provides.
 */

const dir = mkdtempSync(join(tmpdir(), 'pr-guardian-action-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let server: FakeGitHub | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const TOKEN = 'ghs_actiontoken_must_not_leak';

function event(overrides: { action?: string; headRepo?: string | null } = {}) {
  const headRepo = overrides.headRepo === undefined ? 'o/r' : overrides.headRepo;
  return {
    action: overrides.action ?? 'opened',
    number: 7,
    pull_request: {
      head: { sha: HEAD_SHA, repo: headRepo === null ? null : { full_name: headRepo } },
      base: { sha: BASE_SHA, repo: { full_name: 'o/r' } },
    },
    repository: { name: 'r', owner: { login: 'o' } },
  };
}

let counter = 0;
async function act(options: {
  files?: unknown[];
  event?: unknown;
  eventName?: string;
  inputs?: Record<string, string>;
  /** Existing review comments returned by the API. */
  comments?: unknown[];
  /** Status for the review POST (default 200). */
  reviewStatus?: number;
}) {
  const prRoute = pullRequestRoute(options.files ?? []);
  server = await startFakeGitHub((req, baseUrl) => {
    if (req.path === '/repos/o/r/pulls/7/comments') return { body: options.comments ?? [] };
    if (req.method === 'POST' && req.path === '/repos/o/r/pulls/7/reviews') {
      return { status: options.reviewStatus ?? 200, body: { id: 1 } };
    }
    return prRoute(req, baseUrl);
  });
  const run = join(dir, String(++counter));
  const paths = {
    event: `${run}-event.json`,
    summary: `${run}-summary.md`,
    output: `${run}-output.txt`,
  };
  writeFileSync(paths.event, JSON.stringify(options.event ?? event()));
  writeFileSync(paths.summary, '');
  writeFileSync(paths.output, '');

  const env: Env = {
    GITHUB_EVENT_NAME: options.eventName ?? 'pull_request',
    GITHUB_EVENT_PATH: paths.event,
    GITHUB_STEP_SUMMARY: paths.summary,
    GITHUB_OUTPUT: paths.output,
    GITHUB_API_URL: server.baseUrl,
    GITHUB_RUN_ID: '42',
    RUNNER_TEMP: dir,
    'INPUT_GITHUB-TOKEN': TOKEN,
    'INPUT_MIN-SEVERITY': 'low',
    ...Object.fromEntries(
      Object.entries(options.inputs ?? {}).map(([k, v]) => [`INPUT_${k.toUpperCase()}`, v]),
    ),
  };
  const logs: string[] = [];
  const code = await runAction(env, {
    log: (l) => logs.push(l),
    now: () => new Date(0),
    retryBaseMs: 1,
  });
  return {
    code,
    logs: logs.join('\n'),
    summary: readFileSync(paths.summary, 'utf8'),
    output: readFileSync(paths.output, 'utf8'),
  };
}

const DEBUGGER_PATCH = '@@ -1 +1,2 @@\n const a = 1;\n+debugger;';
const SECRET_PATCH = `@@ -0,0 +1 @@\n+const k = 'AKIA${'Q'.repeat(16)}';`;

describe('runAction', () => {
  it('reviews the PR, writes the job summary, JSON report and outputs (advisory by default)', async () => {
    const result = await act({ files: [fileJson('src/a.ts', DEBUGGER_PATCH)] });
    expect(result.code).toBe(0);
    expect(result.summary).toContain('## PR Guardian review');
    expect(result.summary).toContain('**Pull request:** #7 · head `aaaaaaaaaaaa`');
    expect(result.summary).toContain('Debugger statement left in code');
    expect(result.output).toMatch(/^status<<ghadelimiter_[0-9a-f-]+\ncompleted\n/);
    expect(result.output).toContain('finding-count<<');
    const report = JSON.parse(readFileSync(join(dir, 'pr-guardian-report.json'), 'utf8')) as {
      status: string;
      pullRequest: unknown;
    };
    expect(report.status).toBe('completed');
    expect(report.pullRequest).toEqual({ number: 7, headSha: HEAD_SHA, isFork: false });
  });

  it('logs counts and statuses only: never the token or source text', async () => {
    const result = await act({ files: [fileJson('src/k.ts', SECRET_PATCH)] });
    expect(result.logs).toContain('pr-guardian run=42');
    expect(result.logs).toContain('status=completed');
    expect(result.logs).not.toContain(TOKEN);
    expect(result.logs).not.toContain('AKIA');
    expect(result.summary).not.toContain(`AKIA${'Q'.repeat(16)}`);
  });

  it('fails the step when fail-on is met', async () => {
    const result = await act({
      files: [fileJson('src/a.ts', DEBUGGER_PATCH)],
      inputs: { 'fail-on': 'low' },
    });
    expect(result.code).toBe(1);
    expect(result.logs).toContain('::error title=PR Guardian::1 finding(s) at or above "low"');
    expect(result.summary).toContain('Debugger statement');
  });

  it('works for fork PRs (read-only) and says so', async () => {
    const result = await act({
      files: [fileJson('src/a.ts', DEBUGGER_PATCH)],
      event: event({ headRepo: 'someone/fork' }),
    });
    expect(result.code).toBe(0);
    expect(result.summary).toContain('from a fork (read-only token)');
  });

  it('marks the review partial and warns when GitHub has no patch for a file', async () => {
    const result = await act({ files: [fileJson('src/huge.ts', undefined, { changes: 9_999 })] });
    expect(result.code).toBe(0);
    expect(result.summary).toContain('⚠️ Completed with limitations');
    expect(result.logs).toContain('::warning title=PR Guardian::');
  });

  it('writes a failed summary and exits 1 when the PR is too large', async () => {
    const files = Array.from({ length: 3 }, (_, i) => fileJson(`f${String(i)}.ts`, DEBUGGER_PATCH));
    const result = await act({ files, inputs: { 'max-files': '2' } });
    expect(result.code).toBe(1);
    expect(result.summary).toContain('❌ Failed');
    expect(result.output).toContain('\nfailed\n');
  });

  it('refuses pull_request_target', async () => {
    const result = await act({ eventName: 'pull_request_target' });
    expect(result.code).toBe(1);
    expect(result.logs).toContain('Refusing to run on pull_request_target');
    expect(server?.requests).toEqual([]);
  });

  it.each(['push', 'workflow_dispatch'])('rejects the %s event', async (eventName) => {
    expect((await act({ eventName })).code).toBe(1);
  });

  it('skips (exit 0) pull_request actions it does not review', async () => {
    const result = await act({ event: event({ action: 'labeled' }) });
    expect(result.code).toBe(0);
    expect(result.logs).toContain(
      '::notice title=PR Guardian::pull_request action "labeled" is not reviewed',
    );
    expect(server?.requests).toEqual([]);
  });

  it.each([
    [{ 'min-severity': 'urgent' }, /min-severity/],
    [{ 'max-files': '5000' }, /max-files/],
    [{ 'exclude-paths': '../secrets' }, /exclude-paths/],
  ])('rejects invalid inputs %j', async (inputs, message) => {
    const result = await act({ inputs });
    expect(result.code).toBe(1);
    expect(result.logs).toMatch(message);
  });

  it('applies exclude-paths', async () => {
    const result = await act({
      files: [fileJson('src/generated/a.ts', DEBUGGER_PATCH), fileJson('src/b.ts', DEBUGGER_PATCH)],
      inputs: { 'exclude-paths': '# generated code\nsrc/generated/' },
    });
    expect(result.summary).toContain('1 finding');
    expect(result.summary).toContain('`src/generated/a.ts`: excluded path');
  });
});

describe('runAction inline comments', () => {
  const TWO_FINDINGS = '@@ -1 +1,3 @@\n const a = 1;\n+debugger;\n+eval(input);';
  const files = [fileJson('src/a.ts', TWO_FINDINGS)];
  const enabled = { 'inline-comments': 'true' };
  const reviews = () => server?.requests.filter((r) => r.method === 'POST') ?? [];

  /** What GitHub would return for the comments our first run posted. */
  function postedAsExisting(author = 'github-actions[bot]') {
    const body = reviews()[0]?.body as { comments: { path: string; line: number; body: string }[] };
    return body.comments.map((c) => ({ ...c, user: { login: author } }));
  }

  it('posts one COMMENT review with comments on the added lines', async () => {
    const result = await act({ files, inputs: enabled });
    expect(result.code).toBe(0);
    expect(reviews()).toHaveLength(1);
    const review = reviews()[0]?.body as {
      event: string;
      commit_id: string;
      comments: { path: string; line: number; side: string; body: string }[];
    };
    expect(review.event).toBe('COMMENT');
    expect(review.commit_id).toBe(HEAD_SHA);
    expect(review.comments.map((c) => [c.path, c.line, c.side])).toEqual([
      ['src/a.ts', 3, 'RIGHT'],
      ['src/a.ts', 2, 'RIGHT'],
    ]);
    expect(review.comments[0]?.body).toMatch(/<!-- pr-guardian fp=[0-9a-f]{16} -->$/);
    expect(result.logs).toContain('inline_posted=2 already_present=0');
    expect(result.summary).toContain('**Inline comments:** 2 posted · 0 already present');
    expect(result.output).toContain('inline-comments-posted<<');
  });

  it('does not post anything on a rerun when the comments are already there', async () => {
    await act({ files, inputs: enabled });
    const existing = postedAsExisting();
    await server?.close();
    const rerun = await act({ files, inputs: enabled, comments: existing });
    expect(rerun.code).toBe(0);
    expect(reviews()).toEqual([]);
    expect(rerun.logs).toContain('inline_posted=0 already_present=2');
  });

  it('posts only the findings that are not already commented', async () => {
    await act({ files, inputs: enabled });
    const [first] = postedAsExisting();
    await server?.close();
    await act({ files, inputs: enabled, comments: [first] });
    const review = reviews()[0]?.body as { comments: { line: number }[] };
    expect(review.comments.map((c) => c.line)).toEqual([2]);
  });

  it('reposts when the earlier comment is outdated (line null)', async () => {
    await act({ files, inputs: enabled });
    const outdated = postedAsExisting().map((c) => ({ ...c, line: null }));
    await server?.close();
    await act({ files, inputs: enabled, comments: outdated });
    expect((reviews()[0]?.body as { comments: unknown[] }).comments).toHaveLength(2);
  });

  it('ignores the marker in comments by anyone else (no spoofed suppression)', async () => {
    await act({ files, inputs: enabled });
    const spoofed = postedAsExisting('pr-author');
    await server?.close();
    await act({ files, inputs: enabled, comments: spoofed });
    expect((reviews()[0]?.body as { comments: unknown[] }).comments).toHaveLength(2);
  });

  it('respects max-inline-comments, keeping the most severe', async () => {
    const result = await act({ files, inputs: { ...enabled, 'max-inline-comments': '1' } });
    const review = reviews()[0]?.body as { comments: { line: number }[] };
    expect(review.comments.map((c) => c.line)).toEqual([3]); // eval (medium) before debugger (low)
    expect(result.summary).toContain('1 over the per-run limit (summary only)');
  });

  it('makes no comment API calls when disabled (default)', async () => {
    await act({ files });
    expect(server?.requests.some((r) => r.path.endsWith('/comments') || r.method === 'POST')).toBe(
      false,
    );
  });

  it('skips fork PRs with a notice instead of failing', async () => {
    const result = await act({
      files,
      inputs: enabled,
      event: event({ headRepo: 'someone/fork' }),
    });
    expect(result.code).toBe(0);
    expect(server?.requests.some((r) => r.path.endsWith('/comments') || r.method === 'POST')).toBe(
      false,
    );
    expect(result.logs).toContain('::notice title=PR Guardian::Pull requests from forks');
    expect(result.summary).toContain('**Inline comments:** not posted.');
  });

  it.each([
    [403, /pull-requests: write/],
    [422, /HTTP 422/],
  ])(
    'reports a %i from the review POST as a workflow error, keeping the summary',
    async (status, message) => {
      const result = await act({ files, inputs: enabled, reviewStatus: status });
      expect(result.code).toBe(1);
      expect(result.logs).toMatch(/::error title=PR Guardian::Inline comments failed: /);
      expect(result.logs).toMatch(message);
      expect(result.summary).toContain('**Inline comments:** ❌ failed.');
      expect(result.summary).toContain('✅ Completed');
    },
  );

  it('rejects invalid inline inputs', async () => {
    expect((await act({ inputs: { 'inline-comments': 'yes' } })).code).toBe(1);
    expect((await act({ inputs: { 'max-inline-comments': '500' } })).code).toBe(1);
    expect((await act({ inputs: { 'comment-author': 'a b' } })).code).toBe(1);
  });
});
