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
let showAiPanel = false;
let aiStreaming = ''; // accumulates current assistant response

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
const aiPanel = $('ai-panel');
const aiMessages = $('ai-messages');
const aiInput = $('ai-input');
const aiGoBtn = $('ai-go-btn');
const aiCancelBtn = $('ai-cancel-btn');
const aiCloseBtn = $('ai-close-btn');

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
| Cmd+Shift+A | AI Assistant |

## AI Assistant

Open the AI panel with **Cmd+Shift+A** or the AI menu. Ask the AI to edit, improve, summarize, or fix grammar in your document. Powered by [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp).

---

> *v0.2.0 — 2026*
`;

// ============================================================================
// HELPERS
// ============================================================================

const VALID_EXTENSIONS = ['md', 'markdown', 'txt'];

function isMarkdownFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

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
      filters: [{ name: 'Markdown', extensions: VALID_EXTENSIONS }],
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
      filters: [{ name: 'Markdown', extensions: VALID_EXTENSIONS }],
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
  'toggle-ai':            () => toggleAiPanel(),
  'ai-improve':           () => aiSendQuickAction('Improve the writing in this markdown document. Make it clearer, more concise, and better structured. Write the improved version back to the file.'),
  'ai-summarize':         () => aiSendQuickAction('Summarize this markdown document in a few bullet points. Write a concise summary back to the file, keeping the original content below a "## Summary" heading at the top.'),
  'ai-fix-grammar':       () => aiSendQuickAction('Fix all grammar, spelling, and punctuation errors in this markdown document. Preserve the original meaning and structure. Write the corrected version back to the file.'),
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

  // Cmd+Shift+A — toggle AI panel
  if (key === 'a' && e.shiftKey) {
    e.preventDefault();
    handleAction('toggle-ai');
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

  // Webview fallback — no full path available, so Save As required after
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  if (!isMarkdownFile(file.name)) return;

  const reader = new FileReader();
  reader.onload = () => {
    editor.value = reader.result;
    currentFile = null;
    isModified = false;
    refreshAll();
    // Override title since currentFile is null
    toolbarTitle.textContent = file.name;
    statusFile.textContent = file.name;
  };
  reader.readAsText(file);
});

// Also listen for Tauri's native file drop events
try {
  getCurrentWindow().onDragDropEvent(async (event) => {
    if (event.payload.type === 'drop' && event.payload.paths?.length > 0) {
      const path = event.payload.paths[0];
      if (!isMarkdownFile(path)) return;

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
// AI PANEL
// ============================================================================

function toggleAiPanel() {
  showAiPanel = !showAiPanel;
  aiPanel.classList.toggle('hidden', !showAiPanel);
  if (showAiPanel) aiInput.focus();
}

function aiAddMessage(text, type) {
  const div = document.createElement('div');
  div.className = `ai-msg ai-msg-${type}`;
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return div;
}

// Live-updating element for streaming assistant responses
let aiStreamEl = null;

function aiStartStream() {
  aiStreaming = '';
  aiStreamEl = aiAddMessage('', 'assistant');
}

function aiAppendStream(text) {
  aiStreaming += text;
  if (aiStreamEl) aiStreamEl.textContent = aiStreaming;
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function aiEndStream() {
  aiStreamEl = null;
  aiStreaming = '';
}

// Apply new content to editor preserving undo stack
function applyToEditor(content) {
  if (content === editor.value) return;
  editor.focus();
  editor.select();
  document.execCommand('insertText', false, content);
  markModified();
  updatePreview();
  updateLineNumbers();
  updateStatus();
}

// Re-read the current file from disk and apply to editor
async function refreshEditorFromDisk() {
  if (!currentFile) return;
  try {
    const content = await readTextFile(currentFile);
    if (content !== editor.value) {
      applyToEditor(content);
    }
  } catch {}
}

async function aiSend(text) {
  if (!text.trim()) return;

  // Show panel if hidden
  if (!showAiPanel) toggleAiPanel();

  aiAddMessage(text, 'user');
  aiInput.value = '';
  aiCancelBtn.disabled = false;
  aiGoBtn.disabled = true;

  aiStartStream();

  try {
    // prompt() handles full lifecycle: spawn → init → session → prompt → cleanup
    await ACP.prompt(text, editor.value, currentFile);
  } catch (err) {
    aiAddMessage('Error: ' + err.message, 'error');
  }

  // Final re-read: pick up any disk writes the agent made
  await refreshEditorFromDisk();

  aiEndStream();
  aiCancelBtn.disabled = true;
  aiGoBtn.disabled = false;
}

function aiSendQuickAction(instruction) {
  if (!editor.value.trim()) {
    if (!showAiPanel) toggleAiPanel();
    aiAddMessage('No document content to work with.', 'system');
    return;
  }
  aiSend(instruction);
}

// ACP callbacks
ACP.setEditorBridge(
  () => editor.value,
  (content) => {
    applyToEditor(content);
    aiAddMessage('Document updated.', 'tool');
  }
);

ACP.setCallbacks({
  onUpdate: (sid, update) => {
    const type = update.sessionUpdate;
    if (type === 'agent_message_chunk' && update.content?.type === 'text') {
      aiAppendStream(update.content.text);
    } else if (type === 'tool_call') {
      aiAddMessage(update.title || 'Working...', 'tool');
    } else if (type === 'tool_call_update' && update.status === 'completed') {
      // Agent wrote to disk — re-read file into editor
      if (update.kind === 'edit' || update.kind === 'write') {
        refreshEditorFromDisk();
      }
    }
  },
  onStatus: (status, msg) => {
    if (status === 'connecting') {
      aiAddMessage('Connecting to AI agent...', 'system');
    } else if (status === 'error') {
      aiAddMessage('Agent: ' + (msg || 'disconnected'), 'error');
    }
  },
  onError: (err) => {
    aiAddMessage('Agent error: ' + err, 'error');
  },
});

// AI panel event listeners
aiGoBtn.addEventListener('click', () => aiSend(aiInput.value));
aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aiSend(aiInput.value);
  }
});
aiCancelBtn.addEventListener('click', () => {
  ACP.cancel();
  aiAddMessage('Cancelled.', 'system');
  aiCancelBtn.disabled = true;
  aiGoBtn.disabled = false;
});
aiCloseBtn.addEventListener('click', () => toggleAiPanel());

// ============================================================================
// INIT
// ============================================================================

loadReadme();
