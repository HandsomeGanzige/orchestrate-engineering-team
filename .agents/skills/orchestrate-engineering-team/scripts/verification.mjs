import { ensure, RESULT_KEYS } from './workflow-contract.mjs';
import { boundedString, normalizedScope } from './value-policy.mjs';

/**
 * Validates the compact result envelope returned by a role Assignment.
 *
 * @param {unknown} result - Candidate result received by Main.
 * @param {string} role - Assignment role whose voting and evidence rules apply.
 * @returns {object} The validated result object, preserving its original identity.
 */
export function validateRoleResult(result, role) {
  ensure(result && typeof result === 'object' && !Array.isArray(result), 'result must be an object', 'INVALID_RESULT');
  ensure(
    Object.keys(result).every((key) => RESULT_KEYS.has(key))
      && [...RESULT_KEYS].every((key) => key in result),
    'result fields must exactly match the role result protocol',
    'INVALID_RESULT',
  );
  ensure(JSON.stringify(result).length <= 16_384, 'role result exceeds 16 KiB', 'INVALID_RESULT');
  ensure(['completed', 'partial', 'blocked'].includes(result.status), 'invalid result status', 'INVALID_RESULT');
  ensure(Array.isArray(result.summary) && result.summary.length <= 3, 'summary is limited to three items', 'INVALID_RESULT');
  result.summary.forEach((value, index) => boundedString(value, `summary[${index}]`));
  ensure(Array.isArray(result.artifacts) && result.artifacts.length <= 30, 'artifacts must be a bounded array', 'INVALID_RESULT');
  for (const artifact of result.artifacts) {
    ensure(
      artifact
        && Object.keys(artifact).length === 2
        && typeof artifact.path === 'string'
        && typeof artifact.purpose === 'string',
      'artifact must contain only path and purpose',
      'INVALID_RESULT',
    );
    normalizedScope(artifact.path);
    boundedString(artifact.purpose, 'artifact purpose');
  }
  ensure(Array.isArray(result.files) && result.files.length <= 100, 'files must be a bounded array', 'INVALID_RESULT');
  result.files.forEach(normalizedScope);
  ensure(Array.isArray(result.checks) && result.checks.length <= 30, 'checks must be a bounded array', 'INVALID_RESULT');
  for (const check of result.checks) {
    ensure(
      check
        && Object.keys(check).length === 2
        && typeof check.command === 'string'
        && ['passed', 'failed', 'not_run'].includes(check.result),
      'check must contain only command and result',
      'INVALID_RESULT',
    );
    boundedString(check.command, 'check command', 300);
  }
  ensure(Array.isArray(result.blockers) && result.blockers.length <= 10, 'blockers must be a bounded array', 'INVALID_RESULT');
  result.blockers.forEach((value, index) => boundedString(value, `blockers[${index}]`));
  if (['partial', 'blocked'].includes(result.status)) {
    ensure(result.blockers.length > 0, 'partial and blocked results require blockers', 'INVALID_RESULT');
  }
  if (['architecture', 'development'].includes(role)) {
    ensure(
      typeof result.requires_test === 'boolean' && typeof result.requires_review === 'boolean',
      `${role} must cast boolean test and review votes`,
      'INVALID_RESULT',
    );
    boundedString(result.test_reason, 'test_reason');
    boundedString(result.review_reason, 'review_reason');
  } else {
    ensure(
      result.requires_test === null
        && result.requires_review === null
        && result.test_reason === null
        && result.review_reason === null,
      `${role} result votes must be null`,
      'INVALID_RESULT',
    );
    if (result.status === 'completed') {
      ensure(
        result.checks.length > 0 && result.checks.some((check) => check.result !== 'not_run'),
        `${role} completed result requires at least one executed check`,
        'INVALID_RESULT',
      );
    }
  }
  return result;
}

/**
 * Projects Test and Review recommendations from a validated role result.
 *
 * @param {object} result - Validated Architecture or Development result envelope.
 * @returns {{test: {requires: boolean, reason: string}, review: {requires: boolean, reason: string}}} Dimension-specific votes.
 */
export function resultVote(result) {
  return {
    test: { requires: result.requires_test, reason: result.test_reason },
    review: { requires: result.requires_review, reason: result.review_reason },
  };
}

/**
 * Updates a Work Item's vote state from a completed Architecture or Development Assignment.
 *
 * @param {object} document - Mutable Work Item document.
 * @param {object} assignment - Completed Assignment containing a validated result.
 * @returns {void} Mutates the document's verification vote block in place.
 */
export function projectCompletedAssignmentVote(document, assignment) {
  if (assignment.role === 'architecture') {
    document.blocks.verification.votes.architecture = {
      covered: true,
      ...resultVote(assignment.result),
    };
  }
  if (assignment.role === 'development') {
    const developmentVotes = document.blocks.verification.votes.development;
    document.blocks.verification.votes.development = developmentVotes
      .filter((entry) => entry.assignment !== assignment.id);
    document.blocks.verification.votes.development.push({
      assignment: assignment.id,
      ...resultVote(assignment.result),
    });
  }
}

/**
 * Tests whether a verification role belongs to the requested dimension.
 *
 * @param {string} role - Test, Retest, Review, or Rereview role identifier.
 * @param {'test'|'review'} dimension - Verification dimension to match.
 * @returns {boolean} Whether the role provides evidence for the dimension.
 */
function roleMatchesDimension(role, dimension) {
  return dimension === 'test'
    ? ['test', 'retest'].includes(role)
    : ['review', 'rereview'].includes(role);
}

/**
 * Determines whether the latest completed verification Assignment contains only passing checks.
 *
 * @param {object} document - Work Item containing Assignment history.
 * @param {'test'|'review'} dimension - Verification dimension to inspect.
 * @returns {boolean} `true` when the latest applicable result is complete and fully passing.
 */
export function hasCompletedEvidence(document, dimension) {
  const latest = document.blocks.assignments
    .filter((assignment) => roleMatchesDimension(assignment.role, dimension)
      && assignment.status === 'completed'
      && assignment.result?.status === 'completed')
    .at(-1);
  const checks = latest?.result?.checks;
  return Array.isArray(checks)
    && checks.length > 0
    && checks.every((check) => check.result === 'passed');
}

/**
 * Computes whether Test or Review must execute from Architecture, Development, and Main votes.
 *
 * @param {object} verification - Verification block containing all recorded votes.
 * @param {'test'|'review'} dimension - Verification dimension calculated independently.
 * @param {{developmentOccurred?: boolean}} [options] - Whether Development occurred even when its valid vote is missing.
 * @returns {{execute: boolean, rule: string, votes: object, reason: string}} Deterministic decision and auditable inputs.
 */
export function computeVotes(
  verification,
  dimension,
  { developmentOccurred = verification.votes.development.length > 0 } = {},
) {
  const architecture = verification.votes.architecture?.covered === true
    ? verification.votes.architecture[dimension]
    : null;
  const developmentVotes = verification.votes.development
    .map((vote) => vote[dimension]?.requires)
    .filter((value) => typeof value === 'boolean');
  const development = developmentVotes.length ? developmentVotes.some(Boolean) : null;
  const missingDevelopment = developmentOccurred && development === null;
  const main = verification.votes.main?.[dimension] ?? null;
  if (architecture) {
    const values = [architecture.requires, development, main?.requires];
    const falseCount = values.filter((value) => value === false).length;
    return {
      execute: missingDevelopment || falseCount < 2,
      rule: 'three-party-majority',
      votes: {
        architecture: architecture.requires,
        development,
        main: main?.requires ?? null,
      },
      reason: missingDevelopment
        ? 'default execution applies because completed Development evidence is missing'
        : falseCount >= 2
          ? 'at least two parties supplied supported exemption votes'
          : 'default execution was not overridden by two exemption votes',
    };
  }
  ensure(
    main && typeof main.requires === 'boolean',
    `main must decide ${dimension} when architecture is absent or uncovered`,
    'INCOMPLETE_VOTE',
  );
  return {
    execute: missingDevelopment || main.requires,
    rule: 'main-decision-with-development-advice',
    votes: { architecture: 'absent', development, main: main.requires },
    reason: missingDevelopment
      ? 'default execution applies because completed Development evidence is missing'
      : main.reason,
  };
}

/**
 * Collects every unresolved condition that prevents a Work Item from closing.
 *
 * @param {object} document - Fully parsed Work Item document to reconcile.
 * @returns {{code: string, message: string}[]} Ordered closure issues; an empty array permits completion.
 */
export function completionIssues(document) {
  const issues = [];
  for (const todo of document.blocks.todo) {
    if (todo.status !== 'completed') {
      issues.push({ code: 'UNRECONCILED_TODO', message: `todo ${todo.id} is ${todo.status}` });
    }
  }
  for (const assignment of document.blocks.assignments) {
    if (assignment.status !== 'completed') {
      issues.push({
        code: 'UNRECONCILED_ASSIGNMENT',
        message: `assignment ${assignment.id} is ${assignment.status}`,
      });
    }
  }
  const blockers = [
    ...(document.blocks.result.blockers ?? []),
    ...document.blocks.todo.flatMap((item) => item.blockers ?? []),
    ...document.blocks.assignments.flatMap((item) => [
      ...(item.blockers ?? []),
      ...(item.result?.blockers ?? []),
    ]),
  ];
  if (blockers.length) {
    issues.push({ code: 'UNRESOLVED_BLOCKERS', message: 'work contains unresolved blockers' });
  }
  if (
    document.blocks.result.status !== 'completed'
      || !Array.isArray(document.blocks.result.summary)
      || document.blocks.result.summary.length === 0
  ) {
    issues.push({
      code: 'INCOMPLETE_RESULT',
      message: 'work result must be completed with a summary',
    });
  }
  const evidence = document.blocks.result.success_evidence ?? [];
  for (const criterion of document.blocks.success_criteria) {
    if (!evidence.some((item) => item.criterion === criterion
      && typeof item.evidence === 'string'
      && item.evidence.trim())) {
      issues.push({
        code: 'MISSING_SUCCESS_EVIDENCE',
        message: `missing success evidence for: ${criterion}`,
      });
    }
  }

  const development = document.blocks.assignments
    .filter((assignment) => assignment.role === 'development');
  const codeWork = development.some(
    (assignment) => assignment.write.length > 0 || (assignment.result?.files?.length ?? 0) > 0,
  );
  if (!codeWork) return issues;

  const missingDevelopmentEvidence = development.filter((assignment) => assignment.write.length > 0
    && !(assignment.status === 'completed'
      && assignment.result?.status === 'completed'
      && assignment.result.summary.length > 0
      && assignment.result.files.length > 0));
  for (const assignment of missingDevelopmentEvidence) {
    issues.push({
      code: 'MISSING_DEVELOPMENT_EVIDENCE',
      message: `code-writing Development assignment ${assignment.id} requires a completed result with changed files`,
    });
  }
  for (const dimension of ['test', 'review']) {
    const decision = document.blocks.verification.decisions?.[dimension];
    if (!decision) {
      issues.push({
        code: 'MISSING_VERIFICATION_DECISION',
        message: `${dimension} decision has not been computed`,
      });
      continue;
    }
    try {
      const calculated = computeVotes(document.blocks.verification, dimension, {
        developmentOccurred: development.length > 0,
      });
      if (JSON.stringify(calculated) !== JSON.stringify(decision)) {
        issues.push({
          code: 'INVALID_VOTE_DECISION',
          message: `${dimension} decision does not match current votes`,
        });
      } else if (calculated.execute && !hasCompletedEvidence(document, dimension)) {
        issues.push({
          code: 'MISSING_VERIFICATION_EVIDENCE',
          message: `${dimension} execution requires a completed ${dimension} result with at least one check and all checks passed`,
        });
      }
    } catch (error) {
      issues.push({ code: 'MISSING_VERIFICATION_DECISION', message: error.message });
    }
  }
  return issues;
}
