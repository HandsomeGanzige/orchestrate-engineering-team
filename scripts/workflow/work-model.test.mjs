import assert from 'node:assert/strict';
import test from 'node:test';
import { scopesConflict } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('Development scope interface detects equality and ancestry', () => {
  assert.equal(scopesConflict('src/runtime', 'src/runtime/file.mjs'), true);
  assert.equal(scopesConflict('src/a', 'src/b'), false);
});
