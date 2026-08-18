import { access, readFile } from "node:fs/promises";
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
    writeScope: "assigned-production-files-or-modules-only",
  },
  test: {
    name: "Test Agent",
    skill: "verify-work-item",
    writeScope: "read-only-except-disposable-command-artifacts",
  },
  review: {
    name: "Review Agent",
    skill: "review-work-item",
    writeScope: "read-only",
  },
  architecture: {
    name: "Architecture Agent",
    skill: "architect-work-item",
    writeScope: "read-only",
  },
});

const SKILL_NAMES = Object.freeze([
  "orchestrate-engineering-team",
  ...Object.values(ROLE_PROFILES).map(({ skill }) => skill),
]);

export const STANDARD_RETURN = Object.freeze([
  "status",
  "summary",
  "artifacts",
  "files",
  "checks",
  "requires_test",
  "test_reason",
  "requires_review",
  "review_reason",
  "blockers",
]);

const REGISTRY_PATH =
  ".agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml";
const TASK_PACKET_PATH =
  ".agents/skills/orchestrate-engineering-team/assets/role-task-packet.md";
const MAIN_RESOURCE_PATHS = Object.freeze([
  ".agents/skills/orchestrate-engineering-team/scripts/cli-runtime.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow-document.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/verification.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/work-model.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow-contract.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow-core.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow-runtime.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow-store.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/workflow.mjs",
  ".agents/skills/orchestrate-engineering-team/scripts/value-policy.mjs",
  TASK_PACKET_PATH,
  ".agents/skills/orchestrate-engineering-team/references/state-and-voting.md",
  REGISTRY_PATH,
]);
const OBSOLETE_RESOURCE_PATHS = Object.freeze([
  ".agents/skills/orchestrate-engineering-team/assets/work-item-index.md",
  ".agents/skills/orchestrate-engineering-team/assets/workspace-index.md",
]);
const SKILL_FRONTMATTER_FIELDS = Object.freeze([
  "name",
  "description",
  "license",
  "metadata",
  "allowed-tools",
]);

class YamlSyntaxError extends Error {
  /**
   * Creates a YAML syntax error carrying an exact source location.
   *
   * @param {string} message - Parser failure description.
   * @param {number} line - One-based source line.
   * @param {number} column - One-based source column.
   */
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

const MAX_YAML_ALIAS_COUNT = 50;

/**
 * Creates a normalized source location for diagnostics.
 *
 * @param {number} line - One-based source line.
 * @param {number} [column=1] - One-based source column.
 * @returns {{line: number, column: number}} Normalized diagnostic location.
 */
function location(line, column = 1) {
  return { line, column };
}

/**
 * Converts a structured YAML path into the stable lookup key used by the location map.
 *
 * @param {(string|number)[]} parts - Mapping keys and sequence indexes from the document root.
 * @returns {string} Dot-delimited internal lookup key.
 */
function locationKey(parts) {
  return parts.join(".");
}

/**
 * Resolves a character offset to a one-based line and column with an optional line offset.
 *
 * @param {import('yaml').LineCounter} lineCounter - YAML parser line counter.
 * @param {number} offset - Zero-based source character offset.
 * @param {number} lineOffset - Additional line count for embedded YAML such as frontmatter.
 * @returns {{line: number, column: number}} Adjusted source location.
 */
function located(lineCounter, offset, lineOffset) {
  const at = lineCounter.linePos(Math.max(0, offset ?? 0));
  return location(at.line + lineOffset, at.col);
}

/**
 * Recursively records source locations for YAML mapping keys and sequence items.
 *
 * @param {unknown} node - Current YAML AST node.
 * @param {(string|number)[]} parts - Structured path to the current node.
 * @param {Map<string, {line: number, column: number}>} locations - Mutable location index.
 * @param {import('yaml').LineCounter} lineCounter - Parser line counter.
 * @param {number} lineOffset - Additional embedded-document line offset.
 * @returns {void} Populates the supplied location map in place.
 */
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

/**
 * Converts parsed YAML values into null-prototype data while rejecting cycles and unsafe keys.
 *
 * @param {unknown} value - YAML-produced value to sanitize recursively.
 * @param {Set<object>} [ancestors=new Set()] - Active recursion chain used to detect cycles.
 * @returns {unknown} Primitive, array, or null-prototype mapping safe for exact-schema validation.
 */
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
 * Parses standards-valid YAML and converts every mapping to null-prototype data.
 *
 * @param {string} source - Complete YAML source text.
 * @param {{lineOffset?: number}} [options] - Additional source lines preceding embedded YAML.
 * @returns {{value: unknown, locations: Map<string, {line: number, column: number}>, lineCounter: import('yaml').LineCounter}} Safe parsed value and source-location metadata.
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

/**
 * Locates the first YAML alias node so unsupported alias use can be diagnosed precisely.
 *
 * @param {unknown} node - YAML AST node to inspect recursively.
 * @returns {unknown|null} First alias node, or `null` when none exists.
 */
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

/**
 * Creates one normalized checker diagnostic.
 *
 * @param {string} file - Project-relative file path.
 * @param {{line: number, column: number}} at - Source location.
 * @param {string} code - Stable diagnostic code.
 * @param {string} reason - Human-readable failure explanation.
 * @returns {object} Diagnostic record consumed by formatting and tests.
 */
function makeDiagnostic(file, at, code, reason) {
  return { file, line: at?.line ?? 1, column: at?.column ?? 1, code, reason };
}

/**
 * Resolves the best recorded location for a structured YAML path.
 *
 * @param {object} document - Parsed strict YAML document with a location map.
 * @param {(string|number)[]} parts - Desired mapping or sequence path.
 * @returns {{line: number, column: number}} Exact or nearest-parent location.
 */
function at(document, parts) {
  for (let length = parts.length; length >= 0; length -= 1) {
    const found = document.locations.get(locationKey(parts.slice(0, length)));
    if (found) return found;
  }
  return location(1, 1);
}

/**
 * Compares mapping keys against an exact allowlist and records missing or unknown fields.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - File being validated.
 * @param {object} document - Strict YAML document providing source locations.
 * @param {unknown} value - Candidate mapping value.
 * @param {string[]} expected - Exact permitted key set.
 * @param {(string|number)[]} parts - Structured path to the mapping.
 * @param {string} code - Diagnostic code for shape failures.
 * @returns {boolean} `true` when the mapping contains exactly the expected keys.
 */
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

/**
 * Requires a non-empty string and emits a located diagnostic on failure.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - File being validated.
 * @param {object} document - Strict YAML document providing locations.
 * @param {unknown} value - Candidate string.
 * @param {(string|number)[]} parts - Structured field path.
 * @param {string} code - Diagnostic code for failure.
 * @returns {boolean} Whether the value is a non-empty string.
 */
function requireString(diagnostics, file, document, value, parts, code) {
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a non-empty string"),
    );
    return false;
  }
  return true;
}

/**
 * Requires a string whose length lies within inclusive bounds.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - File being validated.
 * @param {object} document - Strict YAML document providing locations.
 * @param {unknown} value - Candidate string.
 * @param {(string|number)[]} parts - Structured field path.
 * @param {string} code - Diagnostic code for failure.
 * @param {{minimum?: number, maximum?: number, label?: string}} [bounds] - Inclusive length policy and display label.
 * @returns {boolean} Whether the value satisfies type and length requirements.
 */
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

/**
 * Requires an array containing only non-empty strings.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - File being validated.
 * @param {object} document - Strict YAML document providing locations.
 * @param {unknown} value - Candidate array.
 * @param {(string|number)[]} parts - Structured field path.
 * @param {string} code - Diagnostic code for failure.
 * @returns {boolean} Whether the value is a valid string array.
 */
function requireStringArray(diagnostics, file, document, value, parts, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    diagnostics.push(
      makeDiagnostic(file, at(document, parts), code, "must be a sequence of strings"),
    );
    return false;
  }
  return true;
}

/**
 * Normalizes a Markdown return-contract label for exact comparison.
 *
 * @param {string} label - Raw field label extracted from Markdown.
 * @returns {string} Lowercase label without punctuation or code formatting.
 */
function normalizeReturnLabel(label) {
  return label.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
}

/**
 * Validates an ordered Markdown return-contract field list against the role protocol.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - Skill or asset file being validated.
 * @param {string[]} labels - Extracted return-field labels in document order.
 * @param {number[]} lineNumbers - Source line for each extracted label.
 * @param {number} fallbackLine - Location used when fields are missing entirely.
 * @returns {void} Appends deterministic diagnostics for missing, unknown, or reordered fields.
 */
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

/**
 * Parses a YAML file and converts parser failures into project diagnostics.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - File being parsed.
 * @param {string} source - Complete YAML source text.
 * @param {object} [options] - Strict parser options such as embedded line offsets.
 * @returns {object|null} Parsed strict YAML document, or `null` after a recorded failure.
 */
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

/**
 * Extracts and strictly parses YAML frontmatter from a Skill Markdown file.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - Skill file path.
 * @param {string} source - Complete Skill Markdown content.
 * @returns {object|null} Parsed frontmatter document, or `null` after a recorded failure.
 */
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

/**
 * Validates one Skill's frontmatter, size limits, role protocol, and resource references.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} skillName - Canonical Skill directory name.
 * @param {string} skillFile - Project-relative `SKILL.md` path.
 * @param {string} source - Complete Skill Markdown content.
 * @returns {object|null} Parsed frontmatter document when parsing succeeds; otherwise `null`.
 */
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

/**
 * Validates one Skill's Codex UI metadata and invocation policy.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} skillName - Canonical Skill name.
 * @param {string} uiFile - Project-relative `agents/openai.yaml` path.
 * @param {string} source - Complete UI metadata YAML.
 * @returns {object|null} Parsed UI document when parsing succeeds; otherwise `null`.
 */
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

/**
 * Validates the advisory agent-profile registry, capability declarations, and task-packet schema.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {object|null} document - Parsed strict YAML registry document.
 * @returns {void} Appends every registry diagnostic without short-circuiting independent checks.
 */
function validateRegistry(diagnostics, document) {
  const file = REGISTRY_PATH;
  const registry = document.value;
  compareKeys(
    diagnostics,
    file,
    document,
    registry,
    ["enforcement", "profiles"],
    [],
    "REGISTRY_KEYS",
  );
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
    if (requireString(
      diagnostics,
      file,
      document,
      profile.write_scope,
      [...profilePath, "write_scope"],
      "PROFILE_WRITE_SCOPE",
    ) && profile.write_scope !== expected.writeScope) {
      diagnostics.push(
        makeDiagnostic(
          file,
          at(document, [...profilePath, "write_scope"]),
          "PROFILE_WRITE_SCOPE",
          `expected '${expected.writeScope}'`,
        ),
      );
    }

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
      if (
        Array.isArray(profile.capabilities.prohibited) &&
        !profile.capabilities.prohibited.includes("task-state-write")
      ) {
        diagnostics.push(
          makeDiagnostic(
            file,
            at(document, [...capabilityPath, "prohibited"]),
            "TASK_STATE_CAPABILITY",
            "must prohibit task-state-write for every ordinary role",
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
      for (const field of ["assignment-id", "capability-availability"]) {
        if (!profile.context.includes(field)) {
          diagnostics.push(
            makeDiagnostic(
              file,
              at(document, [...profilePath, "context"]),
              "CONTEXT_REQUIRED",
              `must include '${field}' in every role packet context`,
            ),
          );
        }
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

/**
 * Extracts and validates the compact return envelope documented by a role Skill.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - Role Skill path.
 * @param {string} source - Complete role Skill Markdown.
 * @returns {void} Appends return-contract diagnostics.
 */
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
    const bulletMatch = /^-\s+`?([^`:]+)`?\s*:/.exec(lines[index]);
    const yamlMatch = /^([a-z][a-z0-9_-]*)\s*:/.exec(lines[index]);
    const match = bulletMatch ?? yamlMatch;
    if (match) {
      labels.push(match[1]);
      lineNumbers.push(index + 1);
    }
  }
  validateReturnContract(diagnostics, file, labels, lineNumbers, heading + 1);
}

/**
 * Validates the return-contract section in the bundled role task-packet asset.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} source - Complete role task-packet Markdown.
 * @returns {void} Appends return-contract diagnostics for the asset.
 */
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
    const bulletMatch = /^-\s+`?([^`:]+)`?\s*:/.exec(lines[index]);
    const yamlMatch = /^([a-z][a-z0-9_-]*)\s*:/.exec(lines[index]);
    const match = bulletMatch ?? yamlMatch;
    if (match) {
      labels.push(match[1]);
      lineNumbers.push(index + 1);
    }
  }
  validateReturnContract(diagnostics, file, labels, lineNumbers, heading + 1);
}

/**
 * Confirms that the Main Skill states Main-only task ownership and no-production-code boundaries.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - Main Skill path.
 * @param {string} source - Main Skill Markdown.
 * @returns {void} Appends semantic-contract diagnostics.
 */
function validateMainOnlySemantics(diagnostics, file, source) {
  if (!/fork_turns\s*[":=]\s*["']?none["']?/i.test(source)) {
    diagnostics.push(
      makeDiagnostic(
        file,
        location(1, 1),
        "EMPTY_HISTORY",
        "must require every role and Child Main dispatch to set fork_turns to 'none' explicitly",
      ),
    );
  }
  if (
    !/(?:only|sole|unique|single)[^\n]{0,120}(?:Main|owner)[^\n]{0,120}(?:work\.md|state\.json|task state)|(?:Main|owner)[^\n]{0,120}(?:only|sole|unique|single)[^\n]{0,120}(?:work\.md|state\.json|task state)/i.test(
      source,
    )
  ) {
    diagnostics.push(
      makeDiagnostic(
        file,
        location(1, 1),
        "MAIN_ONLY_STATE",
        "must state that the owner Main is the only writer of its Work Item document/task state",
      ),
    );
  }
  for (const [pattern, code, reason] of [
    [/one plain-Markdown `work\.md`|exactly one plain-Markdown `work\.md`/i, "WORK_DOCUMENT", "must define one plain-Markdown work.md per Main-owned Work Item"],
    [/sibling[^\n]{0,100}`state\.json`|`state\.json`[^\n]{0,100}sibling/i, "SEPARATE_STATE", "must define sibling state.json as separate operational coordination"],
    [/archive[^\n]{0,160}(?:exclude|default|normal)|(?:exclude|default|normal)[^\n]{0,160}archive/i, "ARCHIVE_CONTEXT", "must exclude retained archives from normal Agent context"],
  ]) {
    if (!pattern.test(source)) {
      diagnostics.push(makeDiagnostic(file, location(1, 1), code, reason));
    }
  }
}

/**
 * Confirms that a role Skill forbids direct Work Item index mutation.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} file - Role Skill path.
 * @param {string} source - Role Skill Markdown.
 * @returns {void} Appends state-boundary diagnostics.
 */
function validateRoleStateBoundary(diagnostics, file, source) {
  if (
    !/(?:do not|must not|never|forbidden|prohibited)[^\n]{0,160}(?:work\.md|state\.json|task state)|(?:work\.md|state\.json|task state)[^\n]{0,160}(?:do not|must not|never|forbidden|prohibited)/i.test(
      source,
    )
  ) {
    diagnostics.push(
      makeDiagnostic(
        file,
        location(1, 1),
        "ROLE_STATE_WRITE",
        "must explicitly prohibit the role from modifying Work Item documents/task state",
      ),
    );
  }
}

/**
 * Confirms that the task-packet asset requires explicit empty-history dispatch and bounded context.
 *
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @param {string} source - Complete role task-packet Markdown.
 * @returns {void} Appends packet semantic diagnostics.
 */
function validateTaskPacketSemantics(diagnostics, source) {
  const file = TASK_PACKET_PATH;
  if (!/fork_turns\s*[":=]\s*["']?none["']?/i.test(source)) {
    diagnostics.push(
      makeDiagnostic(
        file,
        location(1, 1),
        "EMPTY_HISTORY",
        "must carry the explicit fork_turns: none dispatch requirement",
      ),
    );
  }
  validateRoleStateBoundary(diagnostics, file, source);
  if (!/(?:transient|do not persist|must not persist)[^\n]{0,160}(?:return|result|message)|(?:return|result|message)[^\n]{0,160}(?:transient|do not persist|must not persist)/i.test(source)) {
    diagnostics.push(
      makeDiagnostic(
        file,
        location(1, 1),
        "TRANSIENT_RESULT",
        "must state that the role return is transient and must not be persisted as task-local history",
      ),
    );
  }
}

/**
 * Orders diagnostics deterministically by file, line, column, code, and reason.
 *
 * @param {object} left - First diagnostic.
 * @param {object} right - Second diagnostic.
 * @returns {number} Negative, zero, or positive comparator result.
 */
function diagnosticSort(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.code.localeCompare(right.code) ||
    left.reason.localeCompare(right.reason)
  );
}

/**
 * Reads one required project file and records a missing-file diagnostic instead of throwing.
 *
 * @param {string} root - Repository root.
 * @param {string} relativePath - Project-relative file path.
 * @param {object[]} diagnostics - Mutable diagnostic collection.
 * @returns {Promise<string|null>} UTF-8 content, or `null` when the file cannot be read.
 */
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

/**
 * Formats one structured diagnostic for stable CLI output.
 *
 * @param {object} diagnostic - Diagnostic containing file, location, code, and reason.
 * @returns {string} Single-line human-readable diagnostic.
 */
export function formatDiagnostic(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.reason}`;
}

/**
 * Validates all canonical Skills, UI metadata, resources, and advisory agent profiles.
 *
 * @param {string} root - Repository root containing `.agents/skills`.
 * @returns {Promise<{ok: boolean, diagnostics: object[], summary: object}>} Overall validity, sorted diagnostics, and checked-resource counts.
 */
export async function checkAgentProfiles(root) {
  const diagnostics = [];
  for (const file of OBSOLETE_RESOURCE_PATHS) {
    try {
      await access(path.join(root, file));
      diagnostics.push(
        makeDiagnostic(
          file,
          location(1, 1),
          "OBSOLETE_RESOURCE",
          "obsolete JSON-in-Markdown template must not be packaged",
        ),
      );
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
  }
  const files = [...MAIN_RESOURCE_PATHS];
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
      if (skillName === "orchestrate-engineering-team") {
        validateMainOnlySemantics(diagnostics, skillFile, skillSource);
      } else {
        validateRoleSkillReturn(diagnostics, skillFile, skillSource);
        validateRoleStateBoundary(diagnostics, skillFile, skillSource);
      }
    }
    if (uiSource !== null) {
      validateUiMetadata(diagnostics, skillName, uiFile, uiSource);
    }
  }

  const taskPacket = sourceByFile.get(TASK_PACKET_PATH);
  if (taskPacket !== null) {
    validateTaskPacketReturn(diagnostics, taskPacket);
    validateTaskPacketSemantics(diagnostics, taskPacket);
  }

  diagnostics.sort(diagnosticSort);
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    summary: {
      skills: SKILL_NAMES.length,
      uiMetadataFiles: SKILL_NAMES.length,
      profiles: Object.keys(ROLE_PROFILES).length,
      returnContracts: Object.keys(ROLE_PROFILES).length * 2 + 1,
    },
  };
}
