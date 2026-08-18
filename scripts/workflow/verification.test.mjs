import assert from 'node:assert/strict';
import test from 'node:test';
import { completionIssues, computeVotes, hasCompletedEvidence } from '../../.agents/skills/orchestrate-engineering-team/scripts/verification.mjs';

test('gate interface defaults to execution unless supported votes waive it', () => {
  const verification = { votes: { architecture: null, development: [], main: { test: { requires: true, reason: 'Run it.' }, review: { requires: false, reason: 'No review.' } } } };
  assert.equal(computeVotes(verification, 'test').execute, true);
  assert.equal(computeVotes(verification, 'review').execute, false);
});

test('verification freshness follows dimension-specific finding routes and explicit shared-surface votes', () => {
  const receipt = (completedOrder, extra = {}) => ({ status: 'completed', completed_order: completedOrder, ...extra });
  const development = (id, completedOrder, dependsOn = [], votes = { test: { requires: true }, review: { requires: true } }) => ({
    id, role: 'development', status: 'completed', write: ['src/a.mjs'],
    dependsOn, receipt: receipt(completedOrder, { changed_surface: ['src/a.mjs'], votes }), blockers: [],
  });
  const verifier = (id, role, completedOrder, dependsOn = []) => ({
    id, role, status: 'completed', write: [], dependsOn, receipt: receipt(completedOrder, { passed: true }), blockers: [],
  });
  const makeDocument = (fix) => {
    const assignments = [
      development('initial-development', 1),
      verifier('initial-test', 'test', 2, ['initial-development']),
      verifier('initial-review', 'review', 3, ['initial-development']),
      fix,
    ];
    const document = {
    blocks: {
      todo: [{ id: 'done', status: 'completed', blockers: [] }],
      assignments,
      success_criteria: ['Verified.'],
      result: { status: 'completed', summary: ['Done.'], blockers: [], success_evidence: [{ criterion: 'Verified.', evidence: 'Checked.' }] },
      verification: {
        votes: {
          architecture: null,
          development: [
            { assignment: 'initial-development', test: { requires: true }, review: { requires: true } },
            { assignment: fix.id, ...fix.receipt.votes },
          ],
          main: { test: { requires: true, reason: 'Test.' }, review: { requires: true, reason: 'Review.' } },
        },
        decisions: { test: null, review: null },
      },
    },
  };
    document.blocks.verification.decisions.test = computeVotes(document.blocks.verification, 'test');
    document.blocks.verification.decisions.review = computeVotes(document.blocks.verification, 'review');
    return document;
  };

  const testFix = makeDocument(development('test-fix', 4, ['initial-test'], {
    test: { requires: true }, review: { requires: false },
  }));
  assert.equal(hasCompletedEvidence(testFix, 'test'), false);
  assert.equal(hasCompletedEvidence(testFix, 'review'), true);
  testFix.blocks.assignments.push(verifier('fresh-retest', 'retest', 5, ['test-fix']));
  assert.equal(hasCompletedEvidence(testFix, 'test'), true);
  assert.equal(hasCompletedEvidence(testFix, 'review'), true);

  const reviewFix = makeDocument(development('review-fix', 4, ['initial-review'], {
    test: { requires: false }, review: { requires: true },
  }));
  assert.equal(hasCompletedEvidence(reviewFix, 'test'), true);
  assert.equal(hasCompletedEvidence(reviewFix, 'review'), false);
  reviewFix.blocks.assignments.push(verifier('fresh-rereview', 'rereview', 5, ['review-fix']));
  assert.equal(hasCompletedEvidence(reviewFix, 'test'), true);
  assert.equal(hasCompletedEvidence(reviewFix, 'review'), true);

  const testOriginSharedFix = makeDocument(development('test-origin-shared-fix', 4, ['initial-test'], {
    test: { requires: true }, review: { requires: true },
  }));
  assert.equal(hasCompletedEvidence(testOriginSharedFix, 'test'), false);
  assert.equal(hasCompletedEvidence(testOriginSharedFix, 'review'), false);
  testOriginSharedFix.blocks.assignments.push(
    verifier('test-origin-shared-retest', 'retest', 5, ['test-origin-shared-fix']),
    verifier('test-origin-shared-rereview', 'rereview', 6, ['test-origin-shared-fix']),
  );
  assert.equal(hasCompletedEvidence(testOriginSharedFix, 'test'), true);
  assert.equal(hasCompletedEvidence(testOriginSharedFix, 'review'), true);

  const reviewOriginSharedFix = makeDocument(development('review-origin-shared-fix', 4, ['initial-review'], {
    test: { requires: true }, review: { requires: true },
  }));
  assert.equal(hasCompletedEvidence(reviewOriginSharedFix, 'test'), false);
  assert.equal(hasCompletedEvidence(reviewOriginSharedFix, 'review'), false);
  reviewOriginSharedFix.blocks.assignments.push(
    verifier('review-origin-shared-retest', 'retest', 5, ['review-origin-shared-fix']),
    verifier('review-origin-shared-rereview', 'rereview', 6, ['review-origin-shared-fix']),
  );
  assert.equal(hasCompletedEvidence(reviewOriginSharedFix, 'test'), true);
  assert.equal(hasCompletedEvidence(reviewOriginSharedFix, 'review'), true);

  const sharedFix = makeDocument(development('shared-fix', 4));
  assert.equal(hasCompletedEvidence(sharedFix, 'test'), false);
  assert.equal(hasCompletedEvidence(sharedFix, 'review'), false);
  sharedFix.blocks.assignments.push(
    verifier('shared-retest', 'retest', 5, ['shared-fix']),
    verifier('shared-rereview', 'rereview', 6, ['shared-fix']),
  );
  assert.equal(hasCompletedEvidence(sharedFix, 'test'), true);
  assert.equal(hasCompletedEvidence(sharedFix, 'review'), true);
  assert.deepEqual(completionIssues(sharedFix), []);

  const ambiguous = makeDocument(development('ambiguous-fix', 4, [], {
    test: { requires: false }, review: { requires: false },
  }));
  assert.equal(hasCompletedEvidence(ambiguous, 'test'), false);
  assert.equal(hasCompletedEvidence(ambiguous, 'review'), false);
});
