#!/usr/bin/env node
// Composition root: the only module that touches the real process.
import { readInput } from './node-io.js';
import { run } from './run.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readInput,
});
