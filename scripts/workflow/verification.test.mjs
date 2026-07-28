import assert from 'node:assert/strict';
import test from 'node:test';

import { newWorkDocument } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';
import {
  completionIssues,
  computeVotes,
  hasCompletedEvidence,
  validateRoleResult,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/verification.mjs';

function developmentResult(overrides = {}) {
  return {
    status: 'completed',
    summary: ['Implemented the runtime seam.'],
    artifacts: [],
    files: ['src/runtime.mjs'],
    checks: [{ command: 'node --test', result: 'passed' }],
    requires_test: true,
    test_reason: 'Runtime behavior is executable.',
    requires_review: true,
    review_reason: 'State semantics need review.',
    blockers: [],
    ...overrides,
  };
}

test('verification interface enforces the exact role-result envelope', () => {
  assert.equal(validateRoleResult(developmentResult(), 'development').status, 'completed');
  assert.throws(
    () => validateRoleResult({ ...developmentResult(), log: 'not allowed' }, 'development'),
    (error) => error.code === 'INVALID_RESULT'
      && error.message === 'result fields must exactly match the role result protocol',
  );
  assert.throws(
    () => validateRoleResult(developmentResult({ status: 'blocked' }), 'development'),
    /partial and blocked results require blockers/,
  );
});

test('verification interface preserves Development OR and the three-party waiver rule', () => {
  const verification = {
    votes: {
      architecture: {
        covered: true,
        test: { requires: false },
        review: { requires: false },
      },
      development: [
        { assignment: 'dev-a', test: { requires: false }, review: { requires: false } },
        { assignment: 'dev-b', test: { requires: true }, review: { requires: false } },
      ],
      main: {
        test: { requires: false, reason: 'Waive test.' },
        review: { requires: true, reason: 'Run review.' },
      },
    },
    decisions: {},
  };
  assert.deepEqual(computeVotes(verification, 'test').votes, {
    architecture: false,
    development: true,
    main: false,
  });
  assert.equal(computeVotes(verification, 'test').execute, false);
  assert.equal(computeVotes(verification, 'review').execute, false);
  verification.votes.architecture.covered = false;
  assert.equal(computeVotes(verification, 'test').rule, 'main-decision-with-development-advice');
  assert.equal(computeVotes(verification, 'test').execute, false);
  verification.votes.development = [];
  assert.equal(
    computeVotes(verification, 'test', { developmentOccurred: true }).execute,
    true,
  );
  assert.match(
    computeVotes(verification, 'test', { developmentOccurred: true }).reason,
    /Development evidence is missing/,
  );
});

test('verification completion policy requires current passed evidence for executed dimensions', () => {
  const work = newWorkDocument({
    id: 'verified-work',
    name: 'Verified work',
    summary: 'Exercises completion evidence policy directly.',
    keywords: ['verification', 'completion', 'evidence'],
    type: 'delivery',
    goal: 'Require executed verification evidence.',
    successCriteria: ['Verification evidence is complete.'],
  }, '../../../index.md', new Date('2026-07-28T01:00:00.000Z'));
  work.blocks.todo[0].status = 'completed';
  work.blocks.result = {
    status: 'completed',
    summary: ['Verification completed.'],
    artifacts: [],
    success_evidence: [{
      criterion: 'Verification evidence is complete.',
      evidence: 'The direct policy check passed.',
      pointers: [],
    }],
    blockers: [],
    next_action: '',
  };
  const development = {
    id: 'dev-verification',
    role: 'development',
    status: 'completed',
    objective: 'Implement verified behavior.',
    write: ['src/verified.mjs'],
    result: developmentResult(),
    blockers: [],
  };
  const completedVerifier = (id, role) => ({
    id,
    role,
    status: 'completed',
    objective: `Execute ${role}.`,
    write: [],
    blockers: [],
    result: {
      status: 'completed',
      summary: [`${role} passed.`],
      artifacts: [],
      files: [],
      checks: [{ command: `${role} check`, result: 'passed' }],
      requires_test: null,
      test_reason: null,
      requires_review: null,
      review_reason: null,
      blockers: [],
    },
  });
  work.blocks.assignments.push(
    development,
    completedVerifier('test-verification', 'test'),
    completedVerifier('review-verification', 'review'),
  );
  work.blocks.verification.votes.development.push({
    assignment: development.id,
    test: { requires: true, reason: development.result.test_reason },
    review: { requires: true, reason: development.result.review_reason },
  });
  work.blocks.verification.votes.main = {
    test: { requires: true, reason: 'Execute tests.' },
    review: { requires: true, reason: 'Execute review.' },
  };
  work.blocks.verification.decisions.test = computeVotes(work.blocks.verification, 'test');
  work.blocks.verification.decisions.review = computeVotes(work.blocks.verification, 'review');

  assert.equal(hasCompletedEvidence(work, 'test'), true);
  assert.equal(hasCompletedEvidence(work, 'review'), true);
  assert.deepEqual(completionIssues(work), []);

  work.blocks.assignments.find(({ role }) => role === 'test')
    .result.checks.push({ command: 'unexecuted test', result: 'not_run' });
  assert.equal(hasCompletedEvidence(work, 'test'), false);
  assert.ok(completionIssues(work).some(
    (issue) => issue.code === 'MISSING_VERIFICATION_EVIDENCE'
      && issue.message.startsWith('test execution requires'),
  ));
});
