import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { newWorkDocument } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';
import {
  createAt,
  initWorkspace,
  mutateAt,
  readAt,
  resolveWork,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-store.mjs';

const now = new Date('2026-07-28T01:00:00.000Z');

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'workflow-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('store interface resolves only discovered work and rewrites under one lock', async (t) => {
  const root = await temporaryRoot(t);
  await initWorkspace(root, now);
  const file = path.join(root, '.agent-work', 'work-items', 'store-work', 'index.md');
  await createAt(file, newWorkDocument({
    id: 'store-work',
    name: 'Store work',
    summary: 'Exercises the persistence seam.',
    keywords: ['store', 'persistence', 'workflow'],
    type: 'delivery',
    goal: 'Exercise persistence.',
    successCriteria: ['Mutation is durable.'],
  }, '../../../index.md', now));
  assert.equal(await resolveWork(root, 'store-work'), file);
  await assert.rejects(resolveWork(root, '.agent-work/index.md'), /work not found/);

  await mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
    document.blocks.current_progress = 'Persisted through the store interface.';
  });
  assert.equal((await readAt(file)).blocks.current_progress, 'Persisted through the store interface.');
});

test('store create race has one winner and removes lock and temporary files', async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, '.agent-work', 'work-items', 'raced-work', 'index.md');
  const document = newWorkDocument({
    id: 'raced-work',
    name: 'Raced work',
    summary: 'Characterizes concurrent creation through the store interface.',
    keywords: ['create', 'race', 'store'],
    type: 'delivery',
    goal: 'Allow exactly one creator.',
    successCriteria: ['One create wins.'],
  }, '../../../index.md', now);
  const results = await Promise.allSettled([
    createAt(file, document),
    createAt(file, structuredClone(document)),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const failure = results.find(({ status }) => status === 'rejected').reason;
  assert.ok(['LOCKED', 'ALREADY_EXISTS'].includes(failure.code));
  assert.equal((await readAt(file)).frontmatter.id, 'raced-work');
  assert.deepEqual(
    (await readdir(path.dirname(file))).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')),
    [],
  );
});

test('store interface preserves original bytes when atomic rename is interrupted', { concurrency: false }, async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, '.agent-work', 'work-items', 'atomic-work', 'index.md');
  await createAt(file, newWorkDocument({
    id: 'atomic-work',
    name: 'Atomic work',
    summary: 'Exercises atomic replacement failure.',
    keywords: ['atomic', 'failure', 'workflow'],
    type: 'delivery',
    goal: 'Preserve original bytes.',
    successCriteria: ['Original bytes remain.'],
  }, '../../../index.md', now));
  const before = await readFile(file, 'utf8');
  process.env.WORKFLOW_TEST_FAIL_BEFORE_RENAME = '1';
  try {
    await assert.rejects(
      mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
        document.blocks.current_progress = 'Must not commit.';
      }),
      (error) => error.code === 'ATOMIC_FAILURE',
    );
  } finally {
    delete process.env.WORKFLOW_TEST_FAIL_BEFORE_RENAME;
  }
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(
    (await readdir(path.dirname(file))).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')),
    [],
  );
});

test('store ownership failures preserve required, mismatch, then expiry priority', async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, '.agent-work', 'work-items', 'owned-work', 'index.md');
  const document = newWorkDocument({
    id: 'owned-work',
    name: 'Owned work',
    summary: 'Exercises store ownership failure semantics.',
    keywords: ['owner', 'lease', 'priority'],
    type: 'delivery',
    goal: 'Preserve ownership priority.',
    successCriteria: ['Priority remains stable.'],
  }, '../../../index.md', now);
  document.frontmatter.owner = 'main-a';
  document.frontmatter.lease_until = '2026-07-28T02:30:00.000Z';
  await createAt(file, document);

  const cases = [
    { owner: undefined, at: now, code: 'OWNER_REQUIRED' },
    { owner: 'main-b', at: new Date('2026-07-28T03:00:00.000Z'), code: 'OWNER_MISMATCH' },
    { owner: 'main-a', at: new Date('2026-07-28T03:00:00.000Z'), code: 'LEASE_EXPIRED' },
  ];
  for (const fixture of cases) {
    await assert.rejects(
      mutateAt(file, { owner: fixture.owner, now: fixture.at }, () => {}),
      (error) => error.code === fixture.code,
    );
  }
});

test('store mutation renews the persisted lease duration instead of resetting it', async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, '.agent-work', 'work-items', 'renewed-work', 'index.md');
  const document = newWorkDocument({
    id: 'renewed-work',
    name: 'Renewed work',
    summary: 'Exercises persisted lease renewal duration.',
    keywords: ['renewal', 'lease', 'duration'],
    type: 'delivery',
    goal: 'Preserve a custom lease duration.',
    successCriteria: ['Ninety minutes remain ninety minutes.'],
  }, '../../../index.md', now);
  document.frontmatter.owner = 'main-a';
  document.frontmatter.lease_until = '2026-07-28T02:30:00.000Z';
  await createAt(file, document);

  await mutateAt(
    file,
    { owner: 'main-a', now: new Date('2026-07-28T01:10:00.000Z') },
    (work) => { work.blocks.current_progress = 'Renewed.'; },
  );
  const renewed = await readAt(file);
  assert.equal(renewed.frontmatter.updated_at, '2026-07-28T01:10:00.000Z');
  assert.equal(renewed.frontmatter.lease_until, '2026-07-28T02:40:00.000Z');
});
