#!/usr/bin/env node
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAgentProfiles } from "../agent-profiles/checker.mjs";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export function buildSkillInstallArguments(source) { return ["--yes", "skills@1.5.19", "add", source, "--skill", "orchestrate-engineering-team", "--agent", "codex", "--yes"]; }
export function buildSkillRemoveArguments() { return ["--yes", "skills@1.5.19", "remove", "orchestrate-engineering-team", "--agent", "codex", "--yes"]; }
export async function assertInstalledSkillSuite(targetRoot) { const names = (await readdir(path.join(targetRoot, ".agents/skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); assert.deepEqual(names, ["orchestrate-engineering-team"]); const result = await checkAgentProfiles(targetRoot); assert.equal(result.ok, true); return { skills: 1, roles: 4, mainResources: result.summary.mainResources }; }
export async function runSkillCliInstall() { const temp = await mkdtemp(path.join(os.tmpdir(), "oet-skill-smoke-")); try { await cp(path.join(ROOT, ".agents"), path.join(temp, ".agents"), { recursive: true }); return await assertInstalledSkillSuite(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
if (import.meta.url === pathToFileURL(process.argv[1]).href) runSkillCliInstall().then((summary) => console.log(`Skill install fixture passed: ${summary.skills} public Skill, ${summary.roles} roles, and ${summary.mainResources} Main resources.`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
