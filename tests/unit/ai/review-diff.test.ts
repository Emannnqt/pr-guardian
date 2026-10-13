import { describe, expect, it } from 'vitest';

import { AiProviderError, type AiProvider, type AiRequest } from '../../../src/ai/provider.js';
import { createAiAnalyzer, DEFAULT_AI_REVIEW_OPTIONS } from '../../../src/ai/review-diff.js';
import { createBuiltinRulesAnalyzer } from '../../../src/analyzers/builtin-rules/index.js';
import { DEFAULT_REVIEW_OPTIONS, reviewDiff } from '../../../src/core/review.js';
import { addedFileDiff } from '../../helpers/review-files.js';

const DIFF = addedFileDiff(
  'src/users.ts',
  'export function getUser(id: string) {',
  '  return db.query(`SELECT * FROM users WHERE id = ${id}`);',
  '}',
  'debugger;',
);

const sqlFinding = {
  title: 'SQL injection',
  severity: 'high',
  category: 'security',
  confidence: 0.85,
  filePath: 'src/users.ts',
  startLine: 2,
  explanation: 'The id is interpolated into SQL.',
  evidence: 'db.query(`SELECT * FROM users WHERE id = ${id}`)',
  suggestedFix: 'Use a parameterized query.',
};

/** A scripted provider: returns (or throws) the queued replies in order. */
function mockProvider(...replies: (string | Error)[]): AiProvider & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    id: 'mock',
    model: 'mock-1',
    requests,
    complete: (request) => {
      requests.push(request);
      const reply = replies.shift();
      if (reply === undefined) return Promise.reject(new Error('no reply queued'));
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
}

const json = (findings: unknown[]) => JSON.stringify({ findings });

async function hybridReview(provider: AiProvider, diff = DIFF) {
  return reviewDiff(diff, DEFAULT_REVIEW_OPTIONS, {
    analyzers: [
      createBuiltinRulesAnalyzer(),
      createAiAnalyzer(provider, DEFAULT_AI_REVIEW_OPTIONS),
    ],
    mode: 'hybrid',
    ai: { provider: provider.id, model: provider.model, promptVersion: 'review-v1' },
    now: () => new Date(0),
    clock: () => 0,
  });
}

describe('AI analyzer in a hybrid review', () => {
  it('merges validated AI findings with rule findings', async () => {
    const report = await hybridReview(mockProvider(json([sqlFinding])));
    expect(report.status).toBe('completed');
    expect(report.mode).toBe('hybrid');
    expect(report.ai).toEqual({ provider: 'mock', model: 'mock-1', promptVersion: 'review-v1' });
    expect(report.findings.map((f) => [f.source, f.ruleId])).toEqual([
      ['ai', 'ai/review-v1'],
      ['static-analysis', 'builtin/debugger-statement'],
    ]);
    expect(report.analyzers.map((a) => [a.analyzer, a.status])).toEqual([
      ['builtin-rules', 'succeeded'],
      ['ai:mock/mock-1', 'succeeded'],
    ]);
  });

  it('sends the system prompt, a JSON schema and a size cap', async () => {
    const provider = mockProvider(json([]));
    await hybridReview(provider);
    const [request] = provider.requests;
    expect(request?.system).toContain('PR Guardian');
    expect(request?.user).toContain('+  return db.query(');
    expect(request?.maxResponseBytes).toBe(DEFAULT_AI_REVIEW_OPTIONS.maxResponseBytes);
    expect(request?.responseSchema).toMatchObject({ required: ['findings'] });
  });

  it('retries once after an invalid response, without echoing it back', async () => {
    const provider = mockProvider('I think the code looks fine!', json([sqlFinding]));
    const report = await hybridReview(provider);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.user).toContain('Problem: response is not valid JSON');
    expect(provider.requests[1]?.user).not.toContain('looks fine');
    expect(report.status).toBe('completed');
    expect(report.findings.some((f) => f.source === 'ai')).toBe(true);
  });

  it('fails the AI analyzer (review partial, rules kept) when the retry is also invalid', async () => {
    const report = await hybridReview(mockProvider('nope', '{"findings": "still nope"}'));
    expect(report.status).toBe('partial');
    expect(report.analyzers[1]).toMatchObject({ status: 'failed' });
    expect(report.analyzers[1]?.diagnostics.join(' ')).toMatch(/rejected after one retry/);
    expect(report.findings.map((f) => f.ruleId)).toEqual(['builtin/debugger-statement']);
  });

  it('falls back to rules when the provider is unavailable — never a clean review', async () => {
    const report = await hybridReview(
      mockProvider(
        new AiProviderError(
          'unavailable',
          'Cannot reach Ollama at http://127.0.0.1:11434 (ECONNREFUSED).',
        ),
      ),
    );
    expect(report.status).toBe('partial');
    expect(report.analyzers[1]?.status).toBe('failed');
    expect(report.limitations.join(' ')).toMatch(/ai:mock\/mock-1 failed/);
    expect(report.findings.map((f) => f.ruleId)).toEqual(['builtin/debugger-statement']);
  });

  it('times out a hung model using its own timeout', async () => {
    const hung: AiProvider = {
      id: 'mock',
      model: 'slow',
      complete: () => new Promise(() => undefined),
    };
    const report = await reviewDiff(DIFF, DEFAULT_REVIEW_OPTIONS, {
      analyzers: [createAiAnalyzer(hung, { ...DEFAULT_AI_REVIEW_OPTIONS, timeoutMs: 20 })],
      now: () => new Date(0),
    });
    expect(report.analyzers[0]).toMatchObject({
      status: 'timed-out',
      diagnostics: ['Timed out after 20 ms.'],
    });
    expect(report.status).toBe('failed');
  });

  it('is skipped (not called) when every file holds a secret, and the review is partial', async () => {
    const provider = mockProvider(json([]));
    const report = await hybridReview(
      provider,
      addedFileDiff('src/k.ts', `const k = 'AKIA${'Z'.repeat(16)}';`),
    );
    expect(provider.requests).toHaveLength(0);
    expect(report.analyzers[1]).toMatchObject({ status: 'skipped' });
    expect(report.status).toBe('partial');
  });

  it('marks the review partial when some files were withheld from the model', async () => {
    const diff = DIFF + addedFileDiff('src/k.ts', `const k = 'AKIA${'Z'.repeat(16)}';`);
    const provider = mockProvider(json([]));
    const report = await hybridReview(provider, diff);
    expect(provider.requests[0]?.user).not.toContain('src/k.ts');
    expect(report.analyzers[1]).toMatchObject({ status: 'succeeded', incomplete: true });
    expect(report.status).toBe('partial');
    expect(report.limitations.join(' ')).toMatch(/could not analyze every eligible file/);
  });
});
