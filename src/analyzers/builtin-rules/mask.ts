/**
 * Blank out the contents of single/double-quoted strings and comments on one
 * line of JS/TS, preserving quotes and length, so code rules match code rather
 * than text that merely mentions a pattern (e.g. `'eval(x)'` as test data).
 *
 * Template literals are left intact: their `${…}` parts are code, and the
 * shell-interpolation rule needs them. This is a single-line heuristic, not a
 * parser; strings spanning lines and regex literals containing quotes are not
 * understood.
 */
export function maskNonCode(line: string): string {
  let out = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quote !== undefined) {
      if (ch === '\\') {
        out += i + 1 < line.length ? '  ' : ' ';
        i++;
      } else if (ch === quote) {
        out += ch;
        quote = undefined;
      } else {
        out += ' ';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '/' && line.charAt(i + 1) === '/') {
      return out + ' '.repeat(line.length - i);
    } else if (ch === '/' && line.charAt(i + 1) === '*') {
      const end = line.indexOf('*/', i + 2);
      const stop = end === -1 ? line.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop - 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Line is the start or continuation of a block or line comment. */
export function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}
