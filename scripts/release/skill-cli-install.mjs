#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkAgentProfiles,
  formatDiagnostic,
  parseStrictYaml,
} from "../agent-profiles/checker.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INSTALLER_PACKAGE = "skills@1.5.19";
const EXPECTED_SKILLS = Object.freeze([
  "architect-work-item",
  "develop-work-item",
  "orchestrate-engineering-team",
  "review-work-item",
  "verify-work-item",
]);
const LIFECYCLE_SKILLS = Object.freeze([
  "orchestrate-engineering-team",
  "architect-work-item",
  "develop-work-item",
  "verify-work-item",
  "review-work-item",
]);

export function buildSkillInstallArguments(source) {
  return [
    "--yes",
    INSTALLER_PACKAGE,
    "add",
    source,
    "--skill",
    "*",
    "--agent",
    "codex",
    "--yes",
  ];
}

export function buildSkillRemoveArguments() {
  return [
    "--yes",
    INSTALLER_PACKAGE,
    "remove",
    ...LIFECYCLE_SKILLS,
    "--agent",
    "codex",
    "--yes",
  ];
}

function containedPath(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  assert.ok(
    resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`),
    `isolated path escaped the temporary root: ${resolved}`,
  );
  return resolved;
}

export function buildIsolatedCommandEnvironment(environment, temporaryRoot) {
  const isolatedUserRoot = containedPath(temporaryRoot, "child-user-home");
  const isolatedCodexRoot = containedPath(temporaryRoot, "child-codex-home");
  const isolatedConfigRoot = containedPath(temporaryRoot, "child-xdg-config");
  const isolatedDataRoot = containedPath(temporaryRoot, "child-xdg-data");
  const isolatedCacheRoot = containedPath(temporaryRoot, "child-xdg-cache");
  const npmCache = containedPath(temporaryRoot, "npm-cache");
  const commandEnvironment = {
    ...environment,
    CI: "true",
    NO_COLOR: "1",
    HOME: isolatedUserRoot,
    USERPROFILE: isolatedUserRoot,
    CODEX_HOME: isolatedCodexRoot,
    XDG_CONFIG_HOME: isolatedConfigRoot,
    XDG_DATA_HOME: isolatedDataRoot,
    XDG_CACHE_HOME: isolatedCacheRoot,
    npm_config_cache: npmCache,
    npm_config_userconfig: containedPath(temporaryRoot, "child-npmrc"),
  };
  delete commandEnvironment.INIT_CWD;
  return {
    commandEnvironment,
    isolatedPaths: [
      isolatedUserRoot,
      isolatedCodexRoot,
      isolatedConfigRoot,
      isolatedDataRoot,
      isolatedCacheRoot,
      npmCache,
    ],
  };
}

function run(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

async function createLocalSourceRepository(root) {
  await mkdir(path.join(root, ".agents"), { recursive: true });
  await cp(
    path.join(PROJECT_ROOT, ".agents/skills"),
    path.join(root, ".agents/skills"),
    { recursive: true },
  );
  run("git", ["init", "--quiet"], root);
  run("git", ["add", ".agents/skills"], root);
  run(
    "git",
    [
      "-c",
      "user.name=Skill Install Smoke",
      "-c",
      "user.email=skill-install-smoke@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Skill installation fixture",
    ],
    root,
  );
}

function gitOutput(args, root) {
  return run("git", args, root).stdout.trim();
}

async function installedSkillNames(skillsRoot) {
  const entries = await readdir(skillsRoot);
  const names = [];
  for (const entry of entries) {
    const installed = await stat(path.join(skillsRoot, entry));
    if (installed.isDirectory()) names.push(entry);
  }
  return names.sort();
}

export async function assertInstalledSkillSuite(targetRoot) {
  const skillsRoot = path.join(targetRoot, ".agents/skills");
  assert.deepEqual(
    await installedSkillNames(skillsRoot),
    [...EXPECTED_SKILLS],
    "the installer did not create exactly the five project-local Skills",
  );

  await Promise.all(
    EXPECTED_SKILLS.flatMap((skill) => [
      stat(path.join(skillsRoot, skill, "SKILL.md")),
      stat(path.join(skillsRoot, skill, "agents/openai.yaml")),
    ]),
  );
  await Promise.all([
    stat(
      path.join(
        skillsRoot,
        "orchestrate-engineering-team/assets/subagent-task-packet.md",
      ),
    ),
    stat(
      path.join(
        skillsRoot,
        "orchestrate-engineering-team/references/agent-profiles.yaml",
      ),
    ),
  ]);

  const registryPath = path.join(
    skillsRoot,
    "orchestrate-engineering-team/references/agent-profiles.yaml",
  );
  const registry = parseStrictYaml(await readFile(registryPath, "utf8")).value;
  for (const profile of Object.values(registry.profiles)) {
    const roleSkill = path.resolve(targetRoot, profile.skill.path);
    assert.ok(
      roleSkill.startsWith(`${skillsRoot}${path.sep}`),
      `installed profile path escaped the project Skill root: ${profile.skill.path}`,
    );
    await stat(roleSkill);
  }

  const profileCheck = await checkAgentProfiles(targetRoot);
  assert.equal(
    profileCheck.ok,
    true,
    profileCheck.diagnostics.map(formatDiagnostic).join("\n"),
  );
  return {
    skills: EXPECTED_SKILLS.length,
    profiles: Object.keys(registry.profiles).length,
  };
}

export async function assertRetainedProjectLock(targetRoot) {
  const lockPath = path.join(targetRoot, "skills-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(lock.version, 1, "unexpected project Skill lock version");
  assert.ok(lock.skills && typeof lock.skills === "object", "project Skill lock is missing skills");
  const retained = Object.keys(lock.skills).sort();
  assert.deepEqual(
    retained,
    [...EXPECTED_SKILLS],
    "project Skill lock did not retain exactly the five suite entries",
  );
  return retained;
}

async function assertReinstallRestoresInstalledContent(
  targetRoot,
  sourceRoot,
  sourceUrl,
  npx,
  environment,
) {
  const relativeSkillFile = path.join(
    ".agents",
    "skills",
    "orchestrate-engineering-team",
    "SKILL.md",
  );
  const installedFile = path.join(targetRoot, relativeSkillFile);
  const sourceFile = path.join(sourceRoot, relativeSkillFile);
  const expected = await readFile(sourceFile, "utf8");
  await writeFile(installedFile, `${expected}\n<!-- refresh-smoke-corruption -->\n`);
  assert.notEqual(
    await readFile(installedFile, "utf8"),
    expected,
    "refresh fixture did not alter the installed Skill",
  );

  run(npx, buildSkillInstallArguments(sourceUrl), targetRoot, environment);
  assert.equal(
    await readFile(installedFile, "utf8"),
    expected,
    "re-running the install command did not restore content from its Git source",
  );
}

export async function assertRemovedSkillDirectories(targetRoot) {
  const skillsRoot = path.join(targetRoot, ".agents/skills");
  const remaining = await readdir(skillsRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(remaining, [], "one or more suite Skill directories remained after removal");
  for (const skill of EXPECTED_SKILLS) {
    await assert.rejects(
      stat(path.join(skillsRoot, skill)),
      (error) => error?.code === "ENOENT",
      `${skill} directory remained after removal`,
    );
  }
}

export async function runSkillCliInstall(environment = process.env) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "orchestrate-skill-install-"));
  const localSource = containedPath(temporaryRoot, "source-repository");
  const targetRoot = containedPath(temporaryRoot, "target-repository");
  const { commandEnvironment, isolatedPaths } = buildIsolatedCommandEnvironment(
    environment,
    temporaryRoot,
  );
  try {
    await Promise.all([
      mkdir(localSource, { recursive: true }),
      mkdir(targetRoot, { recursive: true }),
      ...isolatedPaths.map((isolatedPath) => mkdir(isolatedPath, { recursive: true })),
    ]);
    await createLocalSourceRepository(localSource);
    run("git", ["init", "--quiet"], targetRoot);
    const sourceRevision = gitOutput(["rev-parse", "HEAD"], localSource);
    assert.equal(gitOutput(["status", "--porcelain=v1"], localSource), "");

    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    const gitSourceUrl = pathToFileURL(localSource).href;
    run(npx, buildSkillInstallArguments(gitSourceUrl), targetRoot, commandEnvironment);
    const installed = await assertInstalledSkillSuite(targetRoot);
    await assertRetainedProjectLock(targetRoot);

    await assertReinstallRestoresInstalledContent(
      targetRoot,
      localSource,
      gitSourceUrl,
      npx,
      commandEnvironment,
    );
    const refreshed = await assertInstalledSkillSuite(targetRoot);
    assert.deepEqual(
      refreshed,
      installed,
      "re-running the pinned install changed the installed suite shape",
    );
    await assertRetainedProjectLock(targetRoot);

    run(npx, buildSkillRemoveArguments(), targetRoot, commandEnvironment);
    await assertRemovedSkillDirectories(targetRoot);
    const retainedLockEntries = await assertRetainedProjectLock(targetRoot);

    assert.equal(gitOutput(["rev-parse", "HEAD"], localSource), sourceRevision);
    assert.equal(
      gitOutput(["status", "--porcelain=v1"], localSource),
      "",
      "the external installer modified its local source Git worktree",
    );

    return { ...installed, retainedLockEntries: retainedLockEntries.length };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await assert.rejects(
      stat(temporaryRoot),
      (error) => error?.code === "ENOENT",
      "temporary installer lifecycle root was not cleaned",
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await runSkillCliInstall();
    console.log(
      `Pinned Skill CLI lifecycle passed: ${summary.skills} project Skills, ${summary.profiles} advisory profiles, and ${summary.retainedLockEntries} documented retained lock entries after removal.`,
    );
  } catch (error) {
    console.error(`Pinned Skill CLI installation failed: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}
