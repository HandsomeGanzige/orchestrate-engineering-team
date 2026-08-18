import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRoleResult } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('role-result interface requires explicit Development gate votes', () => {
  const result = { status: 'completed', summary: ['Done.'], artifacts: [], files: ['src/a.mjs'], checks: [{ command: 'test', result: 'passed' }], requires_test: true, test_reason: 'Changed.', requires_review: true, review_reason: 'Review.', blockers: [] };
  assert.equal(validateRoleResult(result, 'development'), result);
  assert.throws(() => validateRoleResult({ ...result, requires_test: null }, 'development'), { code: 'INVALID_RESULT' });
});

test('transient read-only role results reject retained artifacts', () => {
  for (const role of ['architecture', 'test', 'retest', 'review', 'rereview']) {
    const verifier = role !== 'architecture';
    const result = {
      status: 'completed',
      summary: [`${role} completed.`],
      artifacts: [{ path: 'reports/retained.md', purpose: 'Retained role report.' }],
      files: [],
      checks: [{ command: `${role} check`, result: 'passed' }],
      requires_test: verifier ? null : true,
      test_reason: verifier ? null : 'Inspect the architecture.',
      requires_review: verifier ? null : true,
      review_reason: verifier ? null : 'Review the architecture.',
      blockers: [],
    };
    assert.throws(
      () => validateRoleResult(result, role),
      (error) => error.code === 'INVALID_RESULT' && error.message === `${role} result artifacts must be empty`,
    );
  }
});
