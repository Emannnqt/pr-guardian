/**
 * Escaping for untrusted text rendered into GitHub-flavored Markdown (spec §9.5).
 * File paths, evidence and diagnostics can come from a hostile pull request.
 */

// C0/C1 controls (except tab and newline) and bidi overrides/isolates ("Trojan Source").
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

const ZERO_WIDTH_SPACE = '​';

/** Remove characters that can hide or reorder text. */
export function sanitize(text: string): string {
  return text.replace(UNSAFE_CHARS, '');
}

/**
 * Escape text for one line of inline Markdown. Only syntax that can do harm is
 * neutralized: HTML (entity-encoded), links/images (backslash-escaped),
 * autolinked URLs and `@` mentions (broken with a zero-width space so a report
 * can never ping users or link to arbitrary sites). Newlines collapse so text
 * cannot start new block elements.
 * Emphasis and code spans are harmless and left alone.
 */
export function escapeInline(text: string): string {
  return sanitize(text)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\[\]]/g, '\\$&')
    .replace(/:\/\//g, `:${ZERO_WIDTH_SPACE}//`)
    .replace(/\bwww\./gi, `www${ZERO_WIDTH_SPACE}.`)
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

/** Inline code span that cannot be broken out of by backticks in the content. */
export function inlineCode(text: string): string {
  const clean = sanitize(text).replace(/\n/g, ' ');
  const fence = '`'.repeat(longestRun(clean, '`') + 1);
  const pad = clean.startsWith('`') || clean.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${clean}${pad}${fence}`;
}

/** Fenced code block whose fence is longer than any backtick run in the content. */
export function codeBlock(text: string): string {
  const clean = sanitize(text);
  const fence = '`'.repeat(Math.max(3, longestRun(clean, '`') + 1));
  return `${fence}text\n${clean}\n${fence}`;
}

function longestRun(text: string, ch: string): number {
  let longest = 0;
  let current = 0;
  for (const c of text) {
    current = c === ch ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}
