import { realpath, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseDocument } from "yaml";

export const API_VERSION = "orchestrate-engineering-team/v1";
export const ROLE_IDS = Object.freeze(["architecture", "development", "product-test", "review"]);
export const CONFIG_FILES = Object.freeze({
  user: path.join("~", ".agents", "orchestrate-engineering-team.yaml"),
  project: path.join(".agents", "orchestrate-engineering-team.yaml"),
  local: path.join(".agents", "orchestrate-engineering-team.local.yaml"),
});

export class ConfigError extends Error {
  constructor(message, { code = "CONFIG_INVALID", path: fieldPath } = {}) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.path = fieldPath;
  }
}

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
function exactKeys(value, allowed, field) {
  if (!object(value)) throw new ConfigError(`${field} must be a mapping`, { path: field });
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ConfigError(`${field} contains unknown field(s): ${unknown.join(", ")}`, { path: field });
}
function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new ConfigError(`${field} must be a non-empty string`, { path: field });
}
function boolean(value, field) {
  if (value !== undefined && typeof value !== "boolean") throw new ConfigError(`${field} must be a boolean`, { path: field });
}
function entries(value, kind, field) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new ConfigError(`${field} must be a sequence`, { path: field });
  const ids = new Set();
  value.forEach((entry, index) => {
    const at = `${field}[${index}]`;
    const allowed = kind === "skills" ? ["id", "ref", "required", "enabled"] : ["id", "path", "scope", "required", "enabled"];
    exactKeys(entry, allowed, at);
    text(entry.id, `${at}.id`);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(entry.id)) throw new ConfigError(`${at}.id is not a stable identifier`, { path: `${at}.id` });
    if (ids.has(entry.id)) throw new ConfigError(`${field} contains duplicate id '${entry.id}'`, { path: at });
    ids.add(entry.id);
    if (kind === "skills") text(entry.ref, `${at}.ref`);
    else {
      text(entry.path, `${at}.path`);
      if (entry.scope !== undefined && !["project", "user"].includes(entry.scope)) throw new ConfigError(`${at}.scope must be project or user`, { path: `${at}.scope` });
    }
    boolean(entry.required, `${at}.required`);
    boolean(entry.enabled, `${at}.enabled`);
  });
}

export function validateConfig(config) {
  exactKeys(config, ["apiVersion", "roles"], "config");
  if (config.apiVersion !== API_VERSION) throw new ConfigError(`apiVersion must equal '${API_VERSION}'`, { path: "apiVersion" });
  if (config.roles === undefined) return config;
  exactKeys(config.roles, ROLE_IDS, "roles");
  for (const [roleId, role] of Object.entries(config.roles)) {
    const field = `roles.${roleId}`;
    exactKeys(role, ["capabilities", "hostBindings"], field);
    if (role.capabilities !== undefined) {
      exactKeys(role.capabilities, ["skills", "materials"], `${field}.capabilities`);
      entries(role.capabilities.skills, "skills", `${field}.capabilities.skills`);
      entries(role.capabilities.materials, "materials", `${field}.capabilities.materials`);
    }
    if (role.hostBindings !== undefined) {
      exactKeys(role.hostBindings, ["preferred", "adapters"], `${field}.hostBindings`);
      if (role.hostBindings.preferred !== undefined) text(role.hostBindings.preferred, `${field}.hostBindings.preferred`);
      if (role.hostBindings.adapters !== undefined && !object(role.hostBindings.adapters)) throw new ConfigError(`${field}.hostBindings.adapters must be a mapping`, { path: `${field}.hostBindings.adapters` });
      assertSafeData(role.hostBindings.adapters, `${field}.hostBindings.adapters`);
    }
  }
  return config;
}

function assertSafeData(value, field, seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeData(item, `${field}[${index}]`, seen));
  if (!object(value) || seen.has(value)) throw new ConfigError(`${field} must contain only finite JSON/YAML data`, { path: field });
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new ConfigError(`${field} contains unsafe key '${key}'`, { path: field });
    assertSafeData(child, `${field}.${key}`, seen);
  }
  seen.delete(value);
}

export function parseConfig(source, label = "config") {
  const document = parseDocument(source, { strict: true, uniqueKeys: true, maxAliasCount: 20 });
  if (document.errors.length) throw new ConfigError(`${label}: ${document.errors[0].message}`, { code: "YAML_PARSE" });
  const config = document.toJS({ maxAliasCount: 20 });
  return validateConfig(config);
}

const clone = (value) => structuredClone(value);
function mergeEntries(current = [], additions = [], source, provenance, roleId, kind) {
  const map = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of additions) {
    if (entry.enabled === false) map.delete(entry.id);
    else map.set(entry.id, clone(entry));
    provenance[`${roleId}.${kind}.${entry.id}`] = source;
  }
  return [...map.values()];
}

export function mergeConfigLayers(layers) {
  const effective = { apiVersion: API_VERSION, roles: {} };
  const provenance = {};
  for (const layer of layers.filter(Boolean)) {
    validateConfig(layer.config);
    for (const [roleId, incoming] of Object.entries(layer.config.roles ?? {})) {
      const role = effective.roles[roleId] ?? { capabilities: { skills: [], materials: [] }, hostBindings: { adapters: {} } };
      const capability = incoming.capabilities ?? {};
      role.capabilities.skills = mergeEntries(role.capabilities.skills, capability.skills, layer.source, provenance, roleId, "skills");
      role.capabilities.materials = mergeEntries(role.capabilities.materials, capability.materials, layer.source, provenance, roleId, "materials");
      if (incoming.hostBindings?.preferred !== undefined) {
        role.hostBindings.preferred = incoming.hostBindings.preferred;
        provenance[`${roleId}.hostBindings.preferred`] = layer.source;
      }
      for (const [adapter, binding] of Object.entries(incoming.hostBindings?.adapters ?? {})) {
        role.hostBindings.adapters[adapter] = clone(binding);
        provenance[`${roleId}.hostBindings.adapters.${adapter}`] = layer.source;
      }
      effective.roles[roleId] = role;
    }
  }
  return { effective, provenance };
}

export function configPaths({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return {
    user: path.join(home, ".agents", "orchestrate-engineering-team.yaml"),
    project: path.join(cwd, ".agents", "orchestrate-engineering-team.yaml"),
    local: path.join(cwd, ".agents", "orchestrate-engineering-team.local.yaml"),
  };
}

export async function loadConfigLayers(options = {}) {
  const paths = configPaths(options);
  const layers = [];
  for (const source of ["user", "project", "local"]) {
    try { layers.push({ source, path: paths[source], config: parseConfig(await readFile(paths[source], "utf8"), paths[source]) }); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return layers;
}

export async function validateMaterialPath(entry, { projectRoot = process.cwd(), userRoot = os.homedir(), layerSource = "project" } = {}) {
  const scope = entry.scope ?? "project";
  if (scope === "user" && layerSource !== "user") throw new ConfigError(`material '${entry.id}' may use scope:user only in user configuration`, { code: "MATERIAL_SCOPE" });
  const root = path.resolve(scope === "user" ? userRoot : projectRoot);
  if (path.isAbsolute(entry.path)) throw new ConfigError(`material '${entry.id}' path must be relative`, { code: "MATERIAL_PATH" });
  const candidate = path.resolve(root, entry.path);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new ConfigError(`material '${entry.id}' escapes its ${scope} root`, { code: "MATERIAL_PATH" });
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) throw new ConfigError(`material '${entry.id}' resolves outside its ${scope} root`, { code: "MATERIAL_PATH" });
  const info = await stat(realCandidate);
  if (!info.isFile()) throw new ConfigError(`material '${entry.id}' is not a file`, { code: "MATERIAL_PATH" });
  return realCandidate;
}

export function diagnoseCapabilities(role, availableSkills = new Map()) {
  const limitations = [];
  const skills = (role?.capabilities?.skills ?? []).map((entry) => {
    const found = availableSkills.get(entry.ref);
    const status = found?.conflict ? "conflict" : found ? "resolved" : "missing";
    if (status !== "resolved") limitations.push({ id: entry.id, required: entry.required === true, reason: status === "conflict" ? `Skill '${entry.ref}' has conflicting sources` : `Skill '${entry.ref}' is unavailable` });
    return { ...entry, requested: entry.ref, status, source: found?.sources ?? found?.source ?? "unknown" };
  });
  return { skills, limitations, blocked: limitations.some((item) => item.required) };
}
