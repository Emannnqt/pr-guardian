import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { boundaryConfigs } from '../../../eslint/boundaries.js';

// Lint only with the boundary rules so failures here are about architecture,
// not style. Files need not exist: lintText only uses the path for matching.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaryConfigs,
  ],
});

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe('module boundaries', () => {
  describe('domain layers (core, diff, report)', () => {
    it.each(['src/core/review.ts', 'src/diff/parse-diff.ts', 'src/report/markdown.ts'])(
      '%s may not import the GitHub adapter or SDK',
      async (file) => {
        expect(await violations(file, `import { x } from '../github/client.js';`)).toEqual([
          'no-restricted-imports',
        ]);
        expect(await violations(file, `import { Octokit } from '@octokit/rest';`)).toEqual([
          'no-restricted-imports',
        ]);
      },
    );

    it('may depend on ports by type only', async () => {
      const file = 'src/core/review.ts';
      expect(
        await violations(file, `import type { AiProvider } from '../ai/provider.js';`),
      ).toEqual([]);
      expect(
        await violations(file, `import type { Analyzer } from '../analyzers/analyzer.js';`),
      ).toEqual([]);
      expect(await violations(file, `import { OllamaProvider } from '../ai/ollama.js';`)).toEqual([
        'no-restricted-imports',
      ]);
      expect(await violations(file, `import { runEslint } from '../analyzers/eslint.js';`)).toEqual(
        ['no-restricted-imports'],
      );
    });

    it('may not spawn processes, open sockets, or read config/env directly', async () => {
      const file = 'src/core/review.ts';
      expect(await violations(file, `import { spawn } from 'node:child_process';`)).toEqual([
        'no-restricted-imports',
      ]);
      expect(await violations(file, `import https from 'node:https';`)).toEqual([
        'no-restricted-imports',
      ]);
      expect(await violations(file, `import { load } from '../config/load-config.js';`)).toEqual([
        'no-restricted-imports',
      ]);
      expect(await violations(file, `export const t = process.env.GITHUB_TOKEN;`)).toEqual([
        'no-restricted-properties',
      ]);
    });

    it('may import other domain modules', async () => {
      expect(
        await violations(
          'src/core/review.ts',
          `import { parseDiff } from '../diff/parse-diff.js';`,
        ),
      ).toEqual([]);
    });
  });

  it('AI adapters may not execute commands or reach GitHub', async () => {
    const file = 'src/ai/ollama.ts';
    expect(await violations(file, `import { exec } from 'node:child_process';`)).toEqual([
      'no-restricted-imports',
    ]);
    expect(
      await violations(file, `import { publish } from '../github/publish-summary.js';`),
    ).toEqual(['no-restricted-imports']);
  });

  it('AI adapters may implement the analyzer port by type only', async () => {
    const file = 'src/ai/review-diff.ts';
    expect(
      await violations(file, `import type { Analyzer } from '../analyzers/analyzer.js';`),
    ).toEqual([]);
    expect(
      await violations(
        file,
        `import { createBuiltinRulesAnalyzer } from '../analyzers/builtin-rules/index.js';`,
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('analyzers may run tools but not publish or call models', async () => {
    const file = 'src/analyzers/semgrep.ts';
    expect(await violations(file, `import { execFile } from 'node:child_process';`)).toEqual([]);
    expect(
      await violations(file, `import { publish } from '../github/publish-summary.js';`),
    ).toEqual(['no-restricted-imports']);
    expect(await violations(file, `import { review } from '../ai/review-diff.js';`)).toEqual([
      'no-restricted-imports',
    ]);
  });

  it('only the GitHub adapter may use Octokit', async () => {
    const code = `import { Octokit } from '@octokit/core';`;
    expect(await violations('src/github/client.ts', code)).toEqual([]);
    for (const file of ['src/core/review.ts', 'src/ai/ollama.ts', 'src/analyzers/semgrep.ts']) {
      expect(await violations(file, code)).toEqual(['no-restricted-imports']);
    }
  });

  it('the GitHub adapter may not contain review logic', async () => {
    expect(
      await violations('src/github/client.ts', `import { review } from '../ai/review-diff.js';`),
    ).toEqual(['no-restricted-imports']);
  });

  it('only the CLI composition root and config may read the environment', async () => {
    const code = `export const t = process.env.GITHUB_TOKEN;`;
    expect(await violations('src/cli/index.ts', code)).toEqual([]);
    expect(await violations('src/config/load-config.ts', code)).toEqual([]);
    expect(await violations('src/github/client.ts', code)).toEqual(['no-restricted-properties']);
  });

  it('the CLI composition root may wire any layer', async () => {
    const code = [
      `import { review } from '../core/review.js';`,
      `import { OllamaProvider } from '../ai/ollama.js';`,
      `import { publish } from '../github/publish-summary.js';`,
    ].join('\n');
    expect(await violations('src/cli/index.ts', code)).toEqual([]);
  });
});
