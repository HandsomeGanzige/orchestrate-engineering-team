#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  checkAgentProfiles,
  formatDiagnostic,
  parseStrictYaml,
} from "../agent-profiles/checker.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXPECTED_SKILLS = Object.freeze([
  "architect-work-item",
  "develop-work-item",
  "orchestrate-engineering-team",
  "review-work-item",
  "verify-work-item",
]);
const EXCLUDED_TOP_LEVEL = new Set([".agent-work", ".git", "node_modules"]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`could not parse ${file}: ${error.message}`, { cause: error });
  }
}

function exactKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys changed`);
}

function resolveBundledPath(root, relativePath, label, { allowRoot = false } = {}) {
  assert.equal(typeof relativePath, "string", `${label} must be a string`);
  assert.ok(relativePath.startsWith("./"), `${label} must start with './'`);
  const resolved = path.resolve(root, relativePath);
  assert.ok(
    (allowRoot && resolved === root) || resolved.startsWith(`${root}${path.sep}`),
    `${label} must remain inside ${root}`,
  );
  return resolved;
}

export async function checkCopiedPackage(sourceRoot = PROJECT_ROOT) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "orchestrate-package-"));
  const marketplaceRoot = path.join(temporaryRoot, "marketplace");
  try {
    await cp(sourceRoot, marketplaceRoot, {
      recursive: true,
      filter(source) {
        const relative = path.relative(sourceRoot, source);
        const topLevel = relative.split(path.sep)[0];
        return !EXCLUDED_TOP_LEVEL.has(topLevel);
      },
    });

    await assert.rejects(access(path.join(marketplaceRoot, ".agent-work")));

    const marketplace = await readJson(
      path.join(marketplaceRoot, ".agents/plugins/marketplace.json"),
    );
    exactKeys(marketplace, ["name", "interface", "plugins"], "marketplace");
    assert.equal(marketplace.name, "orchestrate-engineering-team");
    assert.equal(marketplace.plugins.length, 1);
    const listing = marketplace.plugins[0];
    exactKeys(listing, ["name", "source", "policy", "category"], "plugin listing");
    assert.equal(listing.name, "orchestrate-engineering-team");
    exactKeys(listing.source, ["source", "path"], "plugin source");
    assert.equal(listing.source.source, "local");
    assert.equal(listing.source.path, "./");
    exactKeys(listing.policy, ["installation", "authentication"], "plugin policy");
    assert.equal(listing.policy.installation, "AVAILABLE");
    assert.equal(listing.policy.authentication, "ON_INSTALL");
    assert.equal(listing.category, "Developer Tools");
    const pluginRoot = resolveBundledPath(
      marketplaceRoot,
      listing.source.path,
      "marketplace plugin path",
      { allowRoot: true },
    );

    const manifest = await readJson(path.join(pluginRoot, ".codex-plugin/plugin.json"));
    assert.equal(manifest.name, listing.name);
    assert.equal(manifest.version, "0.1.0");
    assert.equal(manifest.license, "MIT");
    assert.equal(
      manifest.repository,
      "https://github.com/HandsomeGanzige/orchestrate-engineering-team",
    );
    assert.equal(manifest.skills, "./.agents/skills/");
    const skillsRoot = resolveBundledPath(pluginRoot, manifest.skills, "manifest skills path");
    const skills = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(skills, [...EXPECTED_SKILLS]);
    await Promise.all(
      skills.flatMap((skill) => [
        access(path.join(skillsRoot, skill, "SKILL.md")),
        access(path.join(skillsRoot, skill, "agents/openai.yaml")),
      ]),
    );

    const registryPath = path.join(
      skillsRoot,
      "orchestrate-engineering-team/references/agent-profiles.yaml",
    );
    const registry = parseStrictYaml(await readFile(registryPath, "utf8")).value;
    assert.equal(registry.enforcement, "advisory");
    for (const profile of Object.values(registry.profiles)) {
      const roleSkill = resolveBundledPath(pluginRoot, `./${profile.skill.path}`, "role Skill path");
      await access(roleSkill);
    }

    const profileCheck = await checkAgentProfiles(pluginRoot);
    assert.equal(
      profileCheck.ok,
      true,
      profileCheck.diagnostics.map(formatDiagnostic).join("\n"),
    );

    const packageMetadata = await readJson(path.join(pluginRoot, "package.json"));
    assert.equal(packageMetadata.private, true);
    assert.equal(packageMetadata.version, manifest.version);
    assert.match(await readFile(path.join(pluginRoot, "LICENSE"), "utf8"), /MIT License/);

    return {
      plugin: manifest.name,
      version: manifest.version,
      skills: skills.length,
      profiles: Object.keys(registry.profiles).length,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function main() {
  const summary = await checkCopiedPackage();
  console.log(
    `Copied-package structural smoke passed: ${summary.plugin}@${summary.version}, ${summary.skills} Skills, ${summary.profiles} advisory profiles.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Copied-package structural smoke failed: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}
