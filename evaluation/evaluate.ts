import { readdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';

import type { Analyzer } from '../src/analyzers/analyzer.js';
import { DEFAULT_REVIEW_OPTIONS, reviewDiff, type ReviewDependencies } from '../src/core/review.js';
import { VERSION } from '../src/version.js';
import {
  CaseLabelsSchema,
  scoreCase,
  summarize,
  type CaseLabels,
  type CaseResult,
  type Metrics,
} from './metrics.js';

export const CASES_DIR = new URL('cases/', import.meta.url);

export interface EvalCase {
  labels: CaseLabels;
  diff: string;
}

/** Load and validate every case; a malformed label file fails loudly. */
export function loadCases(dir: URL = CASES_DIR): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const labels = CaseLabelsSchema.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      if (`${labels.id}.json` !== f)
        throw new Error(`Case id ${labels.id} does not match file ${f}`);
      return { labels, diff: readFileSync(new URL(`${labels.id}.diff`, dir), 'utf8') };
    });
}

export interface EvalRun {
  mode: 'rules-only' | 'hybrid';
  ai?: { provider: string; model: string; promptVersion: string };
  reviewerVersion: string;
  metrics: Metrics;
  cases: CaseResult[];
  /** Varies between runs and machines; excluded from reproducibility checks. */
  runtime: { meanMs: number; maxMs: number; totalMs: number };
  environment: { date: string; node: string; platform: string; cpu: string; cpuCount: number };
}

export interface EvalOptions {
  analyzers: readonly Analyzer[];
  ai?: ReviewDependencies['ai'];
  onCase?: (result: CaseResult) => void;
}

/** Review every case with the given analyzers and score the reports against the labels. */
export async function evaluate(cases: readonly EvalCase[], options: EvalOptions): Promise<EvalRun> {
  const results: CaseResult[] = [];
  for (const { labels, diff } of cases) {
    const started = performance.now();
    const report = await reviewDiff(
      diff,
      // List every finding, including info, so nothing is hidden from scoring.
      { ...DEFAULT_REVIEW_OPTIONS, minSeverity: 'info' },
      {
        analyzers: options.analyzers,
        mode: options.ai ? 'hybrid' : 'rules-only',
        ...(options.ai ? { ai: options.ai } : {}),
      },
    );
    const result = scoreCase(labels, report, performance.now() - started);
    results.push(result);
    options.onCase?.(result);
  }

  const times = results.map((r) => r.runtimeMs);
  const totalMs = times.reduce((a, b) => a + b, 0);
  return {
    mode: options.ai ? 'hybrid' : 'rules-only',
    ...(options.ai ? { ai: options.ai } : {}),
    reviewerVersion: VERSION,
    metrics: summarize(results),
    cases: results,
    runtime: {
      meanMs: results.length === 0 ? 0 : Math.round(totalMs / results.length),
      maxMs: Math.max(0, ...times),
      totalMs,
    },
    environment: {
      date: new Date().toISOString().slice(0, 10),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: cpus()[0]?.model.trim() ?? 'unknown',
      cpuCount: cpus().length,
    },
  };
}

/** The run without fields that legitimately vary between runs (timings, environment). */
export function reproducibleView(run: EvalRun): unknown {
  return {
    mode: run.mode,
    ai: run.ai,
    reviewerVersion: run.reviewerVersion,
    metrics: run.metrics,
    cases: run.cases.map((c) => ({ ...c, runtimeMs: 0 })),
  };
}

const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`);

/** Markdown results section for docs/evaluation.md (timings only for hybrid runs). */
export function renderResults(run: EvalRun): string {
  const m = run.metrics;
  const title =
    run.mode === 'hybrid' && run.ai
      ? `Hybrid: built-in rules + ${run.ai.provider} \`${run.ai.model}\` (prompt \`${run.ai.promptVersion}\`)`
      : 'Rules-only (built-in rules)';
  const lines = [
    `#### ${title}`,
    '',
    `Reviewer v${run.reviewerVersion} · ${String(m.cases)} cases · ${String(m.expectedIssues)} labeled issues${run.mode === 'hybrid' ? ` · run on ${run.environment.date}, ${run.environment.cpu} (${String(run.environment.cpuCount)} threads), Node ${run.environment.node}` : ''}`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Precision | ${pct(m.precision)} (${String(m.truePositives)} correct / ${String(m.truePositives + m.falsePositives)} scored findings) |`,
    `| Recall | ${pct(m.recall)} (${String(m.expectedIssues - run.cases.reduce((n, c) => n + c.missed.length, 0))} of ${String(m.expectedIssues)} labeled issues found) |`,
    `| Clean-case false-positive rate | ${pct(m.cleanCaseFalsePositiveRate)} |`,
    `| Invalid-finding rate | ${pct(m.invalidFindingRate)} |`,
    `| Duplicate rate | ${pct(m.duplicateRate)} |`,
    `| Findings on debatable lines (not scored) | ${String(m.acceptable)} |`,
    `| Review status | ${Object.entries(m.statuses)
      .map(([s, n]) => `${s}: ${String(n)}`)
      .join(', ')} |`,
  ];
  if (run.mode === 'hybrid') {
    lines.push(
      `| Runtime per case | mean ${(run.runtime.meanMs / 1000).toFixed(1)} s, max ${(run.runtime.maxMs / 1000).toFixed(1)} s |`,
    );
  }
  lines.push('', '| Group | Found / labeled |', '| --- | --- |');
  for (const [group, r] of Object.entries(m.recallByGroup)) {
    lines.push(`| ${group} | ${String(r.found)} / ${String(r.expected)} |`);
  }
  lines.push(
    '',
    '<details><summary>Per-case results</summary>',
    '',
    '| Case | Group | Labeled | Found | False positives | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const c of run.cases) {
    lines.push(
      `| \`${c.id}\` | ${c.group} | ${String(c.expected)} | ${String(c.expected - c.missed.length)} | ${String(c.fp)} | ${c.status} |`,
    );
  }
  lines.push('', '</details>');
  return lines.join('\n');
}

/** Replace the text between `<!-- results:<key>:start -->` and `<!-- results:<key>:end -->`. */
export function replaceSection(document: string, key: string, content: string): string {
  const start = `<!-- results:${key}:start -->`;
  const end = `<!-- results:${key}:end -->`;
  const i = document.indexOf(start);
  const j = document.indexOf(end);
  if (i === -1 || j < i) throw new Error(`Markers for "${key}" not found`);
  return `${document.slice(0, i + start.length)}\n\n${content}\n\n${document.slice(j)}`;
}
