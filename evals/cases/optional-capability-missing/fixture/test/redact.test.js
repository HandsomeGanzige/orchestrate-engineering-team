import assert from "node:assert/strict";
import test from "node:test";
import { redactBearerTokens } from "../src/redact.js";

test("redacts every Bearer credential without losing surrounding text", () => {
  assert.equal(redactBearerTokens("one Bearer alpha, two bearer BETA; done"), "one Bearer [REDACTED], two bearer [REDACTED]; done");
});

test("leaves unrelated text unchanged", () => {
  assert.equal(redactBearerTokens("nothing sensitive here"), "nothing sensitive here");
});
