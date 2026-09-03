import assert from "node:assert/strict";
import test from "node:test";
import { formatLabel } from "../src/formatter.js";
import { normalizeLabel } from "../src/normalizer.js";

test("normalizes labels", () => {
  assert.equal(normalizeLabel("  Ready   For   Review "), "ready for review");
});

test("formats normalized labels", () => {
  assert.equal(formatLabel("  Ready   For   Review "), "[ready for review]");
});
