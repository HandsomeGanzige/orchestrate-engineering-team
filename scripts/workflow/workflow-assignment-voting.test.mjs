import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assignmentCommand,
  packetCommand,
  resultCommand,
  voteCommand,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import {
  baseTime,
  createClaimed,
  developmentResult,
  parseBlock,
  temporaryWorkspace,
  verifierResult,
} from './test-helpers.mjs';

async function addAssignment(root, input) {
  return assignmentCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'add',
    input,
    now: baseTime,
  });
}

async function startAssignment(root, id) {
  return assignmentCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'start',
    input: { id },
    now: baseTime,
  });
}

test('blocked assignment restart clears the result and stale blockers', async (t) => {
  const root = await temporaryWorkspace(t);
  const { file } = await createClaimed(root);
  await addAssignment(root, {
    id: 'dev-retry',
    role: 'development',
    objective: 'Retry implementation.',
    write: ['src/retry.mjs'],
  });
  await startAssignment(root, 'dev-retry');
  await resultCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    input: {
      assignment: 'dev-retry',
      result: developmentResult({ status: 'blocked', blockers: ['Missing fixture.'] }),
    },
    now: baseTime,
  });
  await startAssignment(root, 'dev-retry');
  const restarted = parseBlock(await readFile(file, 'utf8'), 'assignments')[0];
  assert.equal(restarted.status, 'in_progress');
  assert.equal(restarted.result, null);
  assert.deepEqual(restarted.blockers, []);
});

test('completed Development results project votes and compute both decisions', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  await addAssignment(root, {
    id: 'dev-runtime',
    role: 'development',
    objective: 'Implement runtime.',
    write: ['src/runtime.mjs'],
  });
  await startAssignment(root, 'dev-runtime');
  const result = developmentResult({
    test_reason: 'Runtime changed.',
    requires_review: false,
    review_reason: 'Generated surface.',
  });
  await resultCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    input: { assignment: 'dev-runtime', result },
    now: baseTime,
  });
  await assignmentCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'complete',
    input: { id: 'dev-runtime' },
    now: baseTime,
  });
  for (const input of [
    {
      role: 'architecture',
      requiresTest: false,
      testReason: 'Covered mechanically.',
      requiresReview: false,
      reviewReason: 'No open semantic decisions.',
      covered: true,
    },
    {
      role: 'main',
      requiresTest: false,
      testReason: 'Deterministic suite is complete.',
      requiresReview: true,
      reviewReason: 'Concurrency needs review.',
    },
  ]) {
    await voteCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'record',
      input,
      now: baseTime,
    });
  }
  const computed = await voteCommand({
    root,
    work: 'deterministic-runtime',
    owner: 'main-a',
    action: 'compute',
    input: {},
    now: baseTime,
  });
  assert.equal(computed.decisions.test.execute, false);
  assert.equal(computed.decisions.review.execute, false);
});

test('Development vote recording rejects unfinished and mismatched evidence in order', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  await addAssignment(root, {
    id: 'dev-runtime',
    role: 'development',
    objective: 'Implement runtime.',
    write: ['src/runtime.mjs'],
  });
  const vote = {
    role: 'development',
    assignment: 'dev-runtime',
    requiresTest: false,
    testReason: 'Mechanical.',
    requiresReview: false,
    reviewReason: 'Mechanical.',
  };
  for (const stage of ['pending', 'in_progress', 'result-only']) {
    if (stage === 'in_progress') await startAssignment(root, 'dev-runtime');
    if (stage === 'result-only') {
      await resultCommand({
        root,
        work: 'deterministic-runtime',
        owner: 'main-a',
        input: {
          assignment: 'dev-runtime',
          result: developmentResult({
            requires_test: false,
            test_reason: 'Mechanical.',
            requires_review: false,
            review_reason: 'Mechanical.',
          }),
        },
        now: baseTime,
      });
    }
    await assert.rejects(
      voteCommand({
        root,
        work: 'deterministic-runtime',
        owner: 'main-a',
        action: 'record',
        input: vote,
        now: baseTime,
      }),
      (error) => error.code === 'INVALID_VOTE'
        && error.message === 'development vote requires a completed Development result',
    );
  }
});

test('Review packets expose only the latest completed Test or Retest summary', async (t) => {
  const root = await temporaryWorkspace(t);
  await createClaimed(root);
  for (const [id, role, summary] of [
    ['test-first', 'test', ['Earlier failure.']],
    ['retest-latest', 'retest', ['Latest retest passed.']],
  ]) {
    await addAssignment(root, { id, role, objective: 'Run independent verification.' });
    await startAssignment(root, id);
    await resultCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      input: { assignment: id, result: verifierResult({ summary }) },
      now: baseTime,
    });
    await assignmentCommand({
      root,
      work: 'deterministic-runtime',
      owner: 'main-a',
      action: 'complete',
      input: { id },
      now: baseTime,
    });
  }
  await addAssignment(root, {
    id: 'review-latest-evidence',
    role: 'review',
    objective: 'Review the latest verified change.',
  });
  const packet = await packetCommand({
    root,
    work: 'deterministic-runtime',
    input: { assignment: 'review-latest-evidence' },
  });
  assert.deepEqual(packet.verification_context.test_summary, ['Latest retest passed.']);
});
