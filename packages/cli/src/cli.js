import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parse, stringify } from "yaml";
import { API_VERSION, ROLE_IDS, configPaths, diagnoseCapabilities, loadConfigLayers, mergeConfigLayers, parseConfig, validateConfig, validateMaterialPath } from "@orchestrate-engineering-team/config";
import { validateAdapter } from "@orchestrate-engineering-team/adapter-contract";

const require = createRequire(import.meta.url);
const CONFIG_SCHEMA = require("@orchestrate-engineering-team/config/schema");
export const EXIT = Object.freeze({ OK: 0, INVALID: 2, REQUIRED_MISSING: 3, ADAPTER_UNAVAILABLE: 4, USAGE: 64 });
const EMPTY = { apiVersion: API_VERSION, roles: {} };
function option(args, name) { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; }
function flag(args, name) { return args.includes(name); }
function scopePath(scope, cwd = process.cwd()) {
  const paths = configPaths({ cwd });
  if (!paths[scope]) throw Object.assign(new Error("--scope must be user, project, or local"), { exitCode: EXIT.USAGE });
  return paths[scope];
}
async function exists(file) { try { await access(file); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function writeConfig(file, config, dryRun) {
  const next = stringify(config, { lineWidth: 0 });
  const previous = await readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  output.write(`--- ${file} (before)\n+++ ${file} (after)\n${previous ? previous.split("\n").map((line) => `- ${line}`).join("\n") : "(new file)"}\n${next.split("\n").map((line) => `+ ${line}`).join("\n")}\n`);
  if (!dryRun) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, next); }
}
async function maintainLocalIgnore(cwd, dryRun) {
  const file = path.join(cwd, ".gitignore");
  const marker = ".agents/orchestrate-engineering-team.local.yaml";
  const source = await readFile(file, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  if (!source.split(/\r?\n/).includes(marker)) {
    const next = `${source}${source && !source.endsWith("\n") ? "\n" : ""}${marker}\n`;
    output.write(`${dryRun ? "Would update" : "Updating"} ${file}: add ${marker}\n`);
    if (!dryRun) await writeFile(file, next);
  }
}
async function init(args) {
  const scope = option(args, "--scope");
  const file = scopePath(scope);
  if (await exists(file)) throw Object.assign(new Error(`${file} already exists`), { exitCode: EXIT.INVALID });
  await writeConfig(file, EMPTY, flag(args, "--dry-run"));
  if (scope === "local") await maintainLocalIgnore(process.cwd(), flag(args, "--dry-run"));
  return EXIT.OK;
}
async function show(args) {
  const role = option(args, "--role");
  if (role && !ROLE_IDS.includes(role)) throw Object.assign(new Error(`unknown role '${role}'`), { exitCode: EXIT.USAGE });
  const layers = await loadConfigLayers();
  let result = flag(args, "--effective") ? mergeConfigLayers(layers) : { layers: layers.map(({ source, path: file, config }) => ({ source, path: file, config })) };
  if (role && result.effective) result = { effective: result.effective.roles[role] ?? null, provenance: Object.fromEntries(Object.entries(result.provenance).filter(([key]) => key.startsWith(`${role}.`))) };
  output.write(flag(args, "--json") ? `${JSON.stringify(result, null, 2)}\n` : stringify(result, { lineWidth: 0 }));
  return EXIT.OK;
}
async function readInput(value) {
  if (!value) throw Object.assign(new Error("config apply requires --input <file-or-yaml>"), { exitCode: EXIT.USAGE });
  const source = await readFile(path.resolve(value), "utf8").catch((error) => error?.code === "ENOENT" ? value : Promise.reject(error));
  return parseConfig(source, value);
}
async function apply(args) {
  const scope = option(args, "--scope");
  const file = scopePath(scope);
  const config = await readInput(option(args, "--input"));
  const dryRun = flag(args, "--dry-run");
  if ((await exists(file)) && !dryRun && !flag(args, "--yes")) throw Object.assign(new Error(`refusing to overwrite ${file} without --yes after reviewing the diff (or use --dry-run)`), { exitCode: EXIT.USAGE });
  await writeConfig(file, config, dryRun);
  if (scope === "local") await maintainLocalIgnore(process.cwd(), dryRun);
  return EXIT.OK;
}
async function discoverSkills() {
  const found = new Map();
  for (const root of [path.join(process.cwd(), ".agents", "skills"), path.join(process.env.HOME ?? "", ".agents", "skills")]) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error))) if (entry.isDirectory() && await exists(path.join(root, entry.name, "SKILL.md"))) {
      const previous = found.get(entry.name);
      found.set(entry.name, previous ? { conflict: true, sources: [...(previous.sources ?? [previous.source]), root] } : { source: root });
    }
  }
  return found;
}
async function doctor(args) {
  const selectedRole = option(args, "--role");
  if (selectedRole && !ROLE_IDS.includes(selectedRole)) throw Object.assign(new Error(`unknown role '${selectedRole}'`), { exitCode: EXIT.USAGE });
  const { effective, provenance } = mergeConfigLayers(await loadConfigLayers());
  const available = await discoverSkills();
  const roles = {};
  let blocked = false;
  for (const roleId of selectedRole ? [selectedRole] : ROLE_IDS) {
    roles[roleId] = diagnoseCapabilities(effective.roles[roleId], available);
    roles[roleId].materials = [];
    for (const material of effective.roles[roleId]?.capabilities?.materials ?? []) {
      const source = provenance[`${roleId}.materials.${material.id}`] ?? "project";
      try {
        const resolvedPath = await validateMaterialPath(material, { layerSource: source === "user" ? "user" : "project" });
        roles[roleId].materials.push({ ...material, status: "resolved", resolvedPath, source });
      } catch (error) {
        roles[roleId].materials.push({ ...material, status: "missing", source, reason: error.message });
        roles[roleId].limitations.push({ id: material.id, required: material.required === true, reason: error.message });
        roles[roleId].blocked ||= material.required === true;
      }
    }
    blocked ||= roles[roleId].blocked;
  }
  let adapter;
  const adapterName = option(args, "--adapter");
  if (adapterName) {
    try { const module = await import(adapterName); adapter = validateAdapter(module.default ?? module.adapter ?? module); }
    catch (error) { output.write(`${flag(args, "--json") ? JSON.stringify({ roles, provenance, adapter: { status: "unavailable", requested: adapterName, reason: error.message } }, null, 2) : `Adapter unavailable: ${adapterName}: ${error.message}`}\n`); return EXIT.ADAPTER_UNAVAILABLE; }
  }
  const result = { roles, provenance, adapter: adapter ? { status: "available", id: adapter.id } : { status: "generic", mode: "prompt-fallback" } };
  output.write(flag(args, "--json") ? `${JSON.stringify(result, null, 2)}\n` : stringify(result, { lineWidth: 0 }));
  return blocked ? EXIT.REQUIRED_MISSING : EXIT.OK;
}
async function configure(args) {
  if (!input.isTTY || !output.isTTY) throw Object.assign(new Error("configure requires an interactive terminal; use config apply for automation"), { exitCode: EXIT.USAGE });
  const rl = createInterface({ input, output });
  try {
    const scope = option(args, "--scope") ?? await rl.question("Scope (user/project/local): ");
    const role = option(args, "--role") ?? await rl.question(`Role (${ROLE_IDS.join("/")}): `);
    scopePath(scope); if (!ROLE_IDS.includes(role)) throw Object.assign(new Error(`unknown role '${role}'`), { exitCode: EXIT.USAGE });
    const kind = await rl.question("Add capability (skill/material/native-agent): ");
    const current = await readFile(scopePath(scope), "utf8").then(parseConfig).catch((error) => error?.code === "ENOENT" ? structuredClone(EMPTY) : Promise.reject(error));
    current.roles[role] ??= {};
    if (kind === "native-agent") current.roles[role].hostBindings = { ...(current.roles[role].hostBindings ?? {}), preferred: await rl.question("Preferred native Agent name: ") };
    else {
      if (!new Set(["skill", "material"]).has(kind)) throw Object.assign(new Error("capability must be skill, material, or native-agent"), { exitCode: EXIT.USAGE });
      current.roles[role].capabilities ??= {};
      const key = `${kind}s`; current.roles[role].capabilities[key] ??= [];
      const id = await rl.question("Stable capability id: ");
      const locator = await rl.question(kind === "skill" ? "Installed Skill name/ref: " : "Material path: ");
      const required = /^y/i.test(await rl.question("Required? (y/N): "));
      current.roles[role].capabilities[key].push(kind === "skill" ? { id, ref: locator, required } : { id, path: locator, required });
    }
    validateConfig(current);
    await writeConfig(scopePath(scope), current, true);
    if (!/^y/i.test(await rl.question("Write this configuration? (y/N): "))) return EXIT.OK;
    await writeConfig(scopePath(scope), current, false);
    if (scope === "local") await maintainLocalIgnore(process.cwd(), false);
    return doctor(["--role", role]);
  } finally { rl.close(); }
}
async function schema(args) {
  output.write(flag(args, "--json") ? `${JSON.stringify(CONFIG_SCHEMA, null, 2)}\n` : stringify(CONFIG_SCHEMA, { lineWidth: 0 }));
  return EXIT.OK;
}
function usage() { output.write("Usage: oet init --scope user|project|local [--dry-run]\n       oet configure [--role ROLE] [--scope SCOPE]\n       oet config show [--effective] [--role ROLE] [--json]\n       oet config apply --scope SCOPE --input FILE_OR_YAML [--dry-run] [--yes]\n       oet doctor [--role ROLE] [--adapter PACKAGE] [--json]\n       oet schema [--json]\n"); }
export async function main(args) {
  try {
    const [command, subcommand] = args;
    if ([undefined, "help", "--help", "-h"].includes(command)) { usage(); return EXIT.OK; }
    if (command === "init") return init(args.slice(1));
    if (command === "configure") return configure(args.slice(1));
    if (command === "doctor") return doctor(args.slice(1));
    if (command === "schema") return schema(args.slice(1));
    if (command === "config" && subcommand === "show") return show(args.slice(2));
    if (command === "config" && subcommand === "apply") return apply(args.slice(2));
    usage(); return EXIT.USAGE;
  } catch (error) { console.error(error.message); return error.exitCode ?? (error.name === "ConfigError" ? EXIT.INVALID : EXIT.INVALID); }
}
