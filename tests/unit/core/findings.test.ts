import { describe, expect, it } from 'vitest';

import { deduplicateFindings } from '../../../src/core/deduplicate.js';
import { normalizeFindings } from '../../../src/core/normalize-findings.js';
import { FindingCandidateSchema } from '../../../src/core/schema.js';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Dynamic code execution',
    severity: 'medium',
    category: 'security',
    confidence: 0.7,
    filePath: 'src/a.ts',
    startLine: 3,
    endLine: 3,
    explanation: 'Explanation.',
    evidence: 'eval(x)',
    source: 'static-analysis',
    ruleId: 'builtin/dynamic-code-execution',
    ...overrides,
  };
}

const reviewed = new Set(['src/a.ts', 'src/b.ts']);

describe('FindingCandidateSchema', () => {
  it('accepts a valid candidate', () => {
    expect(FindingCandidateSchema.safeParse(candidate()).success).toBe(true);
  });

  it.each([
    ['confidence above 1', { confidence: 1.5 }],
    ['negative confidence', { confidence: -0.1 }],
    ['NaN confidence', { confidence: Number.NaN }],
    ['unknown severity', { severity: 'urgent' }],
    ['unknown category', { category: 'style' }],
    ['unknown source', { source: 'oracle' }],
    ['zero line', { startLine: 0 }],
    ['fractional line', { startLine: 1.5 }],
    ['end before start', { startLine: 5, endLine: 4 }],
    ['end without start', { startLine: undefined, endLine: 4 }],
    ['empty title', { title: '   ' }],
    ['oversized title', { title: 'x'.repeat(201) }],
    ['oversized evidence', { evidence: 'x'.repeat(2001) }],
    ['control character', { title: 'a\u0007b' }],
    ['extra field', { approved: true }],
    ['missing evidence', { evidence: undefined }],
  ])('rejects %s', (_label, overrides) => {
    expect(FindingCandidateSchema.safeParse(candidate(overrides)).success).toBe(false);
  });
});

describe('normalizeFindings', () => {
  it('drops invalid candidates and files outside the change, with diagnostics', () => {
    const { findings, diagnostics } = normalizeFindings(
      [
        candidate(),
        'not an object',
        candidate({ confidence: 2 }),
        candidate({ filePath: 'src/unrelated.ts' }),
        candidate({ filePath: '../../etc/passwd' }),
      ],
      reviewed,
    );
    expect(findings).toHaveLength(1);
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics.join('\n')).toMatch(/#3 \(confidence/);
    expect(diagnostics.join('\n')).not.toContain('passwd');
  });

  it('normalizes paths and titles and derives stable identifiers', () => {
    const [a] = normalizeFindings(
      [candidate({ filePath: './src/a.ts', title: '  Dynamic   code\nexecution ' })],
      reviewed,
    ).findings;
    const [b] = normalizeFindings([candidate()], reviewed).findings;
    expect(a?.filePath).toBe('src/a.ts');
    expect(a?.title).toBe('Dynamic code execution');
    expect(a?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(a?.id).toBe(b?.id);
  });

  it('keeps the fingerprint across line shifts but not the id', () => {
    const [a] = normalizeFindings([candidate({ startLine: 3, endLine: 3 })], reviewed).findings;
    const [b] = normalizeFindings([candidate({ startLine: 9, endLine: 9 })], reviewed).findings;
    expect(a?.fingerprint).toBe(b?.fingerprint);
    expect(a?.id).not.toBe(b?.id);
  });

  it('ignores any analyzer-supplied id', () => {
    const result = normalizeFindings([{ ...candidate(), id: 'attacker-chosen' }], reviewed);
    expect(result.findings).toHaveLength(0); // strict schema: unknown keys are rejected
  });

  it('redacts secrets in evidence', () => {
    const key = `AKIA${'Z'.repeat(16)}`;
    const [finding] = normalizeFindings(
      [candidate({ evidence: `const k = '${key}';` })],
      reviewed,
    ).findings;
    expect(finding?.evidence).not.toContain(key);
    expect(finding?.evidence).toContain('[REDACTED AWS access key ID]');
  });
});

describe('deduplicateFindings', () => {
  it('collapses identical findings, keeping the most severe copy', () => {
    const { findings } = normalizeFindings(
      [
        candidate({ severity: 'low' }),
        candidate({ severity: 'high' }),
        candidate({ startLine: 7, endLine: 7 }),
      ],
      reviewed,
    );
    // Same title/evidence/location but different severity → same id.
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
    expect(result[0]?.severity).toBe('high');
  });

  it('sorts deterministically by severity, path and line', () => {
    const { findings } = normalizeFindings(
      [
        candidate({ filePath: 'src/b.ts', severity: 'low', startLine: 1, endLine: 1 }),
        candidate({ filePath: 'src/b.ts', severity: 'high', startLine: 9, endLine: 9 }),
        candidate({ filePath: 'src/a.ts', severity: 'high', startLine: 20, endLine: 20 }),
        candidate({ filePath: 'src/a.ts', severity: 'high', startLine: 2, endLine: 2 }),
      ],
      reviewed,
    );
    expect(
      deduplicateFindings(findings).map(
        (f) => `${f.severity} ${f.filePath}:${String(f.startLine)}`,
      ),
    ).toEqual(['high src/a.ts:2', 'high src/a.ts:20', 'high src/b.ts:9', 'low src/b.ts:1']);
    expect(deduplicateFindings([...findings].reverse())).toEqual(deduplicateFindings(findings));
  });
});
