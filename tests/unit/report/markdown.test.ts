import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../../../src/core/schema.js';
import type { ReviewReport } from '../../../src/core/types.js';
import { DISCLAIMER, renderMarkdown } from '../../../src/report/markdown.js';

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    reviewerVersion: '0.1.0',
    mode: 'rules-only',
    status: 'completed',
    findings: [],
    minSeverity: 'low',
    belowThresholdCount: 0,
    files: { analyzed: ['src/a.ts'], skipped: [] },
    analyzers: [
      {
        analyzer: 'builtin-rules',
        status: 'succeeded',
        durationMs: 3,
        findingCount: 0,
        diagnostics: [],
      },
    ],
    limitations: [],
    generatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const finding: ReviewFinding = {
  id: 'abc',
  fingerprint: 'def',
  title: 'Dynamic code execution',
  severity: 'medium',
  category: 'security',
  confidence: 0.7,
  filePath: 'src/a.ts',
  startLine: 4,
  endLine: 4,
  explanation: 'Explanation.',
  evidence: 'eval(x)',
  suggestedFix: 'Do not.',
  source: 'static-analysis',
  ruleId: 'builtin/dynamic-code-execution',
};

describe('renderMarkdown', () => {
  it('always includes the disclaimer, even with no findings', () => {
    const md = renderMarkdown(report());
    expect(md).toContain('✅ Completed');
    expect(md).toContain('No findings at or above low severity in 1 analyzed file.');
    expect(md).toContain(DISCLAIMER.slice(0, 40));
  });

  it('distinguishes partial and failed reviews from clean ones', () => {
    expect(renderMarkdown(report({ status: 'partial' }))).toContain(
      '⚠️ Completed with limitations',
    );
    const failed = renderMarkdown(
      report({ status: 'failed', error: { code: 'malformed-diff', message: 'Diff is empty.' } }),
    );
    expect(failed).toContain('❌ Failed');
    expect(failed).toContain('**Review failed:** Diff is empty.');
    expect(failed).not.toContain('No findings at or above');
  });

  it('renders findings with location, provenance, evidence and fix without altering severity', () => {
    const md = renderMarkdown(report({ findings: [finding] }));
    expect(md).toContain('#### Medium (1)');
    expect(md).toContain('##### 1. Dynamic code execution');
    expect(md).toContain('- **Location:** `src/a.ts` line 4');
    expect(md).toContain('**Source:** static-analysis (`builtin/dynamic-code-execution`)');
    expect(md).toContain('```text\neval(x)\n```');
    expect(md).toContain('**Suggested fix:** Do not.');
  });

  it('reports hidden below-threshold findings', () => {
    const md = renderMarkdown(report({ minSeverity: 'high', belowThresholdCount: 2 }));
    expect(md).toContain('2 more below the high severity threshold are not shown.');
  });

  it('lists analyzer status and skipped files', () => {
    const md = renderMarkdown(
      report({
        analyzers: [
          {
            analyzer: 'semgrep',
            status: 'timed-out',
            durationMs: 1,
            findingCount: 0,
            diagnostics: ['slow'],
          },
        ],
        files: { analyzed: [], skipped: [{ path: '.env', reason: 'secret-bearing-path' }] },
      }),
    );
    expect(md).toContain('| `semgrep` | timed out | 0 |');
    expect(md).toContain('- `.env`: may contain secrets; never analyzed');
    expect(md).toContain('- `semgrep`: slow');
  });

  it('does not list durations, so output is stable across runs', () => {
    expect(renderMarkdown(report())).not.toMatch(/\bms\b/);
  });
});
