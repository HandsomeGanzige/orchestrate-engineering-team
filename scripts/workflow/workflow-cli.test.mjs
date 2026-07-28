import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import * as workflow from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';
import { WorkflowError as ContractError } from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-contract.mjs';
import {
  baseTime,
  developmentResult,
  temporaryWorkspace,
  workInput,
} from './test-helpers.mjs';

const execFile = promisify(execFileCallback);
const cli = path.resolve('.agents/skills/orchestrate-engineering-team/scripts/workflow.mjs');

function spawnCli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const expectedExports = [
  'LEASE_MINUTES', 'WorkflowError', 'assignmentCommand', 'childSync', 'claimWork',
  'computeVotes', 'createWork', 'decisionCommand', 'findCommand', 'handoffCommand',
  'initWorkspace', 'listCommand', 'loadInput', 'materialCommand', 'mutateWork',
  'packetCommand', 'parseCli', 'releaseWork', 'resultCommand', 'runCli',
  'scopesConflict', 'todoCommand', 'validateRoleResult', 'validateWorkspace',
  'voteCommand', 'workCommand',
];

test('workflow facade preserves its explicit export surface and error identity', async () => {
  assert.deepEqual(Object.keys(workflow).sort(), expectedExports.sort());
  assert.equal(workflow.WorkflowError, ContractError);
  await assert.rejects(
    workflow.runCli(['unknown-command']),
    (error) => error instanceof workflow.WorkflowError
      && error.code === 'INVALID_COMMAND'
      && error.message === 'unknown command: unknown-command',
  );
});

test('CLI process preserves exact WorkflowError stderr JSON and exit code', async () => {
  await assert.rejects(
    execFile(process.execPath, [cli, 'unknown-command']),
    (error) => error.code === 1
      && error.stdout === ''
      && error.stderr === '{"error":"INVALID_COMMAND","message":"unknown command: unknown-command"}\n',
  );
});

test('CLI process honors payload files, stdin payloads, flag precedence, and exact JSON stdout', async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), 'workflow-cli-transport-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cases = [
    {
      name: 'payload file',
      id: 'payload-file-work',
      payload: path.join(base, 'payload.json'),
    },
    {
      name: 'stdin payload',
      id: 'stdin-payload-work',
      payload: '-',
    },
    {
      name: 'flags override payload',
      id: 'flag-override-work',
      payload: path.join(base, 'override-payload.json'),
      payloadId: 'ignored-payload-work',
      flags: ['--id', 'flag-override-work'],
    },
  ];

  for (const fixture of cases) {
    const root = path.join(base, fixture.id);
    const payload = JSON.stringify({
      id: fixture.payloadId ?? fixture.id,
      name: 'Transport work',
      summary: 'Exercises the real CLI transport.',
      keywords: ['cli', 'payload', 'transport'],
      type: 'delivery',
      goal: 'Exercise payload transport.',
      successCriteria: ['The transport succeeds.'],
    });
    if (fixture.payload !== '-') await writeFile(fixture.payload, payload);

    const { code, stdout, stderr } = await spawnCli(
      ['create', '--root', root, '--payload', fixture.payload, ...(fixture.flags ?? [])],
      fixture.payload === '-' ? payload : '',
    );

    assert.equal(code, 0, fixture.name);
    assert.equal(stderr, '', fixture.name);
    assert.equal(
      stdout,
      `{"ok":true,"work":".agent-work/work-items/${fixture.id}/index.md","id":"${fixture.id}"}\n`,
      fixture.name,
    );
  }
});

test('CLI parser preserves the complete command and action matrix', () => {
  const matrix = [
    ['init'],
    ['create'],
    ['claim'],
    ['release'],
    ['work'],
    ['work', 'update'],
    ['work', 'evidence'],
    ['decision', 'add'],
    ['todo', 'add'],
    ['todo', 'start'],
    ['todo', 'complete'],
    ['todo', 'block'],
    ['assignment', 'add'],
    ['assignment', 'start'],
    ['assignment', 'complete'],
    ['assignment', 'block'],
    ['result'],
    ['vote', 'record'],
    ['vote', 'compute'],
    ['child', 'create'],
    ['child', 'sync'],
    ['material', 'add'],
    ['packet'],
    ['find'],
    ['list'],
    ['handoff'],
    ['validate'],
  ];
  for (const [command, action] of matrix) {
    assert.deepEqual(workflow.parseCli([command, ...(action ? [action] : [])]), {
      command,
      action,
      flags: {},
    });
  }
});

test('CLI action dispatch rejects unsupported actions with stable errors', async () => {
  const cases = [
    ['work', 'unknown', 'work supports update or evidence'],
    ['decision', 'unknown', 'decision supports only add'],
    ['todo', 'unknown', 'invalid todo action'],
    ['assignment', 'unknown', 'invalid assignment action'],
    ['vote', 'unknown', 'vote supports record or compute'],
    ['material', 'unknown', 'material supports only add'],
    ['child', 'unknown', 'unknown command: child unknown'],
  ];
  for (const [command, action, message] of cases) {
    await assert.rejects(
      workflow.runCli([command, action]),
      (error) => error.code === 'INVALID_COMMAND' && error.message === message,
    );
  }
});

test('CLI assignment add rejects missing prerequisites and start rejects unfinished ones', async (t) => {
  const root = await temporaryWorkspace(t);
  const input = workInput();
  await workflow.runCli(['init', '--root', root], { now: baseTime });
  await workflow.runCli([
    'create', '--root', root, '--id', input.id, '--name', input.name,
    '--summary', input.summary, '--keywords', JSON.stringify(input.keywords),
    '--type', input.type, '--goal', input.goal,
    '--success-criteria', JSON.stringify(input.successCriteria),
  ], { now: baseTime });
  await workflow.runCli([
    'claim', '--root', root, '--work', input.id, '--owner', 'main-a',
  ], { now: baseTime });

  const assignment = (...fields) => workflow.runCli([
    'assignment', 'add', '--root', root, '--work', input.id, '--owner', 'main-a',
    ...fields,
  ], { now: baseTime });
  await assert.rejects(
    assignment(
      '--id', 'dev-missing-dependent', '--role', 'development',
      '--objective', 'Reject a missing prerequisite.', '--write', '["src/missing.mjs"]',
      '--depends-on', '["dev-missing"]',
    ),
    (error) => error.code === 'NOT_FOUND'
      && error.message === 'assignment prerequisite not found: dev-missing',
  );

  await assignment(
    '--id', 'dev-prerequisite', '--role', 'development',
    '--objective', 'Remain pending.', '--write', '["src/prerequisite.mjs"]',
  );
  await assignment(
    '--id', 'dev-unfinished-dependent', '--role', 'development',
    '--objective', 'Reject an unfinished prerequisite.', '--write', '["src/unfinished.mjs"]',
    '--depends-on', '["dev-prerequisite"]',
  );
  await assert.rejects(
    workflow.runCli([
      'assignment', 'start', '--root', root, '--work', input.id, '--owner', 'main-a',
      '--id', 'dev-unfinished-dependent',
    ], { now: baseTime }),
    (error) => error.code === 'INVALID_TRANSITION'
      && error.message === 'assignment prerequisite is not completed: dev-prerequisite',
  );
});

test('CLI runtime dispatches the full command and action table', async (t) => {
  const root = await temporaryWorkspace(t);
  const input = workInput();
  const common = ['--root', root];
  const steps = [
    { args: ['init', ...common], key: 'ok' },
    {
      args: [
        'create',
        ...common,
        '--id', input.id,
        '--name', input.name,
        '--summary', input.summary,
        '--keywords', JSON.stringify(input.keywords),
        '--type', input.type,
        '--goal', input.goal,
        '--success-criteria', JSON.stringify(input.successCriteria),
      ],
      key: 'id',
    },
    {
      args: ['claim', ...common, '--work', input.id, '--owner', 'main-a'],
      key: 'owner',
    },
    {
      args: [
        'work', 'evidence', ...common, '--work', input.id, '--owner', 'main-a',
        '--criterion', input.successCriteria[0], '--evidence', 'CLI evidence.', '--pointers', '[]',
      ],
      key: 'recorded',
    },
    {
      args: [
        'work', 'update', ...common, '--work', input.id, '--owner', 'main-a',
        '--progress', 'CLI dispatch is covered.',
      ],
      key: 'status',
    },
    {
      args: [
        'decision', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'stable-cli', '--summary', 'Keep the CLI stable.',
      ],
      key: 'decision',
    },
    {
      args: [
        'todo', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'cli-step-a', '--text', 'Exercise CLI step A.',
      ],
      key: 'todo',
    },
    {
      args: [
        'todo', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'cli-step-b', '--text', 'Exercise CLI step B.',
      ],
      key: 'todo',
    },
    {
      args: [
        'todo', 'complete', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'align-goal', '--next', 'cli-step-a',
      ],
      key: 'action',
    },
    {
      args: [
        'work', ...common, '--work', input.id, '--owner', 'main-a', '--status', 'paused',
      ],
      key: 'status',
    },
    {
      args: [
        'todo', 'block', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'cli-step-a', '--blockers', '["Paused for table coverage."]',
      ],
      key: 'action',
    },
    {
      args: [
        'todo', 'start', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'cli-step-a',
      ],
      key: 'action',
    },
    {
      args: [
        'assignment', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'dev-cli', '--role', 'development', '--objective', 'Exercise CLI routing.',
        '--write', '["src/cli.mjs"]',
      ],
      key: 'assignment',
    },
    {
      args: [
        'assignment', 'start', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'dev-cli',
      ],
      key: 'action',
    },
    {
      args: [
        'result', ...common, '--work', input.id, '--owner', 'main-a',
        '--assignment', 'dev-cli', '--result', JSON.stringify(developmentResult()),
      ],
      key: 'result_status',
    },
    {
      args: [
        'assignment', 'complete', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'dev-cli',
      ],
      key: 'action',
    },
    {
      args: [
        'assignment', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'review-blocked', '--role', 'review', '--objective', 'Exercise blocking.',
      ],
      key: 'assignment',
    },
    {
      args: [
        'assignment', 'block', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'review-blocked', '--blockers', '["Waiting for review."]',
      ],
      key: 'action',
    },
    {
      args: [
        'vote', 'record', ...common, '--work', input.id, '--owner', 'main-a',
        '--role', 'main', '--requires-test', 'true', '--test-reason', 'Execute tests.',
        '--requires-review', 'true', '--review-reason', 'Execute review.',
      ],
      key: 'vote',
    },
    {
      args: [
        'vote', 'compute', ...common, '--work', input.id, '--owner', 'main-a',
      ],
      key: 'decisions',
    },
    {
      args: [
        'material', 'add', ...common, '--work', input.id, '--owner', 'main-a',
        '--role', 'architecture', '--path', 'materials/architecture/cli.md',
        '--summary', 'CLI architecture.', '--purpose', 'Guide CLI coverage.',
      ],
      key: 'material',
    },
    {
      args: ['packet', ...common, '--work', input.id, '--assignment', 'dev-cli'],
      key: 'assignment_id',
    },
    { args: ['find', ...common, '--query', 'deterministic'], array: true },
    { args: ['list', ...common, '--status', 'paused'], array: true },
    { args: ['handoff', ...common, '--work', input.id], key: 'work' },
    {
      args: [
        'child', 'create', ...common, '--work', input.id, '--owner', 'main-a',
        '--id', 'cli-child', '--name', 'CLI child',
        '--summary', 'Exercises CLI child dispatch.',
        '--keywords', '["cli","child","dispatch"]', '--type', 'delivery',
        '--goal', 'Exercise child dispatch.', '--success-criteria', '["Child is created."]',
        '--eligibility', '{"independentlyAcceptable":true,"withinParentScope":true,"plannedTodos":["Build","Verify"],"plannedRoles":[],"crossSession":false}',
      ],
      key: 'id',
    },
    {
      args: [
        'child', 'sync', ...common, '--work', input.id, '--owner', 'main-a', '--id', 'cli-child',
      ],
      key: 'child',
    },
    { args: ['validate', ...common], key: 'valid' },
    {
      args: ['release', ...common, '--work', input.id, '--owner', 'main-a'],
      key: 'released',
    },
  ];

  for (const step of steps) {
    const result = await workflow.runCli(step.args, { now: baseTime });
    if (step.array) assert.ok(Array.isArray(result), step.args.join(' '));
    else assert.ok(Object.hasOwn(result, step.key), step.args.join(' '));
  }
});

test('CLI process tables WorkflowError, validation, and internal-error exits', async (t) => {
  const missingRoot = await mkdtemp(path.join(tmpdir(), 'workflow-cli-errors-'));
  t.after(() => rm(missingRoot, { recursive: true, force: true }));
  const cases = [
    {
      name: 'WorkflowError',
      args: ['todo', 'unknown'],
      verify(error) {
        assert.equal(error.stdout, '');
        assert.equal(
          error.stderr,
          '{"error":"INVALID_COMMAND","message":"invalid todo action"}\n',
        );
      },
    },
    {
      name: 'validation result',
      args: ['validate', '--root', missingRoot],
      verify(error) {
        assert.equal(error.stderr, '');
        const result = JSON.parse(error.stdout);
        assert.equal(result.valid, false);
        assert.equal(result.errors[0].file, '.agent-work/index.md');
      },
    },
    {
      name: 'internal exception',
      args: ['init', '--root'],
      verify(error) {
        assert.equal(error.stdout, '');
        assert.equal(JSON.parse(error.stderr).error, 'INTERNAL_ERROR');
      },
    },
  ];
  for (const fixture of cases) {
    await assert.rejects(
      execFile(process.execPath, [cli, ...fixture.args]),
      (error) => {
        assert.equal(error.code, 1, fixture.name);
        fixture.verify(error);
        return true;
      },
    );
  }
});
