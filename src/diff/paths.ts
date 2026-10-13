import { DiffError } from './types.js';

export const MAX_PATH_LENGTH = 1024;

// C0/C1 controls, plus bidi overrides/isolates used in "Trojan Source" attacks.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

/**
 * Validate and normalize a repository-relative path taken from untrusted input.
 * Rejects absolute paths, traversal, backslashes, control and bidi characters.
 */
export function normalizeRepoPath(raw: string): string {
  const describe = JSON.stringify(raw.slice(0, 80));

  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) {
    throw new DiffError(
      'unsafe-path',
      `Path is empty or longer than ${String(MAX_PATH_LENGTH)} characters.`,
    );
  }
  if (FORBIDDEN_CHARS.test(raw)) {
    throw new DiffError(
      'unsafe-path',
      `Path contains control or bidirectional characters: ${describe}`,
    );
  }
  if (raw.includes('\\')) {
    throw new DiffError('unsafe-path', `Path contains a backslash: ${describe}`);
  }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new DiffError('unsafe-path', `Path must be repository-relative: ${describe}`);
  }

  const segments = raw.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) {
    throw new DiffError('unsafe-path', `Path has no file name: ${describe}`);
  }
  if (segments.includes('..')) {
    throw new DiffError('unsafe-path', `Path traversal is not allowed: ${describe}`);
  }
  return segments.join('/');
}
