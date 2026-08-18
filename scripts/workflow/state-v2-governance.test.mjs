import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assignmentCommand,
  claimWork,
  createWork,
  packetCommand,
  resultCommand,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import { readAt } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-store.mjs';

const now = new Date('2026-08-18T00:00:00.000Z');
const expectedKeys = ['version', 'id', 'type', 'status', 'stage', 'parent', 'owner', 'lease_until', 'lease_minutes', 'created_at', 'updated_at', 'contract', 'limits', 'usage', 'todos', 'assignments', 'attempts', 'claims', 'findings', 'conflicts', 'verification', 'children', 'result'];
const baseline = { repository: '.', head: 'a'.repeat(40) };
const gitInspector = async (_root, prior) => prior ? { ...baseline, changed: ['src/core.mjs'] } : baseline;

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'state-v2-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createWork({
    root,
    now,
    input: {
      id: 'governed-work', name: 'Governed work', goal: 'Ship governed state.',
      successCriteria: ['State v2 is enforced.'], readScope: ['src'], writeScope: ['src'],
      forbiddenChanges: ['src/generated'], constraints: ['No transcript persistence.'],
    },
  });
  await claimWork({ root, work: 'governed-work', owner: 'main', now });
  return root;
}

function completedResult(files = ['src/core.mjs'], extra = {}) {
  return {
    status: 'completed', summary: ['Transient summary.'], artifacts: [], files,
    checks: [{ command: 'node --test focused', result: 'passed' }],
    requires_test: true, test_reason: 'Governance changed.', requires_review: true,
    review_reason: 'State boundaries changed.', blockers: [], ...extra,
  };
}

async function addDevelopment(root, id = 'develop-core', extra = {}) {
  return assignmentCommand({
    root, work: 'governed-work', owner: 'main', action: 'add', now,
    input: {
      id, role: 'development', objective: 'Implement governance.', write: ['src/core.mjs'],
      agentId: `/root/${id}`, requiredCapabilities: ['workspace-write'], availableCapabilities: ['workspace-write'],
      ...extra,
    },
  });
}

test('state v2 has exact root keys, canonical immutable contract, and rejects v1', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, '.agent-work/open/governed-work/state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(state), expectedKeys);
  assert.equal(state.version, 2);
  assert.equal(state.contract.enforcement, 'skill-local');
  assert.match(state.contract.digest, /^[a-f0-9]{64}$/);
  state.version = 1;
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_DOCUMENT' });
});

test('dispatch fails closed, persists attempts, approved gates, claims, usage, and bounded records', async (t) => {
  const root = await fixture(t);
  await assert.rejects(addDevelopment(root, 'missing-capability', {
    requiredCapabilities: ['git-inspection'], availableCapabilities: [],
  }), { code: 'CAPABILITY_UNAVAILABLE' });
  await addDevelopment(root);
  await assert.rejects(assignmentCommand({
    root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector,
    input: { id: 'develop-core', gates: [{ id: 'human', status: 'pending', approved_by: 'main' }] },
  }), { code: 'APPROVAL_REQUIRED' });
  await assignmentCommand({
    root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector,
    input: { id: 'develop-core', gates: [{ id: 'human', status: 'approved', approved_by: 'main' }] },
  });
  const packet = await packetCommand({ root, work: 'governed-work', input: { assignment: 'develop-core' } });
  assert.equal(packet.contract_digest, packet.contract.digest);
  assert.equal(packet.attempt_id, 'develop-core-attempt-1');
  assert.equal(packet.claims[0].mode, 'exclusive');

  await resultCommand({
    root, work: 'governed-work', owner: 'main', now, gitInspector,
    input: { assignment: 'develop-core', result: completedResult() },
  });
  const state = JSON.parse(await readFile(path.join(root, '.agent-work/open/governed-work/state.json'), 'utf8'));
  assert.equal(state.attempts[0].status, 'completed');
  assert.equal(state.claims[0].status, 'released');
  assert.deepEqual(state.usage, { assignments: 1, active_assignments: 1, total_attempts: 1, claims: 1, findings: 0, conflicts: 0 });
  assert.equal(JSON.stringify(state).includes('Transient summary.'), false);
});

test('Development completion is bound to the Git-derived in-scope changed surface', async (t) => {
  const root = await fixture(t);
  await addDevelopment(root);
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
  await assert.rejects(resultCommand({
    root, work: 'governed-work', owner: 'main', now, gitInspector,
    input: { assignment: 'develop-core', result: completedResult([]) },
  }), { code: 'INVALID_GIT_SCOPE' });
  const state = JSON.parse(await readFile(path.join(root, '.agent-work/open/governed-work/state.json'), 'utf8'));
  assert.equal(state.attempts[0].status, 'in_progress');
  assert.equal(state.claims[0].status, 'active');
});

test('Development completion rejects Git changes outside declared write scopes before receipt comparison', async (t) => {
  const root = await fixture(t);
  await addDevelopment(root);
  const outOfScopeGit = async (_root, prior) => prior
    ? { ...baseline, changed: ['outside/core.mjs'] }
    : baseline;
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector: outOfScopeGit, input: { id: 'develop-core' } });
  await assert.rejects(resultCommand({
    root, work: 'governed-work', owner: 'main', now, gitInspector: outOfScopeGit,
    input: { assignment: 'develop-core', result: completedResult([]) },
  }), (error) => error.code === 'INVALID_GIT_SCOPE' && /exactly one active Development owner/.test(error.message));
});

test('parallel Development partitions shared-baseline Git changes by exact active owner', async (t) => {
  const root = await fixture(t);
  const topology = { mode: 'parallel', group: 'disjoint', independent: true, shared_interface_stable: true, touches_global: false, integrator: '/root' };
  await addDevelopment(root, 'parallel-a', { write: ['src/a.mjs'], topology, agentId: '/root/a' });
  await addDevelopment(root, 'parallel-b', { write: ['src/b.mjs'], topology, agentId: '/root/b' });
  const sharedGit = async (_root, prior) => prior
    ? { ...baseline, changed: ['src/a.mjs', 'src/b.mjs'] }
    : baseline;
  for (const id of ['parallel-a', 'parallel-b']) {
    await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector: sharedGit, input: { id } });
  }
  await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector: sharedGit, input: { assignment: 'parallel-a', result: completedResult(['src/a.mjs']) } });
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'complete', now, input: { id: 'parallel-a' } });
  await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector: sharedGit, input: { assignment: 'parallel-b', result: completedResult(['src/b.mjs']) } });
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'complete', now, input: { id: 'parallel-b' } });
  const state = JSON.parse(await readFile(path.join(root, '.agent-work/open/governed-work/state.json'), 'utf8'));
  assert.deepEqual(state.assignments.map((entry) => entry.receipt.changed_surface), [['src/a.mjs'], ['src/b.mjs']]);
  assert.deepEqual(state.attempts.map((entry) => entry.receipt), state.assignments.map((entry) => entry.receipt));
});

test('Assignment reads reject traversal aliases at mutation and recovery', async (t) => {
  const root = await fixture(t);
  await assert.rejects(addDevelopment(root, 'read-widener', { read: ['src/../outside'] }), { code: 'CONTRACT_WIDENING' });
  await addDevelopment(root, 'canonical-reader', { read: ['src/core.mjs'] });
  const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.assignments[0].read = ['src/../outside'];
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(packetCommand({ root, work: 'governed-work', input: { assignment: 'canonical-reader' } }), { code: 'INVALID_DOCUMENT' });
});

test('recovery and packet dispatch reject same-count active resource claim substitution', async (t) => {
  const root = await fixture(t);
  await addDevelopment(root, 'resource-owner', {
    claimSpecs: [
      { kind: 'path', key: 'src/core.mjs', mode: 'exclusive' },
      { kind: 'resource', key: 'database-primary', mode: 'exclusive' },
    ],
  });
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'resource-owner' } });
  const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.claims.find((claim) => claim.kind === 'resource').key = 'database-shadow';
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(packetCommand({ root, work: 'governed-work', input: { assignment: 'resource-owner' } }), { code: 'INVALID_CLAIM' });
});

test('recovery rejects escaped Development receipts and completed-attempt receipt divergence', async (t) => {
  await t.test('escaped changed surface', async (t) => {
    const root = await fixture(t);
    await addDevelopment(root);
    await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
    await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector, input: { assignment: 'develop-core', result: completedResult() } });
    const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    state.assignments[0].receipt.changed_surface = ['outside/core.mjs'];
    state.attempts[0].receipt.changed_surface = ['outside/core.mjs'];
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_GIT_SCOPE' });
  });

  await t.test('receipt divergence', async (t) => {
    const root = await fixture(t);
    await addDevelopment(root);
    await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
    await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector, input: { assignment: 'develop-core', result: completedResult() } });
    const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    state.assignments[0].receipt.changed_surface = [];
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_DOCUMENT' });
  });
});

test('recovery rejects malformed non-null receipts on blocked current attempts', async (t) => {
  const root = await fixture(t);
  await addDevelopment(root);
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
  const blocked = completedResult(['src/core.mjs'], { status: 'blocked', blockers: ['Needs a bounded retry.'] });
  await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector, input: { assignment: 'develop-core', result: blocked } });
  const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.attempts[0].receipt.transcript = 'must never persist';
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_DOCUMENT' });
});

test('recovery validates schema and Development scope on non-current historical attempt receipts', async (t) => {
  const root = await fixture(t);
  await addDevelopment(root);
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
  const blocked = completedResult(['src/core.mjs'], { status: 'blocked', blockers: ['Retry this bounded attempt.'] });
  await resultCommand({ root, work: 'governed-work', owner: 'main', now, gitInspector, input: { assignment: 'develop-core', result: blocked } });
  await assignmentCommand({ root, work: 'governed-work', owner: 'main', action: 'start', now, gitInspector, input: { id: 'develop-core' } });
  const stateFile = path.join(root, '.agent-work/open/governed-work/state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.attempts[0].receipt.transcript = 'historical transcript';
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_DOCUMENT' });
  delete state.attempts[0].receipt.transcript;
  state.attempts[0].receipt.changed_surface = ['outside/core.mjs'];
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(readAt(path.join(root, '.agent-work/open/governed-work/work.md')), { code: 'INVALID_GIT_SCOPE' });
});

test('child propagation is byte-identical and assignment scope cannot widen the root contract', async (t) => {
  const root = await fixture(t);
  await createWork({
    root, owner: 'main', childOnly: true, now,
    input: {
      id: 'governed-child', name: 'Governed child', parent: 'governed-work', goal: 'Local child goal.',
      successCriteria: ['Child done.'],
      eligibility: { independentlyAcceptable: true, withinParentScope: true, plannedTodos: ['One', 'Two'], plannedRoles: [] },
    },
  });
  const parent = JSON.parse(await readFile(path.join(root, '.agent-work/open/governed-work/state.json'), 'utf8'));
  const child = JSON.parse(await readFile(path.join(root, '.agent-work/open/governed-work/children/governed-child/state.json'), 'utf8'));
  assert.equal(JSON.stringify(parent.contract), JSON.stringify(child.contract));
  await assert.rejects(addDevelopment(root, 'scope-widener', { write: ['outside/core.mjs'] }), { code: 'CONTRACT_WIDENING' });
});
