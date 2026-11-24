# MathForge

A math calculator + grapher, also a useful notebook for understanding stuff.

MathForge is a local-first mathematical notebook foundation built with Tauri 2, React, TypeScript, Rust, and a reusable Python engine. The first milestone provides a dark notebook interface, a Rust-managed persistent JSON Lines connection to Python, a health check, and exact SymPy simplification. The engine accepts a restricted math expression grammar rather than arbitrary Python.

## Supported desktop systems

The project targets macOS (Apple Silicon and Intel), Windows, and Linux. The current foundation was built and tested on macOS Apple Silicon. Windows, Linux, Intel macOS, and ARM64 Windows/Linux builds are not yet tested.

## Development

See [Development](docs/DEVELOPMENT.md) for operating-system prerequisites, setup and run commands, tests, build instructions, and known limitations. See [Architecture](docs/ARCHITECTURE.md) for process boundaries and the future Python distribution plan.
