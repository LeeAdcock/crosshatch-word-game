# Reverse Crossword

A browser word game. The board starts with one seed word; you drag words from the
bank onto the grid so each new word **crosses an existing word** (crossword style),
sharing matching letters at every overlap. Each game offers up to **50 words**, and
the board is **seeded by the date** — everyone gets the same daily puzzle.

Placement uses **strict crossword rules**: every run of two or more letters formed on
the board (the word you place *and* any incidental cross/parallel words) must be a
real dictionary word, and every overlapping cell must already match.

## Run it

The word data (`public/data/*.txt`) is committed, so the game runs with no install:

```bash
node server.js           # serves on http://localhost:8000
PORT=3000 node server.js # custom port
```

Then open <http://localhost:8000>. `server.js` is a plain Node static file server
for the `public/` directory; the game itself is dependency-free vanilla JS.

### Regenerating the word lists

The word lists are generated from npm packages rather than hand-maintained. To
refresh them:

```bash
npm install     # dev-only: word-list + wordlist-english
npm run words   # writes public/data/dictionary.txt and public/data/bank.txt
```

- **`dictionary.txt`** — the full [`word-list`](https://www.npmjs.com/package/word-list)
  corpus (~274k words), used to validate every run under strict crossword rules.
- **`bank.txt`** — the most common English words from
  [`wordlist-english`](https://www.npmjs.com/package/wordlist-english) (length 3–7),
  used as the bank pool. The bank always holds a spread of word lengths.

## How to play

- **Drag** a word from the Word Bank onto the board.
- The word **rotates automatically** as you drag, picking whichever orientation
  (horizontal or vertical) snaps across an existing word at the cursor.
- The drop preview is **green** when the placement is legal, **red** when it is not.
- A legal word must overlap at least one existing letter and may not create any
  non-word runs. Drop it to place it; press **Esc** to cancel a drag.
- _(Moving a placed word by dragging it is currently disabled — toggle
  `ENABLE_WORD_MOVE` in `main.js`.)_
- **Double-click a blank cell** to block it (turns black; no letter may be placed
  there). Double-click it again to clear the block.
- The board is **infinite** in every direction — **drag empty space** to pan
  around as the crossword grows beyond the viewport.

## Project layout

```
server.js              # minimal Node static server (no game logic)
scripts/
  build-words.js       # generates public/data/*.txt from npm word packages
public/
  index.html           # game shell
  styles.css           # board, tiles, bank, drag states
  data/
    dictionary.txt     # generated: full word corpus (validation)
    bank.txt           # generated: common words 3–7 (bank pool)
  js/
    words.js           # async loader for the data files -> DICTIONARY + BANK_POOL
    dictionary.js      # isWord(), Scrabble letter scores
    grid.js            # board model + maximal-run extraction
    placement.js       # strict crossword validation
    game.js            # state, length-varied bank refill, scoring, endless loop
    drag.js            # pointer drag + rotate + ghost preview
    main.js            # DOM rendering and wiring
```

Tunables live at the top of their modules: the rendered margin around the
crossword (`PAD` in `main.js`), bank size (`game.js`), and Scrabble letter values
(`dictionary.js`).
