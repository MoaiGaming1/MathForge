# Development

## Support and verification status

MathForge targets desktop macOS (Apple Silicon and Intel), Windows (x64, with ARM64 considered), and Linux (x64, with ARM64 considered). The current code and Rust executable were built and tested on macOS Apple Silicon. Windows, Linux, Intel macOS, and Windows/Linux ARM64 builds have not been tested; the target declaration is not evidence of a passing build on those systems.

## Common prerequisites

- Node.js 20.19+ or 22.12+, with npm.
- Rust stable and Cargo, with the host target and native compiler installed.
- Python 3.10+ and pip for local development. The app prefers the repository's `.venv` interpreter, then searches `PATH` (`python` on Windows, `python3` on macOS/Linux).
- Platform-specific Tauri native dependencies listed below.
- SQLite is bundled through `rusqlite`; no system SQLite installation is required.

The first dependency install needs network access. After dependencies are installed, the development app and local Python engine do not need a network connection. The frontend uses system fonts and makes no runtime network requests.

## macOS

Install [Xcode Command Line Tools](https://v2.tauri.app/start/prerequisites/) and a compatible macOS SDK for desktop development. Full Xcode is not required for desktop-only targets. Intel and Apple Silicon builds should be produced and tested on their respective native or configured build runners; this checkout has only been tested on Apple Silicon.

```sh
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e './engine[dev]'
npm run tauri dev
```

## Windows

Install [Microsoft C++ Build Tools](https://v2.tauri.app/start/prerequisites/) with the **Desktop development with C++** workload. Install the Microsoft Edge WebView2 Runtime if it is not already present. ARM64 builds need a matching Rust MSVC target and compatible native tools; this has not been verified here.

In PowerShell:

```powershell
npm install
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e 'engine[dev]'
npm run tauri dev
```

If PowerShell blocks activation, use the virtualenv interpreter directly: `\.venv\Scripts\python.exe -m pip install -e 'engine[dev]'` and `\.venv\Scripts\python.exe -m pytest engine/tests`. The Rust backend detects `.venv\Scripts\python.exe` without requiring activation.

## Linux

Install Rust, Node.js, Python, and [Tauri's native WebKitGTK/GTK build dependencies](https://v2.tauri.app/start/prerequisites/). For Debian or Ubuntu, the current prerequisite set includes:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Other distributions use their equivalent packages. ARM64 needs the matching Rust target and system packages for that distribution; it has not been verified here.

```sh
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e './engine[dev]'
npm run tauri dev
```

## Build and tests

Run these from the repository root with the Python virtual environment active. On Windows, substitute `.venv\Scripts\python.exe` for `python` if the environment is not activated.

```sh
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
python -m pytest engine/tests
```

`npm run tauri build` creates the desktop bundle for the current host, subject to that host's native tooling. One machine's successful build is not evidence that another OS or architecture works. Cross-platform releases should use native CI runners for each OS/architecture.

## Engine process configuration

The Rust process starts `python -X utf8 -u -m mathforge_engine` from `engine/`. It looks for `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` on macOS/Linux, then falls back to `python` or `python3` on `PATH`. Set `MATHFORGE_PYTHON` to override the executable and `MATHFORGE_ENGINE_DIR` to point to another engine directory. Relative override paths resolve from the project root.

In a plain browser preview (`npm run dev`), Tauri IPC and native file dialogs are unavailable. The library shows an empty preview; persistent library actions require the desktop app.

## Implemented and remaining

- Implemented: Tauri 2 configuration with all bundle targets and desktop icons; OS-resolved application-data directory; SQLite notebook metadata and one-level folders; versioned `.mathforge` files; autosave and atomic replacement; import/export dialogs; startup recovery; platform-neutral Rust process management; Windows/Unix virtualenv selection; UTF-8 JSON Lines; restricted Python expressions; library/editor UI; and Rust/Python tests.
- Built and checked on this machine: Apple Silicon macOS, Python 3.12, Node 26, and Rust stable. See the current task's verification results for exact commands.
- Not implemented: packaged Python distribution, plot rendering, Ollama integration, notebook version history/backups, and automated builds on Windows, Linux, Intel macOS, or ARM64 Windows/Linux.

## Python distribution plan

Development currently requires locally installed Python and the dependencies in `engine/pyproject.toml`. The preferred release direction is a per-platform standalone Python engine sidecar, built on native CI runners and bundled through Tauri's external-binary/resource mechanism. It preserves the JSON Lines boundary and removes the user's Python prerequisite, but creates larger artifacts and requires separate builds for macOS Intel/Apple Silicon, Windows x64/ARM64, and Linux architectures. Each artifact also needs platform signing and native-library checks, especially for NumPy/SciPy and Linux system libraries.

An alternative is to ship a managed Python runtime and a preinstalled engine environment as resources. This preserves a conventional Python package layout but makes runtime discovery, environment relocation, and library loading more complex. Neither packaging approach is implemented or verified. Linux bundles will still depend on system WebKitGTK and related native libraries.
