# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node server.js            # run the game on http://localhost:8000 (no install needed)
PORT=3000 node server.js  # custom port
npm install               # only needed to regenerate word lists (dev-only deps)
npm run words             # regenerate public/data/{dictionary,bank}.txt from npm word packages
```

There is **no build step, no bundler, no linter, and no test suite.** The game is
dependency-free vanilla JS served as static files; `node_modules` exists only for
`scripts/build-words.js`. The word data (`public/data/*.txt`) is committed, so the
game runs with a clean checkout and no `npm install`.

## Deployment

The production site is a **Cloudflare Worker with static assets** serving `public/`,
live at <https://crosshatch-word-game.lee-06e.workers.dev/>. No server code runs in
production — `server.js` is local-dev only. The Cloudflare build command is empty and
the deploy serves `public/` directly (the committed word lists mean no build/install
is needed). The GitHub remote is `LeeAdcock/crosshatch-word-game`.

To verify a change locally without a browser, the client modules can be loaded under
Node with a small `global.window` shim + `vm` context (they only need `window`,
`DICTIONARY`, and `BANK_POOL`) — useful for reproducing a deterministic daily game or
exercising `validatePlacement`/`deriveBonusWord`/`findHint` headlessly.

## Architecture

The app is a single-page browser game. `server.js` is a minimal static file server
with **no game logic** — all logic is client-side under `public/js/`.

### Global namespace, no modules

There is no module system. Each file in `public/js/` defines classes/functions and
attaches them to `window` (e.g. `window.Grid`, `window.validatePlacement`,
`window.isWord`). `index.html` loads scripts in **strict dependency order**:
`words → dictionary → grid → placement → bonus → holidays → game → drag → main →
instructions → theme`. Adding a new file means inserting a `<script>` tag in the right position;
cross-file calls go through `window.*`. (`theme.js` is also bootstrapped by a tiny
inline `<head>` script that sets `data-theme` before first paint — see Theming.)

### The board model is sparse and infinite (`grid.js`)

`Grid` stores only filled cells in a `Map` keyed `"row,col"` → lowercase letter.
Coordinates are unbounded and may be negative; `inBounds()` always returns true.
The seed word is placed around the origin `(0,0)`. `main.js` renders only a window
covering the viewport plus a buffer and re-centers as the user pans, so the infinite
board appears endless without rendering every cell.

The grid's job beyond storage is **run extraction**: `runsThrough(cells)` returns
every maximal horizontal/vertical run of length ≥ 2 passing through a set of cells.
This is the foundation of validation — a "word" on the board is any such run.

### Strict crossword validation (`placement.js`)

`validatePlacement(grid, word, row, col, orientation, firstMove)` is the rules core.
It works by **tentative write + rollback**: it writes the word, checks every run the
placement produces (`grid.runsThrough`), then erases the cells it newly filled,
leaving the board untouched. The caller commits separately only on success. Rules:

1. No cell may be blocked.
2. Overlapping cells must already hold the same letter (`crossings` are counted).
3. Unless `firstMove`, the word must **connect** — overlap an existing letter or sit
   orthogonally adjacent (abutment forms new words, e.g. `CAT`+`S` → `CATS`).
4. **Every** resulting run ≥ 2 letters must be a real dictionary word (`isWord`),
   including incidental cross/parallel words.

`isWord` (`dictionary.js`) treats single letters as always valid (an isolated letter
is not a word run). The dictionary is the full ~274k-word corpus; the bank pool is a
separate, smaller list of common words.

### Game state and scoring (`game.js`)

`Game` owns the grid, the bank, and the score. Key behaviors:

- **Deterministic daily seed:** `makeRng` (fnv-1a → mulberry32) is seeded from a
  date string (`"YYYY-M-D"`), so everyone gets the same board each day. Any
  string seed reproduces a board exactly.
- **Length-varied bank:** the bank pool is bucketed by word length; `varietyLength`
  refills the slot whose length is furthest below its target, keeping a spread of
  lengths. A game deals at most `MAX_WORDS`.
- **Geometric scoring:** `computeScore` is purely geometric and letter-agnostic —
  `SCORE_SCALE × fillRatio × (INTERLOCK_BASE + interlock) × wordsPlaced`. It rewards
  the two things skill actually controls: **density** (`fillRatio` = filled cells /
  `boundingArea`) and **interconnection** (`interlock` = cumulative `crossings` per
  word). Because density and interconnection *multiply*, a high score requires the
  board to be **both** tightly packed **and** well-threaded. `crossings` counts only
  *true* interlock — a placed letter landing on an existing one (`validatePlacement`'s
  `crossings`) — so words formed incidentally by parallel abutment don't inflate it.
  Letter (Scrabble) values play no part: everyone places the same words, so the letter
  mix is near-constant and was found to mildly *reward* sprawl, the opposite of intent.
  `crossings` is accumulated in `place()` and persisted; `estimateCrossings()` only
  exists to migrate a pre-geometric save (it's recomputed from the board, slightly
  high). `formedWords` still distinguishes words a placement *creates/extends* from
  ones it merely crosses, and now feeds only the combo *celebration*, not the score.
- **Gift/bonus words (`bonus.js`):** `deriveBonusWord(grid, used)` searches the
  *current board* for the best-fitting unused dictionary word (most connections, then
  Scrabble value) and is offered as an amber bank tile. `BONUS_EVERY = 5` triggers an
  offer, but each placement increments `drawn` (the dealt-word counter, capped at
  `MAX_WORDS`), so `drawn` hits the cap by the 15th placement — meaning **exactly two
  gifts per game, after the 5th and 10th word.** Because it's derived from the
  player's board, the gift differs per player even on the shared daily seed.
- **Holiday themes (`holidays.js`):** ~26 American holidays each define a curated
  themed word list. `holidayFor(seedStr)` parses the daily seed date (`"YYYY-M-D"`)
  and returns the matching holiday's `{ id, name, emoji, words }` (or null), computing
  both fixed dates and floating ones (Thanksgiving = 4th Thu Nov, Memorial Day = last
  Mon May, Easter via computus, Mardi Gras = Easter−47, …). The `Game` constructor
  filters the themed words to the dictionary — every placed run must be a real word —
  and uses them as the bank `pool` instead of `BANK_POOL`, falling back to the normal
  pool if fewer than `MIN_THEME_WORDS` survive. `this.holiday` is persisted in
  `serialize()` and surfaced by `main.js`'s `updateTagline()` in the header. Bonus
  words are still board-derived (full dictionary), and the board is still the shared
  daily seed — only the bank changes on a holiday.
- **Deadlock + hint:** `anyPlaceable()` / `candidateAnchors()` detect when no bank
  word fits anywhere (strikes the bank through). `findHint()` returns the best legal
  placement (most crossings); its UI button exists but is hidden by default.

### Drag, auto-orientation, and rendering (`drag.js`, `main.js`)

`DragController` (`drag.js`) owns only drag *mechanics* (pointer tracking, the
floating ghost, snapping to a cell). It has **no rules knowledge** — on every move it
calls back into `main.js`'s `resolve` hook.

`resolve` (`main.js`) is the auto-rotate brain: for both orientations it slides the
word so any of its letters can land on the hovered cell, validates each candidate,
and picks the best legal placement (most crossings, then least shift from the grab
point, then previous orientation to avoid flicker). This is why the word "rotates
itself" — there is no manual rotate control. Only **legal** placements are tinted
green (the ghost tiles and the cells beneath); when nothing is legal the ghost stays
plain — there is no red "bad" state.

`main.js` also handles all DOM rendering, the virtualized infinite-board window
(`renderWindow` / `ensureCoverage`), crossword numbering, the bbox overlay, and
placement celebration popups. `ENABLE_WORD_MOVE` (top of `main.js`) gates the
currently-disabled feature of dragging an already-placed word.

### Dialogs and theming (`instructions.js`, `theme.js`, `main.js`)

- **How-to dialog (`instructions.js`):** shown on first visit, gated by a
  `crosshatch_howto_seen` cookie; reopenable via the header **?** button.
- **End-of-game dialog (`main.js`):** opens on completion or a dead end. Reuses
  `boardAscii()` (the emoji schematic also logged to the console) for a shareable
  result; clicking the board copies it. `startGame()` (extracted so "Restart" can
  replay the same daily seed) resets per-game state and re-renders.
- **Theming (`theme.js` + inline `<head>` bootstrap):** every color in `styles.css`
  resolves through a CSS variable; the light palette is the `:root` default and dark
  overrides live under `[data-theme="dark"]`. The inline bootstrap sets `data-theme`
  before first paint (cookie `crosshatch_theme` → `prefers-color-scheme` → light).
  `theme.js` wires the **☾ / ☀** toggle, persists the choice, and follows live OS
  changes until the user chooses. When adding UI, use the variables (never hardcode a
  color) so both modes stay correct.

## Tunables

Constants live at the top of their modules: `BANK_SIZE` / `MAX_WORDS` / `BONUS_EVERY`
/ `MIN_THEME_WORDS` / `SCORE_SCALE` / `INTERLOCK_BASE` (`game.js`), the `HOLIDAYS`
table (`holidays.js`), `LETTER_SCORES` (`dictionary.js`), `MIN_BONUS_LEN` / `MAX_BONUS_LEN`
(`bonus.js`), `CELL` size (`drag.js`, must match `--cell` in `styles.css`), and
`VIEW_BUFFER` / `RECENTER_AT` / `PITCH` for rendering (`main.js`). Theme colors are
all CSS variables in `styles.css` (`:root` light defaults + `[data-theme="dark"]`).
