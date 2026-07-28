import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertInstalledSkillSuite,
  assertRemovedSkillDirectories,
  assertRetainedProjectLock,
  buildIsolatedCommandEnvironment,
  buildSkillInstallArguments,
  buildSkillRemoveArguments,
} from "./skill-cli-install.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("Skill CLI arguments pin the installer and select all Codex Skills project-locally", () => {
  assert.deepEqual(buildSkillInstallArguments("/tmp/local-source"), [
    "--yes",
    "skills@1.5.19",
    "add",
    "/tmp/local-source",
    "--skill",
    "*",
    "--agent",
    "codex",
    "--yes",
  ]);
  assert.equal(buildSkillInstallArguments("/tmp/local-source").includes("--global"), false);
  assert.deepEqual(buildSkillRemoveArguments(), [
    "--yes",
    "skills@1.5.19",
    "remove",
    "orchestrate-engineering-team",
    "architect-work-item",
    "develop-work-item",
    "verify-work-item",
    "review-work-item",
    "--agent",
    "codex",
    "--yes",
  ]);
});

test("Skill CLI child state is rooted inside the disposable lifecycle directory", () => {
  const temporaryRoot = path.resolve("/tmp/orchestrate-lifecycle-fixture");
  const { commandEnvironment, isolatedPaths } = buildIsolatedCommandEnvironment(
    { PATH: process.env.PATH, INIT_CWD: PROJECT_ROOT },
    temporaryRoot,
  );

  assert.equal(commandEnvironment.INIT_CWD, undefined);
  assert.equal(commandEnvironment.HOME, path.join(temporaryRoot, "child-user-home"));
  assert.equal(commandEnvironment.CODEX_HOME, path.join(temporaryRoot, "child-codex-home"));
  assert.ok(
    isolatedPaths.every(
      (isolatedPath) => isolatedPath.startsWith(`${temporaryRoot}${path.sep}`),
    ),
  );
});

test("README presents the exact Skill-first GitHub command before the optional Plugin", async () => {
  const readme = await readFile(path.join(PROJECT_ROOT, "README.md"), "utf8");
  const primaryCommand =
    "npx --yes skills@1.5.19 add HandsomeGanzige/orchestrate-engineering-team --skill '*' --agent codex --yes";
  const installPosition = readme.indexOf(primaryCommand);
  const optionalPluginPosition = readme.indexOf("### Optional Codex Plugin adapter");

  assert.notEqual(installPosition, -1, "README is missing the pinned primary command");
  assert.ok(
    optionalPluginPosition > installPosition,
    "optional Plugin instructions appeared before the primary Skill installation",
  );
  assert.match(
    readme,
    /removes the five installed directories[\s\S]+retains their five entries[\s\S]+`skills-lock\.json`/,
  );
  assert.doesNotMatch(readme, /--ref\s+v\d/);
  assert.match(readme, /fork_turns: \"none\"/);
  assert.match(readme, /owner Main is the only writer/i);
});

test("installed-suite validation accepts the five canonical Skills and resources", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "installed-skill-suite-"));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await mkdir(path.join(targetRoot, ".agents"), { recursive: true });
  await cp(
    path.join(PROJECT_ROOT, ".agents/skills"),
    path.join(targetRoot, ".agents/skills"),
    { recursive: true },
  );

  assert.deepEqual(await assertInstalledSkillSuite(targetRoot), {
    skills: 5,
    profiles: 4,
  });
});

test("installed-suite validation executes installed templates and rejects template corruption", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "installed-template-runtime-"));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await mkdir(path.join(targetRoot, ".agents"), { recursive: true });
  await cp(
    path.join(PROJECT_ROOT, ".agents/skills"),
    path.join(targetRoot, ".agents/skills"),
    { recursive: true },
  );

  await assertInstalledSkillSuite(targetRoot);
  const installedTemplate = path.join(
    targetRoot,
    ".agents/skills/orchestrate-engineering-team/assets/work-item-index.md",
  );
  const template = await readFile(installedTemplate, "utf8");
  await writeFile(
    installedTemplate,
    template.replace(
      "⟪ORCHESTRATE:WORK_GOAL_JSON:6D71B11E⟫",
      "corrupted-installed-template",
    ),
  );

  await assert.rejects(
    assertInstalledSkillSuite(targetRoot),
    (error) => error.code === "INVALID_TEMPLATE"
      && /template sentinel set does not match replacements/.test(error.message),
  );
});

test("installed-suite validation rejects corruption in the installed public workflow wrapper", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "installed-workflow-runtime-"));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await mkdir(path.join(targetRoot, ".agents"), { recursive: true });
  await cp(
    path.join(PROJECT_ROOT, ".agents/skills"),
    path.join(targetRoot, ".agents/skills"),
    { recursive: true },
  );

  await assertInstalledSkillSuite(targetRoot);
  const installedEntry = path.join(
    targetRoot,
    ".agents/skills/orchestrate-engineering-team/scripts/workflow.mjs",
  );
  const wrapper = await readFile(installedEntry, "utf8");
  await writeFile(
    installedEntry,
    wrapper.replace(
      "#!/usr/bin/env node\n",
      '#!/usr/bin/env node\nthrow new Error("broken installed workflow wrapper");\n',
    ),
  );

  await assert.rejects(
    assertInstalledSkillSuite(targetRoot),
    /broken installed workflow wrapper/,
  );
});

test("installed-suite validation rejects newly corrupted transitive initialization", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "installed-transitive-runtime-"));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  await mkdir(path.join(targetRoot, ".agents"), { recursive: true });
  await cp(
    path.join(PROJECT_ROOT, ".agents/skills"),
    path.join(targetRoot, ".agents/skills"),
    { recursive: true },
  );

  await assertInstalledSkillSuite(targetRoot);
  const installedDependency = path.join(
    targetRoot,
    ".agents/skills/orchestrate-engineering-team/scripts/workflow-contract.mjs",
  );
  await writeFile(
    installedDependency,
    `throw new Error("broken installed transitive initialization");\n${await readFile(installedDependency, "utf8")}`,
  );

  await assert.rejects(
    assertInstalledSkillSuite(targetRoot),
    /broken installed transitive initialization/,
  );
});

test("installed-suite validation follows and confines the actual workflow import closure", async (t) => {
  const cases = [
    {
      name: "third-party bare import",
      module: "value-policy.mjs",
      importLine: 'import "yaml";',
      expected: /must not import third-party runtime module 'yaml'/,
    },
    {
      name: "directory escape",
      module: "workflow-runtime.mjs",
      importLine: 'import "../../../../../../outside-runtime.mjs";',
      expected: /import escaped the bundled scripts directory/,
    },
    {
      name: "missing transitive module",
      module: "workflow-document.mjs",
      importLine: 'import "./missing-runtime.mjs";',
      expected: /workflow runtime module is missing/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const targetRoot = await mkdtemp(path.join(os.tmpdir(), "installed-import-closure-"));
      t.after(() => rm(targetRoot, { recursive: true, force: true }));
      await mkdir(path.join(targetRoot, ".agents"), { recursive: true });
      await cp(
        path.join(PROJECT_ROOT, ".agents/skills"),
        path.join(targetRoot, ".agents/skills"),
        { recursive: true },
      );
      const modulePath = path.join(
        targetRoot,
        ".agents/skills/orchestrate-engineering-team/scripts",
        fixture.module,
      );
      await writeFile(
        modulePath,
        `${fixture.importLine}\n${await readFile(modulePath, "utf8")}`,
      );
      await assert.rejects(assertInstalledSkillSuite(targetRoot), fixture.expected);
    });
  }
});

test("removal validation requires absent directories and five retained lock entries", async (t) => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "removed-skill-suite-"));
  t.after(() => rm(targetRoot, { recursive: true, force: true }));
  const skills = Object.fromEntries(
    [
      "architect-work-item",
      "develop-work-item",
      "orchestrate-engineering-team",
      "review-work-item",
      "verify-work-item",
    ].map((name) => [name, { sourceType: "local" }]),
  );
  await writeFile(
    path.join(targetRoot, "skills-lock.json"),
    `${JSON.stringify({ version: 1, skills }, null, 2)}\n`,
  );

  await assertRemovedSkillDirectories(targetRoot);
  assert.deepEqual(await assertRetainedProjectLock(targetRoot), Object.keys(skills).sort());
});
