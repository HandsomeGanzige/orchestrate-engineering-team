import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COMMAND_DESCRIPTORS,
  PUBLIC_COMMANDS,
  commandHelp,
  parseCli,
  runCli,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

test('CLI exposes exactly eight descriptor-driven intent commands', () => {
  assert.deepEqual(PUBLIC_COMMANDS, ['open', 'plan', 'next', 'dispatch', 'accept', 'resolve', 'close', 'inspect']);
  assert.deepEqual(Object.keys(COMMAND_DESCRIPTORS), PUBLIC_COMMANDS);
  assert.deepEqual(commandHelp().commands.map(({ name }) => name), PUBLIC_COMMANDS);
  for (const command of PUBLIC_COMMANDS) {
    const descriptor = COMMAND_DESCRIPTORS[command];
    assert.equal(descriptor.name, command);
    assert.equal(descriptor.payload_schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(descriptor.success_schema.required, ['ok', 'command', 'data']);
    assert.deepEqual(descriptor.error_schema.required, ['ok', 'command', 'error']);
    assert.ok(descriptor.error_codes.includes('INVALID_INPUT'));
    assert.equal(descriptor.examples.request.command, command);
    assert.equal(descriptor.examples.success.ok, true);
    assert.equal(descriptor.examples.failure.ok, false);
  }
});

test('generated help, schema, and examples use the stable success shape', async () => {
  for (const flag of ['--help', '--schema', '--examples']) {
    const result = await runCli(['dispatch', flag]);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'dispatch');
    assert.ok(result.data);
  }
});

test('descriptor schemas and runtime validation share operation-specific request requirements', async () => {
  const topLevelRequirements = {
    open: { create: ['operation', 'request'], resume: ['operation', 'work', 'owner'] },
    plan: {
      work: ['operation', 'work', 'owner', 'request'],
      'confirm-decision': ['operation', 'work', 'owner', 'request'],
      todo: ['operation', 'work', 'owner', 'request'],
      assignment: ['operation', 'work', 'owner', 'request'],
      child: ['operation', 'work', 'owner', 'request'],
    },
    next: { handoff: ['operation', 'work'] },
    dispatch: { assignment: ['operation', 'work', 'owner', 'request'] },
    accept: {
      'role-result': ['operation', 'work', 'owner', 'request'],
      child: ['operation', 'work', 'owner', 'request'],
    },
    resolve: {
      todo: ['operation', 'work', 'owner', 'request'],
      assignment: ['operation', 'work', 'owner', 'request'],
      work: ['operation', 'work', 'owner', 'request'],
      vote: ['operation', 'work', 'owner', 'request'],
    },
    close: {
      preflight: ['operation'],
      complete: ['operation', 'work', 'owner', 'request'],
      release: ['operation', 'work', 'owner'],
    },
    inspect: {
      list: ['operation'],
      find: ['operation', 'request'],
      history: ['operation', 'work'],
      validate: ['operation'],
      metrics: ['operation', 'work'],
    },
  };
  for (const [command, descriptor] of Object.entries(COMMAND_DESCRIPTORS)) {
    assert.deepEqual(
      descriptor.payload_schema.oneOf.map((variant) => variant.properties.operation.const),
      descriptor.payload_schema.properties.operation.enum,
    );
    for (const variant of descriptor.payload_schema.oneOf) {
      const operation = variant.properties.operation.const;
      assert.deepEqual(variant.required, topLevelRequirements[command][operation]);
      const required = variant.properties.request?.required ?? [];
      if (!required.length) continue;
      await assert.rejects(
        runCli([
          command,
          '--operation', variant.properties.operation.const,
          '--work', 'missing-work',
          '--owner', 'main',
          '--request', '{}',
        ]),
        (error) => error.code === 'INVALID_INPUT'
          && error.message === `payload.request requires ${required.join(', ')}`,
      );
    }
  }
});

test('operation schemas reject missing routing context and malformed nested request values', async () => {
  const invalidInvocations = [
    ['open', '--operation', 'resume', '--work', 'work-without-owner'],
    ['close', '--operation', 'release', '--work', 'work-without-owner'],
    ['inspect', '--operation', 'history'],
    ['inspect', '--operation', 'metrics'],
    ['dispatch', '--operation', 'assignment', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({ assignment: 7 })],
    ['plan', '--operation', 'child', '--work', 'parent', '--owner', 'main', '--request', JSON.stringify({
      id: 'child', name: 'Child', goal: 'Deliver child.', successCriteria: ['Delivered.'],
    })],
    ['plan', '--operation', 'child', '--work', 'parent', '--owner', 'main', '--request', JSON.stringify({
      id: 'child', name: 'Child', goal: 'Deliver child.', successCriteria: ['Delivered.'],
      eligibility: { independentlyAcceptable: true, withinParentScope: true, crossSession: 'yes' },
    })],
    ['plan', '--operation', 'child', '--work', 'parent', '--owner', 'main', '--request', JSON.stringify({
      id: 'child', name: 'Child', goal: 'Deliver child.', successCriteria: ['Delivered.'],
      eligibility: { independentlyAcceptable: true, withinParentScope: true, plannedRoles: ['test', 'test'] },
    })],
    ['plan', '--operation', 'child', '--work', 'parent', '--owner', 'main', '--request', JSON.stringify({
      id: 'child', name: 'Child', goal: 'Deliver child.', successCriteria: ['Delivered.'], leaseMinutes: 5,
      eligibility: { independentlyAcceptable: true, withinParentScope: true, crossSession: true },
    })],
  ];
  for (const argv of invalidInvocations) await assert.rejects(runCli(argv), { code: 'INVALID_INPUT' });

  const childSchema = COMMAND_DESCRIPTORS.plan.payload_schema.oneOf
    .find((variant) => variant.properties.operation.const === 'child')
    .properties.request;
  assert.deepEqual(childSchema.required, ['id', 'name', 'goal', 'successCriteria', 'eligibility']);
  assert.equal(childSchema.properties.eligibility.properties.independentlyAcceptable.const, true);
  assert.equal(childSchema.properties.eligibility.properties.withinParentScope.const, true);
  assert.equal(childSchema.properties.eligibility.anyOf.length, 3);
  assert.equal(childSchema.properties.leaseMinutes, undefined);
  assert.equal(COMMAND_DESCRIPTORS.open.payload_schema.oneOf[1].properties.request.properties.leaseMinutes.type, 'integer');
});

test('action-discriminated schemas reject malformed Work, Todo, Assignment, and Vote inputs', async () => {
  const invalidInvocations = [
    ['plan', '--operation', 'work', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'evidence', input: { evidence: 'Proof without a criterion.' },
    })],
    ['resolve', '--operation', 'work', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'update', input: { status: 'completed' },
    })],
    ['plan', '--operation', 'todo', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'add', input: { id: 'todo-without-text' },
    })],
    ['resolve', '--operation', 'todo', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'block', input: { id: 'todo', blockers: [] },
    })],
    ['plan', '--operation', 'assignment', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      input: { id: 'development', role: 'development', objective: 'Implement it.' },
    })],
    ['resolve', '--operation', 'assignment', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'start', input: {},
    })],
    ['resolve', '--operation', 'vote', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'record', input: {
        role: 'main', requiresTest: true, requiresReview: true, reviewReason: 'Review it.',
      },
    })],
    ['resolve', '--operation', 'vote', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'record', input: {
        role: 'development', requiresTest: true, testReason: 'Test it.',
        requiresReview: true, reviewReason: 'Review it.',
      },
    })],
    ['resolve', '--operation', 'vote', '--work', 'work', '--owner', 'main', '--request', JSON.stringify({
      action: 'compute', input: { role: 'main' },
    })],
    ['open', '--operation', 'create', '--request', JSON.stringify({
      id: 'bad-lease', name: 'Bad lease', goal: 'Reject an invalid lease.',
      successCriteria: ['Invalid lease is rejected.'], leaseMinutes: 0,
    })],
  ];
  for (const argv of invalidInvocations) await assert.rejects(runCli(argv), { code: 'INVALID_INPUT' });

  const operationSchema = (command, operation) => COMMAND_DESCRIPTORS[command].payload_schema.oneOf
    .find((variant) => variant.properties.operation.const === operation)
    .properties.request;
  assert.deepEqual(operationSchema('plan', 'work').oneOf.map((variant) => variant.properties.action.const), ['update', 'evidence']);
  assert.deepEqual(operationSchema('resolve', 'todo').oneOf.map((variant) => variant.properties.action.const), ['add', 'start', 'complete', 'block']);
  assert.deepEqual(operationSchema('resolve', 'vote').oneOf.map((variant) => variant.properties.action.const), ['record', 'compute']);
  assert.equal(operationSchema('plan', 'assignment').oneOf[0].properties.input.anyOf[0].properties.write.minItems, 1);
  assert.deepEqual(
    COMMAND_DESCRIPTORS.open.payload_schema.oneOf[0].properties.request.properties.leaseMinutes,
    { type: 'integer', minimum: 1, maximum: 1440 },
  );
});

test('verification vote record and compute are available only through resolve', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workflow-cli-vote-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const opened = await runCli([
    'open', '--root', root, '--operation', 'create', '--owner', 'main', '--request',
    JSON.stringify({ id: 'vote-work', name: 'Vote work', goal: 'Route votes.', successCriteria: ['Votes route.'], leaseMinutes: 5 }),
  ]);
  assert.equal(opened.data.lease.lease_minutes, 5);
  const recorded = await runCli([
    'resolve', '--root', root, '--work', 'vote-work', '--owner', 'main', '--operation', 'vote', '--request',
    JSON.stringify({
      action: 'record',
      input: {
        role: 'main', requiresTest: true, testReason: 'Run Test.',
        requiresReview: true, reviewReason: 'Run Review.',
      },
    }),
  ]);
  assert.deepEqual(recorded, {
    ok: true,
    command: 'resolve',
    data: { ok: true, work: '.agent-work/open/vote-work/work.md', vote: 'main' },
  });
  const computed = await runCli([
    'resolve', '--root', root, '--work', 'vote-work', '--owner', 'main', '--operation', 'vote', '--request',
    JSON.stringify({ action: 'compute', input: {} }),
  ]);
  assert.equal(computed.ok, true);
  assert.equal(computed.command, 'resolve');
  assert.equal(computed.data.decisions.test.execute, true);
  assert.equal(computed.data.decisions.review.execute, true);
  await assert.rejects(runCli(['vote']), { code: 'INVALID_COMMAND' });
});

test('release-facing workflow documentation names all acceptance criteria and packet roles', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const packet = await readFile(new URL('../../.agents/skills/orchestrate-engineering-team/assets/role-task-packet.md', import.meta.url), 'utf8');
  assert.match(readme, /C01-C24 deterministic\/forward evidence record/);
  assert.doesNotMatch(readme, /C01-C20 deterministic\/forward evidence record/);
  assert.match(packet, /Role: <Architecture \| Development \| Test \| Review \| Retest \| Rereview>/);
});

test('CLI rejects every retired low-level command and positional alias', async () => {
  for (const argv of [['init'], ['create'], ['claim'], ['assignment', 'add'], ['history'], ['material', 'add'], ['vote'], ['open', 'create']]) {
    await assert.rejects(runCli(argv), { code: 'INVALID_COMMAND' });
  }
});
