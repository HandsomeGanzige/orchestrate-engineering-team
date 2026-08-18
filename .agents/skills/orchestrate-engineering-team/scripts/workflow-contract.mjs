export const LEASE_MINUTES = 60;
export const MAX_LEASE_MINUTES = 24 * 60;

export const STATUSES = new Set(['active', 'paused', 'blocked', 'completed', 'cancelled']);
export const STAGES = new Set(['align', 'design', 'develop', 'verify', 'close']);
export const TYPES = new Set(['delivery', 'exploration']);
export const ROLES = new Set(['architecture', 'development', 'test', 'review', 'retest', 'rereview']);
export const ASSIGNMENT_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked']);
export const TODO_STATUSES = ASSIGNMENT_STATUSES;
export const FORBIDDEN_IDS = new Set([
  ...ROLES,
  ...STAGES,
  'implementation',
]);
export const DEVELOPMENT_RESULT_KEYS = new Set([
  'status',
  'summary',
  'artifacts',
  'files',
  'checks',
  'requires_test',
  'test_reason',
  'requires_review',
  'review_reason',
  'blockers',
]);

export const ARCHITECTURE_RESULT_KEYS = new Set([
  ...DEVELOPMENT_RESULT_KEYS,
  'decision_proposals',
]);

export const VERIFICATION_RESULT_KEYS = new Set([
  'status',
  'summary',
  'files',
  'checks',
  'evidence_method',
  'findings',
  'blockers',
]);

/**
 * Returns the exact immutable result field set for one role.
 * @param {string} role - Assignment role selecting the narrowed schema.
 * @returns {Set<string>} Exact allowed result fields.
 */
export function resultKeysForRole(role) {
  if (role === 'architecture') return ARCHITECTURE_RESULT_KEYS;
  if (role === 'development') return DEVELOPMENT_RESULT_KEYS;
  return VERIFICATION_RESULT_KEYS;
}

/** Stable public error-code allowlist used by every descriptor-generated CLI contract. */
export const ERROR_CODES = Object.freeze([
  'ALREADY_EXISTS', 'APPROVAL_REQUIRED', 'ASSIGNMENT_DIRECTORY', 'ATOMIC_FAILURE',
  'CAPABILITY_UNAVAILABLE', 'CLAIM_CONFLICT', 'CONTRACT_WIDENING', 'DIRTY_GIT_SCOPE',
  'HISTORY_READ_ONLY', 'INCOMPLETE_CHILD_PROJECTION', 'INCOMPLETE_DESCENDANT',
  'INCOMPLETE_RESULT', 'INCOMPLETE_VOTE', 'INCOMPLETE_WORK', 'INELIGIBLE_CHILD',
  'INTERNAL_ERROR', 'INVALID_ARCHIVE', 'INVALID_CHILD_LINK', 'INVALID_CLAIM',
  'INVALID_COMMAND', 'INVALID_CONTRACT', 'INVALID_DOCUMENT', 'INVALID_GIT_SCOPE',
  'INVALID_INPUT', 'INVALID_LIMITS', 'INVALID_PARENT', 'INVALID_RESULT',
  'INVALID_SCOPE', 'INVALID_SUCCESS_EVIDENCE', 'INVALID_TOPOLOGY', 'INVALID_TRANSITION',
  'INVALID_USAGE', 'INVALID_VOTE', 'INVALID_VOTE_DECISION', 'INVALID_WORKSPACE',
  'LEASE_CONFLICT', 'LEASE_EXPIRED', 'LIMIT_EXCEEDED', 'LOCKED',
  'MISSING_DEVELOPMENT_EVIDENCE', 'MISSING_SUCCESS_EVIDENCE',
  'MISSING_VERIFICATION_DECISION', 'MISSING_VERIFICATION_EVIDENCE', 'NOT_FOUND',
  'ORPHAN_CHILD', 'OWNER_MISMATCH', 'OWNER_REQUIRED', 'PARALLEL_CONFLICT',
  'TODO_CONFLICT', 'UNARCHIVED_COMPLETION', 'UNRECONCILED_ASSIGNMENT',
  'UNRECONCILED_TODO', 'UNRESOLVED_BLOCKERS', 'WORKFLOW_ERROR', 'WORK_NOT_FOUND',
]);

export class WorkflowError extends Error {
  /**
   * Creates a workflow-domain error with a stable machine-readable code.
   *
   * @param {string} message - Human-readable failure description.
   * @param {string} [code='WORKFLOW_ERROR'] - Stable code consumed by the CLI and tests.
   */
  constructor(message, code = 'WORKFLOW_ERROR') {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

/**
 * Stops workflow processing by throwing a typed domain error.
 *
 * @param {string} message - Human-readable failure description.
 * @param {string} code - Stable machine-readable error code.
 * @returns {never} This function never returns.
 */
export function fail(message, code) {
  throw new WorkflowError(message, code);
}

/**
 * Enforces a workflow invariant and raises a typed error when it is false.
 *
 * @param {unknown} condition - Truthy value indicating that the invariant holds.
 * @param {string} message - Human-readable failure description.
 * @param {string} code - Stable machine-readable error code.
 * @returns {void} Returns normally only when the condition is truthy.
 */
export function ensure(condition, message, code) {
  if (!condition) fail(message, code);
}
