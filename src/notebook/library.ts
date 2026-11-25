import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  LibrarySnapshot,
  NotebookDocument,
  NotebookFolder,
  NotebookSummary,
  SaveReceipt,
} from "../types/notebook";

export const emptyLibrary: LibrarySnapshot = {
  notebooks: [],
  folders: [],
  recovery: { recovered: [], missing: [], invalid: [] },
};

function requireDesktop(): void {
  if (!isTauri()) throw new Error("Notebook storage is available in the MathForge desktop app.");
}

export async function readLibrary(query = ""): Promise<LibrarySnapshot> {
  requireDesktop();
  return invoke("library_snapshot", { query });
}

export async function createNotebook(title: string): Promise<NotebookDocument> {
  requireDesktop();
  return invoke("create_notebook", { title });
}

export async function openNotebook(id: string): Promise<NotebookDocument> {
  requireDesktop();
  return invoke("open_notebook", { id });
}

export async function saveNotebook(document: NotebookDocument, revision: number): Promise<SaveReceipt> {
  requireDesktop();
  return invoke("save_notebook", { document, revision });
}

export async function renameNotebook(id: string, title: string): Promise<NotebookSummary> {
  requireDesktop();
  return invoke("rename_notebook", { id, title });
}

export async function deleteNotebook(id: string): Promise<void> {
  requireDesktop();
  return invoke("delete_notebook", { id });
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  requireDesktop();
  return invoke("set_notebook_favorite", { id, favorite });
}

export async function createFolder(title: string): Promise<NotebookFolder> {
  requireDesktop();
  return invoke("create_folder", { title });
}

export async function renameFolder(id: string, title: string): Promise<void> {
  requireDesktop();
  return invoke("rename_folder", { id, title });
}

export async function deleteFolder(id: string): Promise<void> {
  requireDesktop();
  return invoke("delete_folder", { id });
}

export async function moveNotebook(id: string, folderId: string | null): Promise<void> {
  requireDesktop();
  return invoke("move_notebook", { id, folderId });
}

export async function importNotebook(): Promise<NotebookSummary | null> {
  requireDesktop();
  const selected = await open({
    multiple: false,
    filters: [{ name: "MathForge notebook", extensions: ["mathforge"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return invoke("import_notebook", { sourcePath: selected });
}

export async function chooseExportDestination(): Promise<string | null> {
  requireDesktop();
  return await save({
    defaultPath: "notebook.mathforge",
    filters: [{ name: "MathForge notebook", extensions: ["mathforge"] }],
  });
}

export async function exportNotebook(id: string, destination: string): Promise<string> {
  requireDesktop();
  return invoke("export_notebook", { id, destination });
}
