import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

const GuardianOctokit = Octokit.plugin(paginateRest, retry, throttling);
export type GitHubClient = InstanceType<typeof GuardianOctokit>;

export interface GitHubClientOptions {
  token: string;
  /** e.g. https://api.github.com (from GITHUB_API_URL on the runner). */
  baseUrl: string;
  userAgent: string;
  /** Scales retry and rate-limit waits; tests use a tiny value. Default 1000 ms. */
  retryBaseMs?: number;
}

/** Longest rate-limit wait we accept before giving up. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Octokit with pagination, bounded retries (server errors only, at most 2
 * retries) and rate-limit handling that waits at most once, for at most 60 s.
 * Octokit's own logging is silenced so nothing request-related reaches logs.
 */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const base = options.retryBaseMs ?? 1000;
  const waitOnce = (
    retryAfterSeconds: number,
    _options: unknown,
    _octokit: unknown,
    retryCount: number,
  ) => retryCount < 1 && retryAfterSeconds <= MAX_RATE_LIMIT_WAIT_SECONDS;

  return new GuardianOctokit({
    auth: options.token,
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    userAgent: options.userAgent,
    log: silent,
    retry: {
      retries: 2,
      retryAfterBaseValue: base,
      doNotRetry: [400, 401, 403, 404, 409, 410, 422, 429, 451],
    },
    throttle: {
      retryAfterBaseValue: base,
      onRateLimit: waitOnce,
      onSecondaryRateLimit: waitOnce,
    },
  });
}

export type GitHubErrorCode =
  'unauthorized' | 'forbidden' | 'not-found' | 'rate-limited' | 'unavailable' | 'invalid-response';

/** Safe to log: built from the status code only, never from response bodies or headers. */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly status: number | undefined;

  constructor(code: GitHubErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

export function toGitHubError(error: unknown, what: string): GitHubError {
  if (error instanceof GitHubError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || status === 0) {
    return new GitHubError('unavailable', `Could not reach the GitHub API while ${what}.`);
  }
  const rateLimited =
    status === 429 ||
    (status === 403 && /rate limit/i.test(error instanceof Error ? error.message : ''));
  if (rateLimited) {
    return new GitHubError('rate-limited', `GitHub API rate limit reached while ${what}.`, status);
  }
  switch (status) {
    case 401:
      return new GitHubError(
        'unauthorized',
        `GitHub rejected the token while ${what} (401).`,
        status,
      );
    case 403:
      return new GitHubError(
        'forbidden',
        `GitHub denied access while ${what} (403). The workflow needs "pull-requests: read" and "contents: read" permissions.`,
        status,
      );
    case 404:
      return new GitHubError(
        'not-found',
        `Not found while ${what} (404). Check the token's repository access.`,
        status,
      );
    default:
      return new GitHubError(
        status >= 500 ? 'unavailable' : 'invalid-response',
        `GitHub API returned HTTP ${String(status)} while ${what}.`,
        status,
      );
  }
}
