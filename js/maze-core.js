/*
 * 3D Maze — pure maze logic (no DOM), shared by the browser UI and Node tests.
 *
 * A "perfect" maze (exactly one path between any two cells, no loops, fully
 * connected) is generated with a recursive-backtracker (randomised DFS). Because
 * every cell is reachable, the maze is ALWAYS solvable.
 *
 * Two representations are produced:
 *   - cell walls: for movement / pathfinding on the cols×rows cell grid
 *   - an expanded 0/1 wall grid of size (2*cols+1)×(2*rows+1): for raycasting,
 *     where 1 = solid wall, 0 = open space. Cell (cx,cy)'s centre is the grid
 *     square (2*cx+1, 2*cy+1); the square between two connected cells is open.
 */

// Direction indices: 0=E, 1=S, 2=W, 3=N. (+y points "south"/down.)
const DIRVEC = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function generateMaze(cols, rows, rng = Math.random) {
  const gw = 2 * cols + 1;
  const gh = 2 * rows + 1;
  // Expanded grid, all walls to start.
  const grid = [];
  for (let y = 0; y < gh; y++) grid.push(new Uint8Array(gw).fill(1));

  const visited = [];
  for (let y = 0; y < rows; y++) visited.push(new Uint8Array(cols).fill(0));

  function centre(cx, cy) {
    return [2 * cx + 1, 2 * cy + 1];
  }

  // Iterative randomised DFS from (0,0).
  const stack = [[0, 0]];
  visited[0][0] = 1;
  { const [sx, sy] = centre(0, 0); grid[sy][sx] = 0; }

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    // Collect unvisited neighbours.
    const options = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRVEC[d][0];
      const ny = cy + DIRVEC[d][1];
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny][nx]) {
        options.push(d);
      }
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const d = options[Math.floor(rng() * options.length)];
    const nx = cx + DIRVEC[d][0];
    const ny = cy + DIRVEC[d][1];
    // Carve: open the neighbour centre and the wall square between.
    const [ccx, ccy] = centre(cx, cy);
    const [ncx, ncy] = centre(nx, ny);
    grid[(ccy + ncy) / 2][(ccx + ncx) / 2] = 0;
    grid[ncy][ncx] = 0;
    visited[ny][nx] = 1;
    stack.push([nx, ny]);
  }

  return {
    cols,
    rows,
    gw,
    gh,
    grid,
    start: { x: 0, y: 0 },
    goal: { x: cols - 1, y: rows - 1 },
  };
}

/** Can you move from cell (cx,cy) in direction d? (i.e. is the wall open?) */
function canMove(maze, cx, cy, d) {
  const [dx, dy] = DIRVEC[d];
  const nx = cx + dx;
  const ny = cy + dy;
  if (nx < 0 || nx >= maze.cols || ny < 0 || ny >= maze.rows) return false;
  const wallX = 2 * cx + 1 + dx;
  const wallY = 2 * cy + 1 + dy;
  return maze.grid[wallY][wallX] === 0;
}

/**
 * Breadth-first shortest path from start to goal over the cell graph.
 * Returns an array of {x,y} cells (inclusive of both ends), or null.
 */
function shortestPath(maze, start = maze.start, goal = maze.goal) {
  const { cols, rows } = maze;
  const key = (x, y) => y * cols + x;
  const prev = new Map();
  const seen = new Uint8Array(cols * rows);
  const queue = [start];
  seen[key(start.x, start.y)] = 1;

  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === goal.x && cur.y === goal.y) {
      // Reconstruct.
      const path = [cur];
      let k = key(cur.x, cur.y);
      while (prev.has(k)) {
        const p = prev.get(k);
        path.push(p);
        k = key(p.x, p.y);
      }
      path.reverse();
      return path;
    }
    for (let d = 0; d < 4; d++) {
      if (!canMove(maze, cur.x, cur.y, d)) continue;
      const nx = cur.x + DIRVEC[d][0];
      const ny = cur.y + DIRVEC[d][1];
      const nk = key(nx, ny);
      if (seen[nk]) continue;
      seen[nk] = 1;
      prev.set(nk, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** Minimum number of steps (cell moves) from start to goal. */
function minMoves(maze) {
  const p = shortestPath(maze);
  return p ? p.length - 1 : Infinity;
}

/** True if every cell is reachable from the start (i.e. a valid perfect maze). */
function isFullyConnected(maze) {
  const { cols, rows } = maze;
  const key = (x, y) => y * cols + x;
  const seen = new Uint8Array(cols * rows);
  const queue = [maze.start];
  seen[key(maze.start.x, maze.start.y)] = 1;
  let count = 1;
  while (queue.length) {
    const cur = queue.shift();
    for (let d = 0; d < 4; d++) {
      if (!canMove(maze, cur.x, cur.y, d)) continue;
      const nx = cur.x + DIRVEC[d][0];
      const ny = cur.y + DIRVEC[d][1];
      const nk = key(nx, ny);
      if (seen[nk]) continue;
      seen[nk] = 1;
      count++;
      queue.push({ x: nx, y: ny });
    }
  }
  return count === cols * rows;
}

/**
 * Line of sight between two cells: true if the straight segment between their
 * centres (in expanded-grid units) passes through no solid wall square. Used by
 * the Hide & Seek "seeker" to decide whether it can see the player.
 */
function hasLineOfSight(maze, a, b) {
  const ax = 2 * a.x + 1 + 0.5, ay = 2 * a.y + 1 + 0.5;
  const bx = 2 * b.x + 1 + 0.5, by = 2 * b.y + 1 + 0.5;
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const gx = Math.floor(ax + dx * t);
    const gy = Math.floor(ay + dy * t);
    if (maze.grid[gy][gx] === 1) return false;
  }
  return true;
}

const MazeCore = {
  DIRVEC,
  generateMaze,
  canMove,
  shortestPath,
  minMoves,
  isFullyConnected,
  hasLineOfSight,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MazeCore;
}
if (typeof window !== 'undefined') {
  window.MazeCore = MazeCore;
}
