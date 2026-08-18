#!/usr/bin/env node
import process from 'node:process';
import { runCli, WorkflowError } from './workflow-core.mjs';

try {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result?.data?.valid === false) process.exitCode = 1;
} catch (error) {
  const command = process.argv[2] ?? null;
  const body = error instanceof WorkflowError
    ? { ok: false, command, error: { code: error.code, message: error.message } }
    : { ok: false, command, error: { code: 'INTERNAL_ERROR', message: error.message } };
  process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exitCode = 1;
}
