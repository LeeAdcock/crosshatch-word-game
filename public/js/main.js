// Wires the DOM to the Game: renders the board and bank, drives the drag
// controller's hooks, and updates score/messages.

const boardEl = document.getElementById('board');
const bankEl = document.getElementById('bank');
const scoreEl = document.getElementById('score');
const wordsEl = document.getElementById('words');
const messageEl = document.getElementById('message');
const brandMarkEl = document.querySelector('.brand-mark');

// Assigned once the vetted word lists have loaded (see bootstrap at the bottom).
let game;
let drag;

// Orientation chosen on the previous resolve, used as a tie-breaker so the ghost
// doesn't flicker between equally-good horizontal/vertical placements.
let lastOrientation = 'h';

// The board is infinite. We render a window that always covers the viewport plus
// a buffer of extra cells on every side, and re-render (recentered) as the user
// pans so an edge is never reached — the grid appears endless. VIEW_BUFFER must
// exceed the longest word so a word dropped in view is always fully rendered.
const PITCH = window.CELL + 1; // cell size + 1px grid gap
const VIEW_BUFFER = 12;        // extra cells rendered beyond the viewport per side
const RECENTER_AT = 6;         // re-render when fewer than this many buffer cells remain
const ENABLE_WORD_MOVE = false; // temporarily disabled: dragging a placed word to move it

// cellEls maps "row,col" (absolute, may be negative) → the cell <div>.
let cellEls = new Map();
// Top-left world coordinate and size of the currently rendered window.
let viewR0 = 0;
let viewC0 = 0;
let viewRows = 0;
let viewCols = 0;
// Cells currently carrying a preview class, so we can clear them cheaply.
let previewed = [];
// Blue overlay marking the bounding box of all filled cells.
let bboxEl = null;
// Currently-displayed crossword number tags, keyed "row,col" → the <span>. Kept so
// numbers can fade in/out across renders instead of blinking on/off.
let numEls = new Map();
// True while the post-placement bbox-resize + 90° spin sequence runs; blocks input.
let isRotating = false;
// Cumulative logo rotation, bumped 90° per placement so it keeps spinning.
let logoAngle = 0;

const cellElAt = (r, c) => cellEls.get(`${r},${c}`);

// Crossword numbering: a filled cell is numbered when it begins an across word
// (no filled cell to its left, a filled cell to its right) and/or a down word
// (no filled cell above, a filled cell below). Numbers run in reading order.
function computeNumbers() {
  const numbers = {};
  const b = game.grid.bounds();
  if (!b) return numbers;
  let n = 1;
  for (let r = b.minR; r <= b.maxR; r++) {
    for (let c = b.minC; c <= b.maxC; c++) {
      if (!game.grid.get(r, c)) continue;
      const startsAcross = !game.grid.get(r, c - 1) && game.grid.get(r, c + 1);
      const startsDown = !game.grid.get(r - 1, c) && game.grid.get(r + 1, c);
      if (startsAcross || startsDown) numbers[`${r},${c}`] = n++;
    }
  }
  return numbers;
}

// Set a single cell's letter and fill/seed classes. The crossword number tag is
// managed separately by syncNumbers (so it can fade), so we only touch the letter
// glyph here and leave any existing .num child in place. `b` is the filled-cell
// bounds (the blue box); empty cells inside it get a slightly darker gray.
function paintCell(cell, r, c, seedKeys, b) {
  const letter = game.grid.get(r, c);
  cell.classList.remove('filled', 'seed', 'inbox', 'flash', 'preview-good', 'preview-bad');
  const oldGlyph = cell.querySelector('.glyph');
  if (oldGlyph) oldGlyph.remove();
  if (letter) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph'; // its own element so it can be counter-rotated upright
    glyph.textContent = letter;
    cell.appendChild(glyph);
    cell.classList.add('filled');
    if (seedKeys.has(`${r},${c}`)) cell.classList.add('seed');
  } else if (b && r >= b.minR && r <= b.maxR && c >= b.minC && c <= b.maxC) {
    cell.classList.add('inbox'); // open cell within the blue box
  }
}

// Reconcile the on-screen number tags with the freshly computed numbering: fade in
// newly-numbered cells, fade out ones that lost their number (or whose number
// changed), and leave unchanged ones untouched. Numbers shift around constantly as
// the board rotates and renumbers, so this keeps them from blinking.
function syncNumbers(numbers) {
  for (const [key, el] of numEls) {
    if (String(numbers[key]) !== el.dataset.n) {
      el.classList.remove('num-in');
      el.classList.add('num-out');
      const remove = () => el.remove();
      el.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 400);
      numEls.delete(key);
    }
  }
  for (const key in numbers) {
    if (numEls.has(key)) continue;
    const cell = cellEls.get(key);
    if (!cell) continue;
    const tag = document.createElement('span');
    tag.className = 'num num-in';
    tag.dataset.n = numbers[key];
    tag.textContent = numbers[key];
    cell.appendChild(tag);
    numEls.set(key, tag);
  }
}

function paintAllCells() {
  const seedKeys = new Set(game.seedCells.map((c) => `${c.row},${c.col}`));
  const b = game.grid.bounds();
  for (const [key, el] of cellEls) {
    const comma = key.indexOf(',');
    const r = Number(key.slice(0, comma));
    const c = Number(key.slice(comma + 1));
    paintCell(el, r, c, seedKeys, b);
  }
  syncNumbers(computeNumbers());
  updateBoundingBox();
}

// Position the blue overlay around the filled portion. Computed from world
// coordinates (not cell elements) so it stays correct even when the filled area
// extends past the rendered window.
function updateBoundingBox() {
  if (!bboxEl) return;
  const b = game.grid.bounds();
  if (!b) {
    bboxEl.style.display = 'none';
    return;
  }
  // Inflate the box 5px on every side, so it sits just outside the cells (it no
  // longer aligns to the grid exactly — intentional).
  const pad = 5;
  bboxEl.style.left = `${(b.minC - viewC0) * PITCH - pad}px`;
  bboxEl.style.top = `${(b.minR - viewR0) * PITCH - pad}px`;
  bboxEl.style.width = `${(b.maxC - b.minC) * PITCH + window.CELL + 2 * pad}px`;
  bboxEl.style.height = `${(b.maxR - b.minR) * PITCH + window.CELL + 2 * pad}px`;
  bboxEl.style.display = 'block';
}

// Render a window of `rows`×`cols` cells with its top-left at world (r0, c0).
function renderWindow(r0, c0, rows, cols) {
  viewR0 = r0;
  viewC0 = c0;
  viewRows = rows;
  viewCols = cols;
  boardEl.style.setProperty('--cols', cols);
  boardEl.style.setProperty('--rows', rows);
  boardEl.innerHTML = '';
  cellEls = new Map();
  numEls = new Map(); // their spans were just destroyed; syncNumbers re-adds (fading in)

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const r = r0 + i;
      const c = c0 + j;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      boardEl.appendChild(cell);
      cellEls.set(`${r},${c}`, cell);
    }
  }

  // Overlay drawn around the filled area; pointer-events:none so it never
  // intercepts the drag hit-testing.
  bboxEl = document.createElement('div');
  bboxEl.className = 'bbox';
  boardEl.appendChild(bboxEl);

  paintAllCells();
}

// Viewport size, measured in cells.
function viewportCells() {
  const wrap = document.querySelector('.board-wrap');
  const w = wrap.clientWidth || window.innerWidth;
  const h = wrap.clientHeight || window.innerHeight;
  return { cols: Math.ceil(w / PITCH), rows: Math.ceil(h / PITCH) };
}

// Scroll so that the given world point sits at the viewport center.
function scrollWorldToCenter(worldRow, worldCol) {
  const wrap = document.querySelector('.board-wrap');
  wrap.scrollLeft = (worldCol - viewC0) * PITCH - wrap.clientWidth / 2;
  wrap.scrollTop = (worldRow - viewR0) * PITCH - wrap.clientHeight / 2;
}

// The world point currently at the center of the viewport.
function viewCenterWorld() {
  const wrap = document.querySelector('.board-wrap');
  return {
    row: viewR0 + (wrap.scrollTop + wrap.clientHeight / 2) / PITCH,
    col: viewC0 + (wrap.scrollLeft + wrap.clientWidth / 2) / PITCH,
  };
}

// Render a window covering the viewport + VIEW_BUFFER, centered on a world point.
function renderCenteredOn(worldRow, worldCol) {
  const vc = viewportCells();
  const cols = vc.cols + 2 * VIEW_BUFFER;
  const rows = vc.rows + 2 * VIEW_BUFFER;
  const c0 = Math.round(worldCol) - Math.floor(cols / 2);
  const r0 = Math.round(worldRow) - Math.floor(rows / 2);
  renderWindow(r0, c0, rows, cols);
  scrollWorldToCenter(worldRow, worldCol);
}

// Render a `rows`×`cols` window centered on (centerRow, centerCol) but scrolled so
// that world point lands at the given viewport pixel — used by the rotation so a
// chosen pivot stays pinned to one spot on screen across re-renders.
function renderWindowAround(centerRow, centerCol, rows, cols, screenX, screenY) {
  const c0 = Math.round(centerCol) - Math.floor(cols / 2);
  const r0 = Math.round(centerRow) - Math.floor(rows / 2);
  renderWindow(r0, c0, rows, cols);
  const wrap = document.querySelector('.board-wrap');
  wrap.scrollLeft = (centerCol - viewC0) * PITCH + window.CELL / 2 - screenX;
  wrap.scrollTop = (centerRow - viewR0) * PITCH + window.CELL / 2 - screenY;
}

// A square window big enough that rotating about a pivot at viewport pixel
// (screenX, screenY) never swings the board's edge into view. Half-side covers the
// farthest viewport corner from the pivot (plus the usual buffer).
function spinWindowSide(screenX, screenY) {
  const wrap = document.querySelector('.board-wrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  let maxDist = 0;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    maxDist = Math.max(maxDist, Math.hypot(x - screenX, y - screenY));
  }
  return 2 * (Math.ceil(maxDist / PITCH) + VIEW_BUFFER) + 1;
}

// If the visible area has panned within RECENTER_AT cells of the rendered
// window's edge, re-render centered on the current view so more grid appears.
function ensureCoverage() {
  const wrap = document.querySelector('.board-wrap');
  const jMin = Math.floor(wrap.scrollLeft / PITCH);
  const jMax = Math.ceil((wrap.scrollLeft + wrap.clientWidth) / PITCH);
  const iMin = Math.floor(wrap.scrollTop / PITCH);
  const iMax = Math.ceil((wrap.scrollTop + wrap.clientHeight) / PITCH);
  const nearEdge =
    jMin < RECENTER_AT || iMin < RECENTER_AT ||
    viewCols - 1 - jMax < RECENTER_AT || viewRows - 1 - iMax < RECENTER_AT;
  if (nearEdge) {
    const c = viewCenterWorld();
    renderCenteredOn(c.row, c.col);
  }
}

// Repaint after a placement, then top up coverage in case the new word reached
// near the rendered edge.
function refreshBoard() {
  paintAllCells();
  ensureCoverage();
}

// A placement triggers a two-step animation: first the blue box eases to its new
// size (kicked off by refreshBoard's updateBoundingBox), then — once that settles —
// the whole board spins a quarter turn. Input is blocked for the whole sequence.
function rotateBoard() {
  const b = game.grid.bounds();
  if (!b) return; // empty board — nothing to rotate
  isRotating = true;

  const cr = (b.minR + b.maxR) / 2;
  const cc = (b.minC + b.maxC) / 2;

  // Wait for the bbox resize transition to finish, then spin. If the box didn't
  // actually change size, no transitionend fires, so a timer falls through.
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    clearTimeout(wait);
    if (bboxEl) bboxEl.removeEventListener('transitionend', begin);
    spinBoard(cr, cc);
  };
  if (bboxEl) bboxEl.addEventListener('transitionend', begin);
  const wait = setTimeout(begin, 600); // bbox transition is 0.5s; small margin
}

// Spin the whole board a quarter turn about the bounding-box center, animated over
// 1s with the letters kept upright, then commit the rotation to the grid data.
// This is a gameplay mechanic: because runs are read left→right / top→bottom, the
// rotated coordinates genuinely change which placements are valid (and a word on
// the reversed axis will read backwards afterward — intended).
function spinBoard(cr, cc) {
  // Spin about the bbox center exactly where it sits now — no recentering — so the
  // box appears to pivot in place. First note where the center is on screen.
  const wrap = document.querySelector('.board-wrap');
  const screenX = (cc - viewC0) * PITCH + window.CELL / 2 - wrap.scrollLeft;
  const screenY = (cr - viewR0) * PITCH + window.CELL / 2 - wrap.scrollTop;

  // Re-render a square window large enough that rotating about this pivot never
  // exposes the board's edge, keeping the pivot pinned to its current screen spot
  // (so this re-render is invisible — nothing moves, there are just more cells).
  const side = spinWindowSide(screenX, screenY);
  renderWindowAround(cr, cc, side, side, screenX, screenY);

  // transform-origin is board-local; recompute against the new window.
  const originX = (cc - viewC0) * PITCH + window.CELL / 2;
  const originY = (cr - viewR0) * PITCH + window.CELL / 2;
  boardEl.style.transformOrigin = `${originX}px ${originY}px`;

  logoAngle += 90;
  brandMarkEl.style.transform = `rotate(${logoAngle}deg)`;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    boardEl.removeEventListener('transitionend', onEnd);
    try {
      commitRotation(cr, cc, screenX, screenY);
    } finally {
      isRotating = false; // never leave input permanently blocked
    }
  };
  const onEnd = (e) => {
    // Only the board's own transform transition commits — ignore the glyph/num ones.
    if (e.target === boardEl && e.propertyName === 'transform') finish();
  };
  boardEl.addEventListener('transitionend', onEnd);
  // Fallback in case transitionend never fires (e.g. a backgrounded tab).
  const timer = setTimeout(finish, 1100);

  // Next frame so transform-origin is applied before the transition starts.
  requestAnimationFrame(() => boardEl.classList.add('rotating'));
}

// Rewrite the grid data so coordinates rotate 90° clockwise about (cr, cc), then
// clear the visual transforms and re-render the (now axis-aligned) board where the
// animation ended.
function commitRotation(cr, cc, screenX, screenY) {
  // Work in a doubled-integer space and snap the pivot to equal parity so the
  // integer lattice maps to itself (no fractional "row,col" keys).
  const PR = Math.round(2 * cr);
  let PC = Math.round(2 * cc);
  if (((PR + PC) & 1) === 1) PC -= 1;
  const map = (r, c) => ({
    row: (PR + (2 * c - PC)) / 2,
    col: (PC - (2 * r - PR)) / 2,
  });

  const newCells = new Map();
  for (const [r, c, letter] of game.grid.entries()) {
    const p = map(r, c);
    newCells.set(`${p.row},${p.col}`, letter);
  }
  game.grid.cells = newCells;

  const newBlocked = new Set();
  for (const key of game.grid.blocked) {
    const comma = key.indexOf(',');
    const p = map(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
    newBlocked.add(`${p.row},${p.col}`);
  }
  game.grid.blocked = newBlocked;

  game.seedCells = game.seedCells.map(({ row, col, letter }) => ({ ...map(row, col), letter }));

  const nb = game.grid.bounds();
  const ncr = (nb.minR + nb.maxR) / 2;
  const ncc = (nb.minC + nb.maxC) / 2;

  // Drop the transforms before re-rendering so the new DOM isn't rotated. Clear the
  // inline transform to '' (not 'none') — an inline value would override the
  // `.board.rotating { transform: rotate(90deg) }` rule and stop the NEXT spin from
  // animating.
  boardEl.classList.remove('rotating');
  boardEl.style.transform = '';
  boardEl.style.transformOrigin = '';

  // Re-render so the new bbox center lands at exactly the same screen spot the old
  // center occupied during the spin — the board pivots around a fixed point with no
  // post-rotation shift. Center the window on the world point that sits at the
  // viewport center (so the render buffer stays symmetric around the visible area),
  // then pin the scroll so the new center falls precisely on (screenX, screenY).
  const wrap = document.querySelector('.board-wrap');
  const vcol = ncc + (wrap.clientWidth / 2 - screenX) / PITCH;
  const vrow = ncr + (wrap.clientHeight / 2 - screenY) / PITCH;
  renderCenteredOn(vrow, vcol);
  wrap.scrollLeft = (ncc - viewC0) * PITCH + window.CELL / 2 - screenX;
  wrap.scrollTop = (ncr - viewR0) * PITCH + window.CELL / 2 - screenY;
}

function renderBank() {
  bankEl.innerHTML = '';
  for (const item of game.bank) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.dataset.id = item.id;

    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = item.word;

    chip.appendChild(word);
    bankEl.appendChild(chip);

    drag.attach(chip, item.id, item.word);
  }
}

// Whole number with comma thousands separators, e.g. 1234 -> "1,234".
function commafy(n) {
  return Math.round(n).toLocaleString('en-US');
}

function updateStats() {
  scoreEl.textContent = commafy(game.score);
  wordsEl.textContent = `${game.wordsPlaced} / ${game.maxWords}`;
}

function setMessage(text, kind) {
  messageEl.textContent = text;
  messageEl.className = `message ${kind || ''}`;
}

// Combo label for a placement that formed `count` words at once.
function comboLabel(count) {
  if (count === 2) return 'Double word!';
  if (count === 3) return 'Triple word!';
  if (count === 4) return 'Quadruple!';
  return `${count}× combo!`;
}

// Flash the words formed by a placement and float the points gained above it.
// `cells` are the placed word's cells; `gained` is the score delta; `combo` is
// { count, bonus } when the placement formed two or more words.
function celebratePlacement(cells, gained, combo) {
  if (!cells || !cells.length) return;

  // Flash every cell of the words this placement formed or extended.
  const runCells = game.grid.runCellsThrough(cells);
  const flashed = [];
  for (const { row, col } of runCells) {
    const el = cellElAt(row, col);
    if (!el) continue;
    el.classList.add('flash');
    flashed.push(el);
  }
  setTimeout(() => flashed.forEach((el) => el.classList.remove('flash')), 700);

  // Float a "+N" popup above the middle of the placed word.
  const mid = cells[Math.floor(cells.length / 2)];
  const anchor = cellElAt(mid.row, mid.col);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = `score-pop ${gained >= 0 ? 'pos' : 'neg'}`;
  pop.textContent = `${gained >= 0 ? '+' : '−'}${commafy(Math.abs(gained))}`;
  pop.style.left = `${rect.left + rect.width / 2}px`;
  pop.style.top = `${rect.top}px`;
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  // A multi-word placement gets a celebratory combo label above the points.
  if (combo) {
    const label = document.createElement('div');
    label.className = 'combo-pop';
    label.textContent = `${comboLabel(combo.count)} +${combo.bonus}`;
    label.style.left = `${rect.left + rect.width / 2}px`;
    label.style.top = `${rect.top - 26}px`;
    document.body.appendChild(label);
    setTimeout(() => label.remove(), 2200);
  }
}

function clearPreview() {
  for (const cell of previewed) cell.classList.remove('preview-good', 'preview-bad');
  previewed = [];
}

// Highlight the cells a candidate word would occupy, colored by validity.
function preview(word, row, col, orientation, valid) {
  const cells = game.grid.cellsFor(word, row, col, orientation);
  for (const { row: r, col: c } of cells) {
    const cell = cellElAt(r, c);
    if (!cell) continue;
    cell.classList.add(valid ? 'preview-good' : 'preview-bad');
    previewed.push(cell);
  }
}

// The start cell of a word if its letter at `index` sits on `cell`.
function startFor(cell, index, orientation) {
  return orientation === 'h'
    ? { row: cell.row, col: cell.col - index }
    : { row: cell.row - index, col: cell.col };
}

// Auto-orientation with snapping. For each orientation we slide the word along
// its axis so that ANY of its letters can land on the hovered cell — not just
// the grabbed one. That lets the word snap onto an existing word and rotate
// whenever a crossing actually fits there. Among valid placements we prefer the
// most crossings, then the smallest shift from where the player grabbed (so the
// piece stays near the cursor), then the previous orientation to avoid flicker.
// When nothing is valid we fall back to the placement closest to snapping.
function resolve(word, cell, grabIndex) {
  const len = word.length;

  const candidates = [];
  for (const orientation of ['h', 'v']) {
    for (let i = 0; i < len; i++) {
      const s = startFor(cell, i, orientation);
      const res = game.checkWord(word, s.row, s.col, orientation);
      candidates.push({
        orientation,
        row: s.row,
        col: s.col,
        valid: res.valid,
        crossings: res.crossings || 0,
        overlaps: game.overlapCountWord(word, s.row, s.col, orientation),
        shift: Math.abs(i - grabIndex),
      });
    }
  }

  const valids = candidates.filter((c) => c.valid);
  const pool = valids.length ? valids : candidates;
  const key = valids.length ? 'crossings' : 'overlaps';
  pool.sort((a, b) =>
    b[key] - a[key] ||
    a.shift - b.shift ||
    (a.orientation === lastOrientation ? -1 : 1)
  );

  const chosen = pool[0];
  lastOrientation = chosen.orientation;
  return chosen;
}

// Viewport top-left of a board cell, so the drag ghost can snap to the grid.
function cellTopLeft(row, col) {
  const el = cellElAt(row, col);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top };
}

// Hooks handed to the drag controller.
const hooks = {
  resolve,
  cellTopLeft,
  preview,
  clearPreview,
  canInteract: () => !isRotating,
  commit: (id, row, col, orientation) => {
    const result = game.place(id, row, col, orientation);
    if (result.ok) {
      refreshBoard();
      renderBank();
      updateStats();
      celebratePlacement(result.cells, result.gained, result.combo);
      setMessage(game.bank.length === 0 ? `Daily puzzle complete — final score ${commafy(game.score)}.` : '');
      rotateBoard();
    } else {
      setMessage(result.reason || 'Invalid placement', 'error');
    }
  },
};

drag = new DragController(boardEl, hooks);

// Lift the word under a just-grabbed board cell and start dragging it. The axis
// (which crossing word to take, for a shared cell) is chosen by drag direction.
function startWordMove(downEvt, cellEl, axis) {
  const r = +cellEl.dataset.row;
  const c = +cellEl.dataset.col;

  let run = game.wordAt(r, c, axis);
  if (run.word.length < 2) run = game.wordAt(r, c, axis === 'h' ? 'v' : 'h');
  if (run.word.length < 2) return; // isolated single letter — nothing to move

  // Index of the grabbed cell within the chosen run.
  const grabIndex = run.orientation === 'h' ? c - run.col : r - run.row;

  game.liftWord(run);
  refreshBoard();
  updateStats();

  drag.beginBoardDrag(downEvt, {
    word: run.word,
    grabIndex,
    onCommit: (nr, nc, no) => {
      const before = game.score;
      game.commitMove(run, nr, nc, no);
      refreshBoard();
      updateStats();
      celebratePlacement(game.grid.cellsFor(run.word, nr, nc, no), game.score - before);
      setMessage('');
    },
    onCancel: () => {
      game.restoreLifted(run);
      refreshBoard();
      updateStats();
      setMessage(`“${run.word}” returned to its spot`, 'error');
    },
  });
}

// One pointer handler for the board: drag a filled cell to move that word, drag
// empty space to pan. Panning is incremental so a mid-pan re-render never jumps.
function initBoardPointer(wrap) {
  let lastX = 0, lastY = 0;

  // Pan via window listeners (no pointer capture, so click events still fire).
  const panMove = (e) => {
    wrap.scrollLeft -= e.clientX - lastX;
    wrap.scrollTop -= e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  };
  const panEnd = () => {
    wrap.classList.remove('panning');
    window.removeEventListener('pointermove', panMove);
    window.removeEventListener('pointerup', panEnd);
    window.removeEventListener('pointercancel', panEnd);
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (isRotating) return; // ignore pan/word-move while the board is spinning
    const cellEl = e.target.closest('.cell');
    if (ENABLE_WORD_MOVE && cellEl && cellEl.classList.contains('filled')) {
      // Wait for a small drag, then lift the word along the dominant axis. A
      // plain click (no drag) leaves the word untouched.
      const sx = e.clientX, sy = e.clientY;
      const onThreshold = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        window.removeEventListener('pointermove', onThreshold);
        window.removeEventListener('pointerup', cancelThreshold);
        startWordMove(ev, cellEl, Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v');
      };
      const cancelThreshold = () => {
        window.removeEventListener('pointermove', onThreshold);
        window.removeEventListener('pointerup', cancelThreshold);
      };
      window.addEventListener('pointermove', onThreshold);
      window.addEventListener('pointerup', cancelThreshold);
      return;
    }
    // Empty space → pan.
    lastX = e.clientX; lastY = e.clientY;
    wrap.classList.add('panning');
    window.addEventListener('pointermove', panMove);
    window.addEventListener('pointerup', panEnd);
    window.addEventListener('pointercancel', panEnd);
  });

  // Top up coverage as the view scrolls/pans (throttled to one check per frame).
  let pending = false;
  wrap.addEventListener('scroll', () => {
    if (isRotating) return; // our own recenter scroll must not re-render mid-spin
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      ensureCoverage();
    });
  });
}

// Bootstrap: load the vetted word lists, then start the game and render.
async function boot() {
  setMessage('Loading word list…');
  try {
    await window.loadWords();
  } catch (e) {
    setMessage('Failed to load word list. Is the server running?', 'error');
    throw e;
  }

  game = new Game();
  renderBank();
  updateStats();
  setMessage('');

  const wrap = document.querySelector('.board-wrap');
  initBoardPointer(wrap);

  // Render once layout is known, centered on the seed word, filling the viewport.
  requestAnimationFrame(() => {
    const b = game.grid.bounds() || { minR: 0, maxR: 0, minC: 0, maxC: 0 };
    renderCenteredOn((b.minR + b.maxR) / 2 + 0.5, (b.minC + b.maxC) / 2 + 0.5);
  });
}

boot();
