import { z } from 'zod';

import type { ReviewReport, ReviewStatus } from '../src/core/types.js';

/**
 * Scoring for the labeled evaluation set (spec §12.4). Pure functions: given
 * a case's labels and the report PR Guardian produced, classify every finding
 * and compute aggregate metrics. See docs/evaluation.md for definitions.
 */

export const GROUPS = [
  'security',
  'bug',
  'testing',
  'reliability',
  'clean',
  'ambiguous',
  'prompt-injection',
] as const;
export type Group = (typeof GROUPS)[number];

const Location = { file: z.string().min(1), line: z.number().int().positive() };

export const CaseLabelsSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  group: z.enum(GROUPS),
  description: z.string().min(1),
  expected: z.array(z.strictObject({ ...Location, issue: z.string().min(1) })),
  acceptable: z.array(z.strictObject({ ...Location, reason: z.string().min(1) })),
});
export type CaseLabels = z.infer<typeof CaseLabelsSchema>;

/** tp: matches an expected issue · duplicate: another finding on an already-matched issue ·
 * acceptable: on a line labeled debatable · fp: anything else, including findings without a line. */
export type FindingOutcome = 'tp' | 'fp' | 'duplicate' | 'acceptable';

export interface CaseResult {
  id: string;
  group: Group;
  status: ReviewStatus;
  expected: number;
  tp: number;
  fp: number;
  duplicates: number;
  acceptable: number;
  /** Expected issues no finding matched. */
  missed: { file: string; line: number; issue: string }[];
  findings: { file: string; line: number | null; ruleId: string; outcome: FindingOutcome }[];
  /** Candidates that passed validation / were dropped by validation or grounding. */
  validCandidates: number;
  droppedCandidates: number;
  runtimeMs: number;
}

export function scoreCase(labels: CaseLabels, report: ReviewReport, runtimeMs: number): CaseResult {
  const at = (file: string, line: number) => `${file}:${String(line)}`;
  const expected = new Map(labels.expected.map((e) => [at(e.file, e.line), e]));
  const acceptable = new Set(labels.acceptable.map((a) => at(a.file, a.line)));
  const matched = new Set<string>();

  const findings = report.findings.map((f) => {
    let outcome: FindingOutcome = 'fp';
    if (f.startLine !== undefined) {
      const key = at(f.filePath, f.startLine);
      if (expected.has(key)) {
        outcome = matched.has(key) ? 'duplicate' : 'tp';
        matched.add(key);
      } else if (acceptable.has(key)) {
        outcome = 'acceptable';
      }
    }
    return {
      file: f.filePath,
      line: f.startLine ?? null,
      ruleId: f.ruleId ?? f.source,
      outcome,
    };
  });

  const count = (o: FindingOutcome) => findings.filter((f) => f.outcome === o).length;
  const diagnostics = report.analyzers.flatMap((a) => a.diagnostics);
  return {
    id: labels.id,
    group: labels.group,
    status: report.status,
    expected: labels.expected.length,
    tp: count('tp'),
    fp: count('fp'),
    duplicates: count('duplicate'),
    acceptable: count('acceptable'),
    missed: labels.expected
      .filter((e) => !matched.has(at(e.file, e.line)))
      .map(({ file, line, issue }) => ({ file, line, issue })),
    findings,
    validCandidates: report.analyzers.reduce((n, a) => n + a.findingCount, 0),
    droppedCandidates: diagnostics.filter((d) => d.startsWith('Dropped ')).length,
    runtimeMs: Math.round(runtimeMs),
  };
}

export interface Metrics {
  cases: number;
  expectedIssues: number;
  findings: number;
  truePositives: number;
  falsePositives: number;
  duplicates: number;
  acceptable: number;
  /** TP / (TP + FP); null when nothing was reported. */
  precision: number | null;
  /** Matched expected issues / all expected issues. */
  recall: number | null;
  recallByGroup: Partial<Record<Group, { found: number; expected: number }>>;
  /** Clean cases with at least one false positive / clean cases. */
  cleanCaseFalsePositiveRate: number | null;
  /** Dropped candidates / (valid + dropped). */
  invalidFindingRate: number | null;
  /** Duplicates / findings. */
  duplicateRate: number | null;
  statuses: Partial<Record<ReviewStatus, number>>;
}

export function summarize(results: readonly CaseResult[]): Metrics {
  const sum = (pick: (r: CaseResult) => number) => results.reduce((n, r) => n + pick(r), 0);
  const ratio = (a: number, b: number) => (b === 0 ? null : round(a / b));

  const tp = sum((r) => r.tp);
  const fp = sum((r) => r.fp);
  const duplicates = sum((r) => r.duplicates);
  const findings = sum((r) => r.findings.length);
  const expected = sum((r) => r.expected);
  const valid = sum((r) => r.validCandidates);
  const dropped = sum((r) => r.droppedCandidates);
  const clean = results.filter((r) => r.group === 'clean');

  const recallByGroup: Metrics['recallByGroup'] = {};
  for (const group of GROUPS) {
    const inGroup = results.filter((r) => r.group === group && r.expected > 0);
    if (inGroup.length === 0) continue;
    recallByGroup[group] = {
      found: inGroup.reduce((n, r) => n + r.expected - r.missed.length, 0),
      expected: inGroup.reduce((n, r) => n + r.expected, 0),
    };
  }
  const statuses: Metrics['statuses'] = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;

  return {
    cases: results.length,
    expectedIssues: expected,
    findings,
    truePositives: tp,
    falsePositives: fp,
    duplicates,
    acceptable: sum((r) => r.acceptable),
    precision: ratio(tp, tp + fp),
    recall: ratio(expected - sum((r) => r.missed.length), expected),
    recallByGroup,
    cleanCaseFalsePositiveRate: ratio(clean.filter((r) => r.fp > 0).length, clean.length),
    invalidFindingRate: ratio(dropped, valid + dropped),
    duplicateRate: ratio(duplicates, findings),
    statuses,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
