import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  newWorkDocument,
  upsertChildDelivery,
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
  prepareTodoMutation,
  prepareVoteMutation,
  prepareWorkMutation,
} from './work-model.mjs';
import {
  assertOwner,
  completeAndArchiveAt,
  createAt,
  createChildAtTransaction,
  exists,
  initWorkspace as initializeStore,
  listWork,
  mutateAt,
  readArchivedMarkdown,
  readCompletionReceipt,
  readHistoryIndex,
  readAt,
  resumeCommittedArchiveCleanup,
  resolveHistory,
  resolveWork,
  waitForWorkflowTestBarrier,
  withWorkflowTransaction,
} from './workflow-store.mjs';
import {
  completionIssues,
} from './verification.mjs';
import { normalizeStrings, scalar } from './value-policy.mjs';

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
  return withWorkflowTransaction(root, () => initializeStore(root, now), { create: true });
}

/**
 * Creates a top-level or eligible child Work Item and registers its parent projection.
 *
 * @param {{root: string, input: object, owner?: string, now?: Date, childOnly?: boolean}} args - Creation context and Work Item payload.
 * @returns {Promise<{ok: true, work: string, id: string}>} Created Work Item path and identity.
 */
export async function createWork({ root, input, owner, now = new Date(), childOnly = false }) {
  return withWorkflowTransaction(root, async () => {
    await initWorkspace({ root, now });
    const parentReference = input.parent;
    if (childOnly) ensure(parentReference, 'child create requires parent', 'INVALID_INPUT');
    if (parentReference) validateChildEligibility(input);
    let target;
    let parentFile;
    if (parentReference) {
      parentFile = await resolveWork(root, parentReference);
      assertOwner(await readAt(parentFile), owner, now);
      target = path.join(path.dirname(parentFile), 'children', input.id, 'work.md');
    } else {
      target = path.join(root, '.agent-work', 'open', input.id, 'work.md');
    }
    const parentRelative = parentFile ? path.relative(path.dirname(target), parentFile) : null;
    const document = newWorkDocument(input, parentRelative, now);
    validateDocument(document, { file: target });
    const entry = {
      id: document.frontmatter.id,
      path: path.relative(root, target),
      status: document.frontmatter.status,
    };
    if (parentFile) {
      const link = path.relative(path.dirname(parentFile), target).split(path.sep).join('/');
      await createChildAtTransaction(root, parentFile, target, document, { owner, now }, (parent, child) => {
        const existing = parent.blocks.children.find(({ id }) => id === input.id);
        if (existing) ensure(existing.path === entry.path && existing.status === entry.status, `child conflicts with parent registration: ${input.id}`, 'INVALID_DOCUMENT');
        else parent.blocks.children.push(entry);
        upsertChildDelivery(
          parent,
          entry,
          `- [ ] [${child.frontmatter.name}](${link}) \u2014 ${child.blocks.success_criteria.join('; ')}`,
        );
      });
    } else await createAt(target, document);
    return { ok: true, work: path.relative(root, target), id: input.id };
  }, { create: true });
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
  return withWorkflowTransaction(root, async () => {
    ensure(typeof owner === 'string' && owner.trim(), '--owner is required', 'INVALID_INPUT');
    const duration = validateLeaseMinutes(leaseMinutes);
    const file = await resolveWork(root, work);
    return mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
      ensure(['active', 'paused', 'blocked'].includes(document.frontmatter.status), 'completed or cancelled work cannot be claimed', 'INVALID_TRANSITION');
      const current = document.frontmatter.owner;
      const expired = !current || Date.parse(document.frontmatter.lease_until) <= now.getTime();
      ensure(expired || current === owner, `work is leased by ${current}`, 'LEASE_CONFLICT');
      document.frontmatter.owner = owner;
      document.frontmatter.lease_until = new Date(now.getTime() + duration * 60_000).toISOString();
      document.state.lease_minutes = duration;
      return {
        ok: true,
        work: path.relative(root, file),
        owner,
        lease_minutes: duration,
        lease_until: document.frontmatter.lease_until,
      };
    });
  });
}

/**
 * Releases a Work Item lease after verifying current ownership.
 *
 * @param {{root: string, work: string, owner: string, now?: Date}} args - Work reference, owner, and clock.
 * @returns {Promise<{ok: true, work: string, released: true}>} Release confirmation.
 */
export async function releaseWork({ root, work, owner, now = new Date() }) {
  return withWorkflowTransaction(root, async () => {
    const file = await resolveWork(root, work);
    return mutateAt(file, { requireOwner: false, renew: false, now }, (document) => {
      assertOwner(document, owner, now);
      document.frontmatter.owner = '';
      document.frontmatter.lease_until = '';
      return { ok: true, work: path.relative(root, file), released: true };
    });
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
  return withWorkflowTransaction(root, async () => {
    const file = await resolveWork(root, work);
    const result = await mutateAt(file, { owner, now }, mutate);
    return { ok: true, work: path.relative(root, file), ...result };
  });
}

/**
 * Executes a Work Item update, reconciles completion, and synchronizes top-level projections.
 *
 * @param {object} args - Common mutation context plus action and Work Item input.
 * @returns {Promise<object>} Persisted Work Item mutation result.
 */
export async function workCommand(args) {
  return withWorkflowTransaction(args.root, async () => {
    const action = args.action ?? 'update';
    const mutate = prepareWorkMutation(action, args.input);
    let file;
    try {
      file = await resolveWork(args.root, args.work);
    } catch (error) {
      if (!(action === 'update' && args.input.status === 'completed' && error.code === 'WORK_NOT_FOUND')) throw error;
      const recovery = await resumeCommittedArchiveCleanup(args.root, args.work)
        ?? await readCompletionReceipt(args.root, args.work);
      if (!recovery) throw error;
      return {
        ok: true,
        ...recovery.result,
        work: path.relative(args.root, recovery.archived),
        archived: true,
      };
    }
    if (action === 'update' && args.input.status === 'completed') {
      const parent = await readAt(file);
      for (const child of parent.blocks.children) {
        ensure(
          ['completed', 'cancelled'].includes(child.status),
          `child delivery ${child.id} must be synchronized before completion`,
          'INCOMPLETE_CHILD_PROJECTION',
        );
      }
      const descendantPrefix = `${path.dirname(file)}${path.sep}children${path.sep}`;
      for (const candidate of await listWork(args.root)) {
        if (!candidate.startsWith(descendantPrefix)) continue;
        const descendant = await readAt(candidate);
        ensure(
          ['completed', 'cancelled'].includes(descendant.frontmatter.status),
          `cannot complete work while descendant ${descendant.frontmatter.id} is ${descendant.frontmatter.status}`,
          'INCOMPLETE_DESCENDANT',
        );
      }
      await waitForWorkflowTestBarrier('WORKFLOW_TEST_COMPLETE_AFTER_DESCENDANTS_BARRIER');
    }
    const current = await readAt(file);
    if (action === 'update' && args.input.status === 'completed' && !current.state.parent) {
      const { result, archived } = await completeAndArchiveAt(
        args.root,
        file,
        { owner: args.owner, now: args.now ?? new Date() },
        mutate,
      );
      return { ok: true, ...result, work: path.relative(args.root, archived), archived: true };
    }
    return mutateWork({ ...args, mutate });
  });
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
      const facts = [
        child.blocks.result.summary.join('; '),
        child.blocks.result.artifacts.map((item) => `\`${item.path}\` (${item.purpose})`).join('; '),
      ].filter(Boolean).join('; ');
      upsertChildDelivery(
        parent,
        childEntry,
        `- [${childEntry.status === 'completed' ? 'x' : ' '}] [${child.frontmatter.name}](children/${childEntry.id}/work.md)${facts ? ` \u2014 ${facts}` : ''}`,
      );
      return { child: input.id, status: childEntry.status };
    },
  });
}

/**
 * Generates the minimal empty-history packet for a selected Assignment.
 *
 * @param {{root: string, work: string, input: {assignment: string}}} args - Work reference and Assignment identity.
 * @returns {Promise<object>} Bounded packet suitable for direct role dispatch.
 */
export async function packetCommand({ root, work, input }) {
  return withWorkflowTransaction(root, async () => {
    ensure(input.history !== true, 'role packets are available only for open work', 'HISTORY_READ_ONLY');
    const file = await resolveWork(root, work);
    const document = await readAt(file);
    ensure(['active', 'paused', 'blocked'].includes(document.frontmatter.status), 'role packets are available only for open work', 'INVALID_TRANSITION');
    return makePacket(document, input.assignment);
  });
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
 * Searches semantic Work Item metadata without returning document bodies.
 *
 * @param {{root: string, input: {query: string, limit?: number}}} args - Workspace root and bounded search input.
 * @returns {Promise<object[]>} Ranked lightweight matches, capped by the requested limit.
 */
export async function findCommand({ root, input }) {
  return withWorkflowTransaction(root, async () => {
    const query = scalar(input.query).trim().toLowerCase();
    ensure(query, 'query is required', 'INVALID_INPUT');
    const limit = Number(input.limit ?? 10);
    ensure(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'limit must be 1-100', 'INVALID_INPUT');
    const matches = [];
    const history = input.history === true;
    const sources = history
      ? (await readHistoryIndex(root)).map((entry) => ({ file: path.resolve(root, entry.path), document: archivedDocument(entry) }))
      : (await listWork(root)).map((file) => ({ file, document: null }));
    for (const source of sources) {
      const { file } = source;
      const document = source.document ?? await readAt(file);
      if (!history && !['active', 'paused', 'blocked'].includes(document.frontmatter.status)) continue;
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
  });
}

/**
 * Lists lightweight Work Item metadata using optional status, type, owner, and parent filters.
 *
 * @param {{root: string, input: object}} args - Workspace root and filter object.
 * @returns {Promise<object[]>} Lightweight entries matching every supplied filter.
 */
export async function listCommand({ root, input }) {
  return withWorkflowTransaction(root, async () => {
    const output = [];
    const history = input.history === true;
    let parentFile = null;
    if (input.parent && !history) parentFile = await resolveWork(root, input.parent);
    const sources = history
      ? (await readHistoryIndex(root)).map((entry) => ({ file: path.resolve(root, entry.path), document: archivedDocument(entry) }))
      : (await listWork(root)).map((file) => ({ file, document: null }));
    for (const source of sources) {
      const { file } = source;
      const document = source.document ?? await readAt(file);
      const frontmatter = document.frontmatter;
      if (!history && !['active', 'paused', 'blocked'].includes(frontmatter.status)) continue;
      const actualParent = frontmatter.parent ? path.resolve(path.dirname(file), frontmatter.parent) : null;
      if (input.status && frontmatter.status !== input.status) continue;
      if (input.type && frontmatter.type !== input.type) continue;
      if (input.owner && frontmatter.owner !== input.owner) continue;
      if (parentFile && actualParent !== parentFile) continue;
      output.push(lightEntry(root, file, document, 'filter'));
    }
    return output;
  });
}

/**
 * Generates a compact resume summary for one Work Item.
 *
 * @param {{root: string, work: string}} args - Workspace root and Work Item reference.
 * @returns {Promise<object>} Minimal handoff containing current state and next action.
 */
export async function handoffCommand({ root, work }) {
  return withWorkflowTransaction(root, async () => {
    const file = await resolveWork(root, work);
    const document = await readAt(file);
    ensure(['active', 'paused', 'blocked'].includes(document.frontmatter.status), 'handoff is available only for open work', 'INVALID_TRANSITION');
    return makeHandoff(document, path.relative(root, file));
  });
}

/**
 * Builds an archived query model.
 * @param {object} entry - Lightweight archive-index entry.
 * @returns {object} Lightweight model.
 */
function archivedDocument(entry) {
  return {
    frontmatter: { id: entry.id, name: entry.name, summary: entry.summary, status: entry.status, owner: '', parent: '', keywords: [] },
    blocks: { result: { summary: [] } },
  };
}

/**
 * Opens archived Markdown explicitly.
 * @param {object} args - Root and work reference.
 * @returns {Promise<object>} Archived document response.
 */
export async function historyCommand({ root, work }) {
  return withWorkflowTransaction(root, async () => {
    const file = await resolveHistory(root, work);
    return { work: path.relative(root, file), markdown: await readArchivedMarkdown(root, file) };
  });
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
  return withWorkflowTransaction(root, async () => {
    const workspaceRoot = path.resolve(root);
    const errors = [];
    const files = await listWork(workspaceRoot);
    const documents = new Map();
    for (const file of files) {
      try { documents.set(file, await readAt(file)); }
      catch (error) { validationError(errors, path.relative(workspaceRoot, file), error.code ?? 'INVALID', error.message); }
    }
    for (const [file, document] of documents) {
    const relative = path.relative(workspaceRoot, file);
    const parentFile = document.state.parent ? path.resolve(path.dirname(file), document.state.parent) : null;
    if (parentFile) {
      const parent = documents.get(parentFile);
      if (!parent) validationError(errors, relative, 'INVALID_PARENT', 'parent link does not resolve to open work');
      else if (!parent.state.children.some((entry) => path.resolve(workspaceRoot, entry.path) === file && entry.id === document.state.id)) {
        validationError(errors, relative, 'ORPHAN_CHILD', 'child is not registered by parent');
      }
    } else if (path.dirname(path.dirname(file)) !== path.join(workspaceRoot, '.agent-work', 'open')) {
      validationError(errors, relative, 'INVALID_PARENT', 'nested work requires a parent link');
    }
    for (const child of document.state.children) {
      const childFile = path.resolve(workspaceRoot, child.path);
      const linked = documents.get(childFile);
      if (!childFile.startsWith(`${workspaceRoot}${path.sep}`) || !linked || linked.state.parent === null || path.resolve(path.dirname(childFile), linked.state.parent) !== file) {
        validationError(errors, relative, 'INVALID_CHILD_LINK', `child link is not reciprocal: ${child.path}`);
      }
    }
    for (const assignment of document.state.assignments) {
      for (const accidental of [
        path.join(path.dirname(file), assignment.id, 'work.md'),
        path.join(path.dirname(file), 'children', assignment.id, 'work.md'),
      ]) if (await exists(accidental)) validationError(errors, relative, 'ASSIGNMENT_DIRECTORY', `assignment ${assignment.id} has a forbidden work directory`);
    }
    if (document.state.status === 'completed' && !document.state.parent) {
      validationError(errors, relative, 'UNARCHIVED_COMPLETION', 'completed top-level work must be archived');
    }
    for (const issue of document.state.status === 'completed' ? completionIssues(document) : []) {
      validationError(errors, relative, issue.code, issue.message);
    }
    }
    return { valid: errors.length === 0, checked: documents.size, errors };
  });
}
