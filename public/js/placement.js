// Placement validation under strict crossword rules.
//
// validatePlacement() does a tentative write, checks every run it produces, then
// rolls back — leaving the board untouched. The caller commits separately only
// when the result is valid.

// Returns { valid: boolean, reason?: string, crossings?: number }.
//
//   firstMove — when true (empty board / seed placement) the overlap requirement
//   is skipped, since there is nothing to connect to yet.
function validatePlacement(grid, word, row, col, orientation, firstMove = false) {
  word = word.toLowerCase();
  const cells = grid.cellsFor(word, row, col, orientation);

  // 1. Every cell must be in bounds and not blocked.
  for (const { row: r, col: c } of cells) {
    if (!grid.inBounds(r, c)) {
      return { valid: false, reason: 'Out of bounds' };
    }
    if (grid.isBlocked(r, c)) {
      return { valid: false, reason: 'Cell is blocked' };
    }
  }

  // 2. Overlap-match: a covered cell must be empty or already hold this letter.
  //    Count overlaps so we can (a) require connection and (b) score crossings.
  let overlaps = 0;
  for (const { row: r, col: c, letter } of cells) {
    const existing = grid.get(r, c);
    if (existing === null) continue;
    if (existing !== letter) {
      return { valid: false, reason: 'Letters do not match' };
    }
    overlaps++;
  }

  // 3. Must connect to existing structure (unless this is the first move) —
  //    either by overlapping a letter or by sitting orthogonally adjacent to one
  //    (which forms a new word by abutment, e.g. CAT + S -> CATS, or CAT + O ->
  //    the down word TO). Any words formed are still validated in step 4.
  const cellKeys = new Set(cells.map(({ row: r, col: c }) => `${r},${c}`));
  let connected = overlaps > 0;
  for (const { row: r, col: c } of cells) {
    if (connected) break;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (grid.get(r + dr, c + dc) && !cellKeys.has(`${r + dr},${c + dc}`)) {
        connected = true;
        break;
      }
    }
  }
  if (!firstMove && !connected) {
    return { valid: false, reason: 'Word must connect to an existing word' };
  }

  // A word laid directly on top of an identical existing run is a no-op.
  if (overlaps === word.length) {
    return { valid: false, reason: 'Word already there' };
  }

  // 4. Tentatively write, validate all resulting runs, then roll back.
  //    Only cells we newly fill should be erased on rollback.
  const newlyFilled = cells.filter(({ row: r, col: c }) => grid.get(r, c) === null);
  grid.placeWord(word, row, col, orientation);

  let valid = true;
  let reason = '';
  for (const run of grid.runsThrough(cells)) {
    if (!window.isWord(run)) {
      valid = false;
      reason = `"${run.toUpperCase()}" is not a word`;
      break;
    }
  }

  grid.eraseCells(newlyFilled);

  if (!valid) return { valid: false, reason };
  return { valid: true, crossings: overlaps };
}

window.validatePlacement = validatePlacement;
