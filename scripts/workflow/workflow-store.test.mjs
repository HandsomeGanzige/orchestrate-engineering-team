import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initWorkspace, listCommand } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('store interface initializes empty open and archive collections', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'plain-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await initWorkspace({ root }), { ok: true, workspace: '.agent-work/open' });
  assert.deepEqual(await listCommand({ root, input: {} }), []);
  assert.deepEqual(await listCommand({ root, input: { history: true } }), []);
});
