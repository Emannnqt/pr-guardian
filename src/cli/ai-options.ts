import { isIP } from 'node:net';

export const DEFAULT_AI_ENDPOINT = 'http://127.0.0.1:11434';
export const DEFAULT_AI_TIMEOUT_SECONDS = 300;
const MAX_AI_TIMEOUT_SECONDS = 3600;

export interface AiCliOptions {
  endpoint: string;
  model: string;
  timeoutMs: number;
}

export interface AiCliInput {
  model: string | undefined;
  endpoint: string | undefined;
  timeoutSeconds: string | undefined;
  allowRemote: boolean;
}

/**
 * Validate hybrid-mode options. The endpoint must be plain http(s) without
 * embedded credentials, and must be loopback unless `--allow-remote-ai` is
 * given: sending source code off this machine has to be an explicit choice.
 */
export function parseAiOptions(input: AiCliInput): AiCliOptions | { error: string } {
  const model = input.model?.trim();
  if (model === undefined || model === '') {
    return { error: 'Hybrid mode needs a model: --ai-model <name> (e.g. qwen2.5-coder:3b).' };
  }
  if (!/^[\w.:/-]{1,200}$/.test(model)) {
    return { error: 'Invalid --ai-model: use letters, digits and . : / _ - only.' };
  }

  let url: URL;
  try {
    url = new URL(input.endpoint ?? DEFAULT_AI_ENDPOINT);
  } catch {
    return { error: 'Invalid --ai-endpoint: not a URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Invalid --ai-endpoint: only http and https are supported.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { error: 'Invalid --ai-endpoint: credentials in the URL are not allowed.' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { error: 'Invalid --ai-endpoint: query strings and fragments are not allowed.' };
  }
  if (!isLoopback(url.hostname) && !input.allowRemote) {
    return {
      error: `--ai-endpoint ${url.host} is not on this machine. Diff content would be sent to it; pass --allow-remote-ai to confirm.`,
    };
  }

  const seconds = Number(input.timeoutSeconds ?? DEFAULT_AI_TIMEOUT_SECONDS);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_AI_TIMEOUT_SECONDS) {
    return {
      error: `Invalid --ai-timeout: use whole seconds from 1 to ${String(MAX_AI_TIMEOUT_SECONDS)}.`,
    };
  }

  return {
    endpoint: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    model,
    timeoutMs: seconds * 1000,
  };
}

export function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return host.startsWith('127.');
  if (isIP(host) === 6) return host === '::1';
  return false;
}
