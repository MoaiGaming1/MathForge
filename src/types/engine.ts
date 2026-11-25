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
  approximate?: boolean;
  warning?: string | null;
}

export type VisualizationResult = {
  kind: "graph2d" | "complexPlane" | "surface3d" | "implicit3d" | "vector3d" | "field3d" | "curve3d";
  approximate: true;
  warning: string;
  series?: Array<{ kind: "function" | "implicit"; label: string; points?: Array<[number, number | null]>; x?: number[]; y?: number[]; values?: Array<Array<number | null>> }>;
  points?: Array<{ exact: string; real: number; imaginary: number; visible: boolean }>;
  x?: number[];
  y?: number[];
  z?: Array<Array<number | null>> | number[];
  values?: Array<Array<Array<number | null>>>;
  vectors?: number[][];
  exactVectors?: string[][];
  curve?: Array<Array<number | null>>;
  solutionSetComplete?: boolean;
};
