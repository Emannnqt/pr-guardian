/**
 * Run the labeled evaluation and publish the results.
 *
 *   npm run eval                                         # rules-only
 *   npm run eval -- --mode hybrid --ai-model qwen2.5-coder:3b [--ai-timeout 900]
 *
 * Writes evaluation/results/<run>.json and updates the matching section of
 * docs/evaluation.md. Use --no-write to only print the metrics.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { createOllamaProvider } from '../src/ai/ollama.js';
import { PROMPT_VERSION } from '../src/ai/prompt.js';
import { createAiAnalyzer, DEFAULT_AI_REVIEW_OPTIONS } from '../src/ai/review-diff.js';
import type { Analyzer } from '../src/analyzers/analyzer.js';
import { createBuiltinRulesAnalyzer } from '../src/analyzers/builtin-rules/index.js';
import { parseAiOptions } from '../src/cli/ai-options.js';
import { evaluate, loadCases, renderResults, replaceSection } from './evaluate.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'rules-only' },
    'ai-model': { type: 'string' },
    'ai-endpoint': { type: 'string' },
    'ai-timeout': { type: 'string', default: '900' },
    'allow-remote-ai': { type: 'boolean', default: false },
    'no-write': { type: 'boolean', default: false },
  },
});

const analyzers: Analyzer[] = [createBuiltinRulesAnalyzer()];
let ai: { provider: string; model: string; promptVersion: string } | undefined;
if (values.mode === 'hybrid') {
  const options = parseAiOptions({
    model: values['ai-model'],
    endpoint: values['ai-endpoint'],
    timeoutSeconds: values['ai-timeout'],
    allowRemote: values['allow-remote-ai'],
  });
  if ('error' in options) throw new Error(options.error);
  const provider = createOllamaProvider({ endpoint: options.endpoint, model: options.model });
  analyzers.push(
    createAiAnalyzer(provider, { ...DEFAULT_AI_REVIEW_OPTIONS, timeoutMs: options.timeoutMs }),
  );
  ai = { provider: provider.id, model: provider.model, promptVersion: PROMPT_VERSION };
} else if (values.mode !== 'rules-only') {
  throw new Error(`Unknown mode ${values.mode}`);
}

const cases = loadCases();
process.stdout.write(`Evaluating ${String(cases.length)} cases (${values.mode})\n`);
const run = await evaluate(cases, {
  analyzers,
  ...(ai ? { ai } : {}),
  onCase: (r) => {
    process.stdout.write(
      `  ${r.id.padEnd(28)} found ${String(r.expected - r.missed.length)}/${String(r.expected)}  fp ${String(r.fp)}  ${r.status.padEnd(9)} ${(r.runtimeMs / 1000).toFixed(1)}s\n`,
    );
  },
});

const section = renderResults(run);
process.stdout.write(`\n${section}\n`);

if (!values['no-write']) {
  const key = ai ? `hybrid-${ai.model.replace(/[^a-z0-9.-]+/gi, '-')}` : 'rules-only';
  writeFileSync(
    new URL(`results/${key}.json`, import.meta.url),
    `${JSON.stringify(run, null, 2)}\n`,
  );
  const docUrl = new URL('../docs/evaluation.md', import.meta.url);
  writeFileSync(
    docUrl,
    replaceSection(readFileSync(docUrl, 'utf8'), ai ? 'hybrid' : 'rules-only', section),
  );
  process.stdout.write(`\nWrote evaluation/results/${key}.json and updated docs/evaluation.md\n`);
}
