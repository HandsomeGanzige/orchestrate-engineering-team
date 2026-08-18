import {
  ensure,
  resultKeysForRole,
  ROLES,
  STAGES,
  STATUSES,
} from './workflow-contract.mjs';
import {
  completionIssues,
  computeVotes,
  hasCompletedEvidence,
  projectCompletedAssignmentVote,
  validateRoleResult,
} from './verification.mjs';
import {
  appendSectionLine,
  replaceAcceptanceEntry,
  replaceMarkdownStatus,
  replaceSection,
  validateId,
} from './workflow-document.mjs';
import {
  boundedString,
  normalizeStrings,
  normalizedScope,
  scalar,
} from './value-policy.mjs';
import {
  appendBoundedRecords,
  approvedGates,
  assertActiveClaimBinding,
  assertCapabilities,
  assertContractNarrowing,
  assertDevelopmentClaims,
  assignmentCapabilities,
  assignmentClaimSpecs,
  assignmentTopology,
  claimsConflict,
  refreshUsage,
} from './governance-v2.mjs';

/**
 * Finds one ID-addressed record or raises a stable not-found error.
 *
 * @param {object[]} items - Collection of records containing `id` fields.
 * @param {string} id - Identity to locate.
 * @param {string} kind - Human-readable record kind used in errors.
 * @returns {object} The matching record from the original collection.
 */
export function itemById(items, id, kind) {
  const item = items.find((entry) => entry.id === id);
  ensure(item, `${kind} not found: ${id}`, 'NOT_FOUND');
  return item;
}

/**
 * Ensures an ID is not already present in an identity collection.
 *
 * @param {object[]} items - Collection of records containing `id` fields.
 * @param {string} id - Candidate identity.
 * @param {string} kind - Human-readable record kind used in errors.
 * @returns {void} Returns when the identity is available.
 */
export function ensureUnique(items, id, kind) {
  ensure(!items.some((entry) => entry.id === id), `${kind} already exists: ${id}`, 'ALREADY_EXISTS');
}

/**
 * Determines whether two canonical write scopes overlap by equality or ancestry.
 *
 * @param {string} left - First project-relative write scope.
 * @param {string} right - Second project-relative write scope.
 * @returns {boolean} `true` when either scope contains the other.
 */
export function scopesConflict(left, right) {
  const leftScope = normalizedScope(left);
  const rightScope = normalizedScope(right);
  return leftScope === rightScope
    || leftScope.startsWith(`${rightScope}/`)
    || rightScope.startsWith(`${leftScope}/`);
}

/**
 * Replaces success evidence for one exact criterion in a mutable Work Item.
 *
 * @param {object} document - Work Item whose result evidence is updated.
 * @param {object} input - Criterion, evidence description, and optional path pointers.
 * @returns {void} Mutates the result evidence collection in place.
 */
function recordSuccessEvidence(document, input) {
  boundedString(input.criterion, 'criterion');
  ensure(
    document.blocks.success_criteria.includes(input.criterion),
    'criterion must exactly match a success criterion',
    'INVALID_SUCCESS_EVIDENCE',
  );
  boundedString(input.evidence, 'evidence', 1000);
  const pointers = normalizeStrings(input.pointers ?? [], 'pointers', { max: 30 })
    .map(normalizedScope);
  document.blocks.result.success_evidence = document.blocks.result.success_evidence
    .filter((item) => item.criterion !== input.criterion);
  document.blocks.result.success_evidence.push({
    criterion: input.criterion,
    evidence: input.evidence,
    pointers,
  });
  const pointerText = pointers.length ? ` \u2014 Pointers: ${pointers.map((pointer) => `\`${pointer}\``).join(', ')}` : '';
  replaceAcceptanceEntry(
    document,
    input.criterion,
    `- [x] ${input.criterion} \u2014 Evidence: ${input.evidence}${pointerText}`,
  );
}

/**
 * Validates the action name and allowed input fields for a Work Item mutation.
 *
 * @param {string} action - `update` or `evidence` action.
 * @param {object} input - Candidate mutation payload.
 * @returns {void} Returns when the command surface is valid.
 */
function validateWorkMutation(action, input) {
  ensure(['update', 'evidence'].includes(action), 'work supports update or evidence', 'INVALID_COMMAND');
  if (action === 'evidence') {
    const allowed = new Set(['criterion', 'evidence', 'pointers']);
    ensure(
      Object.keys(input).every((key) => allowed.has(key)),
      'work evidence contains unknown field',
      'INVALID_INPUT',
    );
    return;
  }
  const allowed = new Set(['status', 'stage', 'progress', 'result', 'artifacts', 'nextAction', 'completeTodo']);
  ensure(
    Object.keys(input).every((key) => allowed.has(key)),
    'work update contains unknown field',
    'INVALID_INPUT',
  );
}

/**
 * Applies an already validated Work Item update or success-evidence mutation.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Validated `update` or `evidence` action.
 * @param {object} input - Validated mutation payload.
 * @returns {object} Mutation-specific result describing the new work state or recorded criterion.
 */
function applyPreparedWork(document, action, input) {
  if (action === 'evidence') {
    recordSuccessEvidence(document, input);
    return { criterion: input.criterion, recorded: true };
  }
  if (input.status !== undefined) {
    ensure(STATUSES.has(input.status), 'invalid work status', 'INVALID_INPUT');
  }
  if (input.stage !== undefined) {
    ensure(STAGES.has(input.stage), 'invalid work stage', 'INVALID_INPUT');
    document.frontmatter.stage = input.stage;
  }
  if (input.progress !== undefined) {
    ensure(
      typeof input.progress === 'string' && input.progress.length <= 2000,
      'progress must be a short string',
      'INVALID_INPUT',
    );
    document.blocks.current_progress = input.progress;
    document.markdown = replaceSection(document.markdown, 'Current focus', input.progress);
  }
  if (input.result !== undefined) {
    ensure(
      typeof input.result === 'string' && input.result.length <= 2000,
      'result must be a short string',
      'INVALID_INPUT',
    );
    document.blocks.result.summary = [input.result];
  }
  if (input.artifacts !== undefined) {
    ensure(Array.isArray(input.artifacts), 'artifacts must be an array', 'INVALID_INPUT');
    document.blocks.result.artifacts = input.artifacts.map((artifact) => {
      ensure(artifact && typeof artifact.path === 'string' && typeof artifact.purpose === 'string', 'artifact needs path and purpose', 'INVALID_INPUT');
      return { path: normalizedScope(artifact.path), purpose: boundedString(artifact.purpose, 'artifact purpose') };
    });
  }
  if (input.nextAction !== undefined) {
    ensure(
      typeof input.nextAction === 'string' && input.nextAction.length <= 500,
      'nextAction must be a short string',
      'INVALID_INPUT',
    );
    document.blocks.result.next_action = input.nextAction;
    document.blocks.current_progress = input.nextAction;
    document.markdown = replaceSection(document.markdown, 'Current focus', input.nextAction);
  }
  if (input.result !== undefined || input.artifacts !== undefined) {
    document.markdown = replaceSection(document.markdown, 'Completed', [
      ...document.blocks.result.summary.map((item) => `- ${item}`),
      ...document.blocks.result.artifacts.map((item) => `- Artifact: \`${item.path}\` \u2014 ${item.purpose}`),
    ].join('\n'));
  }
  if (input.status === 'completed') {
    ensure(
      typeof input.completeTodo === 'string' && input.completeTodo,
      'completion requires completeTodo for the final in-progress todo',
      'INVALID_INPUT',
    );
    const finalTodo = itemById(document.blocks.todo, input.completeTodo, 'todo');
    ensure(
      finalTodo.status === 'in_progress',
      'completeTodo must identify the in-progress todo',
      'INVALID_TRANSITION',
    );
    finalTodo.status = 'completed';
    document.blocks.result.status = 'completed';
    const issues = completionIssues(document);
    ensure(
      issues.length === 0,
      issues.map((issue) => issue.message).join('; '),
      issues[0]?.code ?? 'INCOMPLETE_WORK',
    );
  }
  if (input.status !== undefined) document.frontmatter.status = input.status;
  if (input.status !== undefined) document.markdown = replaceMarkdownStatus(document.markdown, input.status);
  return { status: document.frontmatter.status, stage: document.frontmatter.stage };
}

/**
 * Validates a Work Item mutation once and returns a reusable in-memory mutator.
 *
 * @param {string} [action='update'] - Work mutation action.
 * @param {object} input - Mutation payload captured by the returned closure.
 * @returns {(document: object) => object} Mutator that applies the validated operation to one document.
 */
export function prepareWorkMutation(action = 'update', input) {
  validateWorkMutation(action, input);
  return (document) => applyPreparedWork(document, action, input);
}

/**
 * Validates and immediately applies a Work Item mutation.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} [action='update'] - Work mutation action.
 * @param {object} input - Mutation payload.
 * @returns {object} Mutation-specific result.
 */
export function applyWork(document, action = 'update', input) {
  return prepareWorkMutation(action, input)(document);
}

/**
 * Validates the command surface for adding a confirmed decision.
 *
 * @param {string} action - Expected `add` action.
 * @param {object} input - Candidate decision payload.
 * @returns {void} Returns when the action, ID, and summary are valid.
 */
function validateDecisionMutation(action, input) {
  ensure(action === 'add', 'decision supports only add', 'INVALID_COMMAND');
  validateId(input.id);
  ensure(
    typeof input.id === 'string'
      && input.id
      && typeof input.summary === 'string'
      && input.summary,
    'decision id and summary are required',
    'INVALID_INPUT',
  );
  ensure(!/[\r\n\u2028\u2029]/u.test(input.summary), 'decision summary must be a single line', 'INVALID_INPUT');
}

/**
 * Adds an already validated confirmed decision to a mutable Work Item.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {object} input - Decision identity, summary, and evidence pointers.
 * @returns {{decision: string}} Identity of the added decision.
 */
function applyPreparedDecision(document, input) {
  ensureUnique(document.blocks.confirmed_decisions, input.id, 'decision');
  const evidence = normalizeStrings(input.evidence ?? [], 'evidence', { max: 20 });
  document.blocks.confirmed_decisions.push({
    id: input.id,
    summary: input.summary,
    evidence,
  });
  const links = evidence.map((pointer) => {
    const label = pointer.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
    const destination = encodeURI(pointer).replaceAll('(', '%28').replaceAll(')', '%29');
    return `[${label}](${destination})`;
  });
  appendSectionLine(
    document,
    'Decisions',
    `- **${input.id}:** ${input.summary}${links.length ? `\n  - Evidence: ${links.join(', ')}` : ''}`,
  );
  return { decision: input.id };
}

/**
 * Validates a decision mutation and returns a reusable document mutator.
 *
 * @param {string} action - Decision action, currently `add`.
 * @param {object} input - Decision payload captured by the closure.
 * @returns {(document: object) => {decision: string}} Prepared decision mutator.
 */
export function prepareDecisionMutation(action, input) {
  validateDecisionMutation(action, input);
  return (document) => applyPreparedDecision(document, input);
}

/**
 * Validates and immediately adds a confirmed decision.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Decision action.
 * @param {object} input - Decision payload.
 * @returns {{decision: string}} Identity of the added decision.
 */
export function applyDecision(document, action, input) {
  return prepareDecisionMutation(action, input)(document);
}

/**
 * Validates that a Todo command uses a supported lifecycle action.
 *
 * @param {string} action - Candidate Todo action.
 * @returns {void} Returns for add, start, complete, or block.
 */
function validateTodoMutation(action) {
  ensure(['add', 'start', 'complete', 'block'].includes(action), 'invalid todo action', 'INVALID_COMMAND');
}

/**
 * Applies an already validated Todo lifecycle mutation.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Validated Todo action.
 * @param {object} input - Action-specific Todo payload.
 * @returns {{todo: string, action: string}} Mutated Todo identity and action.
 */
function applyPreparedTodo(document, action, input) {
  if (action === 'add') {
    validateId(input.id);
    ensure(typeof input.text === 'string' && input.text.trim(), 'todo text is required', 'INVALID_INPUT');
    if (input.assignment) itemById(document.blocks.assignments, validateId(input.assignment), 'assignment');
    ensureUnique(document.blocks.todo, input.id, 'todo');
    document.blocks.todo.push({
      id: input.id,
      text: input.text.trim(),
      status: 'pending',
      assignment: input.assignment ?? '',
      blockers: [],
    });
    return { todo: input.id, action };
  }

  const todo = itemById(document.blocks.todo, input.id, 'todo');
  if (action === 'start') {
    ensure(
      !document.blocks.todo.some((entry) => entry.status === 'in_progress' && entry.id !== input.id),
      'another todo is already in progress',
      'TODO_CONFLICT',
    );
    ensure(
      ['pending', 'blocked'].includes(todo.status),
      'todo cannot be started from its current status',
      'INVALID_TRANSITION',
    );
    todo.status = 'in_progress';
    todo.blockers = [];
  } else if (action === 'complete') {
    ensure(todo.status === 'in_progress', 'only an in-progress todo can complete', 'INVALID_TRANSITION');
    todo.status = 'completed';
    if (input.next !== undefined) {
      const next = itemById(document.blocks.todo, input.next, 'todo');
      ensure(
        ['pending', 'blocked'].includes(next.status),
        'next todo must be pending or blocked',
        'INVALID_TRANSITION',
      );
      next.status = 'in_progress';
      next.blockers = [];
    } else {
      ensure(
        document.frontmatter.status !== 'active',
        'active work requires a next todo; complete the final todo through work completion',
        'TODO_CONFLICT',
      );
    }
  } else {
    ensure(
      ['pending', 'in_progress'].includes(todo.status),
      'todo cannot be blocked from its current status',
      'INVALID_TRANSITION',
    );
    todo.status = 'blocked';
    todo.blockers = normalizeStrings(input.blockers, 'blockers', { min: 1, max: 10 });
    if (input.next !== undefined) {
      const next = itemById(document.blocks.todo, input.next, 'todo');
      ensure(next.status === 'pending', 'next todo must be pending', 'INVALID_TRANSITION');
      next.status = 'in_progress';
      next.blockers = [];
    } else {
      ensure(
        document.frontmatter.status !== 'active',
        'active work requires a next todo when blocking the current todo',
        'TODO_CONFLICT',
      );
    }
  }
  return { todo: input.id, action };
}

/**
 * Validates a Todo action and returns a reusable document mutator.
 *
 * @param {string} action - Todo lifecycle action.
 * @param {object} input - Action payload captured by the closure.
 * @returns {(document: object) => {todo: string, action: string}} Prepared Todo mutator.
 */
export function prepareTodoMutation(action, input) {
  validateTodoMutation(action);
  return (document) => applyPreparedTodo(document, action, input);
}

/**
 * Validates and immediately applies a Todo lifecycle action.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Todo lifecycle action.
 * @param {object} input - Action-specific payload.
 * @returns {{todo: string, action: string}} Mutated Todo identity and action.
 */
export function applyTodo(document, action, input) {
  return prepareTodoMutation(action, input)(document);
}

/**
 * Enforces every independence rule required for concurrent Development Assignments.
 *
 * @param {object} candidate - Development Assignment about to start.
 * @param {object} active - Already running Development Assignment.
 * @returns {void} Returns only when dependencies, interfaces, global files, integrator, and scopes are safe.
 */
function assertParallelSafe(candidate, active) {
  ensure(
    !candidate.dependsOn.includes(active.id) && !active.dependsOn.includes(candidate.id),
    `development assignments ${candidate.id} and ${active.id} have a dependency`,
    'PARALLEL_CONFLICT',
  );
  ensure(
    candidate.topology.mode === 'parallel' && active.topology.mode === 'parallel'
      && candidate.topology.group === active.topology.group
      && candidate.topology.independent && active.topology.independent
      && candidate.topology.shared_interface_stable && active.topology.shared_interface_stable,
    'parallel development requires a stable shared interface',
    'PARALLEL_CONFLICT',
  );
  ensure(
    !candidate.topology.touches_global && !active.topology.touches_global,
    'parallel development cannot modify global or generated files',
    'PARALLEL_CONFLICT',
  );
  ensure(
    candidate.topology.integrator && candidate.topology.integrator === active.topology.integrator,
    'parallel development requires the same named integrator',
    'PARALLEL_CONFLICT',
  );
  // Prefix comparison treats a directory and every descendant as the same write domain.
  for (const left of candidate.write) {
    for (const right of active.write) {
      ensure(
        !scopesConflict(left, right),
        `overlapping write scopes: ${left} and ${right}`,
        'PARALLEL_CONFLICT',
      );
    }
  }
}

/**
 * Validates that an Assignment command uses a supported lifecycle action.
 *
 * @param {string} action - Candidate Assignment action.
 * @returns {void} Returns for add, start, complete, or block.
 */
function validateAssignmentMutation(action) {
  ensure(
    ['add', 'start', 'complete', 'block'].includes(action),
    'invalid assignment action',
    'INVALID_COMMAND',
  );
}

/**
 * Applies an already validated Assignment lifecycle mutation and its dependency rules.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Validated Assignment action.
 * @param {object} input - Action-specific Assignment payload.
 * @param {object} [context={}] - Attempt clock and optional Git baseline.
 * @returns {{assignment: string, action: string}} Mutated Assignment identity and action.
 */
function applyPreparedAssignment(document, action, input, context = {}) {
  if (action === 'add') {
    validateId(input.id);
    ensure(ROLES.has(input.role), 'invalid assignment role', 'INVALID_INPUT');
    ensureUnique(document.blocks.assignments, input.id, 'assignment');
    ensure(document.state.assignments.length < document.state.limits.assignments, 'assignment limit exceeded', 'LIMIT_EXCEEDED');
    const write = normalizeStrings(input.write ?? [], 'write', { max: 100 }).map(normalizedScope);
    const assignment = {
      id: input.id,
      role: input.role,
      status: 'pending',
      objective: scalar(input.objective),
      successCriteria: normalizeStrings(input.successCriteria ?? [], 'successCriteria', { max: 30 }),
      read: normalizeStrings(input.read ?? [], 'read', { max: 100 }).map(normalizedScope),
      write,
      decisions: normalizeStrings(input.decisions ?? [], 'decisions', { max: 30 }),
      contract_digest: document.state.contract.digest,
      capabilities: assignmentCapabilities(input),
      topology: assignmentTopology(input),
      claim_specs: assignmentClaimSpecs(input, input.role, write),
      current_attempt: '',
      agentId: scalar(input.agentId),
      dependsOn: normalizeStrings(input.dependsOn ?? [], 'dependsOn', { max: 30 }),
      blockers: [],
      receipt: null,
    };
    ensure(assignment.objective, 'assignment objective is required', 'INVALID_INPUT');
    ensure(
      assignment.dependsOn.length === new Set(assignment.dependsOn).size,
      'dependsOn must contain unique assignment IDs',
      'INVALID_INPUT',
    );
    ensure(
      !assignment.dependsOn.includes(assignment.id),
      'assignment cannot depend on itself',
      'INVALID_INPUT',
    );
    for (const dependency of assignment.dependsOn) {
      validateId(dependency);
      itemById(document.blocks.assignments, dependency, 'assignment prerequisite');
    }
    assertContractNarrowing(document.state.contract, assignment);
    assertDevelopmentClaims(assignment);
    document.blocks.assignments.push(assignment);
    if (['architecture', 'development'].includes(assignment.role)) {
      document.blocks.verification.decisions = { test: null, review: null };
    }
    return { assignment: input.id, action };
  }

  const assignment = itemById(document.blocks.assignments, input.id, 'assignment');
  if (action === 'start') {
    ensure(
      ['pending', 'blocked'].includes(assignment.status),
      'assignment cannot start from its current status',
      'INVALID_TRANSITION',
    );
    const prerequisites = assignment.dependsOn.map((dependency) => (
      itemById(document.blocks.assignments, dependency, 'assignment prerequisite')
    ));
    for (const prerequisite of prerequisites) {
      ensure(
        prerequisite.status === 'completed',
        `assignment prerequisite is not completed: ${prerequisite.id}`,
        'INVALID_TRANSITION',
      );
    }
    assertCapabilities(assignment.capabilities);
    assertContractNarrowing(document.state.contract, assignment);
    ensure(document.state.usage.active_assignments < document.state.limits.active_assignments, 'active assignment limit exceeded', 'LIMIT_EXCEEDED');
    const priorAttempts = document.state.attempts.filter((attempt) => attempt.assignment_id === assignment.id);
    ensure(priorAttempts.length < document.state.limits.attempts_per_assignment
      && document.state.attempts.length < document.state.limits.total_attempts, 'attempt limit exceeded', 'LIMIT_EXCEEDED');
    if (assignment.role === 'development') {
      assertDevelopmentClaims(assignment);
      const activeAssignments = document.blocks.assignments.filter((entry) => entry.role === 'development'
        && entry.status === 'in_progress'
        && entry.id !== assignment.id);
      for (const active of activeAssignments) assertParallelSafe(assignment, active);
    }
    const startedAt = (context.now ?? new Date()).toISOString();
    const attempt = {
      id: `${assignment.id}-attempt-${priorAttempts.length + 1}`,
      assignment_id: assignment.id,
      ordinal: priorAttempts.length + 1,
      status: 'in_progress',
      agent_id: scalar(input.agentId ?? assignment.agentId) || 'unassigned',
      contract_digest: assignment.contract_digest,
      started_at: startedAt,
      ended_at: '',
      gates: approvedGates(input.gates, context.now ?? new Date()),
      git_baseline: assignment.role === 'development' ? context.gitBaseline : null,
      receipt: null,
      blockers: [],
    };
    if (assignment.role === 'development') ensure(attempt.git_baseline, 'Development requires a Git baseline', 'INVALID_GIT_SCOPE');
    ensure(document.state.claims.length + assignment.claim_specs.length <= document.state.limits.claims, 'claim limit exceeded', 'LIMIT_EXCEEDED');
    const claims = assignment.claim_specs.map((spec, index) => ({
      id: `${attempt.id}-claim-${index + 1}`,
      assignment_id: assignment.id,
      attempt_id: attempt.id,
      ...spec,
      status: 'active',
      acquired_at: startedAt,
      released_at: '',
    }));
    for (const claim of claims) for (const active of document.state.claims.filter((entry) => entry.status === 'active')) {
      ensure(!claimsConflict(claim, active), `resource claim conflicts with ${active.id}`, 'CLAIM_CONFLICT');
    }
    document.state.attempts.push(attempt);
    document.state.claims.push(...claims);
    assignment.current_attempt = attempt.id;
    assignment.status = 'in_progress';
    assignment.blockers = [];
    if (['partial', 'blocked'].includes(assignment.receipt?.status)) assignment.receipt = null;
    assignment.agentId = attempt.agent_id;
  } else if (action === 'complete') {
    ensure(
      assignment.status === 'in_progress' && assignment.receipt?.status === 'completed',
      'assignment requires a completed role result before completion',
      'INVALID_TRANSITION',
    );
    const completedOrders = document.blocks.assignments
      .map((entry) => entry.receipt?.completed_order)
      .filter(Number.isInteger);
    assignment.receipt.completed_order = Math.max(0, ...completedOrders) + 1;
    const attempt = itemById(document.state.attempts, assignment.current_attempt, 'attempt');
    ensure(attempt.status === 'completed' && attempt.receipt?.status === 'completed', 'assignment completion requires a completed current attempt', 'INVALID_TRANSITION');
    attempt.receipt.completed_order = assignment.receipt.completed_order;
    assignment.status = 'completed';
    projectCompletedAssignmentVote(document, assignment);
  } else {
    ensure(
      ['pending', 'in_progress'].includes(assignment.status),
      'assignment cannot be blocked from its current status',
      'INVALID_TRANSITION',
    );
    assignment.status = 'blocked';
    assignment.blockers = normalizeStrings(input.blockers, 'blockers', { min: 1, max: 10 });
    const attempt = document.state.attempts.find((entry) => entry.id === assignment.current_attempt);
    if (attempt?.status === 'in_progress') {
      attempt.status = 'blocked';
      attempt.ended_at = (context.now ?? new Date()).toISOString();
      attempt.blockers = [...assignment.blockers];
      for (const claim of document.state.claims.filter((entry) => entry.attempt_id === attempt.id && entry.status === 'active')) {
        claim.status = 'released'; claim.released_at = attempt.ended_at;
      }
    }
  }
  if (['architecture', 'development'].includes(assignment.role)) {
    document.blocks.verification.decisions = { test: null, review: null };
  }
  return { assignment: input.id, action };
}

/**
 * Validates an Assignment action and returns a reusable document mutator.
 *
 * @param {string} action - Assignment lifecycle action.
 * @param {object} input - Action payload captured by the closure.
 * @param {object} [context={}] - Attempt clock and optional Git baseline.
 * @returns {(document: object) => {assignment: string, action: string}} Prepared Assignment mutator.
 */
export function prepareAssignmentMutation(action, input, context = {}) {
  validateAssignmentMutation(action);
  return (document) => {
    const result = applyPreparedAssignment(document, action, input, context);
    refreshUsage(document.state);
    return result;
  };
}

/**
 * Validates and immediately applies an Assignment lifecycle action.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Assignment lifecycle action.
 * @param {object} input - Action-specific payload.
 * @returns {{assignment: string, action: string}} Mutated Assignment identity and action.
 */
export function applyAssignment(document, action, input) {
  return prepareAssignmentMutation(action, input)(document);
}

/**
 * Converts a transient role result into the minimum operational receipt.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {{assignment: string, result: object}} input - Assignment identity and role result envelope.
 * @param {object} [context={}] - Acceptance clock and optional Git-derived changed surface.
 * @returns {{assignment: string, result_status: string}} Assignment identity and accepted result status.
 */
export function applyResult(document, input, context = {}) {
  const assignment = itemById(document.blocks.assignments, input.assignment, 'assignment');
  ensure(
    assignment.status === 'in_progress',
    'result requires an in-progress assignment',
    'INVALID_TRANSITION',
  );
  const result = validateRoleResult(input.result, assignment.role);
  const attempt = itemById(document.state.attempts, assignment.current_attempt, 'attempt');
  ensure(attempt.status === 'in_progress' && attempt.contract_digest === document.state.contract.digest, 'result does not bind to the active contract attempt', 'INVALID_TRANSITION');
  const receipt = { status: result.status };
  if (assignment.role === 'development') {
    const reported = [...new Set(result.files.map(normalizedScope))].sort();
    if (result.status === 'completed') {
      ensure(Array.isArray(context.gitChangedSurface), 'Development completion requires Git-derived changed surface', 'INVALID_GIT_SCOPE');
      ensure(JSON.stringify(reported) === JSON.stringify(context.gitChangedSurface), 'Development result files do not equal the Git-derived changed surface', 'INVALID_GIT_SCOPE');
    }
    receipt.changed_surface = reported;
  }
  if (['architecture', 'development'].includes(assignment.role)) {
    receipt.votes = {
      test: { requires: result.requires_test, reason: result.test_reason },
      review: { requires: result.requires_review, reason: result.review_reason },
    };
  }
  if (['test', 'retest', 'review', 'rereview'].includes(assignment.role)) {
    receipt.passed = result.status === 'completed'
      && result.checks.length > 0
      && result.checks.every((check) => check.result === 'passed')
      && result.findings.every((finding) => finding.severity === 'none');
  }
  if (['test', 'retest', 'review', 'rereview'].includes(assignment.role)) {
    appendBoundedRecords(document.state, attempt, input.result, 'finding');
  }
  assignment.receipt = structuredClone(receipt);
  attempt.receipt = structuredClone(receipt);
  attempt.ended_at = (context.now ?? new Date()).toISOString();
  attempt.status = result.status === 'completed' ? 'completed' : 'blocked';
  attempt.blockers = result.status === 'completed' ? [] : [...result.blockers];
  for (const claim of document.state.claims.filter((entry) => entry.attempt_id === attempt.id && entry.status === 'active')) {
    claim.status = 'released'; claim.released_at = attempt.ended_at;
  }
  if (['partial', 'blocked'].includes(result.status)) {
    assignment.status = 'blocked';
    assignment.blockers = [...result.blockers];
  }
  refreshUsage(document.state);
  return { assignment: assignment.id, result_status: result.status };
}

/**
 * Reads and validates one dimension-specific boolean recommendation from a vote payload.
 *
 * @param {object} input - Vote payload containing Test and Review values and reasons.
 * @param {'test'|'review'} dimension - Dimension to project.
 * @returns {{requires: boolean, reason: string}} Validated dimension vote.
 */
function voteValue(input, dimension) {
  const key = dimension === 'test' ? 'requiresTest' : 'requiresReview';
  ensure(typeof input[key] === 'boolean', `${key} must be boolean`, 'INVALID_VOTE');
  const reasonKey = dimension === 'test' ? 'testReason' : 'reviewReason';
  boundedString(input[reasonKey], reasonKey);
  return { requires: input[key], reason: input[reasonKey] };
}

/**
 * Validates that a vote command uses a supported action.
 *
 * @param {string} action - Candidate vote action.
 * @returns {void} Returns for record or compute.
 */
function validateVoteMutation(action) {
  ensure(['record', 'compute'].includes(action), 'vote supports record or compute', 'INVALID_COMMAND');
}

/**
 * Records verified votes or computes final Test and Review decisions.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Validated record or compute action.
 * @param {object} input - Role vote or computation payload.
 * @returns {object} Recorded role identity or both computed verification decisions.
 */
function applyPreparedVote(document, action, input) {
  const verification = document.blocks.verification;
  ensure(verification?.votes && verification?.decisions, 'verification block is malformed', 'INVALID_VOTE');
  if (action === 'record') {
    ensure(
      ['architecture', 'development', 'main'].includes(input.role),
      'invalid voting role',
      'INVALID_VOTE',
    );
    const vote = { test: voteValue(input, 'test'), review: voteValue(input, 'review') };
    if (input.role === 'architecture') {
      ensure(typeof input.assignment === 'string' && input.assignment, 'architecture vote requires assignment', 'INVALID_VOTE');
      const assignment = itemById(document.blocks.assignments, input.assignment, 'assignment');
      ensure(
        assignment.role === 'architecture'
          && assignment.status === 'completed'
          && assignment.receipt?.status === 'completed',
        'architecture vote requires a completed Architecture result',
        'INVALID_VOTE',
      );
      const latestArchitecture = document.blocks.assignments
        .filter((entry) => entry.role === 'architecture'
          && entry.status === 'completed'
          && entry.receipt?.status === 'completed')
        .sort((left, right) => left.receipt.completed_order - right.receipt.completed_order)
        .at(-1);
      ensure(latestArchitecture === assignment, 'architecture vote must use the latest completed Architecture result', 'INVALID_VOTE');
      ensure(
        input.requiresTest === assignment.receipt.votes.test.requires
          && input.testReason === assignment.receipt.votes.test.reason
          && input.requiresReview === assignment.receipt.votes.review.requires
          && input.reviewReason === assignment.receipt.votes.review.reason,
        'architecture vote must exactly match the completed Architecture result',
        'INVALID_VOTE',
      );
      verification.votes.architecture = { assignment: assignment.id, ...vote, covered: input.covered !== false };
    } else if (input.role === 'main') {
      verification.votes.main = vote;
    } else {
      ensure(
        typeof input.assignment === 'string' && input.assignment,
        'development vote requires assignment',
        'INVALID_VOTE',
      );
      const assignment = itemById(document.blocks.assignments, input.assignment, 'assignment');
      ensure(
        assignment.role === 'development',
        'development vote assignment must be development',
        'INVALID_VOTE',
      );
      ensure(
        assignment.status === 'completed' && assignment.receipt?.status === 'completed',
        'development vote requires a completed Development result',
        'INVALID_VOTE',
      );
      ensure(
        input.requiresTest === assignment.receipt.votes.test.requires
          && input.testReason === assignment.receipt.votes.test.reason
          && input.requiresReview === assignment.receipt.votes.review.requires
          && input.reviewReason === assignment.receipt.votes.review.reason,
        'development vote must exactly match the completed Development result',
        'INVALID_VOTE',
      );
      verification.votes.development = verification.votes.development
        .filter((entry) => entry.assignment !== input.assignment);
      verification.votes.development.push({ assignment: input.assignment, ...vote });
    }
    verification.decisions = { test: null, review: null };
    return { vote: input.role };
  }
  const development = document.blocks.assignments
    .filter((assignment) => assignment.role === 'development');
  ensure(
    development.every((assignment) => assignment.status === 'completed'
      && assignment.receipt?.status === 'completed'),
    'vote computation requires every Development assignment to have a completed result',
    'INCOMPLETE_VOTE',
  );
  verification.decisions.test = computeVotes(verification, 'test', {
    developmentOccurred: development.length > 0,
  });
  verification.decisions.review = computeVotes(verification, 'review', {
    developmentOccurred: development.length > 0,
  });
  return { decisions: verification.decisions };
}

/**
 * Validates a vote action and returns a reusable document mutator.
 *
 * @param {string} action - Vote action.
 * @param {object} input - Vote payload captured by the closure.
 * @returns {(document: object) => object} Prepared vote mutator.
 */
export function prepareVoteMutation(action, input) {
  validateVoteMutation(action);
  return (document) => applyPreparedVote(document, action, input);
}

/**
 * Validates and immediately applies a verification vote action.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Vote action.
 * @param {object} input - Vote payload.
 * @returns {object} Recorded vote or computed decisions.
 */
export function applyVote(document, action, input) {
  return prepareVoteMutation(action, input)(document);
}

/**
 * Builds the minimal empty-history packet for one Assignment.
 *
 * @param {object} document - Work Item containing the Assignment and permitted context.
 * @param {string} assignmentId - Assignment identity to package.
 * @returns {object} Bounded role packet with exact pointers, capabilities, and return contract.
 */
export function makePacket(document, assignmentId) {
  const assignment = itemById(document.blocks.assignments, assignmentId, 'assignment');
  ensure(assignment.status === 'in_progress', 'packet requires an in-progress assignment', 'INVALID_TRANSITION');
  assertCapabilities(assignment.capabilities);
  assertContractNarrowing(document.state.contract, assignment);
  const attempt = itemById(document.state.attempts, assignment.current_attempt, 'attempt');
  ensure(attempt.status === 'in_progress' && attempt.contract_digest === document.state.contract.digest
    && attempt.gates.every((gate) => gate.status === 'approved'), 'attempt is not dispatchable', 'APPROVAL_REQUIRED');
  if (assignment.role === 'development') {
    assertDevelopmentClaims(assignment);
  }
  assertActiveClaimBinding(document.state, assignment, attempt);
  const packet = {
    assignment_id: assignment.id,
    attempt_id: attempt.id,
    contract: structuredClone(document.state.contract),
    contract_digest: assignment.contract_digest,
    role: assignment.role,
    objective: assignment.objective,
    success_criteria: assignment.successCriteria,
    allowed_read: assignment.read,
    allowed_write: assignment.write,
    confirmed_decisions: assignment.decisions,
    capabilities: {
      required: assignment.capabilities.required,
      available: assignment.capabilities.available,
      unavailable: assignment.capabilities.unavailable,
    },
    topology: structuredClone(assignment.topology),
    claims: document.state.claims.filter((claim) => claim.attempt_id === attempt.id && claim.status === 'active').map((claim) => ({ ...claim })),
    gates: attempt.gates.map((gate) => ({ ...gate })),
    return_contract: {
      status: 'completed | partial | blocked',
      summary_max_items: 3,
      fields: [...resultKeysForRole(assignment.role)],
    },
    spawn: { fork_turns: 'none' },
  };
  // Packets expose only the context each role needs, keeping task handoff bounded.
  if (['development', 'architecture'].includes(assignment.role)) {
    packet.work_context = {
      goal: document.blocks.goal,
      done_conditions: document.blocks.success_criteria,
    };
  }
  if (['test', 'retest', 'review', 'rereview'].includes(assignment.role)) {
    const developmentResults = document.blocks.assignments
      .filter((item) => item.role === 'development'
        && item.status === 'completed'
        && item.receipt?.status === 'completed')
      .map((item) => item.receipt);
    packet.verification_context = {
      changed_surface: [...new Set(developmentResults.flatMap((receipt) => receipt.changed_surface ?? []))].sort(),
      decisions: document.blocks.verification.decisions,
    };
    if (['review', 'rereview'].includes(assignment.role)) {
      packet.work_context = { goal: document.blocks.goal };
      const completedTests = document.blocks.assignments
        .filter((item) => ['test', 'retest'].includes(item.role)
          && item.status === 'completed'
          && item.receipt?.status === 'completed');
      packet.verification_context.test_passed = completedTests.length
        ? hasCompletedEvidence(document, 'test')
        : null;
    }
  }
  return packet;
}

/**
 * Projects the smallest state summary needed to resume one Work Item.
 *
 * @param {object} document - Work Item document to summarize.
 * @param {string} work - Work Item reference included in the handoff.
 * @returns {object} Compact goal, state, active work, blockers, and next action.
 */
export function makeHandoff(document, work) {
  return {
    work,
    goal: document.blocks.goal,
    status: document.frontmatter.status,
    stage: document.frontmatter.stage,
    progress: document.blocks.current_progress,
    in_progress_todo: document.blocks.todo
      .find((item) => item.status === 'in_progress') ?? null,
    active_assignments: document.blocks.assignments
      .filter((item) => ['in_progress', 'blocked'].includes(item.status))
      .map(({ id, role, status, objective, agentId, blockers }) => ({
        id,
        role,
        status,
        objective,
        agentId,
        blockers: blockers ?? [],
      })),
    blockers: [...document.blocks.todo, ...document.blocks.assignments]
      .filter((item) => item.status === 'blocked')
      .flatMap((item) => item.blockers ?? []),
    next_action: document.blocks.result.next_action,
  };
}

/**
 * Scores a Work Item against a normalized lightweight search query.
 *
 * @param {object} document - Work Item document whose metadata is searchable.
 * @param {string} query - Lowercase query text.
 * @returns {{score: number, reason: string}|null} Ranked match metadata, or `null` when nothing matches.
 */
export function matchWork(document, query) {
  const frontmatter = document.frontmatter;
  if (frontmatter.id.toLowerCase() === query || frontmatter.name.toLowerCase() === query) {
    return { score: 400, reason: 'exact id/name' };
  }
  if (frontmatter.keywords.some((keyword) => keyword.toLowerCase() === query
    || keyword.toLowerCase().includes(query))) {
    return { score: 300, reason: 'keyword' };
  }
  if (frontmatter.summary.toLowerCase().includes(query)
    || frontmatter.name.toLowerCase().includes(query)
    || frontmatter.id.toLowerCase().includes(query)) {
    return { score: 200, reason: 'summary/name' };
  }
  return null;
}
