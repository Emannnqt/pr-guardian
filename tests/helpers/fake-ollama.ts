import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

export interface FakeOllama {
  endpoint: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export type Handler = (req: RecordedRequest, res: ServerResponse) => void;

/** Reply like Ollama's /api/chat with the given model text. */
export function chatReply(content: string, status = 200): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'fake', message: { role: 'assistant', content }, done: true }));
  };
}

/**
 * A local stand-in for the Ollama HTTP API, bound to 127.0.0.1 on a random
 * port. It records every request so tests can assert on what was sent.
 */
export async function startFakeOllama(handler: Handler): Promise<FakeOllama> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
