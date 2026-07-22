/*
 * Lights Out — pure game logic (no DOM), shared by the browser UI and Node tests.
 *
 * Board model: a flat array of 0/1 of length size*size, row-major.
 * 1 = light ON, 0 = light OFF. Pressing a cell toggles that cell and its
 * orthogonal neighbours (up/down/left/right).
 *
 * Solvability + minimum moves are computed with Gaussian elimination over
 * GF(2): pressing is a linear operation, so clearing the board means solving
 * A·x = b where b is the lit pattern and x is the set of presses. The 5x5
 * board has a 2-dimensional null space (the "quiet patterns"), so we enumerate
 * all equivalent solutions and keep the one with the fewest presses.
 */

const DEFAULT_SIZE = 5;

function makeEmpty(size) {
  return new Array(size * size).fill(0);
}

function clone(board) {
  return board.slice();
}

/** Indices toggled by pressing cell i: itself + orthogonal neighbours. */
function affectedBy(i, size) {
  const r = Math.floor(i / size);
  const c = i % size;
  const out = [i];
  if (r > 0) out.push(i - size);
  if (r < size - 1) out.push(i + size);
  if (c > 0) out.push(i - 1);
  if (c < size - 1) out.push(i + 1);
  return out;
}

/** Press cell i, mutating and returning the board. */
function applyPress(board, i, size) {
  for (const j of affectedBy(i, size)) board[j] ^= 1;
  return board;
}

function isSolved(board) {
  return board.every((v) => v === 0);
}

/**
 * Build a guaranteed-solvable board by pressing `numPresses` random cells on a
 * blank board. `rng` defaults to Math.random (injectable for deterministic tests).
 */
function randomBoard(size, numPresses, rng = Math.random) {
  const board = makeEmpty(size);
  const n = size * size;
  for (let k = 0; k < numPresses; k++) {
    applyPress(board, Math.floor(rng() * n), size);
  }
  return board;
}

/** The toggle matrix A: A[i][j] = 1 iff pressing j toggles light i (symmetric). */
function buildMatrix(size) {
  const n = size * size;
  const A = [];
  for (let i = 0; i < n; i++) {
    const row = new Uint8Array(n);
    for (const j of affectedBy(i, size)) row[j] = 1;
    A.push(row);
  }
  return A;
}

/**
 * Solve A·x = board over GF(2) and return the minimum-weight press set as a
 * sorted array of cell indices, or null if the board is unsolvable.
 */
function solve(board, size = DEFAULT_SIZE) {
  const n = size * size;
  const A = buildMatrix(size);

  // Augmented rows: n columns of A plus the rhs bit at index n.
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = new Uint8Array(n + 1);
    row.set(A[i]);
    row[n] = board[i] & 1;
    rows.push(row);
  }

  // Gauss-Jordan to reduced row echelon form.
  const pivotForCol = new Int32Array(n).fill(-1);
  const pivotColOfRow = new Int32Array(n).fill(-1);
  let pr = 0;
  for (let col = 0; col < n && pr < n; col++) {
    let sel = -1;
    for (let r = pr; r < n; r++) {
      if (rows[r][col]) { sel = r; break; }
    }
    if (sel < 0) continue;
    const tmp = rows[pr]; rows[pr] = rows[sel]; rows[sel] = tmp;
    for (let r = 0; r < n; r++) {
      if (r !== pr && rows[r][col]) {
        for (let k = col; k <= n; k++) rows[r][k] ^= rows[pr][k];
      }
    }
    pivotForCol[col] = pr;
    pivotColOfRow[pr] = col;
    pr++;
  }

  // Inconsistent row (0 … 0 | 1) => no solution.
  for (let r = 0; r < n; r++) {
    let allZero = true;
    for (let c = 0; c < n; c++) {
      if (rows[r][c]) { allZero = false; break; }
    }
    if (allZero && rows[r][n]) return null;
  }

  const freeCols = [];
  for (let c = 0; c < n; c++) if (pivotForCol[c] < 0) freeCols.push(c);

  function buildSolution(freeAssign) {
    const x = new Uint8Array(n);
    for (let idx = 0; idx < freeCols.length; idx++) x[freeCols[idx]] = freeAssign[idx];
    // Back-substitute pivot variables (RREF => only free cols remain in a row).
    for (let r = pr - 1; r >= 0; r--) {
      const col = pivotColOfRow[r];
      if (col < 0) continue;
      let val = rows[r][n];
      for (let c = 0; c < n; c++) {
        if (c !== col && rows[r][c]) val ^= x[c];
      }
      x[col] = val & 1;
    }
    return x;
  }

  // Enumerate the 2^free equivalent solutions; keep the fewest-presses one.
  const f = freeCols.length;
  let best = null;
  let bestWeight = Infinity;
  for (let mask = 0; mask < (1 << f); mask++) {
    const assign = [];
    for (let i = 0; i < f; i++) assign.push((mask >> i) & 1);
    const x = buildSolution(assign);
    let w = 0;
    for (let i = 0; i < n; i++) w += x[i];
    if (w < bestWeight) { bestWeight = w; best = x; }
  }

  const presses = [];
  for (let i = 0; i < n; i++) if (best[i]) presses.push(i);
  return presses;
}

/** Minimum number of presses to clear the board (Infinity if unsolvable). */
function minMoves(board, size = DEFAULT_SIZE) {
  const s = solve(board, size);
  return s === null ? Infinity : s.length;
}

const LightsOutCore = {
  DEFAULT_SIZE,
  makeEmpty,
  clone,
  affectedBy,
  applyPress,
  isSolved,
  randomBoard,
  buildMatrix,
  solve,
  minMoves,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LightsOutCore;
}
if (typeof window !== 'undefined') {
  window.LightsOutCore = LightsOutCore;
}
