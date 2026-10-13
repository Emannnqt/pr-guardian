import { z } from 'zod';

import type { ReviewFinding } from '../core/schema.js';
import { INLINE_MARKER_PATTERN, renderInlineComment } from '../report/markdown.js';
import { toGitHubError, type GitHubClient } from './client.js';
import type { PullRequestRef } from './pull-request.js';

/** A PR Guardian comment already on the pull request. `line` is null once outdated. */
export interface ExistingComment {
  fingerprint: string;
  path: string;
  line: number | null;
}

export interface PlannedComment {
  path: string;
  line: number;
  body: string;
}

export interface InlinePlan {
  toPost: PlannedComment[];
  alreadyPresent: number;
  noValidLine: number;
  overLimit: number;
}

const CommentSchema = z.object({
  body: z.string(),
  path: z.string(),
  line: z.number().int().positive().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
});

/**
 * PR Guardian's own review comments on the pull request. A comment counts as
 * ours only if it is written by `author` *and* carries the marker, so a pull
 * request author cannot suppress a finding by pasting the marker themselves.
 */
export async function listOwnComments(
  client: GitHubClient,
  ref: PullRequestRef,
  author: string,
  signal: AbortSignal,
): Promise<ExistingComment[]> {
  // `request` (abort signal) is a valid Octokit option but missing from this
  // endpoint's generated parameter type, so pass the params as a variable.
  const params = {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    per_page: 100,
    request: { signal },
  };
  let raw: unknown[];
  try {
    raw = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', params);
  } catch (error: unknown) {
    throw toGitHubError(error, 'listing existing review comments');
  }

  const own: ExistingComment[] = [];
  for (const item of raw) {
    const parsed = CommentSchema.safeParse(item);
    if (!parsed.success || parsed.data.user?.login !== author) continue;
    const fingerprint = INLINE_MARKER_PATTERN.exec(parsed.data.body)?.[1];
    if (fingerprint === undefined) continue;
    own.push({ fingerprint, path: parsed.data.path, line: parsed.data.line ?? null });
  }
  return own;
}

/**
 * Decide which findings get an inline comment (pure). A finding qualifies when
 * its line is an added line of the diff and no PR Guardian comment for the
 * same fingerprint currently sits on that line. Findings arrive most severe
 * first, so the cap keeps the most important ones.
 */
export function planInlineComments(
  findings: readonly ReviewFinding[],
  commentable: ReadonlyMap<string, ReadonlySet<number>>,
  existing: readonly ExistingComment[],
  max: number,
): InlinePlan {
  const present = new Set(
    existing.filter((c) => c.line !== null).map((c) => key(c.fingerprint, c.path, c.line ?? 0)),
  );
  const plan: InlinePlan = { toPost: [], alreadyPresent: 0, noValidLine: 0, overLimit: 0 };
  const planned = new Set<string>();

  for (const finding of findings) {
    const line = finding.startLine;
    if (line === undefined || commentable.get(finding.filePath)?.has(line) !== true) {
      plan.noValidLine++;
      continue;
    }
    const k = key(finding.fingerprint, finding.filePath, line);
    if (present.has(k) || planned.has(k)) {
      plan.alreadyPresent++;
      continue;
    }
    if (plan.toPost.length >= max) {
      plan.overLimit++;
      continue;
    }
    planned.add(k);
    plan.toPost.push({ path: finding.filePath, line, body: renderInlineComment(finding) });
  }
  return plan;
}

/**
 * Publish all comments as one review with event COMMENT: a single API call
 * and notification, never an approval or a change request.
 */
export async function postReview(
  client: GitHubClient,
  ref: PullRequestRef,
  headSha: string,
  comments: readonly PlannedComment[],
  signal: AbortSignal,
): Promise<void> {
  try {
    await client.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      commit_id: headSha,
      event: 'COMMENT',
      body: `PR Guardian left ${String(comments.length)} inline comment${comments.length === 1 ? '' : 's'}. The full report is in the workflow run's job summary.`,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: 'RIGHT' as const,
        body: c.body,
      })),
      request: { signal },
    });
  } catch (error: unknown) {
    throw toGitHubError(error, 'posting inline review comments');
  }
}

function key(fingerprint: string, path: string, line: number): string {
  return `${fingerprint}\u0000${path}\u0000${String(line)}`;
}
