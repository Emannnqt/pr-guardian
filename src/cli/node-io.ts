import { open } from 'node:fs/promises';

import type { InputResult } from './run.js';

/**
 * Read a diff from a file or stdin without buffering more than `maxBytes + 1`
 * bytes, so an oversized input is rejected without exhausting memory.
 */
export async function readInput(source: string, maxBytes: number): Promise<InputResult> {
  if (source === '-') {
    if (process.stdin.isTTY) {
      return {
        kind: 'error',
        message: 'Expected a diff on stdin (for example: git diff | pr-guardian review -).',
      };
    }
    return readCapped(process.stdin, maxBytes);
  }

  let handle;
  try {
    handle = await open(source, 'r');
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    return { kind: 'error', message: `Cannot read ${JSON.stringify(source)} (${code}).` };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      return { kind: 'error', message: `${JSON.stringify(source)} is not a regular file.` };
    if (stat.size > maxBytes) return { kind: 'too-large', bytes: stat.size };
    return await readCapped(handle.createReadStream(), maxBytes);
  } finally {
    await handle.close();
  }
}

async function readCapped(
  stream: AsyncIterable<Buffer | string>,
  maxBytes: number,
): Promise<InputResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > maxBytes) return { kind: 'too-large', bytes: total };
    chunks.push(buffer);
  }
  return { kind: 'ok', text: Buffer.concat(chunks).toString('utf8') };
}
