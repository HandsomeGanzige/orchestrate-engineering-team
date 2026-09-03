#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverCases, loadRunner, runSuite } from "./core.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const USAGE = "Usage: pnpm eval -- [--list] [--case <id>] [--repeat <n>] [--runner <codex|module>] [--judge-runner <codex|module>] [--model <name>] [--judge-model <name>] [--json] [--keep-workspaces]";

export function parseArguments(args) {
  const options = { cases: [], repeat: 1, runner: "codex", judgeRunner: null, model: null, judgeModel: null, json: false, list: false, keepWorkspaces: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--json") options.json = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--keep-workspaces") options.keepWorkspaces = true;
    else if (["--case", "--runner", "--judge-runner", "--model", "--judge-model", "--repeat"].includes(argument)) {
      const value = args[++index];
      if (!value) return null;
      if (argument === "--case") options.cases.push(value);
      else if (argument === "--repeat") { options.repeat = Number(value); if (!Number.isInteger(options.repeat) || options.repeat < 1) return null; }
      else {
        const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        options[key] = value;
      }
    } else return null;
  }
  options.judgeRunner ??= options.runner;
  return options;
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (!options) { console.error(USAGE); return 2; }
  const allCases = await discoverCases(path.join(ROOT, "evals", "cases"));
  if (options.list) {
    for (const item of allCases) console.log(`${item.id}\t${item.title}`);
    return 0;
  }
  const unknown = options.cases.filter((id) => !allCases.some((item) => item.id === id));
  if (unknown.length) { console.error(`Unknown evaluation case(s): ${unknown.join(", ")}`); return 2; }
  const selected = options.cases.length ? allCases.filter((item) => options.cases.includes(item.id)) : allCases;
  if (!selected.length) { console.error("No evaluation cases found."); return 2; }
  const runner = await loadRunner(options.runner, ROOT);
  const judgeRunner = options.judgeRunner === options.runner ? runner : await loadRunner(options.judgeRunner, ROOT);
  const runsRoot = path.join(ROOT, "evals", ".runs", stamp());
  const result = await runSuite({ cases: selected, repeat: options.repeat, runner, judgeRunner, root: ROOT, runsRoot, skillRoot: path.join(ROOT, ".agents", "skills", "orchestrate-engineering-team"), model: options.model, judgeModel: options.judgeModel, keepWorkspaces: options.keepWorkspaces });
  if (options.json) console.log(JSON.stringify(result));
  else {
    console.log(`Skill behavior evaluation ${result.passed ? "passed" : "failed"}: ${result.cases.filter((item) => item.passed).length}/${result.cases.length} attempts passed.`);
    console.log(`Report: ${path.join(runsRoot, "report.md")}`);
  }
  return result.passed ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 2; }
}
