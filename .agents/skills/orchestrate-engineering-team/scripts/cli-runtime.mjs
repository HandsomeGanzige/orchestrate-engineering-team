import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ERROR_CODES, ensure, fail } from './workflow-contract.mjs';
import {
  assignmentCommand,
  childSync,
  claimWork,
  createWork,
  decisionCommand,
  findCommand,
  handoffCommand,
  historyCommand,
  listCommand,
  metricsCommand,
  packetCommand,
  releaseWork,
  resultCommand,
  todoCommand,
  validateWorkspace,
  voteCommand,
  workCommand,
} from './workflow-runtime.mjs';

export const PUBLIC_COMMANDS = Object.freeze(['open', 'plan', 'next', 'dispatch', 'accept', 'resolve', 'close', 'inspect']);

const SUCCESS_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['ok', 'command', 'data'], properties: { ok: { const: true }, command: { enum: PUBLIC_COMMANDS }, data: {} },
});
const ERROR_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['ok', 'command', 'error'], properties: {
    ok: { const: false }, command: { type: ['string', 'null'] },
    error: { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: { code: { enum: ERROR_CODES }, message: { type: 'string' } } },
  },
});

const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: 'string', minLength: 1 });
const STRING_ARRAY_SCHEMA = Object.freeze({ type: 'array', items: NON_EMPTY_STRING_SCHEMA });
const FREE_OBJECT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true });
const CREATE_REQUEST_PROPERTIES = Object.freeze({
  id: NON_EMPTY_STRING_SCHEMA,
  name: NON_EMPTY_STRING_SCHEMA,
  goal: NON_EMPTY_STRING_SCHEMA,
  successCriteria: { ...STRING_ARRAY_SCHEMA, minItems: 1 },
  type: { enum: ['delivery', 'exploration'] },
  stage: { enum: ['align', 'design', 'develop', 'verify', 'close'] },
  summary: { type: 'string' },
  scope: STRING_ARRAY_SCHEMA,
  references: STRING_ARRAY_SCHEMA,
  doneConditions: STRING_ARRAY_SCHEMA,
  constraints: STRING_ARRAY_SCHEMA,
  readScope: STRING_ARRAY_SCHEMA,
  writeScope: STRING_ARRAY_SCHEMA,
  forbiddenChanges: STRING_ARRAY_SCHEMA,
  contract: FREE_OBJECT_SCHEMA,
});
const CHILD_ELIGIBILITY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['independentlyAcceptable', 'withinParentScope'],
  properties: {
    independentlyAcceptable: { const: true },
    withinParentScope: { const: true },
    plannedTodos: STRING_ARRAY_SCHEMA,
    plannedRoles: STRING_ARRAY_SCHEMA,
    crossSession: { type: 'boolean' },
  },
  anyOf: [
    { type: 'object', required: ['plannedTodos'], properties: { plannedTodos: { ...STRING_ARRAY_SCHEMA, minItems: 2 } } },
    { type: 'object', required: ['plannedRoles'], properties: { plannedRoles: { ...STRING_ARRAY_SCHEMA, minItems: 2, uniqueItems: true } } },
    { type: 'object', required: ['crossSession'], properties: { crossSession: { const: true } } },
  ],
});
const UNIQUE_STRING_ARRAY_SCHEMA = Object.freeze({ ...STRING_ARRAY_SCHEMA, uniqueItems: true });
const ARTIFACT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['path', 'purpose'],
  properties: { path: NON_EMPTY_STRING_SCHEMA, purpose: NON_EMPTY_STRING_SCHEMA },
});
const WORK_UPDATE_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    status: { enum: ['active', 'paused', 'blocked', 'completed', 'cancelled'] },
    stage: { enum: ['align', 'design', 'develop', 'verify', 'close'] },
    progress: { type: 'string', maxLength: 2000 },
    result: { type: 'string', maxLength: 2000 },
    artifacts: { type: 'array', items: ARTIFACT_SCHEMA },
    nextAction: { type: 'string', maxLength: 500 },
    completeTodo: NON_EMPTY_STRING_SCHEMA,
  },
  anyOf: [
    { type: 'object', required: ['status', 'completeTodo'], properties: { status: { const: 'completed' }, completeTodo: NON_EMPTY_STRING_SCHEMA } },
    { type: 'object', required: ['status'], properties: { status: { enum: ['active', 'paused', 'blocked', 'cancelled'] } } },
    { type: 'object', not: { type: 'object', required: ['status'] } },
  ],
});
const WORK_REQUEST_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'update' }, input: WORK_UPDATE_INPUT_SCHEMA } },
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'evidence' }, input: { type: 'object', additionalProperties: false, required: ['criterion', 'evidence'], properties: { criterion: NON_EMPTY_STRING_SCHEMA, evidence: NON_EMPTY_STRING_SCHEMA, pointers: STRING_ARRAY_SCHEMA } } } },
  ],
});
const TODO_REQUEST_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'add' }, input: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: NON_EMPTY_STRING_SCHEMA, text: NON_EMPTY_STRING_SCHEMA, assignment: NON_EMPTY_STRING_SCHEMA } } } },
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'start' }, input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: NON_EMPTY_STRING_SCHEMA } } } },
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'complete' }, input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: NON_EMPTY_STRING_SCHEMA, next: NON_EMPTY_STRING_SCHEMA } } } },
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'block' }, input: { type: 'object', additionalProperties: false, required: ['id', 'blockers'], properties: { id: NON_EMPTY_STRING_SCHEMA, blockers: { ...STRING_ARRAY_SCHEMA, minItems: 1, maxItems: 10 }, next: NON_EMPTY_STRING_SCHEMA } } } },
  ],
});
const CLAIM_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['kind', 'key', 'mode'],
  properties: { kind: { enum: ['path', 'resource', 'global'] }, key: NON_EMPTY_STRING_SCHEMA, mode: { enum: ['exclusive', 'shared'] } },
});
const ASSIGNMENT_ADD_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['id', 'role', 'objective'],
  properties: {
    id: NON_EMPTY_STRING_SCHEMA,
    role: { enum: ['architecture', 'development', 'test', 'review', 'retest', 'rereview'] },
    objective: NON_EMPTY_STRING_SCHEMA,
    successCriteria: { ...STRING_ARRAY_SCHEMA, maxItems: 30 },
    read: { ...STRING_ARRAY_SCHEMA, maxItems: 100 },
    write: { ...STRING_ARRAY_SCHEMA, maxItems: 100 },
    decisions: { ...STRING_ARRAY_SCHEMA, maxItems: 30 },
    requiredCapabilities: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 },
    availableCapabilities: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 },
    unavailableCapabilities: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 },
    capabilities: { type: 'object', additionalProperties: false, properties: { required: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 }, available: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 }, unavailable: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 } } },
    topologyMode: { enum: ['serial', 'parallel'] },
    topologyGroup: { type: 'string' },
    independent: { type: 'boolean' },
    sharedInterfaceStable: { type: 'boolean' },
    touchesGlobal: { type: 'boolean' },
    integrator: { type: 'string' },
    topology: { type: 'object', additionalProperties: false, properties: { mode: { enum: ['serial', 'parallel'] }, group: { type: 'string' }, independent: { type: 'boolean' }, shared_interface_stable: { type: 'boolean' }, touches_global: { type: 'boolean' }, integrator: { type: 'string' } } },
    claim_specs: { type: 'array', maxItems: 100, items: CLAIM_SCHEMA },
    claimSpecs: { type: 'array', maxItems: 100, items: CLAIM_SCHEMA },
    agentId: { type: 'string' },
    dependsOn: { ...UNIQUE_STRING_ARRAY_SCHEMA, maxItems: 30 },
  },
  anyOf: [
    { type: 'object', required: ['role', 'write'], properties: { role: { const: 'development' }, write: { ...STRING_ARRAY_SCHEMA, minItems: 1, maxItems: 100 } } },
    { type: 'object', required: ['role'], properties: { role: { enum: ['architecture', 'test', 'review', 'retest', 'rereview'] } } },
  ],
});
const ASSIGNMENT_ACTION_INPUTS = Object.freeze({
  add: ASSIGNMENT_ADD_INPUT_SCHEMA,
  start: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: NON_EMPTY_STRING_SCHEMA, agentId: { type: 'string' }, gates: { type: 'array', maxItems: 20, items: FREE_OBJECT_SCHEMA } } },
  complete: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: NON_EMPTY_STRING_SCHEMA } },
  block: { type: 'object', additionalProperties: false, required: ['id', 'blockers'], properties: { id: NON_EMPTY_STRING_SCHEMA, blockers: { ...STRING_ARRAY_SCHEMA, minItems: 1, maxItems: 10 } } },
});
const PLAN_ASSIGNMENT_REQUEST_SCHEMA = Object.freeze({
  oneOf: Object.entries(ASSIGNMENT_ACTION_INPUTS).map(([action, input]) => ({
    type: 'object', additionalProperties: false,
    required: action === 'add' ? ['input'] : ['action', 'input'],
    properties: { action: { const: action }, input },
  })),
});
const RESOLVE_ASSIGNMENT_REQUEST_SCHEMA = Object.freeze({
  oneOf: Object.entries(ASSIGNMENT_ACTION_INPUTS).map(([action, input]) => ({
    type: 'object', additionalProperties: false, required: ['action', 'input'],
    properties: { action: { const: action }, input },
  })),
});
const VOTE_RECORD_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['role', 'requiresTest', 'testReason', 'requiresReview', 'reviewReason'],
  properties: {
    role: { enum: ['architecture', 'development', 'main'] },
    assignment: NON_EMPTY_STRING_SCHEMA,
    requiresTest: { type: 'boolean' },
    testReason: NON_EMPTY_STRING_SCHEMA,
    requiresReview: { type: 'boolean' },
    reviewReason: NON_EMPTY_STRING_SCHEMA,
    covered: { type: 'boolean' },
  },
  anyOf: [
    { type: 'object', required: ['role'], properties: { role: { const: 'main' } } },
    { type: 'object', required: ['role', 'assignment'], properties: { role: { enum: ['architecture', 'development'] }, assignment: NON_EMPTY_STRING_SCHEMA } },
  ],
});
const VOTE_REQUEST_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'record' }, input: VOTE_RECORD_INPUT_SCHEMA } },
    { type: 'object', additionalProperties: false, required: ['action', 'input'], properties: { action: { const: 'compute' }, input: { type: 'object', additionalProperties: false } } },
  ],
});

/**
 * Builds the strict JSON Schema for one intent payload from operation-owned schemas.
 *
 * @param {Record<string, {required: string[], request?: object}>} operationSchemas - Allowed operations and their payload requirements.
 * @returns {object} Draft 2020-12 JSON Schema for the intent payload.
 */
function payloadSchema(operationSchemas) {
  const operations = Object.keys(operationSchemas);
  const commonProperties = {
    root: NON_EMPTY_STRING_SCHEMA,
    work: NON_EMPTY_STRING_SCHEMA,
    owner: NON_EMPTY_STRING_SCHEMA,
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['operation'],
    properties: {
      operation: { enum: operations }, ...commonProperties, request: { type: 'object' },
    },
    oneOf: Object.entries(operationSchemas).map(([operation, specification]) => ({
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { const: operation }, ...commonProperties,
        ...(specification.request ? { request: specification.request } : {}),
      },
      required: ['operation', ...specification.required],
    })),
  };
}

/**
 * Builds one frozen descriptor including machine-readable result contracts and examples.
 *
 * @param {string} name - Public intent command name.
 * @param {string} summary - Human-readable intent summary.
 * @param {Record<string, {required: string[], request?: object}>} operationSchemas - Allowed operations and their payload requirements.
 * @param {object} payload - Valid example payload.
 * @returns {object} Frozen public command descriptor.
 */
function descriptor(name, summary, operationSchemas, payload) {
  return Object.freeze({
    name, summary, payload_schema: payloadSchema(operationSchemas), success_schema: SUCCESS_SCHEMA,
    error_schema: ERROR_SCHEMA, error_codes: ERROR_CODES,
    examples: Object.freeze({
      request: { command: name, payload }, success: { ok: true, command: name, data: {} },
      failure: { ok: false, command: name, error: { code: 'INVALID_INPUT', message: 'request is invalid' } },
    }),
  });
}

export const COMMAND_DESCRIPTORS = Object.freeze({
  open: descriptor('open', 'Create and claim a v2 Work Item, or resume its owner lease.', {
    create: {
      required: ['request'],
      request: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'goal', 'successCriteria'],
        properties: { ...CREATE_REQUEST_PROPERTIES, leaseMinutes: { type: 'integer', minimum: 1, maximum: 1440 } },
      },
    },
    resume: {
      required: ['work', 'owner'],
      request: { type: 'object', additionalProperties: false, properties: { leaseMinutes: { type: 'integer', minimum: 1, maximum: 1440 } } },
    },
  }, { operation: 'create', owner: 'main', request: { id: 'api-migration', name: 'API migration', goal: 'Migrate the API.', successCriteria: ['Migration passes.'] } }),
  plan: descriptor('plan', 'Record confirmed planning facts or declare bounded graph nodes.', {
    work: { required: ['work', 'owner', 'request'], request: WORK_REQUEST_SCHEMA },
    'confirm-decision': { required: ['work', 'owner', 'request'], request: { type: 'object', additionalProperties: false, required: ['id', 'summary'], properties: { id: NON_EMPTY_STRING_SCHEMA, summary: NON_EMPTY_STRING_SCHEMA, evidence: STRING_ARRAY_SCHEMA } } },
    todo: { required: ['work', 'owner', 'request'], request: TODO_REQUEST_SCHEMA },
    assignment: { required: ['work', 'owner', 'request'], request: PLAN_ASSIGNMENT_REQUEST_SCHEMA },
    child: {
      required: ['work', 'owner', 'request'],
      request: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'goal', 'successCriteria', 'eligibility'],
        properties: { ...CREATE_REQUEST_PROPERTIES, eligibility: CHILD_ELIGIBILITY_SCHEMA },
      },
    },
  }, { operation: 'todo', work: 'api-migration', owner: 'main', request: { action: 'add', input: { id: 'implement-client', text: 'Implement the client.' } } }),
  next: descriptor('next', 'Return the bounded next-action handoff for open work.', { handoff: { required: ['work'] } }, { operation: 'handoff', work: 'api-migration' }),
  dispatch: descriptor('dispatch', 'Start a declared Assignment attempt and return its immutable role packet.', {
    assignment: { required: ['work', 'owner', 'request'], request: { type: 'object', additionalProperties: false, required: ['assignment'], properties: { assignment: NON_EMPTY_STRING_SCHEMA, start: { type: 'boolean' }, agentId: NON_EMPTY_STRING_SCHEMA, gates: { type: 'array', items: FREE_OBJECT_SCHEMA } } } },
  }, { operation: 'assignment', work: 'api-migration', owner: 'main', request: { assignment: 'implement-client' } }),
  accept: descriptor('accept', 'Validate and accept one role result or completed child projection.', {
    'role-result': { required: ['work', 'owner', 'request'], request: { type: 'object', additionalProperties: false, required: ['assignment', 'result'], properties: { assignment: NON_EMPTY_STRING_SCHEMA, result: FREE_OBJECT_SCHEMA } } },
    child: { required: ['work', 'owner', 'request'], request: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: NON_EMPTY_STRING_SCHEMA } } },
  }, { operation: 'child', work: 'api-migration', owner: 'main', request: { id: 'client-subgoal' } }),
  resolve: descriptor('resolve', 'Resolve blockers, retries, lifecycle exceptions, and verification votes.', {
    todo: { required: ['work', 'owner', 'request'], request: TODO_REQUEST_SCHEMA },
    assignment: { required: ['work', 'owner', 'request'], request: RESOLVE_ASSIGNMENT_REQUEST_SCHEMA },
    work: { required: ['work', 'owner', 'request'], request: WORK_REQUEST_SCHEMA },
    vote: { required: ['work', 'owner', 'request'], request: VOTE_REQUEST_SCHEMA },
  }, { operation: 'assignment', work: 'api-migration', owner: 'main', request: { action: 'block', input: { id: 'implement-client', blockers: ['Needs a retry.'] } } }),
  close: descriptor('close', 'Validate, complete, or release work through governed lifecycle services.', {
    preflight: { required: [] },
    complete: {
      required: ['work', 'owner', 'request'],
      request: {
        type: 'object', additionalProperties: false, required: ['completeTodo'],
        properties: { completeTodo: NON_EMPTY_STRING_SCHEMA, progress: { type: 'string' }, result: { type: 'string' }, artifacts: { type: 'array', items: FREE_OBJECT_SCHEMA }, nextAction: { type: 'string' }, stage: { enum: ['align', 'design', 'develop', 'verify', 'close'] } },
      },
    },
    release: { required: ['work', 'owner'] },
  }, { operation: 'preflight' }),
  inspect: descriptor('inspect', 'Inspect open or archived facts, validation, and persisted graph/evidence metrics.', {
    list: { required: [], request: { type: 'object', additionalProperties: false, properties: { status: NON_EMPTY_STRING_SCHEMA, type: NON_EMPTY_STRING_SCHEMA, owner: NON_EMPTY_STRING_SCHEMA, parent: NON_EMPTY_STRING_SCHEMA, history: { type: 'boolean' } } } },
    find: { required: ['request'], request: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: NON_EMPTY_STRING_SCHEMA, limit: { type: 'integer', minimum: 1, maximum: 100 }, history: { type: 'boolean' } } } },
    history: { required: ['work'] },
    validate: { required: [] },
    metrics: { required: ['work'] },
  }, { operation: 'metrics', work: 'api-migration' }),
});

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
    if (!['payload', 'help', 'schema', 'examples'].includes(key)) payload[key] = coerce(value);
  }
  return payload;
}

/**
 * Validates a value against the descriptor-owned JSON Schema subset used by payloads.
 *
 * @param {object} rule - JSON Schema node.
 * @param {unknown} value - Candidate value.
 * @param {string} label - Stable error label for the candidate location.
 * @returns {void} Returns after the value satisfies the schema node.
 */
function validateSchemaValue(rule, value, label) {
  if (rule.const !== undefined) ensure(value === rule.const, `${label} must equal ${rule.const}`, 'INVALID_INPUT');
  if (rule.enum) ensure(rule.enum.includes(value), `${label} is invalid`, 'INVALID_INPUT');
  if (rule.type === 'string') {
    ensure(typeof value === 'string', `${label} must be a string`, 'INVALID_INPUT');
    if (rule.minLength !== undefined) ensure(value.length >= rule.minLength, `${label} is too short`, 'INVALID_INPUT');
    if (rule.maxLength !== undefined) ensure(value.length <= rule.maxLength, `${label} is too long`, 'INVALID_INPUT');
  } else if (rule.type === 'boolean') {
    ensure(typeof value === 'boolean', `${label} must be boolean`, 'INVALID_INPUT');
  } else if (rule.type === 'integer') {
    ensure(Number.isInteger(value), `${label} must be an integer`, 'INVALID_INPUT');
    if (rule.minimum !== undefined) ensure(value >= rule.minimum, `${label} is below its minimum`, 'INVALID_INPUT');
    if (rule.maximum !== undefined) ensure(value <= rule.maximum, `${label} exceeds its maximum`, 'INVALID_INPUT');
  } else if (rule.type === 'array') {
    ensure(Array.isArray(value), `${label} must be an array`, 'INVALID_INPUT');
    if (rule.minItems !== undefined) ensure(value.length >= rule.minItems, `${label} has too few items`, 'INVALID_INPUT');
    if (rule.maxItems !== undefined) ensure(value.length <= rule.maxItems, `${label} has too many items`, 'INVALID_INPUT');
    if (rule.uniqueItems === true) ensure(new Set(value.map((entry) => JSON.stringify(entry))).size === value.length, `${label} must contain unique items`, 'INVALID_INPUT');
    if (rule.items) value.forEach((entry, index) => validateSchemaValue(rule.items, entry, `${label}[${index}]`));
  } else if (rule.type === 'object') {
    ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`, 'INVALID_INPUT');
    const required = rule.required ?? [];
    ensure(
      required.every((field) => Object.hasOwn(value, field) && value[field] !== undefined),
      `${label} requires ${required.join(', ')}`,
      'INVALID_INPUT',
    );
    if (rule.additionalProperties === false) {
      const allowed = Object.keys(rule.properties ?? {});
      ensure(Object.keys(value).every((field) => allowed.includes(field)), `${label} contains an unknown field`, 'INVALID_INPUT');
    }
    for (const [field, fieldRule] of Object.entries(rule.properties ?? {})) {
      if (Object.hasOwn(value, field)) validateSchemaValue(fieldRule, value[field], `${label}.${field}`);
    }
  }
  if (rule.anyOf) {
    const matches = rule.anyOf.some((candidate) => {
      try {
        validateSchemaValue(candidate, value, label);
        return true;
      } catch (error) {
        if (error?.code !== 'INVALID_INPUT') throw error;
        return false;
      }
    });
    ensure(matches, `${label} does not match an allowed shape`, 'INVALID_INPUT');
  }
  if (rule.oneOf) {
    const matches = rule.oneOf.filter((candidate) => {
      try {
        validateSchemaValue(candidate, value, label);
        return true;
      } catch (error) {
        if (error?.code !== 'INVALID_INPUT') throw error;
        return false;
      }
    });
    ensure(matches.length === 1, `${label} does not match exactly one allowed shape`, 'INVALID_INPUT');
  }
  if (rule.not) {
    let matches = false;
    try {
      validateSchemaValue(rule.not, value, label);
      matches = true;
    } catch (error) {
      if (error?.code !== 'INVALID_INPUT') throw error;
    }
    ensure(!matches, `${label} matches a forbidden shape`, 'INVALID_INPUT');
  }
}

/**
 * Validates a payload against the exact schema variant selected by its operation.
 *
 * @param {object} schema - Descriptor-owned payload schema.
 * @param {object} payload - Candidate intent payload.
 * @returns {void} Returns after the operation-specific payload rules pass.
 */
function validatePayload(schema, payload) {
  ensure(payload && typeof payload === 'object' && !Array.isArray(payload), 'payload must be an object', 'INVALID_INPUT');
  const operationSchema = schema.oneOf.find((candidate) => candidate.properties.operation.const === payload.operation);
  ensure(operationSchema, 'operation is invalid', 'INVALID_INPUT');
  validateSchemaValue(operationSchema, payload, 'payload');
}

/**
 * Generates help exclusively from the immutable command descriptors.
 *
 * @param {string|null} [command=null] - Optional intent whose detailed help is requested.
 * @returns {object} Global or command-specific help model.
 */
export function commandHelp(command = null) {
  if (!command) return {
    usage: 'workflow.mjs <open|plan|next|dispatch|accept|resolve|close|inspect> --payload <file|->',
    commands: PUBLIC_COMMANDS.map((name) => ({ name, summary: COMMAND_DESCRIPTORS[name].summary })),
  };
  const current = COMMAND_DESCRIPTORS[command];
  ensure(current, `unknown command: ${command}`, 'INVALID_COMMAND');
  return {
    usage: `workflow.mjs ${command} --payload <file|->`, summary: current.summary,
    operations: current.payload_schema.properties.operation.enum, metadata_flags: ['--help', '--schema', '--examples'],
  };
}

/**
 * Implements the public open intent through governed create and claim services.
 *
 * @param {object} args - Resolved root, work, owner, input, and clock.
 * @returns {Promise<object>} Created Work Item and optional lease, or resumed lease.
 */
async function openIntent({ root, input, owner, work, now }) {
  if (input.operation === 'resume') return claimWork({ root, work, owner, leaseMinutes: input.request?.leaseMinutes, now });
  const created = await createWork({ root, input: input.request, owner, now });
  const lease = owner ? await claimWork({ root, work: input.request.id, owner, leaseMinutes: input.request.leaseMinutes, now }) : null;
  return { created, lease };
}

/**
 * Implements the public planning intent through fail-closed mutation services.
 *
 * @param {object} common - Shared workflow routing context.
 * @returns {Promise<object>} Planning mutation result.
 */
async function planIntent(common) {
  const { operation, request = {} } = common.input;
  if (operation === 'confirm-decision') return decisionCommand({ ...common, action: 'add', input: request.input ?? request });
  if (operation === 'todo') return todoCommand({ ...common, action: request.action, input: request.input ?? {} });
  if (operation === 'assignment') return assignmentCommand({ ...common, action: request.action ?? 'add', input: request.input ?? {} });
  if (operation === 'work') return workCommand({ ...common, action: request.action, input: request.input ?? {} });
  if (operation === 'child') return createWork({ root: common.root, owner: common.owner, childOnly: true, now: common.now, input: { ...(request.input ?? request), parent: common.work } });
  fail(`unsupported plan operation: ${operation}`, 'INVALID_INPUT');
}

/**
 * Starts one Assignment attempt and returns its dispatchable immutable packet.
 *
 * @param {object} args - Resolved root, work, owner, input, and clock.
 * @returns {Promise<object>} Bounded immutable role packet.
 */
async function dispatchIntent({ root, work, owner, input, now }) {
  const request = input.request;
  if (request.start !== false) {
    await assignmentCommand({ root, work, owner, action: 'start', input: { id: request.assignment, agentId: request.agentId, gates: request.gates }, now });
  }
  return packetCommand({ root, work, input: { assignment: request.assignment } });
}

/**
 * Accepts one bounded role result or synchronizes a completed child delivery.
 *
 * @param {object} args - Resolved root, work, owner, input, and clock.
 * @returns {Promise<object>} Accepted role result or synchronized child projection.
 */
async function acceptIntent({ root, work, owner, input, now }) {
  const request = input.request;
  if (input.operation === 'child') return childSync({ root, work, owner, input: request, now });
  const accepted = await resultCommand({ root, work, owner, input: { assignment: request.assignment, result: request.result }, now });
  const completed = request.result?.status === 'completed'
    ? await assignmentCommand({ root, work, owner, action: 'complete', input: { id: request.assignment }, now }) : null;
  return { accepted, completed };
}

/**
 * Resolves bounded lifecycle exceptions through governed mutation services.
 *
 * @param {object} common - Shared workflow routing context.
 * @returns {Promise<object>} Resolution mutation result.
 */
async function resolveIntent(common) {
  const { operation, request } = common.input;
  if (operation === 'todo') return todoCommand({ ...common, action: request.action, input: request.input ?? {} });
  if (operation === 'assignment') return assignmentCommand({ ...common, action: request.action, input: request.input ?? {} });
  if (operation === 'work') return workCommand({ ...common, action: request.action, input: request.input ?? {} });
  if (operation === 'vote') return voteCommand({ ...common, action: request.action, input: request.input ?? {} });
  fail(`unsupported resolve operation: ${operation}`, 'INVALID_INPUT');
}

/**
 * Closes lifecycle concerns through validation, completion, and lease-release services.
 *
 * @param {object} common - Shared workflow routing context.
 * @returns {Promise<object>} Closure preflight, completion, or lease-release result.
 */
async function closeIntent(common) {
  const { operation, request = {} } = common.input;
  if (operation === 'preflight') return validateWorkspace({ root: common.root });
  if (operation === 'complete') {
    return workCommand({ ...common, action: 'update', input: { ...(request.input ?? request), status: 'completed' } });
  }
  if (operation === 'release') return releaseWork(common);
  fail(`unsupported close operation: ${operation}`, 'INVALID_INPUT');
}

/**
 * Performs bounded inspection of persisted workflow facts.
 *
 * @param {object} args - Resolved root, work reference, and inspection input.
 * @returns {Promise<object|object[]>} Requested persisted inspection result.
 */
async function inspectIntent({ root, work, input }) {
  const request = input.request ?? {};
  if (input.operation === 'list') return listCommand({ root, input: request });
  if (input.operation === 'find') return findCommand({ root, input: request });
  if (input.operation === 'history') return historyCommand({ root, work });
  if (input.operation === 'validate') return validateWorkspace({ root });
  if (input.operation === 'metrics') return metricsCommand({ root, work });
  fail(`unsupported inspect operation: ${input.operation}`, 'INVALID_INPUT');
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
  if (!command && flags.help === true) return { ok: true, command: 'inspect', data: commandHelp() };
  ensure(PUBLIC_COMMANDS.includes(command) && action === undefined, `unknown command: ${[command, action].filter(Boolean).join(' ')}`, 'INVALID_COMMAND');
  const descriptor = COMMAND_DESCRIPTORS[command];
  if (flags.help === true) return { ok: true, command, data: commandHelp(command) };
  if (flags.schema === true) return { ok: true, command, data: descriptor.payload_schema };
  if (flags.examples === true) return { ok: true, command, data: descriptor.examples };
  const root = path.resolve(flags.root ?? process.cwd());
  const input = await loadInput(flags, stdin);
  validatePayload(descriptor.payload_schema, input);
  const common = {
    root,
    work: flags.work ?? input.work,
    owner: flags.owner ?? input.owner,
    input,
    now,
  };
  let data;
  if (command === 'open') data = await openIntent(common);
  else if (command === 'plan') data = await planIntent(common);
  else if (command === 'next') data = await handoffCommand(common);
  else if (command === 'dispatch') data = await dispatchIntent(common);
  else if (command === 'accept') data = await acceptIntent(common);
  else if (command === 'resolve') data = await resolveIntent(common);
  else if (command === 'close') data = await closeIntent(common);
  else data = await inspectIntent(common);
  return { ok: true, command, data };
}
