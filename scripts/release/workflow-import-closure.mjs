import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { init, parse } from "es-module-lexer";

/**
 * Extracts every static or literal dynamic module specifier from one ESM source file.
 *
 * @param {string} source - Complete JavaScript module source.
 * @param {string} file - Module path used by parser diagnostics.
 * @returns {Promise<string[]>} Imported module specifiers in source order.
 */
async function moduleSpecifiers(source, file) {
  // Fail closed because the bundled lexer cannot reliably treat raw ECMAScript
  // line separators as comment terminators.
  assert.ok(
    !/[\u2028\u2029]/u.test(source),
    `${path.basename(file)} bundled runtime source must not contain raw ECMAScript line separators`,
  );
  await init;
  // `d` is -1 for static import/export records and non-negative for import();
  // `n` is the decoded literal specifier, or undefined for a computed expression.
  const [imports] = parse(source, file);
  return imports.flatMap((record) => {
    if (record.d < 0) return typeof record.n === "string" ? [record.n] : [];
    assert.ok(
      typeof record.n === "string",
      `${path.basename(file)} contains unsupported non-literal dynamic import`,
    );
    // Computed dynamic imports cannot be closed over at release time, so they are
    // rejected instead of being deferred to runtime resolution.
    return [record.n];
  });
}

/**
 * Tests whether a filesystem path is equal to or nested below a boundary root.
 *
 * @param {string} root - Canonical boundary path.
 * @param {string} candidate - Path to test.
 * @returns {boolean} Whether the candidate remains within the boundary.
 */
function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * Resolves one relative ESM specifier with Node URL semantics and rejects encoded separators.
 *
 * @param {string} specifier - Relative module specifier.
 * @param {string} importer - Canonical importing module path.
 * @returns {string} Resolved filesystem path.
 */
function resolveRelativeSpecifier(specifier, importer) {
  // Node resolves relative ESM specifiers as URLs, including percent-encoded
  // dot segments, before converting the result back to a filesystem path.
  const importerUrl = pathToFileURL(importer);
  const importedUrl = new URL(specifier, importerUrl);
  let imported;
  try {
    imported = fileURLToPath(importedUrl);
  } catch (error) {
    if (error?.code === "ERR_INVALID_FILE_URL_PATH") {
      assert.fail(
        `${path.basename(importer)} import contains an invalid encoded path separator: ${specifier}`,
      );
    }
    throw error;
  }
  assert.ok(
    !/%(?:2f|5c)/i.test(importedUrl.pathname),
    `${path.basename(importer)} import contains an invalid encoded path separator: ${specifier}`,
  );
  return imported;
}

/**
 * Traverses the complete bundled workflow import graph and enforces a closed runtime boundary.
 *
 * @param {string} scriptRoot - Bundled scripts directory.
 * @param {string[]} [entries=['workflow.mjs', 'workflow-core.mjs']] - Public entry modules that seed traversal.
 * @returns {Promise<string[]>} Sorted canonical paths for every visited runtime module.
 */
export async function assertBundledWorkflowImportClosure(
  scriptRoot,
  entries = ["workflow.mjs", "workflow-core.mjs"],
) {
  const resolvedRoot = path.resolve(scriptRoot);
  const canonicalRoot = await realpath(resolvedRoot);
  const pending = entries.map((entry) => {
    const file = path.resolve(resolvedRoot, entry);
    assert.ok(
      isWithin(resolvedRoot, file),
      `workflow entry escaped the bundled scripts directory: ${file}`,
    );
    return file;
  });
  const visited = new Set();
  let importCount = 0;

  while (pending.length > 0) {
    const file = pending.pop();
    const metadata = await stat(file).catch(() => null);
    assert.ok(metadata?.isFile(), `workflow runtime module is missing: ${file}`);
    const canonicalFile = await realpath(file);
    assert.ok(
      isWithin(canonicalRoot, canonicalFile),
      `${path.basename(file)} resolved outside the bundled scripts directory`,
    );
    if (visited.has(canonicalFile)) continue;
    visited.add(canonicalFile);

    const specifiers = await moduleSpecifiers(await readFile(file, "utf8"), file);
    importCount += specifiers.length;
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) continue;
      assert.ok(
        specifier.startsWith("./") || specifier.startsWith("../"),
        `${path.basename(file)} must not import third-party runtime module '${specifier}'`,
      );
      const imported = resolveRelativeSpecifier(specifier, canonicalFile);
      assert.ok(
        isWithin(canonicalRoot, imported),
        `${path.basename(file)} import escaped the bundled scripts directory: ${specifier}`,
      );
      pending.push(imported);
    }
  }

  assert.ok(importCount > 0, "workflow runtime must declare its Node.js imports explicitly");
  return [...visited].sort();
}
