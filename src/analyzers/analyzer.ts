import type { ReviewFile } from '../core/types.js';

/**
 * Port for deterministic analyzers (spec §8.2). The orchestrator enforces the
 * timeout and validates every finding, so analyzers return `unknown` findings:
 * nothing an analyzer emits is trusted until it passes the finding schema.
 */
export interface Analyzer {
  readonly name: string;
  analyze(input: AnalyzerInput, signal: AbortSignal): Promise<AnalyzerOutput>;
}

export interface AnalyzerInput {
  /** Eligible files only: supported language, within limits, not secret-bearing. */
  files: readonly ReviewFile[];
}

export type AnalyzerOutput =
  | { status: 'succeeded'; findings: readonly unknown[]; diagnostics?: readonly string[] }
  /** e.g. the tool is not installed. Never reported as a clean run. */
  | { status: 'skipped'; reason: string };
