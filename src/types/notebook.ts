export type CellType = "mathematics" | "text" | "markdown";

export interface NotebookCellResult {
  exact: string;
  latex: string;
  calculatedAt: string;
  approximate: boolean;
  warning: string | null;
}

export interface NotebookCell {
  id: string;
  order: number;
  cellType: CellType;
  content: string;
  result: NotebookCellResult | null;
  visualization: VisualizationSettings;
}

export type DisplayMode = "result" | "graph2d" | "complexPlane" | "graph3d";

export interface VisualizationSettings {
  mode: DisplayMode;
  result: { precision: number };
  graph2d: { xRange: [number, number]; yRange: [number, number]; samples: number; color: string };
  complexPlane: { realRange: [number, number]; imaginaryRange: [number, number]; precision: number; color: string };
  graph3d: { xRange: [number, number]; yRange: [number, number]; zRange: [number, number]; resolution: number; parameterRange: [number, number]; color: string; camera: { rotation: [number, number]; zoom: number; pan: [number, number] } };
}

export { defaultVisualizationSettings } from "../notebook/visualizationDefaults.js";

export interface NotebookSettings {
  autoCalculate: boolean;
  calculationDebounceMs: number;
}

export interface NotebookDocument {
  format: "mathforge";
  formatVersion: number;
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  settings: NotebookSettings;
  cells: NotebookCell[];
}

export interface NotebookSummary {
  id: string;
  title: string;
  folderId: string | null;
  fileLocation: string;
  createdAt: string;
  modifiedAt: string;
  lastOpenedAt: string | null;
  favorite: boolean;
  missing: boolean;
}

export interface NotebookFolder {
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
}

export interface RecoveryReport {
  recovered: string[];
  missing: string[];
  invalid: Array<{ file: string; message: string }>;
}

export interface LibrarySnapshot {
  notebooks: NotebookSummary[];
  folders: NotebookFolder[];
  recovery: RecoveryReport;
}

export interface SaveReceipt {
  revision: number;
  modifiedAt: string;
  stale: boolean;
}
