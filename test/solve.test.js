/*
 * Self-test: for each supported difficulty, generate the optimal solution,
 * replay it through the real move-validation + victory logic, and assert
 * that the puzzle is beaten in exactly the minimum number of moves.
 *
 * Run: node test/solve.test.js
 */
const G = require('../js/game-core');

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log('Tower of Hanoi — beating the puzzle at every difficulty\n');

for (let disks = 3; disks <= 8; disks++) {
  console.log(`Difficulty: ${disks} disks`);
  let state = G.createState(disks);
  const moves = G.solve(disks);

  // Every generated move must be legal against the live validator.
  let allValid = true;
  for (const [from, to] of moves) {
    if (!G.isValidMove(state, from, to)) {
      allValid = false;
      break;
    }
    state = G.applyMove(state, from, to);
  }

  check(`solution uses only legal moves`, allValid);
  check(`solved (full stack on final tower)`, G.isSolved(state, disks));
  check(
    `used minimum moves (${moves.length} === ${G.minMoves(disks)})`,
    moves.length === G.minMoves(disks)
  );
  console.log('');
}

// A few negative-path checks on the rules.
console.log('Rule checks');
const s = G.createState(3); // [[3,2,1],[],[]]
const s2 = G.applyMove(s, 0, 2); // move disk 1 to tower 2 -> [[3,2],[],[1]]
check('big disk cannot land on small disk', G.isValidMove(s2, 0, 2) === false);
check('cannot move from an empty tower', G.isValidMove(s, 1, 2) === false);
check('cannot move a tower onto itself', G.isValidMove(s, 0, 0) === false);
console.log('');

console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
