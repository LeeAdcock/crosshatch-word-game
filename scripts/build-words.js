// Build-time word-data generator.
//
// Sources the game's word data from maintained npm packages and writes plain
// text files the static site fetches at runtime — so nothing is hand-coded and
// the lists can be refreshed with `npm run words`.
//
//   public/data/dictionary.txt — the full `word-list` corpus (~270k words),
//     used to validate every run the board produces under strict crossword rules.
//   public/data/bank.txt — the most common English words (from `wordlist-english`)
//     that are length BANK_MIN_LEN–BANK_MAX_LEN and present in the dictionary,
//     ordered most-common first, used as the pool the player's bank draws from.

const fs = require('fs');
const path = require('path');

const wordListPath = require('word-list').default;
const englishLists = require('wordlist-english').default || require('wordlist-english');

const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

// Lowercase, keep only pure a–z words, de-dupe while preserving first-seen order.
function normalize(words) {
  const seen = new Set();
  const out = [];
  for (const raw of words) {
    const w = raw.trim().toLowerCase();
    if (!/^[a-z]+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// --- Dictionary: the full corpus, for strict-rules validation -----------------
const dictionary = normalize(fs.readFileSync(wordListPath, 'utf8').split('\n'));
const dictSet = new Set(dictionary);

// --- Bank: most-common words (freq buckets 10 + 20), real words in length band --
// The long words exist in the same common-frequency tier; the upper bound just
// controls how long a bank word can get (game.js draws long words rarely).
const BANK_MIN_LEN = 3;
const BANK_MAX_LEN = 9;
const common = normalize([...englishLists['english/10'], ...englishLists['english/20']]);
const bank = common.filter((w) => w.length >= BANK_MIN_LEN && w.length <= BANK_MAX_LEN && dictSet.has(w));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'dictionary.txt'), dictionary.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'bank.txt'), bank.join('\n') + '\n');

// --- Report -------------------------------------------------------------------
const twos = dictionary.filter((w) => w.length === 2).length;
const byLen = {};
for (const w of bank) byLen[w.length] = (byLen[w.length] || 0) + 1;
console.log(`dictionary: ${dictionary.length} words (${twos} two-letter)`);
console.log(`bank pool:  ${bank.length} words  by length ${JSON.stringify(byLen)}`);
