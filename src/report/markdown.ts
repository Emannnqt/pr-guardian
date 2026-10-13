import { SEVERITIES, type ReviewFinding, type Severity } from '../core/schema.js';
import type { AnalyzerStatus, ReviewReport, ReviewStatus, SkippedFile } from '../core/types.js';
import type { SkipReason } from '../diff/eligibility.js';
import { codeBlock, escapeInline, inlineCode } from './escape.js';

/**
 * Render a validated report as GitHub-flavored Markdown. Formatting only:
 * it never adds claims, changes severity, or drops findings (spec §8.5).
 */

const MAX_LISTED_FILES = 50;

export const DISCLAIMER =
  'PR Guardian is an automated assistant, not an authority. A review with no findings does not mean the code is correct or secure. Confidence values are heuristics, not calibrated probabilities.';

const STATUS_LABEL: Readonly<Record<ReviewStatus, string>> = {
  completed: '✅ Completed',
  partial: '⚠️ Completed with limitations',
  failed: '❌ Failed',
};

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const ANALYZER_STATUS_LABEL: Readonly<Record<AnalyzerStatus, string>> = {
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
  'timed-out': 'timed out',
};

const SKIP_REASON_LABEL: Readonly<Record<SkipReason, string>> = {
  removed: 'file removed',
  binary: 'binary file',
  'secret-bearing-path': 'may contain secrets; never analyzed',
  'excluded-path': 'excluded path',
  'unsupported-language': 'unsupported language',
  'file-too-large': 'exceeds per-file size limit',
  'patch-unavailable': 'no diff available from GitHub (too large?)',
  'no-added-lines': 'no added lines',
};

export interface RenderOptions {
  /** List at most this many findings (most severe first); the rest are counted. */
  maxFindings?: number;
}

export function renderMarkdown(report: ReviewReport, options: RenderOptions = {}): string {
  const out: string[] = [];
  out.push('## PR Guardian review', '');
  out.push(
    `**Status:** ${STATUS_LABEL[report.status]} · **Mode:** ${report.mode} · **Reviewer:** v${escapeInline(report.reviewerVersion)}`,
    '',
  );
  if (report.ai) {
    out.push(
      `**AI reviewer:** ${escapeInline(report.ai.provider)} · model ${inlineCode(report.ai.model)} · prompt ${inlineCode(report.ai.promptVersion)}`,
      '',
    );
  }
  if (report.pullRequest) {
    const pr = report.pullRequest;
    out.push(
      `**Pull request:** #${String(pr.number)} · head ${inlineCode(pr.headSha.slice(0, 12))}${pr.isFork ? ' · from a fork (read-only token)' : ''}`,
      '',
    );
  }

  if (report.error) {
    out.push(`> **Review failed:** ${escapeInline(report.error.message)}`, '');
  }

  out.push(summaryLine(report), '');

  if (report.findings.length > 0) {
    out.push('### Findings', '');
    // Findings are sorted most severe first, so a cap drops the least severe.
    const listed = report.findings.slice(0, options.maxFindings ?? report.findings.length);
    let n = 0;
    for (const severity of SEVERITIES) {
      const group = listed.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      const total = report.findings.filter((f) => f.severity === severity).length;
      out.push(`#### ${SEVERITY_LABEL[severity]} (${String(total)})`, '');
      for (const finding of group) out.push(...renderFinding(++n, finding));
    }
    const unlisted = report.findings.length - listed.length;
    if (unlisted > 0) {
      out.push(
        `> ${String(unlisted)} more finding${unlisted === 1 ? '' : 's'} not shown here to stay within the size limit; see the JSON report.`,
        '',
      );
    }
  }

  if (report.analyzers.length > 0) {
    out.push('### Analyzers', '', '| Analyzer | Status | Findings |', '| --- | --- | --- |');
    for (const run of report.analyzers) {
      out.push(
        `| ${inlineCode(run.analyzer)} | ${ANALYZER_STATUS_LABEL[run.status]} | ${String(run.findingCount)} |`,
      );
    }
    out.push('');
  }

  out.push(...renderFiles(report.files.analyzed, report.files.skipped));

  if (report.limitations.length > 0) {
    out.push('### Limitations', '', ...report.limitations.map((l) => `- ${escapeInline(l)}`), '');
  }

  const diagnostics = report.analyzers.flatMap((run) =>
    run.diagnostics.map((d) => `- ${inlineCode(run.analyzer)}: ${escapeInline(d)}`),
  );
  if (diagnostics.length > 0) {
    out.push('<details><summary>Diagnostics</summary>', '', ...diagnostics, '', '</details>', '');
  }

  out.push(
    '---',
    '',
    `<sub>${escapeInline(DISCLAIMER)} Generated ${escapeInline(report.generatedAt)}.</sub>`,
    '',
  );
  return out.join('\n');
}

function summaryLine(report: ReviewReport): string {
  if (report.status === 'failed')
    return 'No findings are reported because the review did not complete.';

  const files = `${String(report.files.analyzed.length)} analyzed file${report.files.analyzed.length === 1 ? '' : 's'}`;
  const hidden =
    report.belowThresholdCount > 0
      ? ` ${String(report.belowThresholdCount)} more below the ${report.minSeverity} severity threshold ${report.belowThresholdCount === 1 ? 'is' : 'are'} not shown.`
      : '';
  if (report.findings.length === 0) {
    return `No findings at or above ${report.minSeverity} severity in ${files}.${hidden}`;
  }
  const counts = SEVERITIES.map(
    (s) => [s, report.findings.filter((f) => f.severity === s).length] as const,
  )
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${String(c)} ${s}`)
    .join(', ');
  const total = report.findings.length;
  return `${String(total)} finding${total === 1 ? '' : 's'} (${counts}) in ${files}.${hidden}`;
}

function renderFinding(n: number, f: ReviewFinding): string[] {
  const lines: string[] = [];
  lines.push(`##### ${String(n)}. ${escapeInline(f.title)}`, '');
  lines.push(`- **Location:** ${inlineCode(f.filePath)}${locationSuffix(f)}`);
  lines.push(
    `- **Category:** ${f.category} · **Confidence:** ${f.confidence.toFixed(2)} · **Source:** ${f.source}${f.ruleId === undefined ? '' : ` (${inlineCode(f.ruleId)})`}`,
  );
  lines.push('', escapeInline(f.explanation), '', '**Evidence**', '', codeBlock(f.evidence), '');
  if (f.suggestedFix !== undefined) {
    lines.push(`**Suggested fix:** ${escapeInline(f.suggestedFix)}`, '');
  }
  return lines;
}

function locationSuffix(f: ReviewFinding): string {
  if (f.startLine === undefined) return '';
  if (f.endLine === undefined || f.endLine === f.startLine) return ` line ${String(f.startLine)}`;
  return ` lines ${String(f.startLine)}–${String(f.endLine)}`;
}

function renderFiles(analyzed: readonly string[], skipped: readonly SkippedFile[]): string[] {
  const lines = ['### Files', ''];
  lines.push(`Analyzed: ${String(analyzed.length)} · Not analyzed: ${String(skipped.length)}`, '');
  if (skipped.length > 0) {
    lines.push('<details><summary>Files not analyzed</summary>', '');
    for (const file of skipped.slice(0, MAX_LISTED_FILES)) {
      lines.push(`- ${inlineCode(file.path)}: ${SKIP_REASON_LABEL[file.reason]}`);
    }
    if (skipped.length > MAX_LISTED_FILES) {
      lines.push(`- …and ${String(skipped.length - MAX_LISTED_FILES)} more`);
    }
    lines.push('', '</details>', '');
  }
  return lines;
}
