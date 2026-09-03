import assert from "node:assert/strict";
import test from "node:test";
import { readViewPreference } from "../src/preferences.js";

test("preserves supported modern values", () => {
  assert.equal(readViewPreference({ view: "compact" }), "compact");
  assert.equal(readViewPreference({ view: "comfortable" }), "comfortable");
});

test("uses comfortable for legacy records", () => {
  assert.equal(readViewPreference({}), "comfortable");
});

test("uses comfortable for unknown and malformed records", () => {
  assert.equal(readViewPreference({ view: "dense" }), "comfortable");
  assert.equal(readViewPreference(null), "comfortable");
});
