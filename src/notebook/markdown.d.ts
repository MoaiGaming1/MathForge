export interface MarkdownTextNode {
  type: "text";
  value: string;
}

export interface MarkdownElementNode {
  type: "element";
  tag: string;
  children: MarkdownNode[];
  props: Record<string, string>;
}

export interface MarkdownMathNode {
  type: "math";
  source: string;
  display: boolean;
}

export type MarkdownNode = MarkdownTextNode | MarkdownElementNode | MarkdownMathNode;
export function parseMarkdown(source: string): MarkdownNode[];
