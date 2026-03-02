// scratchpad.md — Y2K markdown notepad
// Built with Tauri v2 + vanilla JS

const { open, save, message } = window.__TAURI__.dialog;
const { readTextFile, writeTextFile } = window.__TAURI__.fs;
const { getCurrentWindow } = window.__TAURI__.window;

// ============================================================================
// STATE
// ============================================================================

let currentFile = null;
let isModified = false;
let showPreview = true;
let showLineNumbers = true;
let activeMenu = null;
let isResizing = false;

// ============================================================================
// DOM REFS
// ============================================================================

const $ = (id) => document.getElementById(id);

const editor = $('editor');
const preview = $('preview');
const previewPane = $('preview-pane');
const editorPane = $('editor-pane');
const resizeHandle = $('resize-handle');
const lineNumbers = $('line-numbers');
const statusPosition = $('status-position');
const statusChars = $('status-chars');
const statusFile = $('status-file');
const statusModified = $('status-modified');
const toolbarTitle = $('toolbar-title');

// ============================================================================
// README CONTENT
// ============================================================================

const README_CONTENT = `# scratchpad.md 📝

A markdown notepad with **Y2K soul**. Inspired by \`notepad.exe\`, built in Rust.

## Features

- ✏️ Write markdown with live preview
- 💾 Open and save .md files
- 🎨 Split pane editing
- ⌨️ Keyboard shortcuts (Cmd+S, Cmd+O, etc.)

## Shortcuts

| Key | Action |
|-----|--------|
| Cmd+N | New file |
| Cmd+O | Open file |
| Cmd+S | Save |
| Cmd+Shift+S | Save As |
| Cmd+P | Toggle preview |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |

## Roadmap

- **v2**: Integrate [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp) for AI-assisted editing

---

> *v0.1.0 — 2026*
`;

// ============================================================================
// UI UPDATES
// ============================================================================

function getFileName() {
  if (!currentFile) return 'Untitled.md';
  return currentFile.split('/').pop().split('\\').pop();
}

function updateTitle() {
  const name = getFileName();
  toolbarTitle.textContent = (isModified ? '● ' : '') + name;
  statusFile.textContent = name;
  statusModified.textContent = isModified ? 'Modified' : 'Ready';
}

function updatePreview() {
  if (!showPreview) return;
  try {
    preview.innerHTML = marked.parse(editor.value || '');
  } catch {
    preview.textContent = editor.value;
  }
}

function updateLineNumbers() {
  if (!showLineNumbers) {
    lineNumbers.style.display = 'none';
    return;
  }
  lineNumbers.style.display = '';
  const count = editor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= count; i++) {
    html += `<div>${i}</div>`;
  }
  lineNumbers.innerHTML = html;
}

function updateStatus() {
  const val = editor.value;
  const pos = editor.selectionStart;
  const before = val.substring(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  statusPosition.textContent = `Ln ${line}, Col ${col}`;
  statusChars.textContent = `${val.length} characters`;
}

function refreshAll() {
  updateTitle();
  updatePreview();
  updateLineNumbers();
  updateStatus();
}

function markModified() {
  if (!isModified) {
    isModified = true;
    updateTitle();
  }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

async function newFile() {
  if (isModified) {
    try {
      const discard = await message('You have unsaved changes. Discard them?', {
        title: 'scratchpad.md',
        kind: 'warning',
      });
      if (!discard) return;
    } catch {
      // Dialog unavailable — proceed anyway
    }
  }
  editor.value = '';
  currentFile = null;
  isModified = false;
  refreshAll();
}

function loadReadme() {
  editor.value = README_CONTENT;
  currentFile = null;
  isModified = false;
  toolbarTitle.textContent = 'README.md';
  statusFile.textContent = 'README.md';
  statusModified.textContent = 'Ready';
  updatePreview();
  updateLineNumbers();
  updateStatus();
}

async function openFile() {
  try {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (!path) return;

    editor.value = await readTextFile(path);
    currentFile = path;
    isModified = false;
    refreshAll();
  } catch (err) {
    console.error('Open failed:', err);
  }
}

async function saveFile() {
  if (!currentFile) return saveFileAs();
  try {
    await writeTextFile(currentFile, editor.value);
    isModified = false;
    updateTitle();
  } catch (err) {
    console.error('Save failed:', err);
  }
}

async function saveFileAs() {
  try {
    const path = await save({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      defaultPath: getFileName(),
    });
    if (!path) return;

    await writeTextFile(path, editor.value);
    currentFile = path;
    isModified = false;
    refreshAll();
  } catch (err) {
    console.error('Save As failed:', err);
  }
}

// ============================================================================
// VIEW TOGGLES
// ============================================================================

function togglePreview() {
  showPreview = !showPreview;
  previewPane.classList.toggle('hidden', !showPreview);
  resizeHandle.style.display = showPreview ? '' : 'none';
  if (showPreview) updatePreview();
}

function toggleLineNumbers() {
  showLineNumbers = !showLineNumbers;
  updateLineNumbers();
}

// ============================================================================
// MARKDOWN TOOLBAR HELPERS
// ============================================================================

function wrapSelection(before, after) {
  editor.focus();
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.substring(start, end) || 'text';
  const replacement = before + selected + after;
  document.execCommand('insertText', false, replacement);
  editor.selectionStart = start + before.length;
  editor.selectionEnd = start + before.length + selected.length;
  markModified();
  updatePreview();
  updateLineNumbers();
}

// ============================================================================
// MENU SYSTEM
// ============================================================================

function closeMenus() {
  document.querySelectorAll('.menu-item').forEach((el) => el.classList.remove('active'));
  activeMenu = null;
}

document.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.target.closest('.menu-option')) return;
    const menu = item.dataset.menu;
    if (activeMenu === menu) {
      closeMenus();
    } else {
      closeMenus();
      item.classList.add('active');
      activeMenu = menu;
    }
  });

  item.addEventListener('mouseenter', () => {
    if (activeMenu && activeMenu !== item.dataset.menu) {
      closeMenus();
      item.classList.add('active');
      activeMenu = item.dataset.menu;
    }
  });
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu-item')) closeMenus();
});

// ============================================================================
// ACTION DISPATCH
// ============================================================================

const ACTIONS = {
  'new':                  () => newFile(),
  'open':                 () => openFile(),
  'save':                 () => saveFile(),
  'save-as':              () => saveFileAs(),
  'exit':                 () => getCurrentWindow().close().catch(() => window.close()),
  'toggle-preview':       () => togglePreview(),
  'toggle-line-numbers':  () => toggleLineNumbers(),
  'bold':                 () => wrapSelection('**', '**'),
  'italic':               () => wrapSelection('_', '_'),
  'heading':              () => wrapSelection('## ', ''),
  'link':                 () => wrapSelection('[', '](url)'),
  'code':                 () => wrapSelection('```\n', '\n```'),
  'about':                () => loadReadme(),
};

function handleAction(action) {
  closeMenus();
  const fn = ACTIONS[action];
  if (fn) fn();
}

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) handleAction(action);
});

// ============================================================================
// EDITOR EVENTS
// ============================================================================

editor.addEventListener('input', () => {
  markModified();
  updatePreview();
  updateLineNumbers();
  updateStatus();
});

editor.addEventListener('keyup', updateStatus);
editor.addEventListener('click', updateStatus);
editor.addEventListener('scroll', () => { lineNumbers.scrollTop = editor.scrollTop; });

// Tab → 4 spaces (preserves undo stack)
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    document.execCommand('insertText', false, '    ');
    markModified();
    updateLineNumbers();
  }
});

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

const SHORTCUTS = {
  'n': 'new',
  'o': 'open',
  'b': 'bold',
  'i': 'italic',
  'p': 'toggle-preview',
};

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();

  // Cmd+S / Cmd+Shift+S
  if (key === 's') {
    e.preventDefault();
    handleAction(e.shiftKey ? 'save-as' : 'save');
    return;
  }

  // Simple shortcuts
  const action = SHORTCUTS[key];
  if (action) {
    e.preventDefault();
    handleAction(action);
  }
  // Cmd+Z / Cmd+Shift+Z — native undo/redo, no interception needed
});

// ============================================================================
// RESIZE HANDLE (split pane drag)
// ============================================================================

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const content = $('content');
  const rect = content.getBoundingClientRect();
  const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0.2), 0.8);
  editorPane.style.flex = `0 0 ${ratio * 100}%`;
  previewPane.style.flex = `0 0 ${(1 - ratio) * 100}%`;
});

document.addEventListener('mouseup', () => { isResizing = false; });

// ============================================================================
// DRAG & DROP
// ============================================================================

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.add('dragging');
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('dragging');

  // Tauri v2 exposes dropped file paths via the onDragDropEvent API
  // But for webview drops, we check the dataTransfer
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['md', 'markdown', 'txt'].includes(ext)) return;

  // Read via FileReader (webview handles the file object)
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = reader.result;
    currentFile = null; // Can't get full path from webview drop
    isModified = false;
    toolbarTitle.textContent = file.name;
    statusFile.textContent = file.name;
    statusModified.textContent = 'Ready';
    updatePreview();
    updateLineNumbers();
    updateStatus();
  };
  reader.readAsText(file);
});

// Also listen for Tauri's native file drop events
try {
  getCurrentWindow().onDragDropEvent(async (event) => {
    if (event.payload.type === 'drop' && event.payload.paths?.length > 0) {
      const path = event.payload.paths[0];
      const ext = path.split('.').pop().toLowerCase();
      if (!['md', 'markdown', 'txt'].includes(ext)) return;

      try {
        editor.value = await readTextFile(path);
        currentFile = path;
        isModified = false;
        refreshAll();
      } catch (err) {
        console.error('Drop open failed:', err);
      }
    }
  });
} catch {
  // Fallback: native drag-drop not available
}

// ============================================================================
// INIT
// ============================================================================

loadReadme();
