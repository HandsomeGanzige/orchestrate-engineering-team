import {
  ensure,
  RESULT_KEYS,
  ROLES,
  STAGES,
  STATUSES,
} from './workflow-contract.mjs';
import {
  completionIssues,
  computeVotes,
  projectCompletedAssignmentVote,
  validateRoleResult,
} from './verification.mjs';
import {
  boundedString,
  normalizedMaterialPath,
  normalizeStrings,
  normalizedScope,
  scalar,
} from './value-policy.mjs';

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
  const allowed = new Set(['status', 'stage', 'progress', 'result', 'nextAction', 'completeTodo']);
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
  }
  if (input.result !== undefined) {
    ensure(
      typeof input.result === 'string' && input.result.length <= 2000,
      'result must be a short string',
      'INVALID_INPUT',
    );
    document.blocks.result.summary = [input.result];
  }
  if (input.nextAction !== undefined) {
    ensure(
      typeof input.nextAction === 'string' && input.nextAction.length <= 500,
      'nextAction must be a short string',
      'INVALID_INPUT',
    );
    document.blocks.result.next_action = input.nextAction;
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
  ensure(
    typeof input.id === 'string'
      && input.id
      && typeof input.summary === 'string'
      && input.summary,
    'decision id and summary are required',
    'INVALID_INPUT',
  );
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
  document.blocks.confirmed_decisions.push({
    id: input.id,
    summary: input.summary,
    evidence: normalizeStrings(input.evidence ?? [], 'evidence', { max: 20 }),
  });
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
    ensure(
      typeof input.id === 'string' && /^[a-z][a-z0-9-]*$/.test(input.id),
      'todo id is invalid',
      'INVALID_INPUT',
    );
    ensure(typeof input.text === 'string' && input.text.trim(), 'todo text is required', 'INVALID_INPUT');
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
    candidate.sharedInterfaceStable && active.sharedInterfaceStable,
    'parallel development requires a stable shared interface',
    'PARALLEL_CONFLICT',
  );
  ensure(
    !candidate.touchesGlobal && !active.touchesGlobal,
    'parallel development cannot modify global or generated files',
    'PARALLEL_CONFLICT',
  );
  ensure(
    candidate.integrator && candidate.integrator === active.integrator,
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
 * @returns {{assignment: string, action: string}} Mutated Assignment identity and action.
 */
function applyPreparedAssignment(document, action, input) {
  if (action === 'add') {
    ensure(
      typeof input.id === 'string' && /^[a-z][a-z0-9-]*$/.test(input.id),
      'assignment id is invalid',
      'INVALID_INPUT',
    );
    ensure(ROLES.has(input.role), 'invalid assignment role', 'INVALID_INPUT');
    ensureUnique(document.blocks.assignments, input.id, 'assignment');
    const assignment = {
      id: input.id,
      role: input.role,
      status: 'pending',
      objective: scalar(input.objective),
      successCriteria: normalizeStrings(input.successCriteria ?? [], 'successCriteria', { max: 30 }),
      read: normalizeStrings(input.read ?? [], 'read', { max: 100 }),
      write: normalizeStrings(input.write ?? [], 'write', { max: 100 }).map(normalizedScope),
      decisions: normalizeStrings(input.decisions ?? [], 'decisions', { max: 30 }),
      capabilities: {
        required: normalizeStrings(
          input.requiredCapabilities ?? input.capabilities?.required ?? [],
          'requiredCapabilities',
          { max: 30 },
        ),
        available: normalizeStrings(
          input.availableCapabilities ?? input.capabilities?.available ?? [],
          'availableCapabilities',
          { max: 30 },
        ),
        unavailable: normalizeStrings(
          input.unavailableCapabilities ?? input.capabilities?.unavailable ?? [],
          'unavailableCapabilities',
          { max: 30 },
        ),
      },
      agentId: scalar(input.agentId),
      dependsOn: normalizeStrings(input.dependsOn ?? [], 'dependsOn', { max: 30 }),
      sharedInterfaceStable: input.sharedInterfaceStable !== false,
      touchesGlobal: input.touchesGlobal === true,
      integrator: scalar(input.integrator),
      result: null,
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
      ensure(
        /^[a-z][a-z0-9-]*$/.test(dependency),
        `invalid assignment dependency: ${dependency}`,
        'INVALID_INPUT',
      );
      itemById(document.blocks.assignments, dependency, 'assignment prerequisite');
    }
    document.blocks.assignments.push(assignment);
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
    if (assignment.role === 'development') {
      const activeAssignments = document.blocks.assignments.filter((entry) => entry.role === 'development'
        && entry.status === 'in_progress'
        && entry.id !== assignment.id);
      for (const active of activeAssignments) assertParallelSafe(assignment, active);
    }
    assignment.status = 'in_progress';
    assignment.blockers = [];
    if (assignment.result?.status === 'blocked') assignment.result = null;
    if (input.agentId !== undefined) assignment.agentId = scalar(input.agentId);
  } else if (action === 'complete') {
    ensure(
      assignment.status === 'in_progress' && assignment.result?.status === 'completed',
      'assignment requires a completed role result before completion',
      'INVALID_TRANSITION',
    );
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
  }
  return { assignment: input.id, action };
}

/**
 * Validates an Assignment action and returns a reusable document mutator.
 *
 * @param {string} action - Assignment lifecycle action.
 * @param {object} input - Action payload captured by the closure.
 * @returns {(document: object) => {assignment: string, action: string}} Prepared Assignment mutator.
 */
export function prepareAssignmentMutation(action, input) {
  validateAssignmentMutation(action);
  return (document) => applyPreparedAssignment(document, action, input);
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
 * Attaches a validated compact role result to an in-progress Assignment.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {{assignment: string, result: object}} input - Assignment identity and role result envelope.
 * @returns {{assignment: string, result_status: string}} Assignment identity and accepted result status.
 */
export function applyResult(document, input) {
  const assignment = itemById(document.blocks.assignments, input.assignment, 'assignment');
  ensure(
    assignment.status === 'in_progress',
    'result requires an in-progress assignment',
    'INVALID_TRANSITION',
  );
  const result = validateRoleResult(input.result, assignment.role);
  assignment.result = structuredClone(result);
  if (result.status === 'blocked') assignment.status = 'blocked';
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
      verification.votes.architecture = { ...vote, covered: input.covered !== false };
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
        assignment.status === 'completed' && assignment.result?.status === 'completed',
        'development vote requires a completed Development result',
        'INVALID_VOTE',
      );
      ensure(
        input.requiresTest === assignment.result.requires_test
          && input.testReason === assignment.result.test_reason
          && input.requiresReview === assignment.result.requires_review
          && input.reviewReason === assignment.result.review_reason,
        'development vote must exactly match the completed Development result',
        'INVALID_VOTE',
      );
      verification.votes.development = verification.votes.development
        .filter((entry) => entry.assignment !== input.assignment);
      verification.votes.development.push({ assignment: input.assignment, ...vote });
    }
    return { vote: input.role };
  }
  const development = document.blocks.assignments
    .filter((assignment) => assignment.role === 'development');
  ensure(
    development.every((assignment) => assignment.status === 'completed'
      && assignment.result?.status === 'completed'),
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
 * Validates that a Material command uses the supported add action.
 *
 * @param {string} action - Candidate Material action.
 * @returns {void} Returns only for `add`.
 */
function validateMaterialMutation(action) {
  ensure(action === 'add', 'material supports only add', 'INVALID_COMMAND');
}

/**
 * Registers an already validated, role-scoped Material in a Work Item.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {object} input - Role, path, summary, and purpose for the Material.
 * @returns {{material: string}} Canonical registered Material path.
 */
function applyPreparedMaterial(document, input) {
  const relative = normalizedMaterialPath(input.role, input.path);
  boundedString(input.summary, 'material summary');
  boundedString(input.purpose, 'material purpose');
  ensureUnique(document.blocks.materials, relative, 'material');
  document.blocks.materials.push({
    id: relative,
    role: input.role,
    path: relative,
    summary: input.summary,
    purpose: input.purpose,
  });
  return { material: relative };
}

/**
 * Validates a Material action and returns a reusable document mutator.
 *
 * @param {string} action - Material action, currently `add`.
 * @param {object} input - Material payload captured by the closure.
 * @returns {(document: object) => {material: string}} Prepared Material mutator.
 */
export function prepareMaterialMutation(action, input) {
  validateMaterialMutation(action);
  return (document) => applyPreparedMaterial(document, input);
}

/**
 * Validates and immediately registers a role-scoped Material.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {string} action - Material action.
 * @param {object} input - Material payload.
 * @returns {{material: string}} Canonical registered Material path.
 */
export function applyMaterial(document, action, input) {
  return prepareMaterialMutation(action, input)(document);
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
  const packet = {
    assignment_id: assignment.id,
    role: assignment.role,
    objective: assignment.objective,
    success_criteria: assignment.successCriteria,
    allowed_read: assignment.read,
    allowed_write: assignment.write,
    confirmed_decisions: assignment.decisions,
    material_pointers: document.blocks.materials
      .filter((material) => assignment.read.includes(material.path))
      .map(({ path, summary, purpose }) => ({ path, summary, purpose })),
    capabilities: {
      required: assignment.capabilities.required,
      available: assignment.capabilities.available,
      unavailable: assignment.capabilities.unavailable,
    },
    return_contract: {
      status: 'completed | partial | blocked',
      summary_max_items: 3,
      fields: [...RESULT_KEYS],
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
        && item.result?.status === 'completed')
      .map((item) => item.result);
    packet.verification_context = {
      changed_surface: [...new Set(developmentResults.flatMap((result) => result.files))].sort(),
      development_summary: developmentResults.flatMap((result) => result.summary).slice(0, 3),
      decisions: document.blocks.verification.decisions,
    };
    if (['review', 'rereview'].includes(assignment.role)) {
      packet.work_context = { goal: document.blocks.goal };
      const latestTest = document.blocks.assignments
        .filter((item) => ['test', 'retest'].includes(item.role)
          && item.status === 'completed'
          && item.result?.status === 'completed')
        .at(-1);
      packet.verification_context.test_summary = latestTest
        ? latestTest.result.summary.slice(0, 3)
        : [];
    }
  }
  return packet;
}

/**
 * Projects the smallest state summary needed to resume one Work Item.
 *
 * @param {object} document - Work Item document to summarize.
 * @param {string} work - Work Item reference included in the handoff.
 * @returns {object} Compact goal, state, active work, blockers, Materials, and next action.
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
      .flatMap((item) => item.blockers ?? item.result?.blockers ?? []),
    key_materials: document.blocks.materials
      .map(({ path, summary, purpose }) => ({ path, summary, purpose })),
    next_action: document.blocks.result.next_action,
  };
}

/**
 * Scores a Work Item against a normalized lightweight search query.
 *
 * @param {object} document - Work Item document whose metadata and Material summaries are searchable.
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
  if (document.blocks.materials.some((material) => material.summary.toLowerCase().includes(query))) {
    return { score: 100, reason: 'material summary' };
  }
  return null;
}
