// @ts-check
/**
 * Bundle the GitHub Action into one self-contained file, committed to the
 * repository so the Action runs without `npm install` at review time.
 * CI rebuilds it and fails if the committed copy differs from the source.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/action-main.ts'],
  outfile: 'dist-action/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // Unminified so the committed bundle can be reviewed; licenses kept at the end.
  minify: false,
  legalComments: 'eof',
  sourcemap: false,
  charset: 'utf8',
  logLevel: 'warning',
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __prGuardianCreateRequire } from 'node:module';\nconst require = __prGuardianCreateRequire(import.meta.url);",
  },
});
