import test from "node:test";
import assert from "node:assert/strict";
import { calculationKey, engineSource, isCompleteEngineSource, notebookSuggestions, relevantNotebookContext, switchDisplayMode, updateDisplaySettings, visualizationSource } from "../src/notebook/displayModes.js";
import { defaultVisualizationSettings } from "../src/notebook/visualizationDefaults.js";
import { equalUnitRanges, panRanges, zoomRangesAt } from "../src/notebook/visualizationInteractions.js";

test("each expression keeps separate settings as its display mode changes", () => {
  const original = structuredClone(defaultVisualizationSettings);
  const graph = updateDisplaySettings(switchDisplayMode(original, "graph2d"), "graph2d", { xRange: [-3, 7], color: "#dd8866" });
  const complex = updateDisplaySettings(switchDisplayMode(graph, "complexPlane"), "complexPlane", { realRange: [-4, 4] });
  const restored = switchDisplayMode(complex, "graph2d");
  assert.equal(restored.mode, "graph2d");
  assert.deepEqual(restored.graph2d.xRange, [-3, 7]);
  assert.equal(restored.graph2d.color, "#dd8866");
  assert.deepEqual(restored.complexPlane.realRange, [-4, 4]);
  assert.deepEqual(original.graph2d.xRange, [-10, 10]);
});

test("visualization conversion handles MathLive equations without changing source storage", () => {
  const source = "y=\\frac{x^2}{2}";
  assert.equal(visualizationSource(source), "y=((x^2)/(2))");
  assert.equal(source, "y=\\frac{x^2}{2}");
  assert.equal(visualizationSource("x^2+y^2=4"), "x^2+y^2=4");
  assert.equal(visualizationSource("x^2; sin(x)"), "x^2\nsin(x)");
  assert.equal(visualizationSource("3i+2j-k", "graph3d"), "3*i+2*j-k");
  assert.equal(visualizationSource("r(t)=cos(t)*i+sin(t)*j+t*k", "graph3d"), "r(t)=cos(t)*i+sin(t)*j+t*k");
  assert.equal(visualizationSource("1+2i", "complexPlane"), "1+2*i");
});

test("MathLive assignment and function definitions are normalized for the engine", () => {
  assert.equal(engineSource("x = 5"), "x=5");
  assert.equal(engineSource("f\\left(x\\right)=\\sin\\left(x\\right)"), "f(x)=sin(x)");
  assert.equal(engineSource("g\\left(x,y\\right)=x^2+3y"), "g(x,y)=x^2+3y");
  assert.equal(engineSource("A=\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}"), "A=[1,2;3,4]");
  assert.equal(engineSource("5\\cdot \\cos\\left(x\\cdot \\frac{\\pi}{180}\\right)+i\\cdot 5\\cdot \\sin\\left(x\\cdot \\frac{\\pi}{180}\\right)", "complexPlane"), "5* cos(x* ((pi)/(180)))+i* 5* sin(x* ((pi)/(180)))");
  assert.equal(engineSource("\\det\\left(\\left\\lbrack5,5;5,5\\right\\rbrack\\right)"), "det([5,5;5,5])");
  assert.equal(engineSource("\\arcsin\\left(1\\right)"), "asin(1)");
  assert.equal(isCompleteEngineSource("x=5"), true);
  assert.equal(isCompleteEngineSource("x="), false);
});

test("calculation cache keys change when notebook definitions change or disappear", () => {
  const cell = { id: "b", order: 1, cellType: "mathematics", content: "a+b", result: null, visualization: structuredClone(defaultVisualizationSettings) };
  assert.notEqual(calculationKey(cell, ["a=5", "b=3"]), calculationKey(cell, ["a=6", "b=3"]));
  assert.notEqual(calculationKey(cell, ["a=5", "b=3"]), calculationKey(cell, ["b=3"]));
  assert.equal(calculationKey(cell, ["a=5", "b=3", "unused=9"]), calculationKey(cell, ["a=5", "b=3"]));
});

test("calculation context follows transitive dependencies and excludes unrelated definitions", () => {
  assert.deepEqual(relevantNotebookContext("g(3)", ["a=2", "f(x)=a*x", "unused=9", "g(x)=f(x)+1"]), ["a=2", "f(x)=a*x", "g(x)=f(x)+1"]);
  assert.deepEqual(relevantNotebookContext("x+1", ["unused=9", "x=4", "other=8"]), ["x=4"]);
});

test("autocomplete suggestions include the current notebook environment and math operations", () => {
  const suggestions = notebookSuggestions(["a=3", "f(x,y)=x+y", "A=[1,2;3,4]"]);
  for (const value of ["a", "f", "A", "sin", "det", "cross", "normalize"]) assert.ok(suggestions.includes(value));
});

test("camera and color changes reuse samples while range changes resample", () => {
  const cell = { id: "a", order: 0, cellType: "mathematics", content: "x^2", result: null, visualization: structuredClone(defaultVisualizationSettings) };
  cell.visualization.mode = "graph3d";
  const before = calculationKey(cell);
  cell.visualization.graph3d.color = "#ff8866";
  cell.visualization.graph3d.camera.rotation[0] += 1;
  assert.equal(calculationKey(cell), before);
  cell.visualization.graph3d.xRange = [-5, 5];
  assert.notEqual(calculationKey(cell), before);
});

test("Cartesian and complex views preserve equal unit scale and zoom around the pointer", () => {
  const fit = equalUnitRanges([-10, 10], [-10, 10], 724, 234);
  assert.ok(Math.abs((fit.x[1] - fit.x[0]) / 724 - (fit.y[1] - fit.y[0]) / 234) < 1e-12);
  const anchor = [fit.x[0] + 0.25 * (fit.x[1] - fit.x[0]), fit.y[1] - 0.7 * (fit.y[1] - fit.y[0])];
  const zoomed = zoomRangesAt([-10, 10], [-10, 10], 0.25, 0.7, 0.5, 724, 234);
  assert.ok(Math.abs(zoomed.x[0] + 0.25 * (zoomed.x[1] - zoomed.x[0]) - anchor[0]) < 1e-12);
  assert.ok(Math.abs(zoomed.y[1] - 0.7 * (zoomed.y[1] - zoomed.y[0]) - anchor[1]) < 1e-12);
  const panned = panRanges([-10, 10], [-10, 10], 30, 20, 724, 234);
  assert.ok(panned.x[0] < fit.x[0]);
  assert.ok(panned.y[0] > fit.y[0]);
});
