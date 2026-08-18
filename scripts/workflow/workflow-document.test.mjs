import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssignment, applyDecision, applyResult } from '../../.agents/skills/orchestrate-engineering-team/scripts/work-model.mjs';
import {
  decorateWork,
  newWorkDocument,
  syncWork,
  validateDocument,
  validateState,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';

test('document interface separates readable Markdown from coordination state', () => {
  const document = newWorkDocument({ id: 'plain-document', name: 'Plain document', goal: 'Stay readable.', successCriteria: ['Readable.'] }, null, new Date(0));
  syncWork(document);
  assert.doesNotMatch(document.markdown, /^---$|```json|<!--\s*workflow:/m);
  assert.equal(document.state.version, 2);
  assert.equal(document.state.contract.objective, 'Stay readable.');
  assert.equal(validateDocument(document), document);
});

test('document validation rejects ambiguous duplicate semantic facts', () => {
  const base = newWorkDocument({ id: 'unambiguous-document', name: 'Unambiguous document', goal: 'Keep one fact.', successCriteria: ['Facts are unique.'] }, null, new Date(0));
  const mutations = [
    (markdown) => `${markdown}\n# Second title\n`,
    (markdown) => `${markdown}\n  #   Second title ###   \n`,
    (markdown) => markdown.replace('Status: active', 'Status: active\n\nStatus: active'),
    (markdown) => `${markdown}\n## Outcome\n\nConflicting outcome.\n`,
    (markdown) => `${markdown}\n ##   oUtCoMe ###   \n\nConflicting normalized outcome.\n`,
    (markdown) => `${markdown}\n## Acceptance\n\n- [ ] Conflicting acceptance.\n`,
    (markdown) => `${markdown}\n ##\tACCEPTANCE\t##\n\n- [ ] Conflicting tabbed acceptance.\n`,
  ];
  for (const mutate of mutations) {
    const document = decorateWork({ kind: 'work', markdown: mutate(base.markdown), state: structuredClone(base.state) });
    assert.throws(() => validateDocument(document), { code: 'INVALID_DOCUMENT' });
  }
  for (const heading of ['Out*come', 'Out_come', '`Outcome`', '**Outcome**']) {
    const distinct = decorateWork({ kind: 'work', markdown: `${base.markdown}\n## ${heading}\n\nOrdinary extension.\n`, state: structuredClone(base.state) });
    assert.equal(validateDocument(distinct), distinct);
  }
});

test('semantic heading scanner ignores code and Setext while accepting supported ATX variants', () => {
  const base = newWorkDocument({ id: 'structural-headings', name: 'Structural headings', goal: 'Parse blocks.', successCriteria: ['Blocks parse.'] }, null, new Date(0));
  const examples = decorateWork({
    kind: 'work',
    markdown: `${base.markdown}\n\`\`\`markdown\n# Example title\n## Outcome\n\`\`\`\n\n    # Indented title\n    ## Acceptance\n\nOutcome\n-------\n`,
    state: structuredClone(base.state),
  });
  assert.equal(validateDocument(examples), examples);

  const variant = decorateWork({
    kind: 'work',
    markdown: base.markdown
      .replace('## Outcome', ' ## oUtCoMe ###')
      .replace('## Acceptance', '  ##\tAcceptance\t##'),
    state: structuredClone(base.state),
  });
  assert.equal(validateDocument(variant), variant);
  assert.equal(variant.blocks.goal, 'Parse blocks.');
  assert.deepEqual(variant.blocks.success_criteria, ['Blocks parse.']);

  const statusesInCode = decorateWork({
    kind: 'work',
    markdown: `${base.markdown}\n\`\`\`text\nStatus: blocked\n## Outcome\n\`\`\`\n\n    Status: blocked\n`,
    state: structuredClone(base.state),
  });
  assert.equal(validateDocument(statusesInCode), statusesInCode);

  const invalidFence = decorateWork({
    kind: 'work',
    markdown: `${base.markdown}\n\`\`\` invalid\`info\n## Outcome\n\nConflicting real heading.\n`,
    state: structuredClone(base.state),
  });
  assert.throws(() => validateDocument(invalidFence), { code: 'INVALID_DOCUMENT' });
});

test('decision evidence survives Markdown rendering and reload without entering operational state', () => {
  const document = newWorkDocument({ id: 'decision-evidence', name: 'Decision evidence', goal: 'Retain links.', successCriteria: ['Links reload.'] }, null, new Date(0));
  applyDecision(document, 'add', {
    id: 'retain-links',
    summary: 'Keep [Markdown] *literal* $& and the \u2014 Evidence: delimiter.',
    evidence: ['docs/decision record.md', 'https://example.test/evidence?id=7'],
  });
  syncWork(document);
  assert.match(document.markdown, /\[Markdown\] \*literal\* \$& and the \u2014 Evidence: delimiter\.\n  - Evidence: \[docs\/decision record\.md\]\(docs\/decision%20record\.md\)/);
  assert.equal(JSON.stringify(document.state).includes('decision record'), false);
  const reloaded = decorateWork({ kind: 'work', markdown: document.markdown, state: structuredClone(document.state) });
  assert.deepEqual(reloaded.blocks.confirmed_decisions, [{
    id: 'retain-links',
    summary: 'Keep [Markdown] *literal* $& and the \u2014 Evidence: delimiter.',
    evidence: ['docs/decision record.md', 'https://example.test/evidence?id=7'],
  }]);
  for (const [id, lineBreak] of [
    ['reject-cr', '\r'],
    ['reject-lf', '\n'],
    ['reject-line-separator', '\u2028'],
    ['reject-paragraph-separator', '\u2029'],
  ]) {
    assert.throws(
      () => applyDecision(document, 'add', {
        id, summary: `First line${lineBreak}  - Evidence: injected`, evidence: [],
      }),
      (error) => error.code === 'INVALID_INPUT' && error.message === 'decision summary must be a single line',
    );
  }
  applyDecision(document, 'add', {
    id: 'retain-special-single-line',
    summary: 'Keep | [] () * _ # $& 🥷 on one line.',
    evidence: [],
  });
  assert.match(document.markdown, /Keep \| \[\] \(\) \* _ # \$& 🥷 on one line\./);
});

test('Architecture vote projection follows completion order instead of Assignment array order', () => {
  const document = newWorkDocument({ id: 'ordered-architecture', name: 'Ordered architecture', goal: 'Order receipts.', successCriteria: ['Latest completion wins.'] }, null, new Date(0));
  for (const [id, objective] of [
    ['architecture-created-first', 'Complete second.'],
    ['architecture-created-second', 'Complete first.'],
  ]) {
    applyAssignment(document, 'add', { id, role: 'architecture', objective });
    applyAssignment(document, 'start', { id });
  }
  /** Completes one Architecture Assignment. @param {string} id Assignment ID. @param {boolean} requires Vote. @param {string} label Label. @returns {void} */
  const complete = (id, requires, label) => {
    applyResult(document, {
      assignment: id,
      result: {
        status: 'completed', summary: [`${label} completed.`], artifacts: [], decision_proposals: [], files: [],
        checks: [{ command: `${label} check`, result: 'passed' }],
        requires_test: requires, test_reason: `${label} test vote.`,
        requires_review: requires, review_reason: `${label} review vote.`, blockers: [],
      },
    });
    applyAssignment(document, 'complete', { id });
  };
  complete('architecture-created-second', false, 'First completion');
  complete('architecture-created-first', true, 'Latest completion');
  syncWork(document);
  assert.deepEqual(document.state.assignments.map((assignment) => assignment.receipt.completed_order), [2, 1]);
  assert.equal(document.state.verification.votes.architecture.assignment, 'architecture-created-first');
  validateState(document.state);

  const reordered = JSON.parse(JSON.stringify(document.state));
  reordered.assignments.reverse();
  validateState(reordered);
  reordered.verification.votes.architecture = {
    assignment: 'architecture-created-second', covered: true,
    ...reordered.assignments.find((assignment) => assignment.id === 'architecture-created-second').receipt.votes,
  };
  assert.throws(() => validateState(reordered), { code: 'INVALID_DOCUMENT' });
});

test('state recovery validation rejects malformed ownership, assignment packets, todos, and gates', async (t) => {
  const document = newWorkDocument({ id: 'strict-recovery', name: 'Strict recovery', goal: 'Fail closed.', successCriteria: ['Malformed state is rejected.'] }, null, new Date(0));
  applyAssignment(document, 'add', {
    id: 'strict-development', role: 'development', objective: 'Exercise recovery.',
    successCriteria: ['Every packet field survives.'], read: ['README.md'], write: ['src/runtime.mjs'],
    decisions: ['retain-links'], requiredCapabilities: ['workspace-read'], availableCapabilities: ['workspace-read'],
    dependsOn: [], sharedInterfaceStable: true, touchesGlobal: false, integrator: '/root',
  });
  applyAssignment(document, 'add', {
    id: 'strict-architecture', role: 'architecture', objective: 'Define recovery boundaries.',
    successCriteria: ['Recovery boundaries are explicit.'], read: ['README.md'], write: [],
    decisions: [], requiredCapabilities: ['workspace-read'], availableCapabilities: ['workspace-read'],
    dependsOn: [], sharedInterfaceStable: true, touchesGlobal: false, integrator: '/root',
  });
  applyAssignment(document, 'start', { id: 'strict-architecture' });
  applyResult(document, {
    assignment: 'strict-architecture',
    result: {
      status: 'completed', summary: ['Architecture completed.'], artifacts: [], decision_proposals: [], files: [],
      checks: [{ command: 'architecture check', result: 'passed' }],
      requires_test: true, test_reason: 'Recovery behavior needs testing.',
      requires_review: true, review_reason: 'Recovery boundaries need review.', blockers: [],
    },
  });
  applyAssignment(document, 'complete', { id: 'strict-architecture' });
  syncWork(document);
  validateState(document.state);

  const blockedAssignment = structuredClone(document.state);
  blockedAssignment.assignments[0].status = 'blocked';
  blockedAssignment.assignments[0].blockers = ['Retry after dependency recovery.'];
  blockedAssignment.assignments[0].receipt = {
    status: 'partial', changed_surface: [],
    votes: {
      test: { requires: true, reason: 'Retry needs testing.' },
      review: { requires: true, reason: 'Retry needs review.' },
    },
  };
  assert.throws(() => validateState(blockedAssignment));
  blockedAssignment.assignments[0].status = 'in_progress';
  blockedAssignment.assignments[0].blockers = [];
  blockedAssignment.assignments[0].receipt = null;
  assert.throws(() => validateState(blockedAssignment));

  const blockedTodo = structuredClone(document.state);
  blockedTodo.status = 'blocked';
  blockedTodo.todos[0].status = 'blocked';
  blockedTodo.todos[0].blockers = ['Awaiting a user decision.'];
  validateState(blockedTodo);

  const cases = [
    ['owner without lease', (state) => { state.owner = 'main'; }],
    ['lease without owner', (state) => { state.lease_until = '2026-08-12T02:00:00.000Z'; }],
    ['invalid lease duration', (state) => { state.lease_minutes = 0; }],
    ['malformed todo blockers', (state) => { state.todos[0].blockers = ['unresolved']; }],
    ['missing todo field', (state) => { delete state.todos[0].assignment; }],
    ['malformed capabilities', (state) => { delete state.assignments[0].capabilities.unavailable; }],
    ['malformed write scope', (state) => { state.assignments[0].write = ['../outside']; }],
    ['missing packet objective', (state) => { delete state.assignments[0].objective; }],
    ['missing packet success criteria', (state) => { delete state.assignments[0].successCriteria; }],
    ['missing packet read scope', (state) => { delete state.assignments[0].read; }],
    ['missing packet decisions', (state) => { delete state.assignments[0].decisions; }],
    ['missing dependency field', (state) => { delete state.assignments[0].dependsOn; }],
    ['missing parallel safety field', (state) => { delete state.assignments[0].topology.shared_interface_stable; }],
    ['malformed verification votes', (state) => { state.verification.votes.development = {}; }],
    ['missing architecture vote', (state) => { state.verification.votes.architecture = null; }],
    ['disagreeing architecture vote', (state) => {
      state.verification.votes.architecture.test = { requires: false, reason: 'Fabricated disagreement.' };
    }],
    ['misattributed architecture vote', (state) => { state.verification.votes.architecture.assignment = 'strict-development'; }],
    ['fabricated architecture vote', (state) => { state.assignments = state.assignments.filter((assignment) => assignment.role !== 'architecture'); }],
    ['malformed verification decision', (state) => { state.verification.decisions.test = { execute: true }; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const state = structuredClone(document.state);
      mutate(state);
      assert.throws(() => validateState(state));
    });
  }
});
