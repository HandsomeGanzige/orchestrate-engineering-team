#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
const files = [
  "packages/config/src/index.js",
  "packages/adapter-contract/src/index.js",
  ".agents/skills/orchestrate-engineering-team/SKILL.md",
  ".agents/skills/orchestrate-engineering-team/references/execution-continuity.md",
  ".agents/skills/orchestrate-engineering-team/references/role-contracts.yaml",
];
for (const file of files) { const source = await readFile(`${root}/${file}`, "utf8"); assert.doesNotMatch(source, /\.pi\/|\.claude\/|\.codex\/|\.gemini\/|pi-subagents|Claude Code|Codex|Gemini CLI/i, `${file} contains host-specific semantics`); }
assert.equal(await readFile(`${root}/packages/config/schema.json`, "utf8"), await readFile(`${root}/.agents/skills/orchestrate-engineering-team/references/config.schema.json`, "utf8"), "published and Skill config schemas drifted");
console.log("Host-neutral core check passed.");
