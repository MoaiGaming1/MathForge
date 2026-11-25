export function copyMathResult(clipboard, result, format = "exact") {
  return clipboard.writeText(format === "latex" ? result.latex : result.exact);
}
