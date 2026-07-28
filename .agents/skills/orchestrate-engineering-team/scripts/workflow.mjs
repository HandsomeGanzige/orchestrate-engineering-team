#!/usr/bin/env node
import process from 'node:process';
import { runCli, WorkflowError } from './workflow-core.mjs';

try {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result?.valid === false) process.exitCode = 1;
} catch (error) {
  const body = error instanceof WorkflowError
    ? { error: error.code, message: error.message }
    : { error: 'INTERNAL_ERROR', message: error.message };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
}
