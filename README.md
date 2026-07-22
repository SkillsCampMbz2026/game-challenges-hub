# 🎮 Game Challenges Hub

A responsive, dependency-free web app of brain-teasing game challenges. The
flagship challenge is a fully featured **Tower of Hanoi** puzzle.

> **▶️ Live demo:** https://SkillsCampMbz2026.github.io/game-challenges-hub/

## Challenges

The [hub menu](index.html) lists all challenges. Currently playable:

### 🗼 Tower of Hanoi

Move the entire stack of disks from the **Start** tower to the **Goal** tower
using the fewest moves possible — never placing a larger disk on a smaller one.

**Features**

- **Three towers** with disks you can **drag _or_ click** to move.
- **Valid-move checking** — illegal moves are rejected with visual feedback.
- **Move counter** and a **minimum-moves** display (`2ⁿ − 1`).
- **Difficulty selection** by number of disks (3–8).
- **Restart** button and clear **instructions / objective**.
- **Automatic victory detection** with a summary of your run.
- **Live timer** for completion time.
- A **localStorage leaderboard** per difficulty, saving player name, disk
  count, moves, and completion time (ranked by moves, ties broken by time).

## How to play

- **Click** a tower to lift its top disk, then click another tower to drop it.
- Or **drag** the top disk onto another tower.
- A disk may never rest on a smaller disk; only the top disk of a tower moves.
- Rebuild the full stack on the **Goal** tower to win. Match the minimum
  move count for a ✨ **perfect** run.

## Project structure

```
index.html            # Game Challenges hub menu
tower-of-hanoi.html   # The Tower of Hanoi game
css/styles.css        # Shared responsive styles (light on the eyes, dark theme)
js/game-core.js       # Pure game logic (rules, solver) — shared by app & tests
js/hanoi-ui.js        # Browser UI: rendering, drag/click, timer, leaderboard
test/solve.test.js    # Logic test: solves & beats every difficulty optimally
test/ui.test.js       # UI test (jsdom): beats the puzzle via simulated clicks
```

The game logic lives in `js/game-core.js` with **no DOM dependencies**, so the
exact same rules that run in the browser are unit-tested in Node.

## Running locally

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .        # or: python -m http.server
```

## Tests

```bash
npm install        # for the jsdom-based UI test
npm test           # solves & beats disks 3–8 in the minimum moves
npm run test:ui    # plays the real UI in jsdom and beats a 3-disk game
```

Both suites pass — the puzzle is verifiably beatable (and beaten) at every
difficulty in the optimal number of moves.

## License

[MIT](LICENSE)
