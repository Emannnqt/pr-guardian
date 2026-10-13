import { describe, expect, it } from 'vitest';

import { codeBlock, escapeInline, inlineCode, sanitize } from '../../../src/report/escape.js';

const ZWSP = '​';

describe('escapeInline', () => {
  it('entity-encodes HTML', () => {
    expect(escapeInline('<img src=x onerror=alert(1)> & co')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; co',
    );
  });

  it('neutralizes links and images', () => {
    expect(escapeInline('[click](javascript:alert(1)) ![i](x) a|b')).toBe(
      '\\[click\\](javascript:alert(1)) !\\[i\\](x) a|b',
    );
  });

  it('breaks mentions and autolinks', () => {
    expect(escapeInline('@everyone see https://evil.example or www.evil.example')).toBe(
      `@${ZWSP}everyone see https:${ZWSP}//evil.example or www${ZWSP}.evil.example`,
    );
  });

  it('collapses newlines so text cannot start block elements', () => {
    expect(escapeInline('line\n# Heading\n\n> quote')).toBe('line # Heading &gt; quote');
  });
});

describe('sanitize', () => {
  it('removes control and bidi characters but keeps newlines and tabs', () => {
    expect(sanitize('a\u0000b\u001Bc‮d⁦e\tf\ng')).toBe('abcde\tf\ng');
  });
});

describe('inlineCode', () => {
  it('uses a fence longer than any backtick run', () => {
    expect(inlineCode('src/a.ts')).toBe('`src/a.ts`');
    expect(inlineCode('a``b')).toBe('```a``b```');
    expect(inlineCode('`edge`')).toBe('`` `edge` ``');
  });
});

describe('codeBlock', () => {
  it('cannot be closed early by content', () => {
    const block = codeBlock('```\n</details>\n````');
    const fence = block.split('\n')[0]?.replace('text', '') ?? '';
    expect(fence).toBe('`````');
    expect(block.endsWith(`\n${fence}`)).toBe(true);
  });
});
