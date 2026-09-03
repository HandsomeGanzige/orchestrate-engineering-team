import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADAPTER_API_VERSION, genericPromptFallback, runAdapterConformance } from "../src/index.js";
const fallbackFixture = JSON.parse(await readFile(new URL("../fixtures/prompt-fallback.json", import.meta.url), "utf8"));
const adapter = { apiVersion: ADAPTER_API_VERSION, id: "fake", async detect(){ return true; }, async validateBinding(){}, async resolve(){ return { adapter: "fake", agent: "dev", mode: "native", toolsPolicy: "allowlist", sandbox: "workspace-write", isolation: "worktree", limitations: [], grantedCapabilities: ["workspace-write"] }; }, async scaffold(){ return {}; }, async diagnose(plan){ return { effective: plan, limitations: [] }; } };
test("fake adapter conforms", async () => { const result = await runAdapterConformance(adapter, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } }, scaffold: {} }); assert.equal(result.plan.mode, "native"); });
test("adapter cannot expand canonical authority", async () => { await assert.rejects(runAdapterConformance({ ...adapter, async resolve(){ return { ...(await adapter.resolve()), grantedCapabilities: ["user-decision"] }; } }, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } } }), /prohibited/); });
test("generic fallback carries the complete compact role guidance and actual limits", () => {
  const plan = genericPromptFallback(fallbackFixture.request);
  assert.equal(plan.mode, fallbackFixture.expectedMode);
  for (const expected of fallbackFixture.expectedPromptIncludes) assert.ok(plan.prompt.includes(expected), `prompt missing '${expected}'`);
  assert.deepEqual(plan.limitations, fallbackFixture.expectedLimitations);
});
