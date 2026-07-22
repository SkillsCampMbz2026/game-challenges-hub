/* Lights Out — browser UI, built on top of LightsOutCore. */
(function () {
  'use strict';

  const L = window.LightsOutCore;
  const SIZE = 5;
  const LB_KEY = 'lightsout.leaderboard.v1';
  const NAME_KEY = 'lightsout.lastName';

  // Difficulty = target range for the board's true minimum-move count.
  const DIFFICULTIES = {
    easy: { label: 'Easy', lo: 3, hi: 6 },
    medium: { label: 'Medium', lo: 7, hi: 10 },
    hard: { label: 'Hard', lo: 11, hi: 14 },
    expert: { label: 'Expert', lo: 15, hi: 15 },
  };

  const el = {
    difficulty: document.getElementById('difficulty'),
    restart: document.getElementById('restart'),
    hint: document.getElementById('hint'),
    board: document.getElementById('board'),
    moves: document.getElementById('moves'),
    minMoves: document.getElementById('minMoves'),
    lightsOn: document.getElementById('lightsOn'),
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

  let board;
  let optimal; // minimum moves for the starting board
  let moveCount = 0;
  let startTime = null;
  let timerId = null;
  let elapsedMs = 0;
  let won = false;
  let hintCell = null;

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
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  /* ---------- Board generation ---------- */
  // Generate a solvable board whose true minimum lands in the difficulty range.
  function generateBoard(diffKey) {
    const { lo, hi } = DIFFICULTIES[diffKey];
    let best = null;
    let bestDist = Infinity;
    for (let attempt = 0; attempt < 400; attempt++) {
      const scramble = lo + Math.floor(Math.random() * (hi - lo + 3));
      const candidate = L.randomBoard(SIZE, scramble, Math.random);
      const min = L.minMoves(candidate, SIZE);
      if (min >= lo && min <= hi) return { board: candidate, min };
      const dist = min < lo ? lo - min : min - hi;
      if (min > 0 && dist < bestDist) { bestDist = dist; best = { board: candidate, min }; }
    }
    // Fallback: closest we found (still guaranteed solvable).
    return best || (function () {
      const c = L.randomBoard(SIZE, hi, Math.random);
      return { board: c, min: L.minMoves(c, SIZE) };
    })();
  }

  function newGame() {
    const diff = el.difficulty.value;
    const gen = generateBoard(diff);
    board = gen.board;
    optimal = gen.min;
    moveCount = 0;
    won = false;
    hintCell = null;
    elapsedMs = 0;
    stopTimer();
    startTime = null;
    el.moves.textContent = '0';
    el.minMoves.textContent = String(optimal);
    el.time.textContent = '00:00';
    updateMovesStyle();
    render();
  }

  function updateMovesStyle() {
    el.moves.classList.toggle('optimal', won && moveCount === optimal);
    el.moves.classList.toggle('over', moveCount > optimal);
  }

  function lightsOnCount() {
    return board.reduce((a, v) => a + v, 0);
  }

  /* ---------- Rendering ---------- */
  function render() {
    el.board.style.setProperty('--cols', String(SIZE));
    el.board.innerHTML = '';
    board.forEach((v, i) => {
      const cell = document.createElement('button');
      cell.className = 'cell' + (v ? ' on' : '') + (i === hintCell ? ' hint' : '');
      cell.type = 'button';
      cell.dataset.index = String(i);
      cell.setAttribute('aria-label', `Cell ${i + 1}, ${v ? 'on' : 'off'}`);
      cell.addEventListener('click', () => onCellClick(i));
      el.board.appendChild(cell);
    });
    el.lightsOn.textContent = String(lightsOnCount());
  }

  /* ---------- Move handling ---------- */
  function onCellClick(i) {
    if (won) return;
    L.applyPress(board, i, SIZE);
    moveCount++;
    hintCell = null; // any move clears the current hint
    el.moves.textContent = String(moveCount);
    updateMovesStyle();
    if (startTime === null && timerId === null) startTimer();
    render();
    if (L.isSolved(board)) onWin();
  }

  function showHint() {
    if (won) return;
    const presses = L.solve(board, SIZE);
    if (!presses || presses.length === 0) return;
    hintCell = presses[0];
    render();
  }

  /* ---------- Victory ---------- */
  function onWin() {
    won = true;
    stopTimer();
    updateMovesStyle();
    el.winMoves.textContent = String(moveCount);
    el.winMin.textContent = String(optimal);
    el.winTime.textContent = formatTime(elapsedMs);
    el.winVerdict.innerHTML =
      moveCount === optimal
        ? '<span class="perfect">✨ Perfect — solved in the minimum moves!</span>'
        : `Solved in ${moveCount - optimal} move${moveCount - optimal === 1 ? '' : 's'} over the minimum.`;
    el.playerName.value = localStorage.getItem(NAME_KEY) || '';
    el.overlay.classList.add('show');
    el.playerName.focus();
  }

  /* ---------- Leaderboard (localStorage) ---------- */
  function loadBoardScores() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
    catch (_) { return []; }
  }
  function saveBoardScores(rows) {
    localStorage.setItem(LB_KEY, JSON.stringify(rows));
  }

  function renderLeaderboard() {
    const rows = loadBoardScores();
    const filter = el.difficulty.value;
    const scoped = rows
      .filter((r) => r.difficulty === filter)
      .sort((a, b) => a.moves - b.moves || a.timeMs - b.timeMs)
      .slice(0, 10);

    el.leaderboard.innerHTML = '';
    if (scoped.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="empty-note">No scores yet for ${DIFFICULTIES[filter].label}. Be the first to clear it!</td>`;
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
    const rows = loadBoardScores();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    rows.push({
      name,
      difficulty: el.difficulty.value,
      moves: moveCount,
      timeMs: elapsedMs,
      date,
    });
    saveBoardScores(rows);
    renderLeaderboard();
    el.overlay.classList.remove('show');
    newGame();
  }

  /* ---------- Wiring ---------- */
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

  newGame();
  renderLeaderboard();
})();
