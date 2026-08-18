import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRoleResult } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('verifier result interface rejects unevaluated completion checks', () => {
  const result = { status: 'completed', summary: ['Checked.'], artifacts: [], files: [], checks: [{ command: 'review', result: 'not_run' }], requires_test: null, test_reason: null, requires_review: null, review_reason: null, blockers: [] };
  assert.throws(() => validateRoleResult(result, 'review'), { code: 'INVALID_RESULT' });
});
