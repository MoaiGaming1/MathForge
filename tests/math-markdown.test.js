import test from "node:test";
import assert from "node:assert/strict";
import { compileMath, expressionToLatex, latexToExpression, parseExpressionTree, sourceToMathLiveLatex } from "../src/notebook/mathNotation.js";
import { parseMarkdown } from "../src/notebook/markdown.js";

function collect(node, tag) {
  if (typeof node === "string" || !node) return [];
  return [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => collect(child, tag))];
}

function collectText(node) {
  if (typeof node === "string") return node;
  return (node.children ?? []).map(collectText).join("");
}

test("renders nested roots and source expressions into MathML", () => {
  const tree = compileMath("sqrt(nthroot((a+b)/(c+d), 3))");
  assert.ok(tree);
  assert.equal(collect(tree, "msqrt").length, 1);
  assert.equal(collect(tree, "mroot").length, 1);
  assert.equal(collect(tree, "mfrac").length, 1);
});

test("keeps division precedence and grouping in fractions", () => {
  const simple = compileMath("1/2*x");
  const grouped = compileMath("1/(2*x)");
  assert.equal(simple.children[0].tag, "mrow");
  assert.equal(simple.children[0].children[0].tag, "mfrac");
  assert.equal(grouped.children[0].tag, "mfrac");
  assert.ok(collect(grouped.children[0].children[1], "mrow").length > 0);
});

test("renders Greek symbols, subscripts, LaTeX fractions, and roots", () => {
  const tree = compileMath("\\frac{alpha_1}{2} + \\sqrt[3]{theta}");
  assert.ok(tree);
  const rendered = collectText(tree);
  assert.match(rendered, /α/);
  assert.match(rendered, /θ/);
  assert.equal(collect(tree, "mfrac").length, 1);
  assert.equal(collect(tree, "msub").length, 1);
  assert.equal(collect(tree, "mroot").length, 1);
  const greek = compileMath("pi + beta + gamma + infinity");
  assert.match(collectText(greek), /π/);
  assert.match(collectText(greek), /β/);
  assert.match(collectText(greek), /γ/);
  assert.match(collectText(greek), /∞/);
});

test("formats exact symbolic results without changing their source", () => {
  const exact = "sqrt(2)/2";
  const tree = compileMath(exact);
  assert.equal(collect(tree, "msqrt").length, 1);
  assert.equal(collect(tree, "mfrac").length, 1);
  assert.equal(exact, "sqrt(2)/2");
});

test("converts editable LaTeX to the restricted engine syntax and back", () => {
  const expressions = ["x^2", "(a+b)/(c+d)", "sqrt(x^2+1)", "nthroot(x+1,3)", "alpha_1+pi", "sin(theta)+log(x)", "x*y+2"];
  for (const source of expressions) {
    const latex = expressionToLatex(source);
    const converted = latexToExpression(latex);
    assert.ok(converted, `${latex} should convert`);
    assert.ok(compileMath(converted), `${converted} should remain renderable`);
  }
});

test("accepts fractions and roots but rejects unsupported LaTeX commands", () => {
  assert.equal(latexToExpression("\\frac{x+1}{2}"), "((x+1)/(2))");
  assert.equal(latexToExpression("\\sqrt[3]{x}"), "nthroot(x,3)");
  assert.equal(latexToExpression("\\href{https://example.com}{x}"), null);
  assert.equal(latexToExpression("\\placeholder{}"), null);
});

test("normalizes MathLive determinant delimiters and inverse trigonometric commands", () => {
  const determinant = "\\det\\left(\\left\\lbrack5,5;5,5\\right\\rbrack\\right)";
  assert.equal(latexToExpression(determinant), "det([5,5;5,5])");
  assert.ok(compileMath(determinant));
  assert.equal(latexToExpression("\\arcsin\\left(1\\right)"), "asin(1)");
  assert.equal(latexToExpression("\\arccos\\left(0\\right)+\\arctan\\left(1\\right)"), "acos(0)+atan(1)");
  assert.match(expressionToLatex("asin(1)+delta"), /\\arcsin/);
});

test("validates and renders restricted piecewise conditions and multiple arguments", () => {
  const expression = "piecewise(-x,x<0,x,x>=0,0)";
  assert.ok(parseExpressionTree(expression));
  assert.ok(compileMath(expression));
  assert.ok(compileMath("combine(a,b,c)"));
});

test("parses and renders row, column, and rectangular matrices from MathLive", () => {
  assert.equal(latexToExpression("[1,2;3,4]"), "[1,2;3,4]");
  assert.equal(latexToExpression("\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}"), "[1,2;3,4]");
  assert.equal(latexToExpression("\\left[\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}\\right]"), "[1,2;3,4]");
  assert.match(expressionToLatex("[1,2,3;4,5,6]"), /\\begin\{bmatrix\}1 & 2 & 3 \\\\ 4 & 5 & 6\\end\{bmatrix\}/);
  assert.ok(compileMath("[1,2;3,4]"));
  assert.equal(parseExpressionTree("3x+2(x+1)").type, "binary");
  assert.equal(expressionToLatex("f(x,y)"), "f\\left(x,y\\right)");
  assert.equal(expressionToLatex("[1,2;3,4]^T"), "\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}^{T}");
  assert.equal(latexToExpression(expressionToLatex("[1,2;3,4]^T")), "[1,2;3,4]^(T)");
  assert.ok(compileMath("\\left[\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}\\right]"));
  assert.equal(latexToExpression("A_{2,1}"), "A[2,1]");
  assert.equal(expressionToLatex("A[2,1]"), "A[2,1]");
  assert.ok(compileMath("A[2,1]"));
});

test("restores definitions as editable MathLive source instead of blanking them", () => {
  assert.equal(sourceToMathLiveLatex("x = 5"), "x=5");
  assert.equal(sourceToMathLiveLatex("f(x,y)=x^2+3y"), "f\\left(x,y\\right)=x^{2}+3\\cdot y");
  assert.equal(sourceToMathLiveLatex("A=[1,2;3,4]"), "A=\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}");
  assert.ok(compileMath("x=5"));
  assert.ok(compileMath("f(x,y)=x+y"));
  assert.equal(sourceToMathLiveLatex("x^2+1"), "x^{2}+1");
});

test("renders requested Markdown blocks and inline formatting", () => {
  const nodes = parseMarkdown([
    "# Heading",
    "**bold** *italic* ~~removed~~ and `code`",
    "- one",
    "- two",
    "1. first",
    "2. second",
    "> quoted",
    "| A | B |",
    "| --- | --- |",
    "| x | y |",
    "---",
    "```js",
    "const x = 1;",
    "```",
    "Link [site](https://example.com) and $x^2$.",
    "$$",
    "\\frac{1}{2}",
    "$$",
  ].join("\n"));
  const tags = nodes.filter((node) => node.type === "element").map((node) => node.tag);
  assert.deepEqual(tags, ["h1", "p", "ul", "ol", "blockquote", "table", "hr", "pre", "p"]);
  assert.ok(collectMarkdown(nodes, "strong"));
  assert.ok(collectMarkdown(nodes, "em"));
  assert.ok(collectMarkdown(nodes, "del"));
  assert.ok(collectMarkdown(nodes, "code"));
  assert.ok(collectMarkdown(nodes, "a"));
  const math = nodes.flatMap((node) => flatten(node)).filter((node) => node.type === "math");
  assert.deepEqual(math.map((item) => item.display), [false, true]);
  assert.equal(math[1].source, "\\frac{1}{2}");
});

test("keeps raw HTML inert and rejects unsafe link protocols", () => {
  const nodes = parseMarkdown("<script>alert(1)</script> [unsafe](javascript:alert(1))");
  assert.equal(collectMarkdown(nodes, "script"), false);
  assert.equal(collectMarkdown(nodes, "a"), false);
  assert.match(JSON.stringify(nodes), /<script>/);
});

function flatten(node) {
  if (!node || typeof node === "string") return [];
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

function collectMarkdown(nodes, tag) {
  return nodes.some((node) => flatten(node).some((child) => child.type === "element" && child.tag === tag));
}
