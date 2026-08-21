import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillInstallArguments, buildSkillRemoveArguments, runSkillCliInstall } from "./skill-cli-install.mjs";
test("installer explicitly selects only Main", () => { assert.ok(buildSkillInstallArguments("source").includes("orchestrate-engineering-team")); assert.equal(buildSkillRemoveArguments().filter((value) => value === "orchestrate-engineering-team").length, 1); });
test("installed fixture has one public Skill", async () => { assert.deepEqual(await runSkillCliInstall(), { skills: 1, roles: 4 }); });
