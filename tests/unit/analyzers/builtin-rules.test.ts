import { describe, expect, it } from 'vitest';

import { createBuiltinRulesAnalyzer } from '../../../src/analyzers/builtin-rules/index.js';
import { BUILTIN_RULES } from '../../../src/analyzers/builtin-rules/rules.js';
import { FindingCandidateSchema } from '../../../src/core/schema.js';
import type { ReviewFile } from '../../../src/core/types.js';

async function ruleIdsFor(...lines: string[]): Promise<string[]> {
  const file: ReviewFile = {
    path: 'src/x.ts',
    language: 'typescript',
    skippedLongLines: 0,
    hunks: [],
    addedLines: lines.map((content, i) => ({ line: i + 1, content })),
  };
  const output = await createBuiltinRulesAnalyzer().analyze(
    { files: [file] },
    new AbortController().signal,
  );
  if (output.status !== 'succeeded') throw new Error('expected success');
  return output.findings.map((f) => FindingCandidateSchema.parse(f).ruleId ?? '');
}

const fakeAwsKey = `AKIA${'X'.repeat(16)}`;

const cases: Record<string, { hits: string[]; misses: string[] }> = {
  'builtin/hardcoded-secret': {
    hits: [`const key = '${fakeAwsKey}';`, `// old key: ${fakeAwsKey}`],
    misses: [
      'const key = process.env.AWS_ACCESS_KEY_ID;',
      "const password = 'not-detected-generic';",
    ],
  },
  'builtin/tls-verification-disabled': {
    hits: [
      'new Agent({ rejectUnauthorized: false })',
      "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';",
      "process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';",
    ],
    misses: [
      'new Agent({ rejectUnauthorized: true })',
      '// rejectUnauthorized: false is dangerous',
      "const doc = 'set rejectUnauthorized: false to break TLS';",
      'const s = "process.env.NODE_TLS_REJECT_UNAUTHORIZED = \'0\'";',
    ],
  },
  'builtin/shell-command-interpolation': {
    hits: ['execSync(`git checkout ${branch}`);', 'cp.exec(`ls ${dir}`, cb);'],
    misses: [
      "execFile('git', ['checkout', branch]);",
      'execSync(`git status`);',
      "exec('ls');",
      "const example = 'execSync(`rm ${path}`)';",
    ],
  },
  'builtin/dynamic-code-execution': {
    hits: ['return eval(code);', 'const f = new Function("a", body);', "setTimeout('tick()', 10);"],
    misses: [
      'setTimeout(tick, 10);',
      'page.evaluate(fn);',
      'const evaluation = 1;',
      '// eval(code)',
      'retrieval(x);',
      "expect(run('return eval(code);')).toBe(1);",
      'x = 1; // eval(code)',
    ],
  },
  'builtin/focused-test': {
    hits: [
      "it.only('works', () => {});",
      "describe.only('suite', () => {});",
      "fit('x', () => {});",
      "test.only('x', fn);",
    ],
    misses: [
      "it('works', () => {});",
      'const only = list.only;',
      "profit('x');",
      'const sample = "it.only(\'works\')";',
    ],
  },
  'builtin/debugger-statement': {
    hits: ['debugger;', '  debugger', 'if (x) debugger;'],
    misses: [
      'const debuggerEnabled = true;',
      'logger.debugger();',
      '// debugger;',
      "content: '  debugger;  ',",
    ],
  },
};

describe('built-in rules', () => {
  it('has a test case for every rule', () => {
    expect(Object.keys(cases).sort()).toEqual(BUILTIN_RULES.map((r) => r.id).sort());
  });

  for (const [ruleId, { hits, misses }] of Object.entries(cases)) {
    describe(ruleId, () => {
      it.each(hits)('flags %s', async (line) => {
        expect(await ruleIdsFor(line)).toContain(ruleId);
      });
      it.each(misses)('does not flag %s', async (line) => {
        expect(await ruleIdsFor(line)).not.toContain(ruleId);
      });
    });
  }

  it('emits schema-valid findings that cite the added line', async () => {
    const file: ReviewFile = {
      path: 'src/x.ts',
      language: 'typescript',
      skippedLongLines: 0,
      hunks: [],
      addedLines: [{ line: 42, content: '  debugger;  ' }],
    };
    const output = await createBuiltinRulesAnalyzer().analyze(
      { files: [file] },
      new AbortController().signal,
    );
    expect(output.status).toBe('succeeded');
    if (output.status !== 'succeeded') return;
    const finding = FindingCandidateSchema.parse(output.findings[0]);
    expect(finding).toMatchObject({
      filePath: 'src/x.ts',
      startLine: 42,
      endLine: 42,
      evidence: 'debugger;',
      source: 'static-analysis',
    });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createBuiltinRulesAnalyzer().analyze(
        {
          files: [
            {
              path: 'a.ts',
              language: 'typescript',
              skippedLongLines: 0,
              hunks: [],
              addedLines: [],
            },
          ],
        },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
