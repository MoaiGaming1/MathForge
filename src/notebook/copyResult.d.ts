export interface CopyableMathResult {
  exact: string;
  latex: string;
}

export function copyMathResult(
  clipboard: Pick<Clipboard, "writeText">,
  result: CopyableMathResult,
  format?: "exact" | "latex",
): Promise<void>;
