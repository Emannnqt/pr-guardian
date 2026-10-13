/**
 * Port for model providers (spec §8.3). Deliberately narrow: text in, text out.
 * Providers get no tools, no shell and no repository access; everything they
 * return is untrusted and validated by the caller.
 */
export interface AiProvider {
  /** Short provider name, e.g. `ollama`. */
  readonly id: string;
  readonly model: string;
  complete(request: AiRequest, signal: AbortSignal): Promise<string>;
}

export interface AiRequest {
  system: string;
  user: string;
  /** The provider must refuse to buffer a response larger than this. */
  maxResponseBytes: number;
  /** Optional JSON schema for providers that support constrained output. */
  responseSchema?: Readonly<Record<string, unknown>>;
}

export type AiProviderErrorCode =
  'unavailable' | 'http-error' | 'response-too-large' | 'invalid-response' | 'aborted';

/** Messages are safe to show: they never include response bodies or credentials. */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;

  constructor(code: AiProviderErrorCode, message: string) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
  }
}
