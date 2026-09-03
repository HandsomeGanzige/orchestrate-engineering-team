export type RoleId = "architecture" | "development" | "product-test" | "review";
export type LaunchPlan = { adapter: string; agent: string; mode: "native" | "prompt-fallback"; toolsPolicy: "allowlist" | "denylist" | "inherited" | "advisory" | "unknown"; sandbox: "read-only" | "workspace-write" | "inherited" | "unknown"; isolation: "worktree" | "sandbox" | "shared" | "unknown"; limitations: string[]; grantedCapabilities?: string[]; prompt?: string };
export interface Adapter { apiVersion: string; id: string; detect(context: object): boolean | Promise<boolean>; validateBinding(binding: unknown): unknown | Promise<unknown>; resolve(request: unknown): LaunchPlan | Promise<LaunchPlan>; scaffold?(options: unknown): unknown | Promise<unknown>; diagnose(plan: LaunchPlan): { limitations: string[] } | Promise<{ limitations: string[] }>; }
export type ResolvedCapability = { id: string; ref?: string; requested?: string; path?: string; required?: boolean; status?: string; source?: string | string[] };
export type GenericPromptFallbackInput = { role: RoleId; contract: { purpose: string; route?: string; authority: string; writeScope?: string; independence: string; capabilities?: { prohibited?: string[] }; restrictions?: string[]; prompt?: string; returns?: string[] }; focusedTask: string; capabilities?: { skills?: ResolvedCapability[]; materials?: ResolvedCapability[] }; limitations?: string[] };
export const ADAPTER_API_VERSION: string;
export const HOST_FACT_VALUES: Readonly<Record<string, readonly string[]>>;
export function validateAdapter(adapter: unknown): Adapter;
export function validateLaunchPlan(plan: unknown): LaunchPlan;
export function assertAuthorityNotExpanded(request: any, plan: LaunchPlan): void;
export function runAdapterConformance(adapter: Adapter, fixture: any): Promise<any>;
export function genericPromptFallback(input: GenericPromptFallbackInput): LaunchPlan;
