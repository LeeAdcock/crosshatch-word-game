// Board model for Reverse Crossword.
//
// The grid is unbounded and infinite in every direction (rows and columns may be
// negative). It is stored sparsely as a Map keyed "row,col" → letter, so only
// filled cells exist. It knows how to write/erase words and — critically for
// strict crossword validation — how to extract every maximal run of letters
// passing through a set of cells.

class Grid {
  constructor() {
    this.cells = new Map(); // "row,col" -> lowercase letter
    this.blocked = new Set(); // "row,col" cells that may not hold a letter
  }

  isBlocked(row, col) {
    return this.blocked.has(`${row},${col}`);
  }

  // Toggle a cell's blocked state; returns the new state.
  toggleBlocked(row, col) {
    const key = `${row},${col}`;
    if (this.blocked.has(key)) {
      this.blocked.delete(key);
      return false;
    }
    this.blocked.add(key);
    return true;
  }

  // The grid is infinite, so every coordinate is in bounds.
  inBounds() {
    return true;
  }

  get(row, col) {
    return this.cells.get(`${row},${col}`) || null;
  }

  set(row, col, letter) {
    if (letter === null) this.cells.delete(`${row},${col}`);
    else this.cells.set(`${row},${col}`, letter);
  }

  // The list of {row, col, letter} a word would occupy starting at (row, col).
  // orientation: 'h' (left→right) or 'v' (top→bottom).
  cellsFor(word, row, col, orientation) {
    const out = [];
    for (let i = 0; i < word.length; i++) {
      const r = orientation === 'v' ? row + i : row;
      const c = orientation === 'h' ? col + i : col;
      out.push({ row: r, col: c, letter: word[i].toLowerCase() });
    }
    return out;
  }

  // Write a word's letters onto the board (no validation — caller decides).
  placeWord(word, row, col, orientation) {
    for (const cell of this.cellsFor(word, row, col, orientation)) {
      this.set(cell.row, cell.col, cell.letter);
    }
  }

  // Remove letters at the given {row, col} cells (used to roll back a trial).
  eraseCells(cells) {
    for (const { row, col } of cells) this.set(row, col, null);
  }

  // The maximal horizontal run of contiguous letters through (row, col),
  // returned as a string. Empty cell → ''.
  horizontalRun(row, col) {
    if (!this.get(row, col)) return '';
    let start = col;
    while (this.get(row, start - 1)) start--;
    let end = col;
    while (this.get(row, end + 1)) end++;
    let s = '';
    for (let c = start; c <= end; c++) s += this.get(row, c);
    return s;
  }

  // The maximal vertical run of contiguous letters through (row, col).
  verticalRun(row, col) {
    if (!this.get(row, col)) return '';
    let start = row;
    while (this.get(start - 1, col)) start--;
    let end = row;
    while (this.get(end + 1, col)) end++;
    let s = '';
    for (let r = start; r <= end; r++) s += this.get(r, col);
    return s;
  }

  // Every distinct maximal run (horizontal and vertical) of length ≥ 2 that
  // passes through any of the given cells. This is the full set of words that a
  // placement creates or extends, including incidental cross/parallel words.
  runsThrough(cells) {
    const runs = new Set();
    for (const { row, col } of cells) {
      const h = this.horizontalRun(row, col);
      if (h.length >= 2) runs.add(`h:${row}:${this.runStartCol(row, col)}:${h}`);
      const v = this.verticalRun(row, col);
      if (v.length >= 2) runs.add(`v:${this.runStartRow(row, col)}:${col}:${v}`);
    }
    // Strip the positional key, returning just the run strings.
    return [...runs].map((k) => k.split(':').pop());
  }

  // Every cell belonging to a maximal run (length ≥ 2) through any of the given
  // cells — i.e. the cells of the placed word plus any crossing words.
  runCellsThrough(cells) {
    const out = new Set();
    for (const { row, col } of cells) {
      const h = this.horizontalRun(row, col);
      if (h.length >= 2) {
        const sc = this.runStartCol(row, col);
        for (let i = 0; i < h.length; i++) out.add(`${row},${sc + i}`);
      }
      const v = this.verticalRun(row, col);
      if (v.length >= 2) {
        const sr = this.runStartRow(row, col);
        for (let i = 0; i < v.length; i++) out.add(`${sr + i},${col}`);
      }
    }
    return [...out].map((k) => {
      const comma = k.indexOf(',');
      return { row: Number(k.slice(0, comma)), col: Number(k.slice(comma + 1)) };
    });
  }

  runStartCol(row, col) {
    let start = col;
    while (this.get(row, start - 1)) start--;
    return start;
  }

  runStartRow(row, col) {
    let start = row;
    while (this.get(start - 1, col)) start--;
    return start;
  }

  // True if the board has no letters at all.
  isEmpty() {
    return this.cells.size === 0;
  }

  // Iterate filled cells as [row, col, letter].
  *entries() {
    for (const [key, letter] of this.cells) {
      const comma = key.indexOf(',');
      yield [Number(key.slice(0, comma)), Number(key.slice(comma + 1)), letter];
    }
  }

  // The min/max row & col spanned by filled cells, or null if the board is empty.
  bounds() {
    if (this.cells.size === 0) return null;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [r, c] of this.entries()) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    return { minR, maxR, minC, maxC };
  }
}

window.Grid = Grid;
