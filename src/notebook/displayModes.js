import { defaultVisualizationSettings } from "./visualizationDefaults.js";
import { latexToExpression } from "./mathNotation.js";

export function switchDisplayMode(settings, mode) {
  return { ...settings, mode };
}

export function updateDisplaySettings(settings, mode, patch) {
  return { ...settings, [mode]: { ...settings[mode], ...patch } };
}

export function visualizationForCell(cell) {
  return cell.visualization ?? structuredClone(defaultVisualizationSettings);
}

function splitNotebookSource(source) {
  const lines = [];
  let line = "";
  let squareDepth = 0;
  let parenDepth = 0;
  for (const char of source) {
    if ((char === "\n" || char === ";") && squareDepth === 0 && parenDepth === 0) {
      if (line.trim()) lines.push(line.trim());
      line = "";
      continue;
    }
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    line += char;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function topLevelEquals(source) {
  let parentheses = 0, square = 0, braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parentheses += 1;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "=" && !parentheses && !square && !braces
      && !"<>!=".includes(source[index - 1] ?? "") && source[index + 1] !== "=") return index;
  }
  return -1;
}

export function notebookSuggestions(context) {
  const values = new Set(["pi", "E", "i", "infinity", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "arcsin", "arccos", "arctan", "exp", "log", "nthroot", "det", "transpose", "inverse", "trace", "dot", "cross", "norm", "normalize", "entry"]);
  for (const source of context) {
    for (const match of source.matchAll(/^\s*([A-Za-z_]\w*)\s*(?:\(\s*[^)]*\s*\))?\s*=/gm)) values.add(match[1]);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

function definitionParts(source) {
  const equals = topLevelEquals(source);
  if (equals < 0 || topLevelEquals(source.slice(equals + 1)) >= 0) return null;
  const left = source.slice(0, equals).trim();
  const fn = /^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)$/.exec(left);
  if (fn) return { name: fn[1], parameters: fn[2].split(",").map((item) => item.trim()), body: source.slice(equals + 1) };
  if (/^[A-Za-z_]\w*$/.test(left)) return { name: left, parameters: [], body: source.slice(equals + 1) };
  return null;
}

function statements(context) {
  const result = [];
  for (const source of context) {
    let current = "";
    let squareDepth = 0;
    let parenDepth = 0;
    for (const char of source) {
      if (char === "[") squareDepth += 1;
      else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
      else if (char === "(") parenDepth += 1;
      else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
      if (char === "\n" || (char === ";" && squareDepth === 0 && parenDepth === 0)) {
        if (current.trim()) result.push(current.trim());
        current = "";
      } else current += char;
    }
    if (current.trim()) result.push(current.trim());
  }
  return result;
}

function referencedNames(source) {
  return new Set(source.match(/[A-Za-z_]\w*/g) ?? []);
}

export function relevantNotebookContext(expression, context) {
  const target = definitionParts(engineSource(expression));
  const roots = target ? target.body : engineSource(expression);
  const needed = referencedNames(roots);
  if (target) for (const parameter of target.parameters) needed.delete(parameter);
  const sources = statements(context);
  const included = new Set();
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    const definition = definitionParts(source);
    if (!definition || !needed.has(definition.name)) continue;
    included.add(index);
    needed.delete(definition.name);
    for (const name of referencedNames(definition.body)) {
      if (!definition.parameters.includes(name)) needed.add(name);
    }
  }
  return sources.filter((_, index) => included.has(index));
}

export function visualizationSource(source, mode) {
  const lines = splitNotebookSource(source);
  const converted = lines.map((line) => {
    const equals = topLevelEquals(line);
    const cleaned = line.trim();
    const normalizeSide = (side) => {
      const value = mode === "complexPlane" ? side.replace(/([0-9.)])\s*(?=i\b)/g, "$1*")
        : mode === "graph3d" ? side.replace(/([0-9.)])\s*(?=[ijk]\b)/g, "$1*") : side;
      const direct = latexToExpression(value);
      if (direct !== null) return direct;
      if (mode === "graph3d") return latexToExpression(value.replace(/([0-9.)])\s*([ijk])\b/g, "$1*$2"));
      return null;
    };
    if (equals < 0) return normalizeSide(cleaned);
    if (topLevelEquals(cleaned.slice(equals + 1)) >= 0) return null;
    const left = cleaned.slice(0, equals), right = cleaned.slice(equals + 1);
    const functionLeft = mode === "graph3d" && /^[A-Za-z_]\w*\s*\(\s*(?:x\s*,\s*y\s*,\s*z|t)\s*\)$/.test(left.trim());
    const lhs = functionLeft ? left.trim().replace(/\s+/g, "") : normalizeSide(left.trim());
    const rhs = normalizeSide(right.trim());
    return lhs === null || rhs === null ? null : lhs + "=" + rhs;
  });
  return converted.length > 0 && converted.every((line) => line !== null) ? converted.join("\n") : source;
}

export function engineSource(source, mode) {
  const lines = splitNotebookSource(source);
  const converted = lines.map((line) => {
    const cleaned = line.trim();
    const normalizeSide = (side) => {
      let value = side.trim();
      if (mode === "complexPlane") value = value.replace(/([0-9.)])\s*(?=i\b)/g, "$1*");
      return latexToExpression(value);
    };
    const equals = topLevelEquals(cleaned);
    if (equals < 0) return normalizeSide(cleaned);
    if (topLevelEquals(cleaned.slice(equals + 1)) >= 0) return null;
    const left = cleaned.slice(0, equals).trim();
    const normalizedLeft = normalizeSide(left);
    const right = normalizeSide(cleaned.slice(equals + 1));
    const variable = normalizedLeft !== null && /^[A-Za-z_]\w*$/.test(normalizedLeft);
    const fn = normalizedLeft === null ? null : /^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*\)$/.exec(normalizedLeft);
    const lhs = variable ? normalizedLeft : fn ? `${fn[1]}(${fn[2].split(",").map((arg) => arg.trim()).join(",")})` : null;
    return lhs && right !== null ? `${lhs}=${right}` : null;
  });
  return converted.length && converted.every((line) => line !== null) ? converted.join("\n") : source;
}

export function isCompleteEngineSource(source) {
  const normalized = engineSource(source);
  return normalized.split(/[\n;]+/).every((line) => {
    const equals = topLevelEquals(line);
    if (equals < 0) return latexToExpression(line) !== null || /^[\w.+*/^() -]+$/.test(line);
    if (topLevelEquals(line.slice(equals + 1)) >= 0) return false;
    const left = line.slice(0, equals).trim();
    const validLeft = /^[A-Za-z_]\w*$/.test(left) || /^[A-Za-z_]\w*\s*\(\s*[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*\)$/.test(left);
    const right = line.slice(equals + 1).trim();
    return validLeft && (latexToExpression(right) !== null || /^[\w.+*/^() -]+$/.test(right));
  });
}

export function calculationKey(cell, context = []) {
  const visualization = visualizationForCell(cell);
  const settings = visualization.mode === "graph2d" ? (({ xRange, yRange, samples }) => ({ xRange, yRange, samples }))(visualization.graph2d)
    : visualization.mode === "complexPlane" ? (({ realRange, imaginaryRange, precision }) => ({ realRange, imaginaryRange, precision }))(visualization.complexPlane)
      : visualization.mode === "graph3d" ? (({ xRange, yRange, zRange, resolution, parameterRange }) => ({ xRange, yRange, zRange, resolution, parameterRange }))(visualization.graph3d)
        : visualization.result;
  return JSON.stringify([visualization.mode, cell.content, relevantNotebookContext(cell.content, context), settings]);
}
