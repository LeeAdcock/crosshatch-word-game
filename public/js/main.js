// Wires the DOM to the Game: renders the board and bank, drives the drag
// controller's hooks, and updates score/messages.

const boardEl = document.getElementById('board');
const bankEl = document.getElementById('bank');
const scoreEl = document.getElementById('score');
const wordsEl = document.getElementById('words');
const messageEl = document.getElementById('message');
const restartBtn = document.getElementById('restart-btn');

// End-of-game dialog elements.
const gameoverEl = document.getElementById('gameover');
const gameoverTitleEl = document.getElementById('gameover-title');
const gameoverSubEl = document.getElementById('gameover-sub');
const gameoverScoreEl = document.getElementById('gameover-score');
const gameoverBoardEl = document.getElementById('gameover-board');
const gameoverHintEl = document.getElementById('gameover-hint');

// The ASCII board snapshot shown in the game-over dialog, kept so the copied
// result matches exactly what's displayed (the board can't change once over).
let gameOverBoard = '';

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
const BASE_CELL = window.CELL;  // unzoomed cell size (matches --cell's CSS default)
let PITCH = window.CELL + 1;    // cell size + 1px grid gap; tracks the current zoom
const VIEW_BUFFER = 12;        // extra cells rendered beyond the viewport per side
const RECENTER_AT = 6;         // re-render when fewer than this many buffer cells remain
const ENABLE_WORD_MOVE = false; // temporarily disabled: dragging a placed word to move it

// Pinch-to-zoom (touch). 1.0 is the default, most-zoomed-in view; pinching out shrinks
// the cells to MIN_ZOOM (40% smaller) so more of the board shows at once, then pinching
// in returns to 1.0. Zoom changes the real cell size and re-renders, so all the existing
// PITCH-based coordinate math stays consistent — there's no separate CSS transform layer.
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1;
let zoomScale = 1;

// cellEls maps "row,col" (absolute, may be negative) → the cell <div>.
let cellEls = new Map();
// Top-left world coordinate and size of the currently rendered window.
let viewR0 = 0;
let viewC0 = 0;
let viewRows = 0;
let viewCols = 0;
// Cells currently carrying a preview class, so we can clear them cheaply.
let previewed = [];
// Set once no remaining bank word fits anywhere — the bank is then struck through.
let deadlocked = false;
// Timer that clears the Hint highlight after a few seconds (null when inactive).
let hintTimer = null;
// Becomes true once the player pans or starts a drag. Until then, a window resize
// (e.g. a phone rotating, or the mobile URL bar collapsing) re-centers on the seed
// word so it always starts centered; after the first interaction we leave the view
// where the player put it.
let hasInteracted = false;
// Blue overlay marking the bounding box of all filled cells.
let bboxEl = null;
// Currently-displayed crossword number tags, keyed "row,col" → the <span>. Kept so
// numbers can fade in/out across renders instead of blinking on/off.
let numEls = new Map();
// Bank-word ids already shown, so only freshly-dealt words animate in (renderBank
// rebuilds every chip each call, but carried-over words should not re-animate).
const seenBankIds = new Set();

const cellElAt = (r, c) => cellEls.get(`${r},${c}`);

// localStorage key for the in-progress board. The saved snapshot carries the day's
// seed so a board from a previous day is discarded rather than restored (see loadGame).
const STORAGE_KEY = 'crosshatch_game';

// Persist the current game (board, bank, score, RNG position) so a refresh or an
// accidental navigation restores exactly where the player left off. Best-effort:
// localStorage may be unavailable (private mode) or full, so failures are ignored.
function saveGame() {
  if (!game) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game.serialize()));
  } catch {}
}

// Read a saved game, but only if it belongs to today's puzzle — a board from a
// previous day is stale, so it's dropped and a fresh board is dealt instead.
// Returns the snapshot to restore, or null to start fresh.
function loadGame() {
  let saved;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!saved || saved.seedStr !== Game.todaySeed()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
  return saved;
}

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

// Scroll so that the given world point sits at the viewport center. Falls back to
// the window size if the wrap hasn't been measured yet, so centering is correct even
// on the very first paint regardless of window size.
function scrollWorldToCenter(worldRow, worldCol) {
  const wrap = document.querySelector('.board-wrap');
  const w = wrap.clientWidth || window.innerWidth;
  const h = wrap.clientHeight || window.innerHeight;
  wrap.scrollLeft = (worldCol - viewC0) * PITCH - w / 2;
  wrap.scrollTop = (worldRow - viewR0) * PITCH - h / 2;
}

// The world point currently at the center of the viewport.
function viewCenterWorld() {
  const wrap = document.querySelector('.board-wrap');
  return {
    row: viewR0 + (wrap.scrollTop + wrap.clientHeight / 2) / PITCH,
    col: viewC0 + (wrap.scrollLeft + wrap.clientWidth / 2) / PITCH,
  };
}

// Set the on-screen cell size (px) for the current zoom and keep the JS pitch and the
// drag controller's CELL in lockstep. Callers re-render afterward so the grid rebuilds
// at the new size.
function setCellSize(px) {
  window.CELL = px; // drag.js reads this live for ghost snapping
  PITCH = px + 1;
  document.documentElement.style.setProperty('--cell', `${px}px`);
}

// The world (row, col) point currently under a viewport pixel — the inverse of the
// PITCH-based layout. Fractional, so a zoom can re-anchor it precisely under a finger.
function clientToWorld(clientX, clientY) {
  const wrap = document.querySelector('.board-wrap');
  const rect = wrap.getBoundingClientRect();
  return {
    row: viewR0 + (clientY - rect.top + wrap.scrollTop) / PITCH,
    col: viewC0 + (clientX - rect.left + wrap.scrollLeft) / PITCH,
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
  clearHint();
  paintAllCells();
  ensureCoverage();
}

// Print a minified, schematic picture of the board to the console using white
// (filled) and black (empty) squares. Rather than drawing every cell, it collapses
// the "boring" straight stretches of each word — the cells that only carry a line
// forward — keeping just the structurally meaningful coordinates: word ends and
// crossings. So RUNNER crossing BANKER, however long, reduces to a clean 3×3 cross
// (a 3-square horizontal overlapping a 3-square vertical). Purely a debug view.
//
// Method: coordinate compression. A column is kept if it carries a vertical word
// (so each vertical word gets its own column) or is the end of a horizontal word
// (so stubs survive); rows are kept symmetrically. Interior pass-through cells
// collapse away. Within any single word every kept coordinate it spans is still
// filled, so its line stays continuous.
//
// The only "hard" lines are crossing lines: a column carrying a vertical word, a
// row carrying a horizontal word. Everything else — the stubs sticking out past a
// crossing, the straight runs between crossings — is filler that collapses. Each
// maximal run of non-crossing lines becomes a single band, so a word crossed in its
// middle shows as exactly stub · cross · stub, and two words crossing the same spine
// share one stub band on each side. A band that runs through a gap (e.g. APPEALED
// continuing between the two separate words that cross it) stays filled in its own
// column while the words beside it read as empty, keeping everything separated.
//
// Cells keep their colors: 🟦 for the original seed word, 🟨 for gift/bonus words,
// 🟩 where a seed and a gift word overlap, ⬛ for ordinary letters (crossings,
// stubs, and pass-throughs alike), ⬜ for empty.
function boardAscii() {
  const b = game.grid.bounds();
  if (!b) return '';
  const get = (r, c) => game.grid.get(r, c);
  const seedKeys = new Set(game.seedCells.map((c) => `${c.row},${c.col}`));
  const bonusKeys = game.bonusCells; // Set of "row,col"

  // Anchor columns hold a vertical word; anchor rows hold a horizontal word. Track
  // which lines are non-empty so empty filler can be dropped at the board's margins.
  const anchorCol = new Set(), anchorRow = new Set();
  const nonEmptyCol = new Set(), nonEmptyRow = new Set();
  for (const [r, c] of game.grid.entries()) {
    nonEmptyCol.add(c); nonEmptyRow.add(r);
    if (get(r - 1, c) || get(r + 1, c)) anchorCol.add(c);
    if (get(r, c - 1) || get(r, c + 1)) anchorRow.add(r);
  }

  // Walk one axis, emitting anchor coordinates as-is and collapsing each run of
  // non-anchor coordinates to a single band [lo,hi]. A band is kept if it holds any
  // letter (a stub or a pass-through) or if it's an interior gap between two anchors
  // (an empty separator that stops otherwise-adjacent words from fabricating a word).
  const track = (lo, hi, isAnchor, nonEmpty) => {
    const items = [];
    let start = null;
    const flush = (a, z, interior) => {
      let hasFill = false;
      for (let k = a; k <= z; k++) if (nonEmpty.has(k)) { hasFill = true; break; }
      if (hasFill || interior) items.push({ band: [a, z] });
    };
    for (let k = lo; k <= hi; k++) {
      if (isAnchor.has(k)) {
        if (start !== null) { flush(start, k - 1, items.length > 0); start = null; }
        items.push(k);
      } else if (start === null) start = k;
    }
    if (start !== null) flush(start, hi, false); // trailing run is a margin, not interior
    return items;
  };
  let rowItems = track(b.minR, b.maxR, anchorRow, nonEmptyRow);
  let colItems = track(b.minC, b.maxC, anchorCol, nonEmptyCol);

  const range = (x) => (typeof x === 'number' ? [x, x] : x.band);
  const wide = (x) => { const [a, z] = range(x); return z > a; };
  // True if any real cell in the row-band × col-band rectangle is filled.
  const filledRC = (R, C) => {
    const [r0, r1] = range(R), [c0, c1] = range(C);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (get(r, c)) return true;
    return false;
  };
  // Replace items[idx] (a multi-line band) with its first line and the rest, so a
  // band is peeled one line at a time.
  const splitItem = (items, idx) => {
    const [a, z] = range(items[idx]);
    return items.slice(0, idx).concat([{ band: [a, a] }, { band: [a + 1, z] }], items.slice(idx + 1));
  };

  // Faithfulness pass. The run-collapsing above can project two different words
  // onto one band, making them look adjacent when they never connect on the real
  // board. Repeatedly find a pair of touching blocks with NO real orthogonal
  // adjacency across their shared edge, then peel the responsible band one line
  // at a time. Simple crossings never trip this and stay fully collapsed; only
  // genuinely ambiguous dense regions expand, just enough to separate the words.
  for (;;) {
    let bad = null;
    for (let i = 0; i < rowItems.length && !bad; i++) {
      const [ra, rb] = range(rowItems[i]);
      for (let j = 0; j + 1 < colItems.length; j++) {
        if (!filledRC(rowItems[i], colItems[j]) || !filledRC(rowItems[i], colItems[j + 1])) continue;
        const cl = range(colItems[j])[1], cr = range(colItems[j + 1])[0]; // touching edge
        let witness = false;
        for (let r = ra; r <= rb; r++) if (get(r, cl) && get(r, cr)) { witness = true; break; }
        if (!witness) { bad = { dir: 'H', i, j }; break; }
      }
    }
    for (let j = 0; j < colItems.length && !bad; j++) {
      const [ca, cb] = range(colItems[j]);
      for (let i = 0; i + 1 < rowItems.length; i++) {
        if (!filledRC(rowItems[i], colItems[j]) || !filledRC(rowItems[i + 1], colItems[j])) continue;
        const rt = range(rowItems[i])[1], rd = range(rowItems[i + 1])[0]; // touching edge
        let witness = false;
        for (let c = ca; c <= cb; c++) if (get(rt, c) && get(rd, c)) { witness = true; break; }
        if (!witness) { bad = { dir: 'V', i, j }; break; }
      }
    }
    if (!bad) break;
    // Peel a band involved in the false adjacency (at least one always spans >1
    // line, else the edge cells themselves would witness it). Prefer the band
    // along the merge so the expansion is minimal.
    if (bad.dir === 'H') {
      if (wide(rowItems[bad.i])) rowItems = splitItem(rowItems, bad.i);
      else if (wide(colItems[bad.j])) colItems = splitItem(colItems, bad.j);
      else if (wide(colItems[bad.j + 1])) colItems = splitItem(colItems, bad.j + 1);
      else break; // defensive: nothing to split
    } else {
      if (wide(colItems[bad.j])) colItems = splitItem(colItems, bad.j);
      else if (wide(rowItems[bad.i])) rowItems = splitItem(rowItems, bad.i);
      else if (wide(rowItems[bad.i + 1])) rowItems = splitItem(rowItems, bad.i + 1);
      else break; // defensive: nothing to split
    }
  }

  // Glyph for a rendered cell: scan every real cell in its row-band × col-band and
  // pick a color by priority (seed+bonus overlap > seed > bonus > ordinary), or
  // empty if none is filled. A block holding both a seed and a gift cell — where
  // the original word and a gift word cross — reads green.
  const glyph = (R, C) => {
    const [r0, r1] = range(R), [c0, c1] = range(C);
    let seed = false, bonus = false, plain = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!get(r, c)) continue;
        const key = `${r},${c}`;
        // Checked independently so a single cell shared by the seed and a gift
        // word sets both flags (→ green), not just the first one matched.
        const isSeed = seedKeys.has(key), isBonus = bonusKeys.has(key);
        if (isSeed) seed = true;
        if (isBonus) bonus = true;
        if (!isSeed && !isBonus) plain = true;
      }
    }
    return seed && bonus ? '🟩' : seed ? '🟦' : bonus ? '🟨' : plain ? '⬛' : '⬜';
  };

  let out = '';
  for (const R of rowItems) {
    let line = '';
    for (const C of colItems) line += glyph(R, C);
    out += line + '\n';
  }
  return out.replace(/\n$/, ''); // drop the trailing newline
}

// Print the schematic board to the console (debug view).
function logBoardAscii() {
  const ascii = boardAscii();
  if (ascii) console.log(ascii);
}

// After a placement, check whether the puzzle has reached a dead end: the bank
// still holds words but none can be legally placed anywhere. If so, strike the
// remaining words through in red — they can no longer be played.
// Show the header Restart button once the game has ended — either the bank is empty
// (all words placed) or it's deadlocked (only unplaceable words remain) — and hide it
// otherwise. Idempotent, so it's safe to call after any state change.
function updateRestartButton() {
  const ended = !!game && (game.bank.length === 0 || deadlocked);
  restartBtn.hidden = !ended;
}

function checkDeadlock() {
  if (deadlocked || game.bank.length === 0) return; // empty bank = complete, not stuck
  if (game.anyPlaceable()) return;
  deadlocked = true;
  for (const chip of bankEl.querySelectorAll('.chip')) chip.classList.add('dead');
  setMessage('No moves left — no remaining word fits anywhere on the board.', 'error');
  updateRestartButton();
  setTimeout(() => openGameOver(false), 700);
}

// Remove any active Hint highlight and cancel its timer.
function clearHint() {
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  for (const el of boardEl.querySelectorAll('.cell.hint')) el.classList.remove('hint');
}

// Hint button: find a legal placement for some bank word, scroll it into view,
// and pulse the cells it would occupy. Times out after a few seconds.
function showHint() {
  if (!game || game.bank.length === 0 || deadlocked) return;
  const hint = game.findHint();
  if (!hint) { setMessage('No legal moves remain.', 'error'); return; }

  const cells = game.grid.cellsFor(hint.word, hint.row, hint.col, hint.orientation);
  // Center the rendered window on the suggested spot so every cell exists and is
  // visible, then highlight (cellElAt reads the freshly rebuilt cell map).
  let sumR = 0, sumC = 0;
  for (const c of cells) { sumR += c.row; sumC += c.col; }
  renderCenteredOn(sumR / cells.length + 0.5, sumC / cells.length + 0.5);

  clearHint();
  const flashed = [];
  for (const { row, col } of cells) {
    const el = cellElAt(row, col);
    if (!el) continue;
    el.classList.add('hint');
    flashed.push(el);
  }
  setMessage(`Hint: “${hint.word.toUpperCase()}” fits where it's highlighted.`);
  hintTimer = setTimeout(() => {
    flashed.forEach((el) => el.classList.remove('hint'));
    hintTimer = null;
  }, 4000);
}

function renderChip(item) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  if (item.bonus) chip.classList.add('bonus-chip');
  if (deadlocked) chip.classList.add('dead');
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

// Highlight the cells a candidate word would occupy, but only when the placement
// is legal — a valid fit reads green, an illegal one shows no fill at all.
function preview(word, row, col, orientation, valid) {
  if (!valid) return;
  const cells = game.grid.cellsFor(word, row, col, orientation);
  for (const { row: r, col: c } of cells) {
    const cell = cellElAt(r, c);
    if (!cell) continue;
    cell.classList.add('preview-good');
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
  hasInteracted = true; // a drag is underway; stop auto-recentering on resize
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

// The daily seed formatted as a zero-padded YYYY-MM-DD date for sharing.
function shareDate() {
  const [y, m, d] = game.seedStr.split('-');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// The shareable result: a header line with the day and score, then the mini board.
function shareText() {
  return `Crosshatch ${shareDate()}\nScore ${commafy(game.score)} · ${game.wordsPlaced} words\n\n${gameOverBoard}`;
}

// Copy the result to the clipboard (with a legacy fallback), flashing the hint.
async function copyResult() {
  const text = shareText();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    gameoverHintEl.textContent = 'Copied to clipboard!';
    gameoverHintEl.classList.add('copied');
    setTimeout(() => {
      gameoverHintEl.textContent = 'Tap the board to copy your result';
      gameoverHintEl.classList.remove('copied');
    }, 2000);
  } catch {
    gameoverHintEl.textContent = 'Copy failed — select and copy manually';
  }
}

// Open the end-of-game dialog. `completed` is true when the puzzle was finished,
// false when it ended in a dead end (no remaining word fits).
function openGameOver(completed) {
  gameOverBoard = boardAscii();
  gameoverTitleEl.textContent = completed ? 'Puzzle complete!' : 'No moves left';
  gameoverSubEl.textContent = completed
    ? `You placed all ${game.wordsPlaced} words. Nicely done!`
    : `You placed ${game.wordsPlaced} words before running out of moves.`;
  gameoverScoreEl.textContent = commafy(game.score);
  gameoverBoardEl.textContent = gameOverBoard;
  gameoverHintEl.textContent = 'Tap the board to copy your result';
  gameoverHintEl.classList.remove('copied');
  gameoverEl.hidden = false;
  fitGameOverBoard(); // must run after it's visible so widths can be measured
}

// Shrink the ASCII board's font so a wide board fits the dialog instead of being
// clipped. Compares the board's natural width to the modal's inner width and scales
// the font-size down proportionally (emoji scale with font-size, so columns stay
// aligned). Capped at the CSS base size for small boards.
function fitGameOverBoard() {
  const el = gameoverBoardEl;
  el.style.fontSize = ''; // reset to the CSS base before measuring
  const modal = el.closest('.modal');
  if (!modal) return;
  const avail = modal.clientWidth - 64; // minus the modal's horizontal padding (32+32)
  const natural = el.scrollWidth;
  if (natural > avail && avail > 0) {
    const base = parseFloat(getComputedStyle(el).fontSize) || 22;
    el.style.fontSize = `${Math.max(7, Math.floor(base * avail / natural))}px`;
  }
}

function closeGameOver() {
  gameoverEl.hidden = true;
}

// Wire the dialog's controls once at boot.
function wireGameOver() {
  gameoverBoardEl.addEventListener('click', copyResult);
  gameoverBoardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyResult(); }
  });
  document.getElementById('gameover-ok').addEventListener('click', closeGameOver);
  document.getElementById('gameover-close').addEventListener('click', closeGameOver);
  document.getElementById('gameover-restart').addEventListener('click', () => {
    closeGameOver();
    startGame();
  });
  gameoverEl.addEventListener('click', (e) => {
    if (e.target === gameoverEl) closeGameOver(); // click the dim backdrop to dismiss
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gameoverEl.hidden) closeGameOver();
  });
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
      saveGame(); // persist the board after every successful placement
      logBoardAscii();
      celebratePlacement(result.cells, result.gained, result.combo, result.placedBonus);
      if (game.bank.length === 0) {
        setMessage(`Daily puzzle complete — final score ${commafy(game.score)}.`);
        // Let the final placement's celebration play before the dialog covers it.
        setTimeout(() => openGameOver(true), 1100);
      } else if (result.bonusAdded) setMessage('★ Bonus word! Place the yellow tile for big points.', 'bonus');
      else if (result.bonusForfeited) setMessage('Bonus word expired — you placed another word.');
      else setMessage('');
      checkDeadlock();
      updateRestartButton();
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
      saveGame();
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
// empty space to pan, and pinch with two fingers to zoom. Panning is incremental so
// a mid-pan re-render never jumps.
function initBoardPointer(wrap) {
  let lastX = 0, lastY = 0;
  let panning = false;

  // Pan via window listeners (no pointer capture, so click events still fire).
  const panMove = (e) => {
    wrap.scrollLeft -= e.clientX - lastX;
    wrap.scrollTop -= e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  };
  const panEnd = () => {
    panning = false;
    wrap.classList.remove('panning');
    window.removeEventListener('pointermove', panMove);
    window.removeEventListener('pointerup', panEnd);
    window.removeEventListener('pointercancel', panEnd);
  };

  // --- Pinch-to-zoom (two touch fingers) ---
  const touches = new Map(); // active touch pointers: id -> { x, y }
  let pinch = null;          // { startDist, startScale, focus } while two fingers are down
  let pinchPending = false;  // rAF throttle so the board re-renders at most once per frame

  const twoPoints = () => [...touches.values()];
  const pinchDist = () => { const [a, b] = twoPoints(); return Math.hypot(a.x - b.x, a.y - b.y); };
  const pinchMid = () => { const [a, b] = twoPoints(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

  function beginPinch() {
    if (panning) panEnd();  // a one-finger pan was underway; hand the gesture to the pinch
    hasInteracted = true;   // stop auto-recentering on resize
    const m = pinchMid();
    pinch = {
      startDist: pinchDist() || 1,
      startScale: zoomScale,
      focus: clientToWorld(m.x, m.y), // world point under the pinch center, held fixed
    };
  }

  // Recompute the zoom from the current finger spread, re-render the board at the new
  // cell size, then scroll so the held focus point sits back under the live finger
  // midpoint — so the board appears to zoom around the pinch center.
  function applyPinch() {
    pinchPending = false;
    if (!pinch || touches.size < 2) return;
    const m = pinchMid();
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.startScale * (pinchDist() / pinch.startDist)));
    zoomScale = scale;
    const px = Math.round(BASE_CELL * scale);
    if (px !== window.CELL) setCellSize(px);

    const vc = viewportCells();
    const cols = vc.cols + 2 * VIEW_BUFFER;
    const rows = vc.rows + 2 * VIEW_BUFFER;
    renderWindow(Math.round(pinch.focus.row) - Math.floor(rows / 2),
                 Math.round(pinch.focus.col) - Math.floor(cols / 2), rows, cols);
    const rect = wrap.getBoundingClientRect();
    wrap.scrollLeft = (pinch.focus.col - viewC0) * PITCH - (m.x - rect.left);
    wrap.scrollTop = (pinch.focus.row - viewR0) * PITCH - (m.y - rect.top);
  }

  const pinchMove = (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && !pinchPending) {
      pinchPending = true;
      requestAnimationFrame(applyPinch);
    }
  };
  const pinchDrop = (e) => {
    if (!touches.delete(e.pointerId)) return;
    if (pinch && touches.size < 2) {
      pinch = null;
      ensureCoverage(); // top up the rendered window now that the zoom has settled
    }
  };
  window.addEventListener('pointermove', pinchMove);
  window.addEventListener('pointerup', pinchDrop);
  window.addEventListener('pointercancel', pinchDrop);

  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { beginPinch(); return; } // second finger → start pinching
      if (touches.size > 2) return;
    }
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
    hasInteracted = true; // stop auto-recentering once the player moves the board
    lastX = e.clientX; lastY = e.clientY;
    panning = true;
    wrap.classList.add('panning');
    window.addEventListener('pointermove', panMove);
    window.addEventListener('pointerup', panEnd);
    window.addEventListener('pointercancel', panEnd);
  });

  // Top up coverage as the view scrolls/pans (throttled to one check per frame). A
  // pinch drives its own re-render and anchors the focus by hand, so skip it then.
  let pending = false;
  wrap.addEventListener('scroll', () => {
    if (pinch || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      ensureCoverage();
    });
  });
}

// Start (or restart) the current day's game: fresh board, bank, and score, then
// render centered on the seed word. Safe to call repeatedly (the Restart button).
// With a `saved` snapshot (from loadGame on boot) the prior in-progress board is
// restored instead of dealing fresh; the Restart button passes nothing for a reset.
function startGame(saved = null) {
  game = new Game(undefined, saved);
  deadlocked = false;
  zoomScale = 1;             // a fresh/restarted game starts at the default zoom
  setCellSize(BASE_CELL);
  hasInteracted = false; // a fresh game re-centers on resize until the player acts
  seenBankIds.clear();
  lastOrientation = 'h';
  clearPreview();
  renderBank();
  updateStats();
  setMessage('');
  updateRestartButton(); // hidden for a fresh game; shown if a restored board is already complete
  saveGame(); // persist the starting (or restored) board immediately

  // Render once layout is known, centered on the seed word, filling the viewport.
  requestAnimationFrame(() => {
    centerOnSeed();
    checkDeadlock();
    updateRestartButton(); // checkDeadlock may have just flagged a restored dead end
  });
}

// Center the rendered window on the anchor/seed word — the center of the filled
// bounding box (just the seed word at game start).
function centerOnSeed() {
  if (!game) return;
  const b = game.grid.bounds() || { minR: 0, maxR: 0, minC: 0, maxC: 0 };
  renderCenteredOn((b.minR + b.maxR) / 2 + 0.5, (b.minC + b.maxC) / 2 + 0.5);
}

// Bootstrap: load the vetted word lists, wire one-time handlers, then start.
async function boot() {
  setMessage('Loading word list…');
  try {
    await window.loadWords();
  } catch (e) {
    setMessage('Failed to load word list. Is the server running?', 'error');
    throw e;
  }

  const wrap = document.querySelector('.board-wrap');
  initBoardPointer(wrap);
  wireGameOver();
  document.getElementById('hint-btn').addEventListener('click', showHint);
  // Header Restart button (visible only after the game ends): replay today's seed.
  restartBtn.addEventListener('click', () => { closeGameOver(); startGame(); });

  // Keep the anchor word centered across window-size changes until the player acts
  // (orientation flips, mobile URL-bar collapse, desktop window resize). Re-rendered
  // on the next frame so the new viewport size is measured first.
  window.addEventListener('resize', () => {
    if (hasInteracted || !game) return;
    requestAnimationFrame(centerOnSeed);
  });

  // Restore today's in-progress board if one was saved; otherwise deal a fresh one.
  startGame(loadGame());
}

boot();
