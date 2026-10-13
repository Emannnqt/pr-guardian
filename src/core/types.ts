import type { DiffErrorCode } from '../diff/types.js';
import type { EligibleFile, SkippedFile } from '../diff/eligibility.js';
import type { ReviewFinding, Severity } from './schema.js';

/** A changed file the analyzers may inspect. */
export type ReviewFile = EligibleFile;
export type { SkippedFile };

export type ReviewErrorCode =
  DiffErrorCode | 'no-analyzers' | 'all-analyzers-failed' | 'github-api-error';

export interface ReviewError {
  code: ReviewErrorCode;
  message: string;
}

/** `hybrid` adds an AI analyzer to the deterministic rules. */
export type ReviewMode = 'rules-only' | 'hybrid';

export interface InlineCommentsResult {
  posted: number;
  /** An equivalent PR Guardian comment is already on that line. */
  alreadyPresent: number;
  /** The finding has no added line to attach to; it stays in the summary only. */
  noValidLine: number;
  /** Over the per-run cap; summary only. */
  overLimit: number;
  /** Why inline comments were not attempted (e.g. fork PR). */
  unavailable?: string;
  /** Publishing was attempted and failed. */
  error?: string;
}

export interface PullRequestContext {
  number: number;
  headSha: string;
  /** The head branch lives in a fork; the run had a read-only token and no secrets. */
  isFork: boolean;
}

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
  /** Set when the review ran on a GitHub pull request. */
  pullRequest?: PullRequestContext;
  /** Set when inline comments were requested. */
  inlineComments?: InlineCommentsResult;
  status: ReviewStatus;
  /** Present when status is `failed`: why no (complete) analysis happened. */
  error?: ReviewError;
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
