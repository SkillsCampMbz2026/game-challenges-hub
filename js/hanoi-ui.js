/* Tower of Hanoi — browser UI, built on top of GameCore. */
(function () {
  'use strict';

  const G = window.GameCore;
  const LB_KEY = 'hanoi.leaderboard.v1';
  const NAME_KEY = 'hanoi.lastName';

  // Distinct disk colors (largest -> smallest cycle through these).
  const COLORS = [
    '#6c8cff', '#43e6c5', '#ffd166', '#ff6b8a', '#b980ff',
    '#4dd0e1', '#ff9f68', '#9ccc65', '#f06292', '#7986cb',
  ];

  const el = {
    difficulty: document.getElementById('difficulty'),
    restart: document.getElementById('restart'),
    board: document.getElementById('board'),
    moves: document.getElementById('moves'),
    minMoves: document.getElementById('minMoves'),
    time: document.getElementById('time'),
    overlay: document.getElementById('overlay'),
    winMoves: document.getElementById('winMoves'),
    winMin: document.getElementById('winMin'),
    winTime: document.getElementById('winTime'),
    winVerdict: document.getElementById('winVerdict'),
    playerName: document.getElementById('playerName'),
    saveScore: document.getElementById('saveScore'),
    playAgain: document.getElementById('playAgain'),
    leaderboard: document.getElementById('leaderboardBody'),
    clearBoard: document.getElementById('clearLeaderboard'),
  };

  let numDisks = parseInt(el.difficulty.value, 10);
  let state;
  let moveCount = 0;
  let selectedTower = null; // click-to-move source
  let dragFrom = null; // drag source
  let startTime = null; // ms, set on first move
  let timerId = null;
  let elapsedMs = 0;
  let won = false;

  /* ---------- Timer ---------- */
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
  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /* ---------- Game setup ---------- */
  function newGame() {
    numDisks = parseInt(el.difficulty.value, 10);
    state = G.createState(numDisks);
    moveCount = 0;
    selectedTower = null;
    dragFrom = null;
    won = false;
    elapsedMs = 0;
    stopTimer();
    startTime = null;
    el.moves.textContent = '0';
    el.minMoves.textContent = String(G.minMoves(numDisks));
    el.time.textContent = '00:00';
    updateMovesStyle();
    render();
  }

  function updateMovesStyle() {
    const min = G.minMoves(numDisks);
    el.moves.classList.toggle('optimal', won && moveCount === min);
    el.moves.classList.toggle('over', moveCount > min);
  }

  /* ---------- Rendering ---------- */
  function render() {
    el.board.innerHTML = '';
    for (let t = 0; t < 3; t++) {
      const tower = document.createElement('div');
      tower.className = 'tower';
      tower.dataset.tower = String(t);
      if (selectedTower === t) tower.classList.add('selected');

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = t === 0 ? 'Start' : t === 2 ? 'Goal' : 'Spare';
      tower.appendChild(label);

      const base = document.createElement('div');
      base.className = 'peg-base';
      tower.appendChild(base);

      const stack = state[t];
      stack.forEach((size, idx) => {
        const disk = document.createElement('div');
        disk.className = 'disk';
        const isTop = idx === stack.length - 1;
        if (isTop) disk.classList.add('movable');
        // width scales with disk size relative to the largest possible disk.
        const pct = 34 + (size / numDisks) * 60;
        disk.style.width = pct + '%';
        disk.style.background = COLORS[(size - 1) % COLORS.length];
        disk.textContent = size;
        disk.draggable = isTop && !won;
        disk.dataset.tower = String(t);

        disk.addEventListener('dragstart', (e) => {
          if (!isTop || won) { e.preventDefault(); return; }
          dragFrom = t;
          disk.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(t));
        });
        disk.addEventListener('dragend', () => {
          disk.classList.remove('dragging');
          clearDropHints();
        });
        tower.appendChild(disk);
      });

      // Click-to-move.
      tower.addEventListener('click', () => onTowerClick(t));

      // Drag-and-drop targets.
      tower.addEventListener('dragover', (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const ok = G.isValidMove(state, dragFrom, t);
        tower.classList.toggle('drop-ok', ok);
        tower.classList.toggle('drop-bad', !ok);
        e.dataTransfer.dropEffect = ok ? 'move' : 'none';
      });
      tower.addEventListener('dragleave', () => {
        tower.classList.remove('drop-ok', 'drop-bad');
      });
      tower.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom === null) return;
        attemptMove(dragFrom, t);
        dragFrom = null;
        clearDropHints();
      });

      el.board.appendChild(tower);
    }
  }

  function clearDropHints() {
    document.querySelectorAll('.tower').forEach((t) =>
      t.classList.remove('drop-ok', 'drop-bad')
    );
  }

  /* ---------- Move handling ---------- */
  function onTowerClick(t) {
    if (won) return;
    if (selectedTower === null) {
      // Only select a tower that has a disk to move.
      if (state[t].length === 0) return;
      selectedTower = t;
    } else if (selectedTower === t) {
      selectedTower = null; // deselect
    } else {
      const from = selectedTower;
      selectedTower = null;
      attemptMove(from, t);
      return; // attemptMove re-renders
    }
    render();
  }

  function attemptMove(from, to) {
    if (!G.isValidMove(state, from, to)) {
      // Invalid — flash the target briefly.
      const towerEl = el.board.querySelector(`.tower[data-tower="${to}"]`);
      if (towerEl) {
        towerEl.classList.add('drop-bad');
        setTimeout(() => towerEl.classList.remove('drop-bad'), 250);
      }
      render();
      return;
    }
    state = G.applyMove(state, from, to);
    moveCount++;
    el.moves.textContent = String(moveCount);
    updateMovesStyle();
    if (startTime === null && timerId === null) startTimer();
    render();
    if (G.isSolved(state, numDisks)) onWin();
  }

  /* ---------- Victory ---------- */
  function onWin() {
    won = true;
    stopTimer();
    updateMovesStyle();
    const min = G.minMoves(numDisks);
    el.winMoves.textContent = String(moveCount);
    el.winMin.textContent = String(min);
    el.winTime.textContent = formatTime(elapsedMs);
    el.winVerdict.innerHTML =
      moveCount === min
        ? '<span class="perfect">✨ Perfect — optimal solution!</span>'
        : `Solved in ${moveCount - min} move${moveCount - min === 1 ? '' : 's'} over the minimum.`;
    el.playerName.value = localStorage.getItem(NAME_KEY) || '';
    el.overlay.classList.add('show');
    el.playerName.focus();
    render(); // disables dragging
  }

  /* ---------- Leaderboard (localStorage) ---------- */
  function loadBoard() {
    try {
      return JSON.parse(localStorage.getItem(LB_KEY)) || [];
    } catch (_) {
      return [];
    }
  }
  function saveBoard(rows) {
    localStorage.setItem(LB_KEY, JSON.stringify(rows));
  }

  function renderLeaderboard() {
    const rows = loadBoard();
    const filter = parseInt(el.difficulty.value, 10);
    const scoped = rows
      .filter((r) => r.disks === filter)
      // Rank by moves, then by time.
      .sort((a, b) => a.moves - b.moves || a.timeMs - b.timeMs)
      .slice(0, 10);

    el.leaderboard.innerHTML = '';
    if (scoped.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="empty-note">No scores yet for ${filter} disks. Be the first to beat it!</td>`;
      el.leaderboard.appendChild(tr);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    scoped.forEach((r, i) => {
      const tr = document.createElement('tr');
      const rank = medals[i] ? `<span class="medal">${medals[i]}</span>` : `${i + 1}`;
      const perfect = r.moves === G.minMoves(r.disks) ? ' ✨' : '';
      tr.innerHTML = `
        <td>${rank}</td>
        <td>${escapeHtml(r.name)}${perfect}</td>
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
    const rows = loadBoard();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    rows.push({
      name,
      disks: numDisks,
      moves: moveCount,
      timeMs: elapsedMs,
      date,
    });
    saveBoard(rows);
    renderLeaderboard();
    el.overlay.classList.remove('show');
    newGame();
  }

  /* ---------- Wiring ---------- */
  el.difficulty.addEventListener('change', () => {
    newGame();
    renderLeaderboard();
  });
  el.restart.addEventListener('click', newGame);
  el.saveScore.addEventListener('click', saveScore);
  el.playAgain.addEventListener('click', () => {
    el.overlay.classList.remove('show');
    newGame();
  });
  el.playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveScore();
  });
  el.clearBoard.addEventListener('click', () => {
    if (confirm('Clear the entire local leaderboard? This cannot be undone.')) {
      localStorage.removeItem(LB_KEY);
      renderLeaderboard();
    }
  });

  // Init.
  newGame();
  renderLeaderboard();
})();
