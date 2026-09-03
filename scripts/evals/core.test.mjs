import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { constants, discoverCases, filterEvents, runSuite, validateCaseManifest, validateJudgeResult } from "./core.mjs";
import { createCodexRunner } from "./runners/codex.mjs";
import { createFakeRunner } from "./runners/fake.mjs";
import { parseArguments } from "./run.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function manifest(id = "sample-case") {
  return {
    apiVersion: constants.CASE_API_VERSION,
    id,
    title: "Sample case",
    description: "Exercise the evaluation harness.",
    timeoutMs: 10_000,
    sandbox: "workspace-write",
    phases: [{ id: "execute", promptFile: "prompt.md" }],
    environment: { blockedCommands: [] },
    checks: [
      { id: "result-file", type: "file", path: "result.txt", exists: true, contains: ["done"] },
      { id: "allowed-change", type: "changed-paths", allow: ["result.txt"], require: ["result.txt"] },
      { id: "event-visible", type: "event", pattern: "command_execution", minMatches: 1 },
    ],
    judge: { rubricFile: "rubric.md", threshold: 80, criticalCriteria: ["contract"] },
  };
}

async function makeCase(root, id = "sample-case") {
  const caseDir = path.join(root, id);
  await mkdir(path.join(caseDir, "fixture"), { recursive: true });
  await writeFile(path.join(caseDir, "case.json"), `${JSON.stringify(manifest(id), null, 2)}\n`);
  await writeFile(path.join(caseDir, "prompt.md"), "Create result.txt containing done.\n");
  await writeFile(path.join(caseDir, "rubric.md"), "- contract (critical): complete the requested change.\n");
  await writeFile(path.join(caseDir, "fixture", "README.md"), "fixture\n");
  return caseDir;
}

test("manifest validation rejects unsafe and unknown fields", () => {
  assert.equal(validateCaseManifest(manifest()).id, "sample-case");
  assert.throws(() => validateCaseManifest({ ...manifest(), surprise: true }), /unknown field/);
  assert.throws(() => validateCaseManifest({ ...manifest(), phases: [{ id: "x", promptFile: "../escape" }] }), /safe relative/);
});

test("argument parsing supports selection, runners, models, repeat, and output flags", () => {
  assert.deepEqual(parseArguments(["--case", "one", "--case", "two", "--repeat", "2", "--runner", "runner.mjs", "--judge-runner", "judge.mjs", "--model", "candidate", "--judge-model", "judge", "--json", "--keep-workspaces"]), { cases: ["one", "two"], repeat: 2, runner: "runner.mjs", judgeRunner: "judge.mjs", model: "candidate", judgeModel: "judge", json: true, list: false, keepWorkspaces: true });
  assert.equal(parseArguments(["--repeat", "0"]), null);
  assert.equal(parseArguments(["--", "--list"]).list, true);
});

test("event filtering removes reasoning and sensitive fields while retaining tool evidence", () => {
  const filtered = filterEvents([{ type: "item.completed", item: { type: "reasoning", text: "hidden" } }, { type: "item.completed", item: { type: "command_execution", command: "node --test", token: "secret" } }]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].item.command, "node --test");
  assert.equal(filtered[0].item.token, undefined);
});

test("judge validation enforces score threshold and every critical criterion", () => {
  const evalCase = manifest();
  const raw = { caseId: "sample-case", score: 90, criteria: [{ id: "contract", passed: true, evidence: "result.txt", explanation: "done" }], violations: [], summary: "pass" };
  const passing = validateJudgeResult(raw, evalCase);
  assert.equal(passing.passed, true);
  const failing = validateJudgeResult({ ...raw, score: 100, criteria: [{ ...raw.criteria[0], passed: false }] }, evalCase);
  assert.equal(failing.passed, false);
});

test("Codex runner terminates a timed-out process", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "oet-eval-timeout-"));
  try {
    const executable = path.join(temp, "slow-codex");
    await writeFile(executable, "#!/usr/bin/env node\nsetTimeout(() => {}, 10_000);\n");
    await chmod(executable, 0o755);
    const result = await createCodexRunner({ executable }).run({ kind: "candidate", cwd: temp, prompt: "wait", timeoutMs: 50 });
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("fake runner exercises isolated workspace, hard checks, judge, and reports", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "oet-eval-test-"));
  try {
    const casesRoot = path.join(temp, "cases");
    await makeCase(casesRoot);
    const [evalCase] = await discoverCases(casesRoot);
    const runner = createFakeRunner({ runs: [
      async ({ cwd }) => {
        assert.match(await readFile(path.join(cwd, ".agents", "skills", "orchestrate-engineering-team", "SKILL.md"), "utf8"), /orchestrat/i);
        await writeFile(path.join(cwd, "result.txt"), "done\n");
        return { exitCode: 0, events: [{ type: "item.completed", item: { type: "reasoning", text: "omit" } }, { type: "item.completed", item: { type: "command_execution", command: "write result" } }], finalMessage: "Completed result.txt", usage: { input_tokens: 10 } };
      },
      ({ kind, sandbox, outputSchema }) => {
        assert.equal(kind, "judge");
        assert.equal(sandbox, "read-only");
        assert.equal(outputSchema, path.join(ROOT, "scripts", "evals", "judge.schema.json"));
        return { exitCode: 0, events: [], finalMessage: JSON.stringify({ caseId: "sample-case", score: 90, criteria: [{ id: "contract", passed: true, evidence: "result.txt contains done", explanation: "request satisfied" }], violations: [], summary: "pass" }), usage: { input_tokens: 5 } };
      },
    ] });
    const runsRoot = path.join(temp, "runs");
    const result = await runSuite({ cases: [evalCase], runner, root: ROOT, runsRoot, skillRoot: path.join(ROOT, ".agents", "skills", "orchestrate-engineering-team") });
    assert.equal(result.passed, true, JSON.stringify(result.cases[0], null, 2));
    assert.equal(runner.calls(), 2);
    assert.match(await readFile(path.join(runsRoot, "report.md"), "utf8"), /PASS/);
    assert.match(await readFile(path.join(runsRoot, "sample-case", "1", "diff.patch"), "utf8"), /result\.txt/);
    assert.doesNotMatch(await readFile(path.join(runsRoot, "sample-case", "1", "events.jsonl"), "utf8"), /omit/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
