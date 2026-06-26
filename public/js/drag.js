// Pointer-based drag for bank words, with automatic orientation.
//
// The controller owns only the *mechanics* (pointer tracking, the floating
// ghost, snapping to a grid cell). Each move it asks main.js's `resolve` hook
// where the word should go: resolve tries both orientations at the cursor and
// returns the one that best snaps onto an existing word, so the ghost rotates
// itself — there is no manual rotate control.

const CELL = 32; // must match --cell and the cell size used when rendering.

class DragController {
  constructor(boardEl, hooks) {
    this.boardEl = boardEl;
    this.hooks = hooks;
    this.active = null; // current drag session or null
  }

  // Wire a bank chip element for dragging. `id` identifies the bank word.
  attach(chipEl, id, word) {
    chipEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // left button only
      e.preventDefault();
      this.begin(e, chipEl, id, word);
    });
  }

  // Start dragging a bank chip.
  begin(e, chipEl, id, word) {
    // Which letter of the word did the user grab? Anchor the drag there so the
    // word snaps naturally under the cursor in either orientation.
    const wordEl = chipEl.querySelector('.word');
    const rect = wordEl.getBoundingClientRect();
    const len = word.length;
    let grabIndex = Math.floor(((e.clientX - rect.left) / rect.width) * len);
    grabIndex = Math.max(0, Math.min(len - 1, grabIndex || 0));

    chipEl.classList.add('dragging');
    this.startDrag(e, {
      word,
      grabIndex,
      chipEl,
      onCommit: (r, c, o) => this.hooks.commit(id, r, c, o),
      onCancel: null, // a bank word simply stays in the bank
    });
  }

  // Start dragging a word already on the board (descriptor supplies its own
  // commit/cancel — cancel pops the word back to where it was).
  beginBoardDrag(e, descriptor) {
    this.startDrag(e, descriptor);
  }

  // Common drag setup for any source. `descriptor` carries word, grabIndex, an
  // optional chipEl, and onCommit/onCancel callbacks.
  startDrag(e, descriptor) {
    this.active = {
      word: descriptor.word,
      grabIndex: descriptor.grabIndex,
      chipEl: descriptor.chipEl || null,
      orientation: null, // current ghost orientation, set by resolve
      ghost: null,
      resolved: null, // last { row, col, orientation, valid } from the resolve hook
      committed: false,
      onCommit: descriptor.onCommit,
      onCancel: descriptor.onCancel || (() => {}),
    };

    this.buildGhost('h');
    this.moveGhost(e.clientX, e.clientY);

    this._onMove = (ev) => this.onMove(ev);
    this._onUp = (ev) => this.onUp(ev);
    this._onKey = (ev) => this.onKey(ev);
    this._onCtx = (ev) => ev.preventDefault();
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('contextmenu', this._onCtx);

    this.onMove(e); // resolve immediately so the preview shows on grab
  }

  buildGhost(orientation) {
    const a = this.active;
    if (a.ghost) a.ghost.remove();
    const ghost = document.createElement('div');
    ghost.className = `ghost ${orientation}`;
    for (const ch of a.word) {
      const t = document.createElement('div');
      t.className = 'gtile';
      t.textContent = ch;
      ghost.appendChild(t);
    }
    document.body.appendChild(ghost);
    a.ghost = ghost;
    a.orientation = orientation;
  }

  // Float the ghost under the cursor (used when off the board).
  moveGhost(x, y) {
    const a = this.active;
    if (!a.ghost) return;
    const CELL = window.CELL; // live cell size (changes with pinch zoom)
    if (a.orientation === 'v') {
      a.ghost.style.left = `${x - CELL / 2}px`;
      a.ghost.style.top = `${y - (a.grabIndex * (CELL + 1) + CELL / 2)}px`;
    } else {
      a.ghost.style.left = `${x - (a.grabIndex * (CELL + 1) + CELL / 2)}px`;
      a.ghost.style.top = `${y - CELL / 2}px`;
    }
  }

  // Lock the ghost onto the grid at a cell's top-left (x, y), offsetting by the
  // 2px border so the ghost tiles sit exactly over the board cells.
  snapGhost(x, y) {
    const a = this.active;
    if (!a.ghost) return;
    a.ghost.style.left = `${x - 2}px`;
    a.ghost.style.top = `${y - 2}px`;
  }

  // The board cell under a viewport point, or null. The ghost has
  // pointer-events:none so it never masks the cell beneath the cursor.
  cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el && el.classList.contains('cell')) {
      return { row: +el.dataset.row, col: +el.dataset.col };
    }
    return null;
  }

  onMove(e) {
    const a = this.active;
    if (!a) return;
    this.hooks.clearPreview();
    const cell = this.cellAt(e.clientX, e.clientY);
    if (cell) {
      const r = this.hooks.resolve(a.word, cell, a.grabIndex);
      if (r.orientation !== a.orientation) this.buildGhost(r.orientation);
      // Snap the ghost onto the grid where the word resolved; if that start cell
      // is off-screen, fall back to floating under the cursor.
      const anchor = this.hooks.cellTopLeft(r.row, r.col);
      if (anchor) this.snapGhost(anchor.x, anchor.y);
      else this.moveGhost(e.clientX, e.clientY);
      // The ghost sits on top of the cells preview() colors, so tint the ghost
      // itself green/red — otherwise the validity colors are hidden beneath it.
      this.setGhostValidity(r.valid);
      this.hooks.preview(a.word, r.row, r.col, r.orientation, r.valid);
      a.resolved = r;
    } else {
      this.moveGhost(e.clientX, e.clientY);
      this.setGhostValidity(null); // off the board: neutral ghost, no verdict yet
      a.resolved = null;
    }
  }

  // Tint the ghost green only when the current placement is legal; an illegal or
  // off-board placement leaves it plain white (no green = won't drop).
  setGhostValidity(valid) {
    const a = this.active;
    if (!a || !a.ghost) return;
    a.ghost.classList.toggle('valid', valid === true);
  }

  onKey(e) {
    if (e.key === 'Escape') this.cancel();
  }

  onUp() {
    const a = this.active;
    if (!a) return;
    if (a.resolved && a.resolved.valid) {
      a.committed = true;
      a.onCommit(a.resolved.row, a.resolved.col, a.resolved.orientation);
    }
    this.cleanup();
  }

  cancel() {
    if (this.active) this.cleanup();
  }

  cleanup() {
    const a = this.active;
    if (!a) return;
    if (a.ghost) a.ghost.remove();
    if (a.chipEl) a.chipEl.classList.remove('dragging');
    this.hooks.clearPreview();
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('contextmenu', this._onCtx);
    // Not committed (invalid drop or Esc) → let the source undo (board words
    // pop back to their original placement; bank words do nothing).
    if (!a.committed) a.onCancel();
    this.active = null;
  }
}

window.DragController = DragController;
window.CELL = CELL;
