export const ADAPTER_API_VERSION = "orchestrate-engineering-team/adapter-v1";
export const HOST_FACT_VALUES = Object.freeze({
  mode: ["native", "prompt-fallback"],
  toolsPolicy: ["allowlist", "denylist", "inherited", "advisory", "unknown"],
  sandbox: ["read-only", "workspace-write", "inherited", "unknown"],
  isolation: ["worktree", "sandbox", "shared", "unknown"],
});

function callable(value, name) {
  if (typeof value?.[name] !== "function") throw new TypeError(`adapter.${name} must be a function`);
}
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("adapter must be an object");
  if (adapter.apiVersion !== ADAPTER_API_VERSION) throw new TypeError(`adapter.apiVersion must equal '${ADAPTER_API_VERSION}'`);
  if (typeof adapter.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(adapter.id)) throw new TypeError("adapter.id must be a stable identifier");
  for (const method of ["detect", "validateBinding", "resolve", "diagnose"]) callable(adapter, method);
  if (adapter.scaffold !== undefined) callable(adapter, "scaffold");
  return adapter;
}

export function validateLaunchPlan(plan) {
  if (!plan || typeof plan !== "object") throw new TypeError("LaunchPlan must be an object");
  for (const field of ["adapter", "agent", "mode", "toolsPolicy", "sandbox", "isolation"]) if (typeof plan[field] !== "string") throw new TypeError(`LaunchPlan.${field} must be a string`);
  for (const [field, values] of Object.entries(HOST_FACT_VALUES)) if (!values.includes(plan[field])) throw new TypeError(`LaunchPlan.${field} has unsupported value '${plan[field]}'`);
  if (!Array.isArray(plan.limitations) || plan.limitations.some((item) => typeof item !== "string")) throw new TypeError("LaunchPlan.limitations must be an array of strings");
  return plan;
}

export function assertAuthorityNotExpanded(request, plan) {
  const prohibited = new Set(request.contract?.capabilities?.prohibited ?? request.contract?.restrictions ?? []);
  const granted = new Set(plan.grantedCapabilities ?? []);
  const overlap = [...prohibited].filter((item) => granted.has(item));
  if (overlap.length) throw new Error(`adapter attempted to grant prohibited capability: ${overlap.join(", ")}`);
}

export async function runAdapterConformance(adapter, fixture) {
  validateAdapter(adapter);
  const detected = await adapter.detect(fixture.context ?? {});
  if (typeof detected !== "boolean") throw new TypeError("adapter.detect must return a boolean");
  await adapter.validateBinding(fixture.binding ?? {});
  const plan = validateLaunchPlan(await adapter.resolve(fixture.request));
  assertAuthorityNotExpanded(fixture.request, plan);
  const diagnosis = await adapter.diagnose(plan);
  if (!diagnosis || typeof diagnosis !== "object" || !Array.isArray(diagnosis.limitations)) throw new TypeError("adapter.diagnose must return an object with limitations");
  if (fixture.scaffold && adapter.scaffold) await adapter.scaffold(fixture.scaffold);
  return { detected, plan, diagnosis };
}

export function genericPromptFallback({ role, contract, focusedTask, capabilities = { skills: [], materials: [] }, limitations = [] }) {
  const skillRefs = (capabilities.skills ?? []).map((item) => `${item.id}: ${item.ref ?? item.requested}`).join(", ") || "none";
  const materials = (capabilities.materials ?? []).map((item) => `${item.id}: ${item.path}`).join(", ") || "none";
  return {
    adapter: "generic",
    agent: "unknown",
    mode: "prompt-fallback",
    toolsPolicy: "unknown",
    sandbox: "unknown",
    isolation: "unknown",
    limitations: ["No native adapter verified effective capabilities", ...limitations],
    prompt: [`Role: ${role}`, `Purpose: ${contract.purpose}`, `Authority: ${contract.authority}`, `Independence: ${contract.independence}`, `Focused task: ${focusedTask}`, `Requested Skills: ${skillRefs}`, `Materials: ${materials}`, `Return: ${(contract.returns ?? []).join(", ")}`].join("\n"),
  };
}
