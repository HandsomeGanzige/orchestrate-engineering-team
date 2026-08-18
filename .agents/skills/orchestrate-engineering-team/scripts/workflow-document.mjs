import {
  ASSIGNMENT_STATUSES,
  FORBIDDEN_IDS,
  LEASE_MINUTES,
  MAX_LEASE_MINUTES,
  ROLES,
  STAGES,
  STATUSES,
  TODO_STATUSES,
  TYPES,
  ensure,
} from './workflow-contract.mjs';
import { computeVotes } from './verification.mjs';

/**
 * Returns an ISO timestamp for the supplied clock.
 * @param {Date} now - Clock to serialize.
 * @returns {string} ISO timestamp.
 */
export function nowIso(now = new Date()) {
  return now.toISOString();
}

/**
 * Returns the expiry timestamp for a bounded lease.
 * @param {Date} now - Lease start clock.
 * @param {number} minutes - Lease duration.
 * @returns {string} Lease expiry timestamp.
 */
export function leaseIso(now = new Date(), minutes = LEASE_MINUTES) {
  return new Date(now.getTime() + Number(minutes) * 60_000).toISOString();
}

/**
 * Validates a semantic kebab-case identifier.
 * @param {unknown} id - Candidate identifier.
 * @returns {string} Valid identifier.
 */
export function validateId(id) {
  ensure(typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id), 'id must be semantic kebab-case beginning with a letter', 'INVALID_INPUT');
  ensure(
    !FORBIDDEN_IDS.has(id) && !id.startsWith('phase-') && !id.startsWith('batch-'),
    `id is reserved for workflow semantics: ${id}`,
    'INVALID_INPUT',
  );
  return id;
}

/**
 * Validates a lease duration.
 * @param {unknown} value - Candidate duration.
 * @returns {number} Valid minutes.
 */
export function validateLeaseMinutes(value) {
  const minutes = Number(value);
  ensure(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_LEASE_MINUTES, `leaseMinutes must be 1-${MAX_LEASE_MINUTES}`, 'INVALID_INPUT');
  return minutes;
}

/**
 * Reads the renewal duration from operational state.
 * @param {object} document - Work Item model.
 * @returns {number} Valid minutes.
 */
export function persistedLeaseMinutes(document) {
  return validateLeaseMinutes(document.state.lease_minutes);
}

/**
 * Normalizes non-empty strings.
 * @param {unknown} value - Candidate array.
 * @param {string} name - Field label.
 * @returns {string[]} Normalized strings.
 */
function strings(value, name) {
  ensure(Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim()), `${name} must be non-empty strings`, 'INVALID_INPUT');
  return value.map((entry) => entry.trim());
}

/**
 * Renders a Markdown bullet list.
 * @param {string[]} items - List values.
 * @param {string} empty - Empty fallback.
 * @returns {string} Markdown text.
 */
function bullets(items, empty = 'None.') {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}

/**
 * Creates readable Markdown for a Work Item.
 * @param {object} input - Creation payload.
 * @returns {string} Work Item Markdown.
 */
export function newWorkMarkdown(input) {
  ensure(typeof input.name === 'string' && input.name.trim(), 'name is required', 'INVALID_INPUT');
  ensure(typeof input.goal === 'string' && input.goal.trim(), 'goal is required', 'INVALID_INPUT');
  const criteria = strings(input.successCriteria ?? [], 'successCriteria');
  ensure(criteria.length > 0, 'successCriteria is required', 'INVALID_INPUT');
  const scope = strings(input.scope ?? [], 'scope');
  const references = strings(input.references ?? [], 'references');
  return `# ${input.name.trim()}\n\nStatus: active\n\n## Outcome\n\n${input.goal.trim()}\n\n## Scope\n\n${bullets(scope, input.summary?.trim() || 'Defined by the outcome and acceptance criteria.')}\n\n## Acceptance\n\n${criteria.map((item) => `- [ ] ${item}`).join('\n')}\n\n## Decisions\n\nNone.\n\n## Work\n\n- [ ] Confirm the outcome, scope, and acceptance.\n\n## Completed\n\nNone.\n\n## Current focus\n\nConfirm the outcome, scope, and acceptance.\n\n## Child deliveries\n\nNone.\n\n## Open issues\n\nNone.\n\n## References\n\n${bullets(references)}\n`;
}

/**
 * Creates disposable operational state.
 * @param {object} input - Creation payload.
 * @param {string|null} parent - Parent link.
 * @param {Date} now - Creation clock.
 * @returns {object} Operational state.
 */
export function newWorkState(input, parent = null, now = new Date()) {
  validateId(input.id);
  const type = input.type ?? 'delivery';
  ensure(TYPES.has(type), 'invalid work type', 'INVALID_INPUT');
  const timestamp = nowIso(now);
  return {
    version: 1,
    id: input.id,
    type,
    status: 'active',
    stage: input.stage ?? 'align',
    parent,
    owner: '',
    lease_until: '',
    lease_minutes: LEASE_MINUTES,
    created_at: timestamp,
    updated_at: timestamp,
    todos: [{ id: 'align-goal', text: 'Confirm the outcome, scope, and acceptance.', status: 'in_progress', assignment: '', blockers: [] }],
    assignments: [],
    children: [],
    verification: {
      votes: { architecture: null, development: [], main: null },
      decisions: { test: null, review: null },
    },
    result: { status: 'pending', blockers: [] },
  };
}

/**
 * Creates a paired in-memory document.
 * @param {object} input - Creation payload.
 * @param {string|null} parent - Parent link.
 * @param {Date} now - Creation clock.
 * @returns {object} Paired document.
 */
export function newWorkDocument(input, parent = null, now = new Date()) {
  return decorateWork({ kind: 'work', markdown: newWorkMarkdown(input), state: newWorkState(input, parent, now) });
}

/**
 * Normalizes the rendered text forms supported in semantic ATX headings.
 * @param {string} value - Raw ATX heading content.
 * @returns {string} Case-folded structural key.
 */
function semanticHeadingText(value) {
  return value
    .trim()
    .replace(/[ \t]+/g, ' ');
}

/**
 * Produces a case-insensitive semantic heading key.
 * @param {string} value - Raw or rendered heading text.
 * @returns {string} Normalized comparison key.
 */
function semanticHeadingKey(value) {
  return semanticHeadingText(value).toLowerCase();
}

/**
 * Scans block-aware CommonMark ATX headings while ignoring fenced and indented code.
 * Setext headings are deliberately not semantic workflow boundaries.
 * @param {string} markdown - Work Markdown.
 * @returns {{end: number, key: string, level: number, start: number, text: string}[]} Structural headings.
 */
function scanMarkdownStructure(markdown) {
  const headings = [];
  const statuses = [];
  let offset = 0;
  let fence = null;
  for (const lineWithEnding of markdown.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!lineWithEnding) continue;
    const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1).replace(/\r$/, '') : lineWithEnding.replace(/\r$/, '');
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null;
      offset += lineWithEnding.length;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      fence = { character: opening[1][0], length: opening[1].length };
      offset += lineWithEnding.length;
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      offset += lineWithEnding.length;
      continue;
    }
    const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (match) {
      const content = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '');
      const text = semanticHeadingText(content);
      if (text) headings.push({ start: offset, end: offset + lineWithEnding.length, level: match[1].length, text, key: text.toLowerCase() });
    }
    const status = /^ {0,3}Status:[ \t]*(\S+)[ \t]*$/i.exec(line);
    if (status) statuses.push({ start: offset, end: offset + line.length, value: status[1].toLowerCase() });
    offset += lineWithEnding.length;
  }
  return { headings, statuses };
}

/**
 * Scans supported semantic headings.
 * @param {string} markdown - Work Markdown.
 * @returns {{end: number, key: string, level: number, start: number, text: string}[]} Structural headings.
 */
function scanMarkdownHeadings(markdown) {
  return scanMarkdownStructure(markdown).headings;
}

/**
 * Extracts one supported semantic Markdown section.
 * @param {string} markdown - Document text.
 * @param {string} heading - Section heading.
 * @returns {string} Section body.
 */
export function sectionBody(markdown, heading) {
  const headings = scanMarkdownHeadings(markdown);
  const target = headings.find(({ key, level }) => level === 2 && key === semanticHeadingKey(heading));
  if (!target) return '';
  const next = headings.find(({ level, start }) => start >= target.end && level <= target.level);
  return markdown.slice(target.end, next?.start ?? markdown.length).trim();
}

/**
 * Extracts checklist labels.
 * @param {string} markdown - Document text.
 * @param {string} heading - Section heading.
 * @returns {string[]} Checklist labels.
 */
function checklist(markdown, heading) {
  return sectionBody(markdown, heading).split('\n').map((line) => {
    const match = /^- \[[ x]\] (.+?)(?: \u2014 Evidence: .+)?$/.exec(line);
    return match?.[1];
  }).filter(Boolean);
}

/**
 * Parses curated decisions.
 * @param {string} markdown - Document text.
 * @returns {object[]} Decision records.
 */
function decisions(markdown) {
  const lines = sectionBody(markdown, 'Decisions').split('\n');
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^- \*\*([^:*]+):\*\* (.+)$/.exec(lines[index]);
    if (!match) continue;
    const evidenceLine = /^  - Evidence: (.+)$/.exec(lines[index + 1] ?? '');
    const evidence = [...(evidenceLine?.[1] ?? '').matchAll(/\[[^\]]*(?:\\\][^\]]*)*\]\(([^)]+)\)/g)]
      .map((entry) => {
        try { return decodeURI(entry[1]); } catch { return null; }
      })
      .filter(Boolean);
    records.push({ id: match[1].trim(), summary: match[2].trim(), evidence });
    if (evidenceLine) index += 1;
  }
  return records;
}

/**
 * Parses completed-delivery summaries.
 * @param {string} markdown - Document text.
 * @returns {string[]} Summary bullets.
 */
function resultSummary(markdown) {
  const body = sectionBody(markdown, 'Completed');
  if (!body || body === 'None.') return [];
  return body.split('\n').map((line) => /^- (?!Artifact:)(.+)$/.exec(line)?.[1]).filter(Boolean);
}

/**
 * Parses completed-delivery artifact references.
 * @param {string} markdown - Document text.
 * @returns {object[]} Artifact records.
 */
function resultArtifacts(markdown) {
  return sectionBody(markdown, 'Completed').split('\n').map((line) => {
    const match = /^- Artifact: `([^`]+)` \u2014 (.+)$/.exec(line);
    return match ? { path: match[1], purpose: match[2] } : null;
  }).filter(Boolean);
}

/**
 * Parses inline acceptance evidence.
 * @param {string} markdown - Document text.
 * @returns {object[]} Evidence records.
 */
function successEvidence(markdown) {
  return sectionBody(markdown, 'Acceptance').split('\n').map((line) => {
    const match = /^- \[x\] (.+?) \u2014 Evidence: (.+?)(?: \u2014 Pointers: (.+))?$/.exec(line);
    const pointers = match?.[3]?.match(/`([^`]+)`/g)?.map((value) => value.slice(1, -1)) ?? [];
    return match ? { criterion: match[1], evidence: match[2], pointers } : null;
  }).filter(Boolean);
}

/**
 * Builds the in-memory mutation model.
 * @param {object} document - Markdown and state pair.
 * @returns {object} Decorated model.
 */
export function decorateWork(document) {
  const { state, markdown } = document;
  document.frontmatter = {
    id: state.id, name: markdownTitle(markdown), summary: (sectionBody(markdown, 'Scope').split('\n')[0] ?? '').replace(/^-\s+/, ''),
    keywords: [], type: state.type, status: state.status, stage: state.stage, parent: state.parent ?? '',
    owner: state.owner, lease_until: state.lease_until, updated_at: state.updated_at,
  };
  document.blocks = {
    goal: sectionBody(markdown, 'Outcome'), success_criteria: checklist(markdown, 'Acceptance'),
    confirmed_decisions: decisions(markdown), current_progress: sectionBody(markdown, 'Current focus'),
    todo: state.todos, assignments: state.assignments, children: state.children,
    verification: state.verification,
    result: {
      status: state.result?.status ?? 'pending', summary: resultSummary(markdown), artifacts: resultArtifacts(markdown),
      blockers: state.result?.blockers ?? [], next_action: sectionBody(markdown, 'Current focus'),
      success_evidence: successEvidence(markdown),
    },
  };
  return document;
}

/**
 * Replaces one Markdown section.
 * @param {string} markdown - Document text.
 * @param {string} heading - Section heading.
 * @param {string} value - Replacement body.
 * @returns {string} Updated Markdown.
 */
export function replaceSection(markdown, heading, value) {
  const body = `## ${heading}\n\n${value.trim() || 'None.'}\n\n`;
  const headings = scanMarkdownHeadings(markdown);
  const target = headings.find(({ key, level }) => level === 2 && key === semanticHeadingKey(heading));
  if (!target) return `${markdown.trimEnd()}\n\n${body}`;
  const next = headings.find(({ level, start }) => start >= target.end && level <= target.level);
  return `${markdown.slice(0, target.start)}${body}${markdown.slice(next?.start ?? markdown.length)}`;
}

/**
 * Synchronizes the decorated operational model into disposable state without editing Markdown.
 * @param {object} document - Decorated model.
 * @returns {object} Synchronized model.
 */
export function syncWork(document) {
  const { frontmatter, blocks, state } = document;
  for (const key of ['status', 'stage', 'parent', 'owner', 'lease_until', 'updated_at']) state[key] = frontmatter[key];
  state.todos = blocks.todo; state.assignments = blocks.assignments; state.children = blocks.children;
  state.verification = blocks.verification;
  state.result = { status: blocks.result.status, blockers: blocks.result.blockers };
  return document;
}

/**
 * Replaces or appends the one semantic Child deliveries entry owned by a child operation.
 * @param {object} document - Parent Work Item document.
 * @param {object} child - Operational child projection.
 * @param {string} line - Curated Markdown line for this child.
 * @returns {void} Mutates only the selected section entry.
 */
export function upsertChildDelivery(document, child, line) {
  const body = sectionBody(document.markdown, 'Child deliveries');
  const lines = body && body !== 'None.' ? body.split('\n') : [];
  const localPath = `children/${child.id}/work.md`;
  const index = lines.findIndex((entry) => entry.includes(`](${child.path})`) || entry.includes(`](${localPath})`));
  if (index === -1) lines.push(line);
  else lines[index] = line;
  document.markdown = replaceSection(document.markdown, 'Child deliveries', lines.join('\n'));
}

/**
 * Appends one line to an explicitly selected semantic section without rewriting its prose.
 * @param {object} document - Work Item document.
 * @param {string} heading - Selected section heading.
 * @param {string} line - Semantic line to append.
 * @returns {void} Mutates the selected section only.
 */
export function appendSectionLine(document, heading, line) {
  const body = sectionBody(document.markdown, heading);
  const current = !body || body === 'None.' ? [] : body.split('\n');
  document.markdown = replaceSection(document.markdown, heading, [...current, line].join('\n'));
}

/**
 * Replaces one acceptance checklist line identified by its exact criterion.
 * @param {object} document - Work Item document.
 * @param {string} criterion - Exact acceptance criterion.
 * @param {string} line - Replacement Markdown line.
 * @returns {void} Mutates only that checklist entry.
 */
export function replaceAcceptanceEntry(document, criterion, line) {
  const body = sectionBody(document.markdown, 'Acceptance');
  const lines = body.split('\n');
  const index = lines.findIndex((entry) => new RegExp(`^- \\[.\\] ${criterion.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?: \\u2014 Evidence: .+)?$`).test(entry));
  ensure(index !== -1, 'criterion must exactly match a success criterion', 'INVALID_SUCCESS_EVIDENCE');
  lines[index] = line;
  document.markdown = replaceSection(document.markdown, 'Acceptance', lines.join('\n'));
}

/**
 * Validates operational state.
 * @param {object} state - Candidate state.
 * @param {object} options - Diagnostic options.
 * @returns {object} Valid state.
 */
export function validateState(state, { file = 'state.json' } = {}) {
  ensure(state && typeof state === 'object' && !Array.isArray(state), `invalid state: ${file}`, 'INVALID_DOCUMENT');
  /**
   * Validates an exact object field set.
   * @param {object} value - Candidate object.
   * @param {string[]} required - Required fields.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const exactKeys = (value, required, label) => ensure(
    value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === required.length
      && required.every((key) => Object.hasOwn(value, key)),
    `${label} must contain exactly: ${required.join(', ')}`,
    'INVALID_DOCUMENT',
  );
  /**
   * Validates a string array.
   * @param {unknown} value - Candidate array.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const nonEmptyStrings = (value, label) => ensure(
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim()),
    `${label} must be an array of non-empty strings`,
    'INVALID_DOCUMENT',
  );
  /**
   * Validates a unique string array.
   * @param {unknown} value - Candidate array.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const uniqueStrings = (value, label) => {
    nonEmptyStrings(value, label);
    ensure(new Set(value).size === value.length, `${label} must be unique`, 'INVALID_DOCUMENT');
  };
  /**
   * Validates a canonical ISO timestamp.
   * @param {unknown} value - Candidate timestamp.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const timestamp = (value, label) => ensure(
    typeof value === 'string'
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value,
    `${label} must be an ISO timestamp`,
    'INVALID_DOCUMENT',
  );
  /**
   * Validates Test and Review vote values.
   * @param {unknown} value - Candidate vote.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const vote = (value, label) => {
    exactKeys(value, ['test', 'review'], label);
    for (const dimension of ['test', 'review']) {
      exactKeys(value[dimension], ['requires', 'reason'], `${label}.${dimension}`);
      ensure(
        typeof value[dimension].requires === 'boolean'
          && typeof value[dimension].reason === 'string'
          && value[dimension].reason.trim(),
        `${label}.${dimension} is invalid`,
        'INVALID_DOCUMENT',
      );
    }
  };
  /**
   * Validates a canonical relative project scope.
   * @param {unknown} value - Candidate scope.
   * @param {string} label - Diagnostic label.
   * @returns {void} Returns after validation.
   */
  const scope = (value, label) => ensure(
    typeof value === 'string'
      && value.length > 0
      && !value.startsWith('/')
      && !value.includes('\\')
      && value.split('/').every((part) => part && part !== '.' && part !== '..'),
    `${label} is invalid`,
    'INVALID_DOCUMENT',
  );
  exactKeys(state, [
    'version', 'id', 'type', 'status', 'stage', 'parent', 'owner', 'lease_until',
    'lease_minutes', 'created_at', 'updated_at', 'todos', 'assignments', 'children',
    'verification', 'result',
  ], 'state');
  validateId(state.id);
  ensure(state.version === 1, 'unsupported state version', 'INVALID_DOCUMENT');
  ensure(TYPES.has(state.type), 'invalid work type', 'INVALID_DOCUMENT');
  ensure(STATUSES.has(state.status), 'invalid work status', 'INVALID_DOCUMENT');
  ensure(STAGES.has(state.stage), 'invalid work stage', 'INVALID_DOCUMENT');
  ensure(state.parent === null || typeof state.parent === 'string', 'invalid parent state', 'INVALID_DOCUMENT');
  ensure(typeof state.owner === 'string' && typeof state.lease_until === 'string', 'invalid ownership state', 'INVALID_DOCUMENT');
  ensure(Boolean(state.owner) === Boolean(state.lease_until), 'owner and lease_until must both be empty or both be present', 'INVALID_DOCUMENT');
  if (state.owner) {
    ensure(state.owner.trim() === state.owner, 'owner must be a non-empty trimmed string', 'INVALID_DOCUMENT');
    timestamp(state.lease_until, 'lease_until');
  }
  ensure(Number.isInteger(state.lease_minutes) && state.lease_minutes >= 1 && state.lease_minutes <= MAX_LEASE_MINUTES, 'invalid lease duration', 'INVALID_DOCUMENT');
  timestamp(state.created_at, 'created_at');
  timestamp(state.updated_at, 'updated_at');
  ensure(Date.parse(state.updated_at) >= Date.parse(state.created_at), 'updated_at precedes created_at', 'INVALID_DOCUMENT');
  ensure(Array.isArray(state.todos) && Array.isArray(state.assignments) && Array.isArray(state.children), 'invalid coordination collections', 'INVALID_DOCUMENT');
  /**
   * Validates identity collections.
   * @param {object[]} items - Identity records.
   * @param {string} label - Collection label.
   * @returns {void} Returns after validation.
   */
  const unique = (items, label) => ensure(items.every((item) => {
    if (!item || typeof item.id !== 'string') return false;
    try { validateId(item.id); return true; } catch { return false; }
  }) && new Set(items.map((item) => item.id)).size === items.length, `${label} must have valid unique IDs`, 'INVALID_DOCUMENT');
  unique(state.todos, 'todos'); unique(state.assignments, 'assignments'); unique(state.children, 'children');
  for (const todo of state.todos) {
    exactKeys(todo, ['id', 'text', 'status', 'assignment', 'blockers'], `todo ${todo.id}`);
    ensure(typeof todo.text === 'string' && todo.text.trim(), `todo ${todo.id} text is invalid`, 'INVALID_DOCUMENT');
    ensure(TODO_STATUSES.has(todo.status), `todo ${todo.id} status is invalid`, 'INVALID_DOCUMENT');
    ensure(typeof todo.assignment === 'string', `todo ${todo.id} assignment is invalid`, 'INVALID_DOCUMENT');
    if (todo.assignment) validateId(todo.assignment);
    uniqueStrings(todo.blockers, `todo ${todo.id} blockers`);
    ensure(
      (todo.status === 'blocked') === (todo.blockers.length > 0),
      `todo ${todo.id} blockers do not match its status`,
      'INVALID_DOCUMENT',
    );
  }
  if (state.status === 'active') {
    ensure(state.todos.filter((item) => item.status === 'in_progress').length === 1, 'active work must have exactly one in-progress todo', 'INVALID_DOCUMENT');
  } else {
    ensure(state.todos.filter((item) => item.status === 'in_progress').length <= 1, 'work cannot have multiple in-progress todos', 'INVALID_DOCUMENT');
  }
  for (const assignment of state.assignments) {
    exactKeys(assignment, [
      'id', 'role', 'status', 'objective', 'successCriteria', 'read', 'write', 'decisions',
      'capabilities', 'agentId', 'dependsOn', 'sharedInterfaceStable', 'touchesGlobal',
      'integrator', 'blockers', 'receipt',
    ], `assignment ${assignment.id}`);
    ensure(ROLES.has(assignment.role) && ASSIGNMENT_STATUSES.has(assignment.status), `assignment ${assignment.id} role or status is invalid`, 'INVALID_DOCUMENT');
    ensure(typeof assignment.objective === 'string' && assignment.objective.trim(), `assignment ${assignment.id} objective is invalid`, 'INVALID_DOCUMENT');
    for (const field of ['successCriteria', 'read', 'write', 'decisions', 'dependsOn', 'blockers']) {
      uniqueStrings(assignment[field], `assignment ${assignment.id} ${field}`);
    }
    for (const pointer of assignment.write) scope(pointer, `assignment ${assignment.id} write scope`);
    exactKeys(assignment.capabilities, ['required', 'available', 'unavailable'], `assignment ${assignment.id} capabilities`);
    for (const field of ['required', 'available', 'unavailable']) uniqueStrings(assignment.capabilities[field], `assignment ${assignment.id} capabilities.${field}`);
    ensure(typeof assignment.agentId === 'string' && typeof assignment.integrator === 'string', `assignment ${assignment.id} agent or integrator is invalid`, 'INVALID_DOCUMENT');
    ensure(typeof assignment.sharedInterfaceStable === 'boolean' && typeof assignment.touchesGlobal === 'boolean', `assignment ${assignment.id} parallel safety is invalid`, 'INVALID_DOCUMENT');
    ensure(
      (assignment.status === 'blocked') === (assignment.blockers.length > 0),
      `assignment ${assignment.id} blockers do not match its status`,
      'INVALID_DOCUMENT',
    );
    ensure(!Object.hasOwn(assignment, 'result'), `assignment ${assignment.id} contains a legacy role result`, 'INVALID_DOCUMENT');
    if (assignment.receipt !== null) {
      ensure(assignment.receipt && ['completed', 'partial', 'blocked'].includes(assignment.receipt.status), `assignment ${assignment.id} has an invalid receipt`, 'INVALID_DOCUMENT');
      const receiptKeys = ['status'];
      if (assignment.status === 'completed') receiptKeys.push('completed_order');
      if (assignment.role === 'development') receiptKeys.push('changed_surface');
      if (['architecture', 'development'].includes(assignment.role)) receiptKeys.push('votes');
      if (['test', 'retest', 'review', 'rereview'].includes(assignment.role)) receiptKeys.push('passed');
      exactKeys(assignment.receipt, receiptKeys, `assignment ${assignment.id} receipt`);
      if (assignment.status === 'completed') {
        ensure(Number.isInteger(assignment.receipt.completed_order) && assignment.receipt.completed_order > 0, `assignment ${assignment.id} completion order is invalid`, 'INVALID_DOCUMENT');
      }
      if (assignment.role === 'development') {
        uniqueStrings(assignment.receipt.changed_surface, `assignment ${assignment.id} changed surface`);
        for (const pointer of assignment.receipt.changed_surface) scope(pointer, `assignment ${assignment.id} changed surface`);
      } else ensure(!Object.hasOwn(assignment.receipt, 'changed_surface'), `assignment ${assignment.id} has an unrelated changed surface`, 'INVALID_DOCUMENT');
      if (['architecture', 'development'].includes(assignment.role)) {
        vote(assignment.receipt.votes, `assignment ${assignment.id} receipt votes`);
      } else ensure(!Object.hasOwn(assignment.receipt, 'votes'), `assignment ${assignment.id} has unrelated gate votes`, 'INVALID_DOCUMENT');
      if (['test', 'retest', 'review', 'rereview'].includes(assignment.role)) {
        ensure(typeof assignment.receipt.passed === 'boolean', `assignment ${assignment.id} pass receipt is invalid`, 'INVALID_DOCUMENT');
      } else ensure(!Object.hasOwn(assignment.receipt, 'passed'), `assignment ${assignment.id} has an unrelated pass receipt`, 'INVALID_DOCUMENT');
    }
    if (assignment.status === 'pending') ensure(assignment.receipt === null, `pending assignment ${assignment.id} cannot have a receipt`, 'INVALID_DOCUMENT');
    if (assignment.status === 'completed') ensure(assignment.receipt?.status === 'completed', `completed assignment ${assignment.id} requires a completed receipt`, 'INVALID_DOCUMENT');
    if (assignment.receipt?.status === 'completed') ensure(['in_progress', 'completed'].includes(assignment.status), `assignment ${assignment.id} completed receipt has invalid status`, 'INVALID_DOCUMENT');
    if (['partial', 'blocked'].includes(assignment.receipt?.status)) ensure(assignment.status === 'blocked', `assignment ${assignment.id} retry receipt requires blocked status`, 'INVALID_DOCUMENT');
  }
  const completedOrders = state.assignments
    .filter((assignment) => assignment.status === 'completed')
    .map((assignment) => assignment.receipt.completed_order);
  ensure(new Set(completedOrders).size === completedOrders.length, 'assignment completion order must be unique', 'INVALID_DOCUMENT');
  const assignments = new Map(state.assignments.map((item) => [item.id, item]));
  ensure(state.todos.every((todo) => !todo.assignment || assignments.has(todo.assignment)), 'todo assignment references must resolve', 'INVALID_DOCUMENT');
  for (const child of state.children) {
    exactKeys(child, ['id', 'path', 'status'], `child ${child.id}`);
    ensure(typeof child.path === 'string' && child.path.trim() && STATUSES.has(child.status), `child ${child.id} link state is invalid`, 'INVALID_DOCUMENT');
  }
  const visiting = new Set(); const visited = new Set();
  /**
   * Visits an Assignment dependency.
   * @param {string} id - Assignment identifier.
   * @returns {void} Returns after traversal.
   */
  const visit = (id) => {
    ensure(assignments.has(id), `missing assignment dependency: ${id}`, 'INVALID_DOCUMENT');
    ensure(!visiting.has(id), 'assignment dependencies must form a DAG', 'INVALID_DOCUMENT');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of assignments.get(id).dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of assignments.keys()) visit(id);
  for (const assignment of state.assignments) {
    ensure(Array.isArray(assignment.dependsOn), `assignment ${assignment.id} dependsOn must be an array`, 'INVALID_DOCUMENT');
    ensure(new Set(assignment.dependsOn).size === assignment.dependsOn.length, `assignment ${assignment.id} dependencies must be unique`, 'INVALID_DOCUMENT');
    for (const dependency of assignment.dependsOn) validateId(dependency);
    if (['in_progress', 'completed'].includes(assignment.status)) {
      ensure(
        assignment.dependsOn.every((dependency) => assignments.get(dependency)?.status === 'completed'),
        `assignment ${assignment.id} has an unfinished prerequisite`,
        'INVALID_DOCUMENT',
      );
    }
  }
  const activeDevelopment = state.assignments.filter((assignment) => assignment.role === 'development' && assignment.status === 'in_progress');
  for (let leftIndex = 0; leftIndex < activeDevelopment.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeDevelopment.length; rightIndex += 1) {
      const left = activeDevelopment[leftIndex]; const right = activeDevelopment[rightIndex];
      ensure(!left.dependsOn.includes(right.id) && !right.dependsOn.includes(left.id), 'parallel Development assignments cannot depend on each other', 'INVALID_DOCUMENT');
      ensure(left.sharedInterfaceStable && right.sharedInterfaceStable, 'parallel Development requires stable shared interfaces', 'INVALID_DOCUMENT');
      ensure(!left.touchesGlobal && !right.touchesGlobal, 'parallel Development cannot touch global files', 'INVALID_DOCUMENT');
      ensure(left.integrator && left.integrator === right.integrator, 'parallel Development requires one named integrator', 'INVALID_DOCUMENT');
      ensure(
        !left.write.some((leftScope) => right.write.some((rightScope) => leftScope === rightScope
          || leftScope.startsWith(`${rightScope}/`) || rightScope.startsWith(`${leftScope}/`))),
        'parallel Development write scopes overlap',
        'INVALID_DOCUMENT',
      );
    }
  }
  exactKeys(state.verification, ['votes', 'decisions'], 'verification');
  exactKeys(state.verification.votes, ['architecture', 'development', 'main'], 'verification votes');
  if (state.verification.votes.architecture !== null) {
    exactKeys(state.verification.votes.architecture, ['assignment', 'test', 'review', 'covered'], 'architecture vote');
    validateId(state.verification.votes.architecture.assignment);
    ensure(typeof state.verification.votes.architecture.covered === 'boolean', 'architecture coverage is invalid', 'INVALID_DOCUMENT');
    vote({ test: state.verification.votes.architecture.test, review: state.verification.votes.architecture.review }, 'architecture vote');
  }
  const completedArchitecture = state.assignments
    .filter((assignment) => assignment.role === 'architecture'
      && assignment.status === 'completed'
      && assignment.receipt?.status === 'completed')
    .sort((left, right) => left.receipt.completed_order - right.receipt.completed_order)
    .at(-1);
  if (completedArchitecture) {
    ensure(state.verification.votes.architecture !== null, `completed Architecture assignment is missing a vote: ${completedArchitecture.id}`, 'INVALID_DOCUMENT');
    ensure(
      state.verification.votes.architecture.assignment === completedArchitecture.id,
      `architecture vote identifies the wrong assignment: ${completedArchitecture.id}`,
      'INVALID_DOCUMENT',
    );
    ensure(
      JSON.stringify({
        test: state.verification.votes.architecture.test,
        review: state.verification.votes.architecture.review,
      }) === JSON.stringify(completedArchitecture.receipt.votes),
      `architecture vote does not match receipt: ${completedArchitecture.id}`,
      'INVALID_DOCUMENT',
    );
  } else {
    ensure(state.verification.votes.architecture === null, 'architecture vote has no completed Architecture receipt', 'INVALID_DOCUMENT');
  }
  ensure(Array.isArray(state.verification.votes.development), 'development votes must be an array', 'INVALID_DOCUMENT');
  const developmentAssignments = new Set();
  for (const entry of state.verification.votes.development) {
    exactKeys(entry, ['assignment', 'test', 'review'], 'development vote');
    validateId(entry.assignment);
    ensure(!developmentAssignments.has(entry.assignment), 'development votes must identify unique assignments', 'INVALID_DOCUMENT');
    developmentAssignments.add(entry.assignment);
    ensure(assignments.get(entry.assignment)?.role === 'development' && assignments.get(entry.assignment)?.status === 'completed', `development vote assignment is invalid: ${entry.assignment}`, 'INVALID_DOCUMENT');
    vote({ test: entry.test, review: entry.review }, `development vote ${entry.assignment}`);
    ensure(JSON.stringify({ test: entry.test, review: entry.review }) === JSON.stringify(assignments.get(entry.assignment).receipt?.votes), `development vote does not match receipt: ${entry.assignment}`, 'INVALID_DOCUMENT');
  }
  for (const assignment of state.assignments.filter((entry) => entry.role === 'development' && entry.status === 'completed')) {
    ensure(developmentAssignments.has(assignment.id), `completed Development assignment is missing a vote: ${assignment.id}`, 'INVALID_DOCUMENT');
  }
  if (state.verification.votes.main !== null) vote(state.verification.votes.main, 'main vote');
  exactKeys(state.verification.decisions, ['test', 'review'], 'verification decisions');
  for (const dimension of ['test', 'review']) {
    const decision = state.verification.decisions[dimension];
    if (decision === null) continue;
    exactKeys(decision, ['execute', 'rule', 'votes', 'reason'], `${dimension} decision`);
    ensure(
      typeof decision.execute === 'boolean'
        && ['three-party-majority', 'main-decision-with-development-advice'].includes(decision.rule)
        && decision.votes && typeof decision.votes === 'object' && !Array.isArray(decision.votes)
        && typeof decision.reason === 'string' && decision.reason.trim(),
      `${dimension} decision is invalid`,
      'INVALID_DOCUMENT',
    );
    exactKeys(decision.votes, ['architecture', 'development', 'main'], `${dimension} decision votes`);
    ensure(
      [true, false, null, 'absent'].includes(decision.votes.architecture)
        && [true, false, null].includes(decision.votes.development)
        && [true, false, null].includes(decision.votes.main),
      `${dimension} decision vote values are invalid`,
      'INVALID_DOCUMENT',
    );
    let calculated;
    try {
      calculated = computeVotes(state.verification, dimension, {
        developmentOccurred: state.assignments.some((assignment) => assignment.role === 'development'),
      });
    } catch {
      ensure(false, `${dimension} decision cannot be recomputed`, 'INVALID_DOCUMENT');
    }
    ensure(JSON.stringify(decision) === JSON.stringify(calculated), `${dimension} decision does not match current votes`, 'INVALID_DOCUMENT');
  }
  exactKeys(state.result, ['status', 'blockers'], 'result');
  ensure(['pending', 'completed'].includes(state.result.status), 'invalid result status', 'INVALID_DOCUMENT');
  uniqueStrings(state.result.blockers, 'result blockers');
  ensure(state.result.status !== 'completed' || state.result.blockers.length === 0, 'completed result cannot have blockers', 'INVALID_DOCUMENT');
  return state;
}

/**
 * Validates a paired Work Item.
 * @param {object} document - Candidate document.
 * @param {object} options - Diagnostic options.
 * @returns {object} Valid document.
 */
export function validateDocument(document, options = {}) {
  ensure(typeof document.markdown === 'string', 'work.md needs a title', 'INVALID_DOCUMENT');
  validateState(document.state, options);
  ensure(!/^---\s*$/m.test(document.markdown), 'work.md must not contain YAML frontmatter', 'INVALID_DOCUMENT');
  ensure(!/^ {0,3}(?:`{3,}|~{3,})[ \t]*(?:json|ya?ml)(?:[ \t]|$)/mi.test(document.markdown), 'work.md must not contain fenced machine data', 'INVALID_DOCUMENT');
  ensure(!/<!--\s*workflow:/i.test(document.markdown), 'work.md must not contain controlled markers', 'INVALID_DOCUMENT');
  const headings = scanMarkdownHeadings(document.markdown);
  ensure(headings.filter(({ level }) => level === 1).length === 1, 'work.md must contain exactly one title', 'INVALID_DOCUMENT');
  ensure(scanMarkdownStructure(document.markdown).statuses.length === 1, 'work.md must contain exactly one Status line', 'INVALID_DOCUMENT');
  for (const heading of ['Outcome', 'Scope', 'Acceptance', 'Decisions', 'Work', 'Completed', 'Current focus', 'Child deliveries', 'Open issues', 'References']) {
    const key = heading.toLowerCase();
    ensure(headings.filter(({ key: actual, level }) => level === 2 && actual === key).length === 1, `work.md must contain exactly one ${heading} section`, 'INVALID_DOCUMENT');
  }
  ensure(markdownTitle(document.markdown), 'work.md needs a title', 'INVALID_DOCUMENT');
  ensure(markdownStatus(document.markdown) === document.state.status, 'work.md status must match state.json', 'INVALID_DOCUMENT');
  ensure(document.blocks.success_criteria.length > 0, 'work.md needs acceptance criteria', 'INVALID_DOCUMENT');
  return document;
}

/**
 * Reads the top-level title.
 * @param {string} markdown - Document text.
 * @returns {string} Title text.
 */
export function markdownTitle(markdown) {
  return scanMarkdownHeadings(markdown).find(({ level }) => level === 1)?.text ?? '';
}

/**
 * Reads the status line.
 * @param {string} markdown - Document text.
 * @returns {string} Normalized status.
 */
export function markdownStatus(markdown) {
  return scanMarkdownStructure(markdown).statuses[0]?.value ?? '';
}

/**
 * Replaces the status line.
 * @param {string} markdown - Document text.
 * @param {string} status - New status.
 * @returns {string} Updated Markdown.
 */
export function replaceMarkdownStatus(markdown, status) {
  const structure = scanMarkdownStructure(markdown);
  const current = structure.statuses[0];
  if (current) return `${markdown.slice(0, current.start)}Status: ${status}${markdown.slice(current.end)}`;
  const title = structure.headings.find(({ level }) => level === 1);
  return title
    ? `${markdown.slice(0, title.end)}\nStatus: ${status}\n${markdown.slice(title.end)}`
    : markdown;
}
