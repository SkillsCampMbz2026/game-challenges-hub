/*
 * Lights Out UI test: load the real page in jsdom, read the randomly generated
 * board out of the DOM, compute an optimal solution, and click those cells to
 * clear the board — verifying victory detection, the move counter, the minimum
 * display, the Hint button, and the leaderboard save flow.
 *
 * Run: node test/lights-out-ui.test.js   (requires `npm install` for jsdom)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const L = require('../js/lights-out-core');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'lights-out.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'js/lights-out-core.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(root, 'js/lights-out-ui.js'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;
window.confirm = () => true;

window.eval(coreJs);
window.eval(uiJs);

const SIZE = 5;

function readBoard() {
  const cells = document.querySelectorAll('#board .cell');
  const b = new Array(cells.length).fill(0);
  cells.forEach((c) => { b[parseInt(c.dataset.index, 10)] = c.classList.contains('on') ? 1 : 0; });
  return b;
}
function clickCell(i) {
  document.querySelector(`.cell[data-index="${i}"]`)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
function setDifficulty(v) {
  const sel = document.getElementById('difficulty');
  sel.value = v;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
}

console.log('Solving Lights Out through the UI\n');

// Play a medium board.
setDifficulty('medium');
const board = readBoard();
const displayedMin = parseInt(document.getElementById('minMoves').textContent, 10);

check('board starts with at least one light on', board.some((v) => v === 1));
const solution = L.solve(board, SIZE);
check('board is solvable', solution !== null);
check('displayed minimum matches the solver', solution.length === displayedMin);

// Clicking the optimal press set should clear the board.
for (const i of solution) clickCell(i);

check('all lights are off (Lights on = 0)', document.getElementById('lightsOn').textContent === '0');
check('victory overlay auto-appeared', document.getElementById('overlay').classList.contains('show'));
check('move counter equals the minimum', document.getElementById('moves').textContent === String(displayedMin));
check('win screen reports a perfect run', /Perfect/.test(document.getElementById('winVerdict').textContent));

// Save the score and confirm the record shape.
document.getElementById('playerName').value = 'LightBot';
document.getElementById('saveScore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const saved = JSON.parse(window.localStorage.getItem('lightsout.leaderboard.v1') || '[]');
check('score saved to localStorage', saved.length === 1 && saved[0].name === 'LightBot');
check('record has name/difficulty/moves/time/date',
  saved[0].difficulty === 'medium' &&
  typeof saved[0].moves === 'number' &&
  typeof saved[0].timeMs === 'number' &&
  typeof saved[0].date === 'string');
const rows = document.querySelectorAll('#leaderboardBody tr');
check('leaderboard renders the saved row', rows.length === 1 && /LightBot/.test(rows[0].textContent));

// Hint button: reveals one cell belonging to an optimal solution.
console.log('\nHint button');
setDifficulty('easy');
const easyBoard = readBoard();
document.getElementById('hint').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const hinted = document.querySelector('.cell.hint');
check('hint highlights exactly one cell', document.querySelectorAll('.cell.hint').length === 1);
const optimalPresses = L.solve(easyBoard, SIZE);
check('hinted cell is a valid optimal press',
  hinted && optimalPresses.includes(parseInt(hinted.dataset.index, 10)));

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
