/* 3D Maze — first-person raycasting UI, built on top of MazeCore. */
(function () {
  'use strict';

  const M = window.MazeCore;
  const LB_KEY = 'maze.leaderboard.v1';
  const NAME_KEY = 'maze.lastName';

  // Difficulty => maze size in cells + monster step interval (ms; lower = faster).
  const DIFFICULTIES = {
    easy: { label: 'Easy', cols: 6, rows: 6, monsterMs: 750 },
    medium: { label: 'Medium', cols: 10, rows: 10, monsterMs: 600 },
    hard: { label: 'Hard', cols: 15, rows: 15, monsterMs: 480 },
    expert: { label: 'Expert', cols: 20, rows: 20, monsterMs: 380 },
  };

  // Render resolution (CSS scales it to fit). 16:10.
  const RW = 640;
  const RH = 400;
  const FOV = 0.66; // camera plane half-length
  const MOVE_MS = 130;
  const TURN_MS = 130;

  // Facing: 0=E,1=S,2=W,3=N — matches MazeCore.DIRVEC.
  const FACE_ANGLE = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  const el = {
    difficulty: document.getElementById('difficulty'),
    restart: document.getElementById('restart'),
    hint: document.getElementById('hint'),
    canvas: document.getElementById('maze3d'),
    moves: document.getElementById('moves'),
    minMoves: document.getElementById('minMoves'),
    time: document.getElementById('time'),
    overlay: document.getElementById('overlay'),
    winTitle: document.getElementById('winTitle'),
    nameRow: document.getElementById('nameRow'),
    caughtNote: document.getElementById('caughtNote'),
    winMoves: document.getElementById('winMoves'),
    winMin: document.getElementById('winMin'),
    winTime: document.getElementById('winTime'),
    winVerdict: document.getElementById('winVerdict'),
    playerName: document.getElementById('playerName'),
    saveScore: document.getElementById('saveScore'),
    playAgain: document.getElementById('playAgain'),
    leaderboard: document.getElementById('leaderboardBody'),
    clearBoard: document.getElementById('clearLeaderboard'),
    up: document.getElementById('btnUp'),
    down: document.getElementById('btnDown'),
    tleft: document.getElementById('btnTurnLeft'),
    tright: document.getElementById('btnTurnRight'),
  };

  const ctx = el.canvas.getContext('2d');
  el.canvas.width = RW;
  el.canvas.height = RH;

  let maze;
  let player;       // {x,y} cell
  let facing;       // 0..3
  let cam;          // {px, py, angle} interpolated camera
  let anim = null;  // {fromPx,fromPy,fromAngle,toPx,toPy,toAngle,start,dur}
  let moveCount = 0;
  let optimal = 0;
  let won = false;
  let revealed;     // Uint8 grid, fog-of-war for minimap
  let hintPath = null;
  let hintUntil = 0;

  let startTime = null;
  let timerId = null;
  let elapsedMs = 0;

  let monster = null;        // {x,y} cell of the hunter, or null
  let monsterEnabled = true; // toggle (used to disable the monster in tests)
  let monsterTimer = null;
  let caught = false;        // the monster reached the player

  /* ---------- Helpers ---------- */
  function cellCentre(x, y) {
    return { px: 2 * x + 1 + 0.5, py: 2 * y + 1 + 0.5 };
  }
  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  function startTimer() {
    if (timerId) return;
    startTime = Date.now() - elapsedMs;
    timerId = setInterval(() => {
      elapsedMs = Date.now() - startTime;
      el.time.textContent = formatTime(elapsedMs);
    }, 250);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function reveal(x, y) {
    // Reveal the 3x3 expanded block around cell (x,y) for the minimap.
    const cx = 2 * x + 1, cy = 2 * y + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < maze.gw && gy >= 0 && gy < maze.gh) revealed[gy][gx] = 1;
      }
    }
  }

  /* ---------- Game setup ---------- */
  function newGame() {
    const d = DIFFICULTIES[el.difficulty.value];
    maze = M.generateMaze(d.cols, d.rows, Math.random);
    player = { x: maze.start.x, y: maze.start.y };
    facing = 0; // face east
    const c = cellCentre(player.x, player.y);
    cam = { px: c.px, py: c.py, angle: FACE_ANGLE[facing] };
    anim = null;
    moveCount = 0;
    won = false;
    caught = false;
    hintPath = null;
    optimal = M.minMoves(maze);
    revealed = [];
    for (let y = 0; y < maze.gh; y++) revealed.push(new Uint8Array(maze.gw).fill(0));
    reveal(player.x, player.y);
    stopMonster();
    monster = monsterEnabled ? placeMonster() : null;
    elapsedMs = 0;
    stopTimer();
    startTime = null;
    el.moves.textContent = '0';
    el.minMoves.textContent = String(optimal);
    el.time.textContent = '00:00';
    updateMovesStyle();
    draw();
  }

  function updateMovesStyle() {
    el.moves.classList.toggle('optimal', won && moveCount === optimal);
    el.moves.classList.toggle('over', moveCount > optimal);
  }

  /* ---------- Monster ---------- */
  // BFS distance from a cell to every other cell (-1 = unreachable).
  function bfsDistances(from) {
    const { cols, rows } = maze;
    const dist = [];
    for (let y = 0; y < rows; y++) dist.push(new Int32Array(cols).fill(-1));
    const q = [from];
    dist[from.y][from.x] = 0;
    while (q.length) {
      const cur = q.shift();
      for (let d = 0; d < 4; d++) {
        if (!M.canMove(maze, cur.x, cur.y, d)) continue;
        const nx = cur.x + M.DIRVEC[d][0];
        const ny = cur.y + M.DIRVEC[d][1];
        if (dist[ny][nx] < 0) { dist[ny][nx] = dist[cur.y][cur.x] + 1; q.push({ x: nx, y: ny }); }
      }
    }
    return dist;
  }

  // Spawn the monster far from the player's start (and not on the exit).
  function placeMonster() {
    const dS = bfsDistances(maze.start);
    let maxD = 0;
    for (let y = 0; y < maze.rows; y++) for (let x = 0; x < maze.cols; x++) maxD = Math.max(maxD, dS[y][x]);
    const dG = bfsDistances(maze.goal);
    const cands = [];
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (x === maze.start.x && y === maze.start.y) continue;
        if (x === maze.goal.x && y === maze.goal.y) continue;
        if (dS[y][x] >= maxD * 0.5 && dG[y][x] >= 2) cands.push({ x, y });
      }
    }
    if (cands.length) return cands[Math.floor(Math.random() * cands.length)];
    // Fallback: farthest cell from start that isn't the goal.
    let best = null, bd = -1;
    for (let y = 0; y < maze.rows; y++) {
      for (let x = 0; x < maze.cols; x++) {
        if (x === maze.goal.x && y === maze.goal.y) continue;
        if (dS[y][x] > bd) { bd = dS[y][x]; best = { x, y }; }
      }
    }
    return best;
  }

  function startMonster() {
    if (!monster || monsterTimer || !monsterEnabled) return;
    const ms = DIFFICULTIES[el.difficulty.value].monsterMs;
    monsterTimer = setInterval(monsterChaseStep, ms);
  }
  function stopMonster() {
    if (monsterTimer) { clearInterval(monsterTimer); monsterTimer = null; }
  }

  // One chase step: move one cell along the shortest path toward the player.
  function monsterChaseStep() {
    if (!monster || won || caught) return;
    const path = M.shortestPath(maze, { x: monster.x, y: monster.y }, { x: player.x, y: player.y });
    if (path && path.length > 1) monster = { x: path[1].x, y: path[1].y };
    draw();
    if (monster.x === player.x && monster.y === player.y) onCaught();
  }

  /* ---------- Movement ---------- */
  // Move one cell in direction `dir`. changeFacing=false keeps orientation
  // (used for stepping backward). animate=false snaps instantly (tests).
  function move(dir, changeFacing, animate) {
    if (won || caught) return false;
    if (anim && animate) return false; // ignore input mid-animation
    if (!M.canMove(maze, player.x, player.y, dir)) return false;

    if (changeFacing) facing = dir;
    player = { x: player.x + M.DIRVEC[dir][0], y: player.y + M.DIRVEC[dir][1] };
    moveCount++;
    reveal(player.x, player.y);
    el.moves.textContent = String(moveCount);
    updateMovesStyle();
    if (startTime === null && timerId === null) startTimer();
    startMonster(); // the hunt begins on the first step

    const c = cellCentre(player.x, player.y);
    if (animate) {
      anim = {
        fromPx: cam.px, fromPy: cam.py, fromAngle: cam.angle,
        toPx: c.px, toPy: c.py, toAngle: FACE_ANGLE[facing],
        start: performance.now(), dur: MOVE_MS,
      };
    } else {
      anim = null;
      cam = { px: c.px, py: c.py, angle: FACE_ANGLE[facing] };
      draw();
    }
    if (monster && player.x === monster.x && player.y === monster.y) { onCaught(); return true; }
    checkWin();
    return true;
  }

  function turn(delta, animate) {
    if (won || caught) return;
    if (anim && animate) return;
    facing = (facing + delta + 4) % 4;
    if (animate) {
      anim = {
        fromPx: cam.px, fromPy: cam.py, fromAngle: cam.angle,
        toPx: cam.px, toPy: cam.py, toAngle: FACE_ANGLE[facing],
        start: performance.now(), dur: TURN_MS,
      };
    } else {
      anim = null;
      cam.angle = FACE_ANGLE[facing];
      draw();
    }
  }

  const stepForward = () => move(facing, true, true);
  const stepBackward = () => move((facing + 2) % 4, false, true);
  const turnLeft = () => turn(-1, true);
  const turnRight = () => turn(+1, true);

  function checkWin() {
    if (player.x === maze.goal.x && player.y === maze.goal.y) onWin();
  }

  /* ---------- Rendering (raycaster) ---------- */
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  function draw() {
    if (!ctx) return; // e.g. jsdom without a canvas backend — logic still runs
    // Ceiling and floor.
    const ceil = ctx.createLinearGradient(0, 0, 0, RH / 2);
    ceil.addColorStop(0, '#0a0d20');
    ceil.addColorStop(1, '#1a1f3f');
    ctx.fillStyle = ceil;
    ctx.fillRect(0, 0, RW, RH / 2);
    const floor = ctx.createLinearGradient(0, RH / 2, 0, RH);
    floor.addColorStop(0, '#15122a');
    floor.addColorStop(1, '#070812');
    ctx.fillStyle = floor;
    ctx.fillRect(0, RH / 2, RW, RH / 2);

    const dirX = Math.cos(cam.angle);
    const dirY = Math.sin(cam.angle);
    const planeX = -dirY * FOV;
    const planeY = dirX * FOV;
    const gCx = 2 * maze.goal.x + 1;
    const gCy = 2 * maze.goal.y + 1;
    const zBuffer = new Float64Array(RW);

    for (let col = 0; col < RW; col++) {
      const cameraX = (2 * col) / RW - 1;
      const rayX = dirX + planeX * cameraX;
      const rayY = dirY + planeY * cameraX;

      let mapX = Math.floor(cam.px);
      let mapY = Math.floor(cam.py);
      const deltaX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
      const deltaY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);

      let stepX, stepY, sideX, sideY;
      if (rayX < 0) { stepX = -1; sideX = (cam.px - mapX) * deltaX; }
      else { stepX = 1; sideX = (mapX + 1 - cam.px) * deltaX; }
      if (rayY < 0) { stepY = -1; sideY = (cam.py - mapY) * deltaY; }
      else { stepY = 1; sideY = (mapY + 1 - cam.py) * deltaY; }

      let side = 0;
      let guard = 0;
      while (guard++ < 512) {
        if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
        else { sideY += deltaY; mapY += stepY; side = 1; }
        if (mapY < 0 || mapY >= maze.gh || mapX < 0 || mapX >= maze.gw) break;
        if (maze.grid[mapY][mapX] === 1) break;
      }

      const perp = side === 0 ? (sideX - deltaX) : (sideY - deltaY);
      const dist = Math.max(perp, 0.0001);
      let lineH = Math.floor(RH / dist);
      if (lineH > RH * 4) lineH = RH * 4;
      let drawStart = Math.floor(-lineH / 2 + RH / 2);
      let drawEnd = Math.floor(lineH / 2 + RH / 2);
      if (drawStart < 0) drawStart = 0;
      if (drawEnd > RH) drawEnd = RH;

      // Is this wall part of the goal cell? (glow gold to guide the player.)
      const nearGoal =
        (mapX === gCx && Math.abs(mapY - gCy) === 1) ||
        (mapY === gCy && Math.abs(mapX - gCx) === 1) ||
        (mapX === gCx && mapY === gCy);

      // Base colour by wall orientation, darkened with distance.
      let r, g, b;
      if (nearGoal) { r = 255; g = 209; b = 102; }
      else if (side === 0) { r = 108; g = 140; b = 255; }
      else { r = 78; g = 100; b = 190; }
      const shade = Math.max(0.25, Math.min(1, 1 / (1 + dist * 0.18)));
      ctx.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
      ctx.fillRect(col, drawStart, 1, drawEnd - drawStart);
      zBuffer[col] = dist;
    }

    drawMonster(dirX, dirY, planeX, planeY, zBuffer);
    drawMinimap();
  }

  // Billboard-project the monster into the scene, occluded by walls via zBuffer.
  function drawMonster(dirX, dirY, planeX, planeY, zBuffer) {
    if (!monster) return;
    const mx = 2 * monster.x + 1 + 0.5;
    const my = 2 * monster.y + 1 + 0.5;
    const spriteX = mx - cam.px;
    const spriteY = my - cam.py;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const tX = invDet * (dirY * spriteX - dirX * spriteY);
    const tY = invDet * (-planeY * spriteX + planeX * spriteY); // depth
    if (tY <= 0.1) return; // behind the camera

    const screenX = (RW / 2) * (1 + tX / tY);
    const sz = Math.abs(RH / tY) * 0.85;
    const startX = Math.max(0, Math.floor(screenX - sz / 2));
    const endX = Math.min(RW - 1, Math.ceil(screenX + sz / 2));

    // Clip to only the columns where the monster is nearer than the wall.
    ctx.save();
    ctx.beginPath();
    let anyVisible = false;
    for (let x = startX; x <= endX; x++) {
      if (tY < zBuffer[x]) { ctx.rect(x, 0, 1, RH); anyVisible = true; }
    }
    if (!anyVisible) { ctx.restore(); return; }
    ctx.clip();
    drawCreature(screenX, sz, tY);
    ctx.restore();
  }

  function drawCreature(cx, sz, dist) {
    const cy = RH / 2;
    const shade = Math.max(0.4, Math.min(1, 1 / (1 + dist * 0.1)));
    const bodyW = sz * 0.72;
    const bodyH = sz * 0.94;
    const dark = (v) => Math.round(v * shade);

    // Body.
    const grd = ctx.createRadialGradient(cx, cy - sz * 0.05, sz * 0.05, cx, cy, sz * 0.55);
    grd.addColorStop(0, `rgb(${dark(190)},${dark(45)},${dark(80)})`);
    grd.addColorStop(1, `rgb(${dark(80)},${dark(18)},${dark(55)})`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Horns.
    ctx.fillStyle = `rgb(${dark(60)},${dark(20)},${dark(45)})`;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * bodyW * 0.34, cy - bodyH * 0.38);
      ctx.lineTo(cx + s * bodyW * 0.52, cy - bodyH * 0.64);
      ctx.lineTo(cx + s * bodyW * 0.2, cy - bodyH * 0.48);
      ctx.closePath();
      ctx.fill();
    }

    // Glowing eyes.
    const eyeR = sz * 0.08, eyeDX = sz * 0.15, eyeY = cy - sz * 0.1;
    ctx.fillStyle = `rgba(255,232,120,${shade})`;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * eyeDX, eyeY, eyeR, eyeR, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1a0010';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * eyeDX, eyeY, eyeR * 0.42, eyeR * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snarling mouth.
    ctx.strokeStyle = `rgba(25,0,12,${shade})`;
    ctx.lineWidth = Math.max(1, sz * 0.03);
    ctx.beginPath();
    ctx.arc(cx, cy + sz * 0.14, sz * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  function drawMinimap() {
    const pad = 8;
    const maxDim = 150;
    const scale = Math.max(2, Math.floor(Math.min(maxDim / maze.gw, maxDim / maze.gh)));
    const w = maze.gw * scale;
    const h = maze.gh * scale;
    const ox = RW - w - pad;
    const oy = pad;

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#05060f';
    ctx.fillRect(ox - 2, oy - 2, w + 4, h + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(ox - 2, oy - 2, w + 4, h + 4);

    for (let y = 0; y < maze.gh; y++) {
      for (let x = 0; x < maze.gw; x++) {
        if (!revealed[y][x]) { ctx.fillStyle = '#0b0d1c'; }
        else if (maze.grid[y][x] === 1) { ctx.fillStyle = '#2a2f5a'; }
        else { ctx.fillStyle = '#c9d2ff'; }
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }

    // Optional shortest-path hint overlay.
    if (hintPath && performance.now() < hintUntil) {
      ctx.fillStyle = 'rgba(67,230,197,0.85)';
      for (const cellPt of hintPath) {
        ctx.fillRect(ox + (2 * cellPt.x + 1) * scale, oy + (2 * cellPt.y + 1) * scale, scale, scale);
      }
    }

    // Goal marker.
    const gx = 2 * maze.goal.x + 1, gy = 2 * maze.goal.y + 1;
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(ox + gx * scale, oy + gy * scale, scale, scale);

    // Monster marker (always visible so you can feel the threat closing in).
    if (monster) {
      ctx.fillStyle = '#ff4d5e';
      ctx.fillRect(ox + (2 * monster.x + 1) * scale, oy + (2 * monster.y + 1) * scale, scale, scale);
    }

    // Player marker (triangle pointing along facing).
    const pcx = ox + (2 * player.x + 1 + 0.5) * scale;
    const pcy = oy + (2 * player.y + 1 + 0.5) * scale;
    const a = FACE_ANGLE[facing];
    ctx.fillStyle = '#43e6c5';
    ctx.beginPath();
    const rad = scale * 1.1;
    ctx.moveTo(pcx + Math.cos(a) * rad, pcy + Math.sin(a) * rad);
    ctx.lineTo(pcx + Math.cos(a + 2.5) * rad * 0.7, pcy + Math.sin(a + 2.5) * rad * 0.7);
    ctx.lineTo(pcx + Math.cos(a - 2.5) * rad * 0.7, pcy + Math.sin(a - 2.5) * rad * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---------- Animation loop ---------- */
  function frame(ts) {
    if (anim) {
      let t = (ts - anim.start) / anim.dur;
      if (t >= 1) {
        cam = { px: anim.toPx, py: anim.toPy, angle: anim.toAngle };
        anim = null;
      } else {
        // ease-out
        const e = 1 - Math.pow(1 - t, 2);
        cam = {
          px: anim.fromPx + (anim.toPx - anim.fromPx) * e,
          py: anim.fromPy + (anim.toPy - anim.fromPy) * e,
          angle: lerpAngle(anim.fromAngle, anim.toAngle, e),
        };
      }
      draw();
    } else if (hintPath && performance.now() < hintUntil) {
      draw();
    }
    requestAnimationFrame(frame);
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);

  function showHint() {
    if (won || caught) return;
    const path = M.shortestPath(maze, { x: player.x, y: player.y }, maze.goal);
    if (!path) return;
    hintPath = path;
    hintUntil = performance.now() + 3000;
    draw();
  }

  /* ---------- Victory ---------- */
  function onWin() {
    won = true;
    stopTimer();
    stopMonster();
    updateMovesStyle();
    el.winTitle.textContent = '🎉 You escaped!';
    el.nameRow.style.display = '';
    el.saveScore.style.display = '';
    el.caughtNote.style.display = 'none';
    el.winMoves.textContent = String(moveCount);
    el.winMin.textContent = String(optimal);
    el.winTime.textContent = formatTime(elapsedMs);
    el.winVerdict.innerHTML =
      moveCount === optimal
        ? '<span class="perfect">✨ Perfect — you took the shortest path!</span>'
        : `You reached the exit in ${moveCount - optimal} step${moveCount - optimal === 1 ? '' : 's'} over the shortest route.`;
    el.playerName.value = localStorage.getItem(NAME_KEY) || '';
    el.overlay.classList.add('show');
    el.playerName.focus();
  }

  function onCaught() {
    if (caught || won) return;
    caught = true;
    stopTimer();
    stopMonster();
    el.winTitle.textContent = '👹 Caught!';
    el.winMoves.textContent = String(moveCount);
    el.winMin.textContent = String(optimal);
    el.winTime.textContent = formatTime(elapsedMs);
    el.winVerdict.innerHTML = '<span style="color:var(--danger)">The monster caught you!</span>';
    el.nameRow.style.display = 'none';
    el.saveScore.style.display = 'none';
    el.caughtNote.style.display = '';
    el.overlay.classList.add('show');
    draw();
  }

  /* ---------- Leaderboard ---------- */
  function loadScores() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
    catch (_) { return []; }
  }
  function saveScores(rows) { localStorage.setItem(LB_KEY, JSON.stringify(rows)); }

  function renderLeaderboard() {
    const rows = loadScores();
    const filter = el.difficulty.value;
    const scoped = rows
      .filter((r) => r.difficulty === filter)
      .sort((a, b) => a.moves - b.moves || a.timeMs - b.timeMs)
      .slice(0, 10);
    el.leaderboard.innerHTML = '';
    if (scoped.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="empty-note">No scores yet for ${DIFFICULTIES[filter].label}. Be the first to escape!</td>`;
      el.leaderboard.appendChild(tr);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    scoped.forEach((r, i) => {
      const tr = document.createElement('tr');
      const rank = medals[i] ? `<span class="medal">${medals[i]}</span>` : `${i + 1}`;
      tr.innerHTML = `
        <td>${rank}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.moves}</td>
        <td>${formatTime(r.timeMs)}</td>
        <td>${escapeHtml(r.date)}</td>`;
      el.leaderboard.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function saveScore() {
    const name = (el.playerName.value || 'Anonymous').trim().slice(0, 24) || 'Anonymous';
    localStorage.setItem(NAME_KEY, name);
    const rows = loadScores();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    rows.push({ name, difficulty: el.difficulty.value, moves: moveCount, timeMs: elapsedMs, date });
    saveScores(rows);
    renderLeaderboard();
    el.overlay.classList.remove('show');
    newGame();
  }

  /* ---------- Input wiring ---------- */
  window.addEventListener('keydown', (e) => {
    if (el.overlay.classList.contains('show')) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': stepForward(); e.preventDefault(); break;
      case 'ArrowDown': case 's': case 'S': stepBackward(); e.preventDefault(); break;
      case 'ArrowLeft': case 'a': case 'A': turnLeft(); e.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D': turnRight(); e.preventDefault(); break;
      default: break;
    }
  });
  el.up.addEventListener('click', stepForward);
  el.down.addEventListener('click', stepBackward);
  el.tleft.addEventListener('click', turnLeft);
  el.tright.addEventListener('click', turnRight);

  el.difficulty.addEventListener('change', () => { newGame(); renderLeaderboard(); });
  el.restart.addEventListener('click', newGame);
  el.hint.addEventListener('click', showHint);
  el.saveScore.addEventListener('click', saveScore);
  el.playAgain.addEventListener('click', () => { el.overlay.classList.remove('show'); newGame(); });
  el.playerName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveScore(); });
  el.clearBoard.addEventListener('click', () => {
    if (confirm('Clear the entire local leaderboard? This cannot be undone.')) {
      localStorage.removeItem(LB_KEY);
      renderLeaderboard();
    }
  });

  // Minimal programmatic interface for automated tests.
  window.MazeDebug = {
    state: () => ({
      player: { x: player.x, y: player.y },
      goal: { x: maze.goal.x, y: maze.goal.y },
      monster: monster ? { x: monster.x, y: monster.y } : null,
      facing, moveCount, optimal, won, caught,
    }),
    maze: () => maze,
    turnLeft: () => turn(-1, false),
    turnRight: () => turn(+1, false),
    // Step to an orthogonally adjacent cell instantly (no animation), if open.
    moveToAdjacent: (dir) => move(dir, true, false),
    // Monster controls for deterministic tests.
    setMonsterEnabled: (v) => { monsterEnabled = v; if (!v) { stopMonster(); monster = null; draw(); } },
    setMonster: (x, y) => { monster = { x, y }; draw(); },
    monsterStep: () => { monsterChaseStep(); return monster ? { x: monster.x, y: monster.y } : null; },
  };

  newGame();
  renderLeaderboard();
})();
