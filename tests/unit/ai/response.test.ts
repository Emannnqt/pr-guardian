import { describe, expect, it } from 'vitest';

import { buildAiContext } from '../../../src/ai/context.js';
import { AiResponseError, parseAiResponse } from '../../../src/ai/response.js';
import { addedFileDiff, reviewFilesFromDiff } from '../../helpers/review-files.js';

const shown = buildAiContext(
  reviewFilesFromDiff(
    addedFileDiff(
      'src/a.ts',
      'const q = db.query(`SELECT * FROM t WHERE id = ${id}`);',
      'return q;',
    ),
  ),
  10_000,
).files;

const options = { maxResponseBytes: 10_000, minConfidence: 0.5, ruleId: 'ai/review-v1' };

function finding(overrides: Record<string, unknown> = {}) {
  return {
    title: 'SQL built by string interpolation',
    severity: 'high',
    category: 'security',
    confidence: 0.8,
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    explanation: 'User input reaches SQL.',
    evidence: 'db.query(`SELECT * FROM t WHERE id = ${id}`)',
    suggestedFix: 'Use a parameterized query.',
    ...overrides,
  };
}

const parse = (findings: unknown[], opts = options) =>
  parseAiResponse(JSON.stringify({ findings }), shown, opts);

describe('parseAiResponse', () => {
  it('accepts a grounded finding and stamps provenance in code', () => {
    const { findings, diagnostics } = parse([finding()]);
    expect(diagnostics).toEqual([]);
    expect(findings).toEqual([
      expect.objectContaining({ source: 'ai', ruleId: 'ai/review-v1', startLine: 1, endLine: 1 }),
    ]);
  });

  it('accepts an empty findings list', () => {
    expect(parse([])).toEqual({ findings: [], diagnostics: [] });
  });

  it('strips one ```json fence', () => {
    const raw = '```json\n' + JSON.stringify({ findings: [finding()] }) + '\n```';
    expect(parseAiResponse(raw, shown, options).findings).toHaveLength(1);
  });

  it.each([
    ['not JSON', 'Sure! Here are the issues I found:'],
    ['prose around JSON', 'Result: {"findings": []}'],
    ['wrong envelope', '[]'],
    ['findings not an array', '{"findings": "none"}'],
    [
      'too many findings',
      JSON.stringify({ findings: Array.from({ length: 21 }, () => finding()) }),
    ],
  ])('rejects the whole response when it is %s', (_label, raw) => {
    expect(() => parseAiResponse(raw, shown, options)).toThrow(AiResponseError);
  });

  it('rejects oversized responses before parsing', () => {
    const raw = JSON.stringify({ findings: [finding({ explanation: 'x'.repeat(500) })] });
    expect(() => parseAiResponse(raw, shown, { ...options, maxResponseBytes: 100 })).toThrow(
      /exceeds 100 bytes/,
    );
  });

  it('ignores attempts to set source, ruleId or id', () => {
    const [f] = parse([finding({ source: 'static-analysis', ruleId: 'builtin/x', id: 'mine' })])
      .findings as Record<string, unknown>[];
    expect(f).toMatchObject({ source: 'ai', ruleId: 'ai/review-v1' });
    expect(f).not.toHaveProperty('id');
  });

  it.each([
    ['an invalid severity', { severity: 'catastrophic' }, /invalid fields \(severity\)/],
    ['a file it was not shown', { filePath: 'src/other.ts' }, /not shown/],
    ['low confidence', { confidence: 0.2 }, /below 0\.50/],
    ['invented evidence', { evidence: 'eval(userInput)' }, /does not quote an added line/],
    ['trivial evidence', { evidence: ';' }, /does not quote an added line/],
  ])('drops a finding with %s', (_label, overrides, why) => {
    const { findings, diagnostics } = parse([finding(overrides)]);
    expect(findings).toEqual([]);
    expect(diagnostics[0]).toMatch(why);
  });

  it('keeps valid findings when another is dropped', () => {
    expect(parse([finding(), finding({ filePath: 'nope.ts' })]).findings).toHaveLength(1);
  });

  it('corrects a wrong line number from unambiguous evidence', () => {
    const { findings, diagnostics } = parse([finding({ startLine: 40, endLine: 41 })]);
    expect(findings[0]).toMatchObject({ startLine: 1, endLine: 1 });
    expect(diagnostics[0]).toMatch(/line 40 corrected to 1/);
  });

  it('removes the location when the evidence matches several added lines', () => {
    const twice = buildAiContext(
      reviewFilesFromDiff(addedFileDiff('src/a.ts', 'eval(x);', 'eval(x);')),
      10_000,
    ).files;
    const raw = JSON.stringify({ findings: [finding({ evidence: 'eval(x);', startLine: 9 })] });
    const { findings, diagnostics } = parseAiResponse(raw, twice, options);
    expect(findings[0]).not.toHaveProperty('startLine');
    expect(diagnostics[0]).toMatch(/could not be verified/);
  });
});
