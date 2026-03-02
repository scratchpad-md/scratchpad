// scratchpad.md — Y2K markdown notepad
const { invoke } = window.__TAURI__.core;
const { open, save, message } = window.__TAURI__.dialog;
const { readTextFile, writeTextFile } = window.__TAURI__.fs;

// State
let currentFile = null;
let isModified = false;
let showPreview = true;
let showLineNumbers = true;
let activeMenu = null;

// DOM
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewPane = document.getElementById('preview-pane');
const resizeHandle = document.getElementById('resize-handle');
const lineNumbers = document.getElementById('line-numbers');
const statusPosition = document.getElementById('status-position');
const statusChars = document.getElementById('status-chars');
const statusFile = document.getElementById('status-file');
const statusModified = document.getElementById('status-modified');
const toolbarTitle = document.getElementById('toolbar-title');
const aboutDialog = document.getElementById('about-dialog');

// === FILE OPERATIONS ===

function getFileName() {
  if (!currentFile) return 'Untitled.md';
  return currentFile.split('/').pop().split('\\').pop();
}

function updateTitle() {
  const name = getFileName();
  const modified = isModified ? '● ' : '';
  toolbarTitle.textContent = modified + name;
  statusFile.textContent = name;
  statusModified.textContent = isModified ? 'Modified' : 'Ready';
}

function markModified() {
  if (!isModified) {
    isModified = true;
    updateTitle();
  }
}

async function newFile() {
  if (isModified) {
    const ok = await message('Save changes before creating a new file?', {
      title: 'scratchpad.md',
      kind: 'warning',
      okLabel: 'Discard',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
  }
  editor.value = '';
  currentFile = null;
  isModified = false;
  updateTitle();
  updatePreview();
  updateLineNumbers();
  updateStatus();
}

async function openFile() {
  try {
    const path = await open({
      multiple: false,
      filters: [{
        name: 'Markdown',
        extensions: ['md', 'markdown', 'txt']
      }]
    });
    if (!path) return;

    const content = await readTextFile(path);
    editor.value = content;
    currentFile = path;
    isModified = false;
    updateTitle();
    updatePreview();
    updateLineNumbers();
    updateStatus();
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
      filters: [{
        name: 'Markdown',
        extensions: ['md', 'markdown', 'txt']
      }],
      defaultPath: getFileName()
    });
    if (!path) return;

    await writeTextFile(path, editor.value);
    currentFile = path;
    isModified = false;
    updateTitle();
  } catch (err) {
    console.error('Save As failed:', err);
  }
}

// === PREVIEW ===

function updatePreview() {
  if (!showPreview) return;
  try {
    preview.innerHTML = marked.parse(editor.value || '');
  } catch {
    preview.textContent = editor.value;
  }
}

function togglePreview() {
  showPreview = !showPreview;
  previewPane.classList.toggle('hidden', !showPreview);
  resizeHandle.style.display = showPreview ? '' : 'none';
  if (showPreview) updatePreview();
}

// === LINE NUMBERS ===

function updateLineNumbers() {
  if (!showLineNumbers) {
    lineNumbers.style.display = 'none';
    return;
  }
  lineNumbers.style.display = '';
  const lines = editor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) {
    html += i + '\n';
  }
  lineNumbers.textContent = html;
}

function toggleLineNumbers() {
  showLineNumbers = !showLineNumbers;
  updateLineNumbers();
}

// === STATUS BAR ===

function updateStatus() {
  const val = editor.value;
  const pos = editor.selectionStart;
  const before = val.substring(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  statusPosition.textContent = `Ln ${line}, Col ${col}`;
  statusChars.textContent = `${val.length} characters`;
}

// === TOOLBAR MARKDOWN HELPERS ===

function wrapSelection(before, after) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.substring(start, end);
  const replacement = before + (selected || 'text') + after;
  editor.value = editor.value.substring(0, start) + replacement + editor.value.substring(end);
  editor.selectionStart = start + before.length;
  editor.selectionEnd = start + replacement.length - after.length;
  editor.focus();
  markModified();
  updatePreview();
  updateLineNumbers();
}

// === MENU SYSTEM ===

function closeMenus() {
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
  activeMenu = null;
}

document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('mousedown', (e) => {
    e.preventDefault();
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
  if (!e.target.closest('.menu-item')) {
    closeMenus();
  }
});

// === ACTION DISPATCH ===

function handleAction(action) {
  closeMenus();
  switch (action) {
    case 'new': newFile(); break;
    case 'open': openFile(); break;
    case 'save': saveFile(); break;
    case 'save-as': saveFileAs(); break;
    case 'exit': window.__TAURI__.core.invoke('plugin:process|exit', { code: 0 }); break;
    case 'toggle-preview': togglePreview(); break;
    case 'toggle-line-numbers': toggleLineNumbers(); break;
    case 'bold': wrapSelection('**', '**'); break;
    case 'italic': wrapSelection('_', '_'); break;
    case 'heading': wrapSelection('## ', ''); break;
    case 'link': wrapSelection('[', '](url)'); break;
    case 'code': wrapSelection('```\n', '\n```'); break;
    case 'about': aboutDialog.style.display = ''; break;
    case 'close-about': aboutDialog.style.display = 'none'; break;
  }
}

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) handleAction(action);
});

// === EDITOR EVENTS ===

editor.addEventListener('input', () => {
  markModified();
  updatePreview();
  updateLineNumbers();
  updateStatus();
});

editor.addEventListener('keyup', updateStatus);
editor.addEventListener('click', updateStatus);

editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

// Tab key support
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + 4;
    markModified();
    updateLineNumbers();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) {
    switch (e.key.toLowerCase()) {
      case 'n': e.preventDefault(); handleAction('new'); break;
      case 'o': e.preventDefault(); handleAction('open'); break;
      case 's':
        e.preventDefault();
        if (e.shiftKey) handleAction('save-as');
        else handleAction('save');
        break;
      case 'p': e.preventDefault(); handleAction('toggle-preview'); break;
      case 'b': e.preventDefault(); handleAction('bold'); break;
      case 'i': e.preventDefault(); handleAction('italic'); break;
    }
  }
});

// === RESIZE HANDLE ===

let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const content = document.getElementById('content');
  const rect = content.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const clamped = Math.min(Math.max(ratio, 0.2), 0.8);
  document.getElementById('editor-pane').style.flex = `0 0 ${clamped * 100}%`;
  previewPane.style.flex = `0 0 ${(1 - clamped) * 100}%`;
});

document.addEventListener('mouseup', () => {
  isResizing = false;
});

// === INIT ===

updatePreview();
updateLineNumbers();
updateStatus();
updateTitle();

// Welcome content
editor.value = `# Welcome to scratchpad.md 📝

A markdown notepad with **Y2K soul**.

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

---

> Built with Rust + Tauri. Inspired by Notepad.exe.
> 
> *v0.1.0 — 2026*
`;

updatePreview();
updateLineNumbers();
updateStatus();
