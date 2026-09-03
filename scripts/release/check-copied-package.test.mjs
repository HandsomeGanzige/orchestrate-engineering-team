import assert from "node:assert/strict";
import test from "node:test";
import { checkCopiedPackage } from "./check-copied-package.mjs";
test("copied package contains one Skill, four Main resources, and three packages", async () => { assert.deepEqual(await checkCopiedPackage(), { skills: 1, roles: 4, mainResources: 4, packages: 3 }); });
