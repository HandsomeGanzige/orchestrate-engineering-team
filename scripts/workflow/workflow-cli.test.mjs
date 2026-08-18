import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCli, runCli } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('CLI interface exposes explicit history routing', () => {
  assert.deepEqual(parseCli(['history', '--work', 'delivered']), { command: 'history', action: undefined, flags: { work: 'delivered' } });
});

test('CLI rejects the retired Material command', async () => {
  await assert.rejects(
    runCli(['material', 'add', '--work', 'plain-work', '--owner', 'main']),
    (error) => error.code === 'INVALID_COMMAND' && error.message === 'unknown command: material add',
  );
});
