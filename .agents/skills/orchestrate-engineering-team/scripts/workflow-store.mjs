import { constants as fsConstants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  decodeDocument,
  encodeDocument,
  leaseIso,
  newWorkspaceDocument,
  nowIso,
  persistedLeaseMinutes,
  validateDocument,
} from './workflow-document.mjs';
import { ensure, fail } from './workflow-contract.mjs';

/**
 * Tests whether a filesystem entry exists without exposing `ENOENT` to callers.
 *
 * @param {string} file - Filesystem path to inspect.
 * @returns {Promise<boolean>} `true` when the entry exists; otherwise `false`.
 */
export async function exists(file) {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the root workflow index for a project workspace.
 *
 * @param {string} root - Project root directory.
 * @returns {string} Path to the workspace `.agent-work/index.md`.
 */
export function workspaceIndex(root) {
  return path.join(root, '.agent-work', 'index.md');
}

/**
 * Reads, decodes, and validates a canonical workflow document.
 *
 * @param {string} file - Path to a workflow `index.md`.
 * @returns {Promise<object>} Parsed root or Work Item document.
 */
export async function readAt(file) {
  return decodeDocument(await readFile(file, 'utf8'), file);
}

/**
 * Executes one asynchronous operation while holding an exclusive adjacent lock file.
 *
 * @template T
 * @param {string} target - Document path whose critical section must be serialized.
 * @param {() => Promise<T>} operation - Critical section executed after lock acquisition.
 * @returns {Promise<T>} The operation's resolved value.
 */
async function withLock(target, operation) {
  const lockPath = `${target}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') fail(`locked: ${target}`, 'LOCKED');
    throw error;
  }
  try {
    return await operation();
  } finally {
    await lock.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

/**
 * Durably replaces one document through a same-directory temporary file and atomic rename.
 *
 * @param {string} target - Existing or new document path to replace.
 * @param {string} content - Complete canonical content to persist.
 * @returns {Promise<void>} Resolves after file and directory metadata are synchronized.
 */
async function atomicReplace(target, content) {
  const directory = path.dirname(target);
  const temp = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    // Failure before rename must preserve the previous document byte-for-byte.
    if (process.env.WORKFLOW_TEST_FAIL_BEFORE_RENAME === '1') {
      fail('injected atomic replacement failure', 'ATOMIC_FAILURE');
    }
    await rename(temp, target);
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}

/**
 * Creates a workflow document only when its target does not already exist.
 *
 * @param {string} target - Destination `index.md` path.
 * @param {object} document - Canonical workflow document to encode.
 * @returns {Promise<void>} Resolves after the document is atomically persisted.
 */
export async function createAt(target, document) {
  await mkdir(path.dirname(target), { recursive: true });
  return withLock(target, async () => {
    ensure(!(await exists(target)), `already exists: ${target}`, 'ALREADY_EXISTS');
    await atomicReplace(target, encodeDocument(document));
  });
}

/**
 * Verifies that a mutation uses the current owner and an unexpired lease.
 *
 * @param {object} document - Parsed Work Item document with owner and lease frontmatter.
 * @param {string} owner - Owner identity presented by the caller.
 * @param {Date} [now=new Date()] - Clock used for deterministic lease validation.
 * @returns {void} Returns when ownership and lease checks succeed.
 */
export function assertOwner(document, owner, now = new Date()) {
  ensure(
    typeof owner === 'string' && owner.length > 0,
    '--owner is required for this mutation',
    'OWNER_REQUIRED',
  );
  ensure(document.frontmatter.owner === owner, `owner mismatch for ${document.frontmatter.id}`, 'OWNER_MISMATCH');
  ensure(
    Date.parse(document.frontmatter.lease_until) > now.getTime(),
    `lease expired for ${document.frontmatter.id}; claim it again`,
    'LEASE_EXPIRED',
  );
}

/**
 * Atomically reads, mutates, validates, renews, and persists one workflow document.
 *
 * @template T
 * @param {string} target - Workflow document path to mutate.
 * @param {{owner?: string, now?: Date, requireOwner?: boolean, renew?: boolean}} options - Ownership, clock, and renewal policy.
 * @param {(document: object) => T | Promise<T>} mutate - In-memory mutation run while the lock is held.
 * @returns {Promise<T>} The mutation callback's result after persistence succeeds.
 */
export async function mutateAt(
  target,
  { owner, now = new Date(), requireOwner = true, renew = true } = {},
  mutate,
) {
  // The adjacent lock covers the complete read-to-rename interval so ownership and lease checks are atomic.
  return withLock(target, async () => {
    const document = decodeDocument(await readFile(target, 'utf8'), target);
    if (requireOwner) assertOwner(document, owner, now);
    const renewalMinutes = renew && document.kind === 'work'
      ? persistedLeaseMinutes(document)
      : null;
    const result = await mutate(document);
    if (renew && document.kind === 'work') {
      document.frontmatter.lease_until = leaseIso(now, renewalMinutes);
      document.frontmatter.updated_at = nowIso(now);
    } else {
      document.frontmatter.updated_at = nowIso(now);
    }
    validateDocument(document, { file: target, root: document.kind === 'root' });
    await atomicReplace(target, encodeDocument(document));
    return result;
  });
}

/**
 * Discovers every Work Item index reachable through canonical `children` directories.
 *
 * @param {string} root - Project root containing `.agent-work`.
 * @returns {Promise<string[]>} Sorted paths for top-level and nested Work Item indexes.
 */
export async function listWork(root) {
  const base = path.join(root, '.agent-work', 'work-items');
  if (!(await exists(base))) return [];
  const files = [];
  /**
   * Recursively visits a canonical Work Item directory level.
   *
   * @param {string} directory - Directory containing semantic Work Item folders.
   * @returns {Promise<void>} Resolves after all reachable descendants are inspected.
   */
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      const index = path.join(child, 'index.md');
      if (await exists(index)) files.push(index);
      const children = path.join(child, 'children');
      if (await exists(children)) await walk(children);
    }
  }
  await walk(base);
  return files.sort();
}

/**
 * Resolves a Work Item ID or path against the discovered topology allowlist.
 *
 * @param {string} root - Project root containing `.agent-work`.
 * @param {string} reference - Semantic ID, Work Item directory, or index path.
 * @returns {Promise<string>} Unique canonical Work Item index path.
 */
export async function resolveWork(root, reference) {
  ensure(typeof reference === 'string' && reference.trim(), '--work is required', 'INVALID_INPUT');
  const direct = path.resolve(root, reference);
  const files = await listWork(root);
  // References can only resolve to files discovered under the workflow topology allowlist.
  const allowed = new Set(files.map((file) => path.resolve(file)));
  for (const candidate of [path.join(direct, 'index.md'), direct].map((file) => path.resolve(file))) {
    if (allowed.has(candidate)) return candidate;
  }
  const matches = [];
  for (const file of files) {
    const document = await readAt(file);
    if (document.frontmatter.id === reference) matches.push(file);
  }
  ensure(
    matches.length === 1,
    matches.length ? `ambiguous work id: ${reference}` : `work not found: ${reference}`,
    'WORK_NOT_FOUND',
  );
  return matches[0];
}

/**
 * Creates the workspace root when absent, or validates the existing root document.
 *
 * @param {string} root - Project root to initialize.
 * @param {Date} [now=new Date()] - Clock used for deterministic timestamps.
 * @returns {Promise<{ok: true, workspace: string}>} Success marker and project-relative root-index path.
 */
export async function initWorkspace(root, now = new Date()) {
  const file = workspaceIndex(root);
  await mkdir(path.join(root, '.agent-work', 'work-items'), { recursive: true });
  if (!(await exists(file))) await createAt(file, newWorkspaceDocument(now));
  else validateDocument(await readAt(file), { file, root: true });
  return { ok: true, workspace: path.relative(root, file) };
}
