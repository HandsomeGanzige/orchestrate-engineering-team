import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assignmentCommand,
  childSync,
  claimWork,
  createWork,
  findCommand,
  handoffCommand,
  materialCommand,
  packetCommand,
  todoCommand,
  validateWorkspace,
  workCommand,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import {
  baseTime,
  createClaimed,
  replaceBlock,
  temporaryWorkspace,
  workInput,
} from './test-helpers.mjs';

test('child lifecycle enforces eligibility, reciprocal links, and descendant completion', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  const child = workInput({
    id: 'lease-coordination',
    name: 'Lease coordination',
    summary: 'Coordinates recoverable owner leases.',
    parent: 'deterministic-runtime',
    eligibility: {
      independentlyAcceptable: true,
      withinParentScope: true,
      plannedTodos: ['Implement claims'],
      plannedRoles: ['development'],
      crossSession: false,
    },
  });
  await assert.rejects(
    createWork({ root, input: child, owner: 'main-a', now: baseTime, childOnly: true }),
    (error) => error.code === 'INELIGIBLE_CHILD',
  );
  child.eligibility.plannedTodos.push('Verify contention');
  await createWork({ root, input: child, owner: 'main-a', now: baseTime, childOnly: true });
  await assert.rejects(
    workCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      input: { status: 'completed' },
      now: baseTime,
    }),
    (error) => error.code === 'INCOMPLETE_DESCENDANT',
  );
  await claimWork({ root, work: child.id, owner: 'child-main', now: baseTime });
  await workCommand({
    root,
    work: child.id,
    owner: 'child-main',
    action: 'evidence',
    input: {
      criterion: 'Commands preserve valid state.',
      evidence: 'Child acceptance was confirmed.',
      pointers: [],
    },
    now: baseTime,
  });
  await workCommand({
    root,
    work: child.id,
    owner: 'child-main',
    input: {
      status: 'completed',
      completeTodo: 'align-goal',
      result: 'Lease coordination delivered.',
    },
    now: baseTime,
  });
  assert.equal((await childSync({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    input: { id: child.id },
    now: baseTime,
  })).status, 'completed');
  assert.equal((await validateWorkspace({ root })).valid, true);
});

test('material, query, packet, and handoff interfaces keep bounded projections', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  await assert.rejects(
    materialCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'add',
      input: {
        role: 'development',
        path: 'materials/architecture/report.md',
        summary: 'Lease topology',
        purpose: 'Guide implementation',
      },
      now: baseTime,
    }),
    (error) => error.code === 'MATERIAL_SCOPE',
  );
  await materialCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'add',
    input: {
      role: 'architecture',
      path: 'materials/architecture/lease-topology.md',
      summary: 'Rare sentinel lease topology',
      purpose: 'Guide implementation',
    },
    now: baseTime,
  });
  await assignmentCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'add',
    input: {
      id: 'dev-runtime',
      role: 'development',
      objective: 'Implement runtime.',
      read: ['materials/architecture/lease-topology.md'],
      write: ['src/runtime.mjs'],
    },
    now: baseTime,
  });
  const found = await findCommand({ root, input: { query: 'sentinel' } });
  assert.deepEqual(Object.keys(found[0]), ['path', 'name', 'summary', 'status', 'match_reason']);
  assert.equal(found[0].match_reason, 'material summary');
  const packet = await packetCommand({
    root,
    work: 'deterministic-runtime',
    input: { assignment: 'dev-runtime' },
  });
  assert.deepEqual(packet.spawn, { fork_turns: 'none' });
  assert.deepEqual(packet.material_pointers, [{
    path: 'materials/architecture/lease-topology.md',
    summary: 'Rare sentinel lease topology',
    purpose: 'Guide implementation',
  }]);
  const handoff = await handoffCommand({ root, work: 'deterministic-runtime' });
  assert.equal('confirmed_decisions' in handoff, false);
});

test('workspace validation groups malformed, topology, and completion diagnostics', async (t) => {
  const cases = [
    {
      name: 'duplicate active todo',
      mutate(text) {
        return replaceBlock(text, 'todo', (todos) => todos.push({
          id: 'duplicate-active',
          text: 'Duplicate.',
          status: 'in_progress',
          assignment: '',
          blockers: [],
        }));
      },
      code: 'INVALID_TODO',
    },
    {
      name: 'no active todo',
      mutate(text) {
        return replaceBlock(text, 'todo', (todos) => { todos[0].status = 'completed'; });
      },
      code: 'INVALID_TODO',
    },
    {
      name: 'completed work without completion evidence',
      mutate(text) { return text.replace('status: "active"', 'status: "completed"'); },
      code: 'INCOMPLETE_RESULT',
    },
    {
      name: 'material outside its role folder',
      mutate(text) {
        return replaceBlock(text, 'materials', (materials) => materials.push({
          id: 'materials/review/wrong.md',
          role: 'test',
          path: 'materials/review/wrong.md',
          summary: 'Wrong folder',
          purpose: 'Exercise workspace validation mapping.',
        }));
      },
      code: 'MATERIAL_SCOPE',
    },
  ];
  for (const fixture of cases) {
    const root = await temporaryWorkspace(t);
    const { file } = await createClaimed(root);
    await writeFile(file, fixture.mutate(await readFile(file, 'utf8')));
    const result = await validateWorkspace({ root });
    assert.equal(result.valid, false, fixture.name);
    assert.ok(result.errors.some((error) => error.code === fixture.code), fixture.name);
  }
});

test('workspace validation reports a malformed work_items root block as a workflow error', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  const rootFile = path.join(root, '.agent-work', 'index.md');
  const malformed = (await readFile(rootFile, 'utf8'))
    .replace(
      /(<!-- workflow:work_items:start -->\n```json\n)[\s\S]*?(\n```\n<!-- workflow:work_items:end -->)/,
      '$1{}$2',
    );
  await writeFile(rootFile, malformed);

  const result = await validateWorkspace({ root });
  assert.deepEqual(result, {
    valid: false,
    errors: [{
      file: '.agent-work/index.md',
      code: 'INVALID_BLOCKS',
      message: `${rootFile}: work_items must be an array`,
    }],
  });
});

test('workspace validation rejects malformed root work item entries before path resolution', async (t) => {
  const cases = [
    {
      name: 'non-object entry',
      mutate(entries) { entries[0] = null; },
      message: 'work_items[0] must be an object',
    },
    {
      name: 'missing required field',
      mutate(entries) { delete entries[0].summary; },
      message: 'work_items[0].summary must be a string',
    },
    {
      name: 'non-string path',
      mutate(entries) { entries[0].path = { nested: true }; },
      message: 'work_items[0].path must be a string',
    },
    {
      name: 'duplicate ID',
      mutate(entries) {
        entries.push({ ...entries[0], path: '.agent-work/work-items/other/index.md' });
      },
      message: 'work_items must contain unique IDs: deterministic-runtime',
    },
    {
      name: 'duplicate path',
      mutate(entries) { entries.push({ ...entries[0], id: 'other-runtime' }); },
      message: 'work_items must contain unique paths: .agent-work/work-items/deterministic-runtime/index.md',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await temporaryWorkspace(t);
      await createClaimed(root);
      const rootFile = path.join(root, '.agent-work', 'index.md');
      const malformed = replaceBlock(
        await readFile(rootFile, 'utf8'),
        'work_items',
        fixture.mutate,
      );
      await writeFile(rootFile, malformed);

      const result = await validateWorkspace({ root });
      assert.deepEqual(result, {
        valid: false,
        errors: [{
          file: '.agent-work/index.md',
          code: 'INVALID_BLOCKS',
          message: `${rootFile}: ${fixture.message}`,
        }],
      });
    });
  }
});

test('workspace validation compares every root projection field with discovered work', async (t) => {
  const cases = [
    ['id', 'stale-runtime'],
    ['path', './.agent-work/work-items/deterministic-runtime/index.md'],
    ['name', 'Stale runtime name'],
    ['summary', 'Stale runtime summary.'],
    ['status', 'paused'],
  ];

  for (const [field, staleValue] of cases) {
    await t.test(field, async () => {
      const root = await temporaryWorkspace(t);
      await createClaimed(root);
      const rootFile = path.join(root, '.agent-work', 'index.md');
      await writeFile(
        rootFile,
        replaceBlock(await readFile(rootFile, 'utf8'), 'work_items', (entries) => {
          entries[0][field] = staleValue;
        }),
      );

      const result = await validateWorkspace({ root });
      assert.ok(result.errors.some((error) => (
        error.file === '.agent-work/index.md'
          && error.code === 'STALE_ROOT_PROJECTION'
          && error.message.includes(`root work item ${field === 'id' ? staleValue : 'deterministic-runtime'} ${field} does not match`)
      )), field);
    });
  }
});

test('workspace validation normalizes absolute and cwd-relative roots identically', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);

  const expected = {
    valid: true,
    checked: 1,
    errors: [],
  };
  const relativeRoot = path.relative(process.cwd(), root);
  for (const candidate of [root, relativeRoot, `${relativeRoot}${path.sep}.`]) {
    assert.deepEqual(await validateWorkspace({ root: candidate }), expected, candidate);
  }
});

test('workspace validation rejects a correctly projected Child Work Item in the root', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  const child = workInput({
    id: 'nested-runtime',
    name: 'Nested runtime',
    summary: 'Exercises child topology recovery.',
    parent: 'deterministic-runtime',
    eligibility: {
      independentlyAcceptable: true,
      withinParentScope: true,
      plannedTodos: ['Implement topology', 'Verify recovery'],
      plannedRoles: ['development'],
      crossSession: false,
    },
  });
  await createWork({
    root,
    input: child,
    owner: 'main-a',
    now: baseTime,
    childOnly: true,
  });
  const rootFile = path.join(root, '.agent-work', 'index.md');
  const childPath = '.agent-work/work-items/deterministic-runtime/children/nested-runtime/index.md';
  await writeFile(
    rootFile,
    replaceBlock(await readFile(rootFile, 'utf8'), 'work_items', (entries) => {
      entries[0] = {
        id: child.id,
        path: childPath,
        name: child.name,
        summary: child.summary,
        status: 'active',
      };
    }),
  );

  const result = await validateWorkspace({ root });
  assert.ok(result.errors.some((error) => (
    error.file === '.agent-work/index.md'
      && error.code === 'INVALID_ROOT_LINK'
      && error.message === `root entry references non-top-level work: ${childPath}`
  )));
});

test('workspace recovery diagnoses malformed, missing, and unfinished Assignment dependencies', async (t) => {
  const cases = [
    {
      name: 'invalid Assignment ID',
      mutate(assignments) { assignments[1].id = 'Not Valid'; },
      message: 'assignments[1].id is invalid',
    },
    {
      name: 'duplicate Assignment ID',
      mutate(assignments) { assignments[1].id = 'dev-prerequisite'; },
      message: 'assignments must contain unique IDs: dev-prerequisite',
    },
    {
      name: 'dependsOn is not an array',
      mutate(assignments) { assignments[1].dependsOn = 'dev-prerequisite'; },
      message: 'assignment dev-dependent dependsOn must be an array',
    },
    {
      name: 'duplicate dependency',
      mutate(assignments) {
        assignments[1].dependsOn = ['dev-prerequisite', 'dev-prerequisite'];
      },
      message: 'assignment dev-dependent dependsOn must contain unique IDs',
    },
    {
      name: 'invalid dependency ID',
      mutate(assignments) { assignments[1].dependsOn = ['Not Valid']; },
      message: 'assignment dev-dependent dependsOn must contain valid assignment IDs',
    },
    {
      name: 'self dependency',
      mutate(assignments) { assignments[1].dependsOn = ['dev-dependent']; },
      message: 'assignment dev-dependent cannot depend on itself',
    },
    {
      name: 'missing dependency',
      mutate(assignments) { assignments[1].dependsOn = ['dev-missing']; },
      message: 'assignment dev-dependent dependency does not exist: dev-missing',
    },
    {
      name: 'multi-node dependency cycle',
      mutate(assignments) { assignments[0].dependsOn = ['dev-dependent']; },
      message: 'assignment dependency cycle: dev-prerequisite -> dev-dependent -> dev-prerequisite',
    },
    {
      name: 'unfinished dependency for in-progress assignment',
      mutate(assignments) { assignments[1].status = 'in_progress'; },
      message: 'assignment dev-dependent dependency is unfinished: dev-prerequisite',
    },
    {
      name: 'unfinished dependency for completed assignment',
      mutate(assignments) { assignments[1].status = 'completed'; },
      message: 'assignment dev-dependent dependency is unfinished: dev-prerequisite',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = await temporaryWorkspace(t);
      const { file } = await createClaimed(root);
      await assignmentCommand({
        root,
        work: 'deterministic-runtime',
        owner: 'main-a',
        action: 'add',
        input: {
          id: 'dev-prerequisite',
          role: 'development',
          objective: 'Provide a persisted prerequisite.',
          write: ['src/prerequisite.mjs'],
        },
        now: baseTime,
      });
      await assignmentCommand({
        root,
        work: 'deterministic-runtime',
        owner: 'main-a',
        action: 'add',
        input: {
          id: 'dev-dependent',
          role: 'development',
          objective: 'Depend on the persisted prerequisite.',
          write: ['src/dependent.mjs'],
          dependsOn: ['dev-prerequisite'],
        },
        now: baseTime,
      });
      await writeFile(
        file,
        replaceBlock(await readFile(file, 'utf8'), 'assignments', fixture.mutate),
      );

      const result = await validateWorkspace({ root });
      assert.ok(result.errors.some((error) => (
        error.file === '.agent-work/work-items/deterministic-runtime/index.md'
          && error.code === 'INVALID_ASSIGNMENT'
          && error.message === `${file}: ${fixture.message}`
      )), fixture.name);
    });
  }
});

test('semantic ids are rejected before workspace registration', async (t) => {
  const root = await temporaryWorkspace(t);
  for (const id of ['phase-0', 'test', 'review', 'implementation', 'batch-2']) {
    await assert.rejects(
      createWork({ root, input: workInput({ id }), now: baseTime }),
      (error) => error.code === 'INVALID_ID' && /forbidden non-semantic/.test(error.message),
    );
  }
});
