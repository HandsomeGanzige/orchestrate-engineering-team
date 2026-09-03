import assert from "node:assert/strict";
import test from "node:test";
import { ADAPTER_API_VERSION, genericPromptFallback, runAdapterConformance } from "../src/index.js";
const adapter = { apiVersion: ADAPTER_API_VERSION, id: "fake", async detect(){ return true; }, async validateBinding(){}, async resolve(){ return { adapter: "fake", agent: "dev", mode: "native", toolsPolicy: "allowlist", sandbox: "workspace-write", isolation: "worktree", limitations: [], grantedCapabilities: ["workspace-write"] }; }, async scaffold(){ return {}; }, async diagnose(plan){ return { effective: plan, limitations: [] }; } };
test("fake adapter conforms", async () => { const result = await runAdapterConformance(adapter, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } }, scaffold: {} }); assert.equal(result.plan.mode, "native"); });
test("adapter cannot expand canonical authority", async () => { await assert.rejects(runAdapterConformance({ ...adapter, async resolve(){ return { ...(await adapter.resolve()), grantedCapabilities: ["user-decision"] }; } }, { request: { contract: { capabilities: { prohibited: ["user-decision"] } } } }), /prohibited/); });
test("generic fallback carries the complete compact role guidance and actual limits", () => {
  const plan = genericPromptFallback({
    role: "architecture",
    contract: {
      purpose: "compare designs",
      route: "use for consequential decisions",
      authority: "write assigned documentation only",
      writeScope: "assigned-agent-work-files-and-project-documentation",
      independence: "independent",
      capabilities: { prohibited: ["production-code-write", "test-write"] },
      prompt: "Keep proposals distinct from established project rules.",
      returns: ["recommendation", "assigned-document-output"],
    },
    focusedTask: "inspect the module boundary",
    capabilities: {
      skills: [{ id: "systems", ref: "/skills/systems/SKILL.md", required: true, status: "resolved", source: "project" }],
      materials: [{ id: "adr", path: "docs/adr/0001.md", status: "resolved", source: "project" }],
    },
    limitations: ["workspace-write unavailable"],
  });
  assert.equal(plan.mode, "prompt-fallback");
  for (const expected of ["inspect the module boundary", "Write scope: assigned-agent-work-files-and-project-documentation", "production-code-write, test-write", "Keep proposals distinct", "/skills/systems/SKILL.md", "docs/adr/0001.md", "workspace-write unavailable", "toolsPolicy=unknown"]) assert.match(plan.prompt, new RegExp(expected));
  assert.deepEqual(plan.limitations, ["No native adapter verified effective capabilities", "workspace-write unavailable"]);
});
