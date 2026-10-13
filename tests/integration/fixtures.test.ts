import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createBuiltinRulesAnalyzer } from '../../src/analyzers/builtin-rules/index.js';
import { DEFAULT_REVIEW_OPTIONS, reviewDiff } from '../../src/core/review.js';
import { renderMarkdown } from '../../src/report/markdown.js';

/**
 * Golden-file tests: each fixture diff is reviewed end to end with the real
 * rule set, and the Markdown and JSON reports must match the committed
 * expected output exactly. Update with `npx vitest run -u` and review the diff.
 */
const FIXTURES = new URL('../../fixtures/', import.meta.url);
const names = readdirSync(new URL('diffs/', FIXTURES))
  .filter((f) => f.endsWith('.diff'))
  .map((f) => f.slice(0, -'.diff'.length))
  .sort();

const deps = () => ({
  analyzers: [createBuiltinRulesAnalyzer()],
  now: () => new Date('2026-01-01T00:00:00.000Z'),
  clock: () => 0,
});

describe('fixture reviews', () => {
  it('has fixtures', () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it.each(names)('%s produces the expected report', async (name) => {
    const diff = readFileSync(new URL(`diffs/${name}.diff`, FIXTURES), 'utf8');
    const report = await reviewDiff(diff, DEFAULT_REVIEW_OPTIONS, deps());

    await expect(renderMarkdown(report)).toMatchFileSnapshot(
      `../../fixtures/expected-reports/${name}.md`,
    );
    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(
      `../../fixtures/expected-reports/${name}.json`,
    );
  });

  it.each(names)('%s is reviewed identically on every run', async (name) => {
    const diff = readFileSync(new URL(`diffs/${name}.diff`, FIXTURES), 'utf8');
    const first = await reviewDiff(diff, DEFAULT_REVIEW_OPTIONS, deps());
    const second = await reviewDiff(diff, DEFAULT_REVIEW_OPTIONS, deps());
    expect(renderMarkdown(second)).toBe(renderMarkdown(first));
  });
});
