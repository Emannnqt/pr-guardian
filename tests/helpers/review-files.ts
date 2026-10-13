import type { ReviewFile } from '../../src/core/types.js';
import { classifyFiles, DEFAULT_ELIGIBILITY_POLICY } from '../../src/diff/eligibility.js';
import { DEFAULT_DIFF_LIMITS } from '../../src/diff/limits.js';
import { parseUnifiedDiff } from '../../src/diff/parse-diff.js';

/** Eligible review files from a diff, exactly as the engine would produce them. */
export function reviewFilesFromDiff(diff: string): ReviewFile[] {
  const files = parseUnifiedDiff(diff, DEFAULT_DIFF_LIMITS);
  return classifyFiles(files, DEFAULT_ELIGIBILITY_POLICY, DEFAULT_DIFF_LIMITS).eligible;
}

/** A diff that adds one file with the given lines. */
export function addedFileDiff(path: string, ...lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map((l) => `+${l}`),
    '',
  ].join('\n');
}
