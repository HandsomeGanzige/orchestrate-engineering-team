import assert from "node:assert/strict";
import test from "node:test";
import { toSlug } from "../src/index.js";

test("normalizes words and punctuation into one separator", () => {
  assert.equal(toSlug("  Ship,  Review & Learn!  "), "ship-review-learn");
});

test("does not leave separators at the boundary", () => {
  assert.equal(toSlug("---Already--Slugged---"), "already-slugged");
});
