import test from "node:test";
import assert from "node:assert/strict";
import { DocumentHistory } from "../src/notebook/editorHistory.js";
import { deleteCell, duplicateCell, moveCell } from "../src/notebook/cellEditing.js";
import { copyMathResult } from "../src/notebook/copyResult.js";

const cell = (id, content = id) => ({ id, order: 0, cellType: "mathematics", content, result: null });

test("undo and redo restore deleted document state", () => {
  const history = new DocumentHistory();
  const before = { cells: [cell("a")] };
  const afterDelete = { cells: [] };
  history.record(before);
  assert.deepEqual(history.undo(afterDelete), before);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(before), afterDelete);
  assert.equal(history.canUndo, true);
});

test("duplicate cell copies content with a fresh ID and contiguous order", () => {
  const result = duplicateCell([cell("a"), { ...cell("b"), order: 1 }], "a", () => "copy-a");
  assert.deepEqual(result.map((item) => [item.id, item.order]), [["a", 0], ["copy-a", 1], ["b", 2]]);
  assert.equal(result[1].content, "a");
});

test("move cells up and down and delete cells", () => {
  const cells = [cell("a"), { ...cell("b"), order: 1 }, { ...cell("c"), order: 2 }];
  assert.deepEqual(moveCell(cells, "b", -1).map((item) => item.id), ["b", "a", "c"]);
  assert.deepEqual(moveCell(cells, "b", 1).map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(deleteCell(cells, "b").map((item) => [item.id, item.order]), [["a", 0], ["c", 1]]);
});

test("copy as LaTeX writes the LaTeX result to the clipboard", async () => {
  let copied = "";
  const clipboard = { writeText: async (value) => { copied = value; } };
  const result = { exact: "sqrt(2)/2", latex: "\\frac{\\sqrt{2}}{2}" };
  await copyMathResult(clipboard, result);
  assert.equal(copied, "sqrt(2)/2");
  await copyMathResult(clipboard, result, "latex");
  assert.equal(copied, "\\frac{\\sqrt{2}}{2}");
});
