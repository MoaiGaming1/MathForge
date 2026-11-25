export interface MathTree {
  tag: string;
  children: Array<MathTree | string>;
}

export function compileMath(source: string): MathTree | null;
export function parseExpressionTree(source: string): unknown | null;
export function latexToExpression(latex: string): string | null;
export function expressionToLatex(source: string): string;
export function sourceToMathLiveLatex(source: string): string;
