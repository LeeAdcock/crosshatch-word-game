// Wires the DOM to the Game: renders the board and bank, drives the drag
// controller's hooks, and updates score/messages.

const boardEl = document.getElementById('board');
const bankEl = document.getElementById('bank');
const scoreEl = document.getElementById('score');
const wordsEl = document.getElementById('words');
const messageEl = document.getElementById('message');

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
// Bank-word ids already shown, so only freshly-dealt words animate in (renderBank
// rebuilds every chip each call, but carried-over words should not re-animate).
const seenBankIds = new Set();

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
function paintCell(cell, r, c, seedKeys, bonusKeys, b) {
  const letter = game.grid.get(r, c);
  cell.classList.remove('filled', 'seed', 'bonus', 'inbox', 'flash', 'preview-good', 'preview-bad');
  const oldGlyph = cell.querySelector('.glyph');
  if (oldGlyph) oldGlyph.remove();
  if (letter) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph'; // its own element so it can be counter-rotated upright
    glyph.textContent = letter;
    cell.appendChild(glyph);
    cell.classList.add('filled');
    if (seedKeys.has(`${r},${c}`)) cell.classList.add('seed');
    else if (bonusKeys.has(`${r},${c}`)) cell.classList.add('bonus');
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
  const bonusKeys = game.bonusCells; // already a Set of "row,col" keys
  const b = game.grid.bounds();
  for (const [key, el] of cellEls) {
    const comma = key.indexOf(',');
    const r = Number(key.slice(0, comma));
    const c = Number(key.slice(comma + 1));
    paintCell(el, r, c, seedKeys, bonusKeys, b);
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

function renderChip(item) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  if (item.bonus) chip.classList.add('bonus-chip');
  chip.dataset.id = item.id;

  const word = document.createElement('span');
  word.className = 'word';
  word.textContent = item.word;

  chip.appendChild(word);
  bankEl.appendChild(chip);

  // Grow a freshly-dealt word in from zero height (its natural height is measured
  // here, then a keyframe animates 0 → that height over half a second).
  if (!seenBankIds.has(item.id)) {
    seenBankIds.add(item.id);
    chip.style.setProperty('--chip-h', `${chip.offsetHeight}px`);
    chip.classList.add('chip-enter');
    chip.addEventListener('animationend', () => {
      chip.classList.remove('chip-enter');
      chip.style.removeProperty('--chip-h');
    }, { once: true });
  }

  drag.attach(chip, item.id, item.word);
}

function renderBank() {
  bankEl.innerHTML = '';
  // The bonus word is pinned to the top of the bank, set apart as the special
  // reward tile; normal words stack below it.
  for (const item of game.bank) if (item.bonus) renderChip(item);
  for (const item of game.bank) if (!item.bonus) renderChip(item);
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
function celebratePlacement(cells, gained, combo, isBonus) {
  if (!cells || !cells.length) return;

  // Flash every cell of the words this placement formed or extended. A bonus
  // placement pulses its connected words yellow instead of the default blue.
  const flashClass = isBonus ? 'flash-bonus' : 'flash';
  const runCells = game.grid.runCellsThrough(cells);
  const flashed = [];
  for (const { row, col } of runCells) {
    const el = cellElAt(row, col);
    if (!el) continue;
    el.classList.add(flashClass);
    flashed.push(el);
  }
  setTimeout(() => flashed.forEach((el) => el.classList.remove(flashClass)), 700);

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
  commit: (id, row, col, orientation) => {
    const result = game.place(id, row, col, orientation);
    if (result.ok) {
      refreshBoard();
      renderBank();
      updateStats();
      celebratePlacement(result.cells, result.gained, result.combo, result.placedBonus);
      if (game.bank.length === 0) setMessage(`Daily puzzle complete — final score ${commafy(game.score)}.`);
      else if (result.bonusAdded) setMessage('★ Bonus word! Place the yellow tile for big points.', 'bonus');
      else if (result.bonusForfeited) setMessage('Bonus word expired — you placed another word.');
      else setMessage('');
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
