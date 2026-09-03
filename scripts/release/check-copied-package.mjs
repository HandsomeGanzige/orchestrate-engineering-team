#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAgentProfiles, formatDiagnostic } from "../agent-profiles/checker.mjs";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export async function checkCopiedPackage(sourceRoot = ROOT) { const temp = await mkdtemp(path.join(os.tmpdir(), "oet-copy-")); const copy = path.join(temp, "package"); try { await cp(sourceRoot, copy, { recursive: true, filter(source) { const parts = path.relative(sourceRoot, source).split(path.sep); return !parts.some((part) => new Set([".git", "node_modules", ".agent-work"]).has(part)); } }); const skills = (await readdir(path.join(copy, ".agents/skills"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); assert.deepEqual(skills, ["orchestrate-engineering-team"]); const plugin = JSON.parse(await readFile(path.join(copy, ".codex-plugin/plugin.json"), "utf8")); assert.equal(plugin.version, "1.0.0"); assert.equal(plugin.skills, "./.agents/skills/"); const result = await checkAgentProfiles(copy); assert.equal(result.ok, true, result.diagnostics.map(formatDiagnostic).join("\n")); for (const packageName of ["config", "adapter-contract", "cli"]) await access(path.join(copy, "packages", packageName, "package.json")); return { skills: 1, roles: 4, mainResources: result.summary.mainResources, packages: 3 }; } finally { await rm(temp, { recursive: true, force: true }); } }
export async function main() { const summary = await checkCopiedPackage(); console.log(`Copied-package smoke passed: ${summary.skills} public Skill, ${summary.roles} roles, ${summary.mainResources} Main resources, ${summary.packages} optional/shared packages.`); }
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
