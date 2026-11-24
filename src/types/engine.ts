export type EngineStatus = "checking" | "available" | "unavailable" | "preview";

export interface EngineResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

export interface HealthResult {
  status: "ok";
  version: string;
  capabilities: string[];
}

export interface SimplifyResult {
  exact: string;
  latex: string;
}
