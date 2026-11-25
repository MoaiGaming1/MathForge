# MathForge

A math calculator + grapher, also a useful notebook for understanding stuff.

MathForge is a local-first mathematical notebook built with Tauri 2, React, TypeScript, Rust, and a reusable Python engine. Its notebook library stores metadata in SQLite and notebook content in portable `.mathforge` JSON files. It supports one-level folders, favorites, search, recent notebooks, autosave, recovery, and native import/export dialogs. The editor renders math source and exact results with MathML, previews safe Markdown with inline math, and provides undo/redo and cell operations. The Python engine uses a restricted expression grammar and a private JSON Lines process; it does not execute notebook content as code.

## Supported desktop systems

The project targets macOS (Apple Silicon and Intel), Windows, and Linux. The current foundation and notebook storage tests were built and tested on macOS Apple Silicon. Windows, Linux, Intel macOS, and ARM64 Windows/Linux builds are not yet tested.

## Development

See [Development](docs/DEVELOPMENT.md) for operating-system prerequisites, setup and run commands, tests, build instructions, and known limitations. See [Architecture](docs/ARCHITECTURE.md) for the SQLite schema, `.mathforge` version 1 format, autosave/recovery behavior, and future Python distribution plan.
