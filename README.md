# scratchpad.md 📝

A markdown notepad with Y2K soul. Inspired by `notepad.exe`, built in Rust.

![scratchpad.md](https://img.shields.io/badge/version-0.1.0-teal)

## Features

- ✏️ Markdown editor with live preview (split pane)
- 💾 Open/save `.md` files via native dialogs
- 🎨 Y2K aesthetic — Windows 98/2000 chrome, beveled borders, teal/purple palette
- ⌨️ Keyboard shortcuts (Cmd+S, Cmd+O, Cmd+P, etc.)
- 📏 Line numbers, status bar, resizable panes
- 🖱️ Classic toolbar with formatting buttons

## Stack

- **Rust** + [Tauri v2](https://v2.tauri.app) — native desktop shell
- **Vanilla JS** — zero-framework frontend
- **marked.js** — markdown rendering

## Dev

```bash
# Prerequisites: Rust, Node.js
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Output: `src-tauri/target/release/bundle/macos/scratchpad.md.app`

## Roadmap

- **v2**: Integrate [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp) for AI-assisted editing

## License

MIT
