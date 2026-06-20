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

## Architecture

The app is a single-page browser game. `server.js` is a minimal static file server
with **no game logic** — all logic is client-side under `public/js/`.

### Global namespace, no modules

There is no module system. Each file in `public/js/` defines classes/functions and
attaches them to `window` (e.g. `window.Grid`, `window.validatePlacement`,
`window.isWord`). `index.html` loads scripts in **strict dependency order**:
`words → dictionary → grid → placement → game → drag → main`. Adding a new file
means inserting a `<script>` tag in the right position; cross-file calls go through
`window.*`.

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
- **Density scoring:** `computeScore` rewards packing high-value (Scrabble) letters
  tightly — `boardLetterSum / boundingArea`, scaled by words placed, plus combo
  bonuses for forming multiple words in one placement (`comboBonus`). `formedWords`
  distinguishes words a placement *creates/extends* (has a new tile) from words it
  merely crosses (no new tile).

### Drag, auto-orientation, and rendering (`drag.js`, `main.js`)

`DragController` (`drag.js`) owns only drag *mechanics* (pointer tracking, the
floating ghost, snapping to a cell). It has **no rules knowledge** — on every move it
calls back into `main.js`'s `resolve` hook.

`resolve` (`main.js`) is the auto-rotate brain: for both orientations it slides the
word so any of its letters can land on the hovered cell, validates each candidate,
and picks the best legal placement (most crossings, then least shift from the grab
point, then previous orientation to avoid flicker). This is why the word "rotates
itself" — there is no manual rotate control. Falling back to the closest-to-snapping
candidate when nothing is legal drives the red preview.

`main.js` also handles all DOM rendering, the virtualized infinite-board window
(`renderWindow` / `ensureCoverage`), crossword numbering, the bbox overlay, and
placement celebration popups. `ENABLE_WORD_MOVE` (top of `main.js`) gates the
currently-disabled feature of dragging an already-placed word.

## Tunables

Constants live at the top of their modules: `BANK_SIZE` / `MAX_WORDS` (`game.js`),
`LETTER_SCORES` (`dictionary.js`), `CELL` size (`drag.js`, must match `--cell` in
`styles.css`), and `VIEW_BUFFER` / `RECENTER_AT` / `PITCH` for rendering (`main.js`).
