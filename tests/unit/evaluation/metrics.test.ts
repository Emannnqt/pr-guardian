import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../../../src/core/schema.js';
import type { ReviewReport } from '../../../src/core/types.js';
import { replaceSection } from '../../../evaluation/evaluate.js';
import {
  CaseLabelsSchema,
  scoreCase,
  summarize,
  type CaseLabels,
} from '../../../evaluation/metrics.js';

function finding(file: string, line: number | undefined, ruleId = 'r'): ReviewFinding {
  return {
    id: `${file}:${String(line)}:${ruleId}`,
    fingerprint: 'f',
    title: 't',
    severity: 'high',
    category: 'security',
    confidence: 0.9,
    filePath: file,
    ...(line === undefined ? {} : { startLine: line, endLine: line }),
    explanation: 'e',
    evidence: 'x',
    source: 'static-analysis',
    ruleId,
  };
}

function report(findings: ReviewFinding[], diagnostics: string[] = []): ReviewReport {
  return {
    reviewerVersion: '1.0.0',
    mode: 'rules-only',
    status: 'completed',
    findings,
    minSeverity: 'info',
    belowThresholdCount: 0,
    files: { analyzed: ['a.ts'], skipped: [] },
    analyzers: [
      {
        analyzer: 'x',
        status: 'succeeded',
        durationMs: 0,
        findingCount: findings.length,
        diagnostics,
      },
    ],
    limitations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const labels = (overrides: Partial<CaseLabels> = {}): CaseLabels => ({
  id: 'c',
  group: 'security',
  description: 'd',
  expected: [
    { file: 'a.ts', line: 3, issue: 'one' },
    { file: 'a.ts', line: 7, issue: 'two' },
  ],
  acceptable: [{ file: 'a.ts', line: 9, reason: 'debatable' }],
  ...overrides,
});

describe('scoreCase', () => {
  it('classifies findings as correct, duplicate, acceptable or false positive', () => {
    const result = scoreCase(
      labels(),
      report([
        finding('a.ts', 3),
        finding('a.ts', 3, 'other'), // second finding on the same issue
        finding('a.ts', 9), // debatable line
        finding('a.ts', 4), // wrong line
        finding('b.ts', 3), // wrong file
        finding('a.ts', undefined), // no line
      ]),
      12.4,
    );
    expect(result.findings.map((f) => f.outcome)).toEqual([
      'tp',
      'duplicate',
      'acceptable',
      'fp',
      'fp',
      'fp',
    ]);
    expect(result).toMatchObject({
      expected: 2,
      tp: 1,
      fp: 3,
      duplicates: 1,
      acceptable: 1,
      runtimeMs: 12,
    });
    expect(result.missed).toEqual([{ file: 'a.ts', line: 7, issue: 'two' }]);
  });

  it('counts candidates dropped by validation', () => {
    const result = scoreCase(
      labels(),
      report(
        [finding('a.ts', 3)],
        ['Dropped AI finding #2: x.', 'Dropped invalid finding #3 (y).', 'Other note.'],
      ),
      0,
    );
    expect(result).toMatchObject({ validCandidates: 1, droppedCandidates: 2 });
  });
});

describe('summarize', () => {
  it('computes precision, recall, rates and per-group recall', () => {
    const security = scoreCase(
      labels(),
      report([finding('a.ts', 3), finding('a.ts', 4)], ['Dropped x']),
      0,
    );
    const clean = scoreCase(
      labels({ id: 'k', group: 'clean', expected: [], acceptable: [] }),
      report([finding('z.ts', 1)]),
      0,
    );
    const quiet = scoreCase(
      labels({ id: 'q', group: 'clean', expected: [], acceptable: [] }),
      report([]),
      0,
    );
    const m = summarize([security, clean, quiet]);
    expect(m).toMatchObject({
      cases: 3,
      expectedIssues: 2,
      truePositives: 1,
      falsePositives: 2,
      precision: 0.333,
      recall: 0.5,
      cleanCaseFalsePositiveRate: 0.5,
      invalidFindingRate: 0.25, // 1 dropped of 4 candidates
      duplicateRate: 0,
      recallByGroup: { security: { found: 1, expected: 2 } },
      statuses: { completed: 3 },
    });
  });

  it('reports n/a (null) instead of dividing by zero', () => {
    expect(summarize([])).toMatchObject({
      precision: null,
      recall: null,
      cleanCaseFalsePositiveRate: null,
    });
  });
});

describe('CaseLabelsSchema', () => {
  it('rejects unknown groups, bad lines and extra keys', () => {
    expect(CaseLabelsSchema.safeParse({ ...labels(), group: 'misc' }).success).toBe(false);
    expect(
      CaseLabelsSchema.safeParse({ ...labels(), expected: [{ file: 'a', line: 0, issue: 'x' }] })
        .success,
    ).toBe(false);
    expect(CaseLabelsSchema.safeParse({ ...labels(), extra: 1 }).success).toBe(false);
  });
});

describe('replaceSection', () => {
  it('replaces only the marked section', () => {
    const doc = 'a\n<!-- results:x:start -->\nold\n<!-- results:x:end -->\nb';
    expect(replaceSection(doc, 'x', 'new')).toBe(
      'a\n<!-- results:x:start -->\n\nnew\n\n<!-- results:x:end -->\nb',
    );
    expect(() => replaceSection(doc, 'y', 'new')).toThrow(/Markers/);
  });
});
