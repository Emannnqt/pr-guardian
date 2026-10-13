import { z } from 'zod';

/** Pull request events PR Guardian reviews. Others are skipped, not failed. */
export const SUPPORTED_ACTIONS = ['opened', 'synchronize', 'reopened'] as const;

const MAX_EVENT_BYTES = 10 * 1024 * 1024;

export interface PullRequestEvent {
  owner: string;
  repo: string;
  number: number;
  action: (typeof SUPPORTED_ACTIONS)[number];
  headSha: string;
  baseSha: string;
  /** Head branch lives in another repository: read-only token, no secrets. */
  isFork: boolean;
}

export type EventOutcome =
  { kind: 'review'; event: PullRequestEvent } | { kind: 'skip'; reason: string };

export class GitHubEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubEventError';
  }
}

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const owner = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);
const repoName = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const fullName = z.string().max(200);

const PullRequestEventSchema = z.object({
  action: z.string().max(100),
  number: z.number().int().positive(),
  pull_request: z.object({
    head: z.object({ sha, repo: z.object({ full_name: fullName }).nullable() }),
    base: z.object({ sha, repo: z.object({ full_name: fullName }) }),
  }),
  repository: z.object({ name: repoName, owner: z.object({ login: owner }) }),
});

/**
 * Validate the workflow event. Only `pull_request` is accepted: with
 * `pull_request_target` a fork's code would run with the base repository's
 * secrets and write token, which this reviewer never needs.
 */
export function parsePullRequestEvent(eventName: string, payload: string): EventOutcome {
  if (eventName === 'pull_request_target') {
    throw new GitHubEventError(
      'Refusing to run on pull_request_target: it gives pull request code access to secrets and a write token. Use the pull_request trigger.',
    );
  }
  if (eventName !== 'pull_request') {
    throw new GitHubEventError(
      `Unsupported event "${eventName.slice(0, 50)}". PR Guardian runs on pull_request events.`,
    );
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_EVENT_BYTES) {
    throw new GitHubEventError('Event payload is too large.');
  }

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    throw new GitHubEventError('Event payload is not valid JSON.');
  }
  const parsed = PullRequestEventSchema.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.slice(0, 3).map((i) => i.path.join('.'));
    throw new GitHubEventError(
      `Event payload is not a valid pull_request event (${fields.join(', ')}).`,
    );
  }
  const data = parsed.data;

  const action = SUPPORTED_ACTIONS.find((a) => a === data.action);
  if (action === undefined) {
    return {
      kind: 'skip',
      reason: `pull_request action "${data.action.slice(0, 50)}" is not reviewed (only ${SUPPORTED_ACTIONS.join(', ')}).`,
    };
  }

  const head = data.pull_request.head;
  return {
    kind: 'review',
    event: {
      owner: data.repository.owner.login,
      repo: data.repository.name,
      number: data.number,
      action,
      headSha: head.sha,
      baseSha: data.pull_request.base.sha,
      // A deleted fork has no head repository; treat it as a fork.
      isFork: head.repo?.full_name !== data.pull_request.base.repo.full_name,
    },
  };
}
