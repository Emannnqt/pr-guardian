import { describe, expect, it } from 'vitest';

import type { Analyzer, AnalyzerOutput } from '../../../src/analyzers/analyzer.js';
import {
  DEFAULT_REVIEW_OPTIONS,
  reviewDiff,
  type ReviewOptions,
} from '../../../src/core/review.js';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 const a = 1;
+const b = 2;
`;

const now = () => new Date('2026-01-01T00:00:00.000Z');
const options: ReviewOptions = { ...DEFAULT_REVIEW_OPTIONS, analyzerTimeoutMs: 50 };

function analyzer(name: string, analyze: Analyzer['analyze']): Analyzer {
  return { name, analyze };
}

const finding = (severity: string, line = 2) => ({
  title: `A ${severity} finding`,
  severity,
  category: 'bug',
  confidence: 0.5,
  filePath: 'src/a.ts',
  startLine: line,
  explanation: 'Why it matters.',
  evidence: 'const b = 2;',
  source: 'static-analysis',
});

const succeeding = (...findings: unknown[]) =>
  analyzer('ok', () => Promise.resolve<AnalyzerOutput>({ status: 'succeeded', findings }));

describe('reviewDiff', () => {
  it('completes when every analyzer succeeds', async () => {
    const report = await reviewDiff(DIFF, options, {
      analyzers: [succeeding(finding('high'))],
      now,
    });
    expect(report.status).toBe('completed');
    expect(report.error).toBeUndefined();
    expect(report.findings).toHaveLength(1);
    expect(report.files.analyzed).toEqual(['src/a.ts']);
    expect(report.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns a failed report (not an exception) for malformed input', async () => {
    const report = await reviewDiff('not a diff', options, { analyzers: [succeeding()], now });
    expect(report.status).toBe('failed');
    expect(report.error?.code).toBe('malformed-diff');
    expect(report.findings).toEqual([]);
  });

  it('fails when no analyzers are configured', async () => {
    const report = await reviewDiff(DIFF, options, { analyzers: [], now });
    expect(report.status).toBe('failed');
    expect(report.error?.code).toBe('no-analyzers');
  });

  it('marks the review partial when one analyzer fails, and failed when all do', async () => {
    const broken = analyzer('broken', () => Promise.reject(new Error('tool crashed')));
    const partial = await reviewDiff(DIFF, options, { analyzers: [succeeding(), broken], now });
    expect(partial.status).toBe('partial');
    expect(partial.analyzers.map((a) => a.status)).toEqual(['succeeded', 'failed']);
    expect(partial.analyzers[1]?.diagnostics).toEqual(['Analyzer error: tool crashed']);
    expect(partial.limitations.join(' ')).toContain('Analyzer broken failed');

    const failed = await reviewDiff(DIFF, options, { analyzers: [broken], now });
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('all-analyzers-failed');
  });

  it('times out hung analyzers and aborts their signal', async () => {
    let aborted = false;
    const hung = analyzer(
      'hung',
      (_input, signal) =>
        new Promise<AnalyzerOutput>(() => {
          signal.addEventListener('abort', () => (aborted = true));
        }),
    );
    const report = await reviewDiff(DIFF, options, { analyzers: [succeeding(), hung], now });
    expect(report.status).toBe('partial');
    expect(report.analyzers[1]?.status).toBe('timed-out');
    expect(aborted).toBe(true);
  });

  it('never reports a skipped analyzer as a clean run', async () => {
    const unavailable = analyzer('semgrep', () =>
      Promise.resolve<AnalyzerOutput>({ status: 'skipped', reason: 'semgrep is not installed' }),
    );
    const report = await reviewDiff(DIFF, options, { analyzers: [succeeding(), unavailable], now });
    expect(report.status).toBe('partial');
    expect(report.analyzers[1]).toMatchObject({
      status: 'skipped',
      diagnostics: ['semgrep is not installed'],
    });
  });

  it('is partial when no file was eligible for analysis', async () => {
    const pythonOnly = DIFF.replaceAll('src/a.ts', 'tool.py');
    const report = await reviewDiff(pythonOnly, options, { analyzers: [succeeding()], now });
    expect(report.status).toBe('partial');
    expect(report.analyzers[0]?.status).toBe('skipped');
    expect(report.limitations[0]).toMatch(/No changed files were eligible/);
  });

  it('drops invalid analyzer output with diagnostics', async () => {
    const report = await reviewDiff(DIFF, options, {
      analyzers: [
        succeeding(
          finding('high'),
          { title: 'junk' },
          { ...finding('high'), filePath: 'other.ts' },
        ),
      ],
      now,
    });
    expect(report.findings).toHaveLength(1);
    expect(report.analyzers[0]?.findingCount).toBe(1);
    expect(report.analyzers[0]?.diagnostics).toHaveLength(2);
  });

  it('counts findings below the severity threshold instead of dropping them silently', async () => {
    const report = await reviewDiff(
      DIFF,
      { ...options, minSeverity: 'medium' },
      { analyzers: [succeeding(finding('high'), finding('low', 1))], now },
    );
    expect(report.findings.map((f) => f.severity)).toEqual(['high']);
    expect(report.belowThresholdCount).toBe(1);
  });
});
