import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkAgentProfiles,
  formatDiagnostic,
  parseStrictYaml,
  STANDARD_RETURN,
} from "./checker.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = path.join(PROJECT_ROOT, "scripts/agent-profiles/check.mjs");

/**
 * Creates a disposable repository fixture containing the canonical Agent Skill metadata.
 *
 * @returns {Promise<string>} Absolute temporary repository path owned by the calling test.
 */
async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-profiles-"));
  await cp(path.join(PROJECT_ROOT, ".agents"), path.join(root, ".agents"), {
    recursive: true,
  });
  return root;
}

test("strict YAML parser accepts standard YAML constructs and protects mappings", () => {
  const source = [
    "count: 1",
    "values: &shared",
    "  - first",
    "  - second",
    "copy: *shared",
    "literal: |",
    "  first line",
    "  second line",
    "folded: >",
    "  folded",
    "  text",
    "metadata: {}",
    "labels: {org/key: value, nested: [workspace-read, shell]}",
  ].join("\n");

  const { value } = parseStrictYaml(source);

  assert.equal(Object.getPrototypeOf(value), null);
  assert.deepEqual({ ...value }, {
    count: 1,
    values: ["first", "second"],
    copy: ["first", "second"],
    literal: "first line\nsecond line\n",
    folded: "folded text\n",
    metadata: Object.create(null),
    labels: Object.assign(Object.create(null), {
      "org/key": "value",
      nested: ["workspace-read", "shell"],
    }),
  });
});

test("strict YAML parser rejects invalid, unsafe, or excessive structures", () => {
  assert.throws(
    () => parseStrictYaml("duplicate: first\nduplicate: second"),
    /Map keys must be unique/,
  );
  assert.throws(
    () => parseStrictYaml("value:\n\t- tabbed"),
    /Tabs are not allowed/,
  );
  assert.throws(
    () => parseStrictYaml("? [sequence, key]\n: value"),
    /mapping keys must be strings/,
  );
  const aliases = Array.from({ length: 60 }, () => "*shared").join(", ");
  assert.throws(
    () => parseStrictYaml(`shared: &shared [value]\ncopies: [${aliases}]`),
    /Excessive alias count/,
  );
  assert.throws(
    () => parseStrictYaml("recursive: &recursive [*recursive]"),
    /recursive YAML aliases/,
  );
});

test("mapping keys cannot mutate prototypes or bypass exact-key validation", async (t) => {
  const parsed = parseStrictYaml("__proto__:\n  polluted: true\nsafe: value").value;

  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(Object.getPrototypeOf(parsed.__proto__), null);
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);

  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const registryPath = path.join(
    root,
    ".agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml",
  );
  const registry = await readFile(registryPath, "utf8");
  await writeFile(
    registryPath,
    registry.replace("enforcement: advisory", "enforcement: advisory\n__proto__: polluted"),
  );

  const result = await checkAgentProfiles(root);
  const diagnostic = result.diagnostics.find(({ code }) => code === "REGISTRY_KEYS");

  assert.equal(result.ok, false);
  assert.match(diagnostic?.reason ?? "", /unexpected __proto__/);
  assert.equal({}.polluted, undefined);
});

test("validates the project Agent Profiles and metadata", async () => {
  const result = await checkAgentProfiles(PROJECT_ROOT);

  assert.equal(result.ok, true, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.deepEqual(result.summary, {
    skills: 5,
    uiMetadataFiles: 5,
    profiles: 4,
    returnContracts: 9,
  });
  assert.deepEqual(STANDARD_RETURN, [
    "status",
    "summary",
    "artifacts",
    "files",
    "checks",
    "requires_test",
    "test_reason",
    "requires_review",
    "review_reason",
    "blockers",
  ]);
});

test("accepts every current Agent Skills frontmatter field", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillPath = path.join(
    root,
    ".agents/skills/architect-work-item/SKILL.md",
  );
  const source = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    source.replace(
      /(  author: [^\n]+)\n---/,
      '$1\nallowed-tools: "Read Grep Glob"\n---',
    ),
  );

  const result = await checkAgentProfiles(root);

  assert.equal(result.ok, true, result.diagnostics.map(formatDiagnostic).join("\n"));
});

test("accepts standard block scalars, empty metadata, and arbitrary metadata keys", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillPath = path.join(
    root,
    ".agents/skills/architect-work-item/SKILL.md",
  );
  const source = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    source
      .replace(/^description:.*$/m, "description: >\n  Architecture work-item role\n  with a folded description.")
      .replace(/metadata:\n(?:  .*\n)+---/, "metadata: {}\n---"),
  );

  let result = await checkAgentProfiles(root);
  assert.equal(result.ok, true, result.diagnostics.map(formatDiagnostic).join("\n"));

  const withEmptyMetadata = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    withEmptyMetadata.replace("metadata: {}", 'metadata:\n  org/key: "architecture"'),
  );
  result = await checkAgentProfiles(root);
  assert.equal(result.ok, true, result.diagnostics.map(formatDiagnostic).join("\n"));
});

test("main Skill requires empty-history dispatch and Main-only task state", async () => {
  const source = await readFile(
    path.join(
      PROJECT_ROOT,
      ".agents/skills/orchestrate-engineering-team/SKILL.md",
    ),
    "utf8",
  );
  assert.match(source, /fork_turns\s*[":=]\s*["']?none["']?/i);
  assert.match(
    source,
    /(?:only|sole|unique|single)[^\n]{0,100}(?:Main|owner)|(?:Main|owner)[^\n]{0,100}(?:only|sole|unique|single)/i,
  );
});

test("enforces Agent Skills field names, types, and bounds", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillPath = path.join(
    root,
    ".agents/skills/architect-work-item/SKILL.md",
  );
  const source = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    source
      .replace("name: architect-work-item", "name: -invalid--name")
      .replace(
        /^description:.*$/m,
        `description: ${"x".repeat(1025)}`,
      )
      .replace(/  author: [^\n]+/, "  author: 1\nallowed-tools: [Read]\nunexpected: value"),
  );

  const result = await checkAgentProfiles(root);
  const codes = result.diagnostics.map(({ code }) => code);

  assert.equal(result.ok, false);
  assert.ok(codes.includes("SKILL_FRONTMATTER_KEYS"));
  assert.ok(codes.includes("SKILL_NAME"));
  assert.ok(codes.includes("SKILL_DESCRIPTION"));
  assert.ok(codes.includes("SKILL_METADATA"));
  assert.ok(codes.includes("SKILL_ALLOWED_TOOLS"));
});

test("collects independent schema and return-contract diagnostics deterministically", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const registryPath = path.join(
    root,
    ".agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml",
  );
  const uiPath = path.join(
    root,
    ".agents/skills/verify-work-item/agents/openai.yaml",
  );
  const roleSkillPath = path.join(
    root,
    ".agents/skills/develop-work-item/SKILL.md",
  );
  await Promise.all([
    readFile(registryPath, "utf8").then((source) =>
      writeFile(
        registryPath,
        source
          .replace("enforcement: advisory", "enforcement: mandatory")
          .replace(
            "write_scope: assigned-production-files-or-modules-only",
            "write_scope: repository-wide",
          )
          .replace(
            "required: [workspace-read, workspace-write, shell]",
            "required: [workspace-read, workspace-read, shell]",
          )
          .replace(
            "prohibited: [task-state-write, user-decision]",
            "prohibited: [user-decision]",
          ),
      ),
    ),
    writeFile(
      uiPath,
      [
        "interface:",
        '  display_name: "Test Agent"',
        '  short_description: "Test"',
        '  default_prompt: "Use $verify-work-item to test."',
        '  unexpected: "field"',
        "policy:",
        "  allow_implicit_invocation: true",
      ].join("\n"),
    ),
    readFile(roleSkillPath, "utf8").then((source) =>
      writeFile(
        roleSkillPath,
        source.replace(
          /(^-\s+`?)status(`?\s*:)|^status\s*:/m,
          (match) => match.replace("status", "outcome"),
        ),
      ),
    ),
  ]);

  const result = await checkAgentProfiles(root);
  const codes = result.diagnostics.map(({ code }) => code);

  assert.equal(result.ok, false);
  assert.ok(codes.includes("ENFORCEMENT"));
  assert.ok(codes.includes("CAPABILITY_DUPLICATE"));
  assert.ok(codes.includes("PROFILE_WRITE_SCOPE"));
  assert.ok(codes.includes("TASK_STATE_CAPABILITY"));
  assert.ok(codes.includes("UI_INTERFACE_KEYS"));
  assert.ok(codes.includes("UI_IMPLICIT_INVOCATION"));
  assert.ok(codes.includes("RETURN_CONTRACT"));
  assert.deepEqual(
    result.diagnostics,
    [...result.diagnostics].sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.column - right.column ||
        left.code.localeCompare(right.code) ||
        left.reason.localeCompare(right.reason),
    ),
  );
  for (const diagnostic of result.diagnostics) {
    assert.match(formatDiagnostic(diagnostic), /^.+:\d+:\d+ \[[A-Z_]+\] .+$/);
  }
});

test("requires the workflow registry, workflow resources, role packet, and state boundaries", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const mainRoot = path.join(root, ".agents/skills/orchestrate-engineering-team");
  const registryPath = path.join(mainRoot, "references/agent-profiles.yaml");
  const packetPath = path.join(mainRoot, "assets/role-task-packet.md");
  const registry = await readFile(registryPath, "utf8");
  const packet = await readFile(packetPath, "utf8");

  await Promise.all([
    writeFile(registryPath, registry.replace("enforcement: advisory", "enforcement: strict")),
    writeFile(packetPath, packet.replace(/fork_turns\s*:\s*["']?none["']?/i, "fork_turns: all")),
    rm(path.join(mainRoot, "references/state-and-voting.md")),
    rm(path.join(mainRoot, "scripts/workflow.mjs")),
    rm(path.join(mainRoot, "scripts/value-policy.mjs")),
  ]);

  const result = await checkAgentProfiles(root);
  const codes = result.diagnostics.map(({ code }) => code);

  assert.equal(result.ok, false);
  assert.ok(codes.includes("ENFORCEMENT"));
  assert.ok(codes.includes("EMPTY_HISTORY"));
  assert.equal(codes.filter((code) => code === "FILE_MISSING").length, 3);
  assert.ok(result.diagnostics.some(
    ({ code, file }) => code === "FILE_MISSING" && file.endsWith("/scripts/value-policy.mjs"),
  ));
});

test("CLI uses exit 0 for success, 1 for validation failure, and 2 for bad usage", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(
    path.join(root, ".agents/skills/review-work-item/agents/openai.yaml"),
  );

  const success = spawnSync(process.execPath, [CLI, "--root", PROJECT_ROOT], {
    encoding: "utf8",
  });
  const validationFailure = spawnSync(process.execPath, [CLI, "--root", root], {
    encoding: "utf8",
  });
  const usageFailure = spawnSync(process.execPath, [CLI, "--unknown"], {
    encoding: "utf8",
  });

  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /Agent Profile check passed:/);
  assert.equal(validationFailure.status, 1);
  assert.match(validationFailure.stderr, /\[FILE_MISSING\]/);
  assert.doesNotMatch(validationFailure.stderr, /\n\s+at /);
  assert.equal(usageFailure.status, 2);
  assert.match(usageFailure.stderr, /^Usage:/);
  assert.doesNotMatch(usageFailure.stderr, /\n\s+at /);
});
