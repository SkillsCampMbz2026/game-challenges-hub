/*
 * 3D Maze UI test: load the real page in jsdom, read the generated maze out of
 * the game, compute the BFS shortest path, and walk it through the game's own
 * movement API — verifying step counting, keyboard turning, automatic victory
 * detection, and the leaderboard save flow.
 *
 * The canvas has no backend in jsdom, so getContext is stubbed to null; the
 * game's draw() is a no-op in that case while all game logic still runs.
 *
 * Run: node test/maze-ui.test.js   (requires `npm install` for jsdom)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const M = require('../js/maze-core');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'maze.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'js/maze-core.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(root, 'js/maze-ui.js'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;
window.confirm = () => true;
// No canvas backend in jsdom — stub the context so draw() safely no-ops.
window.HTMLCanvasElement.prototype.getContext = () => null;

window.eval(coreJs);
window.eval(uiJs);

const D = window.MazeDebug;

function dirBetween(a, b) {
  return M.DIRVEC.findIndex(([vx, vy]) => vx === b.x - a.x && vy === b.y - a.y);
}

console.log('3D Maze through the UI\n');

// --- Keyboard turning (fresh maze, nothing focused). ---
const before = D.state().facing;
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
const afterRight = D.state().facing;
check('ArrowRight (keyboard) turns the player', afterRight === (before + 1) % 4);
// Animated input is locked mid-turn, so verify the inverse via the instant API.
D.turnLeft();
check('turning left reverses the facing', D.state().facing === before);

// --- Solve the maze by walking the shortest path. ---
const maze = D.maze();
const optimal = D.state().optimal;
check('displayed shortest matches the solver',
  optimal === M.minMoves(maze) &&
  optimal === parseInt(document.getElementById('minMoves').textContent, 10));

const p = M.shortestPath(maze, maze.start, maze.goal);
check('a shortest path exists', p !== null);

let walkedOk = true;
for (let i = 1; i < p.length; i++) {
  const dir = dirBetween(p[i - 1], p[i]);
  if (!D.moveToAdjacent(dir)) { walkedOk = false; break; }
}
check('walked the whole path via the movement API', walkedOk);

const st = D.state();
check('player reached the goal', st.player.x === maze.goal.x && st.player.y === maze.goal.y);
check('game reports won', st.won === true);
check('step counter equals the shortest path length', st.moveCount === optimal);
check('victory overlay auto-appeared', document.getElementById('overlay').classList.contains('show'));
check('move counter in HUD equals minimum',
  document.getElementById('moves').textContent === String(optimal));
check('win screen reports a perfect run', /Perfect/.test(document.getElementById('winVerdict').textContent));

// --- Leaderboard save. ---
document.getElementById('playerName').value = 'MazeBot';
document.getElementById('saveScore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const saved = JSON.parse(window.localStorage.getItem('maze.leaderboard.v1') || '[]');
check('score saved to localStorage', saved.length === 1 && saved[0].name === 'MazeBot');
check('record has name/difficulty/moves/time/date',
  saved[0].difficulty === 'medium' &&
  saved[0].moves === optimal &&
  typeof saved[0].timeMs === 'number' &&
  typeof saved[0].date === 'string');
const rows = document.querySelectorAll('#leaderboardBody tr');
check('leaderboard renders the saved row', rows.length === 1 && /MazeBot/.test(rows[0].textContent));

// --- Blocked move: you cannot walk through a wall. ---
const m2 = D.maze();
const cell = D.state().player;
let blockedDir = -1;
for (let d = 0; d < 4; d++) if (!M.canMove(m2, cell.x, cell.y, d)) { blockedDir = d; break; }
if (blockedDir >= 0) {
  const movesBefore = D.state().moveCount;
  const moved = D.moveToAdjacent(blockedDir);
  check('cannot move through a wall (step rejected)',
    moved === false && D.state().moveCount === movesBefore);
} else {
  check('cannot move through a wall (step rejected)', true); // no wall adjacent to test
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
