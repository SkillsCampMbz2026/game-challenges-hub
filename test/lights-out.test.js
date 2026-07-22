/*
 * Lights Out logic test: verify the GF(2) solver actually clears boards,
 * that generated boards are always solvable, and that known results hold.
 *
 * Run: node test/lights-out.test.js
 */
const L = require('../js/lights-out-core');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const SIZE = 5;

console.log('Lights Out — solver & generation\n');

// 1. Empty board is already solved and needs 0 moves.
check('empty board is solved', L.isSolved(L.makeEmpty(SIZE)));
check('empty board needs 0 moves', L.minMoves(L.makeEmpty(SIZE), SIZE) === 0);

// 2. Classic result: the all-ON 5x5 board's minimum solution is 15 presses.
const allOn = new Array(SIZE * SIZE).fill(1);
check('all-lit 5x5 minimum is the known 15 moves', L.minMoves(allOn, SIZE) === 15);

// 3. Applying the solver's presses must clear the board — over many randoms.
console.log('\nSolving 400 random solvable boards');
let solvedAll = true;
let minNeverExceedsScramble = true;
let seed = 12345;
const rng = () => {
  // deterministic LCG so the test is reproducible
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
for (let t = 0; t < 400; t++) {
  const scramble = 1 + Math.floor(rng() * 25);
  const board = L.randomBoard(SIZE, scramble, rng);
  const presses = L.solve(board, SIZE);
  if (presses === null) { solvedAll = false; break; }
  const work = L.clone(board);
  for (const i of presses) L.applyPress(work, i, SIZE);
  if (!L.isSolved(work)) { solvedAll = false; break; }
  if (presses.length > scramble) minNeverExceedsScramble = false; // optimal <= any solution
}
check('every generated board was solvable', solvedAll);
check('solver clears every board', solvedAll);
check('optimal solution never exceeds the scramble length', minNeverExceedsScramble);

// 4. Press mechanics: pressing a corner toggles exactly 3 cells; centre toggles 5.
let b = L.makeEmpty(SIZE);
L.applyPress(b, 0, SIZE); // top-left corner
check('corner press toggles 3 cells', b.reduce((a, v) => a + v, 0) === 3);
b = L.makeEmpty(SIZE);
L.applyPress(b, 12, SIZE); // centre of 5x5
check('centre press toggles 5 cells', b.reduce((a, v) => a + v, 0) === 5);

// 5. Pressing the same cell twice is a no-op.
b = L.randomBoard(SIZE, 8, rng);
const before = L.clone(b);
L.applyPress(b, 7, SIZE);
L.applyPress(b, 7, SIZE);
check('double-press cancels out', b.every((v, i) => v === before[i]));

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
