import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  decodeDocument,
  encodeDocument,
  newWorkDocument,
  newWorkspaceDocument,
} from '../../.agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs';

const now = new Date('2026-07-28T01:00:00.000Z');
const assets = new URL(
  '../../.agents/skills/orchestrate-engineering-team/assets/',
  import.meta.url,
);
const SENTINEL_NAMESPACE = '⟪ORCHESTRATE:';
const SENTINEL_SUFFIX = ':6D71B11E⟫';
const SENTINEL_PATTERN = /⟪ORCHESTRATE:[A-Z0-9_]+:6D71B11E⟫/g;

function sentinel(name) {
  return `${SENTINEL_NAMESPACE}${name}${SENTINEL_SUFFIX}`;
}

function instantiateFixture(text, replacements) {
  const sourceTokens = [...text.matchAll(SENTINEL_PATTERN)].map((match) => match[0]);
  const expectedTokens = replacements.map(([name]) => sentinel(name));
  assert.equal(sourceTokens.length, new Set(sourceTokens).size);
  assert.deepEqual(new Set(sourceTokens), new Set(expectedTokens));

  let substituted = text;
  for (const [name, value] of replacements) {
    const token = sentinel(name);
    assert.equal(substituted.split(token).length - 1, 1, `expected one ${token}`);
    substituted = substituted.replace(token, () => value);
  }
  assert.equal(substituted.includes(SENTINEL_NAMESPACE), false);
  return substituted;
}

test('workflow constructors consume bundled templates as exact canonical bytes', async () => {
  const workspaceTemplate = await readFile(new URL('workspace-index.md', assets), 'utf8');
  const workspaceBytes = instantiateFixture(workspaceTemplate, [
    ['WORKSPACE_UPDATED_AT_JSON', JSON.stringify(now.toISOString())],
  ]);
  const workspaceFromTemplate = decodeDocument(workspaceBytes, 'assets/workspace-index.md');
  const constructedWorkspace = newWorkspaceDocument(now);
  assert.equal(encodeDocument(constructedWorkspace), workspaceBytes);
  assert.deepEqual(constructedWorkspace, workspaceFromTemplate);

  const workTemplate = await readFile(new URL('work-item-index.md', assets), 'utf8');
  const workBytes = instantiateFixture(workTemplate, [
    ['WORK_ID_JSON', JSON.stringify('template-work')],
    ['WORK_NAME_JSON', JSON.stringify('Template work')],
    ['WORK_SUMMARY_JSON', JSON.stringify('Exercises the bundled work template.')],
    ['WORK_KEYWORDS_JSON', JSON.stringify(['workflow', 'template', 'canonical'])],
    ['WORK_TYPE_JSON', JSON.stringify('delivery')],
    ['WORK_STAGE_JSON', JSON.stringify('align')],
    ['WORK_PARENT_JSON', JSON.stringify('../../../index.md')],
    ['WORK_UPDATED_AT_JSON', JSON.stringify(now.toISOString())],
    ['WORK_TITLE_TEXT', 'Template work'],
    ['WORK_GOAL_JSON', JSON.stringify('Validate the bundled work template.')],
    ['WORK_SUCCESS_CRITERIA_JSON', JSON.stringify(['The bundled work template decodes.'], null, 2)],
  ]);
  const workFromTemplate = decodeDocument(workBytes, 'assets/work-item-index.md');
  const constructed = newWorkDocument({
    id: 'template-work',
    name: 'Template work',
    summary: 'Exercises the bundled work template.',
    keywords: ['workflow', 'template', 'canonical'],
    type: 'delivery',
    goal: 'Validate the bundled work template.',
    successCriteria: ['The bundled work template decodes.'],
  }, '../../../index.md', now);

  assert.equal(encodeDocument(constructed), workBytes);
  assert.deepEqual(constructed, workFromTemplate);
});

test('workflow template replacements preserve special characters and variable arrays', async () => {
  const template = await readFile(new URL('work-item-index.md', assets), 'utf8');
  const input = {
    id: 'special-template-work',
    name: 'Quoted "work" \\ # [draft] *bold*\ncontinued',
    summary: 'Keep "quotes", \\slashes, `code`, # headings, and [links](./x).',
    keywords: ['one', 'two"', 'three\\', '#four', '[five]', '`six`', '*seven*', 'eight!'],
    type: 'exploration',
    stage: 'develop',
    goal: 'Prove "JSON" replacement \\ safety.\n\n# This remains goal text.',
    successCriteria: [
      'Quotes such as "this" survive.',
      'Backslashes such as C:\\temp\\file survive.',
      'Markdown such as **bold**, [link](./x), and `code` survives.',
    ],
  };
  const parent = '../../a folder/index.md';
  const expectedBytes = instantiateFixture(template, [
    ['WORK_ID_JSON', JSON.stringify(input.id)],
    ['WORK_NAME_JSON', JSON.stringify(input.name)],
    ['WORK_SUMMARY_JSON', JSON.stringify(input.summary)],
    ['WORK_KEYWORDS_JSON', JSON.stringify(input.keywords)],
    ['WORK_TYPE_JSON', JSON.stringify(input.type)],
    ['WORK_STAGE_JSON', JSON.stringify(input.stage)],
    ['WORK_PARENT_JSON', JSON.stringify(parent)],
    ['WORK_UPDATED_AT_JSON', JSON.stringify(now.toISOString())],
    ['WORK_TITLE_TEXT', input.name],
    ['WORK_GOAL_JSON', JSON.stringify(input.goal)],
    ['WORK_SUCCESS_CRITERIA_JSON', JSON.stringify(input.successCriteria, null, 2)],
  ]);
  const constructed = newWorkDocument(input, parent, now);
  const expectedDocument = decodeDocument(expectedBytes, 'assets/work-item-index.md');

  assert.equal(encodeDocument(constructed), expectedBytes);
  assert.deepEqual(constructed, expectedDocument);
});

test('workflow template replacements preserve JavaScript replacement sequences exactly', () => {
  const replacementSequences = "$& $` $' $$";
  const input = {
    id: 'literal-replacement-work',
    name: `Name ${replacementSequences}`,
    summary: `Summary ${replacementSequences}`,
    keywords: ['literal', 'replacement', 'round-trip'],
    type: 'delivery',
    goal: `Goal ${replacementSequences}`,
    successCriteria: [
      `Criterion ${replacementSequences}`,
      `Second criterion keeps ${replacementSequences} too`,
    ],
  };

  const constructed = newWorkDocument(input, '../../../index.md', now);
  const bytes = encodeDocument(constructed);
  const decoded = decodeDocument(bytes, 'literal-replacement-work.md');

  assert.equal(decoded.frontmatter.name, input.name);
  assert.equal(decoded.frontmatter.summary, input.summary);
  assert.equal(decoded.blocks.goal, input.goal);
  assert.deepEqual(decoded.blocks.success_criteria, input.successCriteria);
  assert.equal(encodeDocument(decoded), bytes);
});

test('workflow template rejects exact reserved sentinel collisions without rejecting near matches', () => {
  const baseInput = {
    id: 'sentinel-collision-work',
    name: 'Sentinel collision work',
    summary: 'Rejects reserved template sentinel collisions.',
    keywords: ['sentinel', 'collision', 'template'],
    type: 'delivery',
    goal: 'Reject reserved sentinel collisions.',
    successCriteria: ['Collision is reported before rendering.'],
  };
  const reserved = sentinel('WORK_GOAL_JSON');
  const collisionCases = [
    ['name', { name: `Name ${reserved}` }],
    ['summary', { summary: `Summary ${reserved}` }],
    ['goal', { goal: `Goal ${reserved}` }],
    ['success criteria', { successCriteria: [`Criterion ${reserved}`] }],
  ];

  for (const [field, override] of collisionCases) {
    assert.throws(
      () => newWorkDocument({ ...baseInput, ...override }, '../../../index.md', now),
      (error) => error.code === 'INVALID_TEMPLATE'
        && error.message === 'assets/work-item-index.md: replacement collides with reserved template sentinel namespace',
      field,
    );
  }

  const nearSentinel = '⟪ORCHESTRATE-WORK_GOAL_JSON:6D71B11E⟫';
  const nearInput = {
    ...baseInput,
    name: `Name ${nearSentinel}`,
    summary: `Summary ${nearSentinel}`,
    goal: `Goal ${nearSentinel}`,
    successCriteria: [`Criterion ${nearSentinel}`],
  };
  const nearDocument = newWorkDocument(nearInput, '../../../index.md', now);
  assert.equal(nearDocument.frontmatter.name, nearInput.name);
  assert.equal(nearDocument.frontmatter.summary, nearInput.summary);
  assert.equal(nearDocument.blocks.goal, nearInput.goal);
  assert.deepEqual(nearDocument.blocks.success_criteria, nearInput.successCriteria);
});

test('workflow document interface emits canonical root and work bytes', () => {
  const root = newWorkspaceDocument(now);
  const rootBytes = encodeDocument(root);
  assert.match(rootBytes, /^---\nid: "workspace"\n/);
  assert.ok(rootBytes.endsWith('\n'));
  assert.equal(encodeDocument(decodeDocument(rootBytes, 'root.md')), rootBytes);

  const work = newWorkDocument({
    id: 'canonical-work',
    name: 'Canonical work',
    summary: 'Preserves the canonical workflow document.',
    keywords: ['canonical', 'workflow', 'document'],
    type: 'delivery',
    goal: 'Preserve canonical bytes.',
    successCriteria: ['Round trips exactly.'],
  }, '../../../index.md', now);
  const workBytes = encodeDocument(work);
  assert.deepEqual(decodeDocument(workBytes, 'work.md'), work);
  assert.equal(encodeDocument(decodeDocument(workBytes, 'work.md')), workBytes);
});

test('workflow document interface keeps parse error code and message priority', () => {
  assert.throws(
    () => decodeDocument('# missing frontmatter\n', 'broken.md'),
    (error) => error.code === 'INVALID_FRONTMATTER'
      && error.message === 'broken.md: missing frontmatter',
  );

  const text = encodeDocument(newWorkspaceDocument(now))
    .replace('<!-- workflow:work_items:end -->', '<!-- workflow:unknown:end -->');
  assert.throws(
    () => decodeDocument(text, 'broken-root.md'),
    (error) => error.code === 'INVALID_BLOCKS'
      && error.message === 'broken-root.md: controlled block work_items must appear exactly once',
  );
});

test('workflow document interface rejects malformed documents with stable first failures', () => {
  const rootBytes = encodeDocument(newWorkspaceDocument(now));
  const workBytes = encodeDocument(newWorkDocument({
    id: 'malformed-work',
    name: 'Malformed work',
    summary: 'Exercises malformed document diagnostics.',
    keywords: ['malformed', 'document', 'diagnostics'],
    type: 'delivery',
    goal: 'Preserve diagnostic priority.',
    successCriteria: ['Diagnostics remain stable.'],
  }, '../../../index.md', now));
  const cases = [
    {
      name: 'unterminated frontmatter',
      text: rootBytes.replace('\n---\n\n#', '\n--\n\n#'),
      code: 'INVALID_FRONTMATTER',
      message: 'malformed.md: unterminated frontmatter',
    },
    {
      name: 'duplicate frontmatter field precedes exact-key validation',
      text: rootBytes.replace('id: "workspace"', 'id: "workspace"\nid: "workspace"'),
      code: 'INVALID_FRONTMATTER',
      message: 'malformed.md: duplicate frontmatter field id',
    },
    {
      name: 'invalid block JSON precedes document shape validation',
      text: rootBytes.replace('```json\n[]', '```json\n['),
      code: 'INVALID_BLOCKS',
      message: 'malformed.md: controlled block work_items contains invalid JSON',
    },
    {
      name: 'missing marker precedes unknown-marker validation',
      text: rootBytes.replace(
        '<!-- workflow:work_items:end -->',
        '<!-- workflow:unknown:end -->',
      ),
      code: 'INVALID_BLOCKS',
      message: 'malformed.md: controlled block work_items must appear exactly once',
    },
    {
      name: 'unexpected frontmatter field precedes keyword validation',
      text: workBytes
        .replace('id: "malformed-work"', 'unexpected: "field"\nid: "malformed-work"')
        .replace('keywords: ["malformed","document","diagnostics"]', 'keywords: "bad"'),
      code: 'INVALID_FRONTMATTER',
      message: 'malformed.md: frontmatter fields must exactly match the workflow schema',
    },
    {
      name: 'owner pairing precedes work block policy',
      text: workBytes
        .replace('owner: ""', 'owner: "main-a"')
        .replace('"status": "in_progress"', '"status": "unknown"'),
      code: 'INVALID_LEASE',
      message: 'malformed.md: owner and lease_until must both be set or empty',
    },
    {
      name: 'todo policy precedes assignment policy',
      text: workBytes
        .replace('"status": "in_progress"', '"status": "unknown"')
        .replace('"assignments": []', '"assignments": [{"role":"unknown","status":"unknown"}]'),
      code: 'INVALID_TODO',
      message: 'malformed.md: active work must have exactly one in-progress todo',
    },
  ];

  for (const fixture of cases) {
    assert.throws(
      () => decodeDocument(fixture.text, 'malformed.md'),
      (error) => error.code === fixture.code && error.message === fixture.message,
      fixture.name,
    );
  }
});
