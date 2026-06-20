// Bonus-word derivation.
//
// Every few placements the game rewards the player with a "bonus word" that is
// NOT drawn from the common bank pool, but derived from the current board. The
// goal is the feeling "wow, this word fits in here perfectly" — so the choice is
// driven first by FIT and only then by raw value:
//   • connections — how many OTHER words the placement crosses or creates at once
//   • Scrabble value — a tiebreaker, so among equally-connected fits we pick a juicy word
// deriveBonusWord() returns { word, row, col, orientation } (a known-legal spot)
// or null if nothing fits (effectively never on a non-empty board).
//
// Two generators feed the search:
//   1. A crossword fill over each board line: for every window of cells along a
//      row/column that already holds ≥2 letters, find dictionary words matching
//      those fixed letters. These are the well-connected "perfect fit" plays.
//   2. A high-value single-crossing fallback, so sparse boards (and the very
//      first bonus) still yield a strong word.
// The best-connecting fit across both wins, with Scrabble value breaking ties.
//
// Pure function of the board — no RNG, so the deterministic daily seed is safe.

const MIN_BONUS_LEN = 4;
const MAX_BONUS_LEN = 8;
const FALLBACK_POOL = 4000;   // top-value words considered by the single-crossing fallback
const MATCH_LIMIT = 40;       // matches scored per fill window (buckets are value-sorted)
const MAX_VALIDATIONS = 4000; // global safety cap on validatePlacement calls per derivation

// Fit weight. Each other word the placement connects to (crosses or creates) is
// worth more than the whole Scrabble value range, so the best-connected word always
// wins and value only breaks ties among equally-connected fits.
const CONNECT_SCORE = 100;

// Dictionary indexes, built once (the corpus is ~274k words):
//   _byLenPos[L][i] — Map(letter → words of length L with that letter at index i),
//     each list value-sorted (band is pre-sorted, so leaves inherit the order). This
//     lets a fill window jump straight to words matching a fixed letter/position
//     instead of scanning a whole length bucket.
//   _topValue — the highest-value band words, for the single-crossing fallback.
let _byLenPos = null;
let _topValue = null;
function buildIndexes() {
  if (_byLenPos) return;
  const band = [];
  for (const w of window.DICTIONARY) {
    if (w.length >= MIN_BONUS_LEN && w.length <= MAX_BONUS_LEN) band.push(w);
  }
  band.sort((a, b) => window.wordScore(b) - window.wordScore(a)); // value desc, once
  _byLenPos = {};
  for (const w of band) {
    const L = w.length;
    let slots = _byLenPos[L];
    if (!slots) { slots = _byLenPos[L] = []; for (let i = 0; i < L; i++) slots[i] = new Map(); }
    for (let i = 0; i < L; i++) {
      const m = slots[i];
      const list = m.get(w[i]);
      if (list) list.push(w); else m.set(w[i], [w]); // inherits value-desc order
    }
  }
  _topValue = band.slice(0, FALLBACK_POOL);
}

// Words of length L matching a fixed [{pos, letter}] pattern, value-sorted. Starts
// from the smallest matching letter/position list and filters by the rest.
function matchesFor(L, fixed) {
  const slots = _byLenPos[L];
  if (!slots) return [];
  let base = null;
  for (const { pos, letter } of fixed) {
    const list = slots[pos].get(letter);
    if (!list) return []; // no word has this letter here → window impossible
    if (!base || list.length < base.length) base = list;
  }
  return base.filter((w) => fixed.every(({ pos, letter }) => w[pos] === letter));
}

// How many OTHER words a placement connects to — existing words it crosses plus
// new words it creates. runsThrough returns every word-length run through the
// placed cells (including the bonus word's own run, which we subtract), so this
// counts both crossings and freshly-formed cross words in one number. Tentative
// write / measure / erase, like validatePlacement, leaving the board untouched.
function connectionCount(grid, word, row, col, orientation) {
  const placedCells = grid.cellsFor(word, row, col, orientation);
  const newlyFilled = placedCells.filter(({ row: r, col: c }) => grid.get(r, c) === null);
  grid.placeWord(word, row, col, orientation);
  const runs = grid.runsThrough(placedCells).length;
  grid.eraseCells(newlyFilled);
  return Math.max(0, runs - 1);
}

function fitScore(grid, word, row, col, orientation) {
  return CONNECT_SCORE * connectionCount(grid, word, row, col, orientation) + window.wordScore(word);
}

// Mutable best-fit accumulator shared by both generators.
function makeTracker() {
  return { best: null, bestFit: -Infinity, validations: 0 };
}
function consider(tracker, grid, word, row, col, orientation) {
  if (tracker.validations >= MAX_VALIDATIONS) return false;
  tracker.validations++;
  const res = window.validatePlacement(grid, word, row, col, orientation, false);
  if (!res.valid) return true;
  const fit = fitScore(grid, word, row, col, orientation);
  if (fit > tracker.bestFit) {
    tracker.bestFit = fit;
    tracker.best = { word, row, col, orientation };
  }
  return true;
}

// Generator 1 — crossword fill. For one line (a row when orientation 'h', a
// column when 'v') we know the filled cells [{at, letter}] along it ("at" is the
// varying coordinate). For each word length and each offset whose window covers
// ≥2 of those filled cells, find dictionary words matching the fixed letters and
// score them. Windows covering more fixed cells (deeper threads) are tried first.
function fillLine(tracker, grid, orientation, fixedLine, filled, exclude) {
  const ats = filled.map((f) => f.at);
  const lo = Math.min(...ats);
  const hi = Math.max(...ats);
  const letterAt = new Map(filled.map((f) => [f.at, f.letter]));

  // Slide a window of each length across the filled span; keep any that cover ≥2
  // filled cells (so the word threads through ≥2 existing words — adjacent OR
  // separated). Deeper-threading windows are scored first.
  const windows = [];
  for (let L = MIN_BONUS_LEN; L <= MAX_BONUS_LEN; L++) {
    for (let start = lo - L + 1; start <= hi; start++) {
      const fixed = [];
      for (let i = 0; i < L; i++) {
        const letter = letterAt.get(start + i);
        if (letter) fixed.push({ pos: i, letter });
      }
      if (fixed.length >= 2) windows.push({ L, start, fixed });
    }
  }
  windows.sort((a, b) => b.fixed.length - a.fixed.length);

  for (const { L, start, fixed } of windows) {
    let matched = 0;
    for (const word of matchesFor(L, fixed)) {
      if (exclude && exclude.has(word)) continue;
      const row = orientation === 'h' ? fixedLine : start;
      const col = orientation === 'h' ? start : fixedLine;
      if (!consider(tracker, grid, word, row, col, orientation)) return; // hit global cap
      if (++matched >= MATCH_LIMIT) break;
    }
  }
}

// Generator 2 — high-value single-crossing fallback. Cross each board anchor with
// the highest-value words so a placeable strong word always exists.
function fallback(tracker, grid, anchors, exclude) {
  for (const word of _topValue) {
    if (exclude && exclude.has(word)) continue;
    const seen = new Set();
    for (const { row: r, col: c, letter: L } of anchors) {
      for (let i = 0; i < word.length; i++) {
        if (word[i] !== L) continue;
        for (const [orientation, row, col] of [['v', r - i, c], ['h', r, c - i]]) {
          const key = `${orientation}:${row}:${col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!consider(tracker, grid, word, row, col, orientation)) return; // hit global cap
        }
      }
    }
  }
}

function deriveBonusWord(grid, exclude) {
  buildIndexes();

  // Board letters, grouped into lines (rows and columns) and a flat anchor list.
  const anchors = [];
  const rows = new Map(); // row -> [{at: col, letter}]
  const cols = new Map(); // col -> [{at: row, letter}]
  for (const [row, col, letter] of grid.entries()) {
    anchors.push({ row, col, letter });
    (rows.get(row) || rows.set(row, []).get(row)).push({ at: col, letter });
    (cols.get(col) || cols.set(col, []).get(col)).push({ at: row, letter });
  }
  if (anchors.length === 0) return null; // empty board — nothing to build on

  const tracker = makeTracker();
  for (const [r, filled] of rows) if (filled.length >= 2) fillLine(tracker, grid, 'h', r, filled, exclude);
  for (const [c, filled] of cols) if (filled.length >= 2) fillLine(tracker, grid, 'v', c, filled, exclude);
  fallback(tracker, grid, anchors, exclude);

  return tracker.best;
}

window.deriveBonusWord = deriveBonusWord;
