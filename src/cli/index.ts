#!/usr/bin/env node
// Composition root: the only module that touches the real process.
import { run } from './run.js';

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
