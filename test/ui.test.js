/*
 * UI-level test: load the real game page in jsdom, then beat the puzzle by
 * clicking towers exactly as a player would. Verifies the move counter, the
 * automatic victory detection, and the leaderboard save flow end-to-end.
 *
 * Run: node test/ui.test.js   (requires `npm install` for jsdom)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const G = require('../js/game-core');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tower-of-hanoi.html'), 'utf8');
const coreJs = fs.readFileSync(path.join(root, 'js/game-core.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(root, 'js/hanoi-ui.js'), 'utf8');

// Providing a `url` enables jsdom's native localStorage.
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;
window.confirm = () => true;

// Execute the game scripts in the page's context.
window.eval(coreJs);
window.eval(uiJs);

function clickTower(t) {
  const el = document.querySelector(`.tower[data-tower="${t}"]`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

// Play at 3 disks so the test is quick. Set difficulty + restart.
const sel = document.getElementById('difficulty');
sel.value = '3';
sel.dispatchEvent(new window.Event('change', { bubbles: true }));

console.log('Beating the puzzle through the UI (3 disks)\n');

const solution = G.solve(3); // [[from,to], ...] optimal
for (const [from, to] of solution) {
  clickTower(from); // pick up
  clickTower(to);   // drop
}

const movesText = document.getElementById('moves').textContent;
check(`move counter shows optimal ${G.minMoves(3)} moves`, movesText === String(G.minMoves(3)));

const overlay = document.getElementById('overlay');
check('victory overlay auto-appeared', overlay.classList.contains('show'));
check('win screen reports perfect run', /Perfect/.test(document.getElementById('winVerdict').textContent));

// Save a score and confirm it lands in the leaderboard + localStorage.
document.getElementById('playerName').value = 'TestBot';
document.getElementById('saveScore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const saved = JSON.parse(window.localStorage.getItem('hanoi.leaderboard.v1') || '[]');
check('score saved to localStorage', saved.length === 1 && saved[0].name === 'TestBot');
check('saved record has disks/moves/time/date',
  saved[0].disks === 3 && saved[0].moves === G.minMoves(3) &&
  typeof saved[0].timeMs === 'number' && typeof saved[0].date === 'string');

const rows = document.querySelectorAll('#leaderboardBody tr');
check('leaderboard renders the saved row', rows.length === 1 && /TestBot/.test(rows[0].textContent));

// An invalid move must be rejected: fresh 3-disk board, try Goal(empty)->anything is fine,
// but moving a big disk onto a small one must not change the count.
sel.value = '3';
sel.dispatchEvent(new window.Event('change', { bubbles: true }));
clickTower(0); // pick up smallest from Start
clickTower(2); // drop on Goal  (valid) -> 1 move
clickTower(0); // pick up disk 2 from Start
clickTower(2); // try to drop disk 2 onto disk 1 (INVALID)
check('invalid move is blocked (counter stays at 1)',
  document.getElementById('moves').textContent === '1');

// --- Auto-solve: clicking the button should solve the puzzle by itself,
//     without adding anything to the leaderboard. ---
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  console.log('\nAuto-solve (3 disks)');
  const autoBtn = document.getElementById('autoSolve');
  const overlay = document.getElementById('overlay');

  sel.value = '3';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  overlay.classList.remove('show'); // close any prior win modal

  autoBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('auto-solve starts (button switches to Stop)', autoBtn.textContent === '⏹ Stop');
  check('difficulty locked during auto-solve', sel.disabled === true);

  // 7 moves at ~420ms each ≈ 3s; poll up to 8s for the win.
  const deadline = 8000;
  let waited = 0;
  while (!overlay.classList.contains('show') && waited < deadline) {
    await wait(100);
    waited += 100;
  }

  check('auto-solve reaches victory', overlay.classList.contains('show'));
  check('auto-solve hits the optimal move count',
    document.getElementById('moves').textContent === String(G.minMoves(3)));
  check('win screen shows the "not saved" note',
    document.getElementById('autoNote').style.display !== 'none');
  check('save-score control hidden for auto-solve',
    document.getElementById('saveScore').style.display === 'none');

  const rowsAfter = document.querySelectorAll('#leaderboardBody tr');
  check('auto-solve did NOT add a leaderboard row (still just TestBot)',
    rowsAfter.length === 1 && /TestBot/.test(rowsAfter[0].textContent));
  check('controls re-enabled after auto-solve', sel.disabled === false);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
