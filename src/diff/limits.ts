export interface DiffLimits {
  /** Whole-diff cap, checked before parsing. Exceeding it rejects the input. */
  maxDiffBytes: number;
  /** Maximum files in one diff. Exceeding it rejects the input. */
  maxFiles: number;
  /** Per-file patch cap. Larger files are skipped and the review is marked partial. */
  maxFileBytes: number;
  /** Lines longer than this (e.g. minified code) are not analyzed. */
  maxLineLength: number;
}

export const DEFAULT_DIFF_LIMITS: Readonly<DiffLimits> = {
  maxDiffBytes: 1_000_000,
  maxFiles: 300,
  maxFileBytes: 100_000,
  maxLineLength: 1_000,
};

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
