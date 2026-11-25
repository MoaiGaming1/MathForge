import type { NotebookCell } from "../types/notebook";

export function duplicateCell(cells: NotebookCell[], cellId: string, makeId: () => string): NotebookCell[];
export function moveCell(cells: NotebookCell[], cellId: string, direction: -1 | 1): NotebookCell[];
export function deleteCell(cells: NotebookCell[], cellId: string): NotebookCell[];
