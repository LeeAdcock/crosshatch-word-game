# Crosshatch

A daily browser word game — the "uncrossword." The board starts with one seed word;
you drag words from the bank onto the grid so each new word **connects to an existing
word** (crossword style), sharing matching letters at every overlap. Each game offers
**25 words**, and the board is **seeded by the date** — everyone gets the same daily
puzzle, and any seed string reproduces a board exactly.

**Play it live:** <https://crosshatch-word-game.lee-06e.workers.dev/>

Placement uses **strict crossword rules**: every run of two or more letters formed on
the board (the word you place *and* any incidental cross/parallel words) must be a
real dictionary word, and every overlapping cell must already match.

## Run it locally

The word data (`public/data/*.txt`) is committed, so the game runs with no install:

```bash
node server.js           # serves on http://localhost:8000
PORT=3000 node server.js # custom port
```

Then open <http://localhost:8000>. `server.js` is a plain Node static file server
for the `public/` directory; the game itself is dependency-free vanilla JS (no build
step, no bundler, no framework).

## Deploy

The app is static, so it deploys as a **Cloudflare Worker with static assets**
serving the `public/` directory (no server code runs in production — `server.js` is
local-dev only). The live build is at the URL above.

In Cloudflare's build settings: **build command** empty, and the deploy serves
`public/` as the static asset directory. (If using the Wrangler CLI directly, a
`wrangler` config pointing `assets` at `./public` plus `npx wrangler deploy` achieves
the same.) Because the word lists are committed, no build/install step is required.

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
- The drop preview (and the dragged tile itself) turns **green** when the placement
  is legal; if it doesn't turn green, the placement isn't allowed.
- A legal word must **connect** to an existing word — by crossing it **or** sitting
  adjacent and building new words (e.g. `CAT` + `S` → `CATS`, or abutting to form
  `TO`) — and may not create any non-word runs. Drop it to place it; **Esc** cancels.
- The board is **infinite** in every direction — **drag empty space** to pan around
  as the crossword grows beyond the viewport.
- _(Moving a placed word by dragging it is currently disabled — toggle
  `ENABLE_WORD_MOVE` in `main.js`.)_

### Scoring

- **Density scoring** rewards packing high-value (Scrabble-valued) letters tightly:
  total letter value per bounding-box cell, scaled by how many words you've placed.
- **Combos:** forming two or more words with a single placement (e.g. extending a
  word *and* making a cross word) earns a bonus — *Double word!*, *Triple word!*, …

### Gift words

**Twice a game** — after your 5th and 10th word — you earn a 🎁 **bonus word**: an
amber tile pinned to the top of the bank, *derived from your own board* so it slots
perfectly into your crossword and no one else's. Play it next for big points; it
expires if you place any other word first.

### Other touches

- **How-to dialog** on first visit (remembered via a cookie); reopen any time with
  the **?** button in the header.
- **End-of-game dialog** with your final score and a mini emoji board — click the
  board to copy a shareable result, or restart the same day's puzzle.
- **Light / dark mode** follows your OS preference, with a **☾ / ☀** toggle in the
  header that remembers your choice (cookie).

## Project layout

```
server.js              # minimal Node static server for local dev (no game logic)
scripts/
  build-words.js       # generates public/data/*.txt from npm word packages
public/
  index.html           # game shell + theme bootstrap + dialogs
  styles.css           # theming variables (light/dark), board, tiles, bank, dialogs
  images/              # logo / favicon SVG variants
  data/
    dictionary.txt     # generated: full word corpus (validation)
    bank.txt           # generated: common words 3–7 (bank pool)
  js/
    words.js           # async loader for the data files -> DICTIONARY + BANK_POOL
    dictionary.js      # isWord(), Scrabble letter scores
    grid.js            # board model + maximal-run extraction
    placement.js       # strict crossword validation
    bonus.js           # derives the per-board gift/bonus word
    game.js            # state, length-varied bank refill, scoring, daily seed
    drag.js            # pointer drag + auto-rotate + ghost preview
    main.js            # DOM rendering, dialogs, hint helper, wiring
    instructions.js    # first-visit how-to dialog (cookie-gated)
    theme.js           # light/dark toggle + cookie + OS-preference tracking
```

Scripts load in **strict dependency order** (see `index.html`); cross-file calls go
through `window.*`. Tunables live at the top of their modules: `BANK_SIZE` /
`MAX_WORDS` / `BONUS_EVERY` (`game.js`), `LETTER_SCORES` (`dictionary.js`), `CELL`
size (`drag.js`, must match `--cell` in `styles.css`), and `VIEW_BUFFER` /
`RECENTER_AT` / `PITCH` for rendering (`main.js`).
