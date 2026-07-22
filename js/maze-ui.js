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

  // --- Textured renderer settings ---
  const TEX = 64;                 // texture size (px)
  const FOG = 13;                 // distance (grid units) at which fog fully closes
  const FOGR = 6, FOGG = 7, FOGB = 15; // fog / atmosphere colour
  let frameImg = null, frameData = null; // reused ImageData buffer
  const zbuf = new Float64Array(RW);

  // Procedural brick wall texture (running-bond bricks + mortar + shading).
  function makeWallTexture() {
    const t = new Uint8Array(TEX * TEX * 3);
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const row = Math.floor(y / 16);
        const off = (row % 2) * 16;      // offset alternate rows
        const bx = (x + off) % 32;       // brick 32 wide
        const by = y % 16;               // brick 16 tall
        let r, g, b;
        if (by < 2 || bx < 2) { r = 58; g = 56; b = 64; } // mortar
        else {
          const n = ((x * 13 + y * 7) % 17) - 8;          // grain noise
          const v = (by / 16) * 14;                       // top-lit gradient
          r = 134 + n - v; g = 62 + (n >> 1) - v; b = 52 + (n >> 1) - v;
        }
        const i = (y * TEX + x) * 3; t[i] = r; t[i + 1] = g; t[i + 2] = b;
      }
    }
    return t;
  }

  // Procedural stone-tile floor (checkerboard tiles with grout lines).
  function makeFloorTexture() {
    const t = new Uint8Array(TEX * TEX * 3);
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const tile = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
        const gx = x % 32, gy = y % 32;
        const n = ((x * 7 + y * 11) % 13) - 6;
        const v = (tile ? 60 : 78) + n;
        let r = v, g = v * 0.97, b = v * 0.88;
        if (gx < 2 || gy < 2) { r = 36; g = 36; b = 42; } // grout
        const i = (y * TEX + x) * 3; t[i] = r; t[i + 1] = g; t[i + 2] = b;
      }
    }
    return t;
  }

  // Dark stone ceiling.
  function makeCeilTexture() {
    const t = new Uint8Array(TEX * TEX * 3);
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const n = ((x * 5 + y * 9) % 11) - 5;
        const v = 24 + n;
        const i = (y * TEX + x) * 3; t[i] = v; t[i + 1] = v; t[i + 2] = v + 7;
      }
    }
    return t;
  }

  const wallTex = makeWallTexture();
  const floorTex = makeFloorTexture();
  const ceilTex = makeCeilTexture();

  // Monster photo sprite. Loaded from assets/monster.png and background-keyed
  // (dark night pixels -> transparent) so the creature composits cleanly into
  // the maze. Until/unless it loads, the procedural creature is drawn instead.
  const MONSTER_SRC = 'assets/monster.png';
  let monsterImg = null;       // keyed offscreen canvas
  let monsterImgAspect = 1;
  (function loadMonsterImage() {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return;
    const img = new Image();
    img.onload = function () {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const octx = off.getContext('2d');
        if (!octx) return;
        octx.drawImage(img, 0, 0);
        const id = octx.getImageData(0, 0, w, h);
        const d = id.data;
        // Radial feather: opaque in the centre (the creature), fading to
        // transparent toward the edges so the rectangular frame and any pale
        // background melt into the maze's darkness — a creature out of the mist.
        const cx = w / 2, cy = h / 2;
        const rInner = Math.min(w, h) * 0.30;
        const rOuter = Math.min(w, h) * 0.52;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let a = 1;
            if (dist > rInner) a = 1 - (dist - rInner) / (rOuter - rInner);
            if (a < 0) a = 0; else if (a > 1) a = 1;
            const idx = (y * w + x) * 4 + 3;
            d[idx] = d[idx] * a;
          }
        }
        octx.putImageData(id, 0, 0);
        monsterImg = off;
        monsterImgAspect = w / h;
      } catch (_) { monsterImg = null; }
    };
    img.onerror = function () { monsterImg = null; };
    img.src = MONSTER_SRC;
  })();

  const el = {
    mode: document.getElementById('mode'),
    difficulty: document.getElementById('difficulty'),
    restart: document.getElementById('restart'),
    hint: document.getElementById('hint'),
    canvas: document.getElementById('maze3d'),
    seekerBanner: document.getElementById('seekerBanner'),
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
    jumpscare: document.getElementById('jumpscare'),
    jsImg: document.getElementById('jsImg'),
    jsFace: document.getElementById('jsFace'),
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
  let jsTimer = null;        // jumpscare hide timeout
  let audioCtx = null;       // lazily created on first scare

  let mode = 'escape';       // 'escape' | 'seek'
  let seekerState = 'chase'; // 'count' | 'chase' | 'search'
  let lastSeen = null;       // last cell the seeker saw the player at
  let countdownMs = 0;       // Hide & Seek: time left before the hunt begins

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
    mode = el.mode ? el.mode.value : 'escape';
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
    // Hide & Seek: the seeker "counts" for a head start before hunting.
    lastSeen = null;
    countdownMs = mode === 'seek' ? 3000 : 0;
    seekerState = mode === 'seek' ? 'count' : 'chase';
    updateSeekerBanner();
    clearTimeout(jsTimer);
    if (el.jumpscare) el.jumpscare.classList.remove('show');
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

  function updateSeekerBanner() {
    if (!el.seekerBanner) return;
    if (mode !== 'seek' || won || caught) { el.seekerBanner.style.display = 'none'; return; }
    el.seekerBanner.style.display = '';
    el.seekerBanner.classList.remove('count', 'search', 'spotted');
    if (seekerState === 'count') {
      el.seekerBanner.classList.add('count');
      el.seekerBanner.textContent = `🙈 Seeker counting… ${Math.ceil(countdownMs / 1000)}`;
    } else if (seekerState === 'chase') {
      el.seekerBanner.classList.add('spotted');
      el.seekerBanner.textContent = '👁️ Spotted! Run!';
    } else {
      el.seekerBanner.classList.add('search');
      el.seekerBanner.textContent = '🔦 Seeker is searching…';
    }
  }

  // Move the monster one cell along the shortest path toward `target` cell.
  function stepMonsterToward(target) {
    const path = M.shortestPath(maze, { x: monster.x, y: monster.y }, target);
    if (path && path.length > 1) monster = { x: path[1].x, y: path[1].y };
  }

  // Move the monster to a random open neighbour (searching / wandering).
  function wanderMonster() {
    const open = [];
    for (let d = 0; d < 4; d++) {
      if (M.canMove(maze, monster.x, monster.y, d)) {
        open.push({ x: monster.x + M.DIRVEC[d][0], y: monster.y + M.DIRVEC[d][1] });
      }
    }
    if (open.length) monster = open[Math.floor(Math.random() * open.length)];
  }

  // One monster tick. Behaviour depends on the game mode.
  function monsterChaseStep() {
    if (!monster || won || caught) return;

    if (mode === 'seek') {
      if (countdownMs > 0) {
        // Seeker is still counting — it stays put and can't catch you yet.
        countdownMs -= DIFFICULTIES[el.difficulty.value].monsterMs;
        if (countdownMs <= 0) { countdownMs = 0; seekerState = 'search'; }
        updateSeekerBanner();
        draw();
        return;
      }
      const sees = M.hasLineOfSight(maze, monster, player);
      if (sees) {
        lastSeen = { x: player.x, y: player.y };
        seekerState = 'chase';
        stepMonsterToward(player);
      } else if (lastSeen) {
        seekerState = 'search';
        stepMonsterToward(lastSeen);
        if (monster.x === lastSeen.x && monster.y === lastSeen.y) lastSeen = null;
      } else {
        seekerState = 'search';
        wanderMonster();
      }
      updateSeekerBanner();
    } else {
      // Escape mode: the monster always knows exactly where you are.
      stepMonsterToward(player);
    }

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
    const seekerBlind = mode === 'seek' && countdownMs > 0;
    if (monster && !seekerBlind && player.x === monster.x && player.y === monster.y) { onCaught(); return true; }
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
    if (!frameData) { frameImg = ctx.createImageData(RW, RH); frameData = frameImg.data; }
    const data = frameData;

    const dirX = Math.cos(cam.angle);
    const dirY = Math.sin(cam.angle);
    const planeX = -dirY * FOV;
    const planeY = dirX * FOV;
    const halfH = RH / 2;
    const h2 = Math.floor(halfH);
    const posZ = halfH; // camera height => walls meet the floor seamlessly
    const gCx = 2 * maze.goal.x + 1;
    const gCy = 2 * maze.goal.y + 1;
    const zBuffer = zbuf;

    // ---- Floor & ceiling casting (perspective-correct, textured) ----
    const rayX0 = dirX - planeX, rayY0 = dirY - planeY; // leftmost ray
    const rayX1 = dirX + planeX, rayY1 = dirY + planeY; // rightmost ray
    for (let y = h2 + 1; y < RH; y++) {
      const rowDist = posZ / (y - halfH);
      const stepX = rowDist * (rayX1 - rayX0) / RW;
      const stepY = rowDist * (rayY1 - rayY0) / RW;
      let fx = cam.px + rowDist * rayX0;
      let fy = cam.py + rowDist * rayY0;
      let f = rowDist / FOG; if (f > 1) f = 1; f *= f;
      const floorRow = y * RW * 4;
      const ceilRow = (RH - 1 - y) * RW * 4;
      for (let x = 0; x < RW; x++) {
        const tx = (((fx - Math.floor(fx)) * TEX) | 0) & (TEX - 1);
        const ty = (((fy - Math.floor(fy)) * TEX) | 0) & (TEX - 1);
        fx += stepX; fy += stepY;
        const ti = (ty * TEX + tx) * 3;
        let idx = floorRow + x * 4;
        data[idx] = floorTex[ti] + (FOGR - floorTex[ti]) * f;
        data[idx + 1] = floorTex[ti + 1] + (FOGG - floorTex[ti + 1]) * f;
        data[idx + 2] = floorTex[ti + 2] + (FOGB - floorTex[ti + 2]) * f;
        data[idx + 3] = 255;
        idx = ceilRow + x * 4;
        data[idx] = ceilTex[ti] + (FOGR - ceilTex[ti]) * f;
        data[idx + 1] = ceilTex[ti + 1] + (FOGG - ceilTex[ti + 1]) * f;
        data[idx + 2] = ceilTex[ti + 2] + (FOGB - ceilTex[ti + 2]) * f;
        data[idx + 3] = 255;
      }
    }
    // Fill the 2-pixel horizon seam with fog so it never shows garbage.
    for (let y = h2 - 1; y <= h2; y++) {
      const row = y * RW * 4;
      for (let x = 0; x < RW; x++) {
        const idx = row + x * 4;
        data[idx] = FOGR; data[idx + 1] = FOGG; data[idx + 2] = FOGB; data[idx + 3] = 255;
      }
    }

    // ---- Textured walls ----
    for (let col = 0; col < RW; col++) {
      const cameraX = (2 * col) / RW - 1;
      const rayX = dirX + planeX * cameraX;
      const rayY = dirY + planeY * cameraX;
      let mapX = Math.floor(cam.px), mapY = Math.floor(cam.py);
      const deltaX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
      const deltaY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);
      let stepX, stepY, sideX, sideY;
      if (rayX < 0) { stepX = -1; sideX = (cam.px - mapX) * deltaX; }
      else { stepX = 1; sideX = (mapX + 1 - cam.px) * deltaX; }
      if (rayY < 0) { stepY = -1; sideY = (cam.py - mapY) * deltaY; }
      else { stepY = 1; sideY = (mapY + 1 - cam.py) * deltaY; }

      let side = 0, guard = 0;
      while (guard++ < 1024) {
        if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
        else { sideY += deltaY; mapY += stepY; side = 1; }
        if (mapY < 0 || mapY >= maze.gh || mapX < 0 || mapX >= maze.gw) break;
        if (maze.grid[mapY][mapX] === 1) break;
      }

      const perp = Math.max(side === 0 ? (sideX - deltaX) : (sideY - deltaY), 0.0001);
      zBuffer[col] = perp;
      const lineH = RH / perp;
      const drawStart = Math.floor(-lineH / 2 + halfH);
      const drawEnd = Math.floor(lineH / 2 + halfH);
      const ds = drawStart < 0 ? 0 : drawStart;
      const de = drawEnd > RH ? RH : drawEnd;

      // Texture X: where along the wall face the ray struck.
      let wallX = side === 0 ? (cam.py + perp * rayY) : (cam.px + perp * rayX);
      wallX -= Math.floor(wallX);
      let texX = (wallX * TEX) | 0;
      if (side === 0 && rayX > 0) texX = TEX - texX - 1;
      if (side === 1 && rayY < 0) texX = TEX - texX - 1;

      const nearGoal =
        (mapX === gCx && Math.abs(mapY - gCy) === 1) ||
        (mapY === gCy && Math.abs(mapX - gCx) === 1) ||
        (mapX === gCx && mapY === gCy);

      let f = perp / FOG; if (f > 1) f = 1; f *= f;
      const sideShade = side === 1 ? 0.68 : 1.0; // N/S faces darker

      const stepTex = TEX / lineH;
      let texPos = (ds - halfH + lineH / 2) * stepTex;
      for (let y = ds; y < de; y++) {
        const texY = (texPos | 0) & (TEX - 1); texPos += stepTex;
        const ti = (texY * TEX + texX) * 3;
        let r = wallTex[ti] * sideShade;
        let g = wallTex[ti + 1] * sideShade;
        let b = wallTex[ti + 2] * sideShade;
        if (nearGoal) { r = r * 0.35 + 166; g = g * 0.35 + 136; b = b * 0.35 + 66; }
        const idx = (y * RW + col) * 4;
        data[idx] = r + (FOGR - r) * f;
        data[idx + 1] = g + (FOGG - g) * f;
        data[idx + 2] = b + (FOGB - b) * f;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(frameImg, 0, 0);
    drawMonster(dirX, dirY, planeX, planeY, zBuffer);
    drawVignette();
    drawMinimap();
  }

  // Darkened edges for depth and a torch-lit, enclosed feel.
  function drawVignette() {
    const vg = ctx.createRadialGradient(RW / 2, RH * 0.52, RH * 0.15, RW / 2, RH * 0.52, RH * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, RW, RH);
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
    const sz = Math.abs(RH / tY) * 0.9;

    // Sprite bounding box (photo is grounded with its feet on the floor line).
    let drawW, drawH, left, top;
    if (monsterImg) {
      drawH = sz * 1.25;
      drawW = drawH * monsterImgAspect;
      left = screenX - drawW / 2;
      top = (RH / 2 + sz / 2) - drawH;
    } else {
      drawW = sz; drawH = sz; left = screenX - sz / 2; top = RH / 2 - sz / 2;
    }
    const startX = Math.max(0, Math.floor(left));
    const endX = Math.min(RW - 1, Math.ceil(left + drawW));

    // Clip to only the columns where the monster is nearer than the wall.
    ctx.save();
    ctx.beginPath();
    let anyVisible = false;
    for (let x = startX; x <= endX; x++) {
      if (tY < zBuffer[x]) { ctx.rect(x, 0, 1, RH); anyVisible = true; }
    }
    if (!anyVisible) { ctx.restore(); return; }
    ctx.clip();
    if (monsterImg) {
      ctx.drawImage(monsterImg, left, top, drawW, drawH);
      // Blend the sprite toward the fog colour with distance (sprite pixels only).
      let f = tY / FOG; if (f > 1) f = 1; f *= f;
      if (f > 0.01) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(${FOGR},${FOGG},${FOGB},${f})`;
        ctx.fillRect(left, top, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      drawCreature(screenX, sz, tY);
    }
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
    updateSeekerBanner();
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

  /* ---------- Jumpscare ---------- */
  function getAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (_) { audioCtx = null; }
    return audioCtx;
  }

  // A loud, dissonant screech synthesised on the fly (no audio files).
  function playScreech() {
    const ac = getAudio();
    if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      const dur = 1.3;

      // 0) Sharp impact "hit" — a very short, loud noise crack at t0.
      const impLen = Math.floor(ac.sampleRate * 0.09);
      const impBuf = ac.createBuffer(1, impLen, ac.sampleRate);
      const impData = impBuf.getChannelData(0);
      for (let i = 0; i < impLen; i++) impData[i] = (Math.random() * 2 - 1) * (1 - i / impLen);
      const imp = ac.createBufferSource(); imp.buffer = impBuf;
      const ig = ac.createGain();
      ig.gain.setValueAtTime(0.9, now);
      ig.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      imp.connect(ig).connect(ac.destination);
      imp.start(now); imp.stop(now + 0.12);

      // 1) White-noise shriek through a bandpass.
      const nLen = Math.floor(ac.sampleRate * dur);
      const nBuf = ac.createBuffer(1, nLen, ac.sampleRate);
      const nData = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) nData[i] = Math.random() * 2 - 1;
      const noise = ac.createBufferSource(); noise.buffer = nBuf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.7;
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.75, now + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      noise.connect(bp).connect(ng).connect(ac.destination);
      noise.start(now); noise.stop(now + dur);

      // 2) Detuned sawtooth growl sliding downward.
      const growl = ac.createOscillator();
      growl.type = 'sawtooth';
      growl.frequency.setValueAtTime(950, now);
      growl.frequency.exponentialRampToValueAtTime(120, now + dur);
      const gg = ac.createGain();
      gg.gain.setValueAtTime(0.0001, now);
      gg.gain.exponentialRampToValueAtTime(0.4, now + 0.04);
      gg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      growl.connect(gg).connect(ac.destination);
      growl.start(now); growl.stop(now + dur);

      // 3) Dissonant high stinger (square, slightly detuned against the growl).
      const stinger = ac.createOscillator();
      stinger.type = 'square';
      stinger.frequency.setValueAtTime(1730, now);
      stinger.frequency.exponentialRampToValueAtTime(940, now + dur * 0.8);
      const sg = ac.createGain();
      sg.gain.setValueAtTime(0.0001, now);
      sg.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.85);
      stinger.connect(sg).connect(ac.destination);
      stinger.start(now); stinger.stop(now + dur);

      // 4) Sub-bass rumble for the gut-punch.
      const sub = ac.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(70, now);
      sub.frequency.exponentialRampToValueAtTime(38, now + dur);
      const subg = ac.createGain();
      subg.gain.setValueAtTime(0.0001, now);
      subg.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
      subg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      sub.connect(subg).connect(ac.destination);
      sub.start(now); sub.stop(now + dur);
    } catch (_) { /* audio best-effort only */ }
  }

  function triggerJumpscare() {
    if (!el.jumpscare) return;
    el.jumpscare.classList.remove('show');
    // Force reflow so the CSS animation restarts every time.
    void el.jumpscare.offsetWidth;
    el.jumpscare.classList.add('show');
    playScreech();
    // Haptic buzz on supported devices.
    try { if (navigator.vibrate) navigator.vibrate([0, 90, 40, 140, 30, 90]); } catch (_) { /* ignore */ }
    clearTimeout(jsTimer);
    jsTimer = setTimeout(() => el.jumpscare.classList.remove('show'), 1500);
  }

  function onCaught() {
    if (caught || won) return;
    caught = true;
    stopTimer();
    stopMonster();
    updateSeekerBanner();
    triggerJumpscare();
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
    const diff = el.difficulty.value;
    const md = el.mode ? el.mode.value : 'escape';
    const scoped = rows
      // Older records predate the mode field; treat them as Escape.
      .filter((r) => r.difficulty === diff && (r.mode || 'escape') === md)
      .sort((a, b) => a.moves - b.moves || a.timeMs - b.timeMs)
      .slice(0, 10);
    el.leaderboard.innerHTML = '';
    if (scoped.length === 0) {
      const modeLabel = md === 'seek' ? 'Hide & Seek' : 'Escape';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="empty-note">No scores yet for ${modeLabel} · ${DIFFICULTIES[diff].label}. Be the first to escape!</td>`;
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
    rows.push({ name, mode: el.mode ? el.mode.value : 'escape', difficulty: el.difficulty.value, moves: moveCount, timeMs: elapsedMs, date });
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
  // Jumpscare uses the monster photo; if it's missing, fall back to the emoji.
  if (el.jsImg) {
    el.jsImg.addEventListener('error', () => {
      el.jsImg.style.display = 'none';
      if (el.jsFace) el.jsFace.style.display = '';
    });
    el.jsImg.addEventListener('load', () => {
      if (el.jsFace) el.jsFace.style.display = 'none';
    });
  }

  el.up.addEventListener('click', stepForward);
  el.down.addEventListener('click', stepBackward);
  el.tleft.addEventListener('click', turnLeft);
  el.tright.addEventListener('click', turnRight);

  el.difficulty.addEventListener('change', () => { newGame(); renderLeaderboard(); });
  if (el.mode) el.mode.addEventListener('change', () => { newGame(); renderLeaderboard(); });
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
      mode, seekerState, countdownMs,
      lastSeen: lastSeen ? { x: lastSeen.x, y: lastSeen.y } : null,
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
    setMode: (m) => { if (el.mode) el.mode.value = m; newGame(); },
    endCountdown: () => { countdownMs = 0; if (mode === 'seek') seekerState = 'search'; updateSeekerBanner(); },
  };

  newGame();
  renderLeaderboard();
})();
