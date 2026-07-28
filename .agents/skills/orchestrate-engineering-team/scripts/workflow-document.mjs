import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ASSIGNMENT_STATUSES,
  ensure,
  fail,
  FORBIDDEN_IDS,
  LEASE_MINUTES,
  MAX_LEASE_MINUTES,
  ROLES,
  STAGES,
  STATUSES,
  TODO_STATUSES,
  TYPES,
} from './workflow-contract.mjs';
import { normalizedMaterialPath, normalizeStrings, scalar } from './value-policy.mjs';

const WORK_BLOCKS = [
  'goal',
  'success_criteria',
  'confirmed_decisions',
  'current_progress',
  'todo',
  'assignments',
  'children',
  'materials',
  'verification',
  'result',
];
const ROOT_BLOCKS = ['work_items'];
const FRONTMATTER_FIELDS = [
  'id',
  'name',
  'summary',
  'keywords',
  'type',
  'status',
  'stage',
  'parent',
  'owner',
  'lease_until',
  'updated_at',
];
const TITLES = {
  goal: 'Goal',
  success_criteria: 'Success criteria',
  confirmed_decisions: 'Confirmed decisions',
  current_progress: 'Current progress',
  todo: 'Todo',
  assignments: 'Assignments',
  children: 'Children',
  materials: 'Materials',
  verification: 'Verification decision and evidence',
  result: 'Result',
  work_items: 'Work items',
};
const SENTINEL_NAMESPACE = '⟪ORCHESTRATE:';
const SENTINEL_SUFFIX = ':6D71B11E⟫';
const SENTINEL_PATTERN = /⟪ORCHESTRATE:[A-Z0-9_]+:6D71B11E⟫/g;
const WORKSPACE_TEMPLATE = readFileSync(
  new URL('../assets/workspace-index.md', import.meta.url),
  'utf8',
);
const WORK_TEMPLATE = readFileSync(
  new URL('../assets/work-item-index.md', import.meta.url),
  'utf8',
);

/**
 * Builds one reserved template sentinel from its semantic placeholder name.
 *
 * @param {string} name - Uppercase placeholder identifier used by a bundled template.
 * @returns {string} The complete collision-resistant sentinel token.
 */
function sentinel(name) {
  return `${SENTINEL_NAMESPACE}${name}${SENTINEL_SUFFIX}`;
}

/**
 * Instantiates a bundled canonical template while enforcing one-to-one sentinel replacement.
 *
 * @param {string} template - Raw template asset containing reserved sentinels.
 * @param {Array<[string, string]>} replacements - Sentinel and rendered-value pairs.
 * @param {string} file - Logical filename used in validation errors.
 * @returns {string} Fully rendered template with no reserved sentinels remaining.
 */
function instantiateTemplate(template, replacements, file) {
  // Assets are the wire-format source of truth, so every reserved sentinel is consumed exactly once.
  const sourceTokens = [...template.matchAll(SENTINEL_PATTERN)].map((match) => match[0]);
  const expectedTokens = replacements.map(([token]) => token);
  ensure(
    sourceTokens.length === new Set(sourceTokens).size,
    `${file}: template sentinels must appear exactly once`,
    'INVALID_TEMPLATE',
  );
  ensure(
    expectedTokens.length === new Set(expectedTokens).size
      && sourceTokens.length === expectedTokens.length
      && expectedTokens.every((token) => sourceTokens.includes(token)),
    `${file}: template sentinel set does not match replacements`,
    'INVALID_TEMPLATE',
  );

  let rendered = template;
  for (const [token, replacement] of replacements) {
    // JSON-safe replacements and the raw canonical title may not introduce the reserved namespace.
    ensure(
      typeof replacement === 'string' && !replacement.includes(SENTINEL_NAMESPACE),
      `${file}: replacement collides with reserved template sentinel namespace`,
      'INVALID_TEMPLATE',
    );
    const at = rendered.indexOf(token);
    ensure(
      at >= 0 && rendered.indexOf(token, at + token.length) < 0,
      `${file}: template sentinel ${token} must be used exactly once`,
      'INVALID_TEMPLATE',
    );
    rendered = rendered.replace(token, () => replacement);
  }
  ensure(
    !rendered.includes(SENTINEL_NAMESPACE),
    `${file}: unresolved template sentinel`,
    'INVALID_TEMPLATE',
  );
  return rendered;
}

/**
 * Converts a clock value to the canonical timestamp representation.
 *
 * @param {Date} [now=new Date()] - Clock value to serialize.
 * @returns {string} UTC ISO 8601 timestamp.
 */
export function nowIso(now = new Date()) {
  return now.toISOString();
}

/**
 * Calculates the canonical lease-expiry timestamp from a clock and duration.
 *
 * @param {Date} [now=new Date()] - Lease start clock.
 * @param {number} [minutes=LEASE_MINUTES] - Positive lease duration in minutes.
 * @returns {string} UTC ISO 8601 lease-expiry timestamp.
 */
export function leaseIso(now = new Date(), minutes = LEASE_MINUTES) {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * Serializes one frontmatter scalar using deterministic JSON string syntax.
 *
 * @param {unknown} value - Scalar value to serialize.
 * @returns {string} JSON-quoted scalar text suitable for one deterministic frontmatter line.
 */
function yamlQuote(value) {
  return JSON.stringify(scalar(value));
}

/**
 * Encodes the exact workflow frontmatter field set in canonical order.
 *
 * @param {object} fields - Valid root or Work Item frontmatter values.
 * @returns {string} Complete frontmatter block including delimiters.
 */
function encodeFrontmatter(fields) {
  const lines = ['---'];
  for (const key of FRONTMATTER_FIELDS) {
    const value = fields[key];
    if (key === 'keywords') lines.push(`${key}: ${JSON.stringify(value)}`);
    else lines.push(`${key}: ${yamlQuote(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Parses strict deterministic frontmatter and separates the Markdown body.
 *
 * @param {string} text - Complete workflow document text.
 * @param {string} file - Logical filename included in parse failures.
 * @returns {{fields: object, body: string}} Parsed frontmatter and untouched body text.
 */
function decodeFrontmatter(text, file) {
  ensure(text.startsWith('---\n'), `${file}: missing frontmatter`, 'INVALID_FRONTMATTER');
  const end = text.indexOf('\n---\n', 4);
  ensure(end >= 0, `${file}: unterminated frontmatter`, 'INVALID_FRONTMATTER');
  const fields = {};
  for (const line of text.slice(4, end).split('\n')) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    ensure(match, `${file}: invalid frontmatter line`, 'INVALID_FRONTMATTER');
    const [, key, encoded] = match;
    ensure(!(key in fields), `${file}: duplicate frontmatter field ${key}`, 'INVALID_FRONTMATTER');
    try {
      fields[key] = JSON.parse(encoded);
    } catch {
      fail(
        `${file}: frontmatter field ${key} must use deterministic JSON scalar syntax`,
        'INVALID_FRONTMATTER',
      );
    }
  }
  ensure(
    Object.keys(fields).length === FRONTMATTER_FIELDS.length
      && FRONTMATTER_FIELDS.every((key) => key in fields),
    `${file}: frontmatter fields must exactly match the workflow schema`,
    'INVALID_FRONTMATTER',
  );
  return { fields, body: text.slice(end + 5) };
}

/**
 * Produces a controlled-block marker for a block name and boundary side.
 *
 * @param {string} name - Controlled workflow block name.
 * @param {'start'|'end'} side - Marker boundary to emit.
 * @returns {string} Canonical HTML comment marker.
 */
function marker(name, side) {
  return `<!-- workflow:${name}:${side} -->`;
}

/**
 * Encodes one workflow block as fenced, pretty-printed JSON between controlled markers.
 *
 * @param {string} name - Controlled block name.
 * @param {unknown} value - JSON-serializable block value.
 * @returns {string} Canonical controlled block text.
 */
function encodeBlock(name, value) {
  return `${marker(name, 'start')}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n${marker(name, 'end')}`;
}

/**
 * Escapes arbitrary text for literal use inside a JavaScript regular expression.
 *
 * @param {string} text - Literal text to escape.
 * @returns {string} Regular-expression-safe literal representation.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses and validates the complete set of controlled JSON blocks from a document body.
 *
 * @param {string} body - Markdown body following frontmatter.
 * @param {string[]} expected - Exact controlled block names required for the document kind.
 * @param {string} file - Logical filename included in parse failures.
 * @returns {Record<string, unknown>} Parsed block values keyed by block name.
 */
function decodeBlocks(body, expected, file) {
  const blocks = {};
  const intervals = [];
  for (const name of expected) {
    const startMark = marker(name, 'start');
    const endMark = marker(name, 'end');
    const starts = [...body.matchAll(new RegExp(escapeRegExp(startMark), 'g'))];
    const ends = [...body.matchAll(new RegExp(escapeRegExp(endMark), 'g'))];
    ensure(
      starts.length === 1 && ends.length === 1,
      `${file}: controlled block ${name} must appear exactly once`,
      'INVALID_BLOCKS',
    );
    const start = starts[0].index;
    const contentStart = start + startMark.length;
    const end = ends[0].index;
    ensure(end > contentStart, `${file}: crossed controlled block ${name}`, 'INVALID_BLOCKS');
    const match = /^```json\n([\s\S]*)\n```$/.exec(body.slice(contentStart, end).trim());
    ensure(match, `${file}: controlled block ${name} must be fenced JSON`, 'INVALID_BLOCKS');
    try {
      blocks[name] = JSON.parse(match[1]);
    } catch {
      fail(`${file}: controlled block ${name} contains invalid JSON`, 'INVALID_BLOCKS');
    }
    intervals.push([start, end + endMark.length]);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < intervals.length; index += 1) {
    // Controlled sections may be reordered by a user, but their marker intervals may never overlap.
    ensure(intervals[index - 1][1] <= intervals[index][0], `${file}: controlled blocks overlap`, 'INVALID_BLOCKS');
  }
  const allMarkers = [...body.matchAll(/<!-- workflow:([a-z_]+):(start|end) -->/g)]
    .map((match) => match[1]);
  ensure(
    allMarkers.length === expected.length * 2 && allMarkers.every((name) => expected.includes(name)),
    `${file}: unknown or duplicate workflow marker`,
    'INVALID_BLOCKS',
  );
  return blocks;
}

/**
 * Encodes a validated root or Work Item model as canonical Markdown bytes.
 *
 * @param {object} document - Workflow document model with frontmatter and controlled blocks.
 * @returns {string} Canonical Markdown representation ending with a newline.
 */
export function encodeDocument(document) {
  const names = document.kind === 'root' ? ROOT_BLOCKS : WORK_BLOCKS;
  const sections = names.map((name) => `## ${TITLES[name]}\n\n${encodeBlock(name, document.blocks[name])}`);
  return `${encodeFrontmatter(document.frontmatter)}\n\n# ${document.frontmatter.name}\n\n${sections.join('\n\n')}\n`;
}

/**
 * Decodes and fully validates canonical workflow Markdown.
 *
 * @param {string} text - Complete workflow document content.
 * @param {string} [file='index.md'] - Logical path reported in validation errors.
 * @returns {object} Validated root or Work Item document model.
 */
export function decodeDocument(text, file = 'index.md') {
  const { fields, body } = decodeFrontmatter(text, file);
  const kind = fields.type === 'workspace' ? 'root' : 'work';
  const blocks = decodeBlocks(body, kind === 'root' ? ROOT_BLOCKS : WORK_BLOCKS, file);
  const document = { kind, frontmatter: fields, blocks };
  validateDocument(document, { file, root: kind === 'root' });
  return document;
}

/**
 * Validates a semantic Work Item identifier and rejects phase-, batch-, and role-based names.
 *
 * @param {unknown} id - Candidate kebab-case Work Item identifier.
 * @returns {void} Returns when the identifier is semantic and valid.
 */
export function validateId(id) {
  ensure(
    typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id),
    `invalid semantic work id: ${id}`,
    'INVALID_ID',
  );
  ensure(
    !FORBIDDEN_IDS.has(id) && !/^phase(?:-|$)/.test(id) && !/^batch(?:-|$)/.test(id),
    `forbidden non-semantic work id: ${id}`,
    'INVALID_ID',
  );
}

/**
 * Validates one non-empty ISO 8601 timestamp with an explicit timezone.
 *
 * @param {unknown} value - Candidate timestamp value.
 * @param {string} field - Field label included in validation errors.
 * @returns {void} Returns when the timestamp is valid.
 */
function validateTimestamp(value, field) {
  ensure(
    typeof value === 'string'
      && value.length > 0
      && !Number.isNaN(Date.parse(value))
      && /(?:Z|[+-]\d\d:\d\d)$/.test(value),
    `${field} must be an ISO 8601 timestamp with timezone`,
    'INVALID_FRONTMATTER',
  );
}

/**
 * Validates an ID-addressable collection and rejects duplicate or malformed identities.
 *
 * @param {unknown} items - Candidate array of persisted records.
 * @param {{file: string, collection: string, code: string, validId?: (id: unknown) => boolean}} options - Error context and identity policy.
 * @returns {void} Returns when every record has a unique valid ID.
 */
function validateIdentityCollection(
  items,
  { file, collection, code, validId = (id) => typeof id === 'string' && id.length > 0 },
) {
  const ids = new Set();
  // Persisted identity collections must stay unambiguous because recovery resolves entries by ID.
  for (const [index, item] of items.entries()) {
    ensure(
      item && typeof item === 'object' && !Array.isArray(item) && validId(item.id),
      `${file}: ${collection}[${index}].id is invalid`,
      code,
    );
    ensure(
      !ids.has(item.id),
      `${file}: ${collection} must contain unique IDs: ${item.id}`,
      code,
    );
    ids.add(item.id);
  }
  return ids;
}

/**
 * Validates a finite integer lease duration within the configured operational bounds.
 *
 * @param {unknown} value - Candidate duration in minutes.
 * @returns {number} The validated lease duration.
 */
export function validateLeaseMinutes(value) {
  const minutes = Number(value ?? LEASE_MINUTES);
  ensure(
    Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_LEASE_MINUTES,
    `leaseMinutes must be an integer from 1 to ${MAX_LEASE_MINUTES}`,
    'INVALID_LEASE',
  );
  return minutes;
}

/**
 * Recovers the persisted lease duration from a claimed Work Item.
 *
 * @param {object} document - Work Item whose update and expiry timestamps define the duration.
 * @returns {number} Validated whole-minute lease duration used for renewal.
 */
export function persistedLeaseMinutes(document) {
  const minutes = (
    Date.parse(document.frontmatter.lease_until) - Date.parse(document.frontmatter.updated_at)
  ) / 60_000;
  return validateLeaseMinutes(minutes);
}

/**
 * Enforces the complete schema and cross-field invariants for a workflow document model.
 *
 * @param {object} document - Parsed root or Work Item document.
 * @param {{file?: string, root?: boolean}} [options] - Logical filename and expected document kind.
 * @returns {object} The validated document, preserving its original identity.
 */
export function validateDocument(document, { file = 'index.md', root = false } = {}) {
  const frontmatter = document.frontmatter;
  ensure(
    Array.isArray(frontmatter.keywords) && frontmatter.keywords.every((item) => typeof item === 'string'),
    `${file}: keywords must be strings`,
    'INVALID_FRONTMATTER',
  );
  validateTimestamp(frontmatter.updated_at, 'updated_at');
  if (root) {
    ensure(
      document.kind === 'root' && frontmatter.type === 'workspace',
      `${file}: invalid workspace index`,
      'INVALID_FRONTMATTER',
    );
    ensure(
      Array.isArray(document.blocks.work_items),
      `${file}: work_items must be an array`,
      'INVALID_BLOCKS',
    );
    const workItemIds = new Set();
    const workItemPaths = new Set();
    for (const [index, entry] of document.blocks.work_items.entries()) {
      ensure(
        entry && typeof entry === 'object' && !Array.isArray(entry),
        `${file}: work_items[${index}] must be an object`,
        'INVALID_BLOCKS',
      );
      for (const field of ['id', 'path', 'name', 'summary', 'status']) {
        ensure(
          typeof entry[field] === 'string',
          `${file}: work_items[${index}].${field} must be a string`,
          'INVALID_BLOCKS',
        );
      }
      ensure(
        !workItemIds.has(entry.id),
        `${file}: work_items must contain unique IDs: ${entry.id}`,
        'INVALID_BLOCKS',
      );
      ensure(
        !workItemPaths.has(entry.path),
        `${file}: work_items must contain unique paths: ${entry.path}`,
        'INVALID_BLOCKS',
      );
      workItemIds.add(entry.id);
      workItemPaths.add(entry.path);
    }
    return;
  }
  ensure(document.kind === 'work', `${file}: expected work item`, 'INVALID_FRONTMATTER');
  validateId(frontmatter.id);
  ensure(typeof frontmatter.name === 'string' && frontmatter.name.trim(), `${file}: name is required`, 'INVALID_FRONTMATTER');
  ensure(typeof frontmatter.summary === 'string' && frontmatter.summary.trim(), `${file}: summary is required`, 'INVALID_FRONTMATTER');
  ensure(frontmatter.keywords.length >= 3 && frontmatter.keywords.length <= 8, `${file}: keywords must contain 3-8 terms`, 'INVALID_FRONTMATTER');
  ensure(TYPES.has(frontmatter.type), `${file}: invalid type`, 'INVALID_FRONTMATTER');
  ensure(STATUSES.has(frontmatter.status), `${file}: invalid status`, 'INVALID_FRONTMATTER');
  ensure(STAGES.has(frontmatter.stage), `${file}: invalid stage`, 'INVALID_FRONTMATTER');
  ensure(
    typeof frontmatter.parent === 'string'
      && frontmatter.parent.length > 0
      && !path.isAbsolute(frontmatter.parent),
    `${file}: parent must be relative`,
    'INVALID_FRONTMATTER',
  );
  const hasOwner = typeof frontmatter.owner === 'string' && frontmatter.owner.length > 0;
  const hasLease = typeof frontmatter.lease_until === 'string' && frontmatter.lease_until.length > 0;
  ensure(hasOwner === hasLease, `${file}: owner and lease_until must both be set or empty`, 'INVALID_LEASE');
  if (hasLease) {
    validateTimestamp(frontmatter.lease_until, 'lease_until');
    persistedLeaseMinutes(document);
  }
  for (const name of ['success_criteria', 'confirmed_decisions', 'todo', 'assignments', 'children', 'materials']) {
    ensure(Array.isArray(document.blocks[name]), `${file}: ${name} must be an array`, 'INVALID_BLOCKS');
  }
  /**
   * Tests whether a persisted Assignment or Todo ID follows the local identity grammar.
   *
   * @param {unknown} id - Candidate identity.
   * @returns {boolean} Whether the value is a valid lowercase hyphenated identity.
   */
  const assignmentId = (id) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);
  validateIdentityCollection(document.blocks.confirmed_decisions, {
    file,
    collection: 'confirmed_decisions',
    code: 'INVALID_DECISION',
  });
  validateIdentityCollection(document.blocks.todo, {
    file,
    collection: 'todo',
    code: 'INVALID_TODO',
    validId: assignmentId,
  });
  validateIdentityCollection(document.blocks.children, {
    file,
    collection: 'children',
    code: 'INVALID_CHILD',
  });
  validateIdentityCollection(document.blocks.materials, {
    file,
    collection: 'materials',
    code: 'INVALID_MATERIAL',
  });
  for (const material of document.blocks.materials) {
    const canonicalPath = normalizedMaterialPath(material.role, material.path);
    ensure(
      material.id === canonicalPath,
      `${file}: material id must equal normalized path: ${canonicalPath}`,
      'INVALID_MATERIAL',
    );
  }
  const activeTodos = document.blocks.todo.filter((item) => item.status === 'in_progress');
  ensure(activeTodos.length <= 1, `${file}: at most one todo may be in progress`, 'INVALID_TODO');
  if (frontmatter.status === 'active') {
    ensure(activeTodos.length === 1, `${file}: active work must have exactly one in-progress todo`, 'INVALID_TODO');
  }
  ensure(document.blocks.todo.every((item) => TODO_STATUSES.has(item.status)), `${file}: invalid todo status`, 'INVALID_TODO');
  ensure(
    document.blocks.assignments.every((item) => ROLES.has(item.role) && ASSIGNMENT_STATUSES.has(item.status)),
    `${file}: invalid assignment role or status`,
    'INVALID_ASSIGNMENT',
  );
  ensure(
    document.blocks.assignments.every((item) => item.capabilities
      && Array.isArray(item.capabilities.required)
      && Array.isArray(item.capabilities.available)
      && Array.isArray(item.capabilities.unavailable)),
    `${file}: assignment capabilities must include required, available, and unavailable arrays`,
    'INVALID_ASSIGNMENT',
  );
  const assignmentIds = validateIdentityCollection(document.blocks.assignments, {
    file,
    collection: 'assignments',
    code: 'INVALID_ASSIGNMENT',
    validId: assignmentId,
  });
  for (const assignment of document.blocks.assignments) {
    ensure(
      Array.isArray(assignment.dependsOn),
      `${file}: assignment ${assignment.id} dependsOn must be an array`,
      'INVALID_ASSIGNMENT',
    );
    ensure(
      assignment.dependsOn.every((dependency) => (
        typeof dependency === 'string' && /^[a-z][a-z0-9-]*$/.test(dependency)
      )),
      `${file}: assignment ${assignment.id} dependsOn must contain valid assignment IDs`,
      'INVALID_ASSIGNMENT',
    );
    ensure(
      assignment.dependsOn.length === new Set(assignment.dependsOn).size,
      `${file}: assignment ${assignment.id} dependsOn must contain unique IDs`,
      'INVALID_ASSIGNMENT',
    );
    ensure(
      !assignment.dependsOn.includes(assignment.id),
      `${file}: assignment ${assignment.id} cannot depend on itself`,
      'INVALID_ASSIGNMENT',
    );
    for (const dependency of assignment.dependsOn) {
      ensure(
        assignmentIds.has(dependency),
        `${file}: assignment ${assignment.id} dependency does not exist: ${dependency}`,
        'INVALID_ASSIGNMENT',
      );
      if (['in_progress', 'completed'].includes(assignment.status)) {
        const prerequisite = document.blocks.assignments
          .find((candidate) => candidate.id === dependency);
        ensure(
          prerequisite.status === 'completed',
          `${file}: assignment ${assignment.id} dependency is unfinished: ${dependency}`,
          'INVALID_ASSIGNMENT',
        );
      }
    }
  }
  const assignmentsById = new Map(
    document.blocks.assignments.map((assignment) => [assignment.id, assignment]),
  );
  const visitState = new Map();
  const visitStack = [];
  /**
   * Performs depth-first validation of the Assignment dependency graph.
   *
   * @param {object} assignment - Assignment whose prerequisites should be traversed.
   * @returns {void} Marks the Assignment visited or raises a cycle error.
   */
  function visitAssignment(assignment) {
    if (visitState.get(assignment.id) === 'visited') return;
    if (visitState.get(assignment.id) === 'visiting') {
      const cycleStart = visitStack.indexOf(assignment.id);
      const cycle = [...visitStack.slice(cycleStart), assignment.id];
      fail(
        `${file}: assignment dependency cycle: ${cycle.join(' -> ')}`,
        'INVALID_ASSIGNMENT',
      );
    }
    visitState.set(assignment.id, 'visiting');
    visitStack.push(assignment.id);
    // Persisted dependencies form a DAG; a back-edge into the active DFS stack violates recovery order.
    for (const dependency of assignment.dependsOn) {
      visitAssignment(assignmentsById.get(dependency));
    }
    visitStack.pop();
    visitState.set(assignment.id, 'visited');
  }
  for (const assignment of document.blocks.assignments) visitAssignment(assignment);
  ensure(
    document.blocks.result
      && typeof document.blocks.result === 'object'
      && Array.isArray(document.blocks.result.success_evidence),
    `${file}: result.success_evidence must be an array`,
    'INVALID_BLOCKS',
  );
}

/**
 * Creates a canonical workspace-root document from the bundled template.
 *
 * @param {Date} [now=new Date()] - Clock used for the initial update timestamp.
 * @returns {object} Parsed and validated empty workspace document.
 */
export function newWorkspaceDocument(now = new Date()) {
  const rendered = instantiateTemplate(WORKSPACE_TEMPLATE, [
    [sentinel('WORKSPACE_UPDATED_AT_JSON'), JSON.stringify(nowIso(now))],
  ], 'assets/workspace-index.md');
  return decodeDocument(rendered, 'assets/workspace-index.md');
}

/**
 * Creates a canonical Work Item document from user input and a parent reference.
 *
 * @param {object} input - Work Item identity, metadata, goal, and success criteria.
 * @param {string} parentRelative - Relative path from the new Work Item to its parent index.
 * @param {Date} [now=new Date()] - Clock used for initial timestamps.
 * @returns {object} Parsed and validated active Work Item document.
 */
export function newWorkDocument(input, parentRelative, now = new Date()) {
  validateId(input.id);
  const keywords = normalizeStrings(input.keywords, 'keywords', { min: 3, max: 8 });
  const criteria = normalizeStrings(
    input.successCriteria ?? input.success_criteria,
    'successCriteria',
    { min: 1, max: 30 },
  );
  ensure(TYPES.has(input.type), 'type must be delivery or exploration', 'INVALID_INPUT');
  ensure(typeof input.name === 'string' && input.name.trim(), 'name is required', 'INVALID_INPUT');
  ensure(typeof input.summary === 'string' && input.summary.trim(), 'summary is required', 'INVALID_INPUT');
  ensure(typeof input.goal === 'string' && input.goal.trim(), 'goal is required', 'INVALID_INPUT');
  const name = input.name.trim();
  const rendered = instantiateTemplate(WORK_TEMPLATE, [
    [sentinel('WORK_ID_JSON'), JSON.stringify(input.id)],
    [sentinel('WORK_NAME_JSON'), JSON.stringify(name)],
    [sentinel('WORK_SUMMARY_JSON'), JSON.stringify(input.summary.trim())],
    [sentinel('WORK_KEYWORDS_JSON'), JSON.stringify(keywords)],
    [sentinel('WORK_TYPE_JSON'), JSON.stringify(input.type)],
    [sentinel('WORK_STAGE_JSON'), JSON.stringify(input.stage ?? 'align')],
    [sentinel('WORK_PARENT_JSON'), JSON.stringify(parentRelative)],
    [sentinel('WORK_UPDATED_AT_JSON'), JSON.stringify(nowIso(now))],
    [sentinel('WORK_TITLE_TEXT'), name],
    [sentinel('WORK_GOAL_JSON'), JSON.stringify(input.goal.trim())],
    [sentinel('WORK_SUCCESS_CRITERIA_JSON'), JSON.stringify(criteria, null, 2)],
  ], 'assets/work-item-index.md');
  return decodeDocument(rendered, 'assets/work-item-index.md');
}
