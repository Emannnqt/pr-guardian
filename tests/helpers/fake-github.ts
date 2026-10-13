import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GitHubRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

export interface GitHubResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type GitHubRoute = (req: GitHubRequest, baseUrl: string) => GitHubResponse | undefined;

export interface FakeGitHub {
  baseUrl: string;
  requests: GitHubRequest[];
  close: () => Promise<void>;
}

/**
 * A stand-in for the GitHub REST API on 127.0.0.1. Routes return JSON
 * bodies (and Link headers for pagination); unmatched requests get 404.
 */
export async function startFakeGitHub(route: GitHubRoute): Promise<FakeGitHub> {
  const requests: GitHubRequest[] = [];
  let baseUrl = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', baseUrl);
    const recorded: GitHubRequest = {
      method: req.method ?? '',
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    };
    requests.push(recorded);
    const reply = route(recorded, baseUrl) ?? { status: 404, body: { message: 'Not Found' } };
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
    res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    baseUrl,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export const HEAD_SHA = 'a'.repeat(40);
export const BASE_SHA = 'b'.repeat(40);

export function pullJson(changedFiles: number, headSha = HEAD_SHA) {
  return {
    number: 7,
    head: { sha: headSha },
    base: { sha: BASE_SHA },
    changed_files: changedFiles,
  };
}

export function fileJson(
  filename: string,
  patch: string | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    filename,
    status: 'modified',
    changes: patch === undefined ? 0 : patch.split('\n').length,
    ...(patch === undefined ? {} : { patch }),
    ...extra,
  };
}

/**
 * Serve `GET /repos/o/r/pulls/7` and its paginated `/files`, `perPage` per page,
 * with GitHub-style Link headers.
 */
export function pullRequestRoute(files: unknown[], perPage = 100, headSha = HEAD_SHA): GitHubRoute {
  return (req, baseUrl) => {
    if (req.path === '/repos/o/r/pulls/7') return { body: pullJson(files.length, headSha) };
    if (req.path === '/repos/o/r/pulls/7/files') {
      const page = Number(req.query.get('page') ?? '1');
      const pages = Math.max(1, Math.ceil(files.length / perPage));
      const headers: Record<string, string> = {};
      if (page < pages) {
        headers['link'] =
          `<${baseUrl}/repos/o/r/pulls/7/files?per_page=${String(perPage)}&page=${String(page + 1)}>; rel="next", ` +
          `<${baseUrl}/repos/o/r/pulls/7/files?per_page=${String(perPage)}&page=${String(pages)}>; rel="last"`;
      }
      return { headers, body: files.slice((page - 1) * perPage, page * perPage) };
    }
    return undefined;
  };
}
