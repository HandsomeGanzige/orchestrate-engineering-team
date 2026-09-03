import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverCases } from "./core.mjs";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CASES_ROOT = path.join(ROOT, "evals", "cases");
const EXPECTED_IDS = [
  "architecture-confirmed-doc",
  "architecture-unconfirmed",
  "dynamic-team-delivery",
  "fresh-context-continuity",
  "generic-fallback-packet",
  "independent-product-review",
  "optional-capability-missing",
  "required-capability-missing",
  "single-agent-exit",
  "tool-neutral-discovery",
];

test("the initial behavior suite contains ten valid, fully rubriced cases", async () => {
  const cases = await discoverCases(CASES_ROOT);
  assert.deepEqual(cases.map((item) => item.id), EXPECTED_IDS);
  for (const item of cases) {
    for (const criterion of item.judge.criticalCriteria) assert.equal(item.rubric.includes(`\`${criterion}\``), true, `${item.id} rubric omits ${criterion}`);
  }
});

test("special case mechanics describe isolation boundaries", async () => {
  const cases = new Map((await discoverCases(CASES_ROOT)).map((item) => [item.id, item]));
  assert.deepEqual(cases.get("tool-neutral-discovery").environment.blockedCommands, ["rg"]);
  assert.deepEqual(cases.get("fresh-context-continuity").phases.map((phase) => phase.id), ["stage-one", "stage-two"]);
  assert.equal(cases.get("architecture-confirmed-doc").checks.find((check) => check.id === "strict-write-scope").allow.includes("src/**"), false);
});

test("seeded implementation fixtures begin with observable failing behavior", async () => {
  const failingFixtures = ["dynamic-team-delivery", "fresh-context-continuity", "independent-product-review", "optional-capability-missing", "tool-neutral-discovery"];
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  for (const id of failingFixtures) {
    let failed = false;
    try { await execFileAsync("node", ["--test"], { cwd: path.join(CASES_ROOT, id, "fixture"), env: environment, timeout: 30_000 }); }
    catch { failed = true; }
    assert.equal(failed, true, `${id} unexpectedly passed before candidate work`);
  }
});
