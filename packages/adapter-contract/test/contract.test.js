import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADAPTER_API_VERSION, genericPromptFallback, runAdapterConformance, validateLaunchPlan } from "../src/index.js";
const fallbackFixture = JSON.parse(await readFile(new URL("../fixtures/prompt-fallback.json", import.meta.url), "utf8"));
const adapter = { apiVersion: ADAPTER_API_VERSION, id: "fake", async detect(){ return true; }, async validateBinding(){}, async resolve(){ return { adapter: "fake", agent: "dev", mode: "native", toolsPolicy: "allowlist", sandbox: "workspace-write", isolation: "worktree", limitations: [], grantedCapabilities: ["workspace-write"] }; }, async scaffold(){ return {}; }, async diagnose(plan){ return { effective: plan, limitations: [] }; } };
test("fake adapter conforms and omitted continuity facts normalize to unknown", async () => {
  const result = await runAdapterConformance(adapter, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } }, scaffold: {} });
  assert.equal(result.plan.mode, "native");
  assert.deepEqual(
    { resultDelivery: result.plan.resultDelivery, dependencyBarrier: result.plan.dependencyBarrier, supervisorContinuation: result.plan.supervisorContinuation },
    { resultDelivery: "unknown", dependencyBarrier: "unknown", supervisorContinuation: "unknown" },
  );
});
test("LaunchPlan accepts every supported continuity fact", () => {
  const base = { adapter: "fake", agent: "dev", mode: "native", toolsPolicy: "allowlist", sandbox: "workspace-write", isolation: "worktree", limitations: [] };
  for (const resultDelivery of ["terminal-result", "receipt-notification", "text-only", "unknown"])
    for (const dependencyBarrier of ["terminal-only", "nonterminal-possible", "unknown"])
      for (const supervisorContinuation of ["automatic", "parent-managed", "unsupported", "unknown"])
        assert.deepEqual(validateLaunchPlan({ ...base, resultDelivery, dependencyBarrier, supervisorContinuation }), { ...base, resultDelivery, dependencyBarrier, supervisorContinuation });
});
test("LaunchPlan rejects unsupported continuity facts", () => {
  const base = { adapter: "fake", agent: "dev", mode: "native", toolsPolicy: "allowlist", sandbox: "workspace-write", isolation: "worktree", limitations: [] };
  for (const field of ["resultDelivery", "dependencyBarrier", "supervisorContinuation"])
    for (const value of ["optimistic", null])
      assert.throws(() => validateLaunchPlan({ ...base, [field]: value }), new RegExp(`LaunchPlan\\.${field} has unsupported value`));
});
test("adapter cannot expand canonical authority", async () => { await assert.rejects(runAdapterConformance({ ...adapter, async resolve(){ return { ...(await adapter.resolve()), grantedCapabilities: ["user-decision"] }; } }, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } } }), /prohibited/); });
test("generic fallback carries the complete compact role guidance and actual limits", () => {
  const plan = genericPromptFallback(fallbackFixture.request);
  assert.equal(plan.mode, fallbackFixture.expectedMode);
  assert.deepEqual(
    { resultDelivery: plan.resultDelivery, dependencyBarrier: plan.dependencyBarrier, supervisorContinuation: plan.supervisorContinuation },
    { resultDelivery: "unknown", dependencyBarrier: "unknown", supervisorContinuation: "unknown" },
  );
  for (const expected of fallbackFixture.expectedPromptIncludes) assert.ok(plan.prompt.includes(expected), `prompt missing '${expected}'`);
  assert.deepEqual(plan.limitations, fallbackFixture.expectedLimitations);
});
