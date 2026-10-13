import { z } from 'zod';

import { AiProviderError, type AiProvider, type AiRequest } from './provider.js';

export interface OllamaOptions {
  /** Base URL, e.g. http://127.0.0.1:11434. Validated by the caller. */
  endpoint: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/** The chat envelope wraps the model text; allow for JSON escaping overhead. */
const ENVELOPE_OVERHEAD_BYTES = 16_384;

const ChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
});

/**
 * Ollama provider using its HTTP chat API with structured outputs
 * (`format` = JSON schema), non-streaming, temperature 0. No SDK, no auth
 * headers, redirects refused, response body read under a byte cap.
 */
export function createOllamaProvider(options: OllamaOptions): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.endpoint.replace(/\/+$/, '')}/api/chat`;
  const origin = new URL(options.endpoint).origin;

  return {
    id: 'ollama',
    model: options.model,
    complete: async (request: AiRequest, signal: AbortSignal): Promise<string> => {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          redirect: 'error',
          signal,
          body: JSON.stringify({
            model: options.model,
            stream: false,
            format: request.responseSchema ?? 'json',
            options: { temperature: 0 },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          }),
        });
      } catch (error: unknown) {
        if (signal.aborted) throw new AiProviderError('aborted', 'Model request was aborted.');
        throw new AiProviderError(
          'unavailable',
          `Cannot reach Ollama at ${origin} (${networkCode(error)}). Is it running?`,
        );
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const hint =
          response.status === 404 ? ` Is the model pulled? Try: ollama pull ${options.model}` : '';
        throw new AiProviderError(
          'http-error',
          `Ollama returned HTTP ${String(response.status)}.${hint}`,
        );
      }

      const body = await readCapped(
        response,
        request.maxResponseBytes + ENVELOPE_OVERHEAD_BYTES,
        signal,
      );
      let envelope: unknown;
      try {
        envelope = JSON.parse(body);
      } catch {
        throw new AiProviderError(
          'invalid-response',
          'Ollama returned a response that is not JSON.',
        );
      }
      const parsed = ChatResponseSchema.safeParse(envelope);
      if (!parsed.success) {
        throw new AiProviderError('invalid-response', 'Ollama response has no message content.');
      }
      return parsed.data.message.content;
    },
  };
}

async function readCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) return '';
  // Node's fetch typings expose the body stream as `any`; it yields bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiProviderError(
          'response-too-large',
          `Model response exceeded ${String(maxBytes)} bytes.`,
        );
      }
      chunks.push(value);
    }
  } catch (error: unknown) {
    if (error instanceof AiProviderError) throw error;
    if (signal.aborted) throw new AiProviderError('aborted', 'Model request was aborted.');
    throw new AiProviderError(
      'unavailable',
      'Connection to Ollama failed while reading the response.',
    );
  }
  return Buffer.concat(chunks).toString('utf8');
}

function networkCode(error: unknown): string {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? cause.code : 'network error';
}
