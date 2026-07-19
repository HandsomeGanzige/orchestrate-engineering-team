import assert from "node:assert/strict";
import test from "node:test";
import { checkCopiedPackage } from "./check-copied-package.mjs";

test("the copied release package preserves the Skill suite and optional Plugin adapter", async () => {
  assert.deepEqual(await checkCopiedPackage(), {
    plugin: "orchestrate-engineering-team",
    version: "0.1.0",
    skills: 5,
    profiles: 4,
  });
});
