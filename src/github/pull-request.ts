import { z } from 'zod';

import { byteLength, type DiffLimits } from '../diff/limits.js';
import { parseFilePatch } from '../diff/parse-diff.js';
import { normalizeRepoPath } from '../diff/paths.js';
import { DiffError, type DiffFile, type FileChangeStatus } from '../diff/types.js';
import { GitHubError, toGitHubError, type GitHubClient } from './client.js';

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface LoadedPullRequest {
  headSha: string;
  baseSha: string;
  files: DiffFile[];
}

// Only the fields we use are validated; everything else in the response is ignored.
const PullSchema = z.object({
  head: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  base: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
  changed_files: z.number().int().nonnegative(),
});

const FileSchema = z.object({
  filename: z.string().min(1).max(4096),
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  previous_filename: z.string().max(4096).optional(),
  changes: z.number().int().nonnegative(),
  patch: z.string().optional(),
});

const STATUS: Readonly<Record<z.infer<typeof FileSchema>['status'], FileChangeStatus>> = {
  added: 'added',
  copied: 'added',
  removed: 'removed',
  modified: 'modified',
  changed: 'modified',
  unchanged: 'modified',
  renamed: 'renamed',
};

/**
 * Load a pull request's changed files through the REST API (no checkout, no
 * PR code executed) and convert them to the engine's DiffFile model. Limits
 * are checked as early as possible: the file count before paginating, the
 * total patch size while mapping.
 */
export async function loadPullRequest(
  client: GitHubClient,
  ref: PullRequestRef,
  limits: DiffLimits,
  signal: AbortSignal,
): Promise<LoadedPullRequest> {
  const params = { owner: ref.owner, repo: ref.repo, pull_number: ref.number, request: { signal } };

  let pull: z.infer<typeof PullSchema>;
  try {
    const response = await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', params);
    pull = parse(PullSchema, response.data, 'pull request');
  } catch (error: unknown) {
    throw toGitHubError(error, 'loading the pull request');
  }
  if (pull.changed_files > limits.maxFiles) {
    throw new DiffError(
      'too-many-files',
      `Pull request changes ${String(pull.changed_files)} files; the limit is ${String(limits.maxFiles)}.`,
    );
  }

  let rawFiles: unknown[];
  try {
    rawFiles = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      ...params,
      per_page: 100,
    });
  } catch (error: unknown) {
    throw toGitHubError(error, 'listing the changed files');
  }
  if (rawFiles.length > limits.maxFiles) {
    throw new DiffError(
      'too-many-files',
      `Pull request changes more than ${String(limits.maxFiles)} files.`,
    );
  }

  let totalBytes = 0;
  const files = rawFiles.map((raw) => {
    const file = toDiffFile(parse(FileSchema, raw, 'changed file'), limits);
    totalBytes += file.patchBytes;
    if (totalBytes > limits.maxDiffBytes) {
      throw new DiffError(
        'diff-too-large',
        `Pull request diff exceeds ${String(limits.maxDiffBytes)} bytes.`,
      );
    }
    return file;
  });

  return { headSha: pull.head.sha, baseSha: pull.base.sha, files };
}

function toDiffFile(file: z.infer<typeof FileSchema>, limits: DiffLimits): DiffFile {
  const status = STATUS[file.status];
  const patch = file.patch;
  const patchBytes = patch === undefined ? 0 : byteLength(patch);

  const result: DiffFile = {
    path: normalizeRepoPath(file.filename),
    status,
    // GitHub omits `patch` for binary files (no line changes) and for very large text diffs.
    binary: patch === undefined && file.changes === 0 && status !== 'renamed',
    hunks:
      patch === undefined || patchBytes > limits.maxFileBytes
        ? []
        : parseFilePatch(patch, limits.maxFileBytes),
    patchBytes,
  };
  if (patch === undefined && file.changes > 0) result.patchUnavailable = true;
  if (status === 'renamed' && file.previous_filename !== undefined) {
    result.previousPath = normalizeRepoPath(file.previous_filename);
  }
  return result;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new GitHubError('invalid-response', `GitHub API returned an unexpected ${what}.`);
  }
  return result.data;
}
