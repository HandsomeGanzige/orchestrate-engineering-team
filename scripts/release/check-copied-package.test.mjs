import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCopiedPackage } from "./check-copied-package.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("the copied release package preserves the Skill suite and optional Plugin adapter", async () => {
  assert.deepEqual(await checkCopiedPackage(), {
    plugin: "orchestrate-engineering-team",
    version: "0.3.0",
    skills: 5,
    profiles: 4,
  });
});

test("the copied release rejects a third-party workflow runtime import", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "orchestrate-release-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(PROJECT_ROOT, root, {
    recursive: true,
    /**
     * Excludes local state, Git metadata, and dependencies from the corrupted package fixture.
     *
     * @param {string} source - Current source path visited by `fs.cp`.
     * @returns {boolean} Whether the path should be copied into the fixture.
     */
    filter(source) {
      return ![".agent-work", ".git", "node_modules"].includes(
        path.relative(PROJECT_ROOT, source).split(path.sep)[0],
      );
    },
  });
  const workflowPath = path.join(
    root,
    ".agents/skills/orchestrate-engineering-team/scripts/workflow.mjs",
  );
  const workflow = await readFile(workflowPath, "utf8");
  await writeFile(workflowPath, `import "yaml";\n${workflow}`);

  await assert.rejects(
    checkCopiedPackage(root),
    /must not import third-party runtime module 'yaml'/,
  );
});
