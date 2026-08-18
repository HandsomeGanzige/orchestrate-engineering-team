import { createHash } from 'node:crypto';

import { ensure } from './workflow-contract.mjs';
import { boundedString, normalizeStrings, normalizedScope, scalar } from './value-policy.mjs';

export const STATE_VERSION = 2;
export const CONTRACT_SCHEMA = 'workflow-global-contract-v1';
export const SUPPORTED_LIMITS = Object.freeze({
  assignments: 32,
  active_assignments: 4,
  total_attempts: 64,
  attempts_per_assignment: 3,
  claims: 128,
  findings: 64,
  conflicts: 32,
});

const CAPABILITY_KEYS = ['required', 'available', 'unavailable'];
const TOPOLOGY_KEYS = ['mode', 'group', 'independent', 'shared_interface_stable', 'touches_global', 'integrator'];

/**
 * Returns a recursively key-sorted JSON byte representation.
 * @param {unknown} value - JSON-compatible value to canonicalize.
 * @returns {string} Canonical JSON bytes represented as a string.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Computes the contract digest over every immutable field except the digest itself.
 * @param {object} contract - Immutable global contract.
 * @returns {string} Lowercase SHA-256 digest.
 */
export function contractDigest(contract) {
  const unsigned = { ...contract };
  delete unsigned.digest;
  return createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

/**
 * Normalizes a bounded contract-scope collection.
 * @param {unknown} value - Candidate scope collection.
 * @param {string} label - Validation label.
 * @param {string[]} [fallback=[]] - Default scopes when no value is supplied.
 * @returns {string[]} Canonical contract scopes.
 */
function contractScopes(value, label, fallback = []) {
  return normalizeStrings(value ?? fallback, label, { max: 100 }).map((entry) => (
    entry === '**' ? entry : normalizedScope(entry)
  ));
}

/**
 * Creates the immutable root contract or clones a parent's bytes exactly.
 * @param {object} input - Work Item creation input.
 * @param {object|null} [inherited=null] - Parent contract inherited by a child.
 * @returns {object} Immutable global contract with canonical digest.
 */
export function newContract(input, inherited = null) {
  if (inherited) return structuredClone(inherited);
  const supplied = input.contract ?? {};
  const objective = scalar(supplied.objective ?? input.goal).trim();
  const doneConditions = normalizeStrings(
    supplied.done_conditions ?? input.doneConditions ?? input.successCriteria ?? [],
    'contract.done_conditions',
    { min: 1, max: 100 },
  );
  const contract = {
    schema: supplied.schema ?? CONTRACT_SCHEMA,
    root_work_id: supplied.root_work_id ?? input.id,
    objective,
    done_conditions: doneConditions,
    constraints: normalizeStrings(supplied.constraints ?? input.constraints ?? [], 'contract.constraints', { max: 100 }),
    read_scope: contractScopes(supplied.read_scope ?? input.readScope, 'contract.read_scope', ['**']),
    write_scope: contractScopes(supplied.write_scope ?? input.writeScope, 'contract.write_scope', ['**']),
    forbidden_changes: contractScopes(supplied.forbidden_changes ?? input.forbiddenChanges, 'contract.forbidden_changes'),
    enforcement: supplied.enforcement ?? 'skill-local',
    digest: '',
  };
  ensure(objective, 'contract objective is required', 'INVALID_CONTRACT');
  ensure(contract.root_work_id === input.id, 'root contract identity must match the Work Item', 'INVALID_CONTRACT');
  contract.digest = contractDigest(contract);
  if (supplied.digest !== undefined) ensure(supplied.digest === contract.digest, 'contract digest does not match canonical bytes', 'INVALID_CONTRACT');
  return contract;
}

/**
 * Reports whether a project-relative pointer is contained by a declared scope.
 * @param {string} scope - Canonical declared scope.
 * @param {string} pointer - Canonical project-relative pointer.
 * @returns {boolean} Whether the scope contains the pointer.
 */
export function scopeContains(scope, pointer) {
  if (scope === '**') return true;
  return pointer === scope || pointer.startsWith(`${scope}/`);
}

/**
 * Validates an Assignment's permissions as a narrowing of the immutable contract.
 * @param {object} contract - Immutable global contract.
 * @param {object} assignment - Candidate narrowed Assignment.
 * @returns {void} Returns after every declared scope is valid.
 */
export function assertContractNarrowing(contract, assignment) {
  for (const pointer of assignment.read) {
    ensure(pointer === normalizedScope(pointer), `read scope is not canonical: ${pointer}`, 'INVALID_SCOPE');
    ensure(contract.read_scope.some((scope) => scopeContains(scope, pointer)), `read scope widens the global contract: ${pointer}`, 'CONTRACT_WIDENING');
  }
  for (const pointer of assignment.write) {
    ensure(pointer === normalizedScope(pointer), `write scope is not canonical: ${pointer}`, 'INVALID_SCOPE');
    ensure(contract.write_scope.some((scope) => scopeContains(scope, pointer)), `write scope widens the global contract: ${pointer}`, 'CONTRACT_WIDENING');
    ensure(!contract.forbidden_changes.some((scope) => scopeContains(scope, pointer) || scopeContains(pointer, scope)), `write scope intersects a forbidden change: ${pointer}`, 'CONTRACT_WIDENING');
  }
}

/**
 * Normalizes and fail-closes capability availability.
 * @param {object} input - Assignment payload containing capability declarations.
 * @returns {object} Exact required, available, and unavailable capability sets.
 */
export function assignmentCapabilities(input) {
  const capabilities = {
    required: normalizeStrings(input.requiredCapabilities ?? input.capabilities?.required ?? [], 'requiredCapabilities', { max: 30 }),
    available: normalizeStrings(input.availableCapabilities ?? input.capabilities?.available ?? [], 'availableCapabilities', { max: 30 }),
    unavailable: normalizeStrings(input.unavailableCapabilities ?? input.capabilities?.unavailable ?? [], 'unavailableCapabilities', { max: 30 }),
  };
  assertCapabilities(capabilities);
  return capabilities;
}

/**
 * Validates exact capability fields and required availability.
 * @param {object} capabilities - Normalized capability declaration.
 * @returns {void} Returns after capability availability is proven.
 */
export function assertCapabilities(capabilities) {
  ensure(capabilities && Object.keys(capabilities).length === CAPABILITY_KEYS.length && CAPABILITY_KEYS.every((key) => Object.hasOwn(capabilities, key)), 'capabilities have invalid fields', 'CAPABILITY_UNAVAILABLE');
  for (const key of CAPABILITY_KEYS) ensure(Array.isArray(capabilities[key]) && new Set(capabilities[key]).size === capabilities[key].length, `capabilities.${key} must be a unique array`, 'CAPABILITY_UNAVAILABLE');
  ensure(capabilities.required.every((item) => capabilities.available.includes(item)), 'required capability availability is missing', 'CAPABILITY_UNAVAILABLE');
  ensure(capabilities.required.every((item) => !capabilities.unavailable.includes(item)), 'required capability is unavailable', 'CAPABILITY_UNAVAILABLE');
  ensure(capabilities.available.every((item) => !capabilities.unavailable.includes(item)), 'capability cannot be both available and unavailable', 'CAPABILITY_UNAVAILABLE');
}

/**
 * Builds the explicit dispatch topology from Assignment input.
 * @param {object} input - Assignment payload containing topology declarations.
 * @returns {object} Exact serial or parallel topology.
 */
export function assignmentTopology(input) {
  const supplied = input.topology ?? {};
  const topology = {
    mode: supplied.mode ?? input.topologyMode ?? 'serial',
    group: scalar(supplied.group ?? input.topologyGroup),
    independent: supplied.independent ?? input.independent ?? true,
    shared_interface_stable: supplied.shared_interface_stable ?? input.sharedInterfaceStable ?? true,
    touches_global: supplied.touches_global ?? input.touchesGlobal ?? false,
    integrator: scalar(supplied.integrator ?? input.integrator),
  };
  assertTopology(topology);
  return topology;
}

/**
 * Validates exact topology fields and parallel-safety requirements.
 * @param {object} topology - Normalized dispatch topology.
 * @returns {void} Returns after topology validation succeeds.
 */
export function assertTopology(topology) {
  ensure(topology && Object.keys(topology).length === TOPOLOGY_KEYS.length && TOPOLOGY_KEYS.every((key) => Object.hasOwn(topology, key)), 'topology has invalid fields', 'INVALID_TOPOLOGY');
  ensure(['serial', 'parallel'].includes(topology.mode), 'unsupported topology mode', 'INVALID_TOPOLOGY');
  ensure(typeof topology.group === 'string' && typeof topology.integrator === 'string', 'topology group or integrator is invalid', 'INVALID_TOPOLOGY');
  ensure(['independent', 'shared_interface_stable', 'touches_global'].every((key) => typeof topology[key] === 'boolean'), 'topology booleans are invalid', 'INVALID_TOPOLOGY');
  if (topology.mode === 'parallel') {
    ensure(topology.group && topology.independent && topology.shared_interface_stable && !topology.touches_global && topology.integrator, 'parallel topology is not safe for dispatch', 'INVALID_TOPOLOGY');
  } else ensure(!topology.group, 'serial topology cannot name a parallel group', 'INVALID_TOPOLOGY');
}

/**
 * Creates exact resource-claim declarations.
 * @param {object} input - Assignment payload containing optional claim declarations.
 * @param {string} role - Assignment role.
 * @param {string[]} write - Canonical Assignment write scopes.
 * @returns {object[]} Exact claim specifications.
 */
export function assignmentClaimSpecs(input, role, write) {
  const supplied = input.claim_specs ?? input.claimSpecs;
  const values = supplied ?? (role === 'development' ? write.map((key) => ({ kind: 'path', key, mode: 'exclusive' })) : []);
  ensure(Array.isArray(values) && values.length <= 100, 'claim_specs must be a bounded array', 'INVALID_CLAIM');
  return values.map((entry) => {
    ensure(entry && typeof entry === 'object' && !Array.isArray(entry), 'claim_spec must be an object', 'INVALID_CLAIM');
    const claim = { kind: entry.kind, key: entry.kind === 'path' ? normalizedScope(entry.key) : scalar(entry.key), mode: entry.mode };
    ensure(['path', 'resource', 'global'].includes(claim.kind) && claim.key && ['exclusive', 'shared'].includes(claim.mode), 'claim_spec is invalid', 'INVALID_CLAIM');
    return claim;
  });
}

/**
 * Ensures Development scopes are protected by exact exclusive path claims.
 * @param {object} assignment - Development or non-Development Assignment.
 * @returns {void} Returns after required Development claims are present.
 */
export function assertDevelopmentClaims(assignment) {
  if (assignment.role !== 'development') return;
  ensure(assignment.write.length > 0, 'Development requires a declared write scope', 'INVALID_SCOPE');
  for (const pointer of assignment.write) {
    ensure(assignment.claim_specs.some((claim) => claim.kind === 'path' && claim.mode === 'exclusive' && claim.key === pointer), `Development write scope lacks an exclusive claim: ${pointer}`, 'INVALID_CLAIM');
  }
}

/**
 * Detects live claim conflicts, including ancestor-overlapping paths.
 * @param {object} left - First persisted claim.
 * @param {object} right - Second persisted claim.
 * @returns {boolean} Whether the active claims conflict.
 */
export function claimsConflict(left, right) {
  if (left.status !== 'active' || right.status !== 'active') return false;
  if (left.kind !== right.kind) return false;
  if (left.mode === 'shared' && right.mode === 'shared') return false;
  if (left.kind === 'path') return scopeContains(left.key, right.key) || scopeContains(right.key, left.key);
  return left.key === right.key;
}

/**
 * Requires active persisted claims to equal one Assignment's declarations.
 * @param {object} state - Persisted workflow state.
 * @param {object} assignment - Assignment owning the claims.
 * @param {object} attempt - Active Assignment attempt.
 * @returns {void} Returns after exact claim binding is proven.
 */
export function assertActiveClaimBinding(state, assignment, attempt) {
  const actual = state.claims
    .filter((claim) => claim.attempt_id === attempt.id && claim.status === 'active')
    .map(({ kind, key, mode }) => canonicalJson({ kind, key, mode }))
    .sort();
  const expected = assignment.claim_specs.map((claim) => canonicalJson(claim)).sort();
  ensure(canonicalJson(actual) === canonicalJson(expected), `active claims do not match assignment claim_specs: ${assignment.id}`, 'INVALID_CLAIM');
}

/**
 * Converts approved gate evidence into a bounded persisted form.
 * @param {unknown} value - Candidate gate approvals.
 * @param {Date} now - Default approval clock.
 * @returns {object[]} Validated approved gates.
 */
export function approvedGates(value, now) {
  ensure(Array.isArray(value ?? []) && (value ?? []).length <= 20, 'gates must be a bounded array', 'APPROVAL_REQUIRED');
  return (value ?? []).map((entry) => {
    ensure(entry && typeof entry === 'object' && !Array.isArray(entry), 'gate approval must be an object', 'APPROVAL_REQUIRED');
    const gate = {
      id: scalar(entry.id),
      status: entry.status,
      approved_by: scalar(entry.approved_by ?? entry.approvedBy),
      approved_at: entry.approved_at ?? entry.approvedAt ?? now.toISOString(),
    };
    ensure(gate.id && gate.status === 'approved' && gate.approved_by, 'gate is not approved', 'APPROVAL_REQUIRED');
    ensure(new Date(gate.approved_at).toISOString() === gate.approved_at, 'gate approval timestamp is invalid', 'APPROVAL_REQUIRED');
    return gate;
  });
}

/**
 * Produces exact aggregate counters that must match persisted usage.
 * @param {object} state - Persisted workflow state.
 * @returns {object} Aggregate graph and evidence counters.
 */
export function aggregateUsage(state) {
  return {
    assignments: state.assignments.length,
    active_assignments: state.assignments.filter((entry) => entry.status === 'in_progress').length,
    total_attempts: state.attempts.length,
    claims: state.claims.length,
    findings: state.findings.length,
    conflicts: state.conflicts.length,
  };
}

/**
 * Refreshes persisted usage from exact aggregate counters.
 * @param {object} state - Mutable persisted workflow state.
 * @returns {object} Refreshed usage counters.
 */
export function refreshUsage(state) {
  state.usage = aggregateUsage(state);
  return state.usage;
}

/**
 * Validates supported limits and exact aggregate usage.
 * @param {object} state - Persisted workflow state.
 * @returns {void} Returns after all configured limits are satisfied.
 */
export function assertWithinLimits(state) {
  const actual = aggregateUsage(state);
  ensure(canonicalJson(state.limits) === canonicalJson(SUPPORTED_LIMITS), 'unsupported workflow limits', 'INVALID_LIMITS');
  ensure(canonicalJson(state.usage) === canonicalJson(actual), 'aggregate usage counters do not match state', 'INVALID_USAGE');
  for (const [key, value] of Object.entries(actual)) ensure(value <= state.limits[key], `workflow limit exceeded: ${key}`, 'LIMIT_EXCEEDED');
  const attempts = new Map();
  for (const attempt of state.attempts) attempts.set(attempt.assignment_id, (attempts.get(attempt.assignment_id) ?? 0) + 1);
  for (const [assignment, count] of attempts) ensure(count <= state.limits.attempts_per_assignment, `attempt limit exceeded for ${assignment}`, 'LIMIT_EXCEEDED');
}

/**
 * Persists bounded summaries and canonical pointers from role output.
 * @param {object} state - Mutable persisted workflow state.
 * @param {object} attempt - Attempt producing the records.
 * @param {object} input - Validated role result.
 * @param {'finding'|'conflict'} kind - Record kind to append.
 * @returns {void} Appends validated bounded records in place.
 */
export function appendBoundedRecords(state, attempt, input, kind) {
  const plural = kind === 'finding' ? 'findings' : 'conflicts';
  const values = input?.[plural] ?? [];
  ensure(Array.isArray(values), `${plural} must be an array`, 'INVALID_RESULT');
  const remaining = state.limits[plural] - state[plural].length;
  ensure(values.length <= remaining, `${plural} limit exceeded`, 'LIMIT_EXCEEDED');
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    ensure(entry && typeof entry === 'object' && !Array.isArray(entry), `${kind} must be an object`, 'INVALID_RESULT');
    state[plural].push({
      id: scalar(entry.id) || `${attempt.id}-${kind}-${state[plural].length + 1}`,
      assignment_id: attempt.assignment_id,
      attempt_id: attempt.id,
      summary: boundedString(entry.summary, `${kind}.summary`, 500),
      pointers: normalizeStrings(entry.pointers ?? [], `${kind}.pointers`, { max: 10 }).map(normalizedScope),
    });
  }
}
