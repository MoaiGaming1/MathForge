# Architecture

MathForge separates the notebook UI, desktop integration, and mathematics engine.

- `src/` contains the React and TypeScript notebook interface. It calls named Tauri commands and owns presentation and edit state.
- `src-tauri/` contains the Tauri 2 application, notebook commands, SQLite/file storage, and persistent Python process client. The frontend cannot invoke arbitrary shell commands or Python code.
- `engine/mathforge_engine/` is a reusable Python package. It implements a JSON Lines protocol and isolated symbolic/numerical modules; it does not expose a network listener.
- `docs/` describes development and system boundaries.

Tauri resolves the application's OS-specific application-data directory during startup using its [path API](https://v2.tauri.app/reference/javascript/api/namespacepath/). The store creates this layout without hard-coded home paths:

```text
<app-data>/
  library.sqlite3
  notebooks/
    <notebook-uuid>.mathforge
```

The SQLite database uses `PRAGMA user_version = 1` and foreign keys. `folders` stores UUID, title, and timestamps. `notebooks` stores UUID, title, nullable folder UUID, relative file location, creation/modification/last-opened timestamps, and a favorite flag. Deleting a folder explicitly returns its notebooks to the unorganized library; notebook files remain untouched.

## Notebook document format

A `.mathforge` file is UTF-8 JSON with the magic format name `mathforge` and `formatVersion: 1`. The document stores its UUID, title, RFC 3339 creation and modification times, settings, and ordered cells. Each cell has a UUID, zero-based `order`, `cellType` (`mathematics`, `text`, or `markdown`), text `content`, and an optional saved result (`exact`, `latex`, `calculatedAt`). Settings currently store automatic calculation and its debounce interval. Cell content and imported results remain plain text; markdown is not executed as HTML, and expressions still pass through the existing restricted SymPy parser.

The editor keeps mathematical source in each cell and renders a separate MathML preview from a small expression grammar. Result LaTeX is converted only for display and the exact result remains available for copying. Markdown keeps its original source in the notebook and shows a safe React preview: raw HTML stays text, and links are limited to HTTP(S), mailto, and in-document fragments. Inline and display math use the same renderer, including a small LaTeX input subset for fractions, roots, Greek letters, and common operators. Undo history is in memory for the active editing session; notebook cells and Markdown source continue to use the unchanged version 1 format.

The importer validates the file extension, size, format/version, UUIDs, timestamps, settings, unique and contiguous cell ordering, and cell/result size limits. A UUID already used by the library is replaced on import, while cell contents/order/results/settings are preserved. It never overwrites an existing library file. Export asks for a destination and serializes the current document without changing its source file. File paths from imported JSON are never used; library file locations are derived from validated UUIDs, preventing path traversal.

## Autosave and recovery

The UI debounces document edits for 500 ms and sends saves asynchronously through Tauri commands. Each save carries a monotonically increasing revision; Rust ignores a save older than the last saved revision, and the frontend also avoids applying an older save response over a newer one. The backend serializes the validated document to a temporary file in the same directory, flushes it, then atomically replaces the destination. It updates SQLite in a transaction and restores the previous file bytes if the metadata update fails. The UI exposes Unsaved, Saving, Saved, and Save error states. Returning to the library and closing the window flush outstanding edits; a failed close-time save keeps the window open.

On startup, recovery scans regular `.mathforge` files in the notebooks directory. Valid unindexed files are added to SQLite. Missing files and invalid/unrecoverable files are reported in the library UI and are not silently deleted. Missing metadata entries are kept so a user can restore a file. If the app data directory or database cannot be opened, MathForge still starts and reports the storage error in the library. There is no separate backup directory or version history in this milestone.

## Rust–Python protocol

Each UTF-8 line on stdin is one JSON request. The engine writes exactly one JSON response line to stdout and flushes it. Diagnostics belong on stderr. Requests carry a unique `id`, an `operation`, and operation-specific fields. Responses echo the ID and contain either `result` or a structured `{code, message}` error. Rust serializes requests through one mutex-protected persistent process and rejects mismatched response IDs. The first operations are `health` and `symbolic.simplify`.

The expression grammar is deliberately narrow: numeric literals, symbols, `pi`, `E`, infinity, arithmetic `+ - * / ^`, parentheses, one-argument `sqrt`, `sin`, `cos`, `tan`, `exp`, and `log`, plus two-argument `nthroot(radicand, degree)`. It is parsed from Python's syntax tree into SymPy objects; it never calls Python `eval` or SymPy's string evaluator.

## Calculation lifecycle

The notebook debounces edits for 450 ms. Tauri calls are asynchronous from React, so rendering remains responsive. Each edit advances a frontend revision; responses from older revisions are ignored so they cannot replace newer results. Cancellation of already-running expensive work will be added when long-running operations are introduced. The initial synchronous symbolic simplify command is intentionally small. Do not use manual Shift+Enter execution as the primary notebook model.

## Cross-platform engine launch

Rust uses `PathBuf` and `Command` rather than shell-specific commands. In development it resolves the engine directory from the project root, selects the virtualenv interpreter using the host platform's layout, and falls back to a Python executable on `PATH`. `MATHFORGE_PYTHON` and `MATHFORGE_ENGINE_DIR` allow explicit overrides. Python runs in UTF-8 mode; stdin/stdout remain the private JSON Lines channel and stderr carries diagnostics. Process termination uses Rust's standard child-process APIs.

## Python packaging direction

The current source-tree launch is for development only. The recommended future release is a per-platform standalone engine sidecar bundled as a Tauri resource while retaining the JSON Lines protocol. Build it on native OS/architecture runners so Python, NumPy, SciPy, and native libraries match the target. This removes the user's Python prerequisite at the cost of larger, separately signed artifacts. A bundled relocatable Python runtime is an alternative, but makes dependency relocation and loader-path management more complex. Neither approach is implemented yet.

## Next boundaries

Add plots under `src/visualization` and new engine operations in dedicated modules. Plotly.js can own 2D graphs, Three.js 3D rendering, and complex-plane rendering can be a separate visualization module. Ollama must later use a restricted, approval-aware operation API and never receive arbitrary code execution.

## Storage test suite

Rust storage tests cover notebook creation/reopen, cell order/types/results, title/folder operations, folder moves, favorites/search/recents, import validation and duplicate IDs, export/reimport fidelity, atomic replacement and rollback, stale save revisions, and recovery of orphaned or missing files. Run them with `cargo test --manifest-path src-tauri/Cargo.toml`.
