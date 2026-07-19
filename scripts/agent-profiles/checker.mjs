import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isAlias,
  isMap,
  isSeq,
  LineCounter,
  parseDocument,
} from "yaml";

const ROLE_PROFILES = Object.freeze({
  development: {
    name: "Development Agent",
    skill: "develop-work-item",
  },
  test: {
    name: "Test Agent",
    skill: "verify-work-item",
  },
  review: {
    name: "Review Agent",
    skill: "review-work-item",
  },
  architecture: {
    name: "Architecture Agent",
    skill: "architect-work-item",
  },
});

const SKILL_NAMES = Object.freeze([
  "orchestrate-engineering-team",
  ...Object.values(ROLE_PROFILES).map(({ skill }) => skill),
]);

export const STANDARD_RETURN = Object.freeze([
  "status",
  "result",
  "role-evidence",
  "evidence-or-involved-files",
  "unavailable-capabilities",
  "discovered-problems",
  "unresolved-matters",
  "suggested-next-action",
]);

const REGISTRY_PATH =
  ".agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml";
const TASK_PACKET_PATH =
  ".agents/skills/orchestrate-engineering-team/assets/subagent-task-packet.md";
const SKILL_FRONTMATTER_FIELDS = Object.freeze([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

class YamlSyntaxError extends Error {
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

const MAX_YAML_ALIAS_COUNT = 50;

function location(line, column = 1) {
  return { line, column };
}

function locationKey(parts) {
  return parts.join(".");
}

function located(lineCounter, offset, lineOffset) {
  const at = lineCounter.linePos(Math.max(0, offset ?? 0));
  return location(at.line + lineOffset, at.col);
}

function recordYamlLocations(node, parts, locations, lineCounter, lineOffset) {
  if (!node) return;
  if (node.range) {
    locations.set(
      locationKey(parts),
      located(lineCounter, node.range[0], lineOffset),
    );
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = pair.key?.value;
      if (typeof key !== "string") continue;
      const childParts = [...parts, key];
      const keyOffset = pair.key?.range?.[0] ?? pair.value?.range?.[0] ?? 0;
      locations.set(
        locationKey(childParts),
        located(lineCounter, keyOffset, lineOffset),
      );
      recordYamlLocations(pair.value, childParts, locations, lineCounter, lineOffset);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) =>
      recordYamlLocations(
        item,
        [...parts, String(index)],
        locations,
        lineCounter,
        lineOffset,
      ),
    );
  }
}

function toSafeYamlValue(value, ancestors = new Set()) {
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) {
    throw new Error("recursive YAML aliases are not supported");
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => toSafeYamlValue(item, nextAncestors));
  }
  if (value instanceof Map) {
    const result = Object.create(null);
    for (const [key, child] of value) {
      if (typeof key !== "string") {
        throw new Error("YAML mapping keys must be strings");
      }
      result[key] = toSafeYamlValue(child, nextAncestors);
    }
    return result;
  }
  throw new Error(`unsupported YAML value type '${value.constructor?.name ?? "object"}'`);
}

/**
 * Parse standards-valid YAML, then convert every mapping to a null-prototype
 * object before applying the project's exact schemas.
 */
export function parseStrictYaml(source, { lineOffset = 0 } = {}) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    const error = document.errors[0];
    const at = located(lineCounter, error.pos?.[0], lineOffset);
    throw new YamlSyntaxError(error.message, at.line, at.column);
  }
  if (!document.contents) {
    throw new YamlSyntaxError("empty YAML document", 1 + lineOffset, 1);
  }

  const locations = new Map();
  recordYamlLocations(document.contents, [], locations, lineCounter, lineOffset);
  try {
    const parsed = document.toJS({
      mapAsMap: true,
      maxAliasCount: MAX_YAML_ALIAS_COUNT,
    });
    return { value: toSafeYamlValue(parsed), locations };
  } catch (error) {
    const alias = document.contents && findFirstAlias(document.contents);
    const at = located(lineCounter, alias?.range?.[0] ?? 0, lineOffset);
    throw new YamlSyntaxError(error.message, at.line, at.column);
  }
}

function findFirstAlias(node) {
  if (!node) return null;
  if (isAlias(node)) return node;
  if (isMap(node)) {
    for (const pair of node.items) {
      const found = findFirstAlias(pair.value);
      if (found) return found;
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      const found = findFirstAlias(item);
      if (found) return found;
    }
  }
  return null;
}

function makeDiagnostic(file, at, code, reason) {
  return { file, line: at?.line ?? 1, column: at?.column ?? 1, code, reason };
}

function at(document, parts) {
  for (let length = parts.length; length >= 0; length -= 1) {
    const found = document.locations.get(locationKey(parts.slice(0, length)));
    if (found) return found;
  }
  return location(1, 1);
}

function compareKeys(diagnostics, file, document, value, expected, parts, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a mapping"),
    );
    return false;
  }
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !actual.includes(key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected ${unexpected.join(", ")}` : "",
    ].filter(Boolean);
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, details.join("; ")),
    );
    return false;
  }
  return true;
}

function requireString(diagnostics, file, document, value, parts, code) {
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a non-empty string"),
    );
    return false;
  }
  return true;
}

function requireBoundedString(
  diagnostics,
  file,
  document,
  value,
  parts,
  code,
  { minimum = 1, maximum },
) {
  if (typeof value !== "string") {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a string"),
    );
    return false;
  }
  const length = [...value].length;
  if (length < minimum || length > maximum) {
    diagnostics.push(
      makeDiagnostic(
        file,
        at(document, parts),
        code,
        `must contain ${minimum}-${maximum} characters; received ${length}`,
      ),
    );
    return false;
  }
  return true;
}

function requireStringArray(diagnostics, file, document, value, parts, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a sequence of strings"),
    );
    return false;
  }
  return true;
}

function normalizeReturnLabel(label) {
  return label.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function validateReturnContract(diagnostics, file, labels, lineNumbers, fallbackLine) {
  const normalized = labels.map(normalizeReturnLabel);
  const mismatch = STANDARD_RETURN.findIndex((field, index) => normalized[index] !== field);
  if (mismatch !== -1 || normalized.length !== STANDARD_RETURN.length) {
    const index = mismatch === -1 ? Math.min(normalized.length, STANDARD_RETURN.length - 1) : mismatch;
    diagnostics.push(
      makeDiagnostic(
        file,
        location(lineNumbers[index] ?? fallbackLine, 1),
        "RETURN_CONTRACT",
        `expected ordered fields: ${STANDARD_RETURN.join(", ")}; received: ${normalized.join(", ") || "none"}`,
      ),
    );
  }
}

function parseYamlFile(diagnostics, file, source, options) {
  try {
    return parseStrictYaml(source, options);
  } catch (error) {
    if (error instanceof YamlSyntaxError) {
      diagnostics.push(
        makeDiagnostic(
          file,
          location(error.line, error.column),
          "YAML_PARSE",
          error.message,
        ),
      );
      return null;
    }
    throw error;
  }
}

function parseFrontmatter(diagnostics, file, source) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    diagnostics.push(
      makeDiagnostic(file, location(1, 1), "FRONTMATTER", "must begin with '---'"),
    );
    return null;
  }
  const closing = lines.indexOf("---", 1);
  if (closing === -1) {
    diagnostics.push(
      makeDiagnostic(file, location(1, 1), "FRONTMATTER", "is missing its closing '---'"),
    );
    return null;
  }
  return parseYamlFile(diagnostics, file, lines.slice(1, closing).join("\n"), {
    lineOffset: 1,
  });
}

function validateSkill(diagnostics, skillName, skillFile, source) {
  const document = parseFrontmatter(diagnostics, skillFile, source);
  if (!document) return;
  if (!document.value || typeof document.value !== "object" || Array.isArray(document.value)) {
    diagnostics.push(
      makeDiagnostic(skillFile, location(1, 1), "SKILL_FRONTMATTER", "must be a mapping"),
    );
    return;
  }
  const keys = Object.keys(document.value);
  const missing = ["name", "description", "license"].filter(
    (key) => !keys.includes(key),
  );
  const unexpected = keys.filter((key) => !SKILL_FRONTMATTER_FIELDS.includes(key));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected ${unexpected.join(", ")}` : "",
    ].filter(Boolean);
    diagnostics.push(
      makeDiagnostic(
        skillFile,
        location(1, 1),
        "SKILL_FRONTMATTER_KEYS",
        details.join("; "),
      ),
    );
  }

  if (
    requireBoundedString(
      diagnostics,
      skillFile,
      document,
      document.value.name,
      ["name"],
      "SKILL_NAME",
      { maximum: 64 },
    )
  ) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document.value.name)) {
      diagnostics.push(
        makeDiagnostic(
          skillFile,
          at(document, ["name"]),
          "SKILL_NAME",
          "must use lowercase letters, digits, and single interior hyphens only",
        ),
      );
    } else if (document.value.name !== skillName) {
      diagnostics.push(
        makeDiagnostic(
          skillFile,
          at(document, ["name"]),
          "SKILL_NAME",
          `expected '${skillName}'`,
        ),
      );
    }
  }
  requireBoundedString(
    diagnostics,
    skillFile,
    document,
    document.value.description,
    ["description"],
    "SKILL_DESCRIPTION",
    { maximum: 1024 },
  );
  if (
    requireString(
      diagnostics,
      skillFile,
      document,
      document.value.license,
      ["license"],
      "SKILL_LICENSE",
    ) &&
    document.value.license !== "MIT"
  ) {
    diagnostics.push(
      makeDiagnostic(
        skillFile,
        at(document, ["license"]),
        "SKILL_LICENSE",
        "must equal 'MIT' for this repository",
      ),
    );
  }
  if (Object.hasOwn(document.value, "compatibility")) {
    requireBoundedString(
      diagnostics,
      skillFile,
      document,
      document.value.compatibility,
      ["compatibility"],
      "SKILL_COMPATIBILITY",
      { maximum: 500 },
    );
  }
  if (Object.hasOwn(document.value, "metadata")) {
    const metadata = document.value.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      diagnostics.push(
        makeDiagnostic(
          skillFile,
          at(document, ["metadata"]),
          "SKILL_METADATA",
          "must be a mapping of string keys to string values",
        ),
      );
    } else {
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== "string") {
          diagnostics.push(
            makeDiagnostic(
              skillFile,
              at(document, ["metadata", key]),
              "SKILL_METADATA",
              `metadata value '${key}' must be a string`,
            ),
          );
        }
      }
    }
  }
  if (
    Object.hasOwn(document.value, "allowed-tools") &&
    typeof document.value["allowed-tools"] !== "string"
  ) {
    diagnostics.push(
      makeDiagnostic(
        skillFile,
        at(document, ["allowed-tools"]),
        "SKILL_ALLOWED_TOOLS",
        "must be a string while this experimental field is supported",
      ),
    );
  }
}

function validateUiMetadata(diagnostics, skillName, uiFile, source) {
  const document = parseYamlFile(diagnostics, uiFile, source);
  if (!document) return;
  if (
    !compareKeys(
      diagnostics,
      uiFile,
      document,
      document.value,
      ["interface", "policy"],
      [],
      "UI_ROOT_KEYS",
    )
  ) {
    return;
  }
  const ui = document.value.interface;
  if (
    !compareKeys(
      diagnostics,
      uiFile,
      document,
      ui,
      ["display_name", "short_description", "default_prompt"],
      ["interface"],
      "UI_INTERFACE_KEYS",
    )
  ) {
    // Keep validating known fields so independent policy errors are reported too.
  }
  for (const key of ["display_name", "short_description", "default_prompt"]) {
    requireString(
      diagnostics,
      uiFile,
      document,
      ui[key],
      ["interface", key],
      "UI_VALUE",
    );
  }
  if (
    typeof ui.default_prompt === "string" &&
    !ui.default_prompt.includes(`$${skillName}`)
  ) {
    diagnostics.push(
      makeDiagnostic(
        uiFile,
        at(document, ["interface", "default_prompt"]),
        "UI_DEFAULT_PROMPT",
        `must reference '$${skillName}'`,
      ),
    );
  }

  const policy = document.value.policy;
  if (
    compareKeys(
      diagnostics,
      uiFile,
      document,
      policy,
      ["allow_implicit_invocation"],
      ["policy"],
      "UI_POLICY_KEYS",
    )
  ) {
    const expected = skillName === "orchestrate-engineering-team";
    if (policy.allow_implicit_invocation !== expected) {
      diagnostics.push(
        makeDiagnostic(
          uiFile,
          at(document, ["policy", "allow_implicit_invocation"]),
          "UI_IMPLICIT_INVOCATION",
          `must equal ${expected} for ${expected ? "the Main Skill" : "an internal role Skill"}`,
        ),
      );
    }
  }
}

function validateRegistry(diagnostics, document) {
  const file = REGISTRY_PATH;
  const registry = document.value;
  compareKeys(
    diagnostics,
    file,
    document,
    registry,
    ["version", "enforcement", "profiles"],
    [],
    "REGISTRY_KEYS",
  );
  if (registry.version !== 1) {
    diagnostics.push(
      makeDiagnostic(file, at(document, ["version"]), "REGISTRY_VERSION", "must equal 1"),
    );
  }
  if (registry.enforcement !== "advisory") {
    diagnostics.push(
      makeDiagnostic(
        file,
        at(document, ["enforcement"]),
        "ENFORCEMENT",
        "must equal 'advisory'",
      ),
    );
  }
  if (
    !compareKeys(
      diagnostics,
      file,
      document,
      registry.profiles,
      Object.keys(ROLE_PROFILES),
      ["profiles"],
      "PROFILE_SET",
    )
  ) {
    return;
  }

  for (const [profileKey, expected] of Object.entries(ROLE_PROFILES)) {
    const profilePath = ["profiles", profileKey];
    const profile = registry.profiles[profileKey];
    if (
      !compareKeys(
        diagnostics,
        file,
        document,
        profile,
        [
          "name",
          "route_when",
          "skill",
          "write_scope",
          "capabilities",
          "context",
          "returns",
        ],
        profilePath,
        "PROFILE_KEYS",
      )
    ) {
      continue;
    }
    if (profile.name !== expected.name) {
      diagnostics.push(
        makeDiagnostic(
          file,
          at(document, [...profilePath, "name"]),
          "PROFILE_NAME",
          `expected '${expected.name}'`,
        ),
      );
    }
    requireString(
      diagnostics,
      file,
      document,
      profile.route_when,
      [...profilePath, "route_when"],
      "PROFILE_ROUTE",
    );
    requireString(
      diagnostics,
      file,
      document,
      profile.write_scope,
      [...profilePath, "write_scope"],
      "PROFILE_WRITE_SCOPE",
    );

    const skillPath = [...profilePath, "skill"];
    if (
      compareKeys(
        diagnostics,
        file,
        document,
        profile.skill,
        ["name", "path"],
        skillPath,
        "PROFILE_SKILL_KEYS",
      )
    ) {
      const expectedPath = `.agents/skills/${expected.skill}/SKILL.md`;
      if (profile.skill.name !== expected.skill) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...skillPath, "name"]),
            "PROFILE_SKILL_NAME",
            `expected '${expected.skill}'`,
          ),
        );
      }
      if (profile.skill.path !== expectedPath) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...skillPath, "path"]),
            "PROFILE_SKILL_PATH",
            `expected '${expectedPath}'`,
          ),
        );
      }
    }

    const capabilityPath = [...profilePath, "capabilities"];
    if (
      compareKeys(
        diagnostics,
        file,
        document,
        profile.capabilities,
        ["required", "optional", "prohibited"],
        capabilityPath,
        "CAPABILITY_KEYS",
      )
    ) {
      const allCapabilities = [];
      for (const group of ["required", "optional", "prohibited"]) {
        const values = profile.capabilities[group];
        if (
          requireStringArray(
            diagnostics,
            file,
            document,
            values,
            [...capabilityPath, group],
            "CAPABILITY_STRUCTURE",
          )
        ) {
          for (const capability of values) {
            if (allCapabilities.includes(capability)) {
              diagnostics.push(
                makeDiagnostic(
                  file,
                  at(document, [...capabilityPath, group]),
                  "CAPABILITY_DUPLICATE",
                  `'${capability}' appears in more than one capability group or more than once`,
                ),
              );
            } else {
              allCapabilities.push(capability);
            }
          }
        }
      }
      if (Array.isArray(profile.capabilities.required) && !profile.capabilities.required.length) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...capabilityPath, "required"]),
            "CAPABILITY_REQUIRED",
            "must contain at least one capability",
          ),
        );
      }
    }

    if (
      requireStringArray(
        diagnostics,
        file,
        document,
        profile.context,
        [...profilePath, "context"],
        "CONTEXT_STRUCTURE",
      )
    ) {
      if (!profile.context.length) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...profilePath, "context"]),
            "CONTEXT_EMPTY",
            "must contain at least one context field",
          ),
        );
      }
      const duplicate = profile.context.find(
        (item, index) => profile.context.indexOf(item) !== index,
      );
      if (duplicate) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...profilePath, "context"]),
            "CONTEXT_DUPLICATE",
            `'${duplicate}' appears more than once`,
          ),
        );
      }
    }

    if (
      requireStringArray(
        diagnostics,
        file,
        document,
        profile.returns,
        [...profilePath, "returns"],
        "RETURN_STRUCTURE",
      )
    ) {
      validateReturnContract(
        diagnostics,
        file,
        profile.returns,
        [],
        at(document, [...profilePath, "returns"]).line,
      );
    }
  }
}

function validateRoleSkillReturn(diagnostics, file, source) {
  const lines = source.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Return to Main");
  if (heading === -1) {
    diagnostics.push(
      makeDiagnostic(file, location(1, 1), "RETURN_SECTION", "missing '## Return to Main'"),
    );
    return;
  }
  const labels = [];
  const lineNumbers = [];
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break;
    const match = /^-\s+`([^`]+)`\s*:/.exec(lines[index]);
    if (match) {
      labels.push(match[1]);
      lineNumbers.push(index + 1);
    }
  }
  validateReturnContract(diagnostics, file, labels, lineNumbers, heading + 1);
}

function validateTaskPacketReturn(diagnostics, source) {
  const file = TASK_PACKET_PATH;
  const lines = source.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Return");
  if (heading === -1) {
    diagnostics.push(
      makeDiagnostic(file, location(1, 1), "RETURN_SECTION", "missing '## Return'"),
    );
    return;
  }
  const labels = [];
  const lineNumbers = [];
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break;
    const match = /^-\s+([^:]+):/.exec(lines[index]);
    if (match) {
      labels.push(match[1]);
      lineNumbers.push(index + 1);
    }
  }
  validateReturnContract(diagnostics, file, labels, lineNumbers, heading + 1);
}

function diagnosticSort(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.code.localeCompare(right.code) ||
    left.reason.localeCompare(right.reason)
  );
}

async function readProjectFile(root, relativePath, diagnostics) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      diagnostics.push(
        makeDiagnostic(relativePath, location(1, 1), "FILE_MISSING", "required file does not exist"),
      );
      return null;
    }
    throw new Error(`could not read ${relativePath}: ${error.message}`, { cause: error });
  }
}

export function formatDiagnostic(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.reason}`;
}

export async function checkAgentProfiles(root) {
  const diagnostics = [];
  const files = [REGISTRY_PATH, TASK_PACKET_PATH];
  for (const skillName of SKILL_NAMES) {
    files.push(`.agents/skills/${skillName}/SKILL.md`);
    files.push(`.agents/skills/${skillName}/agents/openai.yaml`);
  }
  const sources = await Promise.all(
    files.map(async (file) => [file, await readProjectFile(root, file, diagnostics)]),
  );
  const sourceByFile = new Map(sources);

  const registrySource = sourceByFile.get(REGISTRY_PATH);
  if (registrySource !== null) {
    const registryDocument = parseYamlFile(
      diagnostics,
      REGISTRY_PATH,
      registrySource,
    );
    if (registryDocument) validateRegistry(diagnostics, registryDocument);
  }

  for (const skillName of SKILL_NAMES) {
    const skillFile = `.agents/skills/${skillName}/SKILL.md`;
    const uiFile = `.agents/skills/${skillName}/agents/openai.yaml`;
    const skillSource = sourceByFile.get(skillFile);
    const uiSource = sourceByFile.get(uiFile);
    if (skillSource !== null) {
      validateSkill(diagnostics, skillName, skillFile, skillSource);
      if (skillName !== "orchestrate-engineering-team") {
        validateRoleSkillReturn(diagnostics, skillFile, skillSource);
      }
    }
    if (uiSource !== null) {
      validateUiMetadata(diagnostics, skillName, uiFile, uiSource);
    }
  }

  const taskPacket = sourceByFile.get(TASK_PACKET_PATH);
  if (taskPacket !== null) validateTaskPacketReturn(diagnostics, taskPacket);

  diagnostics.sort(diagnosticSort);
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    summary: {
      skills: SKILL_NAMES.length,
      uiMetadataFiles: SKILL_NAMES.length,
      profiles: Object.keys(ROLE_PROFILES).length,
      returnContracts: Object.keys(ROLE_PROFILES).length + 2,
    },
  };
}
