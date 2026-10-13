import type { DiffErrorCode } from '../diff/types.js';
import type { EligibleFile, SkippedFile } from '../diff/eligibility.js';
import type { ReviewFinding, Severity } from './schema.js';

/** A changed file the analyzers may inspect. */
export type ReviewFile = EligibleFile;
export type { SkippedFile };

/** Only rules-only exists today; `hybrid` arrives with the AI adapter (Milestone 3). */
export type ReviewMode = 'rules-only';

/**
 * Whether analysis completed. Rendered as "Completed", "Completed with
 * limitations" and "Failed". A partial or failed review must never be
 * presented as a clean one (spec §16.5 step 11).
 */
export type ReviewStatus = 'completed' | 'partial' | 'failed';

/** `skipped` covers "tool unavailable"; the reason is in `diagnostics`. */
export type AnalyzerStatus = 'succeeded' | 'failed' | 'skipped' | 'timed-out';

export interface AnalyzerRun {
  analyzer: string;
  status: AnalyzerStatus;
  durationMs: number;
  /** Findings that passed validation, before deduplication and threshold filtering. */
  findingCount: number;
  diagnostics: string[];
}

export interface ReviewReport {
  reviewerVersion: string;
  mode: ReviewMode;
  status: ReviewStatus;
  /** Present when status is `failed` because the input was rejected. */
  error?: { code: DiffErrorCode | 'no-analyzers' | 'all-analyzers-failed'; message: string };
  /** Findings at or above `minSeverity`, most severe first. */
  findings: ReviewFinding[];
  minSeverity: Severity;
  /** Valid findings below `minSeverity`; counted, never silently dropped. */
  belowThresholdCount: number;
  files: {
    analyzed: string[];
    skipped: SkippedFile[];
  };
  analyzers: AnalyzerRun[];
  limitations: string[];
  generatedAt: string;
}
