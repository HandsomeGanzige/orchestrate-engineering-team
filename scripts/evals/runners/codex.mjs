import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_CAPTURE = 20_000_000;

function appendLimited(current, chunk) {
  const next = current + chunk;
  return next.length <= MAX_CAPTURE ? next : next.slice(next.length - MAX_CAPTURE);
}

function runProcess(command, args, { cwd, environment, input, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = appendLimited(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = appendLimited(stderr, chunk.toString()); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, signal, stdout, stderr, timedOut });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function parseJsonLines(source) {
  const events = [];
  const parseErrors = [];
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try { events.push(JSON.parse(line)); }
    catch (error) { parseErrors.push(`line ${index + 1}: ${error.message}`); }
  }
  return { events, parseErrors };
}

function finalMessage(events) {
  let result = "";
  for (const event of events) {
    const item = event?.item;
    if (event?.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") result = item.text;
  }
  return result;
}

function usage(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === "turn.completed" && events[index].usage) return events[index].usage;
  }
  return null;
}

function regexpEscape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function discoverPromptSkillPaths(source, skillName) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { return []; }
  const texts = [];
  const visit = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(parsed);
  const roots = new Map();
  for (const text of texts) {
    for (const match of text.matchAll(/^- `([^`]+)` = `([^`]+)`$/gm)) roots.set(match[1], match[2]);
  }
  const references = [];
  const pattern = new RegExp(`^- ${regexpEscape(skillName)}: .*?\\(file: ([^)]+)\\)$`, "gm");
  for (const text of texts) for (const match of text.matchAll(pattern)) references.push(match[1]);
  return references.map((reference) => {
    const [prefix, ...rest] = reference.split("/");
    return roots.has(prefix) ? path.join(roots.get(prefix), ...rest) : path.resolve(reference);
  });
}

export function createCodexRunner({ executable = process.env.OET_CODEX_BIN ?? "codex" } = {}) {
  return {
    id: "codex",
    async preflight({ workspace, skillPath, environment = process.env, timeoutMs = 30_000 }) {
      await access(skillPath);
      const versionResult = await runProcess(executable, ["--version"], { cwd: workspace, environment, timeoutMs });
      if (versionResult.exitCode !== 0) throw new Error(`codex --version failed: ${versionResult.stderr.trim()}`);
      const featureResult = await runProcess(executable, ["features", "list"], { cwd: workspace, environment, timeoutMs });
      if (featureResult.exitCode !== 0) throw new Error(`codex features list failed: ${featureResult.stderr.trim()}`);
      const promptResult = await runProcess(executable, ["debug", "prompt-input", "Use $orchestrate-engineering-team."], { cwd: workspace, environment, timeoutMs });
      if (promptResult.exitCode !== 0) throw new Error(`codex debug prompt-input failed: ${promptResult.stderr.trim()}`);
      const normalizedSkillPath = path.resolve(skillPath);
      const resolvedSkillPath = await realpath(skillPath);
      const discoveredSkillPaths = discoverPromptSkillPaths(promptResult.stdout, "orchestrate-engineering-team");
      const discoveredRealPaths = await Promise.all(discoveredSkillPaths.map(async (file) => { try { return await realpath(file); } catch { return path.resolve(file); } }));
      if (!discoveredRealPaths.includes(resolvedSkillPath)) throw new Error(`repository Skill was not visible in Codex prompt input: ${normalizedSkillPath}`);
      return {
        runner: "codex",
        version: versionResult.stdout.trim() || versionResult.stderr.trim(),
        capabilities: {
          jsonEvents: true,
          structuredOutput: true,
          multiAgent: /^multi_agent\s+.*\btrue$/m.test(featureResult.stdout) || /^multi_agent_v2\s+.*\btrue$/m.test(featureResult.stdout),
        },
        skillPaths: discoveredSkillPaths,
      };
    },
    async run({ kind, cwd, prompt, sandbox = "workspace-write", model, outputSchema, timeoutMs = 600_000, environment = process.env }) {
      const args = ["exec", "--json", "--ephemeral", "--sandbox", sandbox, "-C", cwd];
      if (model) args.push("--model", model);
      if (outputSchema) args.push("--output-schema", outputSchema);
      args.push("-");
      const startedAt = new Date().toISOString();
      const result = await runProcess(executable, args, { cwd, environment, input: prompt, timeoutMs });
      const parsed = parseJsonLines(result.stdout);
      return {
        kind,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        signal: result.signal,
        events: parsed.events,
        parseErrors: parsed.parseErrors,
        finalMessage: finalMessage(parsed.events),
        usage: usage(parsed.events),
        error: result.exitCode === 0 ? null : result.stderr.slice(-4_000),
        metadata: { startedAt, finishedAt: new Date().toISOString(), requestedModel: model ?? null },
      };
    },
  };
}

export default createCodexRunner();
