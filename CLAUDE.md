# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

scratchpad.md — a desktop markdown notepad with a Windows 98/2000 (Y2K) aesthetic. Built with Tauri v2 (Rust) + vanilla JS (no framework, no bundler).

## Commands

```bash
npm install              # install Node deps (Tauri CLI)
npm run tauri dev        # dev mode with hot reload
npm run tauri build      # production build → src-tauri/target/release/bundle/macos/scratchpad.md.app
```

Prerequisites: Rust toolchain and Node.js.

No test runner or linter is configured.

## Architecture

**Two-layer Tauri v2 app:**

- **`src/`** — Frontend (served directly, no bundler). Three files:
  - `index.html` — app shell: menu bar, toolbar, split-pane editor/preview, status bar
  - `main.js` — all application logic in one file (state, file ops, UI updates, event handlers)
  - `styles.css` — Y2K theme using CSS custom properties in `:root`

- **`src-tauri/`** — Rust backend. Minimal — just initializes Tauri plugins (dialog, fs, opener). No custom Tauri commands; all file I/O uses the plugin APIs directly from JS.

**Key design decisions:**

- `withGlobalTauri: true` in `tauri.conf.json` — Tauri APIs are accessed via `window.__TAURI__` (not ES module imports)
- marked.js loaded from CDN (`<script>` tag), not bundled
- File operations use `@tauri-apps/plugin-dialog` for native open/save dialogs and `@tauri-apps/plugin-fs` for read/write
- Tauri capabilities are in `src-tauri/capabilities/default.json` — must be updated when adding new plugin permissions
- Valid file extensions for open/save/drag-drop: `md`, `markdown`, `txt` (defined as `VALID_EXTENSIONS` in main.js)
- Actions are dispatched through an `ACTIONS` map keyed by action name strings (e.g., `'save'`, `'toggle-preview'`), used by both menu clicks and keyboard shortcuts

## Style Conventions

- CSS uses a beveled border system (`--bevel-light`/`--bevel-dark`) to simulate Win98 3D chrome — maintain this for new UI elements
- Color palette: teal (`#008080`), purple (`#800080`), silver (`#c0c0c0`), Win98 gray (`#d4d0c8`)
- Fonts: "MS Sans Serif"/Tahoma for UI, "Fixedsys"/"Courier New" for editor/code
