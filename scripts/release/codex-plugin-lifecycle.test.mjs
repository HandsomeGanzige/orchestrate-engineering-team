import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  assertDiscoveredPluginSkills,
  assertDisposableCiRunner,
} from "./codex-plugin-lifecycle.mjs";

test("plugin lifecycle refuses to run outside a disposable GitHub Actions runner", () => {
  assert.throws(
    () => assertDisposableCiRunner({}),
    /restricted to a disposable GitHub Actions runner/,
  );
  assert.throws(
    () =>
      assertDisposableCiRunner({
        CI: "true",
        GITHUB_ACTIONS: "false",
        RUNNER_TEMP: "/tmp/runner",
      }),
    /restricted to a disposable GitHub Actions runner/,
  );
});

test("plugin lifecycle requires exactly five enabled Skills from the installed cache", () => {
  const codexHome = path.resolve("/tmp/codex-home");
  const names = [
    "architect-work-item",
    "develop-work-item",
    "orchestrate-engineering-team",
    "review-work-item",
    "verify-work-item",
  ];
  const response = {
    data: [
      {
        cwd: "/tmp/workspace",
        errors: [],
        skills: names.map((name) => ({
          name: `orchestrate-engineering-team:${name}`,
          enabled: true,
          path: path.join(codexHome, "plugins", "cache", "marketplace", "plugin", name, "SKILL.md"),
        })),
      },
    ],
  };

  assert.doesNotThrow(() => assertDiscoveredPluginSkills(response, codexHome));
  response.data[0].skills.pop();
  assert.throws(
    () => assertDiscoveredPluginSkills(response, codexHome),
    /did not discover exactly the five installed Plugin Skills/,
  );
});
