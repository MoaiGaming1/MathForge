import { createElement, memo, useDeferredValue, useMemo } from "react";
import { compileMath, type MathTree } from "./mathNotation.js";
import { parseMarkdown, type MarkdownNode } from "./markdown.js";

function renderMathTree(tree: MathTree | string, key: string | number): React.ReactNode {
  if (typeof tree === "string") return tree;
  const children = tree.children.map((child, index) => renderMathTree(child, `${key}.${index}`));
  return createElement(tree.tag, {
    key,
    ...(tree.tag === "math" ? { xmlns: "http://www.w3.org/1998/Math/MathML", display: "block" } : {}),
  }, ...children);
}

export const MathExpression = memo(function MathExpression({ source, display = false }: {
  source: string;
  display?: boolean;
}) {
  const tree = useMemo(() => compileMath(source), [source]);
  if (!tree) return <code className={display ? "math-fallback display" : "math-fallback"}>{source}</code>;
  return <span className={display ? "math-rendered display" : "math-rendered"} aria-label={`Mathematical expression: ${source}`}>
    {renderMathTree(tree, "math")}
  </span>;
});

function renderMarkdownNode(node: MarkdownNode, key: string | number): React.ReactNode {
  if (node.type === "text") return node.value;
  if (node.type === "math") return <MathExpression key={key} source={node.source} display={node.display} />;
  const children = node.children.map((child, index) => renderMarkdownNode(child, `${key}.${index}`));
  return createElement(node.tag, { key, ...node.props }, ...children);
}

export const MarkdownPreview = memo(function MarkdownPreview({ source }: { source: string }) {
  const deferredSource = useDeferredValue(source);
  const nodes = useMemo(() => parseMarkdown(deferredSource), [deferredSource]);
  return <div className="markdown-preview" aria-label="Rendered Markdown preview">
    {nodes.length ? nodes.map((node, index) => renderMarkdownNode(node, index)) : <p className="markdown-empty">Preview will appear here.</p>}
  </div>;
});
