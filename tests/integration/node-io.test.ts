import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readInput } from '../../src/cli/node-io.js';

const dir = mkdtempSync(join(tmpdir(), 'pr-guardian-io-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readInput', () => {
  it('reads a file within the limit', async () => {
    const path = join(dir, 'ok.diff');
    writeFileSync(path, 'hello');
    expect(await readInput(path, 10)).toEqual({ kind: 'ok', text: 'hello' });
  });

  it('refuses files over the limit without reading them', async () => {
    const path = join(dir, 'big.diff');
    writeFileSync(path, 'x'.repeat(100));
    expect(await readInput(path, 10)).toEqual({ kind: 'too-large', bytes: 100 });
  });

  it('reports missing files and directories as errors', async () => {
    expect(await readInput(join(dir, 'missing.diff'), 10)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('ENOENT') as unknown,
    });
    expect(await readInput(dir, 10)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('not a regular file') as unknown,
    });
  });
});
