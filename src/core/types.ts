import type { DiffErrorCode } from '../diff/types.js';
import type { EligibleFile, SkippedFile } from '../diff/eligibility.js';
import type { ReviewFinding, Severity } from './schema.js';

/** A changed file the analyzers may inspect. */
export type ReviewFile = EligibleFile;
export type { SkippedFile };

/** `hybrid` adds an AI analyzer to the deterministic rules. */
export type ReviewMode = 'rules-only' | 'hybrid';

/** Which model reviewed the change (spec FR-7). Present in hybrid mode. */
export interface AiDescriptor {
  provider: string;
  model: string;
  promptVersion: string;
}

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
  /** Present (true) when the analyzer succeeded on only part of its input. */
  incomplete?: true;
}

export interface ReviewReport {
  reviewerVersion: string;
  mode: ReviewMode;
  ai?: AiDescriptor;
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
