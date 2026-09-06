export const ADAPTER_API_VERSION = "orchestrate-engineering-team/adapter-v1";
export const HOST_FACT_VALUES = Object.freeze({
  mode: ["native", "prompt-fallback"],
  toolsPolicy: ["allowlist", "denylist", "inherited", "advisory", "unknown"],
  sandbox: ["read-only", "workspace-write", "inherited", "unknown"],
  isolation: ["worktree", "sandbox", "shared", "unknown"],
  resultDelivery: ["terminal-result", "receipt-notification", "text-only", "unknown"],
  dependencyBarrier: ["terminal-only", "nonterminal-possible", "unknown"],
  supervisorContinuation: ["automatic", "parent-managed", "unsupported", "unknown"],
});

const OPTIONAL_HOST_FACTS = Object.freeze(["resultDelivery", "dependencyBarrier", "supervisorContinuation"]);

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
  const normalized = { ...plan };
  for (const field of OPTIONAL_HOST_FACTS) if (normalized[field] === undefined) normalized[field] = "unknown";
  for (const [field, values] of Object.entries(HOST_FACT_VALUES)) if (!values.includes(normalized[field])) throw new TypeError(`LaunchPlan.${field} has unsupported value '${normalized[field]}'`);
  if (!Array.isArray(normalized.limitations) || normalized.limitations.some((item) => typeof item !== "string")) throw new TypeError("LaunchPlan.limitations must be an array of strings");
  return normalized;
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

function describeCapability(item, locator) {
  const source = Array.isArray(item.source) ? item.source.join("+") : item.source;
  return `${item.id}: ${locator} [${item.required === true ? "required" : "optional"}; status=${item.status ?? "unknown"}; source=${source ?? "unknown"}]`;
}

export function genericPromptFallback({ role, contract, focusedTask, capabilities = { skills: [], materials: [] }, limitations = [] }) {
  const skillRefs = (capabilities.skills ?? []).map((item) => describeCapability(item, item.ref ?? item.requested)).join(", ") || "none";
  const materials = (capabilities.materials ?? []).map((item) => describeCapability(item, item.path)).join(", ") || "none";
  const effectiveLimitations = [
    "No native adapter verified effective capabilities",
    "Result delivery semantics unknown",
    "Dependency barrier semantics unknown",
    "Supervisor continuation semantics unknown",
    ...limitations,
  ];
  return {
    adapter: "generic",
    agent: "unknown",
    mode: "prompt-fallback",
    toolsPolicy: "unknown",
    sandbox: "unknown",
    isolation: "unknown",
    resultDelivery: "unknown",
    dependencyBarrier: "unknown",
    supervisorContinuation: "unknown",
    limitations: effectiveLimitations,
    prompt: [
      `Role: ${role}`,
      `Purpose: ${contract.purpose}`,
      `Routing guidance: ${contract.route ?? "none"}`,
      `Authority: ${contract.authority}`,
      `Write scope: ${contract.writeScope ?? "unspecified"}`,
      `Independence: ${contract.independence}`,
      `Prohibited capabilities: ${(contract.capabilities?.prohibited ?? contract.restrictions ?? []).join(", ") || "none"}`,
      `Professional guidance: ${contract.prompt ?? "none"}`,
      `Focused task: ${focusedTask}`,
      `Requested Skills: ${skillRefs}`,
      `Materials: ${materials}`,
      "Effective host boundaries: toolsPolicy=unknown; sandbox=unknown; isolation=unknown",
      "Effective host continuity: resultDelivery=unknown; dependencyBarrier=unknown; supervisorContinuation=unknown",
      `Limitations: ${effectiveLimitations.join("; ")}`,
      `Return: ${(contract.returns ?? []).join(", ")}`,
    ].join("\n"),
  };
}
