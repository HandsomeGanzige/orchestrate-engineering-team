import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  assignmentCommand,
  childSync,
  claimWork,
  createWork,
  findCommand,
  handoffCommand,
  historyCommand,
  initWorkspace,
  listCommand,
  packetCommand,
  resultCommand,
  runCli,
  todoCommand,
  validateWorkspace,
  voteCommand,
  workCommand,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import { readAt, withWorkflowTransaction } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-store.mjs';

const now = new Date('2026-08-12T01:00:00.000Z');
const workflowCoreUrl = new URL('../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs', import.meta.url).href;
const input = (overrides = {}) => ({
  id: 'plain-runtime',
  name: 'Plain runtime',
  summary: 'Coordinates plain Markdown work.',
  type: 'delivery',
  goal: 'Deliver a plain Markdown runtime.',
  successCriteria: ['The runtime is verified.'],
  scope: ['Workflow runtime and interfaces.'],
  ...overrides,
});

async function rootFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'plain-workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createWork({ root, input: input(), now });
  await claimWork({ root, work: 'plain-runtime', owner: 'main', now });
  return root;
}

async function makeCompletable(root) {
  await workCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'evidence', now,
    input: { criterion: 'The runtime is verified.', evidence: 'Main verified the no-code outcome.', pointers: ['docs/outcome.md'] },
  });
}

const completeInput = {
  status: 'completed',
  completeTodo: 'align-goal',
  result: 'Curated factual delivery.',
};

function spawnWorkflowExpression(expression, environment = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', expression], {
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, completed };
}

async function waitForFile(file) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try { await stat(file); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < deadline, `timed out waiting for ${file}`);
    await delay(10);
  }
}

async function interruptAfterCleanupRename(root) {
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_RENAME = '1';
  try {
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_RENAME;
  }
}

async function completeChild(root) {
  await createWork({
    root, owner: 'main', childOnly: true, now,
    input: input({
      id: 'proof-child', name: 'Proof child', parent: 'plain-runtime',
      goal: 'Deliver a proof child.', successCriteria: ['The proof child is delivered.'],
      eligibility: {
        independentlyAcceptable: true, withinParentScope: true,
        plannedTodos: ['Deliver', 'Confirm'], plannedRoles: [],
      },
    }),
  });
  await claimWork({ root, work: 'proof-child', owner: 'child-main', now });
  await workCommand({
    root, work: 'proof-child', owner: 'child-main', action: 'evidence', now,
    input: { criterion: 'The proof child is delivered.', evidence: 'Child proof inspected.', pointers: [] },
  });
  await workCommand({
    root, work: 'proof-child', owner: 'child-main', now,
    input: { status: 'completed', completeTodo: 'align-goal', result: 'Proof child delivered.' },
  });
  await childSync({ root, work: 'plain-runtime', owner: 'main', input: { id: 'proof-child' }, now });
}

function roleResult(role, overrides = {}) {
  const verifier = ['test', 'review', 'retest', 'rereview'].includes(role);
  return {
    status: 'completed',
    summary: [`${role} completed.`],
    artifacts: [],
    files: role === 'development' ? ['src/runtime.mjs'] : [],
    checks: [{ command: `${role} check`, result: 'passed' }],
    requires_test: verifier ? null : true,
    test_reason: verifier ? null : 'Runtime behavior changed.',
    requires_review: verifier ? null : true,
    review_reason: verifier ? null : 'State transitions need independent review.',
    blockers: [],
    ...overrides,
  };
}

async function assignment(root, id, role, extra = {}) {
  await assignmentCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'add', now,
    input: {
      id, role, objective: `${role} the runtime.`,
      write: role === 'development' ? ['src/runtime.mjs'] : [],
      requiredCapabilities: ['workspace-read'],
      availableCapabilities: ['workspace-read'],
      integrator: '/root',
      ...extra,
    },
  });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id }, now });
  await resultCommand({ root, work: 'plain-runtime', owner: 'main', input: { assignment: id, result: roleResult(role) }, now });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'complete', input: { id }, now });
}

test('create and claim persist plain work.md beside operational-only state.json', async (t) => {
  const root = await rootFixture(t);
  const directory = path.join(root, '.agent-work', 'open', 'plain-runtime');
  const markdown = await readFile(path.join(directory, 'work.md'), 'utf8');
  const stateText = await readFile(path.join(directory, 'state.json'), 'utf8');
  const state = JSON.parse(stateText);
  assert.match(markdown, /^# Plain runtime/m);
  assert.match(markdown, /## Acceptance\n\n- \[ \] The runtime is verified\./);
  assert.doesNotMatch(markdown, /^---$|```json|<!--\s*workflow:/m);
  assert.equal(state.owner, 'main');
  assert.equal(state.lease_minutes, 60);
  for (const semantic of ['Deliver a plain Markdown runtime.', 'The runtime is verified.', 'Plain runtime']) {
    assert.equal(stateText.includes(semantic), false);
  }
  assert.deepEqual(await listCommand({ root, input: {} }), [{
    path: '.agent-work/open/plain-runtime/work.md',
    name: 'Plain runtime',
    summary: 'Workflow runtime and interfaces.',
    status: 'active',
    match_reason: 'filter',
  }]);
});

test('eligible Child Main owns isolated work and state while parent keeps only its delivery projection', async (t) => {
  const root = await rootFixture(t);
  await createWork({
    root, owner: 'main', childOnly: true, now,
    input: input({
      id: 'child-runtime', name: 'Child runtime', parent: 'plain-runtime',
      goal: 'Deliver the child seam.', successCriteria: ['The child seam is accepted.'],
      eligibility: {
        independentlyAcceptable: true, withinParentScope: true,
        plannedTodos: ['Implement child', 'Verify child'], plannedRoles: ['development'],
      },
    }),
  });
  await claimWork({ root, work: 'child-runtime', owner: 'child-main', now });
  await assignmentCommand({
    root, work: 'child-runtime', owner: 'child-main', action: 'add', now,
    input: { id: 'child-dev', role: 'development', objective: 'Implement child.', write: ['src/child.mjs'] },
  });
  const parentState = JSON.parse(await readFile(path.join(root, '.agent-work/open/plain-runtime/state.json'), 'utf8'));
  const childState = JSON.parse(await readFile(path.join(root, '.agent-work/open/plain-runtime/children/child-runtime/state.json'), 'utf8'));
  assert.equal(parentState.assignments.some(({ id }) => id === 'child-dev'), false);
  assert.equal(childState.assignments.some(({ id }) => id === 'child-dev'), true);
  assert.deepEqual(parentState.children[0], {
    id: 'child-runtime',
    path: '.agent-work/open/plain-runtime/children/child-runtime/work.md',
    status: 'active',
  });
  assert.match(await readFile(path.join(root, '.agent-work/open/plain-runtime/work.md'), 'utf8'), /\]\(children\/child-runtime\/work\.md\)/);
  assert.equal((await validateWorkspace({ root })).valid, true);
});

test('child creation recovers after child publication and parent pair failure with nested relative links', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const childInput = input({
    id: 'recover-child', name: 'Recover child', parent: 'plain-runtime', goal: 'Recover registration.',
    successCriteria: ['Registration recovers.'],
    eligibility: { independentlyAcceptable: true, withinParentScope: true, plannedTodos: ['Create', 'Register'], plannedRoles: [] },
  });
  process.env.WORKFLOW_TEST_FAIL_CHILD_AFTER_CREATE = '1';
  try {
    await assert.rejects(createWork({ root, owner: 'main', childOnly: true, now, input: childInput }), { code: 'ATOMIC_FAILURE' });
  } finally { delete process.env.WORKFLOW_TEST_FAIL_CHILD_AFTER_CREATE; }
  const retry = await createWork({ root, owner: 'main', childOnly: true, now: new Date(now.getTime() + 1_000), input: childInput });
  assert.equal(retry.id, 'recover-child');
  let parent = await readAt(path.join(root, '.agent-work/open/plain-runtime/work.md'));
  assert.equal(parent.blocks.children.filter(({ id }) => id === 'recover-child').length, 1);
  assert.match(parent.markdown, /\]\(children\/recover-child\/work\.md\)/);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/child-transactions')), []);

  await claimWork({ root, work: 'recover-child', owner: 'child-main', now });
  const nestedInput = input({
    id: 'nested-child', name: 'Nested child', parent: 'recover-child', goal: 'Nest correctly.',
    successCriteria: ['The nested link is local.'],
    eligibility: { independentlyAcceptable: true, withinParentScope: true, plannedTodos: ['Create', 'Register'], plannedRoles: [] },
  });
  process.env.WORKFLOW_TEST_FAIL_CHILD_PARENT_AFTER_WORK = '1';
  try {
    await assert.rejects(createWork({ root, owner: 'child-main', childOnly: true, now, input: nestedInput }), { code: 'ATOMIC_FAILURE' });
  } finally { delete process.env.WORKFLOW_TEST_FAIL_CHILD_PARENT_AFTER_WORK; }
  await createWork({ root, owner: 'child-main', childOnly: true, now: new Date(now.getTime() + 1_000), input: nestedInput });
  parent = await readAt(path.join(root, '.agent-work/open/plain-runtime/children/recover-child/work.md'));
  assert.equal(parent.blocks.children.filter(({ id }) => id === 'nested-child').length, 1);
  assert.match(parent.markdown, /\]\(children\/nested-child\/work\.md\)/);
  assert.doesNotMatch(parent.markdown, /\.agent-work\/open\/plain-runtime\/children\/recover-child\/children\/nested-child/);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/child-transactions')), []);
});

test('released AsyncLocalStorage descendants must reacquire the project lock', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let delayed;
  await withWorkflowTransaction(root, async () => {
    delayed = (async () => {
      await gate;
      return withWorkflowTransaction(root, async () => 'entered');
    })();
  });
  await withWorkflowTransaction(root, async () => {
    release();
    assert.equal(await Promise.race([delayed, delay(150, 'waiting')]), 'waiting');
  });
  assert.equal(await delayed, 'entered');
});

test('assignments preserve DAG and safe Development scopes and packets use empty-history dispatch', async (t) => {
  const root = await rootFixture(t);
  await assignmentCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'add', now,
    input: { id: 'dev-a', role: 'development', objective: 'Build A.', write: ['src/a'], integrator: '/root' },
  });
  await assignmentCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'add', now,
    input: { id: 'dev-b', role: 'development', objective: 'Build B.', write: ['src/b'], integrator: '/root' },
  });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id: 'dev-a' }, now });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id: 'dev-b' }, now });
  assert.deepEqual((await packetCommand({ root, work: 'plain-runtime', input: { assignment: 'dev-b' } })).spawn, { fork_turns: 'none' });
  await assert.rejects(
    assignmentCommand({
      root, work: 'plain-runtime', owner: 'main', action: 'add', now,
      input: { id: 'dev-c', role: 'development', objective: 'Build C.', write: ['src/a/nested'], integrator: '/root' },
    }).then(() => assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id: 'dev-c' }, now })),
    (error) => error.code === 'PARALLEL_CONFLICT',
  );
  await assert.rejects(
    assignmentCommand({
      root, work: 'plain-runtime', owner: 'main', action: 'add', now,
      input: { id: 'dev-missing', role: 'development', objective: 'Invalid DAG.', dependsOn: ['unknown'], write: ['src/c'] },
    }),
    (error) => error.code === 'NOT_FOUND',
  );
});

test('coordination commands preserve Main prose and transient results become minimal receipts', async (t) => {
  const root = await rootFixture(t);
  const workFile = path.join(root, '.agent-work/open/plain-runtime/work.md');
  const original = (await readFile(workFile, 'utf8'))
    .replace('None.\n\n## Work', 'Main decision prose stays here.\n\n## Work')
    .replace('- [ ] Confirm the outcome, scope, and acceptance.', 'Main owns this deliberately phrased work pointer.')
    .replace('None.\n\n## Current focus', 'Main-curated delivery prose.\n\n## Current focus');
  await writeFile(workFile, original);
  await todoCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'add', now,
    input: { id: 'later-step', text: 'Operational todo text.' },
  });
  await assignmentCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'add', now,
    input: { id: 'receipt-dev', role: 'development', objective: 'Change runtime.', write: ['src/receipt.mjs'] },
  });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id: 'receipt-dev' }, now });
  const transient = roleResult('development', {
    summary: ['RAW ROLE SUMMARY MUST VANISH'],
    artifacts: [{ path: 'src/receipt.mjs', purpose: 'RAW ROLE ARTIFACT MUST VANISH' }],
    files: ['src/receipt.mjs'],
    checks: [{ command: 'RAW ROLE COMMAND MUST VANISH', result: 'passed' }],
  });
  await resultCommand({ root, work: 'plain-runtime', owner: 'main', input: { assignment: 'receipt-dev', result: transient }, now });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'complete', input: { id: 'receipt-dev' }, now });
  await voteCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'record', now,
    input: { role: 'main', requiresTest: true, testReason: 'Test.', requiresReview: true, reviewReason: 'Review.' },
  });
  assert.equal(await readFile(workFile, 'utf8'), original);
  const stateText = await readFile(path.join(path.dirname(workFile), 'state.json'), 'utf8');
  for (const forbidden of ['RAW ROLE SUMMARY', 'RAW ROLE ARTIFACT', 'RAW ROLE COMMAND', '"checks"', '"artifacts"', '"summary"']) {
    assert.equal(stateText.includes(forbidden), false);
  }
  const state = JSON.parse(stateText);
  assert.deepEqual(state.assignments[0].receipt, {
    status: 'completed',
    completed_order: 1,
    changed_surface: ['src/receipt.mjs'],
    votes: {
      test: { requires: true, reason: 'Runtime behavior changed.' },
      review: { requires: true, reason: 'State transitions need independent review.' },
    },
  });
});

test('semantic identifiers and operational topology are rejected at commands and validation', async (t) => {
  const root = await rootFixture(t);
  await assert.rejects(
    assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: 'review', role: 'review', objective: 'Reserved.' } }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    todoCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: 'phase-one', text: 'Reserved.' } }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    todoCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: '1-batch', text: 'Numeric transit ID.' } }),
    (error) => error.code === 'INVALID_INPUT',
  );
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: 'prerequisite', role: 'development', objective: 'First.' } });
  await assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: 'dependent', role: 'development', objective: 'Second.', dependsOn: ['prerequisite'] } });
  await assert.rejects(
    assignmentCommand({ root, work: 'plain-runtime', owner: 'main', action: 'start', input: { id: 'dependent' }, now }),
    (error) => error.code === 'INVALID_TRANSITION',
  );
  const stateFile = path.join(root, '.agent-work/open/plain-runtime/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.todos.push({ ...state.todos[0], id: 'duplicate-active' });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  let validation = await validateWorkspace({ root });
  assert.match(validation.errors[0].message, /exactly one in-progress todo/);

  state.todos.pop();
  state.assignments[1].status = 'in_progress';
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  validation = await validateWorkspace({ root });
  assert.match(validation.errors[0].message, /unfinished prerequisite/);

  state.assignments[1].status = 'pending';
  state.assignments[0].dependsOn = ['dependent'];
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  validation = await validateWorkspace({ root });
  assert.match(validation.errors[0].message, /DAG/);
});

test('raw Work Item references reject traversal and non-canonical identity before resolution', async (t) => {
  const root = await rootFixture(t);
  for (const reference of [
    '.agent-work/open/../open/plain-runtime/work.md',
    '.agent-work/open//plain-runtime/work.md',
    `${root}/.agent-work/open/plain-runtime/work.md`,
    '.agent-work\\open\\plain-runtime\\work.md',
  ]) {
    await assert.rejects(
      handoffCommand({ root, work: reference }),
      (error) => error.code === 'INVALID_INPUT' && /non-canonical/.test(error.message),
    );
  }
  await makeCompletable(root);
  await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  for (const reference of [
    '.agent-work/archive/2026/../2026/plain-runtime/work.md',
    '.agent-work/archive/2026//plain-runtime/work.md',
    `${root}/.agent-work/archive/2026/plain-runtime/work.md`,
  ]) {
    await assert.rejects(
      historyCommand({ root, work: reference }),
      (error) => error.code === 'INVALID_INPUT' && /non-canonical/.test(error.message),
    );
  }
});

test('paired work publication recovers changed Markdown and state-only crash windows', { concurrency: false }, async (t) => {
  await t.test('changed Markdown', async (t) => {
    const root = await rootFixture(t);
    process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_WORK = '1';
    try {
      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: { status: 'paused' } }),
        (error) => error.code === 'ATOMIC_FAILURE',
      );
    } finally { delete process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_WORK; }
    assert.equal((await listCommand({ root, input: {} }))[0].status, 'paused');
    assert.match(await readFile(path.join(root, '.agent-work/open/plain-runtime/work.md'), 'utf8'), /^Status: paused$/m);
    await assert.rejects(stat(path.join(root, '.agent-work/open/plain-runtime/.pair.commit.json')), { code: 'ENOENT' });
  });

  await t.test('state-only mutation', async (t) => {
    const root = await rootFixture(t);
    const workFile = path.join(root, '.agent-work/open/plain-runtime/work.md');
    const before = await readFile(workFile, 'utf8');
    process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_WORK = '1';
    try {
      await assert.rejects(
        todoCommand({ root, work: 'plain-runtime', owner: 'main', action: 'add', now, input: { id: 'recover-state', text: 'Recover state.' } }),
        (error) => error.code === 'ATOMIC_FAILURE',
      );
    } finally { delete process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_WORK; }
    await listCommand({ root, input: {} });
    assert.equal(await readFile(workFile, 'utf8'), before);
    const state = JSON.parse(await readFile(path.join(path.dirname(workFile), 'state.json'), 'utf8'));
    assert.equal(state.todos.some(({ id }) => id === 'recover-state'), true);
  });
});

test('project lock serializes a cross-process reader across the pre-journal pair window', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const barrier = path.join(root, 'pair-publication-barrier');
  const writer = spawnWorkflowExpression(`
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: { status: 'paused' },
    });
    process.stdout.write(JSON.stringify(result));
  `, { WORKFLOW_TEST_PAIR_PRE_JOURNAL_BARRIER: barrier });
  t.after(() => writer.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);

  const reader = spawnWorkflowExpression(`
    const { listCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await listCommand({ root: ${JSON.stringify(root)}, input: {} });
    process.stdout.write(JSON.stringify(result));
  `);
  t.after(() => reader.child.kill('SIGKILL'));
  assert.equal(await Promise.race([reader.completed.then(() => 'exited'), delay(150, 'waiting')]), 'waiting');
  const directory = path.join(root, '.agent-work/open/plain-runtime');
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.pairtmp')).length, 2);
  await writeFile(`${barrier}.release`, 'release\n');
  const [writerResult, readerResult] = await Promise.all([writer.completed, reader.completed]);
  assert.equal(writerResult.code, 0, writerResult.stderr);
  assert.equal(readerResult.code, 0, readerResult.stderr);
  assert.equal(JSON.parse(readerResult.stdout)[0].status, 'paused');
  assert.equal((await readdir(directory)).some((name) => name.endsWith('.pairtmp') || name === '.pair.commit.json'), false);
});

test('simultaneous completion commands serialize and return the same bounded receipt', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  const barrier = path.join(root, 'complete-transaction-barrier');
  const expression = `
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: ${JSON.stringify(completeInput)},
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const first = spawnWorkflowExpression(expression, { WORKFLOW_TEST_COMPLETE_AFTER_DESCENDANTS_BARRIER: barrier });
  t.after(() => first.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);
  const second = spawnWorkflowExpression(expression);
  t.after(() => second.child.kill('SIGKILL'));
  assert.equal(await Promise.race([second.completed.then(() => 'exited'), delay(150, 'waiting')]), 'waiting');
  await writeFile(`${barrier}.release`, 'release\n');
  const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.equal(secondResult.code, 0, secondResult.stderr);
  assert.deepEqual(JSON.parse(secondResult.stdout), JSON.parse(firstResult.stdout));
});

test('atomic directory lock survives 12 by 12 completion and Todo contention', { concurrency: false, timeout: 120_000 }, async (t) => {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const completeRoot = await rootFixture(t);
    await makeCompletable(completeRoot);
    const completes = Array.from({ length: 12 }, () => spawnWorkflowExpression(`
      const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
      const result = await workCommand({
        root: ${JSON.stringify(completeRoot)}, work: 'plain-runtime', owner: 'main',
        now: new Date(${JSON.stringify(now.toISOString())}), input: ${JSON.stringify(completeInput)},
      });
      process.stdout.write(JSON.stringify(result));
    `));
    for (const operation of completes) t.after(() => operation.child.kill('SIGKILL'));
    const completionResults = await Promise.all(completes.map(({ completed }) => completed));
    assert.equal(completionResults.every(({ code }) => code === 0), true, completionResults.map(({ stderr }) => stderr).join('\n'));
    const receipts = completionResults.map(({ stdout }) => JSON.parse(stdout));
    assert.equal(receipts.every((receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0])), true);
    assert.equal((await historyCommand({ root: completeRoot, work: 'plain-runtime' })).work, receipts[0].work);

    const todoRoot = await rootFixture(t);
    const todos = Array.from({ length: 12 }, (_, worker) => spawnWorkflowExpression(`
      const { todoCommand } = await import(${JSON.stringify(workflowCoreUrl)});
      const result = await todoCommand({
        root: ${JSON.stringify(todoRoot)}, work: 'plain-runtime', owner: 'main', action: 'add',
        now: new Date(${JSON.stringify(now.toISOString())}), input: { id: 'stress-${iteration}-${worker}', text: 'Stress ${iteration}-${worker}.' },
      });
      process.stdout.write(JSON.stringify(result));
    `));
    for (const operation of todos) t.after(() => operation.child.kill('SIGKILL'));
    const todoResults = await Promise.all(todos.map(({ completed }) => completed));
    assert.equal(todoResults.every(({ code }) => code === 0), true, todoResults.map(({ stderr }) => stderr).join('\n'));
    const state = JSON.parse(await readFile(path.join(todoRoot, '.agent-work/open/plain-runtime/state.json'), 'utf8'));
    for (let worker = 0; worker < 12; worker += 1) assert.equal(state.todos.some(({ id }) => id === `stress-${iteration}-${worker}`), true);
    assert.equal((await listCommand({ root: todoRoot, input: {} }))[0].status, 'active');
  }
});

test('parent completion excludes a concurrently requested active child creation', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  const barrier = path.join(root, 'parent-complete-barrier');
  const completion = spawnWorkflowExpression(`
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: ${JSON.stringify(completeInput)},
    });
    process.stdout.write(JSON.stringify(result));
  `, { WORKFLOW_TEST_COMPLETE_AFTER_DESCENDANTS_BARRIER: barrier });
  t.after(() => completion.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);
  const child = spawnWorkflowExpression(`
    const { createWork } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await createWork({
      root: ${JSON.stringify(root)}, owner: 'main', childOnly: true,
      now: new Date(${JSON.stringify(now.toISOString())}),
      input: {
        id: 'raced-child', name: 'Raced child', parent: 'plain-runtime', goal: 'Never appear mid-close.',
        successCriteria: ['The race is excluded.'],
        eligibility: { independentlyAcceptable: true, withinParentScope: true, plannedTodos: ['One', 'Two'], plannedRoles: [] },
      },
    });
    process.stdout.write(JSON.stringify(result));
  `);
  t.after(() => child.child.kill('SIGKILL'));
  assert.equal(await Promise.race([child.completed.then(() => 'exited'), delay(150, 'waiting')]), 'waiting');
  await writeFile(`${barrier}.release`, 'release\n');
  const [completionResult, childResult] = await Promise.all([completion.completed, child.completed]);
  assert.equal(completionResult.code, 0, completionResult.stderr);
  assert.notEqual(childResult.code, 0);
  assert.match(childResult.stderr, /WORK_NOT_FOUND|work not found/);
  assert.equal((await readdir(path.join(root, '.agent-work/open'))).includes('plain-runtime'), false);
});

test('crashed lock owner is reclaimed by process-start identity and pair residue recovers', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const barrier = path.join(root, 'crashed-lock-barrier');
  const writer = spawnWorkflowExpression(`
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: { status: 'paused' },
    });
  `, { WORKFLOW_TEST_PAIR_PRE_JOURNAL_BARRIER: barrier });
  await waitForFile(`${barrier}.ready`);
  const lock = JSON.parse(await readFile(path.join(root, '.agent-work.workflow.lock/owner.json'), 'utf8'));
  assert.ok(typeof lock.process_start === 'string' || lock.process_start === null);
  assert.equal(lock.heartbeat_ms, 2_000);
  writer.child.kill('SIGKILL');
  await writer.completed;
  assert.equal((await listCommand({ root, input: {} }))[0].status, 'active');
  assert.equal((await readdir(root)).some((name) => name.startsWith('.agent-work.workflow.lock')), false);
});

test('live pre-owner lock creator is never reclaimed by age and dead creator is recoverable', { concurrency: false, timeout: 30_000 }, async (t) => {
  const root = await rootFixture(t);
  const expression = `
    const { listCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    process.stdout.write(JSON.stringify(await listCommand({ root: ${JSON.stringify(root)}, input: {} })));
  `;
  const barrier = path.join(root, 'creator-claim-barrier');
  const creator = spawnWorkflowExpression(expression, { WORKFLOW_TEST_LOCK_CREATOR_BARRIER: barrier });
  t.after(() => creator.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);
  await stat(path.join(root, '.agent-work.workflow.lock'));
  await assert.rejects(stat(path.join(root, '.agent-work.workflow.lock/owner.json')), { code: 'ENOENT' });
  await delay(6_200);
  const contender = spawnWorkflowExpression(expression);
  t.after(() => contender.child.kill('SIGKILL'));
  assert.equal(await Promise.race([contender.completed.then(() => 'exited'), delay(200, 'waiting')]), 'waiting');
  await writeFile(`${barrier}.release`, 'release\n');
  const [creatorResult, contenderResult] = await Promise.all([creator.completed, contender.completed]);
  assert.equal(creatorResult.code, 0, creatorResult.stderr);
  assert.equal(contenderResult.code, 0, contenderResult.stderr);

  const deadBarrier = path.join(root, 'dead-creator-claim-barrier');
  const deadCreator = spawnWorkflowExpression(expression, { WORKFLOW_TEST_LOCK_CREATOR_BARRIER: deadBarrier });
  await waitForFile(`${deadBarrier}.ready`);
  await stat(path.join(root, '.agent-work.workflow.lock'));
  await assert.rejects(stat(path.join(root, '.agent-work.workflow.lock/owner.json')), { code: 'ENOENT' });
  deadCreator.child.kill('SIGKILL');
  await deadCreator.completed;
  const recovered = spawnWorkflowExpression(expression);
  t.after(() => recovered.child.kill('SIGKILL'));
  const recoveredResult = await recovered.completed;
  assert.equal(recoveredResult.code, 0, recoveredResult.stderr);
  await assert.rejects(stat(path.join(root, '.agent-work.workflow.lock.creator')), { code: 'ENOENT' });
});

test('killed lock waiters leave no unbounded owner residue', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const barrier = path.join(root, 'waiter-cleanup-barrier');
  const holder = spawnWorkflowExpression(`
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: { status: 'paused' },
    });
  `, { WORKFLOW_TEST_PAIR_PRE_JOURNAL_BARRIER: barrier });
  t.after(() => holder.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);
  const waiters = Array.from({ length: 4 }, () => spawnWorkflowExpression(`
    const { listCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    await listCommand({ root: ${JSON.stringify(root)}, input: {} });
  `));
  for (const waiter of waiters) t.after(() => waiter.child.kill('SIGKILL'));
  await delay(150);
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith('.agent-work.workflow.lock')).sort(), [
    '.agent-work.workflow.lock',
    '.agent-work.workflow.lock.creator',
  ]);
  for (const waiter of waiters) waiter.child.kill('SIGKILL');
  await Promise.all(waiters.map(({ completed }) => completed));
  await writeFile(`${barrier}.release`, 'release\n');
  assert.equal((await holder.completed).code, 0);
  await listCommand({ root, input: {} });
  assert.equal((await readdir(root)).some((name) => name.startsWith('.agent-work.workflow.lock')), false);
});

test('orphan pair temps are removed deterministically and never enter archive content', async (t) => {
  const root = await rootFixture(t);
  const directory = path.join(root, '.agent-work/open/plain-runtime');
  const orphan = path.join(directory, '.work.md.00000000-0000-0000-0000-000000000000.pairtmp');
  await writeFile(orphan, 'orphan semantic bytes\n');
  await listCommand({ root, input: {} });
  await assert.rejects(stat(orphan), { code: 'ENOENT' });
  await makeCompletable(root);
  const closed = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  const archivedNames = await readdir(path.dirname(path.join(root, closed.work)));
  assert.equal(archivedNames.some((name) => name === '.pair.commit.json' || name.endsWith('.pairtmp')), false);
});

test('symlinked orphan pair temp fails closed instead of being followed or archived', async (t) => {
  const root = await rootFixture(t);
  const external = await mkdtemp(path.join(tmpdir(), 'workflow-pairtmp-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const marker = path.join(external, 'keep.txt');
  await writeFile(marker, 'unrelated\n');
  await symlink(marker, path.join(root, '.agent-work/open/plain-runtime/.state.json.00000000-0000-0000-0000-000000000000.pairtmp'));
  await assert.rejects(listCommand({ root, input: {} }), (error) => error.code === 'INVALID_DOCUMENT');
  assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
});

test('static root, open, archive, and index substitution fails closed', { concurrency: false }, async (t) => {
  await t.test('existing project through symlinked ancestor', async (t) => {
    const container = await realpath(await mkdtemp(path.join(tmpdir(), 'workflow-ancestor-container-')));
    t.after(() => rm(container, { recursive: true, force: true }));
    const actualParent = path.join(container, 'actual-parent');
    const project = path.join(actualParent, 'project');
    const linkedParent = path.join(container, 'linked-parent');
    await mkdir(project, { recursive: true });
    const marker = path.join(project, 'keep.txt');
    await writeFile(marker, 'unrelated\n');
    await symlink(actualParent, linkedParent);
    await assert.rejects(
      createWork({ root: path.join(linkedParent, 'project'), input: input({ id: 'linked-project-work' }), now }),
      (error) => error.code === 'INVALID_WORKSPACE' && /symlinked ancestor/.test(error.message),
    );
    assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
  });

  await t.test('project root symlink', async (t) => {
    const external = await mkdtemp(path.join(tmpdir(), 'workflow-root-external-'));
    const link = `${external}-link`;
    t.after(() => rm(external, { recursive: true, force: true }));
    t.after(() => rm(link, { force: true }));
    await writeFile(path.join(external, 'keep.txt'), 'unrelated\n');
    await symlink(external, link);
    await assert.rejects(
      createWork({ root: link, input: input({ id: 'through-link' }), now }),
      (error) => error.code === 'INVALID_WORKSPACE',
    );
    assert.equal(await readFile(path.join(external, 'keep.txt'), 'utf8'), 'unrelated\n');
  });

  await t.test('project lock symlink', async (t) => {
    const root = await rootFixture(t);
    const external = await mkdtemp(path.join(tmpdir(), 'workflow-lock-external-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    const marker = path.join(external, 'keep.txt');
    await writeFile(marker, 'unrelated\n');
    await symlink(marker, path.join(root, '.agent-work.workflow.lock'));
    await assert.rejects(listCommand({ root, input: {} }), (error) => error.code === 'INVALID_WORKSPACE');
    assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
  });

  await t.test('identity-bound dead-owner lock recovery', async (t) => {
    const root = await rootFixture(t);
    const lock = path.join(root, '.agent-work.workflow.lock');
    const nonce = '00000000-0000-0000-0000-000000000000';
    await mkdir(lock);
    await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({
      version: 2, pid: 2_147_483_647, nonce, process_start: 'test:dead-owner', heartbeat_ms: 2_000, created_at: now.toISOString(),
    })}\n`);
    assert.equal((await listCommand({ root, input: {} }))[0].status, 'active');
    await assert.rejects(stat(lock), { code: 'ENOENT' });
  });

  await t.test('unproven dead-owner lock substitution survives fail-closed recovery', async (t) => {
    const root = await rootFixture(t);
    const lock = path.join(root, '.agent-work.workflow.lock');
    const marker = path.join(lock, 'unrelated.txt');
    await mkdir(lock);
    await writeFile(marker, 'unrelated\n');
    await assert.rejects(listCommand({ root, input: {} }), (error) => error.code === 'LOCKED');
    assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
  });

  await t.test('open root', async (t) => {
    const root = await rootFixture(t);
    const external = await mkdtemp(path.join(tmpdir(), 'workflow-open-external-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    const openRoot = path.join(root, '.agent-work/open');
    await rename(openRoot, `${openRoot}.saved`);
    await symlink(external, openRoot);
    await assert.rejects(listCommand({ root, input: {} }), (error) => error.code === 'INVALID_ARCHIVE');
  });

  for (const boundary of ['archive', 'index']) {
    await t.test(boundary, async (t) => {
      const root = await rootFixture(t);
      await makeCompletable(root);
      await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
      const external = await mkdtemp(path.join(tmpdir(), `workflow-${boundary}-external-`));
      t.after(() => rm(external, { recursive: true, force: true }));
      const marker = path.join(external, 'keep.txt');
      await writeFile(marker, 'unrelated\n');
      if (boundary === 'archive') {
        const archiveRoot = path.join(root, '.agent-work/archive');
        await rename(archiveRoot, `${archiveRoot}.saved`);
        await symlink(external, archiveRoot);
      } else {
        const indexFile = path.join(root, '.agent-work/archive/index.md');
        await rename(indexFile, `${indexFile}.saved`);
        await symlink(marker, indexFile);
      }
      await assert.rejects(listCommand({ root, input: { history: true } }), (error) => ['INVALID_ARCHIVE', 'INVALID_WORKSPACE'].includes(error.code));
      assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
    });
  }
});

test('exported open document reads reject raw traversal before normalization', async (t) => {
  const root = await rootFixture(t);
  const traversing = `${root}/.agent-work/open/plain-runtime/../plain-runtime/work.md`;
  await assert.rejects(
    readAt(traversing),
    (error) => error.code === 'INVALID_WORKSPACE' && /traversal syntax/.test(error.message),
  );
});

test('archive publication failures preserve resumable open work and history discovery reads only the index', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY = '1';
  try {
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY;
  }
  assert.match(await readFile(path.join(root, '.agent-work/open/plain-runtime/work.md'), 'utf8'), /Status: active/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.agent-work/open/plain-runtime/state.json'), 'utf8')).status, 'active');
  await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
  assert.equal((await listCommand({ root, input: {} })).length, 1);
  assert.deepEqual(await listCommand({ root, input: { history: true } }), []);

  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_PUBLISH = '1';
  try {
    await assert.rejects(
      workCommand({
        root, work: 'plain-runtime', owner: 'main', now,
        input: completeInput,
      }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_PUBLISH;
  }
  assert.match(await readFile(path.join(root, '.agent-work/open/plain-runtime/work.md'), 'utf8'), /Status: active/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.agent-work/open/plain-runtime/state.json'), 'utf8')).status, 'active');
  await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
  assert.equal((await listCommand({ root, input: {} })).length, 1);
  assert.deepEqual(await listCommand({ root, input: { history: true } }), []);
  await stat(path.join(root, '.agent-work/archive/2026/plain-runtime/work.md'));

  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_INDEX = '1';
  try {
    await assert.rejects(
      workCommand({
        root, work: 'plain-runtime', owner: 'main', now,
        input: completeInput,
      }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_INDEX;
  }
  assert.match(await readFile(path.join(root, '.agent-work/open/plain-runtime/work.md'), 'utf8'), /Status: active/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.agent-work/open/plain-runtime/state.json'), 'utf8')).status, 'active');
  await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
  assert.equal((await listCommand({ root, input: {} })).length, 1);
  assert.equal((await listCommand({ root, input: { history: true } })).length, 1);
  assert.equal((await readdir(path.join(root, '.agent-work/archive/2026'))).some((name) => name.endsWith('.stage')), false);

  const closed = await workCommand({
    root, work: 'plain-runtime', owner: 'main', now,
    input: completeInput,
  });
  const archiveIndex = await readFile(path.join(root, '.agent-work/archive/index.md'), 'utf8');
  assert.match(archiveIndex, /\| ID \| Title \| Summary \| Status \| Path \|/);
  assert.doesNotMatch(archiveIndex, /\| Type \|/);
  await assert.rejects(stat(path.join(root, '.agent-work/open/plain-runtime')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
  assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
  const archiveFile = path.join(root, closed.work);
  await writeFile(archiveFile, '# Corrupted body that cannot satisfy indexed discovery\n');
  assert.equal((await findCommand({ root, input: { query: 'plain runtime', history: true } }))[0].name, 'Plain runtime');
  assert.equal((await listCommand({ root, input: { history: true } }))[0].summary, 'Deliver a plain Markdown runtime.');
  assert.equal((await historyCommand({ root, work: 'plain-runtime' })).markdown, '# Corrupted body that cannot satisfy indexed discovery\n');
});

test('initialization prunes only identity-bound stale archive attempts and old empty pre-journal stages', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY = '1';
  try {
    await assert.rejects(workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }), { code: 'ATOMIC_FAILURE' });
  } finally { delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY; }
  const attemptRoot = path.join(root, '.agent-work/archive-attempts');
  const [attemptName] = await readdir(attemptRoot);
  const attemptFile = path.join(attemptRoot, attemptName);
  const proof = JSON.parse(await readFile(attemptFile, 'utf8'));
  const failedStage = path.join(root, ...proof.stage.split('/'));
  await stat(path.join(failedStage, 'work.md'));
  proof.created_at = new Date(0).toISOString();
  await writeFile(attemptFile, `${JSON.stringify(proof, null, 2)}\n`);

  const unrelated = path.join(root, '.agent-work/recovery/unrelated-data');
  await mkdir(unrelated, { recursive: true });
  await writeFile(path.join(unrelated, 'keep.txt'), 'keep\n');
  const orphan = path.join(root, '.agent-work/archive/2026/.orphan-stage.00000000-0000-4000-8000-000000000000.stage');
  await mkdir(orphan);
  await utimes(orphan, new Date(0), new Date(0));

  await initWorkspace({ root, now });
  await assert.rejects(stat(failedStage), { code: 'ENOENT' });
  await assert.rejects(stat(orphan), { code: 'ENOENT' });
  assert.deepEqual(await readdir(attemptRoot), []);
  assert.equal(await readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep\n');
});

test('recovery rename is pre-journaled and retry prunes an interruption immediately after rename', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY = '1';
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_RECOVERY_RENAME = '1';
  try {
    await assert.rejects(workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }), { code: 'ATOMIC_FAILURE' });
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY;
    delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_RECOVERY_RENAME;
  }
  const [attemptName] = await readdir(path.join(root, '.agent-work/archive-attempts'));
  const proof = JSON.parse(await readFile(path.join(root, '.agent-work/archive-attempts', attemptName), 'utf8'));
  assert.match(proof.stage, /^\.agent-work\/recovery\/failed-/);
  assert.match(proof.previous_stage, /^\.agent-work\/archive\/\d{4}\/\./);
  await stat(path.join(root, ...proof.stage.split('/')));

  const result = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  assert.equal(result.archived, true);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/archive-attempts')), []);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/recovery')), []);
});

test('post-commit cleanup interruptions resume by identity and leave no cleanup or stage residue', { concurrency: false }, async (t) => {
  for (const injection of [
    'WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_RENAME',
    'WORKFLOW_TEST_FAIL_ARCHIVE_DURING_CLEANUP',
    'WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_CLEANUP_REMOVE',
    'WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_IDENTITY',
  ]) {
    await t.test(injection, async (t) => {
      const root = await rootFixture(t);
      await makeCompletable(root);
      process.env[injection] = '1';
      try {
        await assert.rejects(
          workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
          (error) => error.code === 'ATOMIC_FAILURE',
        );
      } finally {
        delete process.env[injection];
      }

      await assert.rejects(stat(path.join(root, '.agent-work/open/plain-runtime')), { code: 'ENOENT' });
      const cleanupState = path.join(root, '.agent-work/cleanup/plain-runtime/state.json');
      if (injection === 'WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_RENAME') {
        assert.equal(JSON.parse(await readFile(cleanupState, 'utf8')).id, 'plain-runtime');
      } else {
        await assert.rejects(stat(cleanupState), { code: 'ENOENT' });
        const proof = JSON.parse(await readFile(path.join(root, '.agent-work/cleanup/plain-runtime.commit.json'), 'utf8'));
        const quarantined = path.join(root, proof.quarantine);
        if (injection === 'WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_IDENTITY') assert.deepEqual(await readdir(quarantined), []);
        else assert.equal(JSON.parse(await readFile(path.join(quarantined, 'state.json'), 'utf8')).id, 'plain-runtime');
      }
      assert.equal((await listCommand({ root, input: { history: true } })).length, 1);

      const recovered = await workCommand({
        root, work: 'plain-runtime', owner: 'main', now, input: completeInput,
      });
      assert.equal(recovered.archived, true);
      assert.equal(typeof recovered.stage, 'string');
      await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
      assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
      assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup-quarantine')), []);
      assert.equal((await readdir(path.join(root, '.agent-work/archive/2026'))).some((name) => name.endsWith('.stage')), false);
    });
  }
});

test('cleanup commit journal survives creation and final-removal crash windows', { concurrency: false }, async (t) => {
  await t.test('journal published before source relocation', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_JOURNAL = '1';
    try {
      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
        (error) => error.code === 'ATOMIC_FAILURE',
      );
    } finally {
      delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_JOURNAL;
    }
    await stat(path.join(root, '.agent-work/open/plain-runtime/state.json'));
    await stat(path.join(root, '.agent-work/cleanup/plain-runtime.commit.json'));
    const closed = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
    assert.equal(closed.archived, true);
    assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
  });

  await t.test('source removed before journal removal', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    process.env.WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_JOURNAL_REMOVE = '1';
    try {
      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
        (error) => error.code === 'ATOMIC_FAILURE',
      );
    } finally {
      delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_JOURNAL_REMOVE;
    }
    await assert.rejects(stat(path.join(root, '.agent-work/cleanup/plain-runtime')), { code: 'ENOENT' });
    await stat(path.join(root, '.agent-work/cleanup/plain-runtime.commit.json'));
    const recovered = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
    assert.equal(typeof recovered.stage, 'string');
    assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
  });
});

test('cleanup deletion rejects substituted symlink boundaries and never touches external files', { concurrency: false }, async (t) => {
  for (const boundary of ['target', 'cleanup-root', 'agent-work']) {
    await t.test(boundary, async (t) => {
      const root = await rootFixture(t);
      const external = await mkdtemp(path.join(tmpdir(), 'workflow-external-'));
      t.after(() => rm(external, { recursive: true, force: true }));
      const marker = path.join(external, 'keep.txt');
      await writeFile(marker, 'unrelated\n');
      await makeCompletable(root);
      await interruptAfterCleanupRename(root);

      if (boundary === 'target') {
        const target = path.join(root, '.agent-work/cleanup/plain-runtime');
        await rename(target, `${target}.saved`);
        await symlink(external, target);
      } else if (boundary === 'cleanup-root') {
        const cleanupRoot = path.join(root, '.agent-work/cleanup');
        await rename(cleanupRoot, path.join(root, '.agent-work/cleanup-saved'));
        await symlink(external, cleanupRoot);
      } else {
        const agentWork = path.join(root, '.agent-work');
        await rename(agentWork, path.join(root, '.agent-work-saved'));
        await symlink(external, agentWork);
      }

      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
        (error) => error.code === 'INVALID_ARCHIVE',
      );
      assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
    });
  }
});

test('quarantine detachment makes later cleanup-path swaps harmless', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const external = await mkdtemp(path.join(tmpdir(), 'workflow-quarantine-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const marker = path.join(external, 'keep.txt');
  await writeFile(marker, 'unrelated\n');
  await makeCompletable(root);
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_QUARANTINE_RENAME = '1';
  try {
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally { delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_QUARANTINE_RENAME; }
  const cleanup = path.join(root, '.agent-work/cleanup/plain-runtime');
  await symlink(external, cleanup);
  await assert.rejects(
    workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
    (error) => error.code === 'INVALID_ARCHIVE',
  );
  assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
});

test('project lock excludes compliant readers while private quarantine removal is in progress', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  const barrier = path.join(root, 'cleanup-removal-barrier');
  const writer = spawnWorkflowExpression(`
    const { workCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await workCommand({
      root: ${JSON.stringify(root)}, work: 'plain-runtime', owner: 'main',
      now: new Date(${JSON.stringify(now.toISOString())}), input: ${JSON.stringify(completeInput)},
    });
    process.stdout.write(JSON.stringify(result));
  `, { WORKFLOW_TEST_CLEANUP_PRE_REMOVE_BARRIER: barrier });
  t.after(() => writer.child.kill('SIGKILL'));
  await waitForFile(`${barrier}.ready`);
  const proof = JSON.parse(await readFile(path.join(root, '.agent-work/cleanup/plain-runtime.commit.json'), 'utf8'));
  await stat(path.join(root, ...proof.quarantine.split('/')));

  const reader = spawnWorkflowExpression(`
    const { listCommand } = await import(${JSON.stringify(workflowCoreUrl)});
    const result = await listCommand({ root: ${JSON.stringify(root)}, input: {} });
    process.stdout.write(JSON.stringify(result));
  `);
  t.after(() => reader.child.kill('SIGKILL'));
  assert.equal(await Promise.race([reader.completed.then(() => 'exited'), delay(150, 'waiting')]), 'waiting');
  await writeFile(`${barrier}.release`, 'release\n');
  const [writerResult, readerResult] = await Promise.all([writer.completed, reader.completed]);
  assert.equal(writerResult.code, 0, writerResult.stderr);
  assert.equal(readerResult.code, 0, readerResult.stderr);
  assert.deepEqual(JSON.parse(readerResult.stdout), []);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup-quarantine')), []);
});

test('cleanup authorization is bound to real directory identity across source and quarantine swaps', { concurrency: false }, async (t) => {
  await t.test('cleanup source replacement', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    await interruptAfterCleanupRename(root);
    const cleanup = path.join(root, '.agent-work/cleanup/plain-runtime');
    const saved = `${cleanup}.authorized`;
    await rename(cleanup, saved);
    await cp(saved, cleanup, { recursive: true });
    const marker = path.join(cleanup, 'replacement-only.txt');
    await writeFile(marker, 'unrelated replacement\n');
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /object identity changed/.test(error.message),
    );
    assert.equal(await readFile(marker, 'utf8'), 'unrelated replacement\n');
    await stat(saved);
  });

  await t.test('quarantine replacement', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_QUARANTINE_RENAME = '1';
    try {
      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
        (error) => error.code === 'ATOMIC_FAILURE',
      );
    } finally { delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_QUARANTINE_RENAME; }
    const proof = JSON.parse(await readFile(path.join(root, '.agent-work/cleanup/plain-runtime.commit.json'), 'utf8'));
    const quarantine = path.join(root, proof.quarantine);
    const saved = `${quarantine}.authorized`;
    await rename(quarantine, saved);
    await cp(saved, quarantine, { recursive: true });
    const marker = path.join(quarantine, 'replacement-only.txt');
    await writeFile(marker, 'unrelated replacement\n');
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /object identity changed/.test(error.message),
    );
    assert.equal(await readFile(marker, 'utf8'), 'unrelated replacement\n');
    await stat(saved);
  });
});

test('cleanup removes descendant symlinks themselves without following their external targets', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const external = await mkdtemp(path.join(tmpdir(), 'workflow-descendant-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const marker = path.join(external, 'keep.txt');
  await writeFile(marker, 'unrelated\n');
  await makeCompletable(root);
  await interruptAfterCleanupRename(root);
  await symlink(external, path.join(root, '.agent-work/cleanup/plain-runtime/external-link'));

  const recovered = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  assert.equal(typeof recovered.stage, 'string');
  assert.equal(await readFile(marker, 'utf8'), 'unrelated\n');
  assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
});

test('cleanup recovery requires the complete parent-child archive manifest and untampered journal', { concurrency: false }, async (t) => {
  await t.test('missing child Markdown', async (t) => {
    const root = await rootFixture(t);
    await completeChild(root);
    await makeCompletable(root);
    await interruptAfterCleanupRename(root);
    await rm(path.join(root, '.agent-work/archive/2026/plain-runtime/children/proof-child/work.md'));
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /manifest mismatch/.test(error.message),
    );
    await stat(path.join(root, '.agent-work/cleanup/plain-runtime'));
  });

  await t.test('tampered journal digest', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    await interruptAfterCleanupRename(root);
    const journalFile = path.join(root, '.agent-work/cleanup/plain-runtime.commit.json');
    const journal = JSON.parse(await readFile(journalFile, 'utf8'));
    journal.manifest.find((entry) => entry.type === 'file').sha256 = '0'.repeat(64);
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /manifest mismatch/.test(error.message),
    );
    await stat(path.join(root, '.agent-work/cleanup/plain-runtime'));
  });

  await t.test('tampered journal scope', async (t) => {
    const root = await rootFixture(t);
    await makeCompletable(root);
    await interruptAfterCleanupRename(root);
    const journalFile = path.join(root, '.agent-work/cleanup/plain-runtime.commit.json');
    const journal = JSON.parse(await readFile(journalFile, 'utf8'));
    journal.source = '.agent-work/open/different-work';
    await writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /source mismatch/.test(error.message),
    );
    await stat(path.join(root, '.agent-work/cleanup/plain-runtime'));
  });
});

test('staging child symlink race fails before link rewrite and preserves external Markdown', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await completeChild(root);
  await makeCompletable(root);
  const external = await mkdtemp(path.join(tmpdir(), 'workflow-stage-race-external-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  const externalWork = path.join(external, 'work.md');
  await writeFile(externalWork, '# External must survive\n\nStatus: active\n');
  process.env.WORKFLOW_TEST_ARCHIVE_CHILD_SYMLINK_TARGET = external;
  try {
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'INVALID_ARCHIVE' && /symlink/.test(error.message),
    );
  } finally { delete process.env.WORKFLOW_TEST_ARCHIVE_CHILD_SYMLINK_TARGET; }
  assert.equal(await readFile(externalWork, 'utf8'), '# External must survive\n\nStatus: active\n');
  await stat(path.join(root, '.agent-work/open/plain-runtime/work.md'));
});

test('cleanup recovery rejects changed archive index summary, status, or path', { concurrency: false }, async (t) => {
  const mutations = {
    summary: (text) => text.replace('Deliver a plain Markdown runtime.', 'Changed summary.'),
    status: (text) => text.replace('| completed | .agent-work/archive/2026/plain-runtime/work.md |', '| cancelled | .agent-work/archive/2026/plain-runtime/work.md |'),
    path: (text) => text.replace('.agent-work/archive/2026/plain-runtime/work.md', '.agent-work/archive/2026/changed/work.md'),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const root = await rootFixture(t);
      await makeCompletable(root);
      await interruptAfterCleanupRename(root);
      const indexFile = path.join(root, '.agent-work/archive/index.md');
      await writeFile(indexFile, mutate(await readFile(indexFile, 'utf8')));
      await assert.rejects(
        workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
        (error) => error.code === 'INVALID_ARCHIVE',
      );
      await stat(path.join(root, '.agent-work/cleanup/plain-runtime'));
    });
  }
});

test('history index rejects malformed, truncated, and traversal rows without rewriting them', { concurrency: false }, async (t) => {
  const mutations = {
    malformed: (text) => `${text}not a table row\n`,
    truncated: (text) => text.replace(/\n$/, ''),
    traversal: (text) => text.replace('.agent-work/archive/2026/plain-runtime/work.md', '.agent-work/archive/2026/plain-runtime/../outside/work.md'),
    extraColumn: (text) => text.replace(' | completed |', ' | unexpected | completed |'),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const root = await rootFixture(t);
      await makeCompletable(root);
      await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
      const indexFile = path.join(root, '.agent-work/archive/index.md');
      const tampered = mutate(await readFile(indexFile, 'utf8'));
      await writeFile(indexFile, tampered);
      await assert.rejects(listCommand({ root, input: { history: true } }), (error) => error.code === 'INVALID_ARCHIVE');
      assert.equal(await readFile(indexFile, 'utf8'), tampered);
      await assert.rejects(historyCommand({ root, work: 'plain-runtime' }), (error) => error.code === 'INVALID_ARCHIVE');
    });
  }
});

test('completion retry returns the same response after final cleanup and keeps only a minimal receipt', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  await makeCompletable(root);
  process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_FINAL_CLEANUP = '1';
  try {
    await assert.rejects(
      workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally { delete process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_FINAL_CLEANUP; }
  assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup')), []);
  assert.deepEqual(await readdir(path.join(root, '.agent-work/cleanup-quarantine')), []);
  const retry = await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  assert.deepEqual(retry, {
    ok: true,
    status: 'completed',
    stage: 'align',
    work: '.agent-work/archive/2026/plain-runtime/work.md',
    archived: true,
  });
  const receiptText = await readFile(path.join(root, '.agent-work/completion-receipts/plain-runtime.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(receiptText)).sort(), ['id', 'result', 'version', 'work']);
  for (const forbidden of ['assignments', 'receipt', 'owner', 'lease', 'todos', 'verification']) assert.equal(receiptText.includes(forbidden), false);
});

test('completion receipt retention is bounded immediately after publication', { concurrency: false }, async (t) => {
  const root = await rootFixture(t);
  const receiptRoot = path.join(root, '.agent-work/completion-receipts');
  for (let index = 0; index < 129; index += 1) {
    const file = path.join(receiptRoot, `old-receipt-${index}.json`);
    await writeFile(file, '{}\n');
    await utimes(file, new Date(0), new Date(0));
  }
  await makeCompletable(root);
  await workCommand({ root, work: 'plain-runtime', owner: 'main', now, input: completeInput });
  const receipts = await readdir(receiptRoot);
  assert.equal(receipts.length, 128);
  assert.equal(receipts.includes('plain-runtime.json'), true);
});

test('result and verification gates reconcile before close, then archive the complete tree without JSON', async (t) => {
  const root = await rootFixture(t);
  await createWork({
    root, owner: 'main', childOnly: true, now,
    input: input({
      id: 'archived-child', name: 'Archived child', parent: 'plain-runtime',
      goal: 'Deliver an archived child.', successCriteria: ['The child is delivered.'],
      eligibility: {
        independentlyAcceptable: true, withinParentScope: true,
        plannedTodos: ['Deliver', 'Confirm'], plannedRoles: [],
      },
    }),
  });
  await claimWork({ root, work: 'archived-child', owner: 'child-main', now });
  await createWork({
    root, owner: 'child-main', childOnly: true, now,
    input: input({
      id: 'archived-grandchild', name: 'Archived grandchild', parent: 'archived-child',
      goal: 'Deliver an archived grandchild.', successCriteria: ['The grandchild is delivered.'],
      eligibility: {
        independentlyAcceptable: true, withinParentScope: true,
        plannedTodos: ['Deliver', 'Confirm'], plannedRoles: [],
      },
    }),
  });
  await claimWork({ root, work: 'archived-grandchild', owner: 'grandchild-main', now });
  await workCommand({
    root, work: 'archived-grandchild', owner: 'grandchild-main', action: 'evidence', now,
    input: { criterion: 'The grandchild is delivered.', evidence: 'Grandchild delivery inspected.', pointers: [] },
  });
  await workCommand({
    root, work: 'archived-grandchild', owner: 'grandchild-main', now,
    input: { status: 'completed', completeTodo: 'align-goal', result: 'Archived grandchild delivered.' },
  });
  await childSync({ root, work: 'archived-child', owner: 'child-main', input: { id: 'archived-grandchild' }, now });
  await workCommand({
    root, work: 'archived-child', owner: 'child-main', action: 'evidence', now,
    input: { criterion: 'The child is delivered.', evidence: 'Child delivery inspected.', pointers: [] },
  });
  await workCommand({
    root, work: 'archived-child', owner: 'child-main', now,
    input: { status: 'completed', completeTodo: 'align-goal', result: 'Archived child delivered.' },
  });
  await childSync({ root, work: 'plain-runtime', owner: 'main', input: { id: 'archived-child' }, now });
  await assignment(root, 'dev-runtime', 'development');
  await voteCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'record', now,
    input: {
      role: 'main', requiresTest: true, testReason: 'Exercise the runtime.',
      requiresReview: true, reviewReason: 'Review ownership and archive semantics.',
    },
  });
  const decisions = await voteCommand({ root, work: 'plain-runtime', owner: 'main', action: 'compute', input: {}, now });
  assert.equal(decisions.decisions.test.execute, true);
  assert.equal(decisions.decisions.review.execute, true);
  await assert.rejects(
    workCommand({
      root, work: 'plain-runtime', owner: 'main', now,
      input: { status: 'completed', completeTodo: 'align-goal', result: 'Delivered.' },
    }),
    (error) => error.code === 'MISSING_SUCCESS_EVIDENCE',
  );
  await assignment(root, 'test-runtime', 'test');
  await assignment(root, 'review-runtime', 'review');
  await workCommand({
    root, work: 'plain-runtime', owner: 'main', action: 'evidence', now,
    input: { criterion: 'The runtime is verified.', evidence: 'Test and Review checks passed.', pointers: ['src/runtime.mjs'] },
  });
  const closed = await workCommand({
    root, work: 'plain-runtime', owner: 'main', now,
    input: {
      status: 'completed', completeTodo: 'align-goal', result: 'Delivered the plain runtime.',
      artifacts: [{ path: 'src/runtime.mjs', purpose: 'Authoritative runtime implementation.' }],
    },
  });
  assert.equal(closed.archived, true);
  assert.deepEqual(await listCommand({ root, input: {} }), []);
  await assert.rejects(stat(path.join(root, '.agent-work/open/plain-runtime')), { code: 'ENOENT' });
  const archived = path.join(root, closed.work);
  await stat(archived);
  await assert.rejects(stat(path.join(path.dirname(archived), 'state.json')), { code: 'ENOENT' });
  const archivedChild = path.join(path.dirname(archived), 'children', 'archived-child');
  await stat(path.join(archivedChild, 'work.md'));
  await assert.rejects(stat(path.join(archivedChild, 'state.json')), { code: 'ENOENT' });
  const archivedGrandchild = path.join(archivedChild, 'children', 'archived-grandchild', 'work.md');
  await stat(archivedGrandchild);
  const markdown = await readFile(archived, 'utf8');
  assert.match(markdown, /Status: completed/);
  assert.match(markdown, /- \[x\] The runtime is verified\. \u2014 Evidence: Test and Review checks passed\./);
  assert.match(markdown, /- \[ \] Confirm the outcome, scope, and acceptance\./);
  assert.match(markdown, /Artifact: `src\/runtime\.mjs`/);
  const childLink = /\[Archived child\]\(([^)]+)\)/.exec(markdown)?.[1];
  assert.equal(path.resolve(path.dirname(archived), childLink), path.join(archivedChild, 'work.md'));
  await stat(path.resolve(path.dirname(archived), childLink));
  const childMarkdown = await readFile(path.join(archivedChild, 'work.md'), 'utf8');
  const grandchildLink = /\[Archived grandchild\]\(([^)]+)\)/.exec(childMarkdown)?.[1];
  assert.equal(path.resolve(archivedChild, grandchildLink), archivedGrandchild);
  await stat(path.resolve(archivedChild, grandchildLink));
  assert.deepEqual((await listCommand({ root, input: { history: true } })).map(({ path: file }) => file), [
    '.agent-work/archive/2026/plain-runtime/children/archived-child/children/archived-grandchild/work.md',
    '.agent-work/archive/2026/plain-runtime/children/archived-child/work.md',
    closed.work,
  ]);
  assert.equal((await findCommand({ root, input: { query: 'plain runtime' } })).length, 0);
  assert.equal((await findCommand({ root, input: { query: 'plain runtime', history: true } }))[0].status, 'completed');
  assert.equal((await historyCommand({ root, work: 'plain-runtime' })).markdown, markdown);
  await assert.rejects(handoffCommand({ root, work: 'plain-runtime' }), (error) => error.code === 'WORK_NOT_FOUND');
});

test('CLI uses open paths, exposes explicit history, and preserves ownership failures', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'plain-workflow-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = await runCli([
    'create', '--root', root, '--id', 'cli-work', '--name', 'CLI work',
    '--goal', 'Exercise CLI.', '--success-criteria', '["CLI works."]',
  ], { now });
  assert.equal(created.work, '.agent-work/open/cli-work/work.md');
  await claimWork({ root, work: 'cli-work', owner: 'main', now });
  await assert.rejects(
    workCommand({ root, work: 'cli-work', owner: 'other', input: { progress: 'No.' }, now }),
    (error) => error.code === 'OWNER_MISMATCH',
  );
  assert.deepEqual(await runCli(['list', '--root', root], { now }), await listCommand({ root, input: {} }));
});
