import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertBundledWorkflowImportClosure } from "./workflow-import-closure.mjs";

/**
 * Creates a disposable module graph fixture and schedules its cleanup with the test context.
 *
 * @param {import('node:test').TestContext} t - Active Node test context.
 * @param {Record<string, string>} sources - Module filenames mapped to complete source text.
 * @returns {Promise<string>} Absolute fixture root containing the generated module graph.
 */
async function fixture(t, sources) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workflow-import-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  await Promise.all(Object.entries(sources).map(([name, source]) => (
    writeFile(path.join(root, name), source)
  )));
  return root;
}

test("workflow closure follows every supported static and literal dynamic ESM edge", async (t) => {
  const dependencies = [
    "side.mjs",
    "named.mjs",
    "export-named.mjs",
    "export-all.mjs",
    "export-namespace.mjs",
    "dynamic.mjs",
    "dynamic-template.mjs",
    "template-expression.mjs",
  ];
  const sources = Object.fromEntries(dependencies.map((name) => [name, "export {};\n"]));
  sources["workflow.mjs"] = `
    import "node:path";
    import "./side.mjs";
    import { value } from "./named.mjs";
    export { value as renamed } from "./export-named.mjs";
    export * from "./export-all.mjs";
    export * as namespace from "./export-namespace.mjs";
    const dynamic = import("./dynamic.mjs");
    const dynamicTemplate = import(\`./dynamic-template.mjs\`);
    const embedded = \`value: \${import("./template-expression.mjs")}\`;
  `;
  sources["workflow-core.mjs"] = `
    // import("yaml") and export * from "outside-comment.mjs" are not code.
    /* import("outside-block-comment.mjs") */
    const text = 'import("outside-string.mjs")';
    const pattern = /import("outside-regex.mjs")/;
    if (true) /import("outside-control-flow-regex.mjs")/.test(text);
    const object = { import() {} };
    object?.import("outside-optional-chain.mjs");
    const template = \`import("outside-template.mjs")\`;
    export {};
  `;
  const root = await fixture(t, sources);

  const closure = await assertBundledWorkflowImportClosure(root);

  assert.deepEqual(
    closure.map((file) => path.basename(file)).sort(),
    [...dependencies, "workflow-core.mjs", "workflow.mjs"].sort(),
  );
});

test("workflow closure rejects every bare specifier form", async (t) => {
  const forms = [
    'import "yaml";',
    'export { value } from "yaml";',
    'export * from "yaml";',
    'export * as namespace from "yaml";',
    'const dependency = import("yaml");',
  ];
  for (const [index, declaration] of forms.entries()) {
    await t.test(String(index), async (t) => {
      const root = await fixture(t, {
        "workflow.mjs": declaration,
        "workflow-core.mjs": 'import "node:assert";',
      });
      await assert.rejects(
        assertBundledWorkflowImportClosure(root),
        /must not import third-party runtime module 'yaml'/,
      );
    });
  }
});

test("workflow closure rejects escaped relative imports and non-literal dynamic imports", async (t) => {
  await t.test("relative escape", async (t) => {
    const root = await fixture(t, {
      "workflow.mjs": 'import "../outside.mjs";',
      "workflow-core.mjs": 'import "node:assert";',
    });
    await assert.rejects(
      assertBundledWorkflowImportClosure(root),
      /import escaped the bundled scripts directory: \.\.\/outside\.mjs/,
    );
  });
  await t.test("percent-encoded relative escape", async (t) => {
    const root = await fixture(t, {
      "workflow.mjs": 'import "./%2e%2e/out.mjs";',
      "workflow-core.mjs": 'import "node:assert";',
    });
    await assert.rejects(
      assertBundledWorkflowImportClosure(root),
      /import escaped the bundled scripts directory: \.\/%2e%2e\/out\.mjs/,
    );
  });
  for (const [label, specifier] of [
    ["encoded slash", "./nested%2Fmodule.mjs"],
    ["encoded backslash", "./nested%5Cmodule.mjs"],
  ]) {
    await t.test(label, async (t) => {
      const root = await fixture(t, {
        "workflow.mjs": `import "${specifier}";`,
        "workflow-core.mjs": 'import "node:assert";',
      });
      await assert.rejects(
        assertBundledWorkflowImportClosure(root),
        /import contains an invalid encoded path separator/,
      );
    });
  }
  await t.test("non-literal dynamic import", async (t) => {
    const root = await fixture(t, {
      "workflow.mjs": 'const name = "./dependency.mjs"; import(name);',
      "workflow-core.mjs": 'import "node:assert";',
    });
    await assert.rejects(
      assertBundledWorkflowImportClosure(root),
      /workflow\.mjs contains unsupported non-literal dynamic import/,
    );
  });
  await t.test("computed template dynamic import", async (t) => {
    const root = await fixture(t, {
      "workflow.mjs": 'const name = "dependency"; import(`./${name}.mjs`);',
      "workflow-core.mjs": 'import "node:assert";',
    });
    await assert.rejects(
      assertBundledWorkflowImportClosure(root),
      /workflow\.mjs contains unsupported non-literal dynamic import/,
    );
  });
  await t.test("concatenated dynamic import", async (t) => {
    const root = await fixture(t, {
      "workflow.mjs": 'const name = "dependency.mjs"; import("./" + name);',
      "workflow-core.mjs": 'import "node:assert";',
    });
    await assert.rejects(
      assertBundledWorkflowImportClosure(root),
      /workflow\.mjs contains unsupported non-literal dynamic import/,
    );
  });
});

test("workflow closure rejects raw ECMAScript line separators before parsing", async (t) => {
  for (const [name, separator] of [
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ]) {
    await t.test(`${name} after a line comment`, async (t) => {
      const root = await fixture(t, {
        "workflow.mjs": `// comment${separator}import "./dependency.mjs";`,
        "workflow-core.mjs": 'import "node:assert";',
      });
      await assert.rejects(
        assertBundledWorkflowImportClosure(root),
        /bundled runtime source must not contain raw ECMAScript line separators/,
      );
    });
    await t.test(`${name} in a string`, async (t) => {
      const root = await fixture(t, {
        "workflow.mjs": `const value = "before${separator}after"; import "node:assert";`,
        "workflow-core.mjs": 'import "node:path";',
      });
      await assert.rejects(
        assertBundledWorkflowImportClosure(root),
        /bundled runtime source must not contain raw ECMAScript line separators/,
      );
    });
  }
});

test("workflow closure permits escaped ECMAScript line separator sequences", async (t) => {
  const root = await fixture(t, {
    "workflow.mjs": String.raw`const value = "\u2028\u2029"; import "node:assert";`,
    "workflow-core.mjs": 'import "node:path";',
  });

  await assert.doesNotReject(assertBundledWorkflowImportClosure(root));
});

test("workflow closure rejects relative imports whose realpath escapes the scripts root", async (t) => {
  const root = await fixture(t, {
    "workflow.mjs": 'import "./linked.mjs";',
    "workflow-core.mjs": 'import "node:assert";',
  });
  const outside = await mkdtemp(path.join(os.tmpdir(), "workflow-import-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const target = path.join(outside, "outside.mjs");
  await writeFile(target, "export {};\n");
  await symlink(target, path.join(root, "linked.mjs"));

  await assert.rejects(
    assertBundledWorkflowImportClosure(root),
    /linked\.mjs resolved outside the bundled scripts directory/,
  );
});

test("workflow closure resolves symlinked importer edges from the canonical importer", async (t) => {
  const container = await mkdtemp(path.join(os.tmpdir(), "workflow-import-canonical-"));
  t.after(() => rm(container, { recursive: true, force: true }));
  const root = path.join(container, "scripts");
  await mkdir(path.join(root, "lexical"), { recursive: true });
  await writeFile(path.join(root, "workflow-core.mjs"), 'import "node:assert";\n');
  await writeFile(path.join(root, "canonical.mjs"), 'import "../outside.mjs";\n');
  await writeFile(path.join(root, "outside.mjs"), "export {};\n");
  await writeFile(path.join(container, "outside.mjs"), "export {};\n");
  await symlink("../canonical.mjs", path.join(root, "lexical", "workflow.mjs"));

  await assert.rejects(
    assertBundledWorkflowImportClosure(root, [
      "lexical/workflow.mjs",
      "workflow-core.mjs",
    ]),
    /workflow\.mjs import escaped the bundled scripts directory: \.\.\/outside\.mjs/,
  );
});

test("workflow closure traverses in-root dependencies of an in-root symlinked importer", async (t) => {
  const root = await fixture(t, {
    "workflow-core.mjs": 'import "node:assert";\n',
  });
  await mkdir(path.join(root, "entry"), { recursive: true });
  await mkdir(path.join(root, "canonical"), { recursive: true });
  await writeFile(path.join(root, "canonical", "workflow.mjs"), 'import "./dependency.mjs";\n');
  await writeFile(path.join(root, "canonical", "dependency.mjs"), "export {};\n");
  await symlink("../canonical/workflow.mjs", path.join(root, "entry", "workflow.mjs"));

  const closure = await assertBundledWorkflowImportClosure(root, [
    "entry/workflow.mjs",
    "workflow-core.mjs",
  ]);
  const canonicalRoot = await realpath(root);

  assert.deepEqual(
    closure.map((file) => path.relative(canonicalRoot, file)).sort(),
    ["canonical/dependency.mjs", "canonical/workflow.mjs", "workflow-core.mjs"],
  );
});
