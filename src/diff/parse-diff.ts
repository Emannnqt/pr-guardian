import { byteLength, type DiffLimits } from './limits.js';
import { normalizeRepoPath } from './paths.js';
import { DiffError, type DiffFile, type FileChangeStatus, type Hunk } from './types.js';

const MAX_HUNK_NUMBER = 10_000_000;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DEV_NULL = '/dev/null';

interface Section {
  header: string;
  lines: string[];
  /** 1-based line number of the `diff --git` header, for error messages. */
  startLine: number;
}

/**
 * Parse a git-style unified diff (the output of `git diff`, or GitHub's
 * `application/vnd.github.diff`). The input is untrusted: sizes are checked
 * before any work, paths are validated, and hunk line counts must agree with
 * their headers. Anything inconsistent is rejected rather than guessed at.
 */
export function parseUnifiedDiff(text: string, limits: DiffLimits): DiffFile[] {
  const size = byteLength(text);
  if (size > limits.maxDiffBytes) {
    throw new DiffError(
      'diff-too-large',
      `Diff is ${String(size)} bytes; the limit is ${String(limits.maxDiffBytes)}.`,
    );
  }
  if (text.trim() === '') {
    throw new DiffError('empty-input', 'Diff is empty.');
  }

  const sections = splitSections(text, limits.maxFiles);
  if (sections.length === 0) {
    throw new DiffError(
      'malformed-diff',
      'No file sections found. Expected a git-style unified diff (output of `git diff`).',
    );
  }

  const files = sections.map(parseSection);
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new DiffError(
        'malformed-diff',
        `File appears more than once in the diff: ${file.path}`,
      );
    }
    seen.add(file.path);
  }
  return files;
}

function splitSections(text: string, maxFiles: number): Section[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.at(-1) === '') lines.pop();

  const sections: Section[] = [];
  let current: Section | undefined;
  lines.forEach((line, index) => {
    if (line.startsWith('diff --git ')) {
      if (sections.length >= maxFiles) {
        throw new DiffError(
          'too-many-files',
          `Diff touches more than ${String(maxFiles)} files; the limit is ${String(maxFiles)}.`,
        );
      }
      current = { header: line, lines: [], startLine: index + 1 };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
    // Lines before the first `diff --git` (e.g. a format-patch preamble) are ignored.
  });
  return sections;
}

function parseSection(section: Section): DiffFile {
  const fail = (message: string): never => {
    throw new DiffError(
      'malformed-diff',
      `${message} (file section at line ${String(section.startLine)})`,
    );
  };

  const headerPaths = parseGitHeaderPaths(section.header.slice('diff --git '.length));
  let status: FileChangeStatus = 'modified';
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let copyTo: string | undefined;
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let binary = false;
  const hunks: Hunk[] = [];

  const lines = section.lines;
  let i = 0;

  // Extended header lines, up to the first hunk or the ---/+++ pair.
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('--- ') || line.startsWith('@@')) break;
    if (line.startsWith('new file mode ')) status = 'added';
    else if (line.startsWith('deleted file mode ')) status = 'removed';
    else if (line.startsWith('rename from '))
      renameFrom = unquote(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) renameTo = unquote(line.slice('rename to '.length));
    else if (line.startsWith('copy from ')) status = 'added';
    else if (line.startsWith('copy to ')) {
      status = 'added';
      copyTo = unquote(line.slice('copy to '.length));
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      binary = true;
      break;
    } else if (!isKnownExtendedHeader(line)) {
      fail(`Unexpected line in file header: ${JSON.stringify(line.slice(0, 80))}`);
    }
  }

  if (!binary && i < lines.length && (lines[i] ?? '').startsWith('--- ')) {
    const plus = lines[i + 1] ?? '';
    if (!plus.startsWith('+++ ')) fail('`---` line is not followed by a `+++` line');
    oldPath = stripPrefix(unquote(stripTrailingTab((lines[i] ?? '').slice(4))), 'a/');
    newPath = stripPrefix(unquote(stripTrailingTab(plus.slice(4))), 'b/');
    if (oldPath === DEV_NULL) status = 'added';
    if (newPath === DEV_NULL) status = 'removed';
    i += 2;
  }

  if (!binary) {
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (!line.startsWith('@@'))
        fail(`Expected a hunk header, found ${JSON.stringify(line.slice(0, 80))}`);
      i = parseHunk(lines, i, hunks, fail);
    }
  }

  if (renameFrom !== undefined || renameTo !== undefined) {
    if (renameFrom === undefined || renameTo === undefined) fail('Incomplete rename header');
    status = 'renamed';
  }

  const rawPath =
    renameTo ??
    copyTo ??
    (newPath !== undefined && newPath !== DEV_NULL ? newPath : undefined) ??
    (oldPath !== undefined && oldPath !== DEV_NULL ? oldPath : undefined) ??
    headerPaths?.newPath;
  if (rawPath === undefined) {
    return fail('Could not determine the file path');
  }

  const file: DiffFile = {
    path: normalizeRepoPath(rawPath),
    status,
    binary,
    hunks,
    patchBytes:
      byteLength(section.header) + section.lines.reduce((n, l) => n + byteLength(l) + 1, 1),
  };
  if (status === 'renamed' && renameFrom !== undefined) {
    file.previousPath = normalizeRepoPath(renameFrom);
  }
  return file;
}

function parseHunk(
  lines: readonly string[],
  start: number,
  hunks: Hunk[],
  fail: (message: string) => never,
): number {
  const header = lines[start] ?? '';
  const match = HUNK_HEADER.exec(header);
  if (!match) fail(`Malformed hunk header: ${JSON.stringify(header.slice(0, 80))}`);

  const num = (value: string | undefined, fallback: number): number => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_HUNK_NUMBER)
      fail('Hunk header number out of range');
    return n;
  };
  const hunk: Hunk = {
    oldStart: num(match[1], 0),
    oldLines: num(match[2], 1),
    newStart: num(match[3], 0),
    newLines: num(match[4], 1),
    addedLines: [],
    removedCount: 0,
    lines: [],
  };

  let oldRemaining = hunk.oldLines;
  let newRemaining = hunk.newLines;
  let newLine = hunk.newStart;
  let i = start + 1;

  while (oldRemaining > 0 || newRemaining > 0) {
    const line = lines[i];
    if (line === undefined) fail('Diff ended inside a hunk');
    const marker = line[0] ?? ' '; // an empty line is a context line whose trailing space was stripped
    if (marker === '\\') {
      i++;
      continue;
    }
    if (marker === '+') {
      if (newRemaining === 0) fail('Hunk has more added lines than its header declares');
      hunk.addedLines.push({ line: newLine, content: line.slice(1) });
      hunk.lines.push({ kind: 'add', content: line.slice(1), newLine });
      newLine++;
      newRemaining--;
    } else if (marker === '-') {
      if (oldRemaining === 0) fail('Hunk has more removed lines than its header declares');
      hunk.removedCount++;
      hunk.lines.push({ kind: 'remove', content: line.slice(1) });
      oldRemaining--;
    } else if (marker === ' ') {
      if (oldRemaining === 0 || newRemaining === 0)
        fail('Hunk has more context lines than its header declares');
      hunk.lines.push({ kind: 'context', content: line.slice(1), newLine });
      newLine++;
      oldRemaining--;
      newRemaining--;
    } else {
      fail(`Unexpected line inside hunk: ${JSON.stringify(line.slice(0, 80))}`);
    }
    i++;
  }
  // Trailing "\ No newline at end of file" markers belong to this hunk.
  while ((lines[i] ?? '').startsWith('\\')) i++;

  hunks.push(hunk);
  return i;
}

const EXTENDED_HEADERS = [
  'index ',
  'old mode ',
  'new mode ',
  'similarity index ',
  'dissimilarity index ',
];

function isKnownExtendedHeader(line: string): boolean {
  return EXTENDED_HEADERS.some((prefix) => line.startsWith(prefix));
}

/** Paths from `diff --git a/X b/Y`, used only when no other header names the file. */
function parseGitHeaderPaths(rest: string): { newPath: string } | undefined {
  if (rest.startsWith('"')) {
    const end = findClosingQuote(rest);
    if (end === -1) return undefined;
    const second = rest.slice(end + 2);
    return { newPath: stripPrefix(unquote(second), 'b/') };
  }
  // Unquoted and identical on both sides: "a/P b/P".
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ') {
    const left = stripPrefix(rest.slice(0, half), 'a/');
    const right = stripPrefix(rest.slice(half + 1), 'b/');
    if (left === right) return { newPath: right };
  }
  return undefined;
}

function stripPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function stripTrailingTab(value: string): string {
  const tab = value.indexOf('\t');
  return tab === -1 ? value : value.slice(0, tab);
}

function findClosingQuote(s: string): number {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};

/** Decode git's C-style quoted paths (e.g. `"dir/caf\303\251.ts"`). Unquoted input is returned as-is. */
export function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"') || value.length < 2) {
    throw new DiffError('malformed-diff', 'Unterminated quoted path');
  }
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? '';
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next] ?? 0);
      i += 1;
    } else {
      throw new DiffError('malformed-diff', 'Invalid escape sequence in quoted path');
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
