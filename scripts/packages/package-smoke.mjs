#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
function run(command, args, cwd) { const result = spawnSync(command, args, { cwd, encoding: "utf8" }); if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`); return result.stdout.trim(); }
const temp = await mkdtemp(path.join(os.tmpdir(), "oet-pack-"));
try {
  const tarballs = [];
  for (const name of ["config", "adapter-contract", "cli"]) { const output = run("pnpm", ["pack", "--pack-destination", temp], path.join(root, "packages", name)); const match = output.split(/\r?\n/).find((line) => line.endsWith(".tgz")); assert.ok(match, `no tarball for ${name}`); tarballs.push(path.isAbsolute(match) ? match : path.join(root, "packages", name, match)); }
  run("npm", ["init", "--yes"], temp);
  run("npm", ["install", "--ignore-scripts", ...tarballs], temp);
  const help = run(process.execPath, [path.join(temp, "node_modules/@orchestrate-engineering-team/cli/bin/oet.js"), "--help"], temp);
  assert.match(help, /oet doctor/);
  for (const tarball of tarballs) { const list = run("tar", ["-tzf", tarball], temp); assert.doesNotMatch(list, /node_modules|\/test\//); }
  const manifest = JSON.parse(await readFile(path.join(temp, "node_modules/@orchestrate-engineering-team/cli/package.json"), "utf8")); assert.equal(manifest.name, "@orchestrate-engineering-team/cli");
  console.log("Package tarball smoke passed for config, adapter-contract, and CLI.");
} finally { await rm(temp, { recursive: true, force: true }); }
