import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  claimWork,
  createWork,
  initWorkspace,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs';

export const baseTime = new Date('2026-07-28T01:00:00.000Z');

export async function temporaryWorkspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'workflow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export function workInput(overrides = {}) {
  return {
    id: 'deterministic-runtime',
    name: 'Deterministic runtime',
    summary: 'Provides deterministic orchestration state changes.',
    keywords: ['workflow', 'runtime', 'orchestration'],
    type: 'delivery',
    goal: 'Deliver the deterministic workflow runtime.',
    successCriteria: ['Commands preserve valid state.'],
    ...overrides,
  };
}

export async function createClaimed(root, overrides = {}, owner = 'main-a') {
  await initWorkspace({ root, now: baseTime });
  const input = workInput(overrides);
  await createWork({ root, input, now: baseTime });
  await claimWork({ root, work: input.id, owner, now: baseTime });
  return {
    input,
    owner,
    file: path.join(root, '.agent-work', 'work-items', input.id, 'index.md'),
  };
}

export function replaceBlock(text, name, mutate) {
  const expression = new RegExp('(<!-- workflow:' + name + ':start -->\\n```json\\n)([\\s\\S]*?)(\\n```\\n<!-- workflow:' + name + ':end -->)');
  const match = expression.exec(text);
  assert.ok(match, `missing ${name} block`);
  const value = JSON.parse(match[2]);
  mutate(value);
  return text.replace(expression, `$1${JSON.stringify(value, null, 2)}$3`);
}

export function parseBlock(text, name) {
  let captured;
  replaceBlock(text, name, (value) => { captured = structuredClone(value); });
  return captured;
}

export function developmentResult(overrides = {}) {
  return {
    status: 'completed',
    summary: ['Implemented the bounded runtime surface.'],
    artifacts: [],
    files: ['src/runtime.mjs'],
    checks: [{ command: 'node --test', result: 'passed' }],
    requires_test: true,
    test_reason: 'Executable state transitions changed.',
    requires_review: true,
    review_reason: 'Concurrency and ownership semantics need independent review.',
    blockers: [],
    ...overrides,
  };
}

export function verifierResult(overrides = {}) {
  return {
    status: 'completed',
    summary: ['Independent verification completed.'],
    artifacts: [],
    files: [],
    checks: [{ command: 'independent verification', result: 'passed' }],
    requires_test: null,
    test_reason: null,
    requires_review: null,
    review_reason: null,
    blockers: [],
    ...overrides,
  };
}
