import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ensure, fail } from './workflow-contract.mjs';
import {
  assignmentCommand,
  childSync,
  claimWork,
  createWork,
  decisionCommand,
  findCommand,
  handoffCommand,
  initWorkspace,
  listCommand,
  materialCommand,
  packetCommand,
  releaseWork,
  resultCommand,
  todoCommand,
  validateWorkspace,
  voteCommand,
  workCommand,
} from './workflow-runtime.mjs';

/**
 * Parses positional command tokens and GNU-style long flags from CLI arguments.
 *
 * @param {string[]} argv - Command-line arguments excluding the Node executable and script path.
 * @returns {{command: string|undefined, action: string|undefined, flags: Record<string, string|boolean>}} Parsed command surface.
 */
export function parseCli(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command: positional[0], action: positional[1], flags };
}

/**
 * Converts common scalar flag representations into booleans, null, arrays, or objects.
 *
 * @param {unknown} value - Raw flag value.
 * @returns {unknown} Coerced value when recognized; otherwise the original value.
 */
function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (typeof value === 'string' && /^[\[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {}
  }
  return value;
}

/**
 * Reads an asynchronous text stream to completion.
 *
 * @param {AsyncIterable<string|Buffer>} stream - Standard input or another asynchronous byte stream.
 * @returns {Promise<string>} Concatenated stream contents.
 */
async function readStream(stream) {
  let output = '';
  for await (const chunk of stream) output += chunk;
  return output;
}

/**
 * Loads a JSON payload from a file or stdin and overlays non-routing CLI flags.
 *
 * @param {Record<string, string|boolean>} flags - Parsed CLI flags.
 * @param {AsyncIterable<string|Buffer>} [stdin=process.stdin] - Input stream used when `--payload -` is selected.
 * @returns {Promise<object>} Normalized command payload.
 */
export async function loadInput(flags, stdin = process.stdin) {
  let payload = {};
  if (flags.payload) {
    const raw = flags.payload === '-'
      ? await readStream(stdin)
      : await readFile(path.resolve(flags.payload), 'utf8');
    try {
      payload = JSON.parse(raw);
    } catch {
      fail('payload must be valid JSON', 'INVALID_INPUT');
    }
    ensure(
      payload && typeof payload === 'object' && !Array.isArray(payload),
      'payload must be a JSON object',
      'INVALID_INPUT',
    );
  }
  for (const [key, value] of Object.entries(flags)) {
    if (!['payload', 'root', 'work', 'owner'].includes(key)) payload[key] = coerce(value);
  }
  return payload;
}

/**
 * Routes one parsed CLI invocation to the workflow application service.
 *
 * @param {string[]} argv - Command-line arguments excluding executable and script path.
 * @param {{stdin?: AsyncIterable<string|Buffer>, now?: Date}} [options] - Injectable stream and clock for deterministic execution.
 * @returns {Promise<unknown>} Command-specific JSON-serializable result.
 */
export async function runCli(argv, { stdin = process.stdin, now = new Date() } = {}) {
  const { command, action, flags } = parseCli(argv);
  const root = path.resolve(flags.root ?? process.cwd());
  const input = await loadInput(flags, stdin);
  const common = {
    root,
    work: flags.work ?? input.work,
    owner: flags.owner ?? input.owner,
    input,
    now,
  };
  if (command === 'init') return initWorkspace({ root, now });
  if (command === 'create') return createWork({ root, input, owner: common.owner, now });
  if (command === 'claim') {
    return claimWork({
      root,
      work: common.work,
      owner: common.owner,
      leaseMinutes: input.leaseMinutes,
      now,
    });
  }
  if (command === 'release') return releaseWork({ root, work: common.work, owner: common.owner, now });
  if (command === 'work') return workCommand({ ...common, action });
  if (command === 'decision') return decisionCommand({ ...common, action });
  if (command === 'todo') return todoCommand({ ...common, action });
  if (command === 'assignment') return assignmentCommand({ ...common, action });
  if (command === 'result') return resultCommand(common);
  if (command === 'vote') return voteCommand({ ...common, action });
  if (command === 'child' && action === 'create') {
    return createWork({
      root,
      input: { ...input, parent: common.work ?? input.parent },
      owner: common.owner,
      now,
      childOnly: true,
    });
  }
  if (command === 'child' && action === 'sync') return childSync(common);
  if (command === 'material') return materialCommand({ ...common, action });
  if (command === 'packet') return packetCommand(common);
  if (command === 'find') return findCommand({ root, input });
  if (command === 'list') return listCommand({ root, input });
  if (command === 'handoff') return handoffCommand(common);
  if (command === 'validate') return validateWorkspace({ root });
  fail(`unknown command: ${[command, action].filter(Boolean).join(' ')}`, 'INVALID_COMMAND');
}
