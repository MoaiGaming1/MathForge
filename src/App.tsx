import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkEngine, simplify, visualize as runVisualization } from "./notebook/engine";
import { exportLatest } from "./notebook/exportFlow.js";
import { MathExpression, MarkdownPreview } from "./notebook/RenderedContent";
import { MathInput } from "./notebook/MathInput";
import { SharedVisualizationDashboard, sharedPlotColor, VisualizationPanel } from "./notebook/VisualizationPanel";
import { calculationKey, engineSource, notebookSuggestions, relevantNotebookContext, switchDisplayMode, updateDisplaySettings, visualizationForCell, visualizationSource } from "./notebook/displayModes.js";
import { deleteCell as deleteCellOperation, duplicateCell as duplicateCellOperation, moveCell as moveCellOperation } from "./notebook/cellEditing.js";
import { copyMathResult } from "./notebook/copyResult.js";
import { DocumentHistory } from "./notebook/editorHistory.js";
import {
  createFolder,
  createNotebook,
  chooseExportDestination,
  deleteFolder,
  deleteNotebook,
  emptyLibrary,
  exportNotebook,
  importNotebook,
  moveNotebook,
  openNotebook,
  readLibrary,
  renameFolder,
  renameNotebook,
  saveNotebook,
  setFavorite,
} from "./notebook/library";
import type { EngineStatus, HealthResult, VisualizationResult } from "./types/engine";
import type {
  CellType,
  LibrarySnapshot,
  NotebookCell,
  NotebookDocument,
  NotebookFolder,
  NotebookSummary,
  DisplayMode,
} from "./types/notebook";
import { defaultVisualizationSettings } from "./types/notebook";

type LibraryView = "recent" | "favorites" | "all" | { folderId: string };
type SaveState = "saved" | "unsaved" | "saving" | "error";
type ModalState =
  | { kind: "title"; action: "create-notebook" | "create-folder" | "rename-folder" | "rename-notebook"; id?: string; initial: string }
  | { kind: "delete-notebook"; id: string; title: string }
  | { kind: "delete-folder"; id: string; title: string; count: number }
  | null;

const defaultTitle = "Untitled notebook";

function notebookContext(cells: NotebookCell[], beforeIndex: number): string[] {
  return cells.slice(0, beforeIndex)
    .filter((prior) => prior.cellType === "mathematics" && prior.content.trim())
    .map((prior) => engineSource(prior.content));
}

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not opened yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export default function App() {
  const [library, setLibrary] = useState<LibrarySnapshot>(emptyLibrary);
  const [view, setView] = useState<LibraryView>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"modified" | "title" | "opened">("modified");
  const [active, setActive] = useState<NotebookDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("checking");
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [calculatingContent, setCalculatingContent] = useState<Record<string, string>>({});
  const [visualizationResults, setVisualizationResults] = useState<Record<string, { key: string; result: VisualizationResult }>>({});
  const [modal, setModal] = useState<ModalState>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const revisionRef = useRef(0);
  const savedRevisions = useRef(new Map<string, number>());
  const activeRef = useRef<NotebookDocument | null>(null);
  const closeFlow = useRef(false);
  const scheduledCalculations = useRef(new Map<string, string>());
  const history = useRef(new DocumentHistory<NotebookDocument>());
  const focusRequest = useRef<{ id: string; end: boolean } | null>(null);

  activeRef.current = active;

  const refreshLibrary = useCallback(async (search = query) => {
    if (!isTauri()) return;
    try {
      const next = await readLibrary(search);
      setLibrary(next);
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not load the notebook library.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!isTauri()) {
      setEngineStatus("preview");
      setLoading(false);
      return;
    }
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    checkEngine()
      .then((value) => {
        setHealth(value);
        setEngineStatus(value ? "available" : "preview");
      })
      .catch(() => setEngineStatus("unavailable"));
  }, []);

  const persistSnapshot = useCallback(async (document: NotebookDocument, revision: number) => {
    setSaveState("saving");
    const receipt = await saveNotebook(document, revision);
    const lastSavedRevision = savedRevisions.current.get(document.id) ?? 0;
    if (receipt.stale || revision < lastSavedRevision) return false;
    savedRevisions.current.set(document.id, revision);
    if (activeRef.current?.id === document.id) {
      setActive((current) => current?.id === document.id ? { ...current, modifiedAt: receipt.modifiedAt } : current);
    }
    setSaveState(revision < revisionRef.current ? "unsaved" : "saved");
    return true;
  }, []);

  const flushActiveSave = useCallback(async () => {
    while (activeRef.current) {
      const document = activeRef.current;
      const revision = revisionRef.current;
      if (revision <= (savedRevisions.current.get(document.id) ?? 0)) return true;
      if (!await persistSnapshot(document, revision)) return false;
    }
    return true;
  }, [persistSnapshot]);

  const editDocument = useCallback((change: (current: NotebookDocument) => NotebookDocument, recordHistory = true) => {
    const current = activeRef.current;
    if (!current) return;
    if (recordHistory) {
      history.current.record(current);
    }
    revisionRef.current += 1;
    const next = change(current);
    activeRef.current = next;
    setSaveState("unsaved");
    setActive(next);
  }, []);

  const undo = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const previous = history.current.undo(current);
    if (!previous) return;
    revisionRef.current += 1;
    activeRef.current = previous;
    setActive(previous);
    setSaveState("unsaved");
  }, []);

  const redo = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const next = history.current.redo(current);
    if (!next) return;
    revisionRef.current += 1;
    activeRef.current = next;
    setActive(next);
    setSaveState("unsaved");
  }, []);

  useEffect(() => {
    const request = focusRequest.current;
    if (!request || !active?.cells.some((cell) => cell.id === request.id)) return;
    const frame = window.requestAnimationFrame(() => {
      const input = document.getElementById(`cell-${request.id}`) as (HTMLElement & { value?: string; setSelectionRange?: (start: number, end: number) => void }) | null;
      input?.focus();
      if (request.end && input?.value !== undefined) input.setSelectionRange?.(input.value.length, input.value.length);
      focusRequest.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.cells]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "s") {
        event.preventDefault();
        void flushActiveSave().catch((cause: unknown) => {
          setSaveState("error");
          setActionError(cause instanceof Error ? cause.message : "Notebook could not be saved.");
        });
      } else if (key === "d") {
        const cellId = (event.target as HTMLElement).closest<HTMLElement>("[data-cell-id]")?.dataset.cellId;
        if (cellId) {
          event.preventDefault();
          duplicateCell(cellId);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo, flushActiveSave]);

  useEffect(() => {
    if (!active || !isTauri() || revisionRef.current <= (savedRevisions.current.get(active.id) ?? 0)) return;
    const document = active;
    const revision = revisionRef.current;
    const timer = window.setTimeout(() => {
      persistSnapshot(document, revision)
        .then((saved) => { if (saved) void refreshLibrary(); })
        .catch((cause: unknown) => {
          if (revisionRef.current !== revision) return;
          setSaveState("error");
          setActionError(cause instanceof Error ? cause.message : "Notebook could not be saved.");
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [active, persistSnapshot, refreshLibrary]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) {
      void getCurrentWindow().onCloseRequested(async (event) => {
        const document = activeRef.current;
        const revision = revisionRef.current;
        if (!document || revision <= (savedRevisions.current.get(document.id) ?? 0)) return;
        event.preventDefault();
        if (closeFlow.current) return;
        closeFlow.current = true;
        try {
          if (!await flushActiveSave()) throw new Error("A newer notebook edit is still waiting to be saved.");
          await getCurrentWindow().close();
        } catch (cause) {
          setSaveState("error");
          setActionError(cause instanceof Error ? cause.message : "Save the notebook before closing MathForge.");
          closeFlow.current = false;
        }
      }).then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      });
    }
    return () => { disposed = true; unlisten?.(); };
  }, [flushActiveSave]);

  useEffect(() => {
    if (!active || engineStatus !== "available" || !active.settings.autoCalculate) return;
    const notebookId = active.id;
    const timers: number[] = [];
    for (const [cellIndex, cell] of active.cells.entries()) {
      if (cell.cellType !== "mathematics" || !cell.content.trim()) continue;
      const key = `${notebookId}:${cell.id}`;
      const context = notebookContext(active.cells, cellIndex);
      const content = cell.content;
      const calculationContext = relevantNotebookContext(content, context);
      const visualization = visualizationForCell(cell);
      const calcKey = calculationKey(cell, context);
      if (scheduledCalculations.current.get(key) === calcKey) continue;
      scheduledCalculations.current.set(key, calcKey);
      const timer = window.setTimeout(() => {
        setCalculatingContent((current) => ({ ...current, [cell.id]: calcKey }));
        const promise = visualization.mode === "result"
          ? simplify(engineSource(content), calculationContext).then((result) => ({ kind: "result" as const, result }))
          : runVisualization(
            visualization.mode === "graph2d" ? "visualize.graph2d" : visualization.mode === "complexPlane" ? "visualize.complexPlane" : "visualize.graph3d",
            visualizationSource(content, visualization.mode),
            visualization.mode === "graph2d" ? visualization.graph2d
              : visualization.mode === "complexPlane" ? visualization.complexPlane
                : visualization.graph3d,
            calculationContext,
          ).then((result) => ({ kind: "visualization" as const, result }));
        promise.then((computed) => {
          const current = activeRef.current;
          const latestCell = current?.id === notebookId ? current.cells.find((item) => item.id === cell.id) : undefined;
          const latestIndex = current?.cells.findIndex((item) => item.id === cell.id) ?? -1;
          const latestContext = current?.id === notebookId && latestIndex >= 0 ? notebookContext(current.cells, latestIndex) : [];
          if (!current || !latestCell || calculationKey(latestCell, latestContext) !== calcKey) return;
          setCellErrors((errors) => { const next = { ...errors }; delete next[cell.id]; return next; });
          if (computed.kind === "result") {
            editDocument((document) => ({ ...document, cells: document.cells.map((item) => item.id === cell.id
              ? { ...item, result: { exact: computed.result.exact, latex: computed.result.latex, calculatedAt: new Date().toISOString(), approximate: computed.result.approximate ?? false, warning: computed.result.warning ?? null } } : item) }), false);
          } else {
            setVisualizationResults((currentResults) => ({ ...currentResults, [cell.id]: { key: calcKey, result: computed.result } }));
          }
        }).catch((cause: unknown) => {
          const current = activeRef.current;
          const latestCell = current?.id === notebookId ? current.cells.find((item) => item.id === cell.id) : undefined;
          const latestIndex = current?.cells.findIndex((item) => item.id === cell.id) ?? -1;
          const latestContext = current?.id === notebookId && latestIndex >= 0 ? notebookContext(current.cells, latestIndex) : [];
          if (!latestCell || calculationKey(latestCell, latestContext) !== calcKey) return;
          setCellErrors((errors) => ({ ...errors, [cell.id]: cause instanceof Error ? cause.message : "Calculation failed." }));
        }).finally(() => setCalculatingContent((current) => {
          if (current[cell.id] !== calcKey) return current;
          const next = { ...current };
          delete next[cell.id];
          return next;
        }));
      }, active.settings.calculationDebounceMs);
      timers.push(timer);
    }
    return () => timers.forEach(window.clearTimeout);
  }, [active, engineStatus, editDocument]);

  const visibleNotebooks = useMemo(() => {
    let rows = library.notebooks;
    if (view === "recent") rows = rows.filter((notebook) => notebook.lastOpenedAt !== null);
    else if (view === "favorites") rows = rows.filter((notebook) => notebook.favorite);
    else if (typeof view === "object") rows = rows.filter((notebook) => notebook.folderId === view.folderId);
    return [...rows].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      const aDate = sortBy === "opened" ? a.lastOpenedAt ?? "" : a.modifiedAt;
      const bDate = sortBy === "opened" ? b.lastOpenedAt ?? "" : b.modifiedAt;
      return bDate.localeCompare(aDate);
    });
  }, [library.notebooks, sortBy, view]);

  const currentHeading = typeof view === "object"
    ? library.folders.find((folder) => folder.id === view.folderId)?.title ?? "Folder"
    : view === "recent" ? "Recent notebooks" : view === "favorites" ? "Favorites" : "All notebooks";

  async function handleOpenNotebook(notebook: NotebookSummary): Promise<void> {
    if (notebook.missing) {
      setActionError(`The notebook file for “${notebook.title}” is missing. Its library record was kept for recovery.`);
      return;
    }
    try {
      const document = await openNotebook(notebook.id);
      revisionRef.current = savedRevisions.current.get(document.id) ?? 0;
      savedRevisions.current.set(document.id, revisionRef.current);
      history.current.clear();
      activeRef.current = document;
      setCalculatingContent({});
      setVisualizationResults({});
      for (const cell of document.cells) scheduledCalculations.current.delete(`${document.id}:${cell.id}`);
      setActive(document);
      setCellErrors({});
      setSaveState("saved");
      await refreshLibrary();
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not open notebook.");
    }
  }

  async function leaveNotebook(): Promise<void> {
    try {
      if (!await flushActiveSave()) return;
    } catch (cause) {
      setSaveState("error");
      setActionError(cause instanceof Error ? cause.message : "Save the notebook before returning to the library.");
      return;
    }
    setActive(null);
    activeRef.current = null;
    history.current.clear();
    setActionError(null);
    await refreshLibrary();
  }

  async function runImport(): Promise<void> {
    try {
      const imported = await importNotebook();
      if (imported) {
        await refreshLibrary();
        setActionError(null);
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not import that notebook file.");
    }
  }

  async function runExport(id: string): Promise<void> {
    try {
      const destination = await chooseExportDestination();
      if (!destination) return;
      await exportLatest(id, activeRef.current?.id, destination, async () => {
        try {
          const saved = await flushActiveSave();
          if (!saved) setSaveState("error");
          return saved;
        } catch (cause) {
          setSaveState("error");
          throw cause;
        }
      }, exportNotebook);
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not export that notebook.");
    }
  }

  async function confirmModal(): Promise<void> {
    if (!modal) return;
    setModalBusy(true);
    try {
      if (modal.kind === "title") {
        const title = modalTitle.trim();
        if (!title) throw new Error("Enter a title to continue.");
        if (modal.action === "create-notebook") {
          const document = await createNotebook(title);
          revisionRef.current = 0;
          savedRevisions.current.set(document.id, 0);
          history.current.clear();
          activeRef.current = document;
          setActive(document);
        } else if (modal.action === "create-folder") {
          await createFolder(title);
        } else if (modal.action === "rename-folder" && modal.id) {
          await renameFolder(modal.id, title);
        } else if (modal.action === "rename-notebook" && modal.id) {
          await renameNotebook(modal.id, title);
        }
      } else if (modal.kind === "delete-notebook") {
        await deleteNotebook(modal.id);
      } else {
        await deleteFolder(modal.id);
        if (typeof view === "object" && view.folderId === modal.id) setView("all");
      }
      setModal(null);
      setActionError(null);
      await refreshLibrary();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The library action could not be completed.");
    } finally {
      setModalBusy(false);
    }
  }

  async function toggleNotebookFavorite(notebook: NotebookSummary): Promise<void> {
    try {
      await setFavorite(notebook.id, !notebook.favorite);
      await refreshLibrary();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not update the favorite.");
    }
  }

  async function changeFolder(notebook: NotebookSummary, folderId: string): Promise<void> {
    try {
      await moveNotebook(notebook.id, folderId || null);
      await refreshLibrary();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not move notebook.");
    }
  }

  function updateCell(cellId: string, change: Partial<NotebookCell>): void {
    if (change.content !== undefined && activeRef.current) {
      scheduledCalculations.current.delete(`${activeRef.current.id}:${cellId}`);
      setCalculatingContent((current) => { const next = { ...current }; delete next[cellId]; return next; });
    }
    setCellErrors((errors) => { const next = { ...errors }; delete next[cellId]; return next; });
    editDocument((document) => ({
      ...document,
      cells: document.cells.map((cell) => cell.id === cellId ? { ...cell, ...change, result: change.content !== undefined ? null : cell.result } : cell),
    }));
  }

  function changeDisplayMode(cellId: string, mode: DisplayMode): void {
    const current = activeRef.current?.cells.find((cell) => cell.id === cellId);
    if (!current) return;
    updateCell(cellId, { visualization: switchDisplayMode(visualizationForCell(current), mode) });
  }

  function changeDisplaySettings(cellId: string, mode: DisplayMode, patch: Record<string, unknown>): void {
    const current = activeRef.current?.cells.find((cell) => cell.id === cellId);
    if (!current || mode === "result") return;
    updateCell(cellId, { visualization: updateDisplaySettings(visualizationForCell(current), mode, patch) });
  }

  function changeSharedSettings(mode: DisplayMode, patch: Record<string, unknown>): void {
    if (mode === "result") return;
    editDocument((document) => ({ ...document, cells: document.cells.map((cell) => {
      if (cell.cellType !== "mathematics") return cell;
      const visualization = visualizationForCell(cell);
      return visualization.mode === mode ? { ...cell, visualization: updateDisplaySettings(visualization, mode, patch) } : cell;
    }) }));
  }

  function addCell(cellType: CellType): void {
    const cell: NotebookCell = {
      id: newId(),
      order: active?.cells.length ?? 0,
      cellType,
      content: "",
      result: null,
      visualization: structuredClone(defaultVisualizationSettings),
    };
    focusRequest.current = { id: cell.id, end: false };
    editDocument((document) => ({ ...document, cells: [...document.cells, cell] }));
    setAddMenuOpen(false);
  }

  function duplicateCell(cellId: string): void {
    const current = activeRef.current;
    if (!current) return;
    const index = current.cells.findIndex((cell) => cell.id === cellId);
    if (index < 0) return;
    const source = current.cells[index];
    const duplicate = { ...source, id: newId(), result: source.result ? { ...source.result } : null, visualization: structuredClone(visualizationForCell(source)) };
    focusRequest.current = { id: duplicate.id, end: false };
    editDocument((document) => {
      const cells = duplicateCellOperation(document.cells, cellId, () => duplicate.id);
      return { ...document, cells };
    });
  }

  function moveCell(cellId: string, direction: -1 | 1): void {
    const current = activeRef.current;
    if (!current) return;
    const index = current.cells.findIndex((cell) => cell.id === cellId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= current.cells.length) return;
    focusRequest.current = { id: cellId, end: false };
    editDocument((document) => {
      return { ...document, cells: moveCellOperation(document.cells, cellId, direction) };
    });
  }

  function deleteCell(cellId: string): void {
    const current = activeRef.current;
    if (!current) return;
    scheduledCalculations.current.delete(`${current.id}:${cellId}`);
    setCalculatingContent((items) => { const next = { ...items }; delete next[cellId]; return next; });
    editDocument((document) => ({
      ...document,
      cells: deleteCellOperation(document.cells, cellId),
    }));
  }

  function handleCellKeyDown(cellId: string, event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const current = activeRef.current;
    if (!current) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      moveCell(cellId, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if ((event.key === "ArrowUp" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0)
      || (event.key === "ArrowDown" && event.currentTarget.selectionStart === event.currentTarget.value.length && event.currentTarget.selectionEnd === event.currentTarget.value.length)) {
      const index = current.cells.findIndex((cell) => cell.id === cellId);
      const adjacent = current.cells[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (adjacent) {
        event.preventDefault();
        const input = document.getElementById(`cell-${adjacent.id}`) as (HTMLTextAreaElement | HTMLElement) | null;
        input?.focus();
        if (input instanceof HTMLTextAreaElement) {
          const position = event.key === "ArrowUp" ? input.value.length : 0;
          input.setSelectionRange(position, position);
        }
      }
    }
  }

  async function copyResult(result: { exact: string; latex: string }, format: "exact" | "latex"): Promise<void> {
    try {
      await copyMathResult(navigator.clipboard, result, format);
      setActionError(null);
    } catch {
      setActionError("Could not copy to the clipboard. Check the app's clipboard permission and try again.");
    }
  }

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved changes" : saveState === "error" ? "Save error" : "Saved";

  function navigateTo(next: LibraryView): void {
    setView(next);
    if (next === "recent") setSortBy("opened");
    else if (sortBy === "opened") setSortBy("modified");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><span>MathForge</span></div>
        {active ? (
          <>
            <button className="nav-item selected" onClick={() => void leaveNotebook()}><span className="nav-icon">‹</span> Notebook library</button>
            <div className="editor-side-card"><span className="file-icon">∑</span><span><strong>{active.title}</strong><small>{active.cells.length} cells</small></span></div>
          </>
        ) : (
          <>
            <button className="new-notebook primary-side-action" onClick={() => setModal({ kind: "title", action: "create-notebook", initial: defaultTitle })}>＋ <span>New notebook</span></button>
            <div className="side-label">LIBRARY</div>
            <button className={`nav-item ${view === "recent" ? "selected" : ""}`} onClick={() => navigateTo("recent")}><span className="nav-icon">◷</span> Recent</button>
            <button className={`nav-item ${view === "favorites" ? "selected" : ""}`} onClick={() => navigateTo("favorites")}><span className="nav-icon">☆</span> Favorites</button>
            <button className={`nav-item ${view === "all" ? "selected" : ""}`} onClick={() => navigateTo("all")}><span className="nav-icon">▤</span> All notebooks</button>
            <div className="sidebar-folders-head"><div className="side-label">FOLDERS</div><button className="mini-icon-button" aria-label="Create folder" title="Create folder" onClick={() => setModal({ kind: "title", action: "create-folder", initial: "" })}>＋</button></div>
            <div className="folder-nav-list">
              {library.folders.map((folder) => <FolderNavItem key={folder.id} folder={folder} selected={typeof view === "object" && view.folderId === folder.id} count={library.notebooks.filter((item) => item.folderId === folder.id).length} onSelect={() => navigateTo({ folderId: folder.id })} onRename={() => setModal({ kind: "title", action: "rename-folder", id: folder.id, initial: folder.title })} onDelete={() => setModal({ kind: "delete-folder", id: folder.id, title: folder.title, count: library.notebooks.filter((item) => item.folderId === folder.id).length })} />)}
              {library.folders.length === 0 && <div className="no-folders">No folders yet</div>}
            </div>
          </>
        )}
        <div className="profile"><div className="avatar">M</div><span><strong>Local workspace</strong><small>Stored on this device</small></span></div>
      </aside>

      <section className="content">
        {active ? (
          <>
            <header className="topbar">
              <div className="breadcrumbs"><button className="breadcrumb-back" onClick={() => void leaveNotebook()}>Notebooks</button><span>/</span><strong>{active.title}</strong></div>
              <div className="top-actions"><button className="editor-tool-button" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!history.current.canUndo} onClick={undo}>↶</button><button className="editor-tool-button" aria-label="Redo" title="Redo (⌘/Ctrl+Shift+Z)" disabled={!history.current.canRedo} onClick={redo}>↷</button><span className={`save-status ${saveState}`}><i />{saveLabel}</span><span className={`status ${engineStatus}`}><i />{engineStatus === "available" ? "Engine ready" : engineStatus === "checking" ? "Connecting…" : engineStatus === "preview" ? "UI preview" : "Engine unavailable"}</span><button className="outline-button" onClick={() => void runExport(active.id)}>Export</button></div>
            </header>
            <div className="notebook editor-notebook">
              <div className="notebook-heading"><div className="eyebrow">NOTEBOOK <span>·</span> {formatDate(active.modifiedAt).toUpperCase()}</div><label className="sr-only" htmlFor="notebook-title">Notebook title</label><input id="notebook-title" className="notebook-title-input" value={active.title} onChange={(event) => editDocument((document) => ({ ...document, title: event.target.value }))} /></div>
              {actionError && <div className="action-error editor-action-error" role="alert"><span>{actionError}</span><button aria-label="Dismiss message" onClick={() => setActionError(null)}>×</button></div>}
              {active.cells.length === 0 && <div className="editor-empty"><h2>Your notebook is ready.</h2><p>Add a mathematics, text, or Markdown cell to begin.</p></div>}
              {active.cells.map((cell, index) => {
                const context = notebookContext(active.cells, index);
                const calcKey = calculationKey(cell, context);
                const visualization = visualizationForCell(cell);
                const plotIndex = active.cells.slice(0, index).filter((item) => item.cellType === "mathematics" && visualizationForCell(item).mode === visualization.mode).length;
                const plotColor = visualization.mode === "result" ? undefined : sharedPlotColor(visualization, plotIndex);
                return <EditorCell key={cell.id} cell={cell} suggestions={notebookSuggestions(context)} error={cellErrors[cell.id]} calculating={calculatingContent[cell.id] === calcKey} visualizationResult={visualizationResults[cell.id]?.key === calcKey ? visualizationResults[cell.id].result : undefined} sharedVisualization={visualization.mode !== "result"} plotColor={plotColor} onDisplayMode={(mode) => changeDisplayMode(cell.id, mode)} onDisplaySettings={(mode, patch) => changeDisplaySettings(cell.id, mode, patch)} canMoveUp={index > 0} canMoveDown={index < active.cells.length - 1} onChange={(change) => updateCell(cell.id, change)} onDelete={() => deleteCell(cell.id)} onDuplicate={() => duplicateCell(cell.id)} onMoveUp={() => moveCell(cell.id, -1)} onMoveDown={() => moveCell(cell.id, 1)} onKeyDown={(event) => handleCellKeyDown(cell.id, event)} onCopyResult={() => cell.result && void copyResult(cell.result, "exact")} onCopyLatex={() => cell.result && void copyResult(cell.result, "latex")} />;
              })}
              <SharedVisualizationDashboard plots={active.cells.flatMap((cell, index) => {
                if (cell.cellType !== "mathematics") return [];
                const visualization = visualizationForCell(cell);
                if (visualization.mode === "result") return [];
                const context = notebookContext(active.cells, index);
                const key = calculationKey(cell, context);
                const plotIndex = active.cells.slice(0, index).filter((item) => item.cellType === "mathematics" && visualizationForCell(item).mode === visualization.mode).length;
                return [{ id: cell.id, label: `${cell.order + 1}. ${cell.content}`, mode: visualization.mode, settings: visualization, color: sharedPlotColor(visualization, plotIndex), result: visualizationResults[cell.id]?.key === key ? visualizationResults[cell.id].result : undefined }];
              })} onChange={changeSharedSettings} />
              <div className="add-cell-wrap">
                <button className="add-cell" onClick={() => setAddMenuOpen((open) => !open)}><span>＋</span> Add a cell</button>
                {addMenuOpen && <div className="cell-type-menu"><button onClick={() => addCell("mathematics")}>ƒx <span>Mathematics</span></button><button onClick={() => addCell("text")}>T <span>Text</span></button><button onClick={() => addCell("markdown")}>M↓ <span>Markdown</span></button></div>}
              </div>
              <div className="keyboard-hint">⌘/Ctrl Z undo <span>·</span> ⌘/Ctrl D duplicate <span>·</span> Alt ↑/↓ move cells</div>
            </div>
            <footer className="footer"><span>{engineStatus === "available" ? `Python engine ${health?.version ?? ""}` : "MathForge · Local-first mathematics"}</span><span><i className="privacy-dot" /> Your work stays on this device</span></footer>
          </>
        ) : (
          <>
            <header className="topbar library-topbar"><div className="breadcrumbs"><strong>Notebook library</strong></div><div className="top-actions"><span className={`status ${engineStatus}`}><i />{engineStatus === "available" ? "Engine ready" : engineStatus === "checking" ? "Connecting…" : engineStatus === "preview" ? "UI preview" : "Engine unavailable"}</span><button className="outline-button" onClick={() => void runImport()}>Import</button><button className="solid-button" onClick={() => setModal({ kind: "title", action: "create-notebook", initial: defaultTitle })}>＋ New notebook</button></div></header>
            <div className="library-workspace">
              <div className="library-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{currentHeading}</h1><p>Keep your mathematics together, right here on this device.</p></div></div>
              <div className="library-tools"><label className="search-box"><span>⌕</span><input aria-label="Search notebooks" placeholder="Search notebooks" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label><label className="sort-control"><span>Sort</span><select aria-label="Sort notebooks" value={sortBy} onChange={(event) => setSortBy(event.target.value as "modified" | "title" | "opened")}><option value="modified">Last modified</option><option value="opened">Last opened</option><option value="title">Title</option></select></label></div>
              {actionError && <div className="action-error" role="alert"><span>{actionError}</span><button aria-label="Dismiss message" onClick={() => setActionError(null)}>×</button></div>}
              <RecoveryNotices report={library.recovery} />
              {loading ? <div className="library-loading">Loading your library…</div> : visibleNotebooks.length > 0 ? (
                <div className="notebook-grid">{visibleNotebooks.map((notebook) => <NotebookCard key={notebook.id} notebook={notebook} folders={library.folders} onOpen={() => void handleOpenNotebook(notebook)} onFavorite={() => void toggleNotebookFavorite(notebook)} onExport={() => void runExport(notebook.id)} onRename={() => setModal({ kind: "title", action: "rename-notebook", id: notebook.id, initial: notebook.title })} onDelete={() => setModal({ kind: "delete-notebook", id: notebook.id, title: notebook.title })} onMove={(folderId) => void changeFolder(notebook, folderId)} />)}</div>
              ) : <LibraryEmpty view={view} query={query} onCreate={() => setModal({ kind: "title", action: "create-notebook", initial: defaultTitle })} onClearSearch={() => setQuery("")} />}
              <div className="library-count">{visibleNotebooks.length} {visibleNotebooks.length === 1 ? "notebook" : "notebooks"}</div>
            </div>
            <footer className="footer"><span>{isTauri() ? "MathForge · Local-first mathematics" : "MathForge · Browser preview"}</span><span><i className="privacy-dot" /> Your work stays on this device</span></footer>
          </>
        )}
      </section>

      {modal && <LibraryModal modal={modal} title={modalTitle} setTitle={setModalTitle} busy={modalBusy} onClose={() => !modalBusy && setModal(null)} onConfirm={() => void confirmModal()} />}
    </main>
  );
}

function FolderNavItem({ folder, selected, count, onSelect, onRename, onDelete }: {
  folder: NotebookFolder;
  selected: boolean;
  count: number;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className={`folder-nav-row ${selected ? "selected" : ""}`}><button className="folder-nav-select" onClick={onSelect}><span>▱</span><span className="folder-title">{folder.title}</span><small>{count}</small></button><button className="folder-more" aria-label={`Options for ${folder.title}`} onClick={() => setMenuOpen((open) => !open)}>···</button>{menuOpen && <div className="folder-menu"><button onClick={() => { setMenuOpen(false); onRename(); }}>Rename</button><button className="danger-text" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button></div>}</div>;
}

function RecoveryNotices({ report }: { report: LibrarySnapshot["recovery"] }) {
  if (!report.recovered.length && !report.missing.length && !report.invalid.length) return null;
  return <div className="recovery-notices" role="status">
    {report.recovered.length > 0 && <div className="recovery-note recovered"><strong>Recovered {report.recovered.length} notebook{report.recovered.length === 1 ? "" : "s"}</strong><span>{report.recovered.join(", ")} was added back to the library.</span></div>}
    {report.missing.length > 0 && <div className="recovery-note"><strong>{report.missing.length} notebook file{report.missing.length === 1 ? " is" : "s are"} missing</strong><span>The library entry was kept. Restore the file into the app data notebooks folder to recover it.</span></div>}
    {report.invalid.length > 0 && <div className="recovery-note"><strong>{report.invalid.length} file{report.invalid.length === 1 ? " could" : "s could"} not be recovered</strong><span>{report.invalid.map((item) => `${item.file}: ${item.message}`).join(" · ")}</span></div>}
  </div>;
}

function NotebookCard({ notebook, folders, onOpen, onFavorite, onExport, onRename, onDelete, onMove }: {
  notebook: NotebookSummary;
  folders: NotebookFolder[];
  onOpen: () => void;
  onFavorite: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMove: (folderId: string) => void;
}) {
  const folder = folders.find((item) => item.id === notebook.folderId);
  return <article className={`notebook-card ${notebook.missing ? "missing" : ""}`}>
    <div className="notebook-card-top"><div className="notebook-card-icon">∑</div><button className={`favorite-button ${notebook.favorite ? "favorited" : ""}`} aria-label={notebook.favorite ? "Remove from favorites" : "Add to favorites"} title={notebook.favorite ? "Remove favorite" : "Add favorite"} onClick={onFavorite}>{notebook.favorite ? "★" : "☆"}</button></div>
    <button className="notebook-card-title" onClick={onOpen}>{notebook.title}</button>
    <div className="notebook-card-meta"><span>{notebook.missing ? "File missing" : `Edited ${formatDate(notebook.modifiedAt)}`}</span><span className="card-dot">·</span><span>{folder?.title ?? "Unorganized"}</span></div>
    <div className="notebook-card-actions"><button className="open-notebook-button" onClick={onOpen} disabled={notebook.missing}>{notebook.missing ? "Unavailable" : "Open notebook"}</button><button className="card-export" aria-label="Export notebook" title="Export notebook" onClick={onExport}>↗</button><details className="card-more"><summary aria-label="Notebook actions">···</summary><div className="card-menu"><button onClick={onRename}>Rename</button><label>Move to<select value={notebook.folderId ?? ""} onChange={(event) => onMove(event.target.value)}><option value="">All notebooks</option>{folders.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button onClick={onDelete} className="danger-text">Delete</button></div></details></div>
  </article>;
}

function LibraryEmpty({ view, query, onCreate, onClearSearch }: { view: LibraryView; query: string; onCreate: () => void; onClearSearch: () => void }) {
  const isEmptyLibrary = view === "all" && !query;
  return <div className="library-empty"><div className="empty-symbol">∫</div><h2>{query ? "No matching notebooks" : isEmptyLibrary ? "Your notebook library is ready." : "Nothing here yet."}</h2><p>{query ? "Try another title or clear your search." : isEmptyLibrary ? "Create a notebook to start collecting your mathematical ideas." : "Notebooks you add here will appear in this view."}</p><div>{query ? <button className="outline-button" onClick={onClearSearch}>Clear search</button> : <button className="solid-button" onClick={onCreate}>＋ New notebook</button>}</div></div>;
}

const EditorCell = memo(function EditorCell({ cell, suggestions, error, calculating, visualizationResult, sharedVisualization, plotColor, onDisplayMode, onDisplaySettings, canMoveUp, canMoveDown, onChange, onDelete, onDuplicate, onMoveUp, onMoveDown, onKeyDown, onCopyResult, onCopyLatex }: {
  cell: NotebookCell;
  suggestions: string[];
  error?: string;
  calculating: boolean;
  visualizationResult?: VisualizationResult;
  sharedVisualization: boolean;
  plotColor?: string;
  onDisplayMode: (mode: DisplayMode) => void;
  onDisplaySettings: (mode: DisplayMode, patch: Record<string, unknown>) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (change: Partial<NotebookCell>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCopyResult: () => void;
  onCopyLatex: () => void;
}) {
  const isMath = cell.cellType === "mathematics";
  const visualization = visualizationForCell(cell);
  const approximateResult = Boolean(cell.result?.approximate) || /(?:^|[^A-Za-z])(?:\d+\.\d+|\.\d+)(?:[eE][+-]?\d+)?/.test(cell.content);
  const [textMode, setTextMode] = useState<"source" | "preview">("source");
  const moveOut = (direction: "upward" | "downward") => direction === "upward" ? onMoveUp() : onMoveDown();
  return <article className="cell">
    <div className="cell-gutter"><span className="cell-number">{cell.order + 1}</span><span className="cell-kind">{isMath ? "∑" : cell.cellType === "markdown" ? "M" : "T"}</span></div>
    <div className="cell-body" data-cell-id={cell.id}>
      <div className="cell-label"><span className="cell-type-name">{isMath ? "" : cell.cellType === "markdown" ? "Markdown" : "Text"}</span><div className="cell-label-actions">
        {isMath && calculating && <span className="calculation-indicator" role="status">Calculating</span>}
        {isMath && <select className="display-mode-select" aria-label={"Display mode for expression " + (cell.order + 1)} value={visualization.mode} onChange={(event) => onDisplayMode(event.target.value as DisplayMode)}><option value="result">Result only</option><option value="graph2d">2D graph</option><option value="complexPlane">Number line / complex plane</option><option value="graph3d">3D graph</option></select>}
        {!isMath && <div className="text-mode-toggle" role="group" aria-label="Text cell mode"><button className={textMode === "source" ? "selected" : ""} onClick={() => setTextMode("source")}>Source</button><button className={textMode === "preview" ? "selected" : ""} onClick={() => setTextMode("preview")}>Preview</button></div>}
        <button className="cell-tool-button" aria-label={`Move cell ${cell.order + 1} up`} title="Move up (Alt+↑)" onClick={onMoveUp} disabled={!canMoveUp}>↑</button>
        <button className="cell-tool-button" aria-label={`Move cell ${cell.order + 1} down`} title="Move down (Alt+↓)" onClick={onMoveDown} disabled={!canMoveDown}>↓</button>
        <button className="cell-tool-button" aria-label={`Duplicate cell ${cell.order + 1}`} title="Duplicate (⌘/Ctrl+D)" onClick={onDuplicate}>⧉</button>
        <button className="cell-delete" aria-label={`Delete cell ${cell.order + 1}`} title="Delete cell (Undo to restore)" onClick={onDelete}>×</button>
      </div></div>
      {isMath ? <MathInput id={`cell-${cell.id}`} source={cell.content} suggestions={suggestions} allowVisualizationSyntax={visualization.mode !== "result"} onChange={(content) => onChange({ content })} onMove={moveOut} onKeyDown={(event) => onKeyDown(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>)} />
        : textMode === "source" ? <textarea id={`cell-${cell.id}`} className="text-input" spellCheck value={cell.content} placeholder={cell.cellType === "markdown" ? "Write Markdown…" : "Write a note or Markdown…"} onChange={(event) => onChange({ content: event.target.value })} onKeyDown={onKeyDown} rows={Math.max(4, Math.min(12, cell.content.split("\n").length + 2))} />
          : <MarkdownPreview source={cell.content} />}
      {isMath && visualization.mode === "result" && <div className="output">
        {error && <p className="error">{error}</p>}
        {cell.result && <div className="result-block"><div className="result-row"><div className="result-math"><MathExpression source={cell.result.latex || cell.result.exact} /></div><div className="result-copy-actions"><button onClick={onCopyResult}>Copy result</button><button onClick={onCopyLatex}>Copy LaTeX</button></div></div><div className={approximateResult ? "result-certainty approximate" : "result-certainty exact"}>{approximateResult ? "Approximate" : "Exact"}</div>{(cell.result.warning || approximateResult) && <p className="approximation-warning">{cell.result.warning ?? "This saved result uses decimal input and is treated as an approximation."}</p>}</div>}
      </div>}
      {isMath && visualization.mode !== "result" && <VisualizationPanel mode={visualization.mode} settings={visualization} result={visualizationResult} loading={calculating} error={error} shared={sharedVisualization} colorOverride={plotColor} onChange={onDisplaySettings} />}
    </div>
  </article>;
// Handler closures are bound to the same cell ID when the cell object is unchanged.
}, (previous, next) => previous.cell === next.cell
  && previous.suggestions.join("\u0000") === next.suggestions.join("\u0000")
  && previous.sharedVisualization === next.sharedVisualization
  && previous.plotColor === next.plotColor
  && previous.error === next.error
  && previous.calculating === next.calculating
  && previous.canMoveUp === next.canMoveUp
  && previous.canMoveDown === next.canMoveDown);

function LibraryModal({ modal, title, setTitle, busy, onClose, onConfirm }: {
  modal: Exclude<ModalState, null>;
  title: string;
  setTitle: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (modal.kind === "title") {
      setTitle(modal.initial);
      window.setTimeout(() => input.current?.select(), 0);
    }
  }, [modal, setTitle]);

  const heading = modal.kind === "title"
    ? modal.action === "create-notebook" ? "New notebook" : modal.action === "create-folder" ? "New folder" : modal.action === "rename-folder" ? "Rename folder" : "Rename notebook"
    : modal.kind === "delete-notebook" ? "Delete notebook?" : "Delete folder?";
  const confirmText = modal.kind === "title"
    ? modal.action.startsWith("create") ? "Create" : "Save"
    : modal.kind === "delete-notebook" ? "Delete notebook" : "Delete folder and move notebooks";

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" aria-label="Close dialog" onClick={onClose}>×</button><div className="eyebrow">MATHFORGE LIBRARY</div><h2 id="dialog-title">{heading}</h2>
    {modal.kind === "title" ? <label className="dialog-field"><span>{modal.action.includes("folder") ? "Folder title" : "Notebook title"}</span><input ref={input} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); if (event.key === "Escape") onClose(); }} /></label>
      : modal.kind === "delete-notebook" ? <p>“{modal.title}” and its local notebook file will be deleted. This cannot be undone.</p>
        : <p>“{modal.title}” contains {modal.count} {modal.count === 1 ? "notebook" : "notebooks"}. They will be moved back to All notebooks; their files will be kept.</p>}
    <div className="dialog-actions"><button className="outline-button" onClick={onClose} disabled={busy}>Cancel</button><button className={`solid-button ${modal.kind !== "title" ? "danger-button" : ""}`} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmText}</button></div>
  </section></div>;
}
