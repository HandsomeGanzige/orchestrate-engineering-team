import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isAlias, isMap, isSeq, parseDocument } from "yaml";

export const ROLE_IDS = Object.freeze(["architecture", "development", "product-test", "review"]);
const MAIN = ".agents/skills/orchestrate-engineering-team";
const REQUIRED = Object.freeze(["SKILL.md", "agents/openai.yaml", "assets/role-task-packet.md", "references/role-contracts.yaml", "references/config.schema.json"]);
const OLD_SKILLS = Object.freeze(["architect-work-item", "develop-work-item", "test-product-work-item", "review-work-item", "verify-work-item"]);
function firstAlias(node) { if (!node) return null; if (isAlias(node)) return node; if (isMap(node)) for (const pair of node.items) { const found = firstAlias(pair.value); if (found) return found; } if (isSeq(node)) for (const item of node.items) { const found = firstAlias(item); if (found) return found; } return null; }
function safe(value, seen = new Set()) { if (value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value))) return value; if (!value || typeof value !== "object" || seen.has(value)) throw new Error("YAML must contain only non-recursive JSON values"); seen.add(value); if (Array.isArray(value)) return value.map((item) => safe(item, new Set(seen))); const result = Object.create(null); for (const [key, child] of value instanceof Map ? value : Object.entries(value)) { if (typeof key !== "string") throw new Error("YAML mapping keys must be strings"); result[key] = safe(child, new Set(seen)); } return result; }
export function parseStrictYaml(source) { const document = parseDocument(source, { strict: true, uniqueKeys: true, maxAliasCount: 20 }); if (document.errors.length) throw document.errors[0]; if (!document.contents) throw new Error("empty YAML document"); if (firstAlias(document.contents)) throw new Error("YAML aliases are not supported"); return { value: safe(document.toJS({ mapAsMap: true, maxAliasCount: 20 })), locations: new Map() }; }
const diag = (file, code, reason) => ({ file, line: 1, column: 1, code, reason });
export const formatDiagnostic = (item) => `${item.file}:${item.line}:${item.column} [${item.code}] ${item.reason}`;
async function exists(file) { try { await access(file); return true; } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error?.code)) return false; throw error; } }
async function files(root, relative = "") { const result = []; for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) { const child = path.join(relative, entry.name); if (entry.isDirectory()) result.push(...await files(root, child)); else result.push(child.split(path.sep).join("/")); } return result.sort(); }
function array(value) { return Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && item); }
export async function checkAgentProfiles(root) {
  const diagnostics = [];
  for (const old of OLD_SKILLS) if (await exists(path.join(root, ".agents/skills", old))) diagnostics.push(diag(`.agents/skills/${old}`, "OLD_PUBLIC_SKILL", "role Skills must not be published"));
  const skillRoot = path.join(root, ".agents/skills");
  if (await exists(skillRoot)) { const directories = (await readdir(skillRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); if (directories.length !== 1 || directories[0] !== "orchestrate-engineering-team") diagnostics.push(diag(".agents/skills", "PUBLIC_SKILL_SET", "must contain exactly the Main Skill")); }
  for (const file of REQUIRED) if (!await exists(path.join(root, MAIN, file))) diagnostics.push(diag(`${MAIN}/${file}`, "FILE_MISSING", "required file does not exist"));
  if (diagnostics.length) return { ok: false, diagnostics, summary: { skills: 1, roles: 4, mainResources: 3 } };
  const allowed = new Set(REQUIRED);
  for (const file of await files(path.join(root, MAIN))) if (!allowed.has(file)) diagnostics.push(diag(`${MAIN}/${file}`, "EXTRA_MAIN_RESOURCE", "undocumented Main Skill resource"));
  const skill = await readFile(path.join(root, MAIN, "SKILL.md"), "utf8");
  for (const [pattern, code] of [[/only public Skill/i,"SINGLE_MAIN"],[/host's native subagent|native subagent/i,"NATIVE_DISPATCH"],[/prompt fallback/i,"FALLBACK"],[/Required capability missing/i,"REQUIRED_CAPABILITY"],[/Do not create workflow state/i,"NO_STATE"],[/not mandatory phases/i,"OPTIONAL_ROLES"],[/configure the team/i,"CONFIGURE"]]) if (!pattern.test(skill)) diagnostics.push(diag(`${MAIN}/SKILL.md`, code, `missing required Main behavior: ${code}`));
  const contractFile = `${MAIN}/references/role-contracts.yaml`;
  try {
    const contract = parseStrictYaml(await readFile(path.join(root, contractFile), "utf8")).value;
    if (contract.apiVersion !== "orchestrate-engineering-team/roles-v1") diagnostics.push(diag(contractFile, "ROLE_VERSION", "invalid role contract API version"));
    if (JSON.stringify(Object.keys(contract.roles ?? {}).sort()) !== JSON.stringify([...ROLE_IDS].sort())) diagnostics.push(diag(contractFile, "ROLE_SET", "must contain exactly four stable roles"));
    for (const roleId of ROLE_IDS) { const role = contract.roles?.[roleId]; for (const field of ["purpose","route","authority","independence","writeScope","capabilities","context","returns","prompt"]) if (role?.[field] === undefined) diagnostics.push(diag(contractFile, "ROLE_FIELD", `${roleId} missing ${field}`)); if (!array(role?.context) || !array(role?.returns) || !array(role?.capabilities?.required) || !array(role?.capabilities?.prohibited)) diagnostics.push(diag(contractFile, "ROLE_STRUCTURE", `${roleId} has invalid contract arrays`)); }
    for (const roleId of ["product-test", "review"]) { const role = contract.roles?.[roleId]; if (!/independent/i.test(role?.independence ?? "") || !(role?.capabilities?.prohibited ?? []).includes("production-write")) diagnostics.push(diag(contractFile, "INDEPENDENCE", `${roleId} independence and write prohibition are immutable`)); }
  } catch (error) { diagnostics.push(diag(contractFile, "YAML_PARSE", error.message)); }
  try { const schema = JSON.parse(await readFile(path.join(root, MAIN, "references/config.schema.json"), "utf8")); if (schema.properties?.apiVersion?.const !== "orchestrate-engineering-team/v1") throw new Error("invalid config apiVersion"); } catch (error) { diagnostics.push(diag(`${MAIN}/references/config.schema.json`, "SCHEMA", error.message)); }
  diagnostics.sort((a,b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
  return { ok: diagnostics.length === 0, diagnostics, summary: { skills: 1, roles: 4, mainResources: 3 } };
}
