import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAssignment,
  applyResult,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/work-model.mjs';
import { newWorkDocument } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';
import { hasCompletedEvidence, validateRoleResult } from '../../.agents/skills/orchestrate-engineering-team/scripts/verification.mjs';

test('role-result interface requires explicit Development gate votes', () => {
  const result = { status: 'completed', summary: ['Done.'], artifacts: [], files: ['src/a.mjs'], checks: [{ command: 'test', result: 'passed' }], requires_test: true, test_reason: 'Changed.', requires_review: true, review_reason: 'Review.', blockers: [] };
  assert.equal(validateRoleResult(result, 'development'), result);
  assert.throws(() => validateRoleResult({ ...result, requires_test: null }, 'development'), { code: 'INVALID_RESULT' });
});

test('role schemas are narrowed to advisory proposals and structured verification evidence', () => {
  const architecture = {
    status: 'completed', summary: ['Proposed.'], artifacts: [],
    decision_proposals: [{ id: 'storage-choice', summary: 'Choose storage.', options: ['A', 'B'], recommendation: 'A' }],
    files: [], checks: [{ command: 'inspect', result: 'passed' }], requires_test: true,
    test_reason: 'Behavior changes.', requires_review: true, review_reason: 'Review the decision.', blockers: [],
  };
  assert.equal(validateRoleResult(architecture, 'architecture'), architecture);
  const verification = {
    status: 'completed', summary: ['Verified.'], files: [], checks: [{ command: 'test', result: 'passed' }],
    evidence_method: 'Black-box test.', findings: [{ severity: 'none', summary: 'No finding.', evidence: 'Passed.', pointers: [] }], blockers: [],
  };
  assert.equal(validateRoleResult(verification, 'test'), verification);
  assert.throws(() => validateRoleResult({ ...verification, artifacts: [] }, 'review'), { code: 'INVALID_RESULT' });
});

test('actionable verification findings cannot become passing evidence', () => {
  const document = newWorkDocument({
    id: 'finding-evidence',
    name: 'Finding evidence',
    goal: 'Reject actionable passing evidence.',
    successCriteria: ['Actionable findings fail closed.'],
  }, null, new Date(0));
  applyAssignment(document, 'add', { id: 'actionable-review', role: 'review', objective: 'Review the surface.' });
  applyAssignment(document, 'start', { id: 'actionable-review' });
  applyResult(document, {
    assignment: 'actionable-review',
    result: {
      status: 'completed', summary: ['Review completed.'], files: [],
      checks: [{ command: 'review', result: 'passed' }],
      evidence_method: 'Independent inspection.',
      findings: [{ severity: 'high', summary: 'Action required.', evidence: 'A defect remains.', pointers: ['src/a.mjs'] }],
      blockers: [],
    },
  });
  applyAssignment(document, 'complete', { id: 'actionable-review' });
  assert.equal(document.blocks.assignments[0].receipt.passed, false);
  assert.equal(hasCompletedEvidence(document, 'review'), false);
});
