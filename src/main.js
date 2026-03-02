// scratchpad.md — Y2K markdown notepad
// Built with Tauri v2 + vanilla JS

const { open, save, message, ask } = window.__TAURI__.dialog;
const { readTextFile, writeTextFile, readDir } = window.__TAURI__.fs;
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
let currentFolder = null;
let showSidebar = false;
let folderTree = [];
let isSidebarResizing = false;

// Diff review state
let diffState = 'idle';      // 'idle' | 'streaming' | 'reviewing'
let preAiSnapshot = null;     // editor content before AI started
let postAiContent = null;     // editor content after AI finished
let diffHunks = [];           // Hunk[] from DiffEngine
let currentHunkIndex = 0;
let scrollDebounceTimer = null;

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
const sidebar = $('sidebar');
const sidebarTree = $('sidebar-tree');
const sidebarHeaderTitle = $('sidebar-header-title');
const sidebarCloseBtn = $('sidebar-close-btn');
const sidebarResizeHandle = $('sidebar-resize-handle');
const aiPanel = $('ai-panel');
const aiMessages = $('ai-messages');
const aiInput = $('ai-input');
const aiGoBtn = $('ai-go-btn');
const aiCancelBtn = $('ai-cancel-btn');
const aiCloseBtn = $('ai-close-btn');
const editorOverlay = $('editor-overlay');
const reviewBar = $('review-bar');
const reviewAcceptAll = $('review-accept-all');
const reviewRejectAll = $('review-reject-all');
const reviewPrev = $('review-prev');
const reviewNext = $('review-next');
const reviewCounter = $('review-counter');
const previewHeader = document.querySelector('.preview-header');

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
      const discard = await ask('You have unsaved changes. Discard them?', {
        title: 'scratchpad.md',
        kind: 'warning',
        okLabel: 'Discard',
        cancelLabel: 'Cancel',
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
  'open-folder':          () => openFolder(),
  'close-folder':         () => closeFolder(),
  'toggle-preview':       () => togglePreview(),
  'toggle-sidebar':       () => toggleSidebar(),
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

const BLOCKED_DURING_AI = new Set(['new', 'open', 'save', 'save-as', 'exit', 'open-folder', 'close-folder']);

function handleAction(action) {
  closeMenus();
  if (diffState !== 'idle' && BLOCKED_DURING_AI.has(action)) return;
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

  // Cmd+Shift+O — open folder (before Cmd+O check via SHORTCUTS)
  if (key === 'o' && e.shiftKey) {
    e.preventDefault();
    handleAction('open-folder');
    return;
  }

  // Cmd+Shift+A — toggle AI panel
  if (key === 'a' && e.shiftKey) {
    e.preventDefault();
    handleAction('toggle-ai');
    return;
  }

  // Cmd+\ — toggle sidebar
  if (key === '\\') {
    e.preventDefault();
    handleAction('toggle-sidebar');
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
  if (isSidebarResizing) {
    const content = $('content');
    const rect = content.getBoundingClientRect();
    const newWidth = Math.min(Math.max(e.clientX - rect.left, 120), 400);
    sidebar.style.width = newWidth + 'px';
    return;
  }
  if (!isResizing) return;
  const content = $('content');
  const rect = content.getBoundingClientRect();
  const sidebarWidth = showSidebar ? sidebar.getBoundingClientRect().width + 5 : 0;
  const available = rect.width - sidebarWidth;
  const offset = e.clientX - rect.left - sidebarWidth;
  const ratio = Math.min(Math.max(offset / available, 0.2), 0.8);
  editorPane.style.flex = `0 0 ${ratio * 100}%`;
  previewPane.style.flex = `0 0 ${(1 - ratio) * 100}%`;
});

document.addEventListener('mouseup', () => { isResizing = false; isSidebarResizing = false; });

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

      // Check if it's a directory by attempting readDir
      try {
        await readDir(path);
        // Success — it's a folder
        await setFolder(path);
        return;
      } catch {
        // Not a directory — fall through to file handling
      }

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
// SIDEBAR / FOLDER TREE
// ============================================================================

const SKIP_DIRS = new Set(['node_modules', 'target', '.git', '.svn', '.hg', 'dist', 'build', '.DS_Store']);

async function readFolderTree(dirPath) {
  try {
    const entries = await readDir(dirPath);
    const items = [];
    for (const entry of entries) {
      const name = entry.name;
      if (!name || name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const fullPath = dirPath + '/' + name;
      if (entry.isDirectory) {
        items.push({ name, path: fullPath, isDir: true, children: null, expanded: false });
      } else if (isMarkdownFile(name)) {
        items.push({ name, path: fullPath, isDir: false });
      }
    }
    // Sort: folders first, then alpha
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return items;
  } catch (err) {
    console.error('readFolderTree failed:', err);
    return [];
  }
}

function renderTree(items, container, depth) {
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'tree-item';
    if (item.path === currentFile) row.classList.add('active');
    row.style.paddingLeft = (4 + depth * 16) + 'px';

    if (item.isDir) {
      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = item.expanded ? '−' : '+';
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        item.expanded = !item.expanded;
        if (item.expanded && item.children === null) {
          item.children = await readFolderTree(item.path);
        }
        renderSidebar();
      });
      row.appendChild(toggle);

      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = item.expanded ? '📂' : '📁';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = item.name;
      row.appendChild(label);

      row.addEventListener('click', async () => {
        item.expanded = !item.expanded;
        if (item.expanded && item.children === null) {
          item.children = await readFolderTree(item.path);
        }
        renderSidebar();
      });

      container.appendChild(row);

      if (item.children && item.children.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children' + (item.expanded ? ' expanded' : '');
        renderTree(item.children, childContainer, depth + 1);
        container.appendChild(childContainer);
      }
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'tree-toggle-placeholder';
      row.appendChild(placeholder);

      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.textContent = '📄';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = item.name;
      row.appendChild(label);

      row.addEventListener('click', () => openFileFromTree(item.path));
      container.appendChild(row);
    }
  }
}

function renderSidebar() {
  sidebarTree.innerHTML = '';
  if (folderTree.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 8px; color: var(--text-muted); font-style: italic;';
    empty.textContent = 'No markdown files found.';
    sidebarTree.appendChild(empty);
    return;
  }
  renderTree(folderTree, sidebarTree, 0);
}

async function openFileFromTree(path) {
  if (isModified) {
    try {
      const discard = await ask('You have unsaved changes. Discard them?', {
        title: 'scratchpad.md',
        kind: 'warning',
        okLabel: 'Discard',
        cancelLabel: 'Cancel',
      });
      if (!discard) return;
    } catch {}
  }
  try {
    editor.value = await readTextFile(path);
    currentFile = path;
    isModified = false;
    refreshAll();
    renderSidebar(); // update active highlight
  } catch (err) {
    console.error('Open from tree failed:', err);
  }
}

async function openFolder() {
  try {
    const path = await open({ directory: true });
    if (!path) return;
    await setFolder(path);
  } catch (err) {
    console.error('Open folder failed:', err);
  }
}

async function setFolder(path) {
  currentFolder = path;
  folderTree = await readFolderTree(path);
  const folderName = path.split('/').pop().split('\\').pop();
  sidebarHeaderTitle.textContent = folderName || 'Explorer';
  showSidebar = true;
  sidebar.classList.remove('hidden');
  sidebarResizeHandle.classList.remove('hidden');
  renderSidebar();
}

function closeFolder() {
  currentFolder = null;
  folderTree = [];
  showSidebar = false;
  sidebar.classList.add('hidden');
  sidebarResizeHandle.classList.add('hidden');
  sidebarTree.innerHTML = '';
  sidebarHeaderTitle.textContent = 'Explorer';
}

function toggleSidebar() {
  if (!currentFolder) return; // nothing to toggle without a folder
  showSidebar = !showSidebar;
  sidebar.classList.toggle('hidden', !showSidebar);
  sidebarResizeHandle.classList.toggle('hidden', !showSidebar);
}

// Sidebar close button
sidebarCloseBtn.addEventListener('click', () => closeFolder());

// Sidebar resize
sidebarResizeHandle.addEventListener('mousedown', (e) => {
  isSidebarResizing = true;
  e.preventDefault();
});

// ============================================================================
// DIFF REVIEW — FLASH & SCROLL (streaming phase)
// ============================================================================

function getEditorLineHeight() {
  const style = getComputedStyle(editor);
  const fontSize = parseFloat(style.fontSize) || 13;
  const lineHeight = parseFloat(style.lineHeight);
  return isNaN(lineHeight) ? fontSize * 1.4 : lineHeight;
}

function flashOverlay(startLine, lineCount) {
  const lh = getEditorLineHeight();
  const padding = parseFloat(getComputedStyle(editor).paddingTop) || 4;
  // Account for line-numbers width offset
  const lineNumsWidth = showLineNumbers ? lineNumbers.offsetWidth : 0;

  const flash = document.createElement('div');
  flash.className = 'editor-flash';
  flash.style.top = (padding + startLine * lh - editor.scrollTop) + 'px';
  flash.style.height = (Math.max(lineCount, 1) * lh) + 'px';
  flash.style.left = lineNumsWidth + 'px';
  editorOverlay.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());
}

function scrollEditorToLine(lineIndex) {
  clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    const lh = getEditorLineHeight();
    const targetTop = lineIndex * lh;
    const viewportHeight = editor.clientHeight;
    // Scroll so changed line is ~1/3 from top
    const scrollTo = targetTop - viewportHeight / 3;
    editor.scrollTo({ top: Math.max(0, scrollTo), behavior: 'smooth' });
  }, 100);
}

// ============================================================================
// DIFF REVIEW — REVIEW MODE
// ============================================================================

function enterReviewMode() {
  postAiContent = editor.value;
  diffHunks = DiffEngine.computeHunks(preAiSnapshot, postAiContent);

  if (diffHunks.length === 0) {
    // No actual changes detected
    diffState = 'idle';
    preAiSnapshot = null;
    postAiContent = null;
    return;
  }

  diffState = 'reviewing';
  currentHunkIndex = 0;

  // Show review bar
  reviewBar.classList.remove('hidden');

  // Make editor read-only
  editor.readOnly = true;

  // Ensure preview is visible
  if (!showPreview) togglePreview();

  // Render diff view in preview
  renderDiffView();
  updateReviewCounter();

  // Scroll to first hunk
  scrollToHunk(0);
}

function exitReviewMode(finalContent) {
  diffState = 'idle';

  // Restore editor writability BEFORE applying content
  editor.readOnly = false;

  // Apply resolved content
  if (finalContent != null) {
    applyToEditor(finalContent);
  }

  // Hide review bar
  reviewBar.classList.add('hidden');

  // Restore preview to markdown
  if (previewHeader) previewHeader.textContent = 'Preview';
  updatePreview();

  // Clear state
  preAiSnapshot = null;
  postAiContent = null;
  diffHunks = [];
  currentHunkIndex = 0;
}

function renderDiffView() {
  if (previewHeader) previewHeader.textContent = 'Review Changes';

  const sections = DiffEngine.renderUnifiedDiff(preAiSnapshot, postAiContent, diffHunks, 3);
  let html = '<div class="diff-view">';

  for (let i = 0; i < diffHunks.length; i++) {
    const hunk = diffHunks[i];
    const section = sections[i];
    const resolved = hunk.status !== 'pending';
    const active = i === currentHunkIndex;

    html += `<div class="diff-hunk${resolved ? ' resolved' : ''}${active ? ' active' : ''}" data-hunk-id="${hunk.id}" id="diff-hunk-${hunk.id}">`;

    // Header
    const statusLabel = hunk.status === 'accepted' ? ' (Accepted)' : hunk.status === 'rejected' ? ' (Rejected)' : '';
    html += `<div class="diff-hunk-header">`;
    html += `<span>Hunk ${i + 1}/${diffHunks.length}${statusLabel}</span>`;

    if (!resolved) {
      html += `<div class="diff-hunk-header-actions">`;
      html += `<button class="diff-hunk-btn diff-hunk-btn-accept" data-resolve="${hunk.id}" data-action-type="accept">Accept</button>`;
      html += `<button class="diff-hunk-btn diff-hunk-btn-reject" data-resolve="${hunk.id}" data-action-type="reject">Reject</button>`;
      html += `</div>`;
    }

    html += `</div>`;

    // Lines
    html += `<div class="diff-lines">`;
    if (section) {
      for (const line of section.lines) {
        const cls = line.type === 'added' ? 'diff-line-added'
          : line.type === 'removed' ? 'diff-line-removed'
          : 'diff-line-context';
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        const escaped = escapeHtml(line.text);
        html += `<div class="diff-line ${cls}"><span class="diff-line-prefix">${prefix}</span>${escaped}</div>`;
      }
    }
    html += `</div>`;

    html += `</div>`;
  }

  html += '</div>';
  preview.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleDiffClick(e) {
  const btn = e.target.closest('[data-resolve]');
  if (!btn) return;
  const hunkId = parseInt(btn.dataset.resolve, 10);
  const actionType = btn.dataset.actionType;
  const idx = diffHunks.findIndex((h) => h.id === hunkId);
  if (idx === -1) return;
  resolveHunk(idx, actionType);
}

function resolveHunk(idx, action) {
  diffHunks[idx].status = action === 'accept' ? 'accepted' : 'rejected';
  renderDiffView();
  updateReviewCounter();

  // Check if all resolved
  const allResolved = diffHunks.every((h) => h.status !== 'pending');
  if (allResolved) {
    const finalContent = DiffEngine.resolveHunks(preAiSnapshot, postAiContent, diffHunks);
    exitReviewMode(finalContent);
    return;
  }

  // Auto-advance to next pending hunk
  advanceToNextPending(idx);
}

function advanceToNextPending(fromIdx) {
  // Search forward first, then wrap
  for (let i = fromIdx + 1; i < diffHunks.length; i++) {
    if (diffHunks[i].status === 'pending') {
      currentHunkIndex = i;
      renderDiffView();
      scrollToHunk(i);
      return;
    }
  }
  for (let i = 0; i < fromIdx; i++) {
    if (diffHunks[i].status === 'pending') {
      currentHunkIndex = i;
      renderDiffView();
      scrollToHunk(i);
      return;
    }
  }
}

function updateReviewCounter() {
  const resolved = diffHunks.filter((h) => h.status !== 'pending').length;
  reviewCounter.textContent = `${resolved}/${diffHunks.length} resolved`;
}

function acceptAllHunks() {
  for (const h of diffHunks) {
    if (h.status === 'pending') h.status = 'accepted';
  }
  const finalContent = DiffEngine.resolveHunks(preAiSnapshot, postAiContent, diffHunks);
  exitReviewMode(finalContent);
}

function rejectAllHunks() {
  for (const h of diffHunks) {
    if (h.status === 'pending') h.status = 'rejected';
  }
  exitReviewMode(preAiSnapshot);
}

function navigateHunk(direction) {
  if (diffHunks.length === 0) return;

  // Find next pending hunk in the given direction
  let idx = currentHunkIndex;
  const step = direction === 'next' ? 1 : -1;
  for (let i = 0; i < diffHunks.length; i++) {
    idx = (idx + step + diffHunks.length) % diffHunks.length;
    if (diffHunks[idx].status === 'pending') {
      currentHunkIndex = idx;
      renderDiffView();
      scrollToHunk(idx);
      return;
    }
  }
}

function scrollToHunk(idx) {
  // Scroll the diff view in preview
  setTimeout(() => {
    const el = document.getElementById('diff-hunk-' + diffHunks[idx].id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);

  // Also scroll editor to the corresponding line
  const range = DiffEngine.hunkNewLineRange(diffHunks[idx]);
  scrollEditorToLine(range.startLine);
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

// Re-read the current file from disk and apply to editor (no focus steal)
async function refreshEditorFromDisk() {
  if (!currentFile) return;
  try {
    const content = await readTextFile(currentFile);
    if (content !== editor.value) {
      editor.value = content;
      isModified = true;
      updateTitle();
      updatePreview();
      updateLineNumbers();
      updateStatus();
    }
  } catch {}
}

async function aiSend(text) {
  if (!text.trim()) return;
  if (diffState !== 'idle') return; // block during streaming/reviewing

  // Show panel if hidden
  if (!showAiPanel) toggleAiPanel();

  aiAddMessage(text, 'user');
  aiInput.value = '';
  aiCancelBtn.disabled = false;
  aiGoBtn.disabled = true;

  // Capture snapshot before AI starts
  preAiSnapshot = editor.value;
  diffState = 'streaming';

  aiStartStream();

  try {
    // prompt() handles full lifecycle: spawn → init → session → prompt → cleanup
    await ACP.prompt(text, editor.value, currentFile, currentFolder);
  } catch (err) {
    aiAddMessage('Error: ' + err.message, 'error');
  }

  // Final re-read: pick up any disk writes the agent made
  await refreshEditorFromDisk();

  aiEndStream();
  aiCancelBtn.disabled = true;
  aiGoBtn.disabled = false;

  // Enter review mode if content changed
  if (diffState === 'streaming' && editor.value !== preAiSnapshot) {
    try {
      enterReviewMode();
    } catch (err) {
      console.error('Failed to enter review mode:', err);
      diffState = 'idle';
      editor.readOnly = false;
      reviewBar.classList.add('hidden');
      preAiSnapshot = null;
      postAiContent = null;
    }
  } else {
    diffState = 'idle';
    preAiSnapshot = null;
  }
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
    } else if (type === 'tool_call_update') {
      // Apply diff content blocks surgically
      const contents = update.content || [];
      for (const block of contents) {
        if (block.type !== 'diff' || block.newText == null) continue;

        let changeStartLine = 0;
        let changeLineCount = 1;

        if (block.oldText != null) {
          // Partial diff (Edit tool) — find oldText in document and replace
          const current = editor.value;
          const idx = current.indexOf(block.oldText);
          if (idx !== -1) {
            // Calculate line position for flash
            changeStartLine = current.substring(0, idx).split('\n').length - 1;
            changeLineCount = block.newText.split('\n').length;

            const patched = current.substring(0, idx)
                          + block.newText
                          + current.substring(idx + block.oldText.length);
            editor.value = patched;
          } else {
            // oldText not found — skip, disk refresh at end will catch it
            continue;
          }
        } else {
          // No oldText = full file content (Write tool / new file)
          changeStartLine = 0;
          changeLineCount = block.newText.split('\n').length;
          editor.value = block.newText;
        }

        isModified = true;
        updateTitle();
        updatePreview();
        updateLineNumbers();
        updateStatus();

        // Flash and scroll during streaming
        if (diffState === 'streaming') {
          flashOverlay(changeStartLine, changeLineCount);
          scrollEditorToLine(changeStartLine);
        }
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

  // Restore snapshot if we were streaming
  if (diffState === 'streaming' && preAiSnapshot != null) {
    applyToEditor(preAiSnapshot);
    aiAddMessage('Reverted to pre-AI content.', 'system');
  }
  diffState = 'idle';
  preAiSnapshot = null;
  postAiContent = null;
  aiEndStream();
});
aiCloseBtn.addEventListener('click', () => toggleAiPanel());

// ============================================================================
// REVIEW BAR EVENT LISTENERS
// ============================================================================

reviewAcceptAll.addEventListener('click', acceptAllHunks);
reviewRejectAll.addEventListener('click', rejectAllHunks);
reviewPrev.addEventListener('click', () => navigateHunk('prev'));
reviewNext.addEventListener('click', () => navigateHunk('next'));

// Event delegation for per-hunk accept/reject buttons in diff view
preview.addEventListener('click', handleDiffClick);

// ============================================================================
// REVIEW MODE KEYBOARD SHORTCUTS
// ============================================================================

document.addEventListener('keydown', (e) => {
  if (diffState !== 'reviewing') return;

  // Escape → Reject All
  if (e.key === 'Escape') {
    e.preventDefault();
    rejectAllHunks();
    return;
  }

  if (!(e.metaKey || e.ctrlKey)) return;

  // Cmd+] → Next hunk
  if (e.key === ']') {
    e.preventDefault();
    navigateHunk('next');
    return;
  }

  // Cmd+[ → Previous hunk
  if (e.key === '[') {
    e.preventDefault();
    navigateHunk('prev');
    return;
  }
});

// ============================================================================
// INIT
// ============================================================================

loadReadme();
