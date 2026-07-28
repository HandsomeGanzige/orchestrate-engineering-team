import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  claimWork,
  createWork,
  releaseWork,
  todoCommand,
  validateWorkspace,
  workCommand,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import {
  baseTime,
  createClaimed,
  temporaryWorkspace,
  workInput,
} from './test-helpers.mjs';

test('runtime lifecycle registers canonical work and keeps root status synchronized', async (t) => {
  const root = await temporaryWorkspace(t);
  const { file } = await createClaimed(root);
  assert.match(await readFile(file, 'utf8'), /^---\nid: /);
  assert.deepEqual(await validateWorkspace({ root }), { valid: true, checked: 1, errors: [] });

  await workCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    input: { status: 'paused' },
    now: baseTime,
  });
  assert.deepEqual(await validateWorkspace({ root }), { valid: true, checked: 1, errors: [] });
});

test('runtime claim is exclusive and release enforces the current owner', async (t) => {
  const root = await temporaryWorkspace(t);
  await createWork({ root, input: workInput(), now: baseTime });
  const claims = await Promise.allSettled([
    claimWork({ root, work: 'deterministic-runtime', owner: 'main-a', now: baseTime }),
    claimWork({ root, work: 'deterministic-runtime', owner: 'main-b', now: baseTime }),
  ]);
  assert.equal(claims.filter((result) => result.status === 'fulfilled').length, 1);
  const winner = claims.find((result) => result.status === 'fulfilled').value.owner;
  await assert.rejects(
    releaseWork({ root, work: 'deterministic-runtime', owner: 'not-owner', now: baseTime }),
    (error) => error.code === 'OWNER_MISMATCH',
  );
  await releaseWork({ root, work: 'deterministic-runtime', owner: winner, now: baseTime });
});

test('todo lifecycle permits exactly one active item and reserves final completion for work', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  for (const [id, text] of [
    ['first-result', 'Deliver first result.'],
    ['second-result', 'Deliver second result.'],
  ]) {
    await todoCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'add',
      input: { id, text },
      now: baseTime,
    });
  }
  await todoCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'complete',
    input: { id: 'align-goal', next: 'first-result' },
    now: baseTime,
  });
  await assert.rejects(
    todoCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'start',
      input: { id: 'second-result' },
      now: baseTime,
    }),
    (error) => error.code === 'TODO_CONFLICT',
  );
  await todoCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'complete',
    input: { id: 'first-result', next: 'second-result' },
    now: baseTime,
  });
  await assert.rejects(
    todoCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'complete',
      input: { id: 'second-result' },
      now: baseTime,
    }),
    (error) => error.code === 'TODO_CONFLICT',
  );
});

test('work completion preserves input and reconciliation error priority', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  await todoCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'add',
    input: { id: 'deliver-runtime', text: 'Deliver runtime.' },
    now: baseTime,
  });

  const attempts = [
    {
      input: { status: 'completed' },
      code: 'INVALID_INPUT',
      message: 'completion requires completeTodo for the final in-progress todo',
    },
    {
      input: { status: 'completed', completeTodo: 'deliver-runtime' },
      code: 'INVALID_TRANSITION',
      message: 'completeTodo must identify the in-progress todo',
    },
    {
      input: { status: 'completed', completeTodo: 'align-goal' },
      code: 'UNRECONCILED_TODO',
      message: 'todo deliver-runtime is pending; work result must be completed with a summary; missing success evidence for: Commands preserve valid state.',
    },
  ];
  for (const attempt of attempts) {
    await assert.rejects(
      workCommand({
        root,
        work: 'deterministic-runtime',
        owner: 'main-a',
        input: attempt.input,
        now: baseTime,
      }),
      (error) => error.code === attempt.code && error.message === attempt.message,
    );
  }
});
