import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EngineResponse, HealthResult, SimplifyResult, VisualizationResult } from "../types/engine";

export async function checkEngine(): Promise<HealthResult | null> {
  if (!isTauri()) return null;
  const response = await invoke<EngineResponse<HealthResult>>("engine_health");
  if (!response.ok || !response.result) throw new Error(response.error?.message ?? "Engine health check failed.");
  return response.result;
}

export async function simplify(expression: string, context: string[] = []): Promise<SimplifyResult> {
  const response = await invoke<EngineResponse<SimplifyResult>>("engine_simplify", { expression, context });
  if (!response.ok || !response.result) throw new Error(response.error?.message ?? "Calculation failed.");
  return response.result;
}

export async function visualize(operation: "visualize.graph2d" | "visualize.complexPlane" | "visualize.graph3d", expression: string, options: Record<string, unknown>, context: string[] = []): Promise<VisualizationResult> {
  const response = await invoke<EngineResponse<VisualizationResult>>("engine_visualize", { operation, expression, options, context });
  if (!response.ok || !response.result) throw new Error(response.error?.message ?? "Visualization failed.");
  return response.result;
}

export type { VisualizationResult };
