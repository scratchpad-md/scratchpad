// acp-client.js — ACP protocol client for claude-agent-acp sidecar
// JSON-RPC 2.0 over NDJSON (stdin/stdout)
// Uses fresh-process-per-prompt to avoid upstream session bug (#338)

window.ACP = (function () {
  const PROTOCOL_VERSION = 1;
  const CLIENT_INFO = { name: 'scratchpad-md', title: 'scratchpad.md', version: '0.2.0' };

  // State — per-prompt process lifecycle
  let child = null;
  let nextId = 1;
  let lineBuffer = '';
  const pending = new Map();

  // Editor bridge — set by main.js
  let getEditorContent = null;
  let setEditorContent = null;

  // Callbacks — set by main.js
  let onUpdate = null;
  let onStatus = null;
  let onError = null;

  // ──────────────────────────────────────────────
  // JSON-RPC helpers
  // ──────────────────────────────────────────────

  function sendRequest(method, params) {
    const id = nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.write(msg).catch((err) => {
        pending.delete(id);
        reject(err);
      });
    });
  }

  function sendNotification(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    return child.write(msg);
  }

  function sendResponse(id, result) {
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
    return child.write(msg);
  }

  // ──────────────────────────────────────────────
  // NDJSON line parser
  // ──────────────────────────────────────────────

  function handleStdout(data) {
    lineBuffer += data;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        handleMessage(JSON.parse(trimmed));
      } catch (e) {
        console.warn('[ACP] Failed to parse line:', trimmed, e);
      }
    }
  }

  // ──────────────────────────────────────────────
  // Message dispatch
  // ──────────────────────────────────────────────

  function handleMessage(msg) {
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || 'RPC error'));
        } else {
          entry.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === 'session/update') {
      const upd = msg.params.update;
      if (upd.sessionUpdate === 'tool_call_update') {
        console.log('[ACP tool_call_update]', JSON.stringify(upd).substring(0, 500));
      }
      if (onUpdate) onUpdate(msg.params.sessionId, upd);
      return;
    }

    if (msg.id != null && msg.method) {
      handleAgentRequest(msg);
      return;
    }
  }

  // ──────────────────────────────────────────────
  // Agent → Client requests
  // ──────────────────────────────────────────────

  function handleAgentRequest(msg) {
    const { id, method, params } = msg;

    if (method === 'fs/read_text_file') {
      const content = getEditorContent ? getEditorContent() : '';
      sendResponse(id, { content });
      return;
    }

    if (method === 'fs/write_text_file') {
      if (setEditorContent && params.content != null) {
        setEditorContent(params.content);
      }
      sendResponse(id, {});
      return;
    }

    if (method === 'session/request_permission') {
      const allowOption = params.options.find(
        (o) => o.kind === 'allow_always' || o.kind === 'allow_once'
      );
      sendResponse(id, {
        outcome: allowOption
          ? { outcome: 'selected', optionId: allowOption.optionId }
          : { outcome: 'cancelled' },
      });
      return;
    }

    const errMsg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    }) + '\n';
    child.write(errMsg);
  }

  // ──────────────────────────────────────────────
  // Per-prompt lifecycle: spawn → init → session → prompt → kill
  // ──────────────────────────────────────────────

  function cleanup() {
    if (child) {
      try { child.kill(); } catch {}
      child = null;
    }
    // Reject any pending requests
    for (const [id, entry] of pending) {
      entry.reject(new Error('Process terminated'));
    }
    pending.clear();
    lineBuffer = '';
  }

  async function spawnFresh() {
    cleanup();

    const Command = window.__TAURI__.shell.Command;
    const command = Command.sidecar('binaries/claude-agent-acp');

    command.stdout.on('data', handleStdout);
    command.stderr.on('data', (data) => {
      console.log('[ACP stderr]', data);
    });
    command.on('close', (data) => {
      console.log('[ACP] Process exited:', data.code);
      child = null;
    });
    command.on('error', (err) => {
      console.error('[ACP] Process error:', err);
      if (onError) onError(err);
    });

    child = await command.spawn();
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  async function prompt(text, resourceContent, filePath) {
    if (onStatus) onStatus('connecting');

    // Use file's parent directory as cwd so agent can write back
    const cwd = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) || '/' : '/';

    try {
      // Fresh process for each prompt (avoids stale session bug)
      await spawnFresh();

      // Initialize
      await sendRequest('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
        clientInfo: CLIENT_INFO,
      });

      // New session — cwd is the file's directory so agent can write there
      const session = await sendRequest('session/new', {
        cwd,
        mcpServers: [],
      });

      if (onStatus) onStatus('busy');

      // Build prompt blocks
      const promptBlocks = [];
      if (resourceContent != null) {
        const uri = filePath ? 'file://' + filePath : 'file:///document.md';
        promptBlocks.push({
          type: 'resource',
          resource: {
            uri,
            mimeType: 'text/markdown',
            text: resourceContent,
          },
        });
      }
      promptBlocks.push({ type: 'text', text });

      // Send prompt and wait for completion
      const result = await sendRequest('session/prompt', {
        sessionId: session.sessionId,
        prompt: promptBlocks,
      });

      if (onStatus) onStatus('ready');
      return result;
    } catch (err) {
      if (onStatus) onStatus('error', err.message);
      throw err;
    } finally {
      cleanup();
    }
  }

  function cancel() {
    // Kill the process — simplest way to cancel
    cleanup();
  }

  function setEditorBridge(getter, setter) {
    getEditorContent = getter;
    setEditorContent = setter;
  }

  function setCallbacks(callbacks) {
    if (callbacks.onUpdate) onUpdate = callbacks.onUpdate;
    if (callbacks.onStatus) onStatus = callbacks.onStatus;
    if (callbacks.onError) onError = callbacks.onError;
  }

  return {
    prompt,
    cancel,
    setEditorBridge,
    setCallbacks,
  };
})();
