/*
 * 3D Maze logic test: verify generated mazes are perfect (fully connected =>
 * always solvable), that BFS finds a valid shortest path, and that the wall
 * grid has the expected structure.
 *
 * Run: node test/maze.test.js
 */
const M = require('../js/maze-core');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// Deterministic RNG so the run is reproducible.
let seed = 987654321;
const rng = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

console.log('3D Maze — generation & pathfinding\n');

const SIZES = [
  [6, 6], [10, 10], [15, 15], [20, 20], [8, 14],
];

let allConnected = true;
let allSolvable = true;
let allPathsValid = true;
let allDimsRight = true;

for (const [cols, rows] of SIZES) {
  for (let trial = 0; trial < 40; trial++) {
    const maze = M.generateMaze(cols, rows, rng);

    if (maze.gw !== 2 * cols + 1 || maze.gh !== 2 * rows + 1) allDimsRight = false;
    if (!M.isFullyConnected(maze)) allConnected = false;

    const path = M.shortestPath(maze);
    if (!path) { allSolvable = false; continue; }

    // Validate the path: starts at start, ends at goal, each step is a legal move.
    if (path[0].x !== maze.start.x || path[0].y !== maze.start.y) allPathsValid = false;
    const end = path[path.length - 1];
    if (end.x !== maze.goal.x || end.y !== maze.goal.y) allPathsValid = false;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const manhattan = Math.abs(dx) + Math.abs(dy);
      if (manhattan !== 1) { allPathsValid = false; break; }
      const d = M.DIRVEC.findIndex(([vx, vy]) => vx === dx && vy === dy);
      if (d < 0 || !M.canMove(maze, a.x, a.y, d)) { allPathsValid = false; break; }
    }
  }
}

check('expanded wall-grid dimensions are (2c+1)x(2r+1)', allDimsRight);
check('every generated maze is fully connected', allConnected);
check('every maze is solvable (BFS finds a path)', allSolvable);
check('every shortest path is a legal step-by-step route', allPathsValid);

// Border must be solid wall all the way around.
const maze = M.generateMaze(10, 10, rng);
let borderSolid = true;
for (let x = 0; x < maze.gw; x++) {
  if (maze.grid[0][x] !== 1 || maze.grid[maze.gh - 1][x] !== 1) borderSolid = false;
}
for (let y = 0; y < maze.gh; y++) {
  if (maze.grid[y][0] !== 1 || maze.grid[y][maze.gw - 1] !== 1) borderSolid = false;
}
check('outer border is solid wall', borderSolid);

// A larger maze should require more moves than a tiny one (sanity on min moves).
check('minimum moves scales with maze size',
  M.minMoves(M.generateMaze(3, 3, rng)) < M.minMoves(M.generateMaze(20, 20, rng)));

// Start and goal are opposite corners and distinct.
check('start and goal are distinct corners',
  maze.start.x === 0 && maze.start.y === 0 &&
  maze.goal.x === maze.cols - 1 && maze.goal.y === maze.rows - 1);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
