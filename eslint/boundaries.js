// @ts-check
/**
 * Architectural module boundaries for PR Guardian (spec §8, §16.4).
 *
 * The layers are enforced with lint rules instead of empty placeholder
 * directories, so the rules hold from the first file that lands in each layer:
 *
 *   cli/        composition root: the only layer allowed to wire adapters together
 *   github/     GitHub adapter: translates GitHub data <-> domain model
 *   ai/         model provider adapters: no shell, no GitHub
 *   analyzers/  deterministic tool adapters: no GitHub, no AI
 *   config/     configuration and environment parsing
 *   core/ diff/ report/  pure domain logic: no I/O SDKs, depends on ports by type only
 *
 * ESLint does not merge `no-restricted-imports` options across config objects
 * (the last matching object wins), so each layer gets exactly one combined rule.
 */

/** @typedef {{ group: string[]; message: string; allowTypeImports?: boolean }} RestrictedPattern */
/** @typedef {{ name: string; message: string }} RestrictedPath */

/** @param {string} dir */
const layer = (dir) => [`**/${dir}`, `**/${dir}/**`];

/** @type {RestrictedPath[]} */
const githubSdks = [
  { name: 'octokit', message: 'Only src/github/ may use the GitHub SDK.' },
  { name: '@actions/github', message: 'Only src/github/ may use the GitHub SDK.' },
];

/** @type {RestrictedPattern} */
const githubSdkPattern = {
  group: ['@octokit/*'],
  message: 'Only src/github/ may use the GitHub SDK.',
};

/** @type {RestrictedPattern} */
const aiSdkPattern = {
  group: ['openai', '@anthropic-ai/*', 'ollama', '@google/genai', '@google/generative-ai'],
  message: 'Only src/ai/ adapters may use a model provider SDK.',
};

/** @type {RestrictedPath[]} */
const processExecution = ['node:child_process', 'child_process'].map((name) => ({
  name,
  message: 'Process execution is restricted to src/analyzers/ (and never runs PR code).',
}));

/** @type {RestrictedPath[]} */
const networkModules = ['node:http', 'node:https', 'node:net', 'http', 'https', 'net'].map(
  (name) => ({ name, message: 'Pure domain modules must not perform network I/O.' }),
);

/**
 * @param {string} dir
 * @param {string} why
 * @returns {RestrictedPattern}
 */
const forbidLayer = (dir, why) => ({ group: layer(dir), message: why });

/**
 * Ports (interfaces) live in ai/provider.ts and analyzers/analyzer.ts; domain
 * code may depend on them by type, never on a concrete adapter.
 * @param {string} dir
 * @returns {RestrictedPattern}
 */
const typeOnlyLayer = (dir) => ({
  group: layer(dir),
  allowTypeImports: true,
  message: `Domain code may depend on ${dir}/ interfaces with \`import type\` only; wire concrete adapters in src/cli/.`,
});

/**
 * @param {{ paths?: RestrictedPath[]; patterns?: RestrictedPattern[] }} options
 * @returns {import('eslint').Linter.RulesRecord}
 */
const restrict = ({ paths = [], patterns = [] }) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

/** @type {import('eslint').Linter.Config[]} */
export const boundaryConfigs = [
  {
    name: 'pr-guardian/boundaries/domain',
    files: ['src/core/**/*.ts', 'src/diff/**/*.ts', 'src/report/**/*.ts'],
    rules: restrict({
      paths: [...githubSdks, ...processExecution, ...networkModules],
      patterns: [
        githubSdkPattern,
        aiSdkPattern,
        forbidLayer('github', 'Core must not depend on GitHub API objects (spec §8.1).'),
        forbidLayer('cli', 'Only the CLI composition root may import src/cli/.'),
        forbidLayer('config', 'Pass parsed configuration values into domain code instead.'),
        typeOnlyLayer('ai'),
        typeOnlyLayer('analyzers'),
      ],
    }),
  },
  {
    name: 'pr-guardian/boundaries/ai',
    files: ['src/ai/**/*.ts'],
    rules: restrict({
      paths: [...githubSdks, ...processExecution],
      patterns: [
        githubSdkPattern,
        forbidLayer('github', 'AI adapters must not talk to GitHub.'),
        // The AI reviewer implements the analyzer port, so it may import its types.
        typeOnlyLayer('analyzers'),
        forbidLayer('cli', 'Only the CLI composition root may import src/cli/.'),
      ],
    }),
  },
  {
    name: 'pr-guardian/boundaries/analyzers',
    files: ['src/analyzers/**/*.ts'],
    rules: restrict({
      paths: githubSdks,
      patterns: [
        githubSdkPattern,
        aiSdkPattern,
        forbidLayer('github', 'Analyzers must not publish to GitHub (spec §16.4).'),
        forbidLayer('ai', 'Analyzers must not call model providers.'),
        forbidLayer('cli', 'Only the CLI composition root may import src/cli/.'),
      ],
    }),
  },
  {
    name: 'pr-guardian/boundaries/github',
    files: ['src/github/**/*.ts'],
    rules: restrict({
      paths: processExecution,
      patterns: [
        aiSdkPattern,
        forbidLayer('ai', 'The GitHub adapter must not contain review logic.'),
        forbidLayer('analyzers', 'The GitHub adapter must not contain review logic.'),
        forbidLayer('cli', 'Only the CLI composition root may import src/cli/.'),
      ],
    }),
  },
  {
    name: 'pr-guardian/boundaries/config',
    files: ['src/config/**/*.ts'],
    rules: restrict({
      paths: [...githubSdks, ...processExecution, ...networkModules],
      patterns: [
        githubSdkPattern,
        aiSdkPattern,
        forbidLayer('github', 'Configuration parsing must not depend on adapters.'),
        forbidLayer('ai', 'Configuration parsing must not depend on adapters.'),
        forbidLayer('analyzers', 'Configuration parsing must not depend on adapters.'),
        forbidLayer('cli', 'Only the CLI composition root may import src/cli/.'),
      ],
    }),
  },
  {
    // Environment variables (and therefore secrets) are read in exactly two
    // places, so they cannot leak into domain logic or logs by accident.
    name: 'pr-guardian/boundaries/environment',
    files: ['src/**/*.ts'],
    ignores: ['src/config/**', 'src/cli/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables only in src/config/ or src/cli/.',
        },
      ],
    },
  },
];
