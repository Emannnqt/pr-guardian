import { describe, expect, it } from 'vitest';

import { isCommentLine, maskNonCode } from '../../../src/analyzers/builtin-rules/mask.js';

describe('maskNonCode', () => {
  it.each([
    ["const s = 'eval(x)';", "const s = '       ';"],
    ['f("a\\"b", 1)', 'f("    ", 1)'],
    ['code(); // eval(x)', 'code();           '],
    ['a /* eval() */ b', 'a              b'],
    ['run(`ls ${dir}`)', 'run(`ls ${dir}`)'],
    ['plain code', 'plain code'],
    ["'unterminated", "'            "],
  ])('masks %j', (input, expected) => {
    const masked = maskNonCode(input);
    expect(masked).toBe(expected);
    expect(masked).toHaveLength(input.length);
  });
});

describe('isCommentLine', () => {
  it.each(['// x', '  /* x', ' * x'])('detects %j', (line) => {
    expect(isCommentLine(line)).toBe(true);
  });
  it.each(['x = 1; // y', 'a * b'])('ignores %j', (line) => {
    expect(isCommentLine(line)).toBe(false);
  });
});
