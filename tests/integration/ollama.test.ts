import { afterEach, describe, expect, it } from 'vitest';

import { createOllamaProvider } from '../../src/ai/ollama.js';
import { AiProviderError, type AiRequest } from '../../src/ai/provider.js';
import { ExitCode, run } from '../../src/cli/run.js';
import { chatReply, startFakeOllama, type FakeOllama } from '../helpers/fake-ollama.js';
import { addedFileDiff } from '../helpers/review-files.js';

/**
 * The real Ollama adapter and CLI against a fake Ollama HTTP server on
 * 127.0.0.1. Exercises HTTP, parsing, limits and failure handling without a
 * model; what it cannot tell us is how good a real model's findings are.
 */

let server: FakeOllama | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const request: AiRequest = {
  system: 'system prompt',
  user: 'user prompt',
  maxResponseBytes: 1_000,
  responseSchema: { type: 'object' },
};
const signal = () => new AbortController().signal;

async function errorOf(promise: Promise<unknown>): Promise<AiProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
}

describe('Ollama provider', () => {
  it('sends a non-streaming, schema-constrained chat request and returns the content', async () => {
    server = await startFakeOllama(chatReply('{"findings": []}'));
    const provider = createOllamaProvider({ endpoint: server.endpoint, model: 'qwen2.5-coder:3b' });

    expect(await provider.complete(request, signal())).toBe('{"findings": []}');
    expect(server.requests).toEqual([
      {
        method: 'POST',
        url: '/api/chat',
        body: {
          model: 'qwen2.5-coder:3b',
          stream: true,
          format: { type: 'object' },
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'user prompt' },
          ],
        },
      },
    ]);
  });

  it('reports HTTP errors by status only, with a hint for a missing model', async () => {
    server = await startFakeOllama(chatReply('secret internal error body', 404));
    const provider = createOllamaProvider({ endpoint: server.endpoint, model: 'missing' });
    const error = await errorOf(provider.complete(request, signal()));
    expect(error.code).toBe('http-error');
    expect(error.message).toBe(
      'Ollama returned HTTP 404. Is the model pulled? Try: ollama pull missing',
    );
  });

  it('reports a server that is not running as unavailable', async () => {
    server = await startFakeOllama(chatReply(''));
    const endpoint = server.endpoint;
    await server.close();
    server = undefined;
    const error = await errorOf(
      createOllamaProvider({ endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('unavailable');
    expect(error.message).toMatch(
      /Cannot reach Ollama at http:\/\/127\.0\.0\.1:\d+ \(ECONNREFUSED\)/,
    );
  });

  it('refuses to buffer an oversized response', async () => {
    server = await startFakeOllama(chatReply('x'.repeat(100_000)));
    const error = await errorOf(
      createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('response-too-large');
  });

  it('assembles a streamed reply, even with JSON lines split across network writes', async () => {
    const lines = ['{"findings": ', '[]', '}'].map(
      (content, i, all) =>
        `${JSON.stringify({ message: { content }, done: i === all.length - 1 })}\n`,
    );
    const raw = lines.join('');
    server = await startFakeOllama((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      // Write in awkward fragments to exercise line reassembly.
      const pieces = [raw.slice(0, 7), raw.slice(7, 40), raw.slice(40)];
      let i = 0;
      const next = () => {
        if (i < pieces.length) {
          res.write(pieces[i++]);
          setTimeout(next, 5);
        } else {
          res.end();
        }
      };
      next();
    });
    const provider = createOllamaProvider({ endpoint: server.endpoint, model: 'm' });
    expect(await provider.complete(request, signal())).toBe('{"findings": []}');
  });

  it('rejects a stream that ends before the reply is complete', async () => {
    server = await startFakeOllama((_req, res) => {
      res.end(`${JSON.stringify({ message: { content: '{"find' }, done: false })}\n`);
    });
    const error = await errorOf(
      createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('invalid-response');
    expect(error.message).toMatch(/ended before the reply was complete/);
  });

  it('reports an error line in the stream without echoing it', async () => {
    server = await startFakeOllama((_req, res) => {
      res.end(`${JSON.stringify({ error: 'model runner crashed: secret detail' })}\n`);
    });
    const error = await errorOf(
      createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('invalid-response');
    expect(error.message).not.toContain('secret detail');
  });

  it('rejects a response without message content', async () => {
    server = await startFakeOllama((_req, res) => {
      res.end('{"error": "something"}');
    });
    const error = await errorOf(
      createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('invalid-response');
  });

  it('refuses redirects (a response cannot send the diff elsewhere)', async () => {
    server = await startFakeOllama((_req, res) => {
      res.writeHead(307, { location: 'http://example.invalid/api/chat' });
      res.end();
    });
    const error = await errorOf(
      createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(request, signal()),
    );
    expect(error.code).toBe('unavailable');
  });

  it('aborts a hung request', async () => {
    server = await startFakeOllama(() => undefined); // never responds
    const controller = new AbortController();
    const pending = createOllamaProvider({ endpoint: server.endpoint, model: 'm' }).complete(
      request,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 20);
    expect((await errorOf(pending)).code).toBe('aborted');
  });
});

describe('CLI hybrid mode against the fake server', () => {
  const diff = addedFileDiff('src/a.ts', 'const out = eval(userInput);');
  const aiReply = JSON.stringify({
    findings: [
      {
        title: 'User input evaluated as code',
        severity: 'critical',
        category: 'security',
        confidence: 0.9,
        filePath: 'src/a.ts',
        startLine: 1,
        explanation: 'userInput is executed.',
        evidence: 'eval(userInput)',
      },
    ],
  });

  async function cli(argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, {
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readInput: () => Promise.resolve({ kind: 'ok', text: diff }),
      env: {},
      now: () => new Date(0),
    });
    return { code, stdout: out.join(''), stderr: err.join('') };
  }

  it('reviews with the model and reports provider, model and prompt version', async () => {
    server = await startFakeOllama(chatReply(aiReply));
    const result = await cli([
      'review',
      '-',
      '--mode',
      'hybrid',
      '--ai-model',
      'fake:1b',
      '--ai-endpoint',
      server.endpoint,
    ]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('**Mode:** hybrid');
    expect(result.stdout).toContain(
      '**AI reviewer:** ollama · model `fake:1b` · prompt `review-v1`',
    );
    expect(result.stdout).toContain('User input evaluated as code');
    expect(result.stdout).toContain('**Source:** ai (`ai/review-v1`)');
  });

  it('still produces a rules-only result, marked with limitations, when Ollama is down', async () => {
    server = await startFakeOllama(chatReply(''));
    const endpoint = server.endpoint;
    await server.close();
    server = undefined;
    const result = await cli([
      'review',
      '-',
      '--mode',
      'hybrid',
      '--ai-model',
      'fake:1b',
      '--ai-endpoint',
      endpoint,
    ]);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('⚠️ Completed with limitations');
    expect(result.stdout).toContain('Dynamic code execution');
    expect(result.stdout).toMatch(/ECONNREFUSED/);
  });

  it('makes no network request in the default rules-only mode', async () => {
    server = await startFakeOllama(chatReply(aiReply));
    const result = await cli(['review', '-']);
    expect(result.code).toBe(ExitCode.Success);
    expect(result.stdout).toContain('**Mode:** rules-only');
    expect(server.requests).toEqual([]);
  });
});
