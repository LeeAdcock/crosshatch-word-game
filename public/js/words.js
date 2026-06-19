// Loads the bundled word lists at startup. These files are generated from npm
// packages by `npm run words` (see scripts/build-words.js) — not hand-authored.
//
//   data/dictionary.txt — the full `word-list` corpus (~274k words). Used to
//     validate every run the board produces under strict crossword rules.
//   data/bank.txt — the most common English words (from `wordlist-english`),
//     length 3–7, used as the pool the player's bank draws from, so bank words
//     are always real and familiar.
//
// loadWords() must be awaited before the game starts; it populates
// window.DICTIONARY (a Set) and window.BANK_POOL (an array).

async function loadWords() {
  const [dictText, bankText] = await Promise.all([
    fetch('data/dictionary.txt').then((r) => r.text()),
    fetch('data/bank.txt').then((r) => r.text()),
  ]);

  const toWords = (text) =>
    text.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean);

  window.DICTIONARY = new Set(toWords(dictText));
  window.BANK_POOL = toWords(bankText);
}

window.loadWords = loadWords;
