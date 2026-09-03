import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "../src/queue.js";

test("stores queued items for one process", () => {
  const queue = new Queue();
  queue.add({ id: "one" });
  assert.deepEqual(queue.all(), [{ id: "one" }]);
});
