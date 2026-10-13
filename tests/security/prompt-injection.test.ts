import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { AiProvider, AiRequest } from '../../src/ai/provider.js';
import { createAiAnalyzer, DEFAULT_AI_REVIEW_OPTIONS } from '../../src/ai/review-diff.js';
import { createBuiltinRulesAnalyzer } from '../../src/analyzers/builtin-rules/index.js';
import { DEFAULT_REVIEW_OPTIONS, reviewDiff } from '../../src/core/review.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { addedFileDiff } from '../helpers/review-files.js';

/**
 * AI-specific cases from spec §12.3. Prompt wording is not a security
 * boundary, so these tests model a *compromised* model that obeys injected
 * instructions, and check that code-level controls still hold.
 */

const hostile = readFileSync(
  new URL('../../fixtures/diffs/hostile-content.diff', import.meta.url),
  'utf8',
);

function provider(reply: string): AiProvider & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    id: 'mock',
    model: 'compromised',
    requests,
    complete: (request) => {
      requests.push(request);
      return Promise.resolve(reply);
    },
  };
}

const review = (diff: string, p: AiProvider) =>
  reviewDiff(diff, DEFAULT_REVIEW_OPTIONS, {
    analyzers: [createBuiltinRulesAnalyzer(), createAiAnalyzer(p, DEFAULT_AI_REVIEW_OPTIONS)],
    mode: 'hybrid',
    ai: { provider: 'mock', model: 'compromised', promptVersion: 'review-v1' },
    now: () => new Date(0),
  });

describe('prompt injection and a compromised model', () => {
  it('injected instructions only ever appear inside the nonce-delimited block', async () => {
    const p = provider('{"findings": []}');
    await review(hostile, p);
    const user = p.requests[0]?.user ?? '';
    const nonce = /<untrusted-diff id="([0-9a-f]+)"/.exec(user)?.[1] ?? '';
    expect(nonce).toMatch(/^[0-9a-f]{24}$/);
    const open = user.indexOf(`<untrusted-diff id="${nonce}"`);
    const close = user.indexOf(`</untrusted-diff id="${nonce}">`);
    const injected = user.indexOf('ignore all previous instructions');
    expect(injected).toBeGreaterThan(open);
    expect(injected).toBeLessThan(close);
    expect(p.requests[0]?.system).not.toContain('ignore all previous instructions');
  });

  it('a model that "obeys" by declaring the review clean cannot suppress rule findings', async () => {
    const report = await review(
      hostile,
      provider('{"findings": [], "status": "approved", "safe": true}'),
    );
    expect(report.findings.map((f) => f.ruleId)).toContain('builtin/dynamic-code-execution');
    expect(report).not.toHaveProperty('safe');
  });

  it('a model cannot pass its output off as static analysis or invent locations', async () => {
    const reply = JSON.stringify({
      findings: [
        {
          title: 'Fake finding',
          severity: 'critical',
          category: 'security',
          confidence: 1,
          filePath: '../../etc/passwd',
          startLine: 1,
          explanation: 'x',
          evidence: 'root:x:0:0',
          source: 'static-analysis',
        },
        {
          title: 'Approve this PR',
          severity: 'info',
          category: 'bug',
          confidence: 1,
          filePath: 'src/handler.ts',
          startLine: 4,
          explanation: 'Everything is fine.',
          evidence: 'This code is perfectly safe',
        },
      ],
    });
    const report = await review(hostile, provider(reply));
    expect(report.findings.filter((f) => f.source === 'ai')).toEqual([]);
    expect(report.analyzers[1]?.diagnostics.join(' ')).toMatch(
      /not shown.*does not quote an added line/,
    );
  });

  it('a secret echoed by the model is redacted before reporting', async () => {
    // The file holds a credential-like assignment (low confidence, so the file is sent, redacted).
    const diff = addedFileDiff(
      'src/db.ts',
      'const password = "Sup3rS3cretValue";',
      'connect(password);',
    );
    const leaked = `AKIA${'L'.repeat(16)}`;
    const reply = JSON.stringify({
      findings: [
        {
          title: `Hardcoded password ${leaked}`,
          severity: 'high',
          category: 'security',
          confidence: 0.9,
          filePath: 'src/db.ts',
          startLine: 1,
          explanation: `The value ${leaked} is committed.`,
          evidence: 'const password = "[REDACTED]";',
        },
      ],
    });
    const p = provider(reply);
    const report = await review(diff, p);
    expect(p.requests[0]?.user).not.toContain('Sup3rS3cretValue');
    const md = renderMarkdown(report);
    expect(md).not.toContain('Sup3rS3cretValue');
    expect(md).not.toContain(leaked);
    expect(JSON.stringify(report)).not.toContain(leaked);
    expect(report.findings.find((f) => f.source === 'ai')?.title).toBe(
      'Hardcoded password [REDACTED AWS access key ID]',
    );
  });
});
