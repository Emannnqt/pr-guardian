import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_DIFF_LIMITS } from '../../src/diff/limits.js';
import { DiffError } from '../../src/diff/types.js';
import { createGitHubClient, GitHubError } from '../../src/github/client.js';
import { loadPullRequest } from '../../src/github/pull-request.js';
import {
  fileJson,
  HEAD_SHA,
  pullJson,
  pullRequestRoute,
  startFakeGitHub,
  type FakeGitHub,
  type GitHubRoute,
} from '../helpers/fake-github.js';

const TOKEN = 'ghs_testtoken_never_logged';
const ref = { owner: 'o', repo: 'r', number: 7 };
const PATCH = '@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+debugger;';

let server: FakeGitHub | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function load(route: GitHubRoute, limits = DEFAULT_DIFF_LIMITS) {
  server = await startFakeGitHub(route);
  const client = createGitHubClient({
    token: TOKEN,
    baseUrl: server.baseUrl,
    userAgent: 'pr-guardian-test',
    retryBaseMs: 1,
  });
  return loadPullRequest(client, ref, limits, AbortSignal.timeout(5_000));
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: unknown) => e,
  );
}

describe('loadPullRequest', () => {
  it('maps API files to DiffFiles and authenticates with the token', async () => {
    const pr = await load(pullRequestRoute([fileJson('src/a.ts', PATCH)]));
    expect(pr.headSha).toBe(HEAD_SHA);
    expect(pr.files).toHaveLength(1);
    expect(pr.files[0]).toMatchObject({ path: 'src/a.ts', status: 'modified', binary: false });
    expect(pr.files[0]?.hunks[0]?.addedLines).toEqual([{ line: 2, content: 'debugger;' }]);
    expect(server?.requests.every((r) => r.authorization === `token ${TOKEN}`)).toBe(true);
  });

  it('follows pagination across pages', async () => {
    const files = Array.from({ length: 5 }, (_, i) => fileJson(`src/f${String(i)}.ts`, PATCH));
    const pr = await load(pullRequestRoute(files, 2));
    expect(pr.files.map((f) => f.path)).toEqual(files.map((f) => f.filename));
    expect(server?.requests.filter((r) => r.path.endsWith('/files'))).toHaveLength(3);
  });

  it('maps statuses, renames, removals, binaries and missing patches', async () => {
    const pr = await load(
      pullRequestRoute([
        fileJson('src/new.ts', '@@ -0,0 +1 @@\n+x', { status: 'added' }),
        fileJson('src/gone.ts', '@@ -1 +0,0 @@\n-x', { status: 'removed' }),
        fileJson('src/moved.ts', undefined, { status: 'renamed', previous_filename: 'src/old.ts' }),
        fileJson('src/copy.ts', '@@ -0,0 +1 @@\n+x', { status: 'copied' }),
        fileJson('logo.png', undefined),
        fileJson('src/huge.ts', undefined, { changes: 50_000 }),
      ]),
    );
    expect(pr.files.map((f) => [f.path, f.status, f.binary, f.patchUnavailable ?? false])).toEqual([
      ['src/new.ts', 'added', false, false],
      ['src/gone.ts', 'removed', false, false],
      ['src/moved.ts', 'renamed', false, false],
      ['src/copy.ts', 'added', false, false],
      ['logo.png', 'modified', true, false],
      ['src/huge.ts', 'modified', false, true],
    ]);
    expect(pr.files[2]?.previousPath).toBe('src/old.ts');
  });

  it('rejects a PR with too many files before listing them', async () => {
    const error = await failure(
      load((req) => (req.path === '/repos/o/r/pulls/7' ? { body: pullJson(301) } : undefined)),
    );
    expect(error).toBeInstanceOf(DiffError);
    expect((error as DiffError).code).toBe('too-many-files');
    expect(server?.requests.map((r) => r.path)).toEqual(['/repos/o/r/pulls/7']);
  });

  it('rejects unsafe paths from the API', async () => {
    const error = await failure(load(pullRequestRoute([fileJson('../../etc/passwd', PATCH)])));
    expect((error as DiffError).code).toBe('unsafe-path');
  });

  it('rejects a response that does not match the expected shape', async () => {
    const error = await failure(
      load((req) => (req.path === '/repos/o/r/pulls/7' ? { body: { head: 'nope' } } : undefined)),
    );
    expect(error).toMatchObject({ code: 'invalid-response' });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
  ])('maps HTTP %i to %s without retrying', async (status, code) => {
    const error = await failure(load(() => ({ status, body: { message: 'secret detail' } })));
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ code, status });
    expect((error as Error).message).not.toContain('secret detail');
    expect((error as Error).message).not.toContain(TOKEN);
    expect(server?.requests).toHaveLength(1);
  });

  it('retries transient server errors a bounded number of times', async () => {
    let calls = 0;
    const pr = await load((req, baseUrl) => {
      if (req.path === '/repos/o/r/pulls/7' && ++calls === 1) return { status: 502 };
      return pullRequestRoute([fileJson('src/a.ts', PATCH)])(req, baseUrl);
    });
    expect(pr.files).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('gives up after bounded retries', async () => {
    const error = await failure(load(() => ({ status: 503 })));
    expect(error).toMatchObject({ code: 'unavailable', status: 503 });
    expect(server?.requests).toHaveLength(3); // 1 attempt + 2 retries
  });

  it('waits once for a secondary rate limit, then gives up', async () => {
    const error = await failure(
      load(() => ({
        status: 403,
        headers: { 'retry-after': '0' },
        body: { message: 'You have exceeded a secondary rate limit.' },
      })),
    );
    expect(error).toMatchObject({ code: 'rate-limited' });
    expect(server?.requests).toHaveLength(2);
  });

  it('reports an unreachable API as unavailable', async () => {
    server = await startFakeGitHub(() => undefined);
    const baseUrl = server.baseUrl;
    await server.close();
    server = undefined;
    const client = createGitHubClient({ token: TOKEN, baseUrl, userAgent: 't', retryBaseMs: 1 });
    const error = await failure(
      loadPullRequest(client, ref, DEFAULT_DIFF_LIMITS, AbortSignal.timeout(5_000)),
    );
    expect(error).toMatchObject({ code: 'unavailable' });
  });
});
