import { z } from 'zod';

import { AiProviderError, type AiProvider, type AiRequest } from './provider.js';

export interface OllamaOptions {
  /** Base URL, e.g. http://127.0.0.1:11434. Validated by the caller. */
  endpoint: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/**
 * Streamed replies arrive as one JSON line per token, so the raw stream is far
 * larger than the text it carries. The text itself is capped at
 * `maxResponseBytes`; the raw stream gets a generous separate cap.
 */
const RAW_STREAM_FACTOR = 64;

const ChunkSchema = z.object({
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
});

/**
 * Ollama provider using its HTTP chat API with structured outputs
 * (`format` = JSON schema) and temperature 0. The reply is **streamed**:
 * headers arrive immediately, so a slow CPU-only model is limited only by
 * our own timeout (a non-streaming request can exceed fetch's built-in
 * 5-minute wait for response headers). No SDK, no auth headers, redirects
 * refused, text and raw stream both read under byte caps.
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
            stream: true,
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

      return readChatStream(response, request.maxResponseBytes, signal);
    },
  };
}

/** Assemble the model text from Ollama's newline-delimited JSON stream. */
async function readChatStream(
  response: Response,
  maxTextBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) {
    throw new AiProviderError('invalid-response', 'Ollama returned an empty response.');
  }
  // Node's fetch typings expose the body stream as `any`; it yields bytes.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const maxRawBytes = maxTextBytes * RAW_STREAM_FACTOR;
  let rawBytes = 0;
  let textBytes = 0;
  let pending = '';
  let text = '';

  const tooLarge = async (): Promise<never> => {
    await reader.cancel().catch(() => undefined);
    throw new AiProviderError(
      'response-too-large',
      `Model response exceeded ${String(maxTextBytes)} bytes.`,
    );
  };
  /** Add one stream line to `text`; returns true when it is the final chunk. */
  const consume = async (line: string): Promise<boolean> => {
    if (line.trim() === '') return false;
    let chunk: z.infer<typeof ChunkSchema>;
    try {
      chunk = ChunkSchema.parse(JSON.parse(line));
    } catch {
      throw new AiProviderError('invalid-response', 'Ollama returned a malformed stream.');
    }
    // Ollama's own error text is not echoed; it can contain request details.
    if (chunk.error !== undefined) {
      throw new AiProviderError('invalid-response', 'Ollama reported an error while generating.');
    }
    const piece = chunk.message?.content ?? '';
    textBytes += Buffer.byteLength(piece, 'utf8');
    if (textBytes > maxTextBytes) await tooLarge();
    text += piece;
    return chunk.done === true;
  };

  let complete = false;
  try {
    for (;;) {
      const { done: streamEnded, value } = await reader.read();
      if (streamEnded) {
        complete = await consume(pending + decoder.decode());
        break;
      }
      rawBytes += value.byteLength;
      if (rawBytes > maxRawBytes) await tooLarge();
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (await consume(line)) {
          complete = true;
          break;
        }
      }
      if (complete) break;
    }
  } catch (error: unknown) {
    if (error instanceof AiProviderError) throw error;
    if (signal.aborted) throw new AiProviderError('aborted', 'Model request was aborted.');
    throw new AiProviderError(
      'unavailable',
      'Connection to Ollama failed while reading the response.',
    );
  }
  // Stop reading once the final chunk arrived; anything after it is ignored.
  await reader.cancel().catch(() => undefined);

  if (!complete) {
    throw new AiProviderError(
      'invalid-response',
      'Ollama stream ended before the reply was complete.',
    );
  }
  return text;
}

function networkCode(error: unknown): string {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? cause.code : 'network error';
}
