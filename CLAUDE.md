# Master Baiter

A troll platformer ("rage game") in plain browser JS: 3 modes (single, multi, special = chained co-op) × 40 levels. It's dressed as a pixel-art dungeon, "The Descent": knights go down through a castle for treasure. Every 10 levels is a deeper area. Player-facing docs and credits are in `README.md`.

## Verify every change

1. `node tests/solve.js` must end `errors: []` and `OK: 124 checks`. It plays every level with a bot. It runs without three.js, canvas or audio, so it only proves gameplay.
2. For anything visual, take a screenshot and look at it: `tools/shot.sh out.png "<query>"` (the query options are listed at the top of `tools/preview.html`). Errors and `FLOW` lines land in `out.png.log`. Phone layout: `SIZE=844,390 DPR=3 tools/shot.sh p.png "level=1&touch=1"`.
3. If `index.html`'s `<body>` changes, make the same change in `tools/preview.html`.

## Hard constraints

- **Opening `index.html` directly from disk (file://) must work: no build step and no server.** So: classic `<script>` tags (no ES modules), data shipped as JS (`js/fx-data.js`, not JSON), and three.js pinned to the r159 single-file UMD build in `js/vendor/` (r160+ is modules only). Fonts and images load fine from file://.
- **Cutscenes are optional.** `window.Cutscenes` is `null` without WebGL or three.js (always the case in tests). Then `playCut(id, then)` just calls `then()`. Keep the game fully playable on that path.
- **Gameplay readability beats decoration.** Sprites are drawn to their exact hitboxes. Hazards look identical in every area. Real and fake portals use the same sprite (that's the joke). A linked block shows the colour of its button. Background decor must never look like a hazard.
- **Reduce flashing (`save.calm`: F key, or SETTINGS on the title screen).** Any new shake, blink, strobe or flash must check `save.calm` and tone itself down, as the existing ones do: no screen shake, a steady laser warning, a dim reveal flash, and the lights-out flicker turned into a half-dim reveal.

## Rendering rules (js/game.js)

- Draw code works in **VW units** (960×540, `TILE` = 30). The canvas is **480×270**, so one art pixel = `PX` = 2 units. CSS scales the canvas by a whole number with black bars (`resize()`); it never smooths.
- Keep art on the pixel grid: `R(x,y,w,h,col)` (snapped rect), `r()` (art-pixel rect around a translated origin, used for sprites), `sn()` (snap a value). Avoid `arc`, `roundRect` and `shadowBlur`: they blur at this resolution.
- Text goes through `text(str, x, y, size, color, align, _, outline)`. Sizes snap to the BoldPixels native 16, 32 or 48 px (≤28 → 16px, ≤60 → 32px, else 48px). The font has no `✕ ☠ ≡`: `✕` is mapped to `×`, death counts use `skullIcon()`, and the touch menu button says "ESC".
- Areas: `areaOf(levelIdx)` = `floor(idx / 10)` → `AREAS[0..3]` (Upper Halls, Crypt, Flooded Depths, Molten Core). This holds in every mode. Each area's wall (`bgArt`) and block tiles (`tileArt`) are painted once and cached.
- pixelfx effects: `drawFx(name, t, x, y)` with its pivot at x, y; one-shots via `spawnFx`. To add or recolour one, edit the list in `tools/build-fx.mjs` and run it against a pixelfx checkout (`git clone https://github.com/patch-gg/pixelfx`). The script rewrites `assets/fx/*.png` and `js/fx-data.js`; don't edit those by hand.
- Menus share `panel()` (bevelled stone, gold frame when selected) and `menuBg()` (dimmed wall with two torches).

## Story and cutscenes

- Triggers: a mode started at level 1 (Enter on the mode screen) → `intro`. `game.next()` going into level 11, 21 or 31 → `area1`, `area2` or `area3`. Going past the last level → `ending` (the mimic), then the `end` screen. Picking a level from the level select never plays a cutscene.
- `js/cutscenes.js`: voxel scenes built with `builder()` (boxes merged into one mesh), drawn at 480×270, then posterized and ordered-dithered in a shader pass. A scene is `{ dur, update(t), overlay(t, ui) }`. The game draws the frame, then calls `overlay` with `cutUI` (bars, caption, label, shout, fadeOut, card) and draws the SKIP button. Input in the first 0.5s is ignored.
- The castle scene is shared by the title screen and the intro. Anything the intro adds to it must be removed in `done()`; a chain left behind on the path was a real bug. The other scenes are freed in `Cutscenes.end()`.
- Area previews: `STATIONS[n]` lists 4 looping hazard dioramas per area. The `PITS` stations get a hole cut in the floor.

## Death messages and knights

- `kill(p, cause, src)` takes the object that killed (spike, saw, laser, block). `deathKind()` turns that into a key of `DEATH`, the message pools; `KILLER` names it for the "3 in a row" streak line. A new trap or kill cause needs a pool, or it falls back to `other`. A fake or dropped floor beats whatever was under it.
- Knights are local profiles: `ragebait.knights.v1` holds the list, and each knight's save sits at `ragebait.save.v1:<id>` (knight 0 uses the old key, so old saves carry over). `useKnight()` swaps the contents of the shared `save` object. `save.best` (furthest level, never lowered by strikes or admin skips) feeds the leaderboard.

## Music

`SONGS` in game.js is a small step sequencer. Each channel (`lead`, `bass`, `arp`, `drums`) is a list of bars, each exactly 16 space-separated steps: a note like `c#4`, `.` for a rest, `-` to hold. Drums use `k`, `s`, `h`. Channels loop on their own lengths. `music.want(id)` in the main loop picks the song: `title` (menus and intro), `area0`–`area3` (levels and area cutscenes), `ending`, `win`. `M` mutes music and sound effects together.

## Current state (2026-11-27; update or delete this section as it changes)

- **Branches.** Work happens on local branch `sanga-descent` (commits `c2dd12c` assets, `b3930fa` redesign and cutscenes). It is **not pushed yet**: the user runs `git push -u origin sanga-descent` themselves. Local `sanga` was deliberately left at `877f7d5`.
- **Uncommitted on `sanga-descent`:** the menu restyle, music, reduce flashing, touch polish, death messages per trap, knights (profiles + leaderboard), `tools/preview.html`, `tools/shot.sh` and this file.
- **Teammate restructure is blocked.** `origin/sanga` has `fe53cf5` ("Optimized thru typescript…"). It deletes `js/levels.js` and makes `index.html` load `js/helpers.js`, `js/console.js` and `js/{singles,multi,multi/chained}/mode.js`, none of which were committed, so tests fail on it. Once the teammate pushes those files, port the Descent work into their layout. If they author in TypeScript, the edits go into their `.ts` sources, not compiled output. Don't force-push `sanga`.
- **Not yet verified:** how the music sounds (headless Chrome has no audio), and frame rate on a real GPU or phone (only SwiftShader was tested).
- **Backlog the user saw and hasn't picked yet:**
  - gravestones where you died
  - a hidden coin per level (all 40 changes the ending)
  - a death-cause stats screen (deaths per cause are already saved in `save.causes`; the shame board shows only the top one)
  - a gimmick per area (crypt ghosts, deep water, rising lava)
  - a ghost replay of your last attempt
  - CI running `tests/solve.js` on pull requests
  - publishing on itch.io or Patch (public, so only on the user's go-ahead)
