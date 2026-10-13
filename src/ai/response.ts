import { z } from 'zod';

import { byteLength } from '../diff/limits.js';
import { CategorySchema, SeveritySchema } from '../core/schema.js';
import type { ContextFile } from './context.js';

export const MAX_AI_FINDINGS = 20;
const MIN_EVIDENCE_CHARS = 4;

/** The whole response is unusable (worth one repair attempt). Message is safe to send back. */
export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiResponseError';
  }
}

const EnvelopeSchema = z.object({ findings: z.array(z.unknown()).max(MAX_AI_FINDINGS) });

/**
 * Fields a model may supply. Unknown keys (including any attempt to set
 * `source`, `ruleId` or `id`) are discarded; length limits are enforced again
 * by the shared finding schema during normalization.
 */
const AiFindingSchema = z.object({
  title: z.string().max(500),
  severity: SeveritySchema,
  category: CategorySchema,
  confidence: z.number().min(0).max(1),
  filePath: z.string().max(1024),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  explanation: z.string().max(4000),
  evidence: z.string().max(4000),
  suggestedFix: z.string().max(4000).optional(),
});

export interface ParseOptions {
  maxResponseBytes: number;
  minConfidence: number;
  ruleId: string;
}

export interface ParsedAiResponse {
  /** Candidates for the shared finding pipeline; still validated there. */
  findings: unknown[];
  diagnostics: string[];
}

/**
 * Parse and ground a model response against exactly what the model was shown.
 * Throws AiResponseError when the response as a whole is unusable; individual
 * findings that fail validation or grounding are dropped with a diagnostic.
 */
export function parseAiResponse(
  raw: string,
  shown: readonly ContextFile[],
  options: ParseOptions,
): ParsedAiResponse {
  if (byteLength(raw) > options.maxResponseBytes) {
    throw new AiResponseError(`response exceeds ${String(options.maxResponseBytes)} bytes`);
  }

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw.trim()));
  } catch {
    throw new AiResponseError('response is not valid JSON');
  }
  const envelope = EnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new AiResponseError(
      `response must be an object with a "findings" array of at most ${String(MAX_AI_FINDINGS)} items`,
    );
  }

  const files = new Map(shown.map((f) => [f.path, f]));
  const result: ParsedAiResponse = { findings: [], diagnostics: [] };
  const drop = (n: number, why: string) =>
    result.diagnostics.push(`Dropped AI finding #${String(n)}: ${why}.`);

  envelope.data.findings.forEach((item, index) => {
    const n = index + 1;
    const parsed = AiFindingSchema.safeParse(item);
    if (!parsed.success) {
      drop(n, `invalid fields (${parsed.error.issues.map((i) => i.path.join('.')).join(', ')})`);
      return;
    }
    const finding = parsed.data;

    const file = files.get(finding.filePath);
    if (file === undefined) {
      drop(n, 'it references a file the model was not shown');
      return;
    }
    if (finding.confidence < options.minConfidence) {
      drop(
        n,
        `confidence ${finding.confidence.toFixed(2)} is below ${options.minConfidence.toFixed(2)}`,
      );
      return;
    }

    const evidence = normalize(finding.evidence);
    const addedMatches = [...file.addedLines].filter((line) =>
      normalize(file.shownLines.get(line) ?? '').includes(evidence),
    );
    if (evidence.length < MIN_EVIDENCE_CHARS || addedMatches.length === 0) {
      drop(n, 'its evidence does not quote an added line of the diff');
      return;
    }

    // Keep the cited line only if it is an added line containing the evidence;
    // otherwise use the single added line that does, or drop the location.
    let line: number | undefined;
    if (finding.startLine !== undefined && addedMatches.includes(finding.startLine)) {
      line = finding.startLine;
    } else if (addedMatches.length === 1) {
      line = addedMatches[0];
      if (finding.startLine !== undefined) {
        result.diagnostics.push(
          `AI finding #${String(n)}: cited line ${String(finding.startLine)} corrected to ${String(line)} from its evidence.`,
        );
      }
    } else {
      result.diagnostics.push(
        `AI finding #${String(n)}: line reference could not be verified and was removed.`,
      );
    }

    result.findings.push({
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      confidence: finding.confidence,
      filePath: file.path,
      ...(line === undefined ? {} : { startLine: line, endLine: line }),
      explanation: finding.explanation,
      evidence: finding.evidence.trim(),
      ...(finding.suggestedFix?.trim() ? { suggestedFix: finding.suggestedFix } : {}),
      source: 'ai',
      ruleId: options.ruleId,
    });
  });

  return result;
}

/** Accept a single ```json fenced block, which many models add despite instructions. */
function stripCodeFence(text: string): string {
  const match = /^```(?:json)?[ \t]*\n([\s\S]*)\n```$/.exec(text);
  return match?.[1] ?? text;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
