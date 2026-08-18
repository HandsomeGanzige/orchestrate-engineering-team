import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRoleResult } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('verifier result interface rejects unevaluated completion checks', () => {
  const result = { status: 'completed', summary: ['Checked.'], files: [], checks: [{ command: 'review', result: 'not_run' }], evidence_method: 'Independent inspection.', findings: [{ severity: 'none', summary: 'No finding.', evidence: 'Inspection was not run.', pointers: [] }], blockers: [] };
  assert.throws(() => validateRoleResult(result, 'review'), { code: 'INVALID_RESULT' });
});
