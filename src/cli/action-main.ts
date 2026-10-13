// GitHub Action process entry (bundled to dist-action/index.mjs).
import { runAction } from './action.js';

process.exitCode = await runAction(process.env, {
  log: (line) => process.stdout.write(`${line}\n`),
});
