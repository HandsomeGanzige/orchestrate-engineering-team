#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PLUGIN_NAME = "orchestrate-engineering-team";
const MARKETPLACE_NAME = "orchestrate-engineering-team";
const PLUGIN_SELECTOR = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const EXPECTED_SKILLS = Object.freeze([
  "architect-work-item",
  "develop-work-item",
  "orchestrate-engineering-team",
  "review-work-item",
  "verify-work-item",
]);

export function assertDisposableCiRunner(environment = process.env) {
  if (
    environment.CI !== "true" ||
    environment.GITHUB_ACTIONS !== "true" ||
    !environment.RUNNER_TEMP
  ) {
    throw new Error(
      "Codex plugin lifecycle is restricted to a disposable GitHub Actions runner",
    );
  }
  return path.resolve(environment.RUNNER_TEMP);
}

function runCodex(args, environment, { allowFailure = false } = {}) {
  const result = spawnSync("codex", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: environment,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = result.error?.message || result.stderr.trim() || result.stdout.trim();
    throw new Error(`codex ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}`, { cause: error });
  }
}

function containsInstalledPlugin(value) {
  if (Array.isArray(value)) return value.some(containsInstalledPlugin);
  if (!value || typeof value !== "object") return false;

  const identifyingFields = ["id", "name", "plugin", "plugin_name", "selector"];
  if (
    identifyingFields.some(
      (field) => value[field] === PLUGIN_NAME || value[field] === PLUGIN_SELECTOR,
    )
  ) {
    return value.installed !== false;
  }
  return Object.values(value).some(containsInstalledPlugin);
}

export function assertDiscoveredPluginSkills(response, codexHome) {
  assert.ok(response && Array.isArray(response.data), "skills/list did not return data entries");
  const pluginCache = `${path.join(codexHome, "plugins", "cache")}${path.sep}`;
  const entries = response.data;
  const pluginSkills = entries
    .flatMap((entry) => (Array.isArray(entry.skills) ? entry.skills : []))
    .filter(
      (skill) =>
        typeof skill?.path === "string" &&
        path.resolve(skill.path).startsWith(pluginCache),
    );
  const discoveredNames = pluginSkills.map(({ name }) => name).sort();
  const expectedNames = EXPECTED_SKILLS.map((name) => `${PLUGIN_NAME}:${name}`);
  assert.deepEqual(
    discoveredNames,
    expectedNames,
    "Codex did not discover exactly the five installed Plugin Skills",
  );
  assert.ok(
    pluginSkills.every(({ enabled }) => enabled === true),
    "one or more installed Plugin Skills were disabled",
  );

  const pluginErrors = entries
    .flatMap((entry) => (Array.isArray(entry.errors) ? entry.errors : []))
    .filter(
      (error) =>
        typeof error?.path === "string" &&
        path.resolve(error.path).startsWith(pluginCache),
    );
  assert.deepEqual(pluginErrors, [], "Codex reported errors while loading installed Plugin Skills");
}

async function discoverInstalledPluginSkills(environment, codexHome) {
  const workspace = path.join(codexHome, "skill-discovery-workspace");
  await mkdir(workspace);
  const child = spawn("codex", ["app-server", "--stdio"], {
    cwd: workspace,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`skills/list timed out: ${stderr.trim()}`)),
      15_000,
    );
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (!settled) {
        finish(reject, new Error(`codex app-server exited ${code}: ${stderr.trim()}`));
      }
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          finish(reject, new Error(`codex app-server returned invalid JSON: ${error.message}`));
          return;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(reject, new Error(`codex initialize failed: ${JSON.stringify(message.error)}`));
            return;
          }
          send({ method: "initialized" });
          send({
            id: 2,
            method: "skills/list",
            params: { cwds: [workspace], forceReload: true },
          });
        } else if (message.id === 2) {
          if (message.error) {
            finish(reject, new Error(`skills/list failed: ${JSON.stringify(message.error)}`));
          } else {
            finish(resolve, message.result);
          }
        }
      }
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "orchestrate-engineering-team-ci", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    });
  }).finally(() => {
    child.stdin.end();
    child.kill();
  });

  assertDiscoveredPluginSkills(response, codexHome);
}

export async function runCodexPluginLifecycle(environment = process.env) {
  const runnerTemp = assertDisposableCiRunner(environment);
  const isolatedCodexHome = await mkdtemp(
    path.join(runnerTemp, "orchestrate-codex-lifecycle-"),
  );
  const commandEnvironment = {
    ...environment,
    CODEX_HOME: isolatedCodexHome,
  };
  let marketplaceAdded = false;
  let pluginInstalled = false;
  const cleanupFailures = [];

  try {
    runCodex(["plugin", "marketplace", "add", PROJECT_ROOT, "--json"], commandEnvironment);
    marketplaceAdded = true;

    runCodex(["plugin", "add", PLUGIN_SELECTOR, "--json"], commandEnvironment);
    pluginInstalled = true;

    const installed = parseJsonOutput(
      runCodex(["plugin", "list", "--json"], commandEnvironment),
      "codex plugin list after install",
    );
    assert.ok(containsInstalledPlugin(installed), `${PLUGIN_SELECTOR} was not listed as installed`);

    await discoverInstalledPluginSkills(commandEnvironment, isolatedCodexHome);

    runCodex(["plugin", "remove", PLUGIN_SELECTOR, "--json"], commandEnvironment);
    pluginInstalled = false;

    const removed = parseJsonOutput(
      runCodex(["plugin", "list", "--json"], commandEnvironment),
      "codex plugin list after removal",
    );
    assert.equal(containsInstalledPlugin(removed), false, `${PLUGIN_SELECTOR} remained installed`);

    runCodex(
      ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"],
      commandEnvironment,
    );
    marketplaceAdded = false;
  } finally {
    if (pluginInstalled) {
      const result = runCodex(
        ["plugin", "remove", PLUGIN_SELECTOR, "--json"],
        commandEnvironment,
        { allowFailure: true },
      );
      if (result.error || result.status !== 0) cleanupFailures.push("installed plugin");
    }
    if (marketplaceAdded) {
      const result = runCodex(
        ["plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"],
        commandEnvironment,
        { allowFailure: true },
      );
      if (result.error || result.status !== 0) cleanupFailures.push("marketplace");
    }
    await rm(isolatedCodexHome, { recursive: true, force: true });
    assert.deepEqual(cleanupFailures, [], `failed to clean up ${cleanupFailures.join(" and ")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCodexPluginLifecycle();
    console.log("Codex plugin lifecycle passed on the disposable CI runner.");
  } catch (error) {
    console.error(`Codex plugin lifecycle failed: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}
