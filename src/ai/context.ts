import { byteLength } from '../diff/limits.js';
import { detectSecrets, redactSecrets } from '../core/redact.js';
import type { ReviewFile } from '../core/types.js';
import type { HunkLine } from '../diff/types.js';

/** Exactly what the model is shown for one file. Also used to ground its answers. */
export interface ContextFile {
  path: string;
  /** Rendered, redacted hunk text. */
  text: string;
  /** Redacted content of every line shown, by new-side line number (added and context lines). */
  shownLines: ReadonlyMap<number, string>;
  /** New-side line numbers of added lines, the only lines findings may cite. */
  addedLines: ReadonlySet<number>;
}

export type OmitReason = 'contains-secret' | 'context-budget';

export interface AiContext {
  files: ContextFile[];
  omitted: { path: string; reason: OmitReason }[];
}

/**
 * Select and render the diff context sent to a model (spec §9.4, §16.5 step 5).
 * Fails closed: a file containing a high-confidence secret anywhere in its
 * hunks is not sent at all. Everything else is passed through `redactSecrets`
 * and the total is capped at `maxContextBytes`.
 */
export function buildAiContext(files: readonly ReviewFile[], maxContextBytes: number): AiContext {
  const context: AiContext = { files: [], omitted: [] };
  let used = 0;

  for (const file of files) {
    const lines = file.hunks.flatMap((hunk, i) => (i === 0 ? hunk.lines : [GAP, ...hunk.lines]));
    if (lines.some((line) => detectSecrets(line.content).length > 0)) {
      context.omitted.push({ path: file.path, reason: 'contains-secret' });
      continue;
    }

    const shownLines = new Map<number, string>();
    const addedLines = new Set<number>();
    const rendered = lines.map((line) => {
      const content = redactSecrets(line.content);
      if (line.newLine !== undefined) shownLines.set(line.newLine, content);
      if (line.kind === 'add' && line.newLine !== undefined) addedLines.add(line.newLine);
      return renderLine(line, content);
    });
    const text = rendered.join('\n');

    const size = byteLength(text) + byteLength(file.path) + 100; // + block delimiters
    if (used + size > maxContextBytes) {
      context.omitted.push({ path: file.path, reason: 'context-budget' });
      continue;
    }
    used += size;
    context.files.push({ path: file.path, text, shownLines, addedLines });
  }
  return context;
}

/** Marks a jump between hunks. */
const GAP: HunkLine = { kind: 'context', content: '…' };

function renderLine(line: HunkLine, content: string): string {
  const number = line.newLine === undefined ? '' : String(line.newLine);
  const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
  return `${number.padStart(6)} ${marker}${content}`;
}
