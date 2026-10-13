import type { DiffFile } from './types.js';

/**
 * Lines that may carry an inline review comment: the new-side numbers of
 * *added* lines, per file. Comments on unchanged context or deleted lines are
 * never posted (spec §11).
 */
export function commentableLines(files: readonly DiffFile[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    const lines = new Set(file.hunks.flatMap((h) => h.addedLines.map((l) => l.line)));
    if (lines.size > 0) map.set(file.path, lines);
  }
  return map;
}
