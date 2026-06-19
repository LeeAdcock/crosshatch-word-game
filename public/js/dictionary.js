// Lookup helpers over the bundled DICTIONARY plus Scrabble letter scoring.

// Standard Scrabble tile values, used for scoring placed words.
const LETTER_SCORES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1,
  m: 3, n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8,
  y: 4, z: 10,
};

// True if `s` is a valid word (case-insensitive). Single letters are always
// allowed since an isolated letter is not a "word run" under crossword rules.
function isWord(s) {
  if (!s) return false;
  if (s.length === 1) return true;
  return window.DICTIONARY.has(s.toLowerCase());
}

// Sum of Scrabble tile values for a word.
function wordScore(word) {
  let total = 0;
  for (const ch of word.toLowerCase()) total += LETTER_SCORES[ch] || 0;
  return total;
}

window.isWord = isWord;
window.wordScore = wordScore;
window.LETTER_SCORES = LETTER_SCORES;
