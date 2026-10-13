import { z } from 'zod';

/**
 * Runtime schema for findings (spec §6). Every finding — from a deterministic
 * analyzer now, from a model later — is validated against this schema before
 * it can reach a report. Every string and number is bounded.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const CATEGORIES = [
  'bug',
  'security',
  'performance',
  'testing',
  'maintainability',
  'reliability',
] as const;
export const FINDING_SOURCES = ['static-analysis', 'ai'] as const;

export const SeveritySchema = z.enum(SEVERITIES);
export const CategorySchema = z.enum(CATEGORIES);
export const FindingSourceSchema = z.enum(FINDING_SOURCES);

export type Severity = z.infer<typeof SeveritySchema>;
export type FindingCategory = z.infer<typeof CategorySchema>;
export type FindingSource = z.infer<typeof FindingSourceSchema>;

/** Lower rank = more severe. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const FINDING_LIMITS = {
  pathLength: 1024,
  titleLength: 200,
  explanationLength: 2_000,
  evidenceLength: 2_000,
  suggestedFixLength: 2_000,
  ruleIdLength: 100,
  maxLine: 10_000_000,
} as const;

const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // NUL and other C0 control characters (except tab/newline) are never legitimate here.
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), {
      message: 'must not contain control characters',
    });

const lineNumber = z.number().int().min(1).max(FINDING_LIMITS.maxLine);

/**
 * A finding as produced by an analyzer, before the engine assigns identity.
 * `confidence` is a heuristic in [0, 1], not a calibrated probability.
 */
export const FindingCandidateSchema = z
  .strictObject({
    title: boundedText(FINDING_LIMITS.titleLength),
    severity: SeveritySchema,
    category: CategorySchema,
    confidence: z.number().min(0).max(1),
    filePath: boundedText(FINDING_LIMITS.pathLength),
    startLine: lineNumber.optional(),
    endLine: lineNumber.optional(),
    explanation: boundedText(FINDING_LIMITS.explanationLength),
    evidence: boundedText(FINDING_LIMITS.evidenceLength),
    suggestedFix: boundedText(FINDING_LIMITS.suggestedFixLength).optional(),
    source: FindingSourceSchema,
    ruleId: boundedText(FINDING_LIMITS.ruleIdLength).optional(),
  })
  .refine((f) => f.endLine === undefined || f.startLine !== undefined, {
    message: 'endLine requires startLine',
    path: ['endLine'],
  })
  .refine((f) => f.startLine === undefined || f.endLine === undefined || f.endLine >= f.startLine, {
    message: 'endLine must not precede startLine',
    path: ['endLine'],
  });

export type FindingCandidate = z.infer<typeof FindingCandidateSchema>;

/**
 * A validated, normalized finding. `fingerprint` is stable across line shifts
 * (used for rerun deduplication); `id` additionally pins the location.
 * Both are derived from normalized attributes, never supplied by an analyzer.
 */
export interface ReviewFinding extends FindingCandidate {
  id: string;
  fingerprint: string;
}
