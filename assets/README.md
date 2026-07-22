# Assets

## `monster.png`

The 3D Maze uses `assets/monster.png` for the monster — both the in-maze
billboard sprite and the jumpscare face.

- The dark background is **keyed out automatically** at load (pixels darker than
  a luminance threshold become transparent), so a night-time / dark-background
  photo of a creature works well.
- If `monster.png` is missing, the game **gracefully falls back** to a
  procedurally drawn creature (in-maze) and the 👹 emoji (jumpscare) — nothing
  breaks.

Any aspect ratio works; the sprite is scaled and grounded automatically.
Recommended: a reasonably sized PNG/JPG (e.g. ≤ 1600px on the long edge).
