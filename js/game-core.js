/*
 * Tower of Hanoi — pure game logic.
 * No DOM here so it can be unit-tested in Node and reused in the browser.
 *
 * State model: an array of 3 towers, each tower an array of disk sizes
 * ordered bottom -> top. Larger number = larger disk.
 * e.g. 3 disks fresh: [[3, 2, 1], [], []]
 */

/** Build a fresh game state with `numDisks` stacked on the first tower. */
function createState(numDisks) {
  const first = [];
  for (let size = numDisks; size >= 1; size--) first.push(size);
  return [first, [], []];
}

/** Minimum number of moves required for n disks: 2^n - 1. */
function minMoves(numDisks) {
  return Math.pow(2, numDisks) - 1;
}

/** Top disk of a tower, or null if empty. */
function topDisk(tower) {
  return tower.length ? tower[tower.length - 1] : null;
}

/**
 * Is moving the top disk from `from` to `to` legal?
 * Rules: source must have a disk; you can't move onto a smaller disk.
 */
function isValidMove(state, from, to) {
  if (from === to) return false;
  if (from < 0 || from > 2 || to < 0 || to > 2) return false;
  const source = state[from];
  if (source.length === 0) return false;
  const moving = topDisk(source);
  const target = topDisk(state[to]);
  if (target !== null && moving > target) return false;
  return true;
}

/**
 * Apply a move, returning a NEW state (does not mutate the input).
 * Throws if the move is invalid.
 */
function applyMove(state, from, to) {
  if (!isValidMove(state, from, to)) {
    throw new Error(`Invalid move: ${from} -> ${to}`);
  }
  const next = state.map((tower) => tower.slice());
  next[to].push(next[from].pop());
  return next;
}

/**
 * The puzzle is solved when all disks sit on the target tower (default: tower 2)
 * and the other towers are empty.
 */
function isSolved(state, numDisks, targetTower = 2) {
  return state[targetTower].length === numDisks;
}

/**
 * Optimal solver — returns the ordered list of [from, to] moves that
 * moves the whole stack from `from` tower to `to` tower.
 */
function solve(numDisks, from = 0, to = 2, aux = 1) {
  const moves = [];
  function hanoi(n, src, dst, spare) {
    if (n === 0) return;
    hanoi(n - 1, src, spare, dst);
    moves.push([src, dst]);
    hanoi(n - 1, spare, dst, src);
  }
  hanoi(numDisks, from, to, aux);
  return moves;
}

const GameCore = {
  createState,
  minMoves,
  topDisk,
  isValidMove,
  applyMove,
  isSolved,
  solve,
};

// Dual export: CommonJS for Node tests, global for the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameCore;
}
if (typeof window !== 'undefined') {
  window.GameCore = GameCore;
}
