// diff-engine.js — Line-level Myers diff with hunk computation and resolution
// Exposed as window.DiffEngine

window.DiffEngine = (function () {
  // ────────────────────────────────────────────────
  // Myers diff algorithm (line-level)
  // Returns an edit script: array of { type: 'equal'|'insert'|'delete', line }
  // ────────────────────────────────────────────────

  function myersDiff(oldLines, newLines) {
    const N = oldLines.length;
    const M = newLines.length;
    const MAX = N + M;

    if (MAX === 0) return [];

    // Fast path: identical
    if (N === M) {
      let same = true;
      for (let i = 0; i < N; i++) {
        if (oldLines[i] !== newLines[i]) { same = false; break; }
      }
      if (same) return oldLines.map((l) => ({ type: 'equal', line: l }));
    }

    // V array indexed from -MAX to MAX
    const vSize = 2 * MAX + 1;
    const v = new Int32Array(vSize);
    const trace = [];

    function vGet(k) { return v[k + MAX]; }
    function vSet(k, val) { v[k + MAX] = val; }

    vSet(1, 0);

    for (let d = 0; d <= MAX; d++) {
      const snap = new Int32Array(v);
      trace.push(snap);

      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && vGet(k - 1) < vGet(k + 1))) {
          x = vGet(k + 1);
        } else {
          x = vGet(k - 1) + 1;
        }
        let y = x - k;

        while (x < N && y < M && oldLines[x] === newLines[y]) {
          x++;
          y++;
        }

        vSet(k, x);

        if (x >= N && y >= M) {
          return backtrack(trace, oldLines, newLines, MAX);
        }
      }
    }

    // Should not reach here
    return backtrack(trace, oldLines, newLines, MAX);
  }

  function backtrack(trace, oldLines, newLines, MAX) {
    let x = oldLines.length;
    let y = newLines.length;
    const edits = [];

    for (let d = trace.length - 1; d >= 0; d--) {
      const snap = trace[d];
      const k = x - y;

      function sGet(k) { return snap[k + MAX]; }

      let prevK;
      if (k === -d || (k !== d && sGet(k - 1) < sGet(k + 1))) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      const prevX = sGet(prevK);
      const prevY = prevX - prevK;

      // Diagonal (equal) moves
      while (x > prevX && y > prevY) {
        x--;
        y--;
        edits.push({ type: 'equal', line: oldLines[x] });
      }

      if (d > 0) {
        if (x === prevX) {
          // Insert
          y--;
          edits.push({ type: 'insert', line: newLines[y] });
        } else {
          // Delete
          x--;
          edits.push({ type: 'delete', line: oldLines[x] });
        }
      }
    }

    edits.reverse();
    return edits;
  }

  // ────────────────────────────────────────────────
  // computeHunks — Group edits into hunks
  // ────────────────────────────────────────────────

  function computeHunks(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const edits = myersDiff(oldLines, newLines);

    // Walk edits and group consecutive changes into hunks
    const hunks = [];
    let i = 0;
    let oldIdx = 0;
    let newIdx = 0;
    let hunkId = 0;

    while (i < edits.length) {
      const edit = edits[i];
      if (edit.type === 'equal') {
        oldIdx++;
        newIdx++;
        i++;
        continue;
      }

      // Found a change — start a hunk
      const hunkOldStart = oldIdx;
      const hunkNewStart = newIdx;
      const hunkOldLines = [];
      const hunkNewLines = [];

      while (i < edits.length && edits[i].type !== 'equal') {
        if (edits[i].type === 'delete') {
          hunkOldLines.push(edits[i].line);
          oldIdx++;
        } else if (edits[i].type === 'insert') {
          hunkNewLines.push(edits[i].line);
          newIdx++;
        }
        i++;
      }

      hunks.push({
        id: hunkId++,
        oldStart: hunkOldStart,
        oldCount: hunkOldLines.length,
        newStart: hunkNewStart,
        newCount: hunkNewLines.length,
        oldLines: hunkOldLines,
        newLines: hunkNewLines,
        status: 'pending', // 'pending' | 'accepted' | 'rejected'
      });
    }

    return hunks;
  }

  // ────────────────────────────────────────────────
  // resolveHunks — Reconstruct final document from resolution
  // ────────────────────────────────────────────────

  function resolveHunks(oldText, newText, hunks) {
    const oldLines = oldText.split('\n');
    const result = [];
    let oldIdx = 0;

    // Sort hunks by oldStart to process in order
    const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

    for (const hunk of sorted) {
      // Copy context lines before this hunk
      while (oldIdx < hunk.oldStart) {
        result.push(oldLines[oldIdx]);
        oldIdx++;
      }

      if (hunk.status === 'accepted') {
        // Use new lines
        for (const line of hunk.newLines) {
          result.push(line);
        }
      } else {
        // 'rejected' or 'pending' — use old lines
        for (const line of hunk.oldLines) {
          result.push(line);
        }
      }

      // Skip past the old lines consumed by this hunk
      oldIdx += hunk.oldCount;
    }

    // Copy remaining context after last hunk
    while (oldIdx < oldLines.length) {
      result.push(oldLines[oldIdx]);
      oldIdx++;
    }

    return result.join('\n');
  }

  // ────────────────────────────────────────────────
  // renderUnifiedDiff — Produce colored diff sections for display
  // ────────────────────────────────────────────────

  function renderUnifiedDiff(oldText, newText, hunks, contextLines) {
    if (contextLines == null) contextLines = 3;
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const sections = [];

    for (const hunk of hunks) {
      const lines = [];

      // Context before
      const ctxStart = Math.max(0, hunk.oldStart - contextLines);
      for (let i = ctxStart; i < hunk.oldStart; i++) {
        lines.push({ type: 'context', text: oldLines[i], oldLineNo: i + 1, newLineNo: null });
      }

      // Deleted lines
      for (let i = 0; i < hunk.oldLines.length; i++) {
        lines.push({
          type: 'removed',
          text: hunk.oldLines[i],
          oldLineNo: hunk.oldStart + i + 1,
          newLineNo: null,
        });
      }

      // Added lines
      for (let i = 0; i < hunk.newLines.length; i++) {
        lines.push({
          type: 'added',
          text: hunk.newLines[i],
          oldLineNo: null,
          newLineNo: hunk.newStart + i + 1,
        });
      }

      // Context after
      const ctxEnd = Math.min(oldLines.length, hunk.oldStart + hunk.oldCount + contextLines);
      for (let i = hunk.oldStart + hunk.oldCount; i < ctxEnd; i++) {
        lines.push({ type: 'context', text: oldLines[i], oldLineNo: i + 1, newLineNo: null });
      }

      sections.push({ hunkId: hunk.id, lines });
    }

    return sections;
  }

  // ────────────────────────────────────────────────
  // hunkNewLineRange — Line range in new document for scroll targeting
  // ────────────────────────────────────────────────

  function hunkNewLineRange(hunk) {
    return {
      startLine: hunk.newStart,
      endLine: hunk.newStart + Math.max(hunk.newCount, 1) - 1,
    };
  }

  return {
    computeHunks,
    resolveHunks,
    renderUnifiedDiff,
    hunkNewLineRange,
  };
})();
