import path from 'node:path';

import {
  newWorkDocument,
  validateDocument,
  validateLeaseMinutes,
} from './workflow-document.mjs';
import { ensure, LEASE_MINUTES } from './workflow-contract.mjs';
import {
  applyResult,
  ensureUnique,
  itemById,
  makeHandoff,
  makePacket,
  matchWork,
  prepareAssignmentMutation,
  prepareDecisionMutation,
  prepareMaterialMutation,
  prepareTodoMutation,
  prepareVoteMutation,
  prepareWorkMutation,
} from './work-model.mjs';
import {
  assertOwner,
  createAt,
  exists,
  initWorkspace as initializeStore,
  listWork,
  mutateAt,
  readAt,
  resolveWork,
  workspaceIndex,
} from './workflow-store.mjs';
import {
  completionIssues,
  computeVotes,
  resultVote,
} from './verification.mjs';
import { normalizedMaterialPath, normalizeStrings, scalar } from './value-policy.mjs';

/**
 * Projects one Work Item into the lightweight entry stored by a parent or workspace root.
 *
 * @param {string} file - Work Item index path.
 * @param {string} root - Workspace boundary used to relativize the path.
 * @param {object} document - Parsed Work Item document.
 * @returns {{id: string, path: string, name: string, summary: string, status: string}} Canonical link projection.
 */
function rootEntry(file, root, document) {
  return {
    id: document.frontmatter.id,
    path: path.relative(root, file),
    name: document.frontmatter.name,
    summary: document.frontmatter.summary,
    status: document.frontmatter.status,
  };
}

/**
 * Enforces the minimum evidence required to promote a planned step into a Child Work Item.
 *
 * @param {object} input - Child creation input containing an `eligibility` declaration.
 * @returns {void} Returns only for an independently acceptable, in-scope, recursively useful child.
 */
function validateChildEligibility(input) {
  const eligibility = input.eligibility ?? {};
  ensure(
    eligibility.independentlyAcceptable === true,
    'child must be independently acceptable',
    'INELIGIBLE_CHILD',
  );
  ensure(
    eligibility.withinParentScope === true,
    'child must remain within the confirmed parent scope',
    'INELIGIBLE_CHILD',
  );
  const todos = normalizeStrings(eligibility.plannedTodos ?? [], 'eligibility.plannedTodos', { max: 50 });
  const roles = normalizeStrings(eligibility.plannedRoles ?? [], 'eligibility.plannedRoles', { max: 10 });
  ensure(
    todos.length >= 2 || new Set(roles).size >= 2 || eligibility.crossSession === true,
    'child requires multiple todos, multiple roles, or cross-session recovery',
    'INELIGIBLE_CHILD',
  );
}

/**
 * Initializes or validates the workflow workspace at a project root.
 *
 * @param {{root: string, now?: Date}} args - Workspace path and deterministic clock.
 * @returns {Promise<{ok: true, workspace: string}>} Store initialization result.
 */
export async function initWorkspace({ root, now = new Date() }) {
  return initializeStore(root, now);
}

/**
 * Creates a top-level or eligible child Work Item and registers its parent projection.
 *
 * @param {{root: string, input: object, owner?: string, now?: Date, childOnly?: boolean}} args - Creation context and Work Item payload.
 * @returns {Promise<{ok: true, work: string, id: string}>} Created Work Item path and identity.
 */
export async function createWork({ root, input, owner, now = new Date(), childOnly = false }) {
  await initWorkspace({ root, now });
  const parentReference = input.parent;
  if (childOnly) ensure(parentReference, 'child create requires parent', 'INVALID_INPUT');
  if (parentReference) validateChildEligibility(input);
  let target;
  let parentFile;
  if (parentReference) {
    parentFile = await resolveWork(root, parentReference);
    assertOwner(await readAt(parentFile), owner, now);
    target = path.join(path.dirname(parentFile), 'children', input.id, 'index.md');
  } else {
    target = path.join(root, '.agent-work', 'work-items', input.id, 'index.md');
  }
  const parentRelative = path.relative(path.dirname(target), parentFile ?? workspaceIndex(root));
  const document = newWorkDocument(input, parentRelative, now);
  validateDocument(document, { file: target });
  await createAt(target, document);
  const entry = rootEntry(target, root, document);
  try {
    if (parentFile) {
      await mutateAt(parentFile, { owner, now }, (parent) => {
        ensureUnique(parent.blocks.children, input.id, 'child');
        parent.blocks.children.push(entry);
      });
    } else {
      await mutateAt(
        workspaceIndex(root),
        { requireOwner: false, renew: false, now },
        (workspace) => {
          ensureUnique(workspace.blocks.work_items, input.id, 'work item');
          workspace.blocks.work_items.push(entry);
        },
      );
    }
  } catch (error) {
    // Documents are atomic individually, but cross-document creation is not transactional;
    // child/work-first ordering leaves an orphan that workspace validation can identify.
    throw error;
  }
  return { ok: true, work: path.relative(root, target), id: input.id };
}

/**
 * Claims or renews one Work Item for a Main owner under an exclusive lease.
 *
 * @param {{root: string, work: string, owner: string, leaseMinutes?: number, now?: Date}} args - Work reference, owner, duration, and clock.
 * @returns {Promise<{ok: true, work: string, owner: string, lease_minutes: number, lease_until: string}>} Persisted claim details.
 */
export async function claimWork({
  root,
  work,
  owner,
  leaseMinutes = LEASE_MINUTES,
  now = new Date(),
}) {
  ensure(typeof owner === 'string' && owner.trim(), '--owner is required', 'INVALID_INPUT');
  const duration = validateLeaseMinutes(leaseMinutes);
  const file = await resolveWork(root, work);
  return mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
    const current = document.frontmatter.owner;
    const expired = !current || Date.parse(document.frontmatter.lease_until) <= now.getTime();
    ensure(expired || current === owner, `work is leased by ${current}`, 'LEASE_CONFLICT');
    document.frontmatter.owner = owner;
    document.frontmatter.lease_until = new Date(now.getTime() + duration * 60_000).toISOString();
    return {
      ok: true,
      work: path.relative(root, file),
      owner,
      lease_minutes: duration,
      lease_until: document.frontmatter.lease_until,
    };
  });
}

/**
 * Releases a Work Item lease after verifying current ownership.
 *
 * @param {{root: string, work: string, owner: string, now?: Date}} args - Work reference, owner, and clock.
 * @returns {Promise<{ok: true, work: string, released: true}>} Release confirmation.
 */
export async function releaseWork({ root, work, owner, now = new Date() }) {
  const file = await resolveWork(root, work);
  return mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
    assertOwner(document, owner, now);
    document.frontmatter.owner = '';
    document.frontmatter.lease_until = '';
    return { ok: true, work: path.relative(root, file), released: true };
  });
}

/**
 * Applies an owner-authorized mutation to one Work Item and adds common response metadata.
 *
 * @template T
 * @param {{root: string, work: string, owner: string, now?: Date, mutate: (document: object) => T|Promise<T>}} args - Mutation context and callback.
 * @returns {Promise<{ok: true, work: string} & T>} Relative Work Item path merged with the mutation result.
 */
export async function mutateWork({ root, work, owner, now = new Date(), mutate }) {
  const file = await resolveWork(root, work);
  const result = await mutateAt(file, { owner, now }, mutate);
  return { ok: true, work: path.relative(root, file), ...result };
}

/**
 * Executes a Work Item update, reconciles completion, and synchronizes top-level projections.
 *
 * @param {object} args - Common mutation context plus action and Work Item input.
 * @returns {Promise<object>} Persisted Work Item mutation result.
 */
export async function workCommand(args) {
  const action = args.action ?? 'update';
  const mutate = prepareWorkMutation(action, args.input);
  if (action === 'update' && args.input.status === 'completed') {
    const parentFile = await resolveWork(args.root, args.work);
    const descendantPrefix = `${path.dirname(parentFile)}${path.sep}children${path.sep}`;
    for (const candidate of await listWork(args.root)) {
      if (!candidate.startsWith(descendantPrefix)) continue;
      const descendant = await readAt(candidate);
      ensure(
        ['completed', 'cancelled'].includes(descendant.frontmatter.status),
        `cannot complete work while descendant ${descendant.frontmatter.id} is ${descendant.frontmatter.status}`,
        'INCOMPLETE_DESCENDANT',
      );
    }
  }
  const result = await mutateWork({
    ...args,
    mutate,
  });
  const file = await resolveWork(args.root, args.work);
  const document = await readAt(file);
  const parentFile = path.resolve(path.dirname(file), document.frontmatter.parent);
  if (parentFile === workspaceIndex(args.root)) {
    // Work status is committed first; a root-sync failure intentionally leaves a stale link for validation.
    await mutateAt(parentFile, { requireOwner: false, renew: false, now: args.now }, (workspace) => {
      workspace.blocks.work_items = workspace.blocks.work_items
        .filter((entry) => entry.id !== document.frontmatter.id);
      if (['active', 'paused'].includes(document.frontmatter.status)) {
        workspace.blocks.work_items.push(rootEntry(file, args.root, document));
      }
    });
  }
  return result;
}

/**
 * Adds a confirmed decision through the common owner-authorized mutation path.
 *
 * @param {{action: string, input: object, [key: string]: unknown}} args - Decision action, payload, and common work context.
 * @returns {Promise<object>} Persisted decision mutation result.
 */
export async function decisionCommand({ action, input, ...args }) {
  return mutateWork({ ...args, mutate: prepareDecisionMutation(action, input) });
}

/**
 * Executes one Todo lifecycle action through the common mutation path.
 *
 * @param {{action: string, input: object, [key: string]: unknown}} args - Todo action, payload, and common work context.
 * @returns {Promise<object>} Persisted Todo mutation result.
 */
export async function todoCommand({ action, input, ...args }) {
  return mutateWork({ ...args, mutate: prepareTodoMutation(action, input) });
}

/**
 * Executes one Assignment lifecycle action through the common mutation path.
 *
 * @param {{action: string, input: object, [key: string]: unknown}} args - Assignment action, payload, and common work context.
 * @returns {Promise<object>} Persisted Assignment mutation result.
 */
export async function assignmentCommand({ action, input, ...args }) {
  return mutateWork({ ...args, mutate: prepareAssignmentMutation(action, input) });
}

/**
 * Stores one compact role result against its in-progress Assignment.
 *
 * @param {{input: object, [key: string]: unknown}} args - Role result payload and common work context.
 * @returns {Promise<object>} Persisted role-result mutation response.
 */
export async function resultCommand({ input, ...args }) {
  return mutateWork({ ...args, mutate: (document) => applyResult(document, input) });
}

/**
 * Records verification votes or computes Test and Review decisions.
 *
 * @param {{action: string, input: object, [key: string]: unknown}} args - Vote action, payload, and common work context.
 * @returns {Promise<object>} Persisted vote or decision result.
 */
export async function voteCommand({ action, input, ...args }) {
  return mutateWork({ ...args, mutate: prepareVoteMutation(action, input) });
}

/**
 * Synchronizes a completed Child Work Item's lightweight state into its parent.
 *
 * @param {{input: {id: string}, root: string, [key: string]: unknown}} args - Child identity and common parent mutation context.
 * @returns {Promise<object>} Synchronized child identity and current status.
 */
export async function childSync({ input, ...args }) {
  return mutateWork({
    ...args,
    mutate: async (parent) => {
      const childEntry = itemById(parent.blocks.children, input.id, 'child');
      const childFile = path.resolve(args.root, childEntry.path);
      ensure(
        childFile.startsWith(`${path.resolve(args.root)}${path.sep}`),
        'child path escapes the project',
        'INVALID_CHILD_LINK',
      );
      const child = await readAt(childFile);
      childEntry.status = child.frontmatter.status;
      childEntry.name = child.frontmatter.name;
      childEntry.summary = child.frontmatter.summary;
      childEntry.result = {
        summary: child.blocks.result.summary,
        artifacts: child.blocks.result.artifacts,
      };
      return { child: input.id, status: childEntry.status };
    },
  });
}

/**
 * Registers a role-scoped Material through the common mutation path.
 *
 * @param {{action: string, input: object, [key: string]: unknown}} args - Material action, payload, and common work context.
 * @returns {Promise<object>} Persisted Material registration result.
 */
export async function materialCommand({ action, input, ...args }) {
  return mutateWork({ ...args, mutate: prepareMaterialMutation(action, input) });
}

/**
 * Generates the minimal empty-history packet for a selected Assignment.
 *
 * @param {{root: string, work: string, input: {assignment: string}}} args - Work reference and Assignment identity.
 * @returns {Promise<object>} Bounded packet suitable for direct role dispatch.
 */
export async function packetCommand({ root, work, input }) {
  const file = await resolveWork(root, work);
  return makePacket(await readAt(file), input.assignment);
}

/**
 * Projects one Work Item into the lightweight shape returned by find and list.
 *
 * @param {string} root - Workspace boundary used to relativize the path.
 * @param {string} file - Work Item index path.
 * @param {object} document - Parsed Work Item document.
 * @param {string} reason - Match or filter reason exposed to the caller.
 * @returns {{path: string, name: string, summary: string, status: string, match_reason: string}} Lightweight query entry.
 */
function lightEntry(root, file, document, reason) {
  return {
    path: path.relative(root, file),
    name: document.frontmatter.name,
    summary: document.frontmatter.summary,
    status: document.frontmatter.status,
    match_reason: reason,
  };
}

/**
 * Searches semantic Work Item metadata and Material summaries without returning document bodies.
 *
 * @param {{root: string, input: {query: string, limit?: number}}} args - Workspace root and bounded search input.
 * @returns {Promise<object[]>} Ranked lightweight matches, capped by the requested limit.
 */
export async function findCommand({ root, input }) {
  const query = scalar(input.query).trim().toLowerCase();
  ensure(query, 'query is required', 'INVALID_INPUT');
  const limit = Number(input.limit ?? 10);
  ensure(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'limit must be 1-100', 'INVALID_INPUT');
  const matches = [];
  for (const file of await listWork(root)) {
    const document = await readAt(file);
    const match = matchWork(document, query);
    if (match) {
      matches.push({
        score: match.score,
        entry: lightEntry(root, file, document, match.reason),
      });
    }
  }
  matches.sort((left, right) => right.score - left.score
    || left.entry.path.localeCompare(right.entry.path));
  return matches.slice(0, limit).map(({ entry }) => entry);
}

/**
 * Lists lightweight Work Item metadata using optional status, type, owner, and parent filters.
 *
 * @param {{root: string, input: object}} args - Workspace root and filter object.
 * @returns {Promise<object[]>} Lightweight entries matching every supplied filter.
 */
export async function listCommand({ root, input }) {
  const output = [];
  let parentFile = null;
  if (input.parent) parentFile = await resolveWork(root, input.parent);
  for (const file of await listWork(root)) {
    const document = await readAt(file);
    const frontmatter = document.frontmatter;
    const actualParent = path.resolve(path.dirname(file), frontmatter.parent);
    if (input.status && frontmatter.status !== input.status) continue;
    if (input.type && frontmatter.type !== input.type) continue;
    if (input.owner && frontmatter.owner !== input.owner) continue;
    if (parentFile && actualParent !== parentFile) continue;
    output.push(lightEntry(root, file, document, 'filter'));
  }
  return output;
}

/**
 * Generates a compact resume summary for one Work Item.
 *
 * @param {{root: string, work: string}} args - Workspace root and Work Item reference.
 * @returns {Promise<object>} Minimal handoff containing current state and next action.
 */
export async function handoffCommand({ root, work }) {
  const file = await resolveWork(root, work);
  return makeHandoff(await readAt(file), path.relative(root, file));
}

/**
 * Appends one normalized validation diagnostic to a shared error collection.
 *
 * @param {object[]} errors - Mutable diagnostic collection.
 * @param {string} file - Workspace-relative file containing the defect.
 * @param {string} code - Stable validation code.
 * @param {string} message - Human-readable defect description.
 * @returns {void} Mutates the supplied error collection.
 */
function validationError(errors, file, code, message) {
  errors.push({ file, code, message });
}

/**
 * Validates document schemas plus cross-document topology, projections, votes, and completion state.
 *
 * @param {{root: string}} args - Project root containing the workflow workspace.
 * @returns {Promise<{valid: boolean, checked?: number, errors: object[]}>} Workspace validity, inspected count, and ordered diagnostics.
 */
export async function validateWorkspace({ root }) {
  // Cross-document ordering and topology belong to the workspace use case; the store
  // deliberately guarantees atomicity only for one document at a time.
  // One absolute boundary root keeps discovered and persisted topology keys comparable.
  const workspaceRoot = path.resolve(root);
  const errors = [];
  const rootFile = workspaceIndex(workspaceRoot);
  let rootDocument;
  try {
    rootDocument = await readAt(rootFile);
  } catch (error) {
    return {
      valid: false,
      errors: [{
        file: path.relative(workspaceRoot, rootFile),
        code: error.code ?? 'INVALID',
        message: error.message,
      }],
    };
  }
  const files = await listWork(workspaceRoot);
  const documents = new Map();
  for (const file of files) {
    try {
      documents.set(file, await readAt(file));
    } catch (error) {
      validationError(
        errors,
        path.relative(workspaceRoot, file),
        error.code ?? 'INVALID',
        error.message,
      );
    }
  }
  const registeredTop = new Set(
    rootDocument.blocks.work_items.map((entry) => path.resolve(workspaceRoot, entry.path)),
  );
  for (const [file, document] of documents) {
    const relative = path.relative(workspaceRoot, file);
    const parentFile = path.resolve(path.dirname(file), document.frontmatter.parent);
    const parentIsRoot = parentFile === rootFile;
    if (!parentIsRoot && !documents.has(parentFile)) {
      validationError(errors, relative, 'INVALID_PARENT', 'parent link does not resolve to a work item');
    }
    if (parentIsRoot
      && ['active', 'paused'].includes(document.frontmatter.status)
      && !registeredTop.has(file)) {
      validationError(
        errors,
        relative,
        'ORPHAN_WORK',
        'active or paused top-level work is not registered in workspace index',
      );
    }
    if (parentIsRoot
      && !['active', 'paused'].includes(document.frontmatter.status)
      && registeredTop.has(file)) {
      validationError(
        errors,
        relative,
        'STALE_ROOT_LINK',
        'workspace index may list only active or paused work',
      );
    }
    if (!parentIsRoot && documents.has(parentFile)) {
      const parent = documents.get(parentFile);
      const linked = parent.blocks.children
        .some((entry) => path.resolve(workspaceRoot, entry.path) === file);
      if (!linked) validationError(errors, relative, 'ORPHAN_CHILD', 'child is not registered by parent');
    }
    for (const assignment of document.blocks.assignments) {
      const accidental = [
        path.join(path.dirname(file), assignment.id, 'index.md'),
        path.join(path.dirname(file), 'children', assignment.id, 'index.md'),
      ];
      if ((await Promise.all(accidental.map(exists))).some(Boolean)) {
        validationError(
          errors,
          relative,
          'ASSIGNMENT_DIRECTORY',
          `assignment ${assignment.id} has a forbidden task directory`,
        );
      }
    }
    const developmentAssignments = document.blocks.assignments
      .filter((assignment) => assignment.role === 'development');
    for (const vote of document.blocks.verification.votes.development) {
      const assignment = developmentAssignments
        .find((candidate) => candidate.id === vote.assignment);
      if (!assignment
        || assignment.status !== 'completed'
        || assignment.result?.status !== 'completed') {
        validationError(
          errors,
          relative,
          'INVALID_DEVELOPMENT_VOTE',
          `development vote ${vote.assignment} lacks a completed Development result`,
        );
        continue;
      }
      const expected = { assignment: assignment.id, ...resultVote(assignment.result) };
      if (JSON.stringify(expected) !== JSON.stringify(vote)) {
        validationError(
          errors,
          relative,
          'INVALID_DEVELOPMENT_VOTE',
          `development vote ${vote.assignment} does not match its completed result`,
        );
      }
    }
    const completedDevelopment = developmentAssignments.filter((candidate) => candidate.status === 'completed'
      && candidate.result?.status === 'completed');
    for (const assignment of completedDevelopment) {
      if (!document.blocks.verification.votes.development
        .some((vote) => vote.assignment === assignment.id)) {
        validationError(
          errors,
          relative,
          'MISSING_DEVELOPMENT_VOTE',
          `completed Development result ${assignment.id} has no projected vote`,
        );
      }
    }
    for (const childEntry of document.blocks.children) {
      const linkedFile = path.resolve(workspaceRoot, childEntry.path);
      if (!linkedFile.startsWith(`${workspaceRoot}${path.sep}`)) {
        validationError(
          errors,
          relative,
          'INVALID_CHILD_LINK',
          `child path escapes the project: ${childEntry.path}`,
        );
        continue;
      }
      const linkedDocument = documents.get(linkedFile);
      if (!linkedDocument) {
        validationError(
          errors,
          relative,
          'BROKEN_CHILD_LINK',
          `missing child work: ${childEntry.path}`,
        );
      } else if (linkedDocument.frontmatter.id !== childEntry.id
        || path.resolve(path.dirname(linkedFile), linkedDocument.frontmatter.parent) !== file) {
        validationError(
          errors,
          relative,
          'INVALID_CHILD_LINK',
          `child link is not reciprocal: ${childEntry.path}`,
        );
      }
    }
    for (const material of document.blocks.materials) {
      try {
        normalizedMaterialPath(material.role, material.path);
      } catch {
        validationError(
          errors,
          relative,
          'MATERIAL_SCOPE',
          `material path is outside role scope: ${material.path}`,
        );
      }
    }
    for (const dimension of ['test', 'review']) {
      if (document.blocks.verification.decisions?.[dimension]) {
        try {
          const calculated = computeVotes(document.blocks.verification, dimension, {
            developmentOccurred: developmentAssignments.length > 0,
          });
          if (JSON.stringify(calculated)
            !== JSON.stringify(document.blocks.verification.decisions[dimension])) {
            validationError(
              errors,
              relative,
              'INVALID_VOTE_DECISION',
              `${dimension} decision does not match votes`,
            );
          }
        } catch (error) {
          validationError(errors, relative, 'INVALID_VOTE_DECISION', error.message);
        }
      }
    }
    if (document.frontmatter.status === 'completed') {
      for (const issue of completionIssues(document)) {
        validationError(errors, relative, issue.code, issue.message);
      }
    }
  }
  for (const [file, document] of documents) {
    if (document.frontmatter.status !== 'completed') continue;
    const prefix = `${path.dirname(file)}${path.sep}children${path.sep}`;
    for (const [candidate, child] of documents) {
      if (candidate.startsWith(prefix)
        && !['completed', 'cancelled'].includes(child.frontmatter.status)) {
        validationError(
          errors,
          path.relative(workspaceRoot, file),
          'INCOMPLETE_DESCENDANT',
          `completed work has unfinished descendant ${child.frontmatter.id}`,
        );
      }
    }
  }
  for (const entry of rootDocument.blocks.work_items) {
    const linkedFile = path.resolve(workspaceRoot, entry.path);
    const linkedDocument = documents.get(linkedFile);
    if (!linkedDocument) {
      validationError(
        errors,
        path.relative(workspaceRoot, rootFile),
        'BROKEN_ROOT_LINK',
        `missing top-level work: ${entry.path}`,
      );
      continue;
    }
    // A root projection is reciprocal only when the referenced Work Item points back to the workspace.
    const linkedParent = path.resolve(
      path.dirname(linkedFile),
      linkedDocument.frontmatter.parent,
    );
    if (linkedParent !== rootFile) {
      validationError(
        errors,
        path.relative(workspaceRoot, rootFile),
        'INVALID_ROOT_LINK',
        `root entry references non-top-level work: ${entry.path}`,
      );
      continue;
    }
    const expected = rootEntry(linkedFile, workspaceRoot, linkedDocument);
    for (const field of ['id', 'path', 'name', 'summary', 'status']) {
      if (entry[field] !== expected[field]) {
        validationError(
          errors,
          path.relative(workspaceRoot, rootFile),
          'STALE_ROOT_PROJECTION',
          `root work item ${entry.id} ${field} does not match ${expected[field]}`,
        );
      }
    }
  }
  return { valid: errors.length === 0, checked: documents.size, errors };
}
