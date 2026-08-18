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
export const RESULT_KEYS = new Set([
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
