import test from "node:test";
import assert from "node:assert/strict";
import { exportLatest } from "../src/notebook/exportFlow.js";

test("flushes a pending active notebook save before exporting", async () => {
  const calls = [];
  await exportLatest(
    "notebook-1",
    "notebook-1",
    "/tmp/export.mathforge",
    async () => { calls.push("save-start"); await Promise.resolve(); calls.push("save-finished"); return true; },
    async (id, path) => { calls.push(`export:${id}:${path}`); },
  );
  assert.deepEqual(calls, [
    "save-start",
    "save-finished",
    "export:notebook-1:/tmp/export.mathforge",
  ]);
});

test("cancels export when the pending save fails", async () => {
  let exported = false;
  await assert.rejects(
    exportLatest("notebook-1", "notebook-1", "/tmp/export.mathforge", async () => false, async () => { exported = true; }),
    /latest notebook changes could not be saved/,
  );
  assert.equal(exported, false);
});
