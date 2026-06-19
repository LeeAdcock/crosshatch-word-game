// Game state: the board, the bank, the score, and the placement loop.

const BANK_SIZE = 11;
const MAX_WORDS = 50; // a game offers at most this many words (a daily puzzle)

// Deterministic PRNG (fnv-1a hash → mulberry32) seeded from a string, so a given
// seed always produces the same board.
function makeRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Game {
  // `seed` defaults to today's date, so each day plays the same board.
  constructor(seed = Game.todaySeed()) {
    this.rng = makeRng(seed);
    this.grid = new Grid();
    this.bank = []; // array of { id, word }
    this.score = 0;
    this.wordsPlaced = 0;
    this.nextId = 1;
    this.bonus = 0; // accumulated combo bonus, added on top of the density score
    this.drawn = 0; // total bank words ever dealt; capped at MAX_WORDS
    this.used = new Set(); // every word dealt this game, so none repeats
    this.maxWords = MAX_WORDS;

    // Bucket the bank pool by word length so we can guarantee variety.
    this.buckets = {};
    for (const w of window.BANK_POOL) {
      (this.buckets[w.length] = this.buckets[w.length] || []).push(w);
    }
    this.lengths = Object.keys(this.buckets).map(Number).sort((a, b) => a - b);

    this.seed();
  }

  // Date string "YYYY-M-D" used as the default daily seed.
  static todaySeed() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // Random word of a given length (or any length when omitted), never repeating
  // a word already dealt this game. Falls back to the full pool only if every
  // word of that length has been used (won't happen within the 50-word cap).
  drawWord(length) {
    const pool = length ? this.buckets[length] : window.BANK_POOL;
    let candidates = pool.filter((w) => !this.used.has(w));
    if (candidates.length === 0) candidates = pool;
    const word = candidates[Math.floor(this.rng() * candidates.length)];
    this.used.add(word);
    return word;
  }

  // How many bank words currently exist of each available length.
  lengthCounts() {
    const counts = {};
    for (const len of this.lengths) counts[len] = 0;
    for (const item of this.bank) counts[item.word.length]++;
    return counts;
  }

  // Desired number of bank words of each length: two of every length, plus one
  // extra of the longest so the bank always holds an additional long word.
  targetFor(len) {
    return len === this.lengths[this.lengths.length - 1] ? 3 : 2;
  }

  // The length whose bank count is furthest below its target (ties broken
  // randomly). Filling this keeps the spread of lengths and the guaranteed
  // extra long word — with 11 slots over lengths 3–7 that's 2/2/2/2/3.
  varietyLength() {
    const counts = this.lengthCounts();
    let best = [];
    let bestDeficit = -Infinity;
    for (const len of this.lengths) {
      const deficit = this.targetFor(len) - counts[len];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = [len];
      } else if (deficit === bestDeficit) {
        best.push(len);
      }
    }
    return best[Math.floor(this.rng() * best.length)];
  }

  // Place a starting seed word (a mid-length word) horizontally around the
  // origin, then fill the bank with a variety of lengths.
  seed() {
    const seedLen = this.lengths.includes(5) ? 5 : this.lengths[Math.floor(this.lengths.length / 2)];
    const word = this.drawWord(seedLen);
    const row = 0;
    const col = -Math.floor(word.length / 2);
    this.grid.placeWord(word, row, col, 'h');
    this.seedCells = this.grid.cellsFor(word, row, col, 'h');
    for (let i = 0; i < BANK_SIZE; i++) this.addBankWord();
    this.score = this.computeScore();
  }

  // Deal one more bank word, unless the game's word budget is exhausted (then
  // the bank simply shrinks as words are placed and the game winds down).
  addBankWord() {
    if (this.drawn >= MAX_WORDS) return;
    this.bank.push({ id: this.nextId++, word: this.drawWord(this.varietyLength()) });
    this.drawn += 1;
  }

  bankItem(id) {
    return this.bank.find((b) => b.id === id);
  }

  // Validate a candidate placement of any word against the current board (left
  // untouched). The first word on an empty board may go anywhere; this matters
  // when a moved word was the board's only word.
  checkWord(word, row, col, orientation) {
    return window.validatePlacement(this.grid, word, row, col, orientation, this.grid.isEmpty());
  }

  // How many of the word's cells land on a matching existing letter, ignoring
  // overall validity. Used to choose which orientation is "closest to snapping"
  // onto an existing word during auto-rotate.
  overlapCountWord(word, row, col, orientation) {
    let n = 0;
    for (const { row: r, col: c, letter } of this.grid.cellsFor(word, row, col, orientation)) {
      if (this.grid.get(r, c) === letter) n++;
    }
    return n;
  }

  // The word run through (row, col) along an axis ('h' or 'v'), as
  // { word, row, col, orientation } where row,col is the run's start cell.
  wordAt(row, col, axis) {
    if (axis === 'h') {
      return { word: this.grid.horizontalRun(row, col), row, col: this.grid.runStartCol(row, col), orientation: 'h' };
    }
    return { word: this.grid.verticalRun(row, col), row: this.grid.runStartRow(row, col), col, orientation: 'v' };
  }

  // Lift a word off the board so it can be dragged: clear the cells it occupies
  // EXCEPT those shared with a crossing word (length ≥ 2 perpendicular run),
  // which belong to that other word. Returns the run descriptor for restoring.
  liftWord(run) {
    const cells = this.grid.cellsFor(run.word, run.row, run.col, run.orientation);
    const toClear = [];
    for (const { row, col } of cells) {
      const perp = run.orientation === 'h'
        ? this.grid.verticalRun(row, col)
        : this.grid.horizontalRun(row, col);
      if (perp.length < 2) toClear.push({ row, col });
    }
    for (const { row, col } of toClear) this.grid.set(row, col, null);
    this.score = this.computeScore();
    return run;
  }

  // Put a lifted word back exactly where it was (invalid drop or cancel).
  restoreLifted(run) {
    this.grid.placeWord(run.word, run.row, run.col, run.orientation);
    this.score = this.computeScore();
  }

  // Commit a lifted word at a new, already-validated position.
  commitMove(run, row, col, orientation) {
    this.grid.placeWord(run.word, row, col, orientation);
    this.score = this.computeScore();
  }

  // Sum of Scrabble letter values over every filled cell (each cell once, so
  // crossing letters are not double-counted).
  boardLetterSum() {
    let sum = 0;
    for (const letter of this.grid.cells.values()) sum += window.LETTER_SCORES[letter] || 0;
    return sum;
  }

  // Cells in the bounding box of the filled area (filled + empty cells inside).
  boundingArea() {
    const b = this.grid.bounds();
    if (!b) return 0;
    return (b.maxR - b.minR + 1) * (b.maxC - b.minC + 1);
  }

  // Point density: total letter value per bounding-box cell. Packing high-value
  // letters tightly raises it; spreading words out lowers it.
  density() {
    const area = this.boundingArea();
    return area ? this.boardLetterSum() / area : 0;
  }

  // The score rewards both efficient packing and progress, scaled ×100 for
  // readable whole numbers, plus accumulated multi-word combo bonuses.
  computeScore() {
    return (this.density() / 0.5) * this.wordsPlaced * 100 + this.bonus;
  }

  // Bonus for a placement that forms `count` words at once (triangular growth):
  // 2 → 50, 3 → 150, 4 → 300, 5 → 500. One word forms no combo.
  static comboBonus(count) {
    return count >= 2 ? 50 * (count * (count - 1) / 2) : 0;
  }

  // Commit a placement: write to board, recompute the density score, refill the
  // bank slot. Returns { ok, gained, score } or { ok: false, reason }.
  place(id, row, col, orientation) {
    const item = this.bankItem(id);
    if (!item) return { ok: false, reason: 'Unknown word' };

    const result = window.validatePlacement(this.grid, item.word, row, col, orientation);
    if (!result.valid) return { ok: false, reason: result.reason };

    const before = this.score;
    const placedCells = this.grid.cellsFor(item.word, row, col, orientation);
    const newlyFilled = placedCells.filter(({ row: r, col: c }) => this.grid.get(r, c) === null);
    this.grid.placeWord(item.word, row, col, orientation);

    // Count the words this placement formed; reward forming several at once.
    const formed = this.grid.formedWords(placedCells, newlyFilled);
    const comboBonus = Game.comboBonus(formed.length);
    this.bonus += comboBonus;
    this.wordsPlaced++;
    this.score = this.computeScore();

    // Remove from bank and draw a replacement (endless).
    this.bank = this.bank.filter((b) => b.id !== id);
    this.addBankWord();

    return {
      ok: true,
      gained: this.score - before,
      score: this.score,
      cells: placedCells,
      combo: formed.length >= 2 ? { count: formed.length, bonus: comboBonus } : null,
    };
  }
}

window.Game = Game;
window.BANK_SIZE = BANK_SIZE;
window.MAX_WORDS = MAX_WORDS;
