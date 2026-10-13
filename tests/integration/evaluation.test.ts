import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createBuiltinRulesAnalyzer } from '../../src/analyzers/builtin-rules/index.js';
import {
  evaluate,
  loadCases,
  renderResults,
  reproducibleView,
  type EvalRun,
} from '../../evaluation/evaluate.js';

/**
 * The published rules-only evaluation must be reproducible from the code:
 * if a rule or a case changes, `npm run eval` has to be re-run and committed.
 */
describe('rules-only evaluation', () => {
  const committed = JSON.parse(
    readFileSync(new URL('../../evaluation/results/rules-only.json', import.meta.url), 'utf8'),
  ) as EvalRun;

  it('loads and validates every case, each with an existing diff', () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(new Set(cases.map((c) => c.labels.group)).size).toBe(7);
  });

  it('matches the committed results and the published page', async () => {
    const run = await evaluate(loadCases(), { analyzers: [createBuiltinRulesAnalyzer()] });
    expect(reproducibleView(run)).toEqual(reproducibleView(committed));
    const page = readFileSync(new URL('../../docs/evaluation.md', import.meta.url), 'utf8');
    expect(page).toContain(renderResults(run));
  });
});
