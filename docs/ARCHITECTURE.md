# Architecture

MathForge separates the notebook UI, desktop integration, and mathematics engine.

- `src/` contains the React and TypeScript notebook interface. It calls named Tauri commands and owns presentation and edit state.
- `src-tauri/` contains the Tauri 2 application, narrow command surface, and persistent Python process client. The frontend cannot invoke arbitrary shell commands or Python code.
- `engine/mathforge_engine/` is a reusable Python package. It implements a JSON Lines protocol and isolated symbolic/numerical modules; it does not expose a network listener.
- `docs/` describes development and system boundaries.

Tauri resolves and creates the application's OS-specific application-data directory during startup using its [path API](https://v2.tauri.app/reference/javascript/api/namespacepath/). Notebook and settings persistence are not implemented yet; future storage should use this resolved directory through Rust storage commands rather than repository-relative or hard-coded home paths.

## Rust–Python protocol

Each UTF-8 line on stdin is one JSON request. The engine writes exactly one JSON response line to stdout and flushes it. Diagnostics belong on stderr. Requests carry a unique `id`, an `operation`, and operation-specific fields. Responses echo the ID and contain either `result` or a structured `{code, message}` error. Rust serializes requests through one mutex-protected persistent process and rejects mismatched response IDs. The first operations are `health` and `symbolic.simplify`.

The expression grammar is deliberately narrow: numeric literals, symbols, `pi`, `E`, arithmetic `+ - * / ^`, parentheses, and one-argument `sqrt`, `sin`, `cos`, `tan`, `exp`, and `log`. It is parsed from Python's syntax tree into SymPy objects; it never calls Python `eval` or SymPy's string evaluator.

## Calculation lifecycle

The notebook debounces edits for 450 ms. Tauri calls are asynchronous from React, so rendering remains responsive. Each edit advances a frontend revision; responses from older revisions are ignored so they cannot replace newer results. Cancellation of already-running expensive work will be added when long-running operations are introduced. The initial synchronous symbolic simplify command is intentionally small. Do not use manual Shift+Enter execution as the primary notebook model.

## Cross-platform engine launch

Rust uses `PathBuf` and `Command` rather than shell-specific commands. In development it resolves the engine directory from the project root, selects the virtualenv interpreter using the host platform's layout, and falls back to a Python executable on `PATH`. `MATHFORGE_PYTHON` and `MATHFORGE_ENGINE_DIR` allow explicit overrides. Python runs in UTF-8 mode; stdin/stdout remain the private JSON Lines channel and stderr carries diagnostics. Process termination uses Rust's standard child-process APIs.

## Python packaging direction

The current source-tree launch is for development only. The recommended future release is a per-platform standalone engine sidecar bundled as a Tauri resource while retaining the JSON Lines protocol. Build it on native OS/architecture runners so Python, NumPy, SciPy, and native libraries match the target. This removes the user's Python prerequisite at the cost of larger, separately signed artifacts. A bundled relocatable Python runtime is an alternative, but makes dependency relocation and loader-path management more complex. Neither approach is implemented yet.

## Next boundaries

Add persistence behind Rust storage commands, typed notebook cell models in `src/notebook`, plot components under `src/visualization`, and new engine operations in dedicated modules. Plotly.js can own 2D graphs, Three.js 3D rendering, and complex-plane rendering can be a separate visualization module. Ollama must later use a restricted, approval-aware operation API and never receive arbitrary code execution.
