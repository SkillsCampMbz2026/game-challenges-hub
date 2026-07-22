/*
 * 3D Maze render smoke test: the other UI test stubs the canvas to null so
 * draw() no-ops. Here we supply a recording mock 2D context so the full
 * raycaster + monster sprite (occlusion clip, gradients, creature shapes) and
 * minimap actually EXECUTE — catching runtime errors the null-canvas path hides.
 *
 * Run: node test/maze-render.test.js   (requires `npm install` for jsdom)
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

// A minimal recording 2D context that supports every call draw() makes.
function makeMockCtx() {
  const calls = { fillRect: 0, clip: 0, fill: 0, stroke: 0 };
  const gradient = { addColorStop() {} };
  return {
    calls,
    // stylable properties (plain assignable fields)
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    fillRect() { calls.fillRect++; },
    strokeRect() {},
    beginPath() {}, closePath() {},
    rect() {}, moveTo() {}, lineTo() {}, arc() {},
    ellipse() {},
    clip() { calls.clip++; },
    fill() { calls.fill++; },
    stroke() { calls.stroke++; },
    save() {}, restore() {},
  };
}

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const { window } = dom;
const { document } = window;
window.confirm = () => true;

const mock = makeMockCtx();
window.HTMLCanvasElement.prototype.getContext = () => mock;

let threw = null;
try {
  window.eval(coreJs);
  window.eval(uiJs); // module init runs newGame() -> draw() with the mock ctx
} catch (e) {
  threw = e;
}

console.log('3D Maze render smoke test\n');
check('loading + first render did not throw', threw === null);
check('walls were rasterised (fillRect called many times)', mock.calls.fillRect > 100);

const D = window.MazeDebug;

// Take a step (re-renders) and let the monster act; the monster sprite path
// (projection + occlusion clip + creature drawing) should execute cleanly.
let stepThrew = null;
try {
  const maze = D.maze();
  const p = D.state().player;
  // Pick an open neighbour and turn the camera to face it.
  let d0 = -1;
  for (let d = 0; d < 4; d++) if (M.canMove(maze, p.x, p.y, d)) { d0 = d; break; }
  let guard = 0;
  while (D.state().facing !== d0 && guard++ < 8) D.turnRight();
  // Place the monster directly ahead so the sprite is on-screen and renders.
  const nb = { x: p.x + M.DIRVEC[d0][0], y: p.y + M.DIRVEC[d0][1] };
  D.setMonster(nb.x, nb.y); // triggers a render with the monster in view
  // Step forward onto it — exercises the move render + caught path.
  D.moveToAdjacent(d0);
} catch (e) {
  stepThrew = e;
}
check('stepping + monster render did not throw', stepThrew === null);
check('clip() was used for sprite occlusion at least once', mock.calls.clip > 0);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
