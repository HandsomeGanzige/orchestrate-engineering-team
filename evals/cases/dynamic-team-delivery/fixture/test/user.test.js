import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUser } from "../src/user.js";

test("keeps modern records compatible", () => {
  assert.deepEqual(normalizeUser({ firstName: " Ada ", lastName: " Lovelace " }), { firstName: "Ada", lastName: "Lovelace", displayName: "Ada Lovelace" });
});

test("accepts and normalizes legacy name records", () => {
  assert.deepEqual(normalizeUser({ name: "  Grace   Brewster   Murray Hopper  " }), { firstName: "Grace", lastName: "Brewster Murray Hopper", displayName: "Grace Brewster Murray Hopper" });
});

test("requires at least one supported name form", () => {
  assert.throws(() => normalizeUser({}), /name|required/i);
});
