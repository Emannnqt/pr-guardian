import { appendFile } from 'node:fs/promises';

import type { ReviewReport } from '../core/types.js';
import { byteLength } from '../diff/limits.js';
import { renderMarkdown } from '../report/markdown.js';

/** GitHub rejects step summaries over 1 MiB; keep a margin. */
export const JOB_SUMMARY_MAX_BYTES = 1024 * 1024 - 16 * 1024;

/**
 * Render the report to fit the job summary limit. Findings are dropped from the
 * listing (least severe first, with a note pointing to the JSON report) rather
 * than cutting text mid-element, so the summary always stays well-formed.
 */
export function renderJobSummary(report: ReviewReport, maxBytes = JOB_SUMMARY_MAX_BYTES): string {
  let markdown = renderMarkdown(report);
  let maxFindings = report.findings.length;
  while (byteLength(markdown) > maxBytes && maxFindings > 0) {
    maxFindings = Math.floor(maxFindings / 2);
    markdown = renderMarkdown(report, { maxFindings });
  }
  return markdown;
}

/** Append to the file named by GITHUB_STEP_SUMMARY. Needs no token permissions. */
export async function writeJobSummary(report: ReviewReport, summaryPath: string): Promise<void> {
  await appendFile(summaryPath, `${renderJobSummary(report)}\n`, 'utf8');
}
