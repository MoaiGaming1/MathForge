import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EngineResponse, HealthResult, SimplifyResult } from "../types/engine";

export async function checkEngine(): Promise<HealthResult | null> {
  if (!isTauri()) return null;
  const response = await invoke<EngineResponse<HealthResult>>("engine_health");
  if (!response.ok || !response.result) throw new Error(response.error?.message ?? "Engine health check failed.");
  return response.result;
}

export async function simplify(expression: string): Promise<SimplifyResult> {
  const response = await invoke<EngineResponse<SimplifyResult>>("engine_simplify", { expression });
  if (!response.ok || !response.result) throw new Error(response.error?.message ?? "Calculation failed.");
  return response.result;
}
