import { constants as fsConstants } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, cp, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, stat, symlink, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { decorateWork, markdownTitle, nowIso, persistedLeaseMinutes, sectionBody, syncWork, validateDocument } from './workflow-document.mjs';
import { ensure, fail } from './workflow-contract.mjs';

/**
 * Reports whether a path exists.
 * @param {string} file - Filesystem path.
 * @returns {Promise<boolean>} Existence result.
 */
export async function exists(file) {
  try { await access(file, fsConstants.F_OK); return true; } catch { return false; }
}

/**
 * Reports whether a directory entry exists without following its final symlink.
 * @param {string} file - Filesystem path.
 * @returns {Promise<boolean>} Entry existence result.
 */
async function entryExists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/**
 * Synchronizes one directory entry set after a rename or unlink.
 * @param {string} directory - Real directory to synchronize.
 * @returns {Promise<void>} Resolves after filesystem metadata is flushed.
 */
async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAIR_JOURNAL = '.pair.commit.json';
const PAIR_TEMP_PATTERN = /^\.(?:work\.md|state\.json)\.[a-f0-9-]+\.pairtmp$/;
const PROJECT_LOCK = '.agent-work.workflow.lock';
const PROJECT_LOCK_CREATOR = '.agent-work.workflow.lock.creator';
const PROJECT_LOCK_WAIT_MS = 30_000;
const PROJECT_LOCK_HEARTBEAT_MS = 2_000;
const ARCHIVE_ATTEMPT_GRACE_MS = 6_000;
const projectLockContext = new AsyncLocalStorage();
const activeArchiveAttempts = new Set();
const execFile = promisify(execFileCallback);

/**
 * Pauses at a test-only cross-process barrier.
 * @param {string} variable - Environment variable containing the barrier prefix.
 * @returns {Promise<void>} Resolves when the paired release file appears.
 */
async function waitForTestBarrier(variable) {
  const barrier = process.env[variable];
  if (!barrier) return;
  await atomicReplace(`${barrier}.ready`, 'ready\n');
  const deadline = Date.now() + 15_000;
  while (!(await entryExists(`${barrier}.release`))) {
    if (Date.now() >= deadline) fail(`injected barrier timed out: ${variable}`, 'ATOMIC_FAILURE');
    await delay(10);
  }
}

/**
 * Returns a SHA-256 digest for persisted bytes.
 * @param {string|Buffer} value - Bytes to digest.
 * @returns {string} Lowercase hex digest.
 */
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Reports whether one raw ancestor is the fixed macOS `/var` compatibility alias.
 * @param {string} candidate - Raw absolute ancestor.
 * @returns {Promise<boolean>} Whether the platform-owned alias is accepted.
 */
async function isMacOsVarAlias(candidate) {
  return process.platform === 'darwin'
    && candidate === '/var'
    && await realpath(candidate).catch(() => '') === '/private/var';
}

/**
 * Validates a raw absolute path component-by-component before any normalization.
 * @param {string} raw - Raw absolute path.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<string>} Unchanged raw path.
 */
async function validateRawAbsoluteChain(raw, label) {
  ensure(typeof raw === 'string' && path.isAbsolute(raw), `${label} must be an absolute path`, 'INVALID_WORKSPACE');
  ensure(!raw.includes('\\') && !raw.includes('//'), `${label} is not canonical: ${raw}`, 'INVALID_WORKSPACE');
  const components = raw.split('/').slice(1);
  ensure(components.every((component) => component && component !== '.' && component !== '..'), `${label} contains traversal syntax: ${raw}`, 'INVALID_WORKSPACE');
  let current = path.parse(raw).root;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stats;
    try { stats = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stats.isSymbolicLink()) ensure(await isMacOsVarAlias(current), `${label} has a symlinked ancestor: ${current}`, 'INVALID_WORKSPACE');
    else if (index < components.length - 1) ensure(stats.isDirectory(), `${label} has a non-directory ancestor: ${current}`, 'INVALID_WORKSPACE');
  }
  return raw;
}

/**
 * Captures stable platform filesystem identity for a real directory.
 * @param {string} target - Exact directory path.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<object>} Serializable identity proof.
 */
async function directoryIdentity(target, label) {
  await validateRawAbsoluteChain(target, label);
  let stats;
  try { stats = await lstat(target, { bigint: true }); } catch { fail(`${label} is missing: ${target}`, 'INVALID_ARCHIVE'); }
  ensure(stats.isDirectory() && !stats.isSymbolicLink(), `${label} must be a real directory: ${target}`, 'INVALID_ARCHIVE');
  return { dev: String(stats.dev), ino: String(stats.ino), birthtime_ns: String(stats.birthtimeNs) };
}

/**
 * Validates one serialized directory identity.
 * @param {object} identity - Candidate identity.
 * @param {string} label - Diagnostic label.
 * @returns {object} Valid identity.
 */
function validateDirectoryIdentity(identity, label) {
  ensure(identity && JSON.stringify(Object.keys(identity).sort()) === JSON.stringify(['birthtime_ns', 'dev', 'ino']), `${label} identity is malformed`, 'INVALID_ARCHIVE');
  ensure(Object.values(identity).every((value) => typeof value === 'string' && /^\d+$/.test(value)), `${label} identity is invalid`, 'INVALID_ARCHIVE');
  return identity;
}

/**
 * Requires a path to still name the exact captured directory object.
 * @param {string} target - Exact directory path.
 * @param {object} expected - Captured identity.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<void>} Resolves only while identity is unchanged.
 */
async function requireDirectoryIdentity(target, expected, label) {
  ensure(JSON.stringify(await directoryIdentity(target, label)) === JSON.stringify(validateDirectoryIdentity(expected, label)), `${label} object identity changed: ${target}`, 'INVALID_ARCHIVE');
}

/**
 * Captures stable platform filesystem identity for a real regular file.
 * @param {string} target - Exact file path.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<object>} Serializable identity proof.
 */
async function fileIdentity(target, label) {
  await validateRawAbsoluteChain(target, label);
  let stats;
  try { stats = await lstat(target, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') throw error; fail(`${label} is missing: ${target}`, 'LOCKED'); }
  ensure(stats.isFile() && !stats.isSymbolicLink(), `${label} must be a real file: ${target}`, 'LOCKED');
  return { dev: String(stats.dev), ino: String(stats.ino), birthtime_ns: String(stats.birthtimeNs) };
}

/**
 * Requires a path to still name the exact captured regular-file object.
 * @param {string} target - Exact file path.
 * @param {object} expected - Captured identity.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<void>} Resolves only while identity is unchanged.
 */
async function requireFileIdentity(target, expected, label) {
  ensure(JSON.stringify(await fileIdentity(target, label)) === JSON.stringify(validateDirectoryIdentity(expected, label)), `${label} object identity changed: ${target}`, 'LOCKED');
}

/**
 * Anchors a project root to its lexical identity without accepting any symlinked ancestor.
 * @param {string} root - Candidate project root.
 * @param {{create?: boolean}} options - Whether initialization may create the exact missing root chain.
 * @returns {Promise<string>} Canonical absolute project root.
 */
async function anchoredProjectRoot(root, { create = false } = {}) {
  ensure(typeof root === 'string' && root.length > 0, 'project root is required', 'INVALID_INPUT');
  await validateRawAbsoluteChain(root, 'project root');
  const lexical = root;
  if (create && !(await entryExists(lexical))) {
    const missing = [];
    let existing = lexical;
    while (!(await entryExists(existing))) {
      missing.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      ensure(parent !== existing, `project root has no existing ancestor: ${lexical}`, 'INVALID_WORKSPACE');
      existing = parent;
    }
    const existingStats = await lstat(existing);
    ensure(existingStats.isDirectory() && !existingStats.isSymbolicLink(), `project root ancestor must be a real directory: ${existing}`, 'INVALID_WORKSPACE');
    let expected = await realpath(existing);
    for (const component of missing) {
      existing = path.join(existing, component);
      expected = path.join(expected, component);
      await mkdir(existing);
      await requireRealDirectory(existing, expected, 'project root');
    }
  }
  let stats;
  try { stats = await lstat(lexical); } catch { fail(`project root is missing: ${lexical}`, 'INVALID_WORKSPACE'); }
  ensure(stats.isDirectory() && !stats.isSymbolicLink(), `project root must be a real directory: ${lexical}`, 'INVALID_WORKSPACE');
  return lexical;
}

/**
 * Requires every existing component below a project root to be a real directory.
 * @param {string} project - Anchored project root.
 * @param {string[]} components - Relative directory components.
 * @param {{create?: boolean, mode?: number}} options - Safe creation options.
 * @returns {Promise<string>} Final anchored directory.
 */
async function anchoredDirectory(project, components, { create = false, mode = 0o700 } = {}) {
  let current = project;
  let expected = await realpath(project);
  for (const component of components) {
    ensure(component && component !== '.' && component !== '..' && !component.includes(path.sep), `invalid workspace component: ${component}`, 'INVALID_WORKSPACE');
    current = path.join(current, component);
    expected = path.join(expected, component);
    if (create && !(await entryExists(current))) await mkdir(current, { mode });
    await requireRealDirectory(current, expected, `workspace directory ${component}`);
  }
  return current;
}

/**
 * Opens and reads a regular file without following its final entry.
 * @param {string} file - Exact regular-file path.
 * @param {string|null} encoding - Optional text encoding.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<string|Buffer>} File contents.
 */
async function readFileNoFollow(file, encoding = null, label = 'file') {
  let handle;
  try { handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
  catch { fail(`${label} must be a real file: ${file}`, 'INVALID_WORKSPACE'); }
  try {
    const stats = await handle.stat();
    ensure(stats.isFile(), `${label} must be a regular file: ${file}`, 'INVALID_WORKSPACE');
    return await handle.readFile(encoding ? { encoding } : undefined);
  } finally { await handle.close(); }
}

/**
 * Returns the sibling state path.
 * @param {string} workFile - Work document path.
 * @returns {string} State path.
 */
export function statePath(workFile) {
  return path.join(path.dirname(workFile), 'state.json');
}

/**
 * Parses a canonical open Work Item path far enough to select its project lock.
 * @param {string} file - Work document path.
 * @returns {Promise<{project: string, workFile: string, relative: string[]}>} Parsed path context.
 */
async function openWorkProject(file) {
  const raw = path.basename(file) === 'state.json' ? path.join(path.dirname(file), 'work.md') : file;
  await validateRawAbsoluteChain(raw, 'open Work Item path');
  const supplied = raw;
  const marker = `${path.sep}.agent-work${path.sep}`;
  const markerAt = supplied.indexOf(marker);
  ensure(markerAt > 0, `work path is outside .agent-work: ${file}`, 'INVALID_WORKSPACE');
  const project = await anchoredProjectRoot(supplied.slice(0, markerAt));
  const workFile = supplied;
  const relative = path.relative(project, workFile).split(path.sep);
  ensure(relative[0] === '.agent-work' && relative[1] === 'open' && relative.at(-1) === 'work.md', `work path is not canonical: ${file}`, 'INVALID_WORKSPACE');
  const topology = relative.slice(2, -1);
  ensure(topology.length >= 1 && topology.length % 2 === 1, `work path topology is invalid: ${file}`, 'INVALID_WORKSPACE');
  for (let index = 0; index < topology.length; index += 1) {
    ensure(index % 2 === 0 ? ID_PATTERN.test(topology[index]) : topology[index] === 'children', `work path topology is invalid: ${file}`, 'INVALID_WORKSPACE');
  }
  return { project, workFile, relative };
}

/**
 * Parses and anchors a canonical open Work Item path.
 * @param {string} file - Work document path.
 * @returns {Promise<{project: string, workFile: string, directory: string}>} Anchored path context.
 */
async function openWorkContext(file) {
  const { project, workFile, relative } = await openWorkProject(file);
  const directory = await anchoredDirectory(project, relative.slice(0, -1));
  return { project, workFile, directory };
}

/**
 * Reads the digest of an existing real file, or null when absent.
 * @param {string} file - Exact file path.
 * @returns {Promise<string|null>} Content digest.
 */
async function existingDigest(file) {
  if (!(await entryExists(file))) return null;
  return digest(await readFileNoFollow(file, null, 'paired document'));
}

/**
 * Validates the operational pair-commit journal.
 * @param {object} journal - Parsed journal.
 * @returns {object} Validated journal.
 */
function validatePairJournal(journal) {
  ensure(journal && typeof journal === 'object' && !Array.isArray(journal), 'pair commit journal must be an object', 'INVALID_DOCUMENT');
  ensure(JSON.stringify(Object.keys(journal).sort()) === JSON.stringify(['new', 'old', 'temp', 'version']), 'pair commit journal has unexpected fields', 'INVALID_DOCUMENT');
  ensure(journal.version === 1, 'pair commit journal version is invalid', 'INVALID_DOCUMENT');
  for (const side of ['old', 'new']) {
    ensure(journal[side] && JSON.stringify(Object.keys(journal[side]).sort()) === JSON.stringify(['state', 'work']), `pair commit ${side} hashes are malformed`, 'INVALID_DOCUMENT');
    for (const value of Object.values(journal[side])) ensure(value === null || /^[a-f0-9]{64}$/.test(value), `pair commit ${side} hash is invalid`, 'INVALID_DOCUMENT');
  }
  ensure(journal.new.work && journal.new.state, 'pair commit target hashes are required', 'INVALID_DOCUMENT');
  ensure(journal.temp && JSON.stringify(Object.keys(journal.temp).sort()) === JSON.stringify(['state', 'work']), 'pair commit temp names are malformed', 'INVALID_DOCUMENT');
  ensure(/^\.work\.md\.[a-f0-9-]+\.pairtmp$/.test(journal.temp.work), 'pair commit work temp is invalid', 'INVALID_DOCUMENT');
  ensure(/^\.state\.json\.[a-f0-9-]+\.pairtmp$/.test(journal.temp.state), 'pair commit state temp is invalid', 'INVALID_DOCUMENT');
  return journal;
}

/**
 * Recovers or finalizes one interrupted semantic/operational pair publication.
 * @param {string} workFile - Canonical work.md path.
 * @returns {Promise<void>} Resolves once the pair is on one committed generation.
 */
async function recoverPair(workFile) {
  const directory = path.dirname(workFile);
  const journalFile = path.join(directory, PAIR_JOURNAL);
  const pairTemps = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => PAIR_TEMP_PATTERN.test(entry.name));
  if (!(await entryExists(journalFile))) {
    for (const entry of pairTemps) {
      ensure(entry.isFile() && !entry.isSymbolicLink(), `orphan pair temp must be a real file: ${entry.name}`, 'INVALID_DOCUMENT');
      await unlink(path.join(directory, entry.name));
    }
    if (pairTemps.length) await syncDirectory(directory);
    return;
  }
  let journal;
  try { journal = validatePairJournal(JSON.parse(await readFileNoFollow(journalFile, 'utf8', 'pair commit journal'))); }
  catch (error) { if (error.code) throw error; fail(`invalid JSON: ${journalFile}`, 'INVALID_DOCUMENT'); }
  const expectedTemps = new Set(Object.values(journal.temp));
  ensure(pairTemps.every((entry) => expectedTemps.has(entry.name)), 'pair commit directory contains an unrelated transaction temp', 'INVALID_DOCUMENT');
  for (const name of ['work', 'state']) {
    const target = name === 'work' ? workFile : statePath(workFile);
    const current = await existingDigest(target);
    if (current === journal.new[name]) continue;
    ensure(current === journal.old[name], `paired ${name} document does not match either committed generation`, 'INVALID_DOCUMENT');
    const temp = path.join(directory, journal.temp[name]);
    ensure(await existingDigest(temp) === journal.new[name], `paired ${name} recovery bytes are missing or changed`, 'INVALID_DOCUMENT');
    await rename(temp, target);
  }
  ensure(await existingDigest(workFile) === journal.new.work && await existingDigest(statePath(workFile)) === journal.new.state, 'paired document recovery did not converge', 'INVALID_DOCUMENT');
  for (const temp of expectedTemps) {
    const tempFile = path.join(directory, temp);
    if (await entryExists(tempFile)) {
      ensure(await existingDigest(tempFile) === (temp.startsWith('.work.md.') ? journal.new.work : journal.new.state), 'pair recovery temp changed after commit', 'INVALID_DOCUMENT');
      await unlink(tempFile);
    }
  }
  await syncDirectory(directory);
  await unlink(journalFile);
  await syncDirectory(directory);
}

/**
 * Reads a paired open Work Item.
 * @param {string} file - Work or state path.
 * @returns {Promise<object>} Valid document.
 */
export async function readAt(file) {
  const initial = await openWorkProject(file);
  return withProjectLock(initial.project, async () => {
    const { workFile } = await openWorkContext(file);
    await recoverPair(workFile);
    const [markdown, rawState] = await Promise.all([
      readFileNoFollow(workFile, 'utf8', 'work.md'),
      readFileNoFollow(statePath(workFile), 'utf8', 'state.json'),
    ]);
    let state;
    try { state = JSON.parse(rawState); } catch { fail(`invalid JSON: ${statePath(workFile)}`, 'INVALID_DOCUMENT'); }
    const document = decorateWork({ kind: 'work', markdown, state });
    validateDocument(document, { file: workFile });
    return document;
  });
}

/**
 * Validates a complete project-lock owner record.
 * @param {object} record - Parsed owner record.
 * @returns {object} Validated owner record.
 */
function validateProjectLock(record) {
  ensure(record && JSON.stringify(Object.keys(record).sort()) === JSON.stringify(['created_at', 'heartbeat_ms', 'nonce', 'pid', 'process_start', 'version']), 'project lock record is malformed', 'LOCKED');
  ensure(record.version === 2 && Number.isInteger(record.pid) && record.pid > 0, 'project lock owner is invalid', 'LOCKED');
  ensure(
    /^[a-f0-9-]{36}$/.test(record.nonce) && !Number.isNaN(Date.parse(record.created_at))
      && (record.process_start === null || typeof record.process_start === 'string' && record.process_start.length > 0)
      && record.heartbeat_ms === PROJECT_LOCK_HEARTBEAT_MS,
    'project lock identity is invalid',
    'LOCKED',
  );
  return record;
}

/**
 * Reports whether a local PID currently exists.
 * @param {number} pid - Recorded process identifier.
 * @returns {boolean} Whether the PID exists or cannot safely be proven absent.
 */
function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

/**
 * Reads a platform-available process-start identity to distinguish PID reuse.
 * @param {number} pid - Process identifier.
 * @returns {Promise<string|null>} Stable start token, or null when unavailable.
 */
async function processStartIdentity(pid) {
  if (!processExists(pid)) return null;
  if (process.platform === 'linux') {
    try {
      const value = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : null;
    } catch { return null; }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 2_000 });
      const value = stdout.trim().replace(/\s+/g, ' ');
      return value ? `darwin:${value}` : null;
    } catch { return null; }
  }
  return null;
}

/**
 * Determines owner liveness without treating a reused PID as the lock owner.
 * @param {object} record - Validated owner record.
 * @param {string} ownerFile - Heartbeat-bearing owner metadata.
 * @returns {Promise<boolean>} Whether the recorded owner is live or conservatively retained.
 */
async function lockOwnerIsLive(record, ownerFile) {
  if (!processExists(record.pid)) return false;
  const currentStart = await processStartIdentity(record.pid);
  if (record.process_start && currentStart) return record.process_start === currentStart;
  const heartbeat = await stat(ownerFile).catch(() => null);
  if (heartbeat && Date.now() - heartbeat.mtimeMs <= record.heartbeat_ms * 3) return true;
  return true;
}

/**
 * Removes one exact creator claim after rename-based ownership transfer.
 * @param {string} claimFile - Public creator-claim path.
 * @param {object} identity - Captured claim identity.
 * @returns {Promise<void>} Resolves after removing only the captured claim.
 */
async function removeCreatorClaim(claimFile, identity) {
  await requireFileIdentity(claimFile, identity, 'project lock creator claim');
  const detached = `${claimFile}.detached-${randomUUID()}`;
  await rename(claimFile, detached);
  await requireFileIdentity(detached, identity, 'detached project lock creator claim');
  await unlink(detached);
  await syncDirectory(path.dirname(claimFile));
}

/**
 * Prunes only dead-process private creator staging files left before claim publication.
 * @param {string} project - Anchored project root.
 * @returns {Promise<void>} Resolves after conservative residue maintenance.
 */
async function pruneCreatorTemps(project) {
  for (const entry of await readdir(project, { withFileTypes: true })) {
    const match = /^\.agent-work\.workflow\.lock\.creator\.(\d+)\.([a-f0-9-]{36})\.tmp$/.exec(entry.name);
    if (!match) continue;
    const file = path.join(project, entry.name);
    ensure(entry.isFile() && !entry.isSymbolicLink(), `project lock creator staging entry is invalid: ${file}`, 'LOCKED');
    const pid = Number(match[1]);
    if (processExists(pid)) {
      let record;
      try { record = validateProjectLock(JSON.parse(await readFileNoFollow(file, 'utf8', 'project lock creator staging'))); }
      catch { continue; }
      if (await lockOwnerIsLive(record, file)) continue;
    }
    const identity = await fileIdentity(file, 'abandoned project lock creator staging');
    await removeCreatorClaim(file, identity);
  }
}

/**
 * Acquires the atomically published creator claim that precedes lock-directory creation.
 * @param {string} project - Anchored project root.
 * @param {number} deadline - Absolute acquisition deadline.
 * @returns {Promise<{claimFile: string, identity: object, record: object, replacedDeadCreator: boolean}>} Held creator proof.
 */
async function acquireCreatorClaim(project, deadline) {
  const claimFile = path.join(project, PROJECT_LOCK_CREATOR);
  let replacedDeadCreator = false;
  await pruneCreatorTemps(project);
  while (true) {
    const record = validateProjectLock({
      version: 2,
      pid: process.pid,
      nonce: randomUUID(),
      process_start: await processStartIdentity(process.pid),
      heartbeat_ms: PROJECT_LOCK_HEARTBEAT_MS,
      created_at: new Date().toISOString(),
    });
    const staged = path.join(project, `.${PROJECT_LOCK_CREATOR}.${process.pid}.${record.nonce}.tmp`);
    await stageFile(staged, `${JSON.stringify(record)}\n`);
    try {
      await link(staged, claimFile);
      const identity = await fileIdentity(claimFile, 'project lock creator claim');
      ensure(JSON.stringify(identity) === JSON.stringify(await fileIdentity(staged, 'staged project lock creator claim')), 'creator claim publication changed identity', 'LOCKED');
      await unlink(staged);
      await syncDirectory(project);
      return { claimFile, identity, record, replacedDeadCreator };
    } catch (error) {
      await unlink(staged).catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      let identity;
      let existing;
      try {
        identity = await fileIdentity(claimFile, 'project lock creator claim');
        existing = validateProjectLock(JSON.parse(await readFileNoFollow(claimFile, 'utf8', 'project lock creator claim')));
      } catch (claimError) {
        if (claimError.code === 'ENOENT') continue;
        let current;
        try { current = await fileIdentity(claimFile, 'project lock creator claim'); }
        catch (currentError) { if (currentError.code === 'ENOENT') continue; throw claimError; }
        if (identity && JSON.stringify(current) !== JSON.stringify(identity)) continue;
        throw claimError;
      }
      try { await requireFileIdentity(claimFile, identity, 'project lock creator claim'); }
      catch {
        if (Date.now() >= deadline) fail(`locked: ${project}`, 'LOCKED');
        await delay(20);
        continue;
      }
      if (!(await lockOwnerIsLive(existing, claimFile))) {
        try { await removeCreatorClaim(claimFile, identity); }
        catch {
          if (Date.now() >= deadline) fail(`locked: ${project}`, 'LOCKED');
          await delay(20);
          continue;
        }
        replacedDeadCreator = true;
        continue;
      }
      if (Date.now() >= deadline) fail(`locked: ${project}`, 'LOCKED');
      await delay(20);
    }
  }
}

/**
 * Removes one exact lock directory after rename-based ownership transfer.
 * @param {string} lockPath - Public or detached lock directory.
 * @param {object} identity - Captured directory identity.
 * @param {{allowIncomplete?: boolean}} options - Whether an old incomplete lock is eligible.
 * @returns {Promise<void>} Resolves after the exact lock object is removed.
 */
async function removeOwnedLockDirectory(lockPath, identity, { allowIncomplete = false } = {}) {
  await requireDirectoryIdentity(lockPath, identity, 'project lock');
  const entries = await readdir(lockPath, { withFileTypes: true });
  const incomplete = entries.every((entry) => entry.isFile() && !entry.isSymbolicLink() && /^\.owner\.json\.\d+\.\d+\.tmp$/.test(entry.name));
  ensure(
    incomplete && allowIncomplete
      || entries.length === 1 && entries[0].name === 'owner.json' && entries[0].isFile() && !entries[0].isSymbolicLink(),
    'project lock directory contains unrelated data',
    'LOCKED',
  );
  const detached = `${lockPath}.detached-${randomUUID()}`;
  await rename(lockPath, detached);
  await requireDirectoryIdentity(detached, identity, 'detached project lock');
  for (const entry of entries) await unlink(path.join(detached, entry.name));
  await requireDirectoryIdentity(detached, identity, 'detached project lock');
  await rmdir(detached);
  await syncDirectory(path.dirname(lockPath));
}

/**
 * Reclaims a provably dead lock or an old empty pre-metadata crash.
 * @param {string} lockPath - Public lock directory.
 * @param {{allowIncomplete?: boolean}} options - Whether a dead creator claim authorizes incomplete recovery.
 * @returns {Promise<boolean>} Whether the stale object was removed.
 */
async function recoverStaleProjectLock(lockPath, { allowIncomplete = false } = {}) {
  if (!(await entryExists(lockPath))) return true;
  let identity;
  let lockStats;
  try {
    lockStats = await lstat(lockPath);
    ensure(lockStats.isDirectory() && !lockStats.isSymbolicLink(), `project lock must be a real directory: ${lockPath}`, 'INVALID_WORKSPACE');
    identity = await directoryIdentity(lockPath, 'project lock');
  } catch (error) {
    if (!(await entryExists(lockPath))) return true;
    const current = await lstat(lockPath);
    ensure(current.isDirectory() && !current.isSymbolicLink(), `project lock must be a real directory: ${lockPath}`, 'INVALID_WORKSPACE');
    if (error.code === 'INVALID_WORKSPACE') throw error;
    return false;
  }
  let entries;
  try { entries = await readdir(lockPath, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  const incomplete = entries.every((entry) => entry.isFile() && !entry.isSymbolicLink() && /^\.owner\.json\.\d+\.\d+\.tmp$/.test(entry.name));
  if (incomplete) {
    if (!allowIncomplete) return false;
    await removeOwnedLockDirectory(lockPath, identity, { allowIncomplete: true });
    return true;
  }
  ensure(entries.length === 1 && entries[0].name === 'owner.json' && entries[0].isFile() && !entries[0].isSymbolicLink(), 'project lock directory contains unrelated data', 'LOCKED');
  let record;
  try { record = validateProjectLock(JSON.parse(await readFileNoFollow(path.join(lockPath, 'owner.json'), 'utf8', 'project lock owner'))); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'INVALID_WORKSPACE') return !(await entryExists(lockPath));
    if (error.code) throw error;
    fail('project lock owner JSON is invalid', 'LOCKED');
  }
  try { await requireDirectoryIdentity(lockPath, identity, 'project lock'); }
  catch (error) {
    if (!(await entryExists(lockPath))) return true;
    return false;
  }
  if (await lockOwnerIsLive(record, path.join(lockPath, 'owner.json'))) return false;
  try { await removeOwnedLockDirectory(lockPath, identity); }
  catch (error) {
    if (!(await entryExists(lockPath))) return true;
    return false;
  }
  return true;
}

/**
 * Acquires the one atomic-directory project lock.
 * @param {string} project - Anchored project root.
 * @returns {Promise<{identity: object, lockPath: string, ownerFile: string, token: object}>} Held-lock proof.
 */
async function acquireProjectLock(project) {
  const rootIdentity = await directoryIdentity(project, 'project root');
  const lockPath = path.join(project, PROJECT_LOCK);
  const deadline = Date.now() + PROJECT_LOCK_WAIT_MS;
  const creator = await acquireCreatorClaim(project, deadline);
  let ownedLock = null;
  try {
    while (true) {
      await requireDirectoryIdentity(project, rootIdentity, 'project root');
      try {
        await mkdir(lockPath, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await recoverStaleProjectLock(lockPath, { allowIncomplete: creator.replacedDeadCreator })) continue;
        if (Date.now() >= deadline) fail(`locked: ${project}`, 'LOCKED');
        await delay(20);
        continue;
      }
      const identity = await directoryIdentity(lockPath, 'project lock');
      ownedLock = identity;
      const ownerFile = path.join(lockPath, 'owner.json');
      await waitForTestBarrier('WORKFLOW_TEST_LOCK_CREATOR_BARRIER');
      await atomicReplace(ownerFile, `${JSON.stringify({
        ...creator.record,
      })}\n`);
      await Promise.all([syncDirectory(lockPath), syncDirectory(project)]);
      await requireDirectoryIdentity(lockPath, identity, 'project lock');
      return { creator, identity, lockPath, ownerFile, token: { active: true } };
    }
  } catch (error) {
    if (ownedLock && await entryExists(lockPath)) await removeOwnedLockDirectory(lockPath, ownedLock, { allowIncomplete: true });
    if (await entryExists(creator.claimFile)) await removeCreatorClaim(creator.claimFile, creator.identity);
    throw error;
  }
}

/**
 * Runs an operation under the project-wide cross-process lock.
 * @param {string} project - Anchored project root.
 * @param {Function} operation - Protected operation.
 * @returns {Promise<unknown>} Operation result.
 */
async function withProjectLock(project, operation) {
  const held = projectLockContext.getStore();
  if (held?.project === project && held.token.active) return operation();
  const lock = await acquireProjectLock(project);
  const heartbeat = setInterval(() => {
    const now = new Date();
    void Promise.all([
      utimes(lock.ownerFile, now, now),
      utimes(lock.creator.claimFile, now, now),
    ]).catch(() => {});
  }, PROJECT_LOCK_HEARTBEAT_MS);
  heartbeat.unref();
  try { return await projectLockContext.run({ project, token: lock.token }, operation); }
  finally {
    lock.token.active = false;
    clearInterval(heartbeat);
    await removeOwnedLockDirectory(lock.lockPath, lock.identity);
    await removeCreatorClaim(lock.creator.claimFile, lock.creator.identity);
  }
}

/**
 * Serializes one complete high-level workflow transaction at a project root.
 * @param {string} root - Raw project root.
 * @param {Function} operation - Complete application operation.
 * @param {{create?: boolean}} options - Whether the project root may be created.
 * @returns {Promise<unknown>} Operation result.
 */
export async function withWorkflowTransaction(root, operation, { create = false } = {}) {
  const project = await anchoredProjectRoot(root, { create });
  return withProjectLock(project, operation);
}

/**
 * Exposes a test-only cross-process barrier without changing production state.
 * @param {string} variable - Barrier environment variable.
 * @returns {Promise<void>} Resolves when the test releases the barrier.
 */
export async function waitForWorkflowTestBarrier(variable) {
  return waitForTestBarrier(variable);
}

/**
 * Atomically replaces one file.
 * @param {string} target - Destination path.
 * @param {string} content - Replacement bytes.
 * @param {Function|null} guard - Optional identity guard run immediately around publication.
 * @returns {Promise<void>} Resolves after persistence.
 */
export async function atomicReplace(target, content, guard = null) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    if (process.env.WORKFLOW_TEST_FAIL_BEFORE_RENAME === '1') fail('injected atomic replacement failure', 'ATOMIC_FAILURE');
    if (guard) await guard();
    await rename(temp, target);
    if (guard) await guard();
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}

/**
 * Writes durable bytes to a new same-directory staging file.
 * @param {string} file - Staging path.
 * @param {string} content - Complete contents.
 * @returns {Promise<void>} Resolves after the staged file is synchronized.
 */
async function stageFile(file, content) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}

/**
 * Publishes work.md and state.json as one recoverable generation.
 * @param {string} workFile - Canonical work.md target.
 * @param {string} markdown - Human semantic document.
 * @param {string} stateText - Disposable operational state.
 * @param {{failAfterWork?: boolean}} options - Test-only interruption selection.
 * @returns {Promise<void>} Resolves after both files and journal cleanup are durable.
 */
async function publishPair(workFile, markdown, stateText, { failAfterWork = false } = {}) {
  const directory = path.dirname(workFile);
  await recoverPair(workFile);
  const nonce = randomUUID();
  const workTemp = `.work.md.${nonce}.pairtmp`;
  const stateTemp = `.state.json.${nonce}.pairtmp`;
  const journalFile = path.join(directory, PAIR_JOURNAL);
  const journal = validatePairJournal({
    version: 1,
    old: { work: await existingDigest(workFile), state: await existingDigest(statePath(workFile)) },
    new: { work: digest(markdown), state: digest(stateText) },
    temp: { work: workTemp, state: stateTemp },
  });
  await Promise.all([
    stageFile(path.join(directory, workTemp), markdown),
    stageFile(path.join(directory, stateTemp), stateText),
  ]);
  await waitForTestBarrier('WORKFLOW_TEST_PAIR_PRE_JOURNAL_BARRIER');
  try {
    await atomicReplace(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  } catch (error) {
    await Promise.all([unlink(path.join(directory, workTemp)).catch(() => {}), unlink(path.join(directory, stateTemp)).catch(() => {})]);
    throw error;
  }
  await rename(path.join(directory, workTemp), workFile);
  if (process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_WORK === '1' || failAfterWork) fail('injected paired publication interruption', 'ATOMIC_FAILURE');
  await rename(path.join(directory, stateTemp), statePath(workFile));
  if (process.env.WORKFLOW_TEST_FAIL_PAIR_AFTER_STATE === '1') fail('injected paired publication interruption', 'ATOMIC_FAILURE');
  await syncDirectory(directory);
  await unlink(journalFile);
  await syncDirectory(directory);
}

/**
 * Creates a paired Work Item.
 * @param {string} target - Work document path.
 * @param {object} document - Work model.
 * @returns {Promise<void>} Resolves after creation.
 */
export async function createAt(target, document) {
  let workFile = path.basename(target) === 'state.json' ? path.join(path.dirname(target), 'work.md') : target;
  await validateRawAbsoluteChain(workFile, 'new Work Item path');
  const marker = `${path.sep}.agent-work${path.sep}`;
  const absolute = path.resolve(workFile);
  const markerAt = absolute.indexOf(marker);
  ensure(markerAt > 0, `work path is outside .agent-work: ${target}`, 'INVALID_WORKSPACE');
  const project = await anchoredProjectRoot(absolute.slice(0, markerAt));
  workFile = absolute;
  const relative = path.relative(project, workFile).split(path.sep);
  ensure(relative[0] === '.agent-work' && relative[1] === 'open' && relative.at(-1) === 'work.md', `work path is not canonical: ${target}`, 'INVALID_WORKSPACE');
  const topology = relative.slice(2, -1);
  ensure(topology.length >= 1 && topology.length % 2 === 1 && topology.every((part, index) => (index % 2 === 0 ? ID_PATTERN.test(part) : part === 'children')), `work path topology is invalid: ${target}`, 'INVALID_WORKSPACE');
  return withProjectLock(project, async () => {
    await anchoredDirectory(project, relative.slice(0, -1), { create: true });
    ensure(!(await exists(workFile)) && !(await exists(statePath(workFile))), `already exists: ${workFile}`, 'ALREADY_EXISTS');
    syncWork(document);
    validateDocument(document, { file: workFile });
    await publishPair(
      workFile,
      document.markdown.endsWith('\n') ? document.markdown : `${document.markdown}\n`,
      `${JSON.stringify(document.state, null, 2)}\n`,
    );
  });
}

/**
 * Enforces current ownership.
 * @param {object} document - Work model.
 * @param {string} owner - Expected owner.
 * @param {Date} now - Validation clock.
 * @returns {void} Returns when authorized.
 */
export function assertOwner(document, owner, now = new Date()) {
  ensure(typeof owner === 'string' && owner.length > 0, '--owner is required for this mutation', 'OWNER_REQUIRED');
  ensure(document.state.owner === owner, `owner mismatch for ${document.state.id}`, 'OWNER_MISMATCH');
  ensure(Date.parse(document.state.lease_until) > now.getTime(), `lease expired for ${document.state.id}; claim it again`, 'LEASE_EXPIRED');
}

/**
 * Mutates one Work Item.
 * @param {string} target - Work document path.
 * @param {object} options - Ownership options.
 * @param {Function} mutate - In-memory mutator.
 * @returns {Promise<unknown>} Mutation result.
 */
export async function mutateAt(target, { owner, now = new Date(), requireOwner = true, renew = true, failAfterWork = false } = {}, mutate) {
  const supplied = path.basename(target) === 'state.json' ? path.join(path.dirname(target), 'work.md') : target;
  const initial = await openWorkProject(supplied);
  return withProjectLock(initial.project, async () => {
    const { workFile } = await openWorkContext(supplied);
    const document = await readAt(workFile);
    if (requireOwner) assertOwner(document, owner, now);
    const minutes = persistedLeaseMinutes(document);
    const result = await mutate(document);
    if (renew) document.frontmatter.lease_until = new Date(now.getTime() + minutes * 60_000).toISOString();
    document.frontmatter.updated_at = nowIso(now);
    syncWork(document);
    validateDocument(document, { file: workFile });
    await publishPair(
      workFile,
      document.markdown.endsWith('\n') ? document.markdown : `${document.markdown}\n`,
      `${JSON.stringify(document.state, null, 2)}\n`,
      { failAfterWork },
    );
    return result;
  });
}

/**
 * Returns a timestamp-insensitive fingerprint for one requested child document.
 * @param {object} document - Requested child model.
 * @returns {string} Request fingerprint.
 */
function childRequestDigest(document) {
  const state = structuredClone(document.state);
  delete state.created_at;
  delete state.updated_at;
  return digest(`${document.markdown}\0${JSON.stringify(state)}`);
}

/**
 * Creates a child and registers it in its parent as one recoverable transaction.
 * @param {string} project - Anchored project root.
 * @param {string} parentFile - Canonical parent work.md.
 * @param {string} target - Canonical child work.md.
 * @param {object} document - Requested child model.
 * @param {object} options - Owner and clock.
 * @param {Function} register - Idempotent parent registration callback.
 * @returns {Promise<object>} Persisted child model.
 */
export async function createChildAtTransaction(project, parentFile, target, document, { owner, now = new Date() }, register) {
  return withProjectLock(project, async () => {
    const transactionRoot = await anchoredDirectory(project, ['.agent-work', 'child-transactions'], { create: true });
    const parentRelative = path.relative(project, parentFile).split(path.sep).join('/');
    const targetRelative = path.relative(project, target).split(path.sep).join('/');
    ensure(!parentRelative.startsWith('../') && !targetRelative.startsWith('../'), 'child transaction escapes project', 'INVALID_WORKSPACE');
    syncWork(document);
    validateDocument(document, { file: target });
    const markdown = document.markdown.endsWith('\n') ? document.markdown : `${document.markdown}\n`;
    const stateText = `${JSON.stringify(document.state, null, 2)}\n`;
    const key = digest(`${parentRelative}\0${targetRelative}`);
    const journalFile = path.join(transactionRoot, `${key}.json`);
    const requested = childRequestDigest(document);
    const expected = {
      version: 1,
      parent: parentRelative,
      child: targetRelative,
      id: document.state.id,
      created_at: document.state.created_at,
      request_digest: requested,
      work_digest: digest(markdown),
      state_digest: digest(stateText),
    };
    let proof = expected;
    if (await entryExists(journalFile)) {
      try { proof = JSON.parse(await readFileNoFollow(journalFile, 'utf8', 'child transaction journal')); }
      catch (error) { if (error.code) throw error; fail(`invalid JSON: ${journalFile}`, 'INVALID_DOCUMENT'); }
      ensure(JSON.stringify(Object.keys(proof).sort()) === JSON.stringify(Object.keys(expected).sort()), 'child transaction journal is malformed', 'INVALID_DOCUMENT');
      ensure(proof.version === 1 && proof.parent === parentRelative && proof.child === targetRelative && proof.id === document.state.id && proof.request_digest === requested, 'child transaction journal conflicts with retry', 'INVALID_DOCUMENT');
      ensure(typeof proof.created_at === 'string' && !Number.isNaN(Date.parse(proof.created_at)), 'child transaction timestamp is invalid', 'INVALID_DOCUMENT');
      document.state.created_at = proof.created_at;
      document.state.updated_at = proof.created_at;
      document.frontmatter.updated_at = proof.created_at;
      syncWork(document);
    } else {
      ensure(!(await entryExists(target)) && !(await entryExists(statePath(target))), `already exists: ${target}`, 'ALREADY_EXISTS');
      await atomicReplace(journalFile, `${JSON.stringify(proof, null, 2)}\n`);
      await syncDirectory(transactionRoot);
    }
    const childPresent = await entryExists(target);
    const statePresent = await entryExists(statePath(target));
    ensure(childPresent === statePresent, `child transaction pair is incomplete: ${target}`, 'INVALID_DOCUMENT');
    if (!childPresent) await createAt(target, document);
    ensure(await existingDigest(target) === proof.work_digest && await existingDigest(statePath(target)) === proof.state_digest, `child transaction target conflicts with journal: ${target}`, 'INVALID_DOCUMENT');
    const child = await readAt(target);
    if (process.env.WORKFLOW_TEST_FAIL_CHILD_AFTER_CREATE === '1') fail('injected child transaction interruption', 'ATOMIC_FAILURE');
    await mutateAt(parentFile, {
      owner,
      now,
      failAfterWork: process.env.WORKFLOW_TEST_FAIL_CHILD_PARENT_AFTER_WORK === '1',
    }, (parent) => register(parent, child));
    await unlink(journalFile);
    await syncDirectory(transactionRoot);
    return child;
  });
}

/**
 * Discovers paired open work.
 * @param {string} directory - Directory to scan.
 * @param {string[]} files - Result accumulator.
 * @returns {Promise<void>} Resolves after traversal.
 */
async function walkWork(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    ensure(!entry.isSymbolicLink(), `open-work traversal cannot cross a symlink: ${path.join(directory, entry.name)}`, 'INVALID_WORKSPACE');
    if (!entry.isDirectory()) continue;
    const item = path.join(directory, entry.name);
    const workFile = path.join(item, 'work.md');
    const stateFile = path.join(item, 'state.json');
    await recoverPair(workFile);
    if (await entryExists(workFile) || await entryExists(stateFile)) {
      ensure(await entryExists(workFile) && await entryExists(stateFile), `open Work Item pair is incomplete: ${item}`, 'INVALID_DOCUMENT');
      await openWorkContext(workFile);
      if (!(await entryExists(path.join(item, '.archived')))) files.push(workFile);
    }
    const children = path.join(item, 'children');
    if (await entryExists(children)) {
      await requireRealDirectory(children, path.join(await realpath(item), 'children'), 'children directory');
      await walkWork(children, files);
    }
  }
}

/**
 * Lists paired open documents.
 * @param {string} root - Project root.
 * @returns {Promise<string[]>} Work paths.
 */
export async function listWork(root) {
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const agentWork = path.join(project, '.agent-work');
    if (!(await entryExists(agentWork))) return [];
    await anchoredDirectory(project, ['.agent-work']);
    const openRoot = path.join(agentWork, 'open');
    if (!(await entryExists(openRoot))) return [];
    await anchoredDirectory(project, ['.agent-work', 'open']);
    const files = [];
    await walkWork(openRoot, files);
    return files.sort();
  });
}

const ARCHIVE_INDEX_HEADER = '# Work archive\n\n| ID | Title | Summary | Status | Path |\n| --- | --- | --- | --- | --- |\n';

/**
 * Reads lightweight archive metadata without opening archived Work documents.
 * @param {string} root - Project root.
 * @returns {Promise<object[]>} Indexed archive entries.
 */
export async function readHistoryIndex(root) {
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const agentWork = path.join(project, '.agent-work');
    if (!(await entryExists(agentWork))) return [];
    await anchoredDirectory(project, ['.agent-work']);
    const archiveRoot = path.join(agentWork, 'archive');
    if (!(await entryExists(archiveRoot))) return [];
    await anchoredDirectory(project, ['.agent-work', 'archive']);
    const indexFile = path.join(archiveRoot, 'index.md');
    if (!(await entryExists(indexFile))) return [];
    const indexStats = await lstat(indexFile);
    ensure(indexStats.isFile() && !indexStats.isSymbolicLink(), `archive index must be a real file: ${indexFile}`, 'INVALID_ARCHIVE');
    ensure(await realpath(indexFile) === path.join(await realpath(archiveRoot), 'index.md'), `archive index escapes its expected location: ${indexFile}`, 'INVALID_ARCHIVE');
    const text = await readFileNoFollow(indexFile, 'utf8', 'archive index');
    ensure(text.startsWith(ARCHIVE_INDEX_HEADER), 'archive index header is malformed', 'INVALID_ARCHIVE');
    const body = text.slice(ARCHIVE_INDEX_HEADER.length);
    ensure(!body || body.endsWith('\n'), 'archive index is truncated', 'INVALID_ARCHIVE');
    const lines = body ? body.slice(0, -1).split('\n') : [];
    const entries = lines.map((line) => {
    const match = /^\| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/.exec(line);
    ensure(match, `archive index row is malformed: ${line}`, 'INVALID_ARCHIVE');
    /**
     * Decodes one archive-index table value.
     * @param {string} value - Encoded table value.
     * @returns {string} Decoded value.
     */
    const decode = (value) => value.replaceAll('&#124;', '|').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
    const entry = { id: decode(match[1]), name: decode(match[2]), summary: decode(match[3]), status: match[4], path: match[5] };
    ensure(encodeIndexValue(entry.id) === match[1] && encodeIndexValue(entry.name) === match[2] && encodeIndexValue(entry.summary) === match[3], 'archive index row encoding is invalid', 'INVALID_ARCHIVE');
    ensure(ID_PATTERN.test(entry.id), 'archive index row id is invalid', 'INVALID_ARCHIVE');
    ensure([entry.name, entry.summary].every((value) => value && !/[\r\n\u2028\u2029]/u.test(value)), 'archive index row text is invalid', 'INVALID_ARCHIVE');
    ensure(['completed', 'cancelled'].includes(entry.status), 'archive index row status is invalid', 'INVALID_ARCHIVE');
    ensure(canonicalArchivePath(entry.path), 'archive index row path is invalid', 'INVALID_ARCHIVE');
    ensure(entry.path.split('/').at(-2) === entry.id, 'archive index row identity does not match its path', 'INVALID_ARCHIVE');
    const resolved = path.resolve(project, ...entry.path.split('/'));
    ensure(resolved.startsWith(`${archiveRoot}${path.sep}`), 'archive index row escapes the archive root', 'INVALID_ARCHIVE');
    return entry;
    });
    ensure(new Set(entries.map((entry) => entry.path)).size === entries.length, 'archive index contains duplicate paths', 'INVALID_ARCHIVE');
    return entries;
  });
}

/**
 * Reports whether an archive index path is exact, canonical, and confined by grammar.
 * @param {unknown} value - Candidate project-relative path.
 * @returns {boolean} Validation result.
 */
function canonicalArchivePath(value) {
  return typeof value === 'string'
    && path.posix.normalize(value) === value
    && /^\.agent-work\/archive\/\d{4}\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/children\/[a-z0-9]+(?:-[a-z0-9]+)*)*\/work\.md$/.test(value);
}

/**
 * Encodes one archive-index table value.
 * @param {unknown} value - Index value.
 * @returns {string} Markdown-safe value.
 */
function encodeIndexValue(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('|', '&#124;').replaceAll('\n', ' ');
}

/**
 * Atomically publishes merged archive metadata.
 * @param {string} root - Project root.
 * @param {object[]} additions - Newly archived entries.
 * @returns {Promise<void>} Resolves after publication.
 */
async function writeHistoryIndex(root, additions) {
  const project = await anchoredProjectRoot(root);
  await anchoredDirectory(project, ['.agent-work', 'archive']);
  for (const entry of additions) {
    ensure(entry && ID_PATTERN.test(entry.id) && canonicalArchivePath(entry.path), 'new archive index entry is invalid', 'INVALID_ARCHIVE');
    ensure(entry.path.split('/').at(-2) === entry.id && ['completed', 'cancelled'].includes(entry.status), 'new archive index entry identity is invalid', 'INVALID_ARCHIVE');
  }
  const indexFile = path.join(project, '.agent-work', 'archive', 'index.md');
  return withProjectLock(project, async () => {
    const byPath = new Map((await readHistoryIndex(root)).map((entry) => [entry.path, entry]));
    for (const entry of additions) byPath.set(entry.path, entry);
    const entries = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    const rows = entries.map((entry) => `| ${encodeIndexValue(entry.id)} | ${encodeIndexValue(entry.name)} | ${encodeIndexValue(entry.summary)} | ${entry.status} | ${entry.path} |`).join('\n');
    await atomicReplace(indexFile, `${ARCHIVE_INDEX_HEADER}${rows}${rows ? '\n' : ''}`);
  });
}

/**
 * Resolves an open Work Item.
 * @param {string} root - Project root.
 * @param {string} reference - Path or identifier.
 * @returns {Promise<string>} Work path.
 */
export async function resolveWork(root, reference) {
  ensure(typeof reference === 'string' && reference.trim(), '--work is required', 'INVALID_INPUT');
  ensure(canonicalOpenReference(reference), `non-canonical work reference: ${reference}`, 'INVALID_INPUT');
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const files = await listWork(root);
    const direct = ID_PATTERN.test(reference) ? null : path.join(project, ...reference.split('/'));
    const allowed = new Set(files.map((file) => path.resolve(file)));
    if (direct) for (const candidate of [direct, path.join(direct, 'work.md')]) if (allowed.has(candidate)) return candidate;
    const matches = [];
    for (const file of files) {
      const raw = JSON.parse(await readFileNoFollow(statePath(file), 'utf8', 'state.json'));
      if (raw.id === reference) matches.push(file);
    }
    ensure(matches.length === 1, matches.length ? `ambiguous work id: ${reference}` : `work not found: ${reference}`, 'WORK_NOT_FOUND');
    return matches[0];
  });
}

/**
 * Validates an ID or exact project-relative open Work Item reference before resolution.
 * @param {string} reference - Raw caller input.
 * @returns {boolean} Whether normalization cannot change its identity.
 */
function canonicalOpenReference(reference) {
  if (ID_PATTERN.test(reference)) return true;
  if (reference.includes('\\') || path.posix.isAbsolute(reference) || path.posix.normalize(reference) !== reference) return false;
  const parts = reference.split('/');
  if (parts.at(-1) === 'work.md') parts.pop();
  if (parts[0] !== '.agent-work' || parts[1] !== 'open') return false;
  const topology = parts.slice(2);
  return topology.length >= 1 && topology.length % 2 === 1
    && topology.every((part, index) => (index % 2 === 0 ? ID_PATTERN.test(part) : part === 'children'));
}

/**
 * Resolves an archived document.
 * @param {string} root - Project root.
 * @param {string} reference - Path or identifier.
 * @returns {Promise<string>} Archive path.
 */
export async function resolveHistory(root, reference) {
  ensure(typeof reference === 'string' && reference.trim(), '--work is required', 'INVALID_INPUT');
  const byId = ID_PATTERN.test(reference);
  ensure(byId || canonicalArchiveReference(reference), `non-canonical archived work reference: ${reference}`, 'INVALID_INPUT');
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const entries = await readHistoryIndex(root);
    const files = entries.map((entry) => path.join(project, ...entry.path.split('/')));
    const direct = byId ? null : path.join(project, ...reference.split('/'));
    const allowed = new Set(files.map((file) => path.resolve(file)));
    if (direct) for (const candidate of [direct, path.join(direct, 'work.md')]) if (allowed.has(candidate)) return anchorArchiveWork(project, candidate);
    const matches = entries.filter((entry) => entry.id === reference).map((entry) => path.join(project, ...entry.path.split('/')));
    ensure(matches.length === 1, matches.length ? `ambiguous archived work id: ${reference}` : `archived work not found: ${reference}`, 'WORK_NOT_FOUND');
    return anchorArchiveWork(project, matches[0]);
  });
}

/**
 * Validates an exact archive directory or work.md reference.
 * @param {string} reference - Raw caller input.
 * @returns {boolean} Canonical grammar result.
 */
function canonicalArchiveReference(reference) {
  if (reference.includes('\\') || path.posix.isAbsolute(reference) || path.posix.normalize(reference) !== reference) return false;
  return canonicalArchivePath(reference.endsWith('/work.md') ? reference : `${reference}/work.md`);
}

/**
 * Anchors every archive ancestor and the final Markdown file.
 * @param {string} project - Anchored project root.
 * @param {string} workFile - Indexed archive work path.
 * @returns {Promise<string>} Anchored work path.
 */
async function anchorArchiveWork(project, workFile) {
  const relative = path.relative(project, workFile).split(path.sep);
  ensure(canonicalArchivePath(relative.join('/')), `archive work path is invalid: ${workFile}`, 'INVALID_ARCHIVE');
  await anchoredDirectory(project, relative.slice(0, -1));
  const stats = await lstat(workFile);
  const expected = path.join(await realpath(project), ...relative);
  ensure(stats.isFile() && !stats.isSymbolicLink() && await realpath(workFile) === expected, `archive work must be a real confined file: ${workFile}`, 'INVALID_ARCHIVE');
  return workFile;
}

/**
 * Reads one anchored archived Markdown document without following its final entry.
 * @param {string} root - Project root.
 * @param {string} workFile - Resolved history path.
 * @returns {Promise<string>} Archived Markdown.
 */
export async function readArchivedMarkdown(root, workFile) {
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const anchored = await anchorArchiveWork(project, workFile);
    return readFileNoFollow(anchored, 'utf8', 'archived work.md');
  });
}

/**
 * Removes runtime state recursively.
 * @param {string} directory - Current archived-tree directory.
 * @param {string} stageRoot - Private stage root.
 * @param {object} stageIdentity - Captured stage-root identity.
 * @param {Map<string, object>} stageDirectories - Captured descendant identities.
 * @returns {Promise<void>} Resolves after cleanup.
 */
async function removeRuntimeState(directory, stageRoot, stageIdentity, stageDirectories) {
  const relative = path.relative(stageRoot, directory);
  ensure(relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)), `runtime cleanup escapes its private stage: ${directory}`, 'INVALID_ARCHIVE');
  const identity = relative ? stageDirectories.get(relative.split(path.sep).join('/')) : stageIdentity;
  ensure(identity, `runtime cleanup directory was not prevalidated: ${directory}`, 'INVALID_ARCHIVE');
  /**
   * Revalidates the private stage and current runtime directory.
   * @returns {Promise<void>} Resolves while both directory identities are unchanged.
   */
  const guard = async () => {
    await requireDirectoryIdentity(stageRoot, stageIdentity, 'staging root');
    await requireDirectoryIdentity(directory, identity, 'runtime cleanup directory');
  };
  await guard();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    ensure(!entry.isSymbolicLink(), `runtime cleanup cannot cross a symlink: ${target}`, 'INVALID_ARCHIVE');
    if (entry.isDirectory()) await removeRuntimeState(target, stageRoot, stageIdentity, stageDirectories);
    else if (entry.name === 'state.json' || entry.name.endsWith('.lock') || entry.name.endsWith('.tmp')) {
      const stats = await lstat(target);
      ensure(stats.isFile() && !stats.isSymbolicLink(), `runtime cleanup target must be a real file: ${target}`, 'INVALID_ARCHIVE');
      await guard();
      await unlink(target);
    }
  }
}

/**
 * Removes an identity-bound private stage tree while the project lock excludes
 * every compliant workflow process from its unpredictable name.
 * @param {string} directory - Current directory.
 * @param {string} stageRoot - Private stage root.
 * @param {object} stageIdentity - Captured stage-root identity.
 * @param {Map<string, object>} stageDirectories - Captured descendant identities.
 * @returns {Promise<void>} Resolves after removing the exact stage object.
 */
async function removePrivateStage(directory, stageRoot, stageIdentity, stageDirectories) {
  const relative = path.relative(stageRoot, directory);
  ensure(relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)), `stage removal escapes its private root: ${directory}`, 'INVALID_ARCHIVE');
  const identity = relative ? stageDirectories.get(relative.split(path.sep).join('/')) : stageIdentity;
  ensure(identity, `stage removal directory was not prevalidated: ${directory}`, 'INVALID_ARCHIVE');
  /**
   * Revalidates the private stage and current removal directory.
   * @returns {Promise<void>} Resolves while both directory identities are unchanged.
   */
  const guard = async () => {
    await requireDirectoryIdentity(stageRoot, stageIdentity, 'staging root');
    await requireDirectoryIdentity(directory, identity, 'staging removal directory');
  };
  await guard();
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name);
    const stats = await lstat(target);
    if (stats.isDirectory() && !stats.isSymbolicLink()) await removePrivateStage(target, stageRoot, stageIdentity, stageDirectories);
    else {
      await guard();
      await unlink(target);
    }
  }
  await guard();
  await rmdir(directory);
}

/**
 * Rejects unresolved pair-transaction artifacts anywhere in a source or stage tree.
 * @param {string} directory - Real tree root.
 * @returns {Promise<void>} Resolves only for transaction-clean input.
 */
async function assertNoPairArtifacts(directory) {
  await requireRealDirectory(directory, await realpath(directory), 'transaction scan directory');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    ensure(entry.name !== PAIR_JOURNAL && !PAIR_TEMP_PATTERN.test(entry.name), `unresolved pair transaction artifact: ${target}`, 'INVALID_ARCHIVE');
    ensure(!entry.isSymbolicLink(), `archive source cannot contain a symlink: ${target}`, 'INVALID_ARCHIVE');
    if (entry.isDirectory()) await assertNoPairArtifacts(target);
  }
}

/**
 * Collects lightweight metadata while staged runtime state is still available.
 * @param {string} root - Project root.
 * @param {string} directory - Staged archive root.
 * @returns {Promise<object[]>} Archive entries.
 */
async function collectArchiveEntries(root, directory) {
  const entries = [];
  /**
   * Walks one staged archive directory.
   * @param {string} current - Directory to inspect.
   * @returns {Promise<void>} Resolves after traversal.
   */
  const walk = async (current) => {
    await requireRealDirectory(current, await realpath(current), 'staged archive directory');
    const workFile = path.join(current, 'work.md');
    const runtimeFile = path.join(current, 'state.json');
    if (await entryExists(workFile) && await entryExists(runtimeFile)) {
      const [markdown, stateText] = await Promise.all([
        readFileNoFollow(workFile, 'utf8', 'staged work.md'),
        readFileNoFollow(runtimeFile, 'utf8', 'staged state.json'),
      ]);
      const state = JSON.parse(stateText);
      const outcome = sectionBody(markdown, 'Outcome').split('\n')[0] ?? '';
      entries.push({ id: state.id, name: markdownTitle(markdown), summary: outcome, status: state.status, path: path.relative(root, workFile) });
    }
    for (const entry of await readdir(current, { withFileTypes: true })) {
      ensure(!entry.isSymbolicLink(), `staged archive cannot contain a symlink: ${path.join(current, entry.name)}`, 'INVALID_ARCHIVE');
      if (entry.isDirectory()) await walk(path.join(current, entry.name));
    }
  };
  await walk(directory);
  return entries;
}

/**
 * Verifies that a staged archive contains no disposable runtime files.
 * @param {string} directory - Staged archive directory.
 * @returns {Promise<void>} Resolves for a clean archive.
 */
async function assertArchivePrepared(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertArchivePrepared(target);
    else ensure(
      entry.name !== 'state.json' && entry.name !== PAIR_JOURNAL && !PAIR_TEMP_PATTERN.test(entry.name)
        && !entry.name.endsWith('.lock') && !entry.name.endsWith('.tmp'),
      `runtime file remained in archive: ${target}`,
      'INVALID_ARCHIVE',
    );
  }
}

/**
 * Rewrites generated child links so each archived document points within the moved tree.
 *
 * @param {string} directory - Archived Work Item directory whose child links are rewritten.
 * @param {string} stageRoot - Trusted staging root.
 * @param {object} stageIdentity - Captured staging-root identity.
 * @param {Map<string, object>} stageDirectories - Captured descendant directory identities.
 * @returns {Promise<void>} Resolves after this document and all nested children are updated.
 */
async function rewriteArchivedChildLinks(directory, stageRoot, stageIdentity, stageDirectories) {
  const relative = path.relative(stageRoot, directory);
  ensure(relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)), `staged child directory escapes its tree: ${directory}`, 'INVALID_ARCHIVE');
  const expected = relative ? path.join(await realpath(stageRoot), relative) : await realpath(stageRoot);
  await requireRealDirectory(directory, expected, 'staged Work Item directory');
  const directoryObject = relative ? stageDirectories.get(relative.split(path.sep).join('/')) : stageIdentity;
  ensure(directoryObject, `staged Work Item directory was not prevalidated: ${directory}`, 'INVALID_ARCHIVE');
  await requireDirectoryIdentity(directory, directoryObject, 'staged Work Item directory');
  /**
   * Revalidates stage and current Work Item directory identities.
   * @returns {Promise<void>} Resolves while both directory objects are unchanged.
   */
  const guard = async () => {
    await requireDirectoryIdentity(stageRoot, stageIdentity, 'staging root');
    await requireDirectoryIdentity(directory, directoryObject, 'staged Work Item directory');
  };
  const workFile = path.join(directory, 'work.md');
  const runtimeFile = path.join(directory, 'state.json');
  if (!(await entryExists(workFile)) || !(await entryExists(runtimeFile))) return;
  await guard();
  const state = JSON.parse(await readFileNoFollow(runtimeFile, 'utf8', 'staged state.json'));
  let markdown = await readFileNoFollow(workFile, 'utf8', 'staged work.md');
  for (const child of state.children ?? []) {
    ensure(ID_PATTERN.test(child.id), `staged child id is invalid: ${child.id}`, 'INVALID_ARCHIVE');
    const archivedLink = path.posix.join('children', child.id, 'work.md');
    const childDirectory = path.join(directory, 'children', child.id);
    await guard();
    await requireRealDirectory(childDirectory, path.join(expected, 'children', child.id), 'staged child directory');
    const childRelative = path.relative(stageRoot, childDirectory).split(path.sep).join('/');
    ensure(stageDirectories.has(childRelative), `staged child was not prevalidated: ${childRelative}`, 'INVALID_ARCHIVE');
    await requireDirectoryIdentity(childDirectory, stageDirectories.get(childRelative), 'staged child directory');
    const childWork = path.join(childDirectory, 'work.md');
    const childStats = await lstat(childWork);
    ensure(childStats.isFile() && !childStats.isSymbolicLink(), `archived child must have a real work.md: ${archivedLink}`, 'INVALID_ARCHIVE');
    markdown = markdown.replaceAll(`](${child.path})`, `](${archivedLink})`);
    await rewriteArchivedChildLinks(childDirectory, stageRoot, stageIdentity, stageDirectories);
  }
  await atomicReplace(workFile, markdown.endsWith('\n') ? markdown : `${markdown}\n`, guard);
}

/**
 * Requires one path to be a real directory at its expected canonical location.
 * @param {string} target - Lexical directory path to inspect without following its final component.
 * @param {string} expected - Exact canonical path expected after resolving ancestors.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<void>} Resolves only for a non-symlink directory at the expected location.
 */
async function requireRealDirectory(target, expected, label) {
  let stats;
  try { stats = await lstat(target); } catch { fail(`${label} is missing: ${target}`, 'INVALID_ARCHIVE'); }
  ensure(stats.isDirectory() && !stats.isSymbolicLink(), `${label} must be a real directory: ${target}`, 'INVALID_ARCHIVE');
  ensure(await realpath(target) === expected, `${label} escapes its expected location: ${target}`, 'INVALID_ARCHIVE');
}

/**
 * Resolves and validates the real operational cleanup boundary.
 * @param {string} root - Project root.
 * @param {string} id - Normalized top-level Work Item ID.
 * @returns {Promise<object>} Canonical and lexical cleanup paths.
 */
async function cleanupContext(root, id) {
  const projectPath = await anchoredProjectRoot(root);
  const project = await realpath(root);
  const agentWork = path.join(root, '.agent-work');
  const agentWorkReal = path.join(project, '.agent-work');
  await requireRealDirectory(agentWork, agentWorkReal, '.agent-work');
  const cleanupRoot = path.join(agentWork, 'cleanup');
  const cleanupRootReal = path.join(agentWorkReal, 'cleanup');
  await requireRealDirectory(cleanupRoot, cleanupRootReal, 'cleanup root');
  const quarantineRoot = path.join(agentWork, 'cleanup-quarantine');
  const quarantineRootReal = path.join(agentWorkReal, 'cleanup-quarantine');
  await requireRealDirectory(quarantineRoot, quarantineRootReal, 'cleanup quarantine root');
  return {
    projectPath,
    projectIdentity: await directoryIdentity(projectPath, 'project root'),
    agentWork,
    agentWorkReal,
    agentWorkIdentity: await directoryIdentity(agentWork, '.agent-work'),
    cleanupRoot,
    cleanupRootReal,
    cleanupRootIdentity: await directoryIdentity(cleanupRoot, 'cleanup root'),
    cleanup: path.join(cleanupRoot, id),
    cleanupReal: path.join(cleanupRootReal, id),
    quarantineRoot,
    quarantineRootReal,
    quarantineRootIdentity: await directoryIdentity(quarantineRoot, 'cleanup quarantine root'),
    journal: path.join(cleanupRoot, `${id}.commit.json`),
  };
}

/**
 * Revalidates every trusted cleanup ancestor against its captured object identity.
 * @param {object} context - Cleanup context.
 * @returns {Promise<void>} Resolves only while all trusted roots are unchanged.
 */
async function requireCleanupContextIdentity(context) {
  await requireDirectoryIdentity(context.projectPath, context.projectIdentity, 'project root');
  await requireDirectoryIdentity(context.agentWork, context.agentWorkIdentity, '.agent-work');
  await requireDirectoryIdentity(context.cleanupRoot, context.cleanupRootIdentity, 'cleanup root');
  await requireDirectoryIdentity(context.quarantineRoot, context.quarantineRootIdentity, 'cleanup quarantine root');
}

/**
 * Builds a deterministic digest manifest without following symlinks.
 * @param {string} directory - Real archive directory to walk.
 * @returns {Promise<object[]>} Sorted directory and regular-file manifest.
 */
async function archiveManifest(directory) {
  const base = await realpath(directory);
  const manifest = [];
  /**
   * Walks a manifest directory after proving that it is real and in bounds.
   * @param {string} current - Current lexical directory.
   * @param {string} relative - POSIX-relative manifest path.
   * @returns {Promise<void>} Resolves after recording the subtree.
   */
  const walk = async (current, relative) => {
    await requireRealDirectory(current, relative ? path.join(base, ...relative.split('/')) : base, 'archive directory');
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stats = await lstat(entryPath);
      ensure(!stats.isSymbolicLink(), `archive tree cannot contain a symlink: ${entryPath}`, 'INVALID_ARCHIVE');
      if (stats.isDirectory()) {
        manifest.push({ path: entryRelative, type: 'directory' });
        await walk(entryPath, entryRelative);
      } else {
        ensure(stats.isFile(), `archive tree contains an unsupported entry: ${entryPath}`, 'INVALID_ARCHIVE');
        const bytes = await readFile(entryPath);
        manifest.push({
          path: entryRelative,
          type: 'file',
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  await walk(directory, '');
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Captures cleanup authorization bytes plus every descendant directory identity.
 * @param {string} directory - Authorized source root.
 * @returns {Promise<object[]>} Sorted source authorization manifest.
 */
async function sourceAuthorizationManifest(directory) {
  const base = await realpath(directory);
  const manifest = [];
  /**
   * Walks one authorized real directory.
   * @param {string} current - Current directory.
   * @param {string} relative - POSIX-relative path.
   * @returns {Promise<void>} Resolves after recording the subtree.
   */
  const walk = async (current, relative) => {
    await requireRealDirectory(current, relative ? path.join(base, ...relative.split('/')) : base, 'cleanup source directory');
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stats = await lstat(entryPath);
      ensure(!stats.isSymbolicLink(), `cleanup source cannot contain a symlink at authorization: ${entryPath}`, 'INVALID_ARCHIVE');
      if (stats.isDirectory()) {
        manifest.push({ path: entryRelative, type: 'directory', identity: await directoryIdentity(entryPath, 'cleanup source directory') });
        await walk(entryPath, entryRelative);
      } else {
        ensure(stats.isFile(), `cleanup source contains an unsupported entry: ${entryPath}`, 'INVALID_ARCHIVE');
        const bytes = await readFileNoFollow(entryPath, null, 'cleanup source file');
        manifest.push({ path: entryRelative, type: 'file', size: bytes.length, sha256: digest(bytes) });
      }
    }
  };
  await walk(directory, '');
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Verifies that authorized source bytes are unchanged while permitting only added symlink entries.
 * @param {string} directory - Exact source or quarantine directory.
 * @param {object[]} expected - Manifest captured at authorization time.
 * @param {string} id - Work Item identity for diagnostics.
 * @returns {Promise<void>} Resolves for the same authorized content plus unlink-only symlinks.
 */
async function verifyAuthorizedSourceManifest(directory, expected, id) {
  const base = await realpath(directory);
  const current = [];
  /**
   * Enumerates one real source subtree without following symlinks.
   * @param {string} target - Current directory.
   * @param {string} relative - POSIX-relative path.
   * @returns {Promise<void>} Resolves after enumeration.
   */
  const walk = async (target, relative) => {
    await requireRealDirectory(target, relative ? path.join(base, ...relative.split('/')) : base, 'cleanup source directory');
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const entryPath = path.join(target, entry.name);
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) current.push({ path: entryRelative, type: 'symlink' });
      else if (stats.isDirectory()) {
        current.push({ path: entryRelative, type: 'directory', identity: await directoryIdentity(entryPath, 'cleanup source directory') });
        await walk(entryPath, entryRelative);
      } else {
        ensure(stats.isFile(), `cleanup source contains an unsupported entry: ${entryPath}`, 'INVALID_ARCHIVE');
        const bytes = await readFileNoFollow(entryPath, null, 'cleanup source file');
        current.push({ path: entryRelative, type: 'file', size: bytes.length, sha256: digest(bytes) });
      }
    }
  };
  await walk(directory, '');
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
  for (const entry of expected) ensure(JSON.stringify(currentByPath.get(entry.path)) === JSON.stringify(entry), `cleanup source manifest mismatch: ${id}`, 'INVALID_ARCHIVE');
  for (const entry of current) ensure(expectedByPath.has(entry.path) || entry.type === 'symlink', `cleanup source gained an unauthorized real entry: ${entry.path}`, 'INVALID_ARCHIVE');
}

/**
 * Validates a cleanup commit journal and its exact Work Item scope.
 * @param {object} journal - Parsed machine-only commit proof.
 * @param {string} id - Expected Work Item ID.
 * @returns {object} Validated journal.
 */
function validateCommitJournal(journal, id) {
  ensure(journal && typeof journal === 'object' && !Array.isArray(journal), 'cleanup commit journal must be an object', 'INVALID_ARCHIVE');
  ensure(
    JSON.stringify(Object.keys(journal).sort()) === JSON.stringify(['archive', 'id', 'index', 'manifest', 'quarantine', 'result', 'source', 'source_identity', 'source_manifest', 'trusted_identities', 'version']),
    'cleanup commit journal has unexpected fields',
    'INVALID_ARCHIVE',
  );
  ensure(journal.version === 3 && journal.id === id, 'cleanup commit journal identity mismatch', 'INVALID_ARCHIVE');
  ensure(journal.source === `.agent-work/open/${id}`, 'cleanup commit journal source mismatch', 'INVALID_ARCHIVE');
  ensure(
    typeof journal.archive === 'string' && /^\.agent-work\/archive\/\d{4}\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(journal.archive)
      && journal.archive.endsWith(`/${id}`),
    'cleanup commit journal archive mismatch',
    'INVALID_ARCHIVE',
  );
  validateDirectoryIdentity(journal.source_identity, 'cleanup source');
  ensure(journal.trusted_identities && JSON.stringify(Object.keys(journal.trusted_identities).sort()) === JSON.stringify(['agent_work', 'cleanup_root', 'project', 'quarantine_root']), 'cleanup trusted identities are malformed', 'INVALID_ARCHIVE');
  for (const [name, identity] of Object.entries(journal.trusted_identities)) validateDirectoryIdentity(identity, `cleanup trusted ${name}`);
  ensure(
    typeof journal.quarantine === 'string'
      && new RegExp(`^\\.agent-work/cleanup-quarantine/${id}-[a-f0-9-]{36}$`).test(journal.quarantine),
    'cleanup commit journal quarantine mismatch',
    'INVALID_ARCHIVE',
  );
  ensure(
    journal.result && JSON.stringify(Object.keys(journal.result).sort()) === JSON.stringify(['stage', 'status'])
      && journal.result.status === 'completed' && typeof journal.result.stage === 'string' && journal.result.stage,
    'cleanup commit journal result is invalid',
    'INVALID_ARCHIVE',
  );
  ensure(Array.isArray(journal.manifest) && journal.manifest.length > 0, 'cleanup commit journal manifest is empty', 'INVALID_ARCHIVE');
  ensure(Array.isArray(journal.source_manifest) && journal.source_manifest.length > 0, 'cleanup commit journal source manifest is empty', 'INVALID_ARCHIVE');
  ensure(Array.isArray(journal.index) && journal.index.length > 0, 'cleanup commit journal index is empty', 'INVALID_ARCHIVE');
  for (const item of journal.manifest) {
    const keys = item?.type === 'directory' ? ['path', 'type'] : ['path', 'sha256', 'size', 'type'];
    ensure(item && JSON.stringify(Object.keys(item).sort()) === JSON.stringify(keys.sort()), 'cleanup manifest entry is malformed', 'INVALID_ARCHIVE');
    ensure(typeof item.path === 'string' && item.path && !path.posix.isAbsolute(item.path) && path.posix.normalize(item.path) === item.path && !item.path.startsWith('../'), 'cleanup manifest path is invalid', 'INVALID_ARCHIVE');
    ensure(['directory', 'file'].includes(item.type), 'cleanup manifest type is invalid', 'INVALID_ARCHIVE');
    if (item.type === 'file') ensure(Number.isInteger(item.size) && item.size >= 0 && /^[a-f0-9]{64}$/.test(item.sha256), 'cleanup manifest digest is invalid', 'INVALID_ARCHIVE');
  }
  for (const item of journal.source_manifest) {
    const keys = item?.type === 'directory' ? ['identity', 'path', 'type'] : ['path', 'sha256', 'size', 'type'];
    ensure(item && JSON.stringify(Object.keys(item).sort()) === JSON.stringify(keys.sort()), 'cleanup source manifest entry is malformed', 'INVALID_ARCHIVE');
    ensure(typeof item.path === 'string' && item.path && !path.posix.isAbsolute(item.path) && path.posix.normalize(item.path) === item.path && !item.path.startsWith('../'), 'cleanup source manifest path is invalid', 'INVALID_ARCHIVE');
    ensure(['directory', 'file'].includes(item.type), 'cleanup source manifest type is invalid', 'INVALID_ARCHIVE');
    if (item.type === 'directory') validateDirectoryIdentity(item.identity, 'cleanup source descendant');
    if (item.type === 'file') ensure(Number.isInteger(item.size) && item.size >= 0 && /^[a-f0-9]{64}$/.test(item.sha256), 'cleanup source manifest digest is invalid', 'INVALID_ARCHIVE');
  }
  for (const entry of journal.index) {
    ensure(entry && JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(['id', 'name', 'path', 'status', 'summary']), 'cleanup index proof is malformed', 'INVALID_ARCHIVE');
    ensure(['completed', 'cancelled'].includes(entry.status), 'cleanup index proof status is invalid', 'INVALID_ARCHIVE');
    ensure(
      typeof entry.path === 'string'
        && (entry.path === `${journal.archive}/work.md`
          || (entry.path.startsWith(`${journal.archive}/`) && entry.path.endsWith('/work.md'))),
      'cleanup index proof path is invalid',
      'INVALID_ARCHIVE',
    );
    ensure([entry.id, entry.name, entry.summary].every((value) => typeof value === 'string' && value && !/[\r\n\u2028\u2029]/u.test(value)), 'cleanup index proof text is invalid', 'INVALID_ARCHIVE');
  }
  ensure(new Set(journal.manifest.map((item) => item.path)).size === journal.manifest.length, 'cleanup manifest paths are duplicated', 'INVALID_ARCHIVE');
  ensure(new Set(journal.source_manifest.map((item) => item.path)).size === journal.source_manifest.length, 'cleanup source manifest paths are duplicated', 'INVALID_ARCHIVE');
  ensure(new Set(journal.index.map((entry) => entry.path)).size === journal.index.length, 'cleanup index paths are duplicated', 'INVALID_ARCHIVE');
  const manifestedWork = journal.manifest
    .filter((item) => item.type === 'file' && (item.path === 'work.md' || item.path.endsWith('/work.md')))
    .map((item) => `${journal.archive}/${item.path}`)
    .sort();
  ensure(
    JSON.stringify(manifestedWork) === JSON.stringify(journal.index.map((entry) => entry.path).sort()),
    'cleanup index proof does not cover every archived Work document',
    'INVALID_ARCHIVE',
  );
  return journal;
}

/**
 * Binds a newly resolved cleanup context to identities persisted at authorization time.
 * @param {object} context - Current cleanup context.
 * @param {object} proof - Valid commit journal.
 * @returns {Promise<void>} Resolves only for the originally trusted objects.
 */
async function bindCleanupContextToProof(context, proof) {
  await requireDirectoryIdentity(context.projectPath, proof.trusted_identities.project, 'project root');
  await requireDirectoryIdentity(context.agentWork, proof.trusted_identities.agent_work, '.agent-work');
  await requireDirectoryIdentity(context.cleanupRoot, proof.trusted_identities.cleanup_root, 'cleanup root');
  await requireDirectoryIdentity(context.quarantineRoot, proof.trusted_identities.quarantine_root, 'cleanup quarantine root');
}

/**
 * Reads a real regular-file commit journal without following a substituted symlink.
 * @param {string} journalFile - Exact journal path.
 * @param {string} id - Expected Work Item ID.
 * @returns {Promise<object>} Parsed and validated proof.
 */
async function readCommitJournal(journalFile, id) {
  let stats;
  try { stats = await lstat(journalFile); } catch { fail(`cleanup commit journal is missing: ${journalFile}`, 'INVALID_ARCHIVE'); }
  ensure(stats.isFile() && !stats.isSymbolicLink(), `cleanup commit journal must be a real file: ${journalFile}`, 'INVALID_ARCHIVE');
  let journal;
  try { journal = JSON.parse(await readFileNoFollow(journalFile, 'utf8', 'cleanup commit journal')); }
  catch { fail(`invalid JSON: ${journalFile}`, 'INVALID_ARCHIVE'); }
  return validateCommitJournal(journal, id);
}

/**
 * Proves that a committed archive tree and every expected lightweight index entry still match a journal.
 * @param {string} root - Project root.
 * @param {object} journal - Validated commit journal.
 * @returns {Promise<string>} Canonical archived Work document path.
 */
async function verifyCommittedArchive(root, journal) {
  const project = await realpath(root);
  const archiveRoot = path.join(root, '.agent-work', 'archive');
  const archiveRootExpected = path.join(project, '.agent-work', 'archive');
  await requireRealDirectory(archiveRoot, archiveRootExpected, 'archive root');
  const indexFile = path.join(archiveRoot, 'index.md');
  const indexStats = await lstat(indexFile);
  ensure(indexStats.isFile() && !indexStats.isSymbolicLink(), `archive index must be a real file: ${indexFile}`, 'INVALID_ARCHIVE');
  ensure(await realpath(indexFile) === path.join(archiveRootExpected, 'index.md'), `archive index escapes its expected location: ${indexFile}`, 'INVALID_ARCHIVE');
  const archiveDirectory = path.join(root, journal.archive);
  const archiveExpected = path.join(project, ...journal.archive.split('/'));
  await requireRealDirectory(archiveDirectory, archiveExpected, 'committed archive');
  ensure(JSON.stringify(await archiveManifest(archiveDirectory)) === JSON.stringify(journal.manifest), `committed archive manifest mismatch: ${journal.id}`, 'INVALID_ARCHIVE');
  const currentIndex = (await readHistoryIndex(root))
    .filter((entry) => entry.path === `${journal.archive}/work.md` || entry.path.startsWith(`${journal.archive}/`))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expectedIndex = [...journal.index].sort((left, right) => left.path.localeCompare(right.path));
  ensure(JSON.stringify(currentIndex) === JSON.stringify(expectedIndex), `archive index proof mismatch: ${journal.id}`, 'INVALID_ARCHIVE');
  const workFile = path.join(archiveDirectory, 'work.md');
  ensure(await exists(workFile), `committed archive is missing: ${workFile}`, 'INVALID_ARCHIVE');
  return workFile;
}

/**
 * Removes one entry without following a symlink or traversing outside the cleanup boundary.
 * @param {string} target - Entry to remove.
 * @param {string} cleanup - Lexical cleanup target root.
 * @param {string} cleanupReal - Canonical cleanup target root.
 * @param {object} context - Trusted cleanup context.
 * @param {object} cleanupIdentity - Authorized quarantine identity.
 * @param {Map<string, object>} sourceDirectories - Authorization-time descendant identities.
 * @returns {Promise<void>} Resolves after the entry itself is absent.
 */
async function removeEntryNoFollow(target, cleanup, cleanupReal, context, cleanupIdentity, sourceDirectories) {
  await requireCleanupContextIdentity(context);
  await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
  const relative = path.relative(cleanup, target);
  ensure(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `cleanup entry escapes its target: ${target}`, 'INVALID_ARCHIVE');
  const parentRelative = path.dirname(relative) === '.' ? '' : path.dirname(relative);
  const parent = path.dirname(target);
  const parentExpected = parentRelative ? path.join(cleanupReal, parentRelative) : cleanupReal;
  await requireRealDirectory(parent, parentExpected, 'cleanup entry parent');
  await requireCleanupContextIdentity(context);
  await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    await requireRealDirectory(parent, parentExpected, 'cleanup entry parent');
    await requireCleanupContextIdentity(context);
    await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
    await unlink(target);
    return;
  }
  const expectedTargetIdentity = sourceDirectories.get(relative.split(path.sep).join('/'));
  ensure(expectedTargetIdentity, `cleanup descendant was not present at authorization: ${relative}`, 'INVALID_ARCHIVE');
  await requireDirectoryIdentity(target, expectedTargetIdentity, 'cleanup descendant');
  const targetIdentity = expectedTargetIdentity;
  await requireRealDirectory(target, path.join(cleanupReal, relative), 'cleanup descendant');
  const entries = await readdir(target);
  await requireDirectoryIdentity(target, targetIdentity, 'cleanup descendant');
  await requireRealDirectory(target, path.join(cleanupReal, relative), 'cleanup descendant');
  for (const entry of entries) {
    await requireCleanupContextIdentity(context);
    await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
    await requireDirectoryIdentity(target, targetIdentity, 'cleanup descendant');
    await requireRealDirectory(target, path.join(cleanupReal, relative), 'cleanup descendant');
    await removeEntryNoFollow(path.join(target, entry), cleanup, cleanupReal, context, cleanupIdentity, sourceDirectories);
  }
  await requireCleanupContextIdentity(context);
  await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
  await requireDirectoryIdentity(target, targetIdentity, 'cleanup descendant');
  await requireRealDirectory(target, path.join(cleanupReal, relative), 'cleanup descendant');
  await rmdir(target);
}

/**
 * Removes one committed cleanup tree while retaining its top-level identity anchor until the final step.
 * @param {string} cleanup - Exact `.agent-work/cleanup/<work-id>` directory.
 * @param {string} cleanupReal - Canonical cleanup target path used as the traversal boundary.
 * @param {object} context - Trusted cleanup context.
 * @param {object} cleanupIdentity - Authorized quarantine identity.
 * @param {object[]} sourceManifest - Authorization-time source manifest.
 * @returns {Promise<void>} Resolves only after the cleanup directory is absent.
 */
async function removeCommittedCleanup(cleanup, cleanupReal, context, cleanupIdentity, sourceManifest) {
  // Node exposes no portable dirfd-relative unlink. The unpredictable 0700 quarantine
  // detaches the authorized name first; repeated no-follow checks then fail closed on
  // every observable swap while ensuring descendant symlinks are only unlinked.
  await requireCleanupContextIdentity(context);
  await requireRealDirectory(cleanup, cleanupReal, 'quarantined cleanup target');
  await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
  const sourceDirectories = new Map(sourceManifest
    .filter((entry) => entry.type === 'directory')
    .map((entry) => [entry.path, entry.identity]));
  const identity = path.join(cleanup, 'state.json');
  for (const entry of await readdir(cleanup, { withFileTypes: true })) {
    if (entry.name === 'state.json') continue;
    await removeEntryNoFollow(path.join(cleanup, entry.name), cleanup, cleanupReal, context, cleanupIdentity, sourceDirectories);
    if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_DURING_CLEANUP === '1') {
      fail('injected archive removal interruption', 'ATOMIC_FAILURE');
    }
  }
  if (await exists(identity)) {
    if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_CLEANUP_REMOVE === '1') {
      fail('injected archive removal failure', 'ATOMIC_FAILURE');
    }
    await requireCleanupContextIdentity(context);
    await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
    const identityStats = await lstat(identity);
    ensure(identityStats.isFile() && !identityStats.isSymbolicLink(), `cleanup identity must be a real file: ${identity}`, 'INVALID_ARCHIVE');
    await unlink(identity);
  }
  if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_IDENTITY === '1') {
    fail('injected archive finalization interruption', 'ATOMIC_FAILURE');
  }
  await requireCleanupContextIdentity(context);
  await requireDirectoryIdentity(cleanup, cleanupIdentity, 'quarantined cleanup target');
  await rmdir(cleanup);
  await requireCleanupContextIdentity(context);
  await syncDirectory(path.dirname(cleanup));
  ensure(!(await exists(cleanup)), `cleanup remained after removal: ${cleanup}`, 'ATOMIC_FAILURE');
}

/**
 * Detaches the authorized cleanup tree into its journal-bound quarantine before traversal.
 * @param {object} context - Anchored cleanup roots.
 * @param {object} proof - Valid cleanup commit journal.
 * @returns {Promise<string>} Lexical quarantine path.
 */
async function quarantineCommittedCleanup(context, proof) {
  const quarantine = path.join(path.dirname(context.agentWork), ...proof.quarantine.split('/'));
  const quarantineReal = path.join(context.quarantineRootReal, path.basename(quarantine));
  ensure(path.dirname(quarantine) === context.quarantineRoot, 'cleanup quarantine escapes its root', 'INVALID_ARCHIVE');
  await requireCleanupContextIdentity(context);
  const cleanupPresent = await entryExists(context.cleanup);
  const quarantinePresent = await entryExists(quarantine);
  ensure(!(cleanupPresent && quarantinePresent), 'cleanup exists in both source and quarantine', 'INVALID_ARCHIVE');
  if (cleanupPresent) {
    await requireDirectoryIdentity(context.cleanup, proof.source_identity, 'cleanup target');
    await verifyAuthorizedSourceManifest(context.cleanup, proof.source_manifest, proof.id);
    await requireRealDirectory(context.cleanup, context.cleanupReal, 'cleanup target');
    await requireRealDirectory(context.cleanupRoot, context.cleanupRootReal, 'cleanup root');
    await requireRealDirectory(context.quarantineRoot, context.quarantineRootReal, 'cleanup quarantine root');
    await requireCleanupContextIdentity(context);
    await requireDirectoryIdentity(context.cleanup, proof.source_identity, 'cleanup target');
    await rename(context.cleanup, quarantine);
    await Promise.all([syncDirectory(context.cleanupRoot), syncDirectory(context.quarantineRoot)]);
    await requireRealDirectory(quarantine, quarantineReal, 'quarantined cleanup target');
    await requireDirectoryIdentity(quarantine, proof.source_identity, 'quarantined cleanup target');
    if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_QUARANTINE_RENAME === '1') fail('injected quarantine interruption', 'ATOMIC_FAILURE');
  } else {
    ensure(quarantinePresent, 'cleanup target is missing from source and quarantine', 'INVALID_ARCHIVE');
    await requireDirectoryIdentity(quarantine, proof.source_identity, 'quarantined cleanup target');
  }
  return quarantine;
}

/**
 * Derives a bounded cleanup identity from an ID or canonical open/cleanup path reference.
 * @param {string} root - Project root.
 * @param {string} reference - Work ID or path supplied to the completion command.
 * @returns {string|null} Safe Work Item ID, or `null` for an unrelated reference.
 */
function cleanupIdFromReference(root, reference) {
  if (typeof reference !== 'string' || !reference.trim()) return null;
  if (ID_PATTERN.test(reference)) return reference;
  if (reference.includes('\\') || path.posix.isAbsolute(reference) || path.posix.normalize(reference) !== reference) return null;
  const match = /^\.agent-work\/(?:open|cleanup)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/work\.md)?$/.exec(reference);
  return match?.[1] ?? null;
}

/**
 * Validates a minimal, non-semantic completion receipt.
 * @param {object} receipt - Candidate receipt.
 * @param {string|null} expectedId - Optional expected identity.
 * @returns {object} Validated receipt.
 */
function validateCompletionReceipt(receipt, expectedId = null) {
  ensure(receipt && JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(['id', 'result', 'version', 'work']), 'completion receipt is malformed', 'INVALID_ARCHIVE');
  ensure(receipt.version === 1 && ID_PATTERN.test(receipt.id) && (!expectedId || receipt.id === expectedId), 'completion receipt identity is invalid', 'INVALID_ARCHIVE');
  ensure(canonicalArchivePath(receipt.work) && receipt.work.split('/').at(-2) === receipt.id, 'completion receipt path is invalid', 'INVALID_ARCHIVE');
  ensure(receipt.result && JSON.stringify(Object.keys(receipt.result).sort()) === JSON.stringify(['stage', 'status']) && receipt.result.status === 'completed' && typeof receipt.result.stage === 'string' && receipt.result.stage, 'completion receipt result is invalid', 'INVALID_ARCHIVE');
  return receipt;
}

/**
 * Publishes the bounded idempotency receipt before final source cleanup.
 * @param {string} root - Project root.
 * @param {object} proof - Valid cleanup proof.
 * @returns {Promise<void>} Resolves after durable receipt publication.
 */
async function writeCompletionReceipt(root, proof) {
  const project = await anchoredProjectRoot(root);
  const receiptRoot = await anchoredDirectory(project, ['.agent-work', 'completion-receipts'], { create: true });
  await chmod(receiptRoot, 0o700);
  const receipt = validateCompletionReceipt({ version: 1, id: proof.id, work: `${proof.archive}/work.md`, result: proof.result }, proof.id);
  const receiptFile = path.join(receiptRoot, `${proof.id}.json`);
  await atomicReplace(receiptFile, `${JSON.stringify(receipt)}\n`);
  await pruneCompletionReceipts(project, receiptFile);
}

/**
 * Reads and revalidates a completion receipt for a lost-response retry.
 * @param {string} root - Project root.
 * @param {string} reference - Raw Work Item reference.
 * @returns {Promise<object|null>} Archived path and original mutation result.
 */
export async function readCompletionReceipt(root, reference) {
  const id = cleanupIdFromReference(root, reference);
  if (!id) return null;
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const receiptRoot = path.join(project, '.agent-work', 'completion-receipts');
    if (!(await entryExists(receiptRoot))) return null;
    await anchoredDirectory(project, ['.agent-work', 'completion-receipts']);
    const receiptFile = path.join(receiptRoot, `${id}.json`);
    if (!(await entryExists(receiptFile))) return null;
    let receipt;
    try { receipt = validateCompletionReceipt(JSON.parse(await readFileNoFollow(receiptFile, 'utf8', 'completion receipt')), id); }
    catch (error) { if (error.code) throw error; fail(`invalid JSON: ${receiptFile}`, 'INVALID_ARCHIVE'); }
    ensure(
      (await readHistoryIndex(project)).some((entry) => entry.path === receipt.work && entry.id === id && entry.status === 'completed'),
      `completion receipt is not backed by the archive index: ${id}`,
      'INVALID_ARCHIVE',
    );
    const archived = await anchorArchiveWork(project, path.join(project, ...receipt.work.split('/')));
    return { archived, result: receipt.result };
  });
}

/**
 * Keeps completion receipts bounded without traversing or retaining Work Item bodies.
 * @param {string} project - Anchored project root.
 * @param {string|null} protectedFile - Newly published receipt that must survive pruning.
 * @returns {Promise<void>} Resolves after retaining at most 128 receipts.
 */
async function pruneCompletionReceipts(project, protectedFile = null) {
  const receiptRoot = await anchoredDirectory(project, ['.agent-work', 'completion-receipts'], { create: true });
  const entries = [];
  for (const entry of await readdir(receiptRoot, { withFileTypes: true })) {
    ensure(entry.isFile() && !entry.isSymbolicLink() && /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(entry.name), `completion receipt entry is invalid: ${entry.name}`, 'INVALID_ARCHIVE');
    const file = path.join(receiptRoot, entry.name);
    entries.push({ file, modified: (await stat(file)).mtimeMs });
  }
  entries.sort((left, right) => Number(right.file === protectedFile) - Number(left.file === protectedFile)
    || right.modified - left.modified);
  for (const entry of entries.slice(128)) await unlink(entry.file);
  if (entries.length > 128) await syncDirectory(receiptRoot);
}

/**
 * Resumes bounded deletion after archive and index publication committed but source cleanup was interrupted.
 * @param {string} root - Project root.
 * @param {string} reference - Work ID or canonical open/cleanup path.
 * @returns {Promise<string|null>} Archived Work path when recovery completed, otherwise `null`.
 */
export async function resumeCommittedArchiveCleanup(root, reference) {
  const id = cleanupIdFromReference(root, reference);
  if (!id) return null;
  const project = await anchoredProjectRoot(root);
  return withProjectLock(project, async () => {
    const context = await cleanupContext(root, id);
    if (!(await entryExists(context.journal))) return null;
    const proof = await readCommitJournal(context.journal, id);
    await bindCleanupContextToProof(context, proof);
    const quarantine = path.join(root, ...proof.quarantine.split('/'));
    if (await entryExists(context.cleanup)) {
      await requireRealDirectory(context.cleanup, context.cleanupReal, 'cleanup target');
      const identityFile = path.join(context.cleanup, 'state.json');
      if (await entryExists(identityFile)) {
        const identityStats = await lstat(identityFile);
        ensure(identityStats.isFile() && !identityStats.isSymbolicLink(), `cleanup identity must be a real file: ${identityFile}`, 'INVALID_ARCHIVE');
        let state;
        try { state = JSON.parse(await readFileNoFollow(identityFile, 'utf8', 'cleanup identity')); }
        catch { fail(`invalid JSON: ${identityFile}`, 'INVALID_ARCHIVE'); }
        ensure(state?.id === id, `cleanup identity does not match its path: ${context.cleanup}`, 'INVALID_ARCHIVE');
      } else {
        ensure((await readdir(context.cleanup)).length === 0, `cleanup identity is missing: ${identityFile}`, 'INVALID_ARCHIVE');
      }
    }
    const archivedWork = await verifyCommittedArchive(root, proof);
    if (await entryExists(context.cleanup) || await entryExists(quarantine)) {
      const detached = await quarantineCommittedCleanup(context, proof);
      await waitForTestBarrier('WORKFLOW_TEST_CLEANUP_PRE_REMOVE_BARRIER');
      await removeCommittedCleanup(detached, path.join(context.quarantineRootReal, path.basename(detached)), context, proof.source_identity, proof.source_manifest);
    }
    if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_JOURNAL_REMOVE === '1') fail('injected cleanup-journal interruption', 'ATOMIC_FAILURE');
    await unlink(context.journal);
    await syncDirectory(context.cleanupRoot);
    return { archived: archivedWork, result: proof.result };
  });
}

/**
 * Validates one private archive-attempt journal.
 * @param {object} proof - Candidate journal.
 * @param {string} nonce - Nonce fixed by its filename.
 * @returns {object} Validated proof.
 */
function validateArchiveAttempt(proof, nonce) {
  ensure(proof && JSON.stringify(Object.keys(proof).sort()) === JSON.stringify(['created_at', 'identity', 'nonce', 'pid', 'previous_stage', 'process_start', 'stage', 'version']), 'archive attempt journal is malformed', 'INVALID_ARCHIVE');
  ensure(proof.version === 2 && proof.nonce === nonce && /^[a-f0-9-]{36}$/.test(nonce), 'archive attempt identity is invalid', 'INVALID_ARCHIVE');
  ensure(Number.isInteger(proof.pid) && proof.pid > 0 && (proof.process_start === null || typeof proof.process_start === 'string') && !Number.isNaN(Date.parse(proof.created_at)), 'archive attempt owner is invalid', 'INVALID_ARCHIVE');
  validateDirectoryIdentity(proof.identity, 'archive attempt');
  ensure(typeof proof.stage === 'string' && !proof.stage.includes('\\') && path.posix.normalize(proof.stage) === proof.stage, 'archive attempt stage is non-canonical', 'INVALID_ARCHIVE');
  ensure(
    /^\.agent-work\/archive\/\d{4}\/\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9-]{36}\.stage$/.test(proof.stage)
      || /^\.agent-work\/recovery\/failed-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9-]{36}$/.test(proof.stage),
    'archive attempt stage is outside private namespaces',
    'INVALID_ARCHIVE',
  );
  ensure(proof.previous_stage === null || typeof proof.previous_stage === 'string', 'archive attempt previous stage is invalid', 'INVALID_ARCHIVE');
  if (proof.previous_stage !== null) ensure(
    /^\.agent-work\/archive\/\d{4}\/\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9-]{36}\.stage$/.test(proof.previous_stage),
    'archive attempt previous stage is outside its private namespace',
    'INVALID_ARCHIVE',
  );
  return proof;
}

/**
 * Reports whether an archive attempt still belongs to a live process instance.
 * @param {object} proof - Valid attempt journal.
 * @returns {Promise<boolean>} Conservative liveness result.
 */
async function archiveAttemptIsLive(proof) {
  if (proof.pid === process.pid) return activeArchiveAttempts.has(proof.nonce);
  if (!processExists(proof.pid)) return false;
  const current = await processStartIdentity(proof.pid);
  return proof.process_start && current ? proof.process_start === current : true;
}

/**
 * Prunes only identity-bound, old, dead archive attempts and old empty pre-journal stages.
 * @param {string} project - Anchored project root.
 * @param {string|null} protectedStage - Current active stage.
 * @returns {Promise<void>} Resolves after bounded recovery maintenance.
 */
async function pruneArchiveAttempts(project, protectedStage = null) {
  const attemptRoot = await anchoredDirectory(project, ['.agent-work', 'archive-attempts'], { create: true });
  const referenced = new Set();
  for (const entry of await readdir(attemptRoot, { withFileTypes: true })) {
    ensure(entry.isFile() && !entry.isSymbolicLink() && /^[a-f0-9-]{36}\.json$/.test(entry.name), `archive attempt entry is invalid: ${entry.name}`, 'INVALID_ARCHIVE');
    const nonce = entry.name.slice(0, -5);
    const journal = path.join(attemptRoot, entry.name);
    let proof;
    try { proof = validateArchiveAttempt(JSON.parse(await readFileNoFollow(journal, 'utf8', 'archive attempt journal')), nonce); }
    catch (error) { if (error.code) throw error; fail(`invalid JSON: ${journal}`, 'INVALID_ARCHIVE'); }
    referenced.add(proof.stage);
    if (proof.previous_stage) referenced.add(proof.previous_stage);
    const candidates = [proof.stage, proof.previous_stage].filter(Boolean)
      .map((relative) => path.join(project, ...relative.split('/')));
    if (candidates.includes(protectedStage) || await archiveAttemptIsLive(proof)) continue;
    const present = [];
    for (const candidate of candidates) if (await entryExists(candidate)) present.push(candidate);
    ensure(present.length <= 1, `archive attempt exists at multiple locations: ${proof.nonce}`, 'INVALID_ARCHIVE');
    if (present.length === 1) {
      const stage = present[0];
      await requireDirectoryIdentity(stage, proof.identity, 'stale archive stage');
      const manifest = await sourceAuthorizationManifest(stage);
      const directories = new Map(manifest.filter(({ type }) => type === 'directory').map(({ path: name, identity }) => [name, identity]));
      await removePrivateStage(stage, stage, proof.identity, directories);
      await syncDirectory(path.dirname(stage));
    }
    await unlink(journal);
    await syncDirectory(attemptRoot);
  }
  const archiveRoot = await anchoredDirectory(project, ['.agent-work', 'archive'], { create: true });
  for (const year of await readdir(archiveRoot, { withFileTypes: true })) {
    if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
    const yearRoot = await anchoredDirectory(project, ['.agent-work', 'archive', year.name]);
    for (const entry of await readdir(yearRoot, { withFileTypes: true })) {
      if (!entry.name.startsWith('.') || !entry.name.endsWith('.stage')) continue;
      const stage = path.join(yearRoot, entry.name);
      const relative = path.relative(project, stage).split(path.sep).join('/');
      if (stage === protectedStage || referenced.has(relative)) continue;
      ensure(entry.isDirectory() && !entry.isSymbolicLink() && /^\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9-]{36}\.stage$/.test(entry.name), `unrecognized archive stage: ${stage}`, 'INVALID_ARCHIVE');
      const stats = await lstat(stage);
      if (Date.now() - stats.mtimeMs < ARCHIVE_ATTEMPT_GRACE_MS) continue;
      ensure((await readdir(stage)).length === 0, `unjournaled archive stage is not empty: ${stage}`, 'INVALID_ARCHIVE');
      const identity = await directoryIdentity(stage, 'orphan archive stage');
      await requireDirectoryIdentity(stage, identity, 'orphan archive stage');
      await rmdir(stage);
      await syncDirectory(yearRoot);
    }
  }
}

/**
 * Archives a completed tree.
 * @param {string} root - Project root.
 * @param {string} workFile - Top-level work path.
 * @param {Date} now - Archive clock.
 * @param {object|null} preparedDocument - Optional in-memory completed top-level document.
 * @param {object|null} completionResult - Minimal completion response retained for idempotency.
 * @returns {Promise<string>} Archived work path.
 */
async function archiveTree(root, workFile, now = new Date(), preparedDocument = null, completionResult = null) {
  const projectRoot = await anchoredProjectRoot(root);
  await anchoredDirectory(projectRoot, ['.agent-work', 'open']);
  const sourceContext = await openWorkContext(workFile);
  const directory = path.dirname(workFile);
  const openRoot = path.resolve(root, '.agent-work', 'open');
  ensure(sourceContext.directory === directory && path.dirname(directory) === openRoot, 'only a completed top-level tree can be archived', 'INVALID_ARCHIVE');
  const year = String(now.getUTCFullYear());
  const destination = path.join(root, '.agent-work', 'archive', year, path.basename(directory));
  return withProjectLock(projectRoot, async () => {
    await pruneArchiveAttempts(projectRoot);
    await assertNoPairArtifacts(directory);
    const sourceIdentity = await directoryIdentity(directory, 'open Work Item source');
    const sourceCopyManifest = await archiveManifest(directory);
    const sourceManifest = await sourceAuthorizationManifest(directory);
    await anchoredDirectory(projectRoot, ['.agent-work', 'archive', year], { create: true });
    if (await entryExists(destination)) await requireRealDirectory(destination, path.join(await realpath(projectRoot), '.agent-work', 'archive', year, path.basename(directory)), 'archive destination');
    const attemptNonce = randomUUID();
    const staging = path.join(path.dirname(destination), `.${path.basename(destination)}.${attemptNonce}.stage`);
    await mkdir(staging, { mode: 0o700 });
    const stageIdentity = await directoryIdentity(staging, 'staging root');
    const attemptRoot = await anchoredDirectory(projectRoot, ['.agent-work', 'archive-attempts'], { create: true });
    const attemptFile = path.join(attemptRoot, `${attemptNonce}.json`);
    let attemptProof = validateArchiveAttempt({
      version: 2,
      nonce: attemptNonce,
      pid: process.pid,
      process_start: await processStartIdentity(process.pid),
      created_at: new Date().toISOString(),
      stage: path.relative(projectRoot, staging).split(path.sep).join('/'),
      previous_stage: null,
      identity: stageIdentity,
    }, attemptNonce);
    await atomicReplace(attemptFile, `${JSON.stringify(attemptProof, null, 2)}\n`);
    await syncDirectory(attemptRoot);
    activeArchiveAttempts.add(attemptNonce);
    let stageDirectories = new Map();
    try {
      for (const entry of await readdir(directory)) {
        await cp(path.join(directory, entry), path.join(staging, entry), { recursive: true, errorOnExist: true });
      }
      await assertNoPairArtifacts(staging);
      ensure(JSON.stringify(await archiveManifest(staging)) === JSON.stringify(sourceCopyManifest), 'staged archive copy does not match its authorized source', 'INVALID_ARCHIVE');
      const stageDirectoryManifest = await sourceAuthorizationManifest(staging);
      stageDirectories = new Map(stageDirectoryManifest
        .filter((entry) => entry.type === 'directory')
        .map((entry) => [entry.path, entry.identity]));
      /**
       * Revalidates the private staging-root object.
       * @returns {Promise<void>} Resolves while staging identity is unchanged.
       */
      const stageGuard = () => requireDirectoryIdentity(staging, stageIdentity, 'staging root');
      if (preparedDocument) {
        await atomicReplace(path.join(staging, 'work.md'), preparedDocument.markdown.endsWith('\n') ? preparedDocument.markdown : `${preparedDocument.markdown}\n`, stageGuard);
        await atomicReplace(path.join(staging, 'state.json'), `${JSON.stringify(preparedDocument.state, null, 2)}\n`, stageGuard);
      }
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_COPY === '1') fail('injected archive preparation failure', 'ATOMIC_FAILURE');
      if (process.env.WORKFLOW_TEST_ARCHIVE_CHILD_SYMLINK_TARGET) {
        const child = path.join(staging, 'children', 'proof-child');
        await rename(child, `${child}.saved`);
        await symlink(process.env.WORKFLOW_TEST_ARCHIVE_CHILD_SYMLINK_TARGET, child);
      }
      await assertNoPairArtifacts(staging);
      await stageGuard();
      await rewriteArchivedChildLinks(staging, staging, stageIdentity, stageDirectories);
      await assertNoPairArtifacts(staging);
      const entries = await collectArchiveEntries(root, staging);
      await removeRuntimeState(staging, staging, stageIdentity, stageDirectories);
      await assertArchivePrepared(staging);
      const manifest = await archiveManifest(staging);
      const stagingRelative = path.relative(root, staging);
      const destinationRelative = path.relative(root, destination);
      const publishedEntries = entries.map((entry) => ({
        ...entry,
        path: entry.path.replace(stagingRelative, destinationRelative),
      }));

      if (await entryExists(destination)) {
        await assertArchivePrepared(destination);
        ensure(JSON.stringify(await archiveManifest(destination)) === JSON.stringify(manifest), `published archive does not match open work: ${destination}`, 'ALREADY_EXISTS');
        const destinationWork = path.join(destination, 'work.md');
        /**
         * Matches an existing index entry by published destination.
         * @param {object} entry - Archive index entry.
         * @returns {boolean} Whether the entry names this destination.
         */
        const indexed = (await readHistoryIndex(root)).find((entry) => path.resolve(root, entry.path) === destinationWork);
        ensure(!indexed || indexed.id === preparedDocument?.state?.id, `archive index conflicts with: ${destination}`, 'ALREADY_EXISTS');
        await removePrivateStage(staging, staging, stageIdentity, stageDirectories);
        await syncDirectory(path.dirname(staging));
      } else {
        await rename(staging, destination);
        await requireDirectoryIdentity(destination, stageIdentity, 'published archive');
        await syncDirectory(path.dirname(destination));
        if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_PUBLISH === '1') {
          fail('injected archive publication interruption', 'ATOMIC_FAILURE');
        }
      }

      await unlink(attemptFile);
      await syncDirectory(attemptRoot);

      await writeHistoryIndex(root, publishedEntries);
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_INDEX === '1') {
        fail('injected archive cleanup interruption', 'ATOMIC_FAILURE');
      }
      const cleanupRoot = await anchoredDirectory(projectRoot, ['.agent-work', 'cleanup'], { create: true });
      const quarantineRoot = await anchoredDirectory(projectRoot, ['.agent-work', 'cleanup-quarantine'], { create: true });
      await chmod(quarantineRoot, 0o700);
      const id = path.basename(directory);
      const context = await cleanupContext(root, id);
      ensure(!(await entryExists(context.cleanup)), `cleanup path already exists: ${context.cleanup}`, 'ALREADY_EXISTS');
      const existingProof = await entryExists(context.journal) ? await readCommitJournal(context.journal, id) : null;
      const proof = validateCommitJournal({
        version: 3,
        id,
        source: `.agent-work/open/${id}`,
        archive: path.relative(root, destination),
        quarantine: existingProof?.quarantine ?? `.agent-work/cleanup-quarantine/${id}-${randomUUID()}`,
        manifest,
        source_identity: sourceIdentity,
        source_manifest: sourceManifest,
        trusted_identities: {
          project: context.projectIdentity,
          agent_work: context.agentWorkIdentity,
          cleanup_root: context.cleanupRootIdentity,
          quarantine_root: context.quarantineRootIdentity,
        },
        index: publishedEntries,
        result: completionResult,
      }, id);
      if (existingProof) {
        ensure(JSON.stringify(existingProof) === JSON.stringify(proof), `cleanup commit journal conflicts with: ${id}`, 'INVALID_ARCHIVE');
      } else {
        await atomicReplace(context.journal, `${JSON.stringify(proof, null, 2)}\n`);
      }
      await verifyCommittedArchive(root, proof);
      await writeCompletionReceipt(root, proof);
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_JOURNAL === '1') {
        fail('injected cleanup-journal publication interruption', 'ATOMIC_FAILURE');
      }
      const project = await realpath(root);
      const openRootReal = path.join(project, '.agent-work', 'open');
      await bindCleanupContextToProof(context, proof);
      await requireRealDirectory(openRoot, openRootReal, 'open root');
      await requireRealDirectory(directory, path.join(openRootReal, id), 'open Work Item');
      await requireDirectoryIdentity(directory, proof.source_identity, 'open Work Item source');
      await verifyAuthorizedSourceManifest(directory, proof.source_manifest, id);
      await rename(directory, context.cleanup);
      await Promise.all([syncDirectory(openRoot), syncDirectory(context.cleanupRoot)]);
      await requireDirectoryIdentity(context.cleanup, proof.source_identity, 'cleanup target');
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_CLEANUP_RENAME === '1') {
        fail('injected archive post-commit interruption', 'ATOMIC_FAILURE');
      }
      const detached = await quarantineCommittedCleanup(context, proof);
      await waitForTestBarrier('WORKFLOW_TEST_CLEANUP_PRE_REMOVE_BARRIER');
      await removeCommittedCleanup(detached, path.join(context.quarantineRootReal, path.basename(detached)), context, proof.source_identity, proof.source_manifest);
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_BEFORE_JOURNAL_REMOVE === '1') {
        fail('injected cleanup-journal interruption', 'ATOMIC_FAILURE');
      }
      await unlink(context.journal);
      await syncDirectory(context.cleanupRoot);
      if (process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_FINAL_CLEANUP === '1') fail('injected lost completion response', 'ATOMIC_FAILURE');
      activeArchiveAttempts.delete(attemptNonce);
      return path.join(destination, 'work.md');
    } catch (error) {
      let recoveryInterrupted = false;
      if (await entryExists(staging)) {
        await requireDirectoryIdentity(staging, stageIdentity, 'failed staging root');
        const recoveryRoot = await anchoredDirectory(projectRoot, ['.agent-work', 'recovery'], { create: true });
        const recovery = path.join(recoveryRoot, `failed-${path.basename(directory)}-${attemptNonce}`);
        attemptProof = validateArchiveAttempt({
          ...attemptProof,
          stage: path.relative(projectRoot, recovery).split(path.sep).join('/'),
          previous_stage: path.relative(projectRoot, staging).split(path.sep).join('/'),
        }, attemptNonce);
        await atomicReplace(attemptFile, `${JSON.stringify(attemptProof, null, 2)}\n`);
        await syncDirectory(attemptRoot);
        await rename(staging, recovery);
        await requireDirectoryIdentity(recovery, stageIdentity, 'failed staging root');
        recoveryInterrupted = process.env.WORKFLOW_TEST_FAIL_ARCHIVE_AFTER_RECOVERY_RENAME === '1';
        await Promise.all([syncDirectory(path.dirname(staging)), syncDirectory(recoveryRoot)]);
      }
      activeArchiveAttempts.delete(attemptNonce);
      if (recoveryInterrupted) fail('injected recovery rename interruption', 'ATOMIC_FAILURE');
      throw error;
    }
  });
}

/**
 * Completes and archives top-level work without persisting a completed open state first.
 * @param {string} root - Project root.
 * @param {string} workFile - Open Work path.
 * @param {object} options - Owner and clock.
 * @param {Function} mutate - Completion mutator.
 * @returns {Promise<object>} Mutation response and archived path.
 */
export async function completeAndArchiveAt(root, workFile, { owner, now = new Date() }, mutate) {
  const context = await openWorkProject(workFile);
  workFile = context.workFile;
  return withProjectLock(context.project, async () => {
    const document = await readAt(workFile);
    assertOwner(document, owner, now);
    const result = await mutate(document);
    document.frontmatter.updated_at = nowIso(now);
    syncWork(document);
    validateDocument(document, { file: workFile });
    const archived = await archiveTree(root, workFile, now, document, result);
    return { result, archived };
  });
}

/**
 * Initializes workflow directories.
 * @param {string} root - Project root.
 * @returns {Promise<object>} Initialization result.
 */
export async function initWorkspace(root) {
  const project = await anchoredProjectRoot(root, { create: true });
  return withProjectLock(project, async () => {
    await anchoredDirectory(project, ['.agent-work', 'open'], { create: true });
    await anchoredDirectory(project, ['.agent-work', 'archive'], { create: true });
    await anchoredDirectory(project, ['.agent-work', 'cleanup'], { create: true });
    await anchoredDirectory(project, ['.agent-work', 'cleanup-quarantine'], { create: true });
    await anchoredDirectory(project, ['.agent-work', 'child-transactions'], { create: true });
    await anchoredDirectory(project, ['.agent-work', 'archive-attempts'], { create: true });
    await pruneArchiveAttempts(project);
    await pruneCompletionReceipts(project);
    const archiveIndex = path.join(project, '.agent-work', 'archive', 'index.md');
    if (!(await exists(archiveIndex))) await atomicReplace(archiveIndex, ARCHIVE_INDEX_HEADER);
    await readHistoryIndex(project);
    return { ok: true, workspace: '.agent-work/open' };
  });
}
