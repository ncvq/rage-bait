# MASTER BAITER

A minimalist troll platformer for the browser, in the spirit of the "rage game" genre.
The goal is always the same: reach the glowing portal. The level does not want you to.

## Play

No build step. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000. Online 2-player connects to the deployed relay (see [Online play](#online-play)) from anywhere except localhost, where it expects `wrangler dev`.

## Modes

| Mode | Players | What happens |
|------|---------|--------------|
| Single player | 1 | You vs. the level. |
| Multiplayer | 2, one keyboard or online | Both players have to reach the portal. If either dies, both restart. |
| Special | 2, one keyboard or online | Shown as a mystery on the menu. When it starts, the players find out they're chained together: the chain is about 4 tiles long, a player standing on ground anchors a falling partner, and a dangling player can jump off the chain to climb back up. One player reaching the portal takes both through. |

Each mode keeps its own level progress.

## Online play

Picking Multiplayer or Special asks **OFFLINE** (one keyboard or 2 controllers, as before), **HOST ONLINE** or **JOIN ONLINE**. The host gets a 4-letter room code and the partner types it in. The game starts at the host's saved level, with the host as RED and the guest as BLUE. Online, every movement key, a controller or the touch buttons move your own knight. R restarts the level for both of you. Esc opens the level select, and while it's open your partner's game waits and tells them why. Either of you can pick a level, and it takes you both there. The unlocked levels go up to the furthest either of you had reached when you joined, plus anything you clear together. LEAVE (X) on that screen leaves the room, which ends it for both.

How it works: both browsers run the whole game and swap only their inputs (lockstep). Every input is played a few ticks late on both sides, so the two games stay identical. The delay is set from three pings when the game starts: half the slowest round trip, plus 7 ticks of slack for frame timing and jitter. Through the live relay that came to about 150 ms, and if one side falls behind, the other waits and shows "waiting for your partner...". Twice a second the host compares the knights' positions with the guest's. If they ever differ, the level restarts on both.

### Hosting the relay (Cloudflare)

`server/relay.mjs` is a Cloudflare Worker with a Durable Object per room code that passes each player's messages to the other. `wrangler.jsonc` deploys it and serves the game's files from the same Worker. Its build step copies `index.html`, `style.css`, `js/` and `assets/` into `dist/` (git-ignored), and only `dist/` is served. It used to serve the whole repo, and then `wrangler dev` restarted whenever anything in `.git` changed (VS Code's git integration does this often), which dropped every room ("lost the connection").

```bash
npx wrangler dev      # try it: open http://localhost:8787 in two tabs, host in one, join in the other
npx wrangler deploy   # publish
```

The game itself is on Cloudflare Pages (`rage-bait-8h2.pages.dev`, built from `main`), which only serves files. So the relay is this Worker, deployed separately at `master-baiter.gungonjohnrevel.workers.dev`. `NET_URL` in `js/game.js` points there, so online play works from Pages, from the Worker's own copy of the game, and from a file. A page served from `localhost` uses its own server instead, so `wrangler dev` tests the local relay. Pages doesn't deploy the Worker: after changing `server/relay.mjs`, run `npx wrangler deploy`.

Cost: each player sends about 60 small messages a second while playing. Durable Objects bill incoming WebSocket messages at 20 per request, so an hour of online play is about 21,600 requests.

## Controls

| Action  | Single player | Player 1 (2-player modes) | Player 2 (2-player modes) |
|---------|---------------|---------------------------|---------------------------|
| Move    | ← → or A D    | A D                       | ← →                       |
| Jump    | Space, ↑, W, Z (hold to jump higher) | W, Space | ↑ |
| Fire the lazer (boss pickup) | ↓ or S | | |

R restarts, Esc opens level select, M mutes. On the mode screen, L picks a level and P opens the knights screen: local profiles (N new, E rename, X delete), each with its own save, ranked by furthest level and by deaths.

` (backtick) on the title or mode screen opens the **admin panel**: play any level, unlock all, god mode, slow motion (1x / 0.5x / 0.25x), and reset save data. Its settings last for the session only; levels played with unlock-all on don't save progress, and N skips the current level.
On touch devices, on-screen buttons appear for single player and for online play (a ▼ FIRE button shows while you hold the lazer). Progress and death counts are saved in `localStorage`.

## Courses

Each mode has its own 10-level course and keeps its own progress.

**Single player**: classic trolls.

| # | Name | Trap |
|---|------|------|
| 1 | Just Walk Right | floor collapses under you |
| 2 | Mind Your Step | spikes pop up, the portal runs back to the start |
| 3 | Low Ceiling | ceiling crusher (bait it, then climb over) |
| 4 | Up Is Down | gravity pads and ceiling spikes |
| 5 | Commitment Issues | the portal keeps fleeing |
| 6 | Wrong Way | controls invert, then un-invert at the worst moment |
| 7 | Safe Spot | crumbling floor and a fake checkpoint |
| 8 | Behind You | saw blade chase and a last-second pit |
| 9 | Input Lag | jumps are delayed... until they aren't |
| 10 | The Warden | boss: make the armour charge into the wall, then strike |

Every tenth single-player level is a boss, and they are meant to be extremely hard: The Warden (10), The Undertaker (20), Old Gnasher (30) and The Mimic (40). Each has its own intro and defeat cutscene, its own music, and moves differently on every attempt. You can't attack: dodge one of its attacks so it hurts itself, then touch the stunned boss and hit the STRIKE keys in time. Grabs mean mashing jump to break free. Six hits in three phases, and it has to be done in one run: you get 5 lives (a hit costs one), and losing the last one starts the fight over from phase 1.

The arenas have platforms full of traps (one crumbles, one isn't really there, one pops spikes if you stand on it too long) and pickups that pop up and fade: hearts (+1 life), speed boots, a sword that parries one hit (parry a melee attack and the boss staggers), a feather for a double jump, and in the crypt a candle for more light. Some pickups are fakes; only the real ones sparkle. A red zone marks where each attack will land, and the bosses fake you out: a stunned-looking boss with its eyes still lit is only playing dead. Camping on the scaffolds doesn't work either: the Warden vaults up onto yours and lobs its halberd at you.

The Mimic is the final exam. In phase 1 it's a chest on legs that hides among crates and hexes your controls (WRONG WAY). In phase 2 it grows wings and fills the room with coin barrages (rings, spirals, aimed fans, a rain with one gap), and the only way to hurt it in the air is THE LAZER: a pickup whose aim sweeps back and forth until you press DOWN to fire. Phase 3 is all of that in the dark, with the floor turning to lava every few seconds (get up on the rock) and more hexes.

**Multiplayer**: co-op puzzles with stacked trolls, harder than single player. Both players must enter the portal.

| # | Name | Puzzle and trolls |
|---|------|-------------------|
| 1 | Hold The Door | hold a plate for your partner; the portal moves behind the gate, the screen mirrors, a spike pops |
| 2 | Boost | stand on your partner's head to climb; if you jump up top, the step retracts; controls swap; the portal dodges |
| 3 | Angry Plate | plates hold the crushers up, then reverse; any jump makes the crushers twitch |
| 4 | Two Keys | press two plates at once; holding one alone drops a saw on the slacker; you swap places near the portal |
| 5 | Going Up | call the lift for each other; it slips halfway, and a jump on the shelf rocks it; the screen flips |
| 6 | Two Lanes | one player per lane, holding each other's gates; hidden spikes; the screen flips upside down |
| 7 | Weight Limit | one person on the bridge at a time; the first across gets swapped back to the start, and the bridge tiles drop |
| 8 | Swap Meet | controls swap, unswap, then swap again at the spike |
| 9 | Crate Expectations | one crate is a mimic that grows spikes; the real crate breaks once one of you is inside |
| 10 | Trust Issues | the lift slips; the real portal moves down next to the fake one; mirror mode |

**Special (chained)**: built around the chain. One player reaching the portal takes both through.

| # | Name | Puzzle and trolls |
|---|------|-------------------|
| 1 | Tethered | jump the collapsing pit together; the chain shrinks; two spikes in a row |
| 2 | Haul | the climber drags the other up; jumping up top yanks your partner back down; you swap places and the chain shrinks |
| 3 | Counterweight | a mimic crate, the real crate onto the plate, then run the gate together before it slams |
| 4 | Lift Together | the lift changes its mind halfway; jumping in the lift sends it back down; the chain shrinks |
| 5 | Leash | saw chase where every jump speeds up the saw; the chain stretches, then shrinks |
| 6 | Weight Limit | the bridge holds one person; the other dangles underneath; then the screen flips |
| 7 | Up Is Down (Together) | shared gravity flips, a hole in the ceiling, a short chain, hidden ceiling spikes |
| 8 | Lift Off | the first plate press is a lie (spikes); press again; the pillar hiccups |
| 9 | Crumble Run | the floor crumbles; the chain shrinks to almost nothing; you swap places mid-run |
| 10 | The End (Together) | the portal drops onto a hidden step; the fake portal flips the world |

## Punishment (2-player modes)

- **3 strikes:** three deaths in one level send you back a level and delete that level's unlock.
- **Blame:** every death names the player who died ("BLUE is the weak link.").
- **Shame scoreboard:** a running PINK vs. BLUE death count for each mode, shown on the HUD.
- **Level-end mockery:** whoever died more in a level gets roasted on the "level complete" screen.

## Co-op mechanics

- **Plates and gates**: colored plates open blocks with matching colored dots.
- **Crates**: push them, stand on them, drop them on plates, or drop them on your partner.
- **Stacking**: players can stand on each other's heads.
- **Chain (Special)**: the chain is about 4 tiles long, but levels shrink and stretch it. A player standing on ground anchors a falling partner, a dangling player can jump off the chain, and walking away hauls your partner up a wall. If the chain touches popped spikes or a saw, it snags and yanks you both.
- **Mimic crates**: touch one and it grows spikes, then crumbles away.
- **Rule changes**: the screen can mirror or flip upside down, players can swap places, controls can swap.

## Project layout

- `index.html`, `style.css`: page shell and touch controls
- `js/game.js`: engine (physics, collision, traps, rendering, audio, menus)
- `js/levels.js`: level scripts; the header comment documents the level API
- `tests/solve.js`: Playwright bot that proves all 30 levels are beatable (`node tests/solve.js multi 3` runs one level)
- `server/relay.mjs`, `wrangler.jsonc`: the online relay (a Cloudflare Worker + Durable Object) and its deploy config
- `tests/net.js`: two copies of the game playing online through the relay's real `Room` class, checked tick for tick

## Making levels

Levels are small scripts on a 32 x 18 tile grid. Traps are just triggers:

```js
{
  name: 'Example',
  build(L) {
    L.spawn(2, 15);
    L.block(0, 15, 32, 3);                           // floor
    const s = L.spike(14, 15, 2, 'up', { hidden: true });
    L.on(() => L.px > 12, () => s.pop());            // spikes pop when you get close
    const d = L.door(28, 15);
    L.on(() => L.near(d, 3), () => L.moveDoor(d, 3, 15, 40)); // portal flees
  },
}
```

Levels live in `js/levels.js` as three arrays (`SINGLE`, `MULTI`, `SPECIAL`). After editing a level, update its bot policy in `tests/solve.js` and run `node tests/solve.js`.

## Art and effects

The game is drawn at 480x270 and scaled up by a whole number (black bars fill the rest), so every pixel stays square. Each block of 10 levels is a deeper area of the dungeon: The Upper Halls (1-10), The Crypt (11-20), The Flooded Depths (21-30) and The Molten Core (31-40), in every mode.

Torches, the portal, the bat and the death poof are [pixelfx](https://github.com/patch-gg/pixelfx) effects pre-rendered into sprite sheets in `assets/fx/`. To change or regenerate them, edit the list in `tools/build-fx.mjs` and run it against a pixelfx checkout:

```bash
git clone https://github.com/patch-gg/pixelfx ../pixelfx
node tools/build-fx.mjs ../pixelfx
```

## Story and cutscenes

A treasure waits at the bottom of the castle. A new run opens with the knights walking into the castle, every tenth level ends with them coming out of a portal into the next area and a flyover of the hazards waiting there, and the last level ends at the treasure. Cutscenes are voxel scenes in `js/cutscenes.js`, rendered with three.js at 480x270 and posterized so they match the pixel art. Any key or the SKIP button skips them. Without WebGL the game skips them and plays as before.

## Credits

- **BoldPixels** font by YukiPixels (https://yukipixels.itch.io/boldpixels), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). `assets/fonts/BoldPixels.ttf` is unmodified.
- **three.js** r159 (https://threejs.org), MIT License, vendored as `js/vendor/three.min.js` (see `js/vendor/three.LICENSE`).
- **pixelfx** by Patch (https://github.com/patch-gg/pixelfx), MIT License. Some of its effects adapt Hugo Duprez's open-source pixel art VFX (https://www.spritefusion.com/pixel-art-vfx), MIT License.
