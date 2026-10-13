import { randomBytes } from 'node:crypto';

import type { Analyzer, AnalyzerInput, AnalyzerOutput } from '../analyzers/analyzer.js';
import { buildAiContext, type OmitReason } from './context.js';
import { buildRepairPrompt, buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt.js';
import type { AiProvider } from './provider.js';
import { AiResponseError, MAX_AI_FINDINGS, parseAiResponse } from './response.js';

export interface AiReviewOptions {
  /** Upper bound on diff text sent to the model. */
  maxContextBytes: number;
  maxResponseBytes: number;
  /** AI findings below this heuristic confidence are dropped. */
  minConfidence: number;
  timeoutMs: number;
}

export const DEFAULT_AI_REVIEW_OPTIONS: Readonly<AiReviewOptions> = {
  maxContextBytes: 48_000,
  maxResponseBytes: 64_000,
  minConfidence: 0.5,
  timeoutMs: 300_000,
};

const OMIT_REASON_LABEL: Readonly<Record<OmitReason, string>> = {
  'contains-secret': 'it contains a possible secret, so it was not sent to the model',
  'context-budget': 'the AI context budget was exhausted',
};

/** JSON schema for providers with constrained decoding; our own parser still decides. */
export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      maxItems: MAX_AI_FINDINGS,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          category: {
            type: 'string',
            enum: ['bug', 'security', 'performance', 'testing', 'maintainability', 'reliability'],
          },
          confidence: { type: 'number' },
          filePath: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          explanation: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: [
          'title',
          'severity',
          'category',
          'confidence',
          'filePath',
          'explanation',
          'evidence',
        ],
      },
    },
  },
  required: ['findings'],
} as const;

/**
 * The AI reviewer as an ordinary analyzer: the orchestrator applies its
 * timeout, validates and redacts its findings, and marks the review partial
 * if it fails, so the deterministic rules remain the fallback.
 */
export function createAiAnalyzer(provider: AiProvider, options: AiReviewOptions): Analyzer {
  const ruleId = `ai/${PROMPT_VERSION}`;
  return {
    name: `ai:${provider.id}/${provider.model}`,
    timeoutMs: options.timeoutMs,
    analyze: async (input: AnalyzerInput, signal: AbortSignal): Promise<AnalyzerOutput> => {
      const context = buildAiContext(input.files, options.maxContextBytes);
      const diagnostics = context.omitted.map(
        (o) => `Not sent to the model: ${o.path} (${OMIT_REASON_LABEL[o.reason]}).`,
      );
      if (context.files.length === 0) {
        return {
          status: 'skipped',
          reason: `No file could be sent to the model. ${diagnostics.join(' ')}`.trim(),
        };
      }

      const nonce = randomBytes(12).toString('hex');
      const user = buildUserPrompt(context.files, nonce);
      const request = {
        system: SYSTEM_PROMPT,
        maxResponseBytes: options.maxResponseBytes,
        responseSchema: AI_RESPONSE_JSON_SCHEMA,
      };
      const parseOptions = {
        maxResponseBytes: options.maxResponseBytes,
        minConfidence: options.minConfidence,
        ruleId,
      };

      let parsed;
      try {
        parsed = parseAiResponse(
          await provider.complete({ ...request, user }, signal),
          context.files,
          parseOptions,
        );
      } catch (error: unknown) {
        if (!(error instanceof AiResponseError)) throw error;
        // One bounded repair attempt. Only our own validation message is added;
        // the rejected output is never echoed back into the conversation.
        diagnostics.push(`First model response rejected (${error.message}); retried once.`);
        const repaired = await provider.complete(
          { ...request, user: `${user}\n\n${buildRepairPrompt(error.message)}` },
          signal,
        );
        try {
          parsed = parseAiResponse(repaired, context.files, parseOptions);
        } catch (retryError: unknown) {
          if (retryError instanceof AiResponseError) {
            throw new Error(`Model response rejected after one retry: ${retryError.message}.`, {
              cause: retryError,
            });
          }
          throw retryError;
        }
      }

      // Context omissions mean part of the change was not reviewed by the model.
      if (context.omitted.length > 0) {
        diagnostics.push(
          `The model reviewed ${String(context.files.length)} of ${String(context.files.length + context.omitted.length)} eligible files.`,
        );
      }
      return {
        status: 'succeeded',
        findings: parsed.findings,
        diagnostics: [...diagnostics, ...parsed.diagnostics],
        ...(context.omitted.length > 0 ? { incomplete: true } : {}),
      };
    },
  };
}
