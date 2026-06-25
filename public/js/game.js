// Game state: the board, the bank, the score, and the placement loop.

const BANK_SIZE = 10;
const MAX_WORDS = 25; // a game offers at most this many words (a daily puzzle)
const BONUS_EVERY = 5; // every Nth placement earns a board-derived bonus word
const PLURAL_WEIGHT = 0.3; // plurals are drawn at ~30% their natural rate (reduced, not removed)

// Heuristic: a word is "likely plural" if stripping its plural ending leaves a
// real word — cats→cat, boxes→box, berries→berry. Excludes -ss/-us/-is endings
// (class, bus, axis) and very short words (gas, bus), which only look plural.
// Also catches 3rd-person verbs (runs→run), which read as "already inflected"
// the same way. Needs window.DICTIONARY, which is loaded before any Game exists.
function isLikelyPlural(word) {
  if (word.length < 4 || !word.endsWith('s')) return false;
  if (/(ss|us|is)$/.test(word)) return false;
  if (word.endsWith('ies') && window.DICTIONARY.has(word.slice(0, -3) + 'y')) return true;
  if (word.endsWith('es') && window.DICTIONARY.has(word.slice(0, -2))) return true;
  return window.DICTIONARY.has(word.slice(0, -1));
}

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
    this.bonusCells = new Set(); // "row,col" keys of placed bonus-word letters (rendered yellow)

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
  // word of that length has been used (won't happen within the 25-word cap).
  // Plurals are down-weighted (not excluded) so fewer reach the bank.
  drawWord(length) {
    const pool = length ? this.buckets[length] : window.BANK_POOL;
    let candidates = pool.filter((w) => !this.used.has(w));
    if (candidates.length === 0) candidates = pool;
    const word = this.weightedPick(candidates);
    this.used.add(word);
    return word;
  }

  // Pick one word at random, weighting plurals down by PLURAL_WEIGHT so they
  // appear at a fraction of their natural rate without ever being eliminated.
  // Deterministic via this.rng, so the daily board stays stable.
  weightedPick(candidates) {
    const weights = candidates.map((w) => (isLikelyPlural(w) ? PLURAL_WEIGHT : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      if ((r -= weights[i]) < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // How many bank words currently exist of each available length.
  lengthCounts() {
    const counts = {};
    for (const len of this.lengths) counts[len] = 0;
    for (const item of this.bank) counts[item.word.length]++;
    return counts;
  }

  // Desired number of bank words of each length. Shorter words dominate (they
  // cross easily and keep the game flowing); longer words appear but stay a
  // minority. The values must sum to BANK_SIZE; lengths absent here (or absent
  // from the pool) simply never appear. Tune this to reshape the bank.
  targetFor(len) {
    return Game.LENGTH_TARGETS[len] || 0;
  }

  // The length whose bank count is furthest below its target (ties broken
  // randomly). Filling this keeps the bank's spread of word lengths even.
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

  // Add a board-derived bonus word as an extra chip, flagged so the UI renders
  // it yellow. A bonus only counts against MAX_WORDS when it's actually placed
  // (see place()), so none is offered once the word budget is fully dealt.
  // Returns whether one was added.
  addBonusWord() {
    if (this.drawn >= MAX_WORDS) return false;
    const found = window.deriveBonusWord(this.grid, this.used);
    if (!found) return false;
    this.used.add(found.word);
    this.bank.push({ id: this.nextId++, word: found.word, bonus: true });
    return true;
  }

  bankItem(id) {
    return this.bank.find((b) => b.id === id);
  }

  // Cells worth testing as a placement anchor: every filled cell (a word can cross
  // it) and every empty cell orthogonally adjacent to a filled one (a word can abut
  // it). Anywhere else can't connect, so it can never hold a legal placement.
  candidateAnchors() {
    const seen = new Set();
    const anchors = [];
    const add = (r, c) => {
      const key = `${r},${c}`;
      if (seen.has(key)) return;
      seen.add(key);
      anchors.push({ row: r, col: c });
    };
    for (const [r, c] of this.grid.entries()) {
      add(r, c);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.grid.get(r + dr, c + dc)) add(r + dr, c + dc);
      }
    }
    return anchors;
  }

  // True if at least one bank word can be legally placed somewhere. For each anchor
  // we try every word, orientation, and letter-alignment (sliding the word so each
  // of its letters lands on the anchor), stopping at the first legal placement. The
  // happy path exits almost immediately; only a true dead end scans exhaustively.
  anyPlaceable() {
    const anchors = this.candidateAnchors();
    for (const { word } of this.bank) {
      for (const { row: ar, col: ac } of anchors) {
        for (const orientation of ['h', 'v']) {
          for (let i = 0; i < word.length; i++) {
            const row = orientation === 'v' ? ar - i : ar;
            const col = orientation === 'h' ? ac - i : ac;
            if (window.validatePlacement(this.grid, word, row, col, orientation).valid) return true;
          }
        }
      }
    }
    return false;
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

    const wasBonus = !!item.bonus;
    const before = this.score;
    const placedCells = this.grid.cellsFor(item.word, row, col, orientation);
    const newlyFilled = placedCells.filter(({ row: r, col: c }) => this.grid.get(r, c) === null);
    this.grid.placeWord(item.word, row, col, orientation);

    // Every cell of a bonus word reads yellow — including the letters it shares
    // with words it crosses — so the whole bonus word is visibly highlighted.
    if (wasBonus) for (const { row: r, col: c } of placedCells) this.bonusCells.add(`${r},${c}`);

    // Count the words this placement formed; reward forming several at once.
    const formed = this.grid.formedWords(placedCells, newlyFilled);
    const comboBonus = Game.comboBonus(formed.length);
    this.bonus += comboBonus;
    this.wordsPlaced++;
    this.score = this.computeScore();

    // Remove the placed word from the bank.
    this.bank = this.bank.filter((b) => b.id !== id);

    // Placing any NON-bonus word forfeits an outstanding bonus (it only lingers for
    // the immediate next move) and draws a normal replacement. A placed bonus is
    // not replaced, but it DOES consume one slot of the MAX_WORDS budget (drawn++),
    // so every bonus used means one fewer normal word dealt — the game still totals
    // MAX_WORDS placements. Then every BONUS_EVERY placements earn a fresh bonus.
    let bonusForfeited = false;
    if (!wasBonus) {
      if (this.bank.some((b) => b.bonus)) {
        this.bank = this.bank.filter((b) => !b.bonus);
        bonusForfeited = true;
      }
      this.addBankWord();
    } else {
      this.drawn += 1;
    }
    const bonusAdded = this.wordsPlaced % BONUS_EVERY === 0 ? this.addBonusWord() : false;

    return {
      ok: true,
      gained: this.score - before,
      score: this.score,
      cells: placedCells,
      combo: formed.length >= 2 ? { count: formed.length, bonus: comboBonus } : null,
      placedBonus: wasBonus, // this placement was a bonus word (flash its connections yellow)
      bonusAdded,            // this placement earned a NEW bonus word
      bonusForfeited,        // this placement removed an unused bonus word
    };
  }
}

// Standing composition of the 10-slot bank by word length (sums to BANK_SIZE):
// weighted toward 4–6, with a single 8 and 9 so longer words show up but stay
// rare. Lengths not listed never enter the bank.
Game.LENGTH_TARGETS = { 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1, 9: 1 };

window.Game = Game;
window.BANK_SIZE = BANK_SIZE;
window.MAX_WORDS = MAX_WORDS;
