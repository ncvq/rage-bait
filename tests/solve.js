// Solvability check: a scripted bot plays every level of every course through the
// deterministic test hook (window.__ragebait). Run: node tests/solve.js  (needs playwright)
// Optional filter: node tests/solve.js multi 3   (course, 1-based level)
const { chromium } = require('playwright');
const [onlyCourse, onlyLevel] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(300);
  const res = await page.evaluate(([onlyCourse, onlyLevel]) => {
    const R = window.__ragebait;
    // ---- single-player policies: (L, k, st) => sets k.left/right, returns true to press jump
    const J = (st, name, c) => { if (c && !st[name]) { st[name] = 1; return true; } return false; };
    // Hop runner for the long single-player levels. H is a list of hops; each one walks to `prep` (or
    // just stops, with stop: 1, on narrow footholds), waits for ok(L), runs in direction d (0 = jump in
    // place), then at `at` (a number, or a function of L) either jumps (holding jump for `hold` steps, default a full jump) or, with
    // walk: 1, moves on to the next hop. In the air it steers toward `to`, once above `upTo` (ladders).
    // o.pause(L): while grounded and true, stand still and wait.
    const hopper = (H, o = {}) => (L, k, st) => {
      const p = L.player; st.i = st.i || 0; const h = H[st.i];
      if (!h) return false;
      const press = (d) => { if ((d > 0) !== L.invert) k.right = 1; else k.left = 1; };
      const next = () => { st.i++; st.ready = 0; st.air = 0; };
      if (st.air) {
        if (p.grounded && L.t > st.air) next();
        else if (h.to !== undefined && (h.upTo === undefined || L.py < h.upTo) && (h.to - L.px) * h.d > 0.3) press(h.d);
        return false;
      }
      if (o.pause && p.grounded && o.pause(L)) return false;
      if ((h.prep !== undefined || h.stop) && !st.ready) {
        if (!h.stop && Math.abs(L.px - h.prep) > 0.12) press(Math.sign(h.prep - L.px));
        else if (Math.abs(p.vx) < 0.3 && (!h.ok || h.ok(L))) st.ready = 1;
        return false;
      }
      if (h.d) press(h.d);
      const at = typeof h.at === 'function' ? h.at(L) : h.at;
      if ((!h.d || (L.px - at) * h.d >= 0) && p.grounded) {
        if (h.walk) { next(); return false; }
        st.air = L.t + 0.05; return h.hold || true;
      }
      return false;
    };
    const crusherSafe = (L, o) => { const ph = (L.t + o) % 1.8; return ph > 1.18 && ph < 1.28; };
    // Red Light: your colour is up, with at least `min` seconds left on it
    const rlGo = (min) => (L) => L.light === L.go && L.lightEnds - L.t > min;
    // Deja Vu: the pit saw is on its way down and low enough to jump over
    const pitSafe = (L) => Math.sin(L.t * 2.4) > 0.17 && Math.cos(L.t * 2.4) > 0;
    const dejaEven = hopper([
      { d: 1, at: 6.7, to: 11.6 },                                          // floor spike at 9
      { d: 1, prep: 13.6, ok: pitSafe, at: 13.8, to: 18.8 },                // pit
      { d: 1, at: 25.2, to: 28 },                                           // step (take off before its edge)
      { d: 1, prep: 27.4, at: 27.4, to: 31.1 },                             // platform: the high portal is real
    ]);
    const dejaOdd = hopper([
      { d: 1, prep: 13.6, ok: pitSafe, at: 13.8, to: 18.6 },                // pit (no jumping near 9: roof trap)
      { d: 1, at: 19.7, to: 25.0 },                                         // floor spike at 22
      { d: 1, at: 30.8, walk: 1 },                                          // the low portal is real
    ]);
    // The Undoing, room by room. room B's laser in the 5x zone is off for (t % 1.6) in [0.8, 1.6)
    const undoing = {
      A: hopper([
        { d: 1, prep: 4.5, ok: rlGo(1.0), at: 4.8, to: 10.0 },             // onto the first fake strip
        { d: 1, stop: 1, ok: rlGo(1.0), at: 10.5, to: 14.6 },              // second fake strip
        { d: 1, stop: 1, ok: rlGo(1.0), at: 15.5, to: 21 },                // island
        { d: 1, prep: 25.2, ok: rlGo(1.0), at: 27, walk: 1 },              // walk off into the pit
      ], { pause: (L) => L.light !== L.go }),
      B: hopper([
        { d: 1, stop: 1, ok: (L) => L.py > 14, at: 0, walk: 1 },           // fall all the way in to floor 0 first
        { d: 1, at: 9.0, to: 13, hold: 4 },                                // tap under the spike ceiling
        { d: 1, prep: 13.4, ok: (L) => { const c = L.t % 1.6; return c > 0.8 && c < 1.15; }, at: 23.0, walk: 1 }, // 5x through the laser
        { d: 1, at: 23.4, to: 27.5 },                                      // teleport tile
        { d: -1, prep: 29.8, at: 29.8, hold: 130, upTo: 9.2, to: 27 },     // ladder up to floor 1
        { d: -1, at: 22.3, to: 18.8 },                                     // teleport tile
        { d: -1, at: 14.3, to: 10.8 },                                     // hole
        { d: -1, prep: 4.7, at: 4.7, hold: 260 },                          // ladder out through the ceiling
      ]),
      C: hopper([
        { d: 1, prep: 1.5, ok: (L) => L.blocks[0].y <= 9.001, at: 2.3, to: 6.4 }, // top of the rise: running jump over the saw into the near portal
      ]),
    };
    // seconds left in a laser's off window (-1 while it is on)
    const off = (l, L) => { const c = (L.t + l.phase) % (l.on + l.off); return c < l.on ? -1 : l.on + l.off - c; };
    const SINGLE = [
      // 1
      (L, k, st) => { k.right = 1; return J(st, 'a', L.px > 16.2); },
      // 2: jump spikes going right, door flees, go back left jump spike at 5
      (L, k, st) => {
        if (!st.back) { k.right = 1; k.left = 0; if (L.doors[0].tween) st.back = 1; return J(st, 'a', L.px > 11.2); }
        k.right = 0; k.left = 1; return J(st, 'b', L.px < 17.0 && L.px > 15) || J(st, 'c', L.px < 8.6);
      },
      // 3: bait crusher then climb over
      (L, k, st) => {
        if (!st.baited) { if (L.blocks[2].pending || L.blocks[2].falling) { st.baited = 1; return false; } k.right = 1; if (L.px > 10.95) st.baited = 1; return false; }
        if (!st.landed) { k.right = 0; k.left = 1; if (L.blocks[2].y >= 11.99 && !L.blocks[2].falling) { st.landed = 1; } return false; }
        k.left = 0; k.right = 1; return J(st, 'a', L.px > 9.6) || J(st, 'b', L.px > 21.3);
      },
      // 4
      (L, k, st) => {
        if (L.g > 0 && !st.f) { k.right = 1; return false; }
        st.f = 1;
        if (!st.land) { k.right = 0; k.left = 0; if (L.player.grounded) st.land = 1; return false; }
        k.right = 1; return J(st, 'a', L.px > 11.3);
      },
      // 5
      (L, k, st) => {
        const d = L.doors[0];
        if (!st.s) { k.right = 1; k.left = 0; if (d.tween) st.s = 1; return false; }
        if (st.s === 1) { k.right = 0; k.left = 1; if (d.tween && d.tween.y < 9) st.s = 2; return false; }
        // go climb: walk to x~6.5 then jump onto step, then platform
        if (L.px < 6.2) st.go = 1;
        if (!st.go) k.left = 1;
        if (st.go) { k.left = 0; k.right = 1; }
        if (st.go && L.px > 16) { k.right = 0; k.left = 1; }
        if (st.go) return L.player.grounded && ((L.py > 13 && L.px > 6.6 && L.px < 8) || (L.py < 12.5 && L.px > 10));
        return false;
      },
      // 6 inverted
      (L, k, st) => {
        if (L.invert) { k.left = 1; k.right = 0; } else { k.right = 1; k.left = 0; }
        if (st.passed && !L.invert) { k.right = 1; k.left = 0; }
        if (L.px > 22.6) st.passed = 1;
        return J(st, 'a', L.px > 9.6) || J(st, 'b', L.px > 17.6) || J(st, 'c', L.px > 24.6);
      },
      // 7
      (L, k, st) => { k.right = 1; return J(st, 'a', L.px > 7.4) || J(st, 'b', L.px > 12.0 && L.player.grounded) || J(st, 'c', L.px > 17.4 && L.player.grounded); },
      // 8
      (L, k, st) => { k.right = 1; return J(st, 'a', L.px > 8.4) || J(st, 'b', L.px > 17.4) || J(st, 'c', L.px > 24.3); },
      // 9 lag: press 0.22s (~1.76 tiles) early
      (L, k, st) => { if (L.px > 31) st.back = 1; k.right = !st.back; k.left = !!st.back; return J(st, 'a', L.px > 5.2) || J(st, 'b', L.px > 12.1 && L.player.grounded) || J(st, 'c', L.px > 18.0 && L.player.grounded) || J(st, 'd', L.px > 25.5 && L.player.grounded); },
      // 10: bump hidden blocks then climb
      (L, k, st) => {
        const p = L.player;
        if (!st.s) { k.right = 1; if (L.px > 9.6) { k.right = 0; st.s = 1; } return false; }
        if (st.s === 1) { k.right = 0; if (Math.abs(p.vx) < 0.1 && p.grounded) { st.s = 2; return true; } return false; }
        if (st.s === 2) { if (!L.blocks[3].hidden && p.grounded) { st.s = 3; } return false; }
        if (st.s === 3) { k.left = 1; if (L.px < 6) { k.left = 0; st.s = 4; } return false; }
        if (st.s === 4) { k.right = L.px < 9.6; if (p.grounded && p.y < 12) st.s = 5; return J(st, 'a', L.px > 6.5 && p.grounded); }
        if (st.s === 5) { k.right = L.px < 13.6; if (p.grounded && p.y < 9) st.s = 6; return J(st, 'b', p.grounded && L.px > 10.2); }
        if (st.s === 6) { k.right = 1; return J(st, 'c', p.grounded && L.px > 14.2); }
        return false;
      },
      // 11 Groundwork: run over crumble, jump hidden spikes on islands & end
      (L, k, st) => {
        k.right = 1;
        return J(st, 'a', L.px > 11.4 && L.player.grounded) || J(st, 'b', L.px > 18.6 && L.player.grounded) ||
               (J(st, 'c', L.px > 27.6 && L.player.grounded) ? 10 : false);
      },
      // 12 Gravity Well: hit pads cleanly (brake on floor pads so you rise into ceiling pads), follow fleeing door
      (L, k, st) => {
        const d = L.doors[0];
        if (d.tween || d.x < 25) { k.left = 1; return false; }
        if (L.g < 0 && !L.player.grounded) {
          if (L.px > 7.5 && L.px < 10) { k.left = 1; return false; }
          if (L.px > 15.6 && L.px < 18) { k.left = 1; return false; }
        }
        k.right = 1;
        return false;
      },
      // 13 Saw Alley: trigger s1, wait briefly for it to move ahead, walk under s2 (y=13.5), jump end spike
      (L, k, st) => {
        if (L.px > 6.5 && !st.w) st.w = L.t + 1.4;
        if (st.w && L.t < st.w) return false;
        k.right = 1;
        return J(st, 'b', L.px > 27.6 && L.player.grounded) ? 10 : false;
      },
      // 14 Flip Flop: pad up (brake mid-air to land on ceiling 0..6), jump ceiling gaps with 0.18s lag
      (L, k, st) => {
        if (L.g < 0 && !L.player.grounded && ((L.px > 4.2 && L.px < 6) || (L.px > 20.2 && L.px < 22))) { k.left = 1; return false; }
        if (L.g < 0 && L.px > 26.5) { k.left = 1; return false; }
        k.right = 1;
        return J(st, 'a', L.g < 0 && L.player.grounded && L.px > 4.2) ||
               J(st, 'c', L.g < 0 && L.player.grounded && L.px > 21.0) ||
               (J(st, 'd', L.g > 0 && L.player.grounded && L.px > 27.6) ? 10 : false);
      },
      // 15 Mirror Maze: short-hop gap 10..12, jump s1, run right to trigger door flee to x=2, then run back left
      (L, k, st) => {
        const d = L.doors[0];
        if (d.tween || d.x < 10) st.back = 1;
        const dir = st.back ? -1 : 1;
        if ((dir > 0) !== L.invert) k.right = 1; else k.left = 1;
        if (!st.back) return (J(st, 'a', L.px > 9.0 && L.player.grounded) ? 5 : false) ||
                             J(st, 'b', L.px > 12.0 && L.player.grounded) ||
                             J(st, 'c', L.px > 19.4 && L.player.grounded) || J(st, 'd', L.px > 24.6 && L.player.grounded);
        return J(st, 'e', L.px < 27.6 && L.player.grounded) || J(st, 'f', L.px < 22.4 && L.player.grounded) ||
               J(st, 'g', L.px < 15.6 && L.player.grounded) || J(st, 'h', L.px < 12.4 && L.player.grounded);
      },
      // 16 Thin Ice: sprint across crumble, jump final hidden spike into door
      (L, k, st) => {
        k.right = 1;
        return J(st, 'a', L.px > 27.6 && L.player.grounded) ? 10 : false;
      },
      // 17 The Betrayal: jump s1, jump onto hidden step (21,13.5), then (25,12) into real door
      (L, k, st) => {
        const p = L.player;
        if (!st.step1) {
          k.right = L.px < 21.8;
          if (p.grounded && p.y < 13.5) st.step1 = 1;
          return J(st, 'a', L.px > 3.6 && p.grounded) || J(st, 'b', L.px > 19.6 && p.grounded);
        }
        k.right = 1;
        return J(st, 'c', L.px > 22.2 && p.grounded && p.y < 13.5);
      },
      // 18 Crusher Gauntlet: dash through each corridor, stay away from landing zones
      (L, k, st) => {
        k.right = 1;
        return J(st, 'a', L.px > 5.6 && L.player.grounded) || J(st, 'b', L.px > 10.5 && L.player.grounded) ||
               J(st, 'c', L.px > 16.5 && L.player.grounded) || J(st, 'd', L.px > 22.5 && L.player.grounded);
      },
      // 19 Chaos Engine: navigate with shifting controls and 0.14s jump lag (~1.12 tiles early)
      (L, k, st) => {
        if (L.invert) { k.left = 1; k.right = 0; } else { k.right = 1; k.left = 0; }
        return J(st, 'a', L.px > 6.5 && L.player.grounded) || J(st, 'b', L.px > 14.5 && L.player.grounded) ||
               J(st, 'c', L.px > 22.5 && L.player.grounded);
      },
      // 20 The Reckoning: gravity flip, crumble+invert, crusher, saw2, climb to fleeing door
      (L, k, st) => {
        const p = L.player;
        if (!st.ph) {
          if (L.invert) k.left = 1; else k.right = 1;
          if (L.px > 26.2) st.ph = 1;
          return J(st, 'saw2', L.px > 23.0 && p.grounded);
        }
        if (st.ph === 1) {
          if (L.px > 25.0 && p.y > 13.5) { k.left = 1; return false; }
          k.right = L.px < 27.5;
          if (p.grounded && p.y < 13.5) st.ph = 2;
          return J(st, 's1', p.grounded && L.px <= 25.1);
        }
        if (st.ph === 2) {
          k.right = L.px < 29.2;
          if (p.grounded && p.y < 11.5) st.ph = 3;
          return J(st, 's2', p.grounded && L.px > 27.2);
        }
        if (st.ph === 3) {
          if (L.px > 28.8 && p.grounded && p.y > 9.5) { k.left = 1; return false; }
          k.right = 1;
          if (p.grounded && p.y < 9.5) st.ph = 4;
          return J(st, 's3', p.grounded && L.px <= 28.9);
        }
        if (L.px > 30.2) k.left = 1; else k.right = 1;
        return false;
      },
      // 21 Leap of Faith: jump the first hole into the middle one, land in the bonus room, walk to its portal
      (L, k, st) => { k.right = 1; return J(st, 'a', L.player.grounded && L.px > 2.9); },
      // 22 Gotta Go Fast: wait out each laser, tap-hop spikes at 5x, zigzag up three floors, outrun the corridor spikes
      (L, k, st) => {
        const p = L.player, las = L.lasers, g = p.grounded;
        st.ph = st.ph || 0;
        if (st.ph === 0) { if (off(las[0], L) > 0.5) st.ph = 1; return false; }
        if (st.ph === 1) { k.right = L.px < 19; if (L.px > 18.5 && g) st.ph = 2; return J(st, 'a', L.px > 9.3) ? 8 : false; }
        if (st.ph === 2) { if (off(las[1], L) > 0.4) st.ph = 3; return false; }
        // run to the step, hop on, hop up-left onto floor 2
        if (st.ph === 3) { k.right = 1; if (g && L.py < 13.5) st.ph = 4; return J(st, 'b', g && L.px > 26.8); }
        if (st.ph === 4) { k.right = L.px < 30.5; if (L.px > 30.3) st.ph = 5; return false; }
        if (st.ph === 5) { k.left = L.px > 26.8 || g; k.right = !g && L.px < 26; if (g && L.py < 11) st.ph = 6; return J(st, 'c', g && L.px < 29.4); }
        // floor 2: onto platform 1, wait for the laser, platform 2, down to the floor
        if (st.ph === 6) { k.left = L.px > 25.6; if (L.px < 25.7 && Math.abs(p.vx) < 0.5) st.ph = 7; return false; }
        if (st.ph === 7) { k.left = L.px > 21.9; if (g && L.py < 9.5) st.ph = 8; return J(st, 'd', g); }
        if (st.ph === 8) { k.right = L.px < 21.7; if (off(las[2], L) > 0.6 && Math.abs(p.vx) < 0.5) st.ph = 9; return false; }
        if (st.ph === 9) { k.left = L.px > 17.2; if (g && L.px < 18) st.ph = 10; return J(st, 'e', g && L.px < 21.4); }
        if (st.ph === 10) { k.left = 1; if (g && L.py > 10) st.ph = 11; return J(st, 'f', g && L.px < 17.4); }
        if (st.ph === 11) { k.right = L.px < 12.6; if (Math.abs(p.vx) < 0.5 && off(las[3], L) > 0.45) st.ph = 12; return false; }
        // 5x dash left: hop the spike, through the laser, then climb the step and up to floor 3
        if (st.ph === 12) { k.left = 1; if (g && L.px < 4.5) st.ph = 13; return J(st, 'g', L.px < 11.3) ? 8 : false; }
        if (st.ph === 13) { k.right = L.px < 3.9; if (L.px > 3.8 && Math.abs(p.vx) < 0.5) st.ph = 14; return false; }
        if (st.ph === 14) { k.left = L.px > 2; if (g && L.py < 8) st.ph = 15; return J(st, 'h', g); }
        if (st.ph === 15) { k.right = 1; return J(st, 'i', g) || J(st, 'j', g && L.py < 5 && L.px > 28.3); }
        return false;
      },
      // 23 Floor Is Lava
      hopper([
        { d: 1, at: 4.6, to: 10.0 },                   // onto the first fake spikes
        { d: 1, stop: 1, at: 10.5, to: 14.6 },         // second fake spikes
        { d: 1, stop: 1, at: 15.5, to: 21 },           // island
        { d: 1, at: 25.3, to: 29.5 },                  // step up
        { d: -1, prep: 31, at: 29.2, to: 25 },         // tier 2
        { d: -1, prep: 23.7, ok: (L) => crusherSafe(L, 0), at: 19.2, walk: 1 },   // under crusher A
        { d: -1, prep: 19.2, ok: (L) => crusherSafe(L, 0.43), at: 15.9, walk: 1 }, // under crusher B
        { d: -1, stop: 1, at: 15.0, to: 12.6 },        // bait: jump long (saw 1 lunges far), steer back short
        { d: -1, stop: 1, ok: (L) => L.saws[0].vx === 0, at: 12.0, to: 9.4 }, // over stalled saw 1; baits saw 2
        { d: -1, at: 8.1, to: 3.6 },                   // over stalled saw 2
        { d: -1, prep: 3.4, at: 3.4, to: 1.0 },        // step up
        { d: 1, prep: 0.6, at: 1.6, to: 5.2 },         // tier 3
        { d: 1, prep: 5.2, at: 5.8, to: 9.5 },         // fake spikes
        { d: 1, stop: 1, at: 9.7, to: 14.6 },          // over the double fake onto fake spikes
        { d: 1, stop: 1, at: 15.3, to: 18.5 },
        { d: 1, at: 21.3, to: 25.2 },                  // jump the last strip; controls invert mid-air
        { d: 1, at: 26.6, walk: 1 },
      ]),
      // 24 Short Hop: tap-hop the floor spikes, full-jump into the fake ceiling spikes over the gap,
      // climb the ladder tiny, then floor -> pad up -> tap the roof spike -> pad down (hug the wall) ->
      // pad up -> ceiling-walk right, hopping two spikes, into the hanging portal
      (L, k, st) => {
        const p = L.player, g = p.grounded;
        if (!st.ph) {
          k.right = 1;
          if (J(st, 'a', g && L.px > 9.0)) return 4;
          if (J(st, 'b', g && L.px > 13.0)) return 4;
          if (J(st, 'c', g && L.px > 16.9)) return 12;
          if (st.c && g && L.px > 20.0) st.ph = 1;
          return false;
        }
        if (st.ph === 1) { if (g && Math.abs(p.vx) < 0.05) { st.ph = 2; return true; } return false; }
        if (st.ph === 2) { if (L.ladders.length && g) { st.ph = 3; return 400; } return false; }
        if (st.ph === 3) { if (L.py < 10.6) k.left = 1; if (g && L.py < 10.6 && L.px < 19.5) st.ph = 4; return false; }
        if (st.ph === 4) { if (L.g > 0) k.left = 1; else if (g) st.ph = 5; return false; }
        if (st.ph === 5) { k.left = 1; if (L.g > 0) st.ph = 6; return J(st, 'd', g && L.px < 12.9) ? 4 : false; }
        if (st.ph === 6) { k.left = 1; if (L.g < 0 && L.py < 6) st.ph = 7; return false; }
        k.right = 1; return J(st, 'e', g && L.px > 10.6) || J(st, 'f', g && L.px > 16.6);
      },
      // 25 Nothing Here (backwards): walk, jump only the real strip, then walk back to where the portal went
      (L, k, st) => {
        if (st.back || L.doors[0].tween || L.doors[0].x < 20) { st.back = 1; k.left = 1; return false; }
        k.right = 1; return J(st, 'a', L.player.grounded && L.px > 24.9);
      },
      // 26 Red Light: freeze whenever your colour isn't up; only start a jump with enough light left
      hopper([
        { d: 1, prep: 5.3, ok: rlGo(1.0), at: 5.6, to: 9.6 },               // pit
        { d: 1, stop: 1, ok: rlGo(1.0), at: 10.6, to: 13.2 },               // spike
        { d: 1, stop: 1, ok: rlGo(1.0), at: 13.8, to: 16.6 },               // pit
        { d: 1, stop: 1, ok: rlGo(1.4), at: (L) => L.saws[0].x - 2.0, to: 30 }, // over the frozen saw
        { d: 1, prep: 23.4, ok: rlGo(1.0), at: 23.8, to: 26 },              // step
        { d: 1, stop: 1, ok: rlGo(1.0), at: 26.5, to: 29.5 },               // platform
        { d: -1, prep: 29.2, ok: rlGo(1.0), at: 28.8, to: 25.5 },           // tier 2: the rules flip
        { d: -1, stop: 1, ok: rlGo(1.0), at: 23.0, to: 19.5 },              // spike
        { d: -1, stop: 1, ok: rlGo(1.35), at: 17.6, to: 12.8 },             // pit, onto the crumbling bridge
        { d: -1, at: 8.6, walk: 1 },                                        // across it in the same light
        { d: -1, stop: 1, ok: rlGo(1.0), at: 4.5, to: 1.8 },                // up to the portal
      ], { pause: (L) => L.light !== L.go }),
      // 27 Elevator Pitch: jump off the first two rides at the right moment, never off the last one
      hopper([
        { d: 1, at: 8.4, walk: 1 },                                         // onto lift 1, right edge
        { d: 1, stop: 1, ok: (L) => L.blocks[1].y <= 8.501, at: 0, to: 12.4 }, // off while it hesitates
        { d: 1, stop: 1, at: 12.6, to: 15.2 },                              // over the ledge spike
        { d: 1, at: 17.6, walk: 1 },                                        // onto the shuttle
        { d: 1, stop: 1, ok: (L) => L.blocks[3].x >= 20, at: 0, to: 27 },  // off before it turns back
        { d: 1, at: 30.6, walk: 1 },                                        // onto lift 2, and stay on it:
      ]),                                                                   // through the fake ceiling and the bonus room
      // 28 Deja Vu: the layout depends on the death count; cross the pit while its saw is low
      (L, k, st) => (L.deaths % 2 ? dejaOdd : dejaEven)(L, k, st),
      // 29 Lights Out: the maze route (floor 0 right, 1 left, 2 right, 3 left), hopping walls, holes and teleport tiles
      hopper([
        { d: 1, at: 7.6, to: 11 },                                          // wall
        { d: 1, at: 17.0, to: 20.5 },                                       // teleport tile
        { d: -1, prep: 28.75, at: 28.75, hold: 130, upTo: 10.3, to: 26 },   // ladder up to floor 1
        { d: -1, at: 25.6, to: 22.6 },                                      // wall
        { d: -1, at: 22.3, to: 19.2 },                                      // teleport tile
        { d: -1, at: 14.3, to: 11.0 },                                      // hole
        { d: 1, prep: 3.75, at: 3.75, hold: 130, upTo: 6.3, to: 6 },        // ladder up to floor 2
        { d: 1, at: 7.6, to: 10.8 },                                        // wall
        { d: 1, at: 13.2, to: 16.4 },                                       // hole
        { d: 1, at: 18.8, to: 21.6 },                                       // teleport tile
        { d: -1, prep: 28.25, at: 28.25, hold: 130, upTo: 2.3, to: 26 },    // ladder up to floor 3
        { d: -1, at: 22.6, to: 19.6 },                                      // wall
        { d: -1, at: 18.2, to: 15.0 },                                      // teleport tile
        { d: -1, at: 12.4, to: 9.2 },                                       // hole
        { d: -1, at: 2.6, walk: 1 },                                        // portal
      ]),
      // 30 The Undoing: one hop list per room
      (L, k, st) => { const r = L.room; st[r] = st[r] || {}; return undoing[r](L, k, st[r]); },
    ];

    // ---- two-player policies: (L, A, B, st). A = player 1, B = player 2.
    // Each actor: x, y (centre), g (grounded), p (raw player), go(dir), to(x) -> arrived, jump().
    const near = (a, x, t = 0.25) => Math.abs(a.x - x) < t;
    const MULTI = [
      // 1 Hold The Door
      (L, A, B, st) => {
        const gateOpen = L.blocks[2].y < -2.5, d = L.doors[0];
        if (!st.ph) { A.to(13.7); B.to(18.2); if (L.buttons[0].down && gateOpen && near(B, 18.2)) st.ph = 1; return; }
        if (st.ph === 1) { B.go(1); if (B.x > 21.0) B.jumpOnce('s'); if (B.x > 25.4 && B.g) st.ph = 2; A.to(13.7); return; }
        if (st.ph === 2) { B.to(25.7); A.go(1); if (A.x > 21.0) A.jumpOnce('s'); if (d.tween || d.x < 20) st.ph = 3; return; }
        if (st.ph === 3) { B.to(25.7); A.go(-1); if (A.x < 25.2) A.jumpOnce('back'); if (A.x < 14.2 && A.g) st.ph = 4; return; }
        if (st.ph === 4) { if (B.p.done) { A.go(-1); if (A.x < 13.4) A.jumpOnce('sp2'); } else A.to(13.7); B.go(-1); if (B.x < 25.2) B.jumpOnce('back'); if (B.x < 12.9 && B.g) B.jumpOnce('sp2'); return; }
      },
      // 2 Boost
      (L, A, B, st) => {
        const btn = L.buttons[0], step = L.blocks[4];
        if (!st.ph) { A.to(13.3); if (near(A, 13.3) && A.g) { B.go(1); if (B.x > 10.6) B.jumpOnce('head'); if (B.p.onP) st.ph = 1; } else B.to(10.6); return; }
        if (st.ph === 1) { B.go(1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 2; return; }
        if (st.ph === 2) { B.to(18.7); if (btn.down && step.x > 9.9) { A.to(5); if (near(A, 5)) st.ph = 3; } return; }
        if (st.ph === 3) { B.to(18.7); if (A.g && A.y > 13.5) { A.go(1); if (A.x > 7.0) A.jumpOnce('step'); } else if (!A.g && A.y > 11.6) A.right(A.x < 11.5); else if (A.g) { A.go(1); A.jumpOnce('plat'); } else A.go(1); if (A.y < 11 && A.g && A.x > 14.5) st.ph = 4; return; }
        if (st.ph === 4) { const d = L.doors[0]; for (const P of [A, B]) { if (d.x < 25 && P.x > 25.5) { P.go(-1); if (P.g) P.jumpOnce('back'); } else { P.go(1); if (P.x > 20.6 && P.g) P.jumpOnce('sp'); if (P.x > 25.6 && P.g) P.jumpOnce('cr'); } } return; }
      },
      // 3 Angry Plate
      (L, A, B, st) => {
        const s = L.buttons[0], e = L.buttons[1], open = L.blocks[2].y < 7.05;
        if (!st.ph) { A.to(5.7); B.to(9.3); if (s.down && open) st.ph = 1; return; }
        if (st.ph === 1) { A.to(5.7); B.go(1); if (B.x > 21) st.ph = 2; return; }
        if (st.ph === 2) { B.to(23.5); if (!st.off) { if (A.to(9.3)) st.off = 1; return; } if (open) st.ph = 3; return; }
        if (st.ph === 3) { B.to(23.5); A.go(1); if (A.x > 21) st.ph = 4; return; }
        if (st.ph === 4) { A.go(1); B.go(1); return; }
      },
      // 4 Two Keys
      (L, A, B, st) => {
        const a = L.buttons[0], b = L.buttons[1], cageOpen = L.blocks[L.blocks.length - 1].y < 5;
        if (!st.ph) {
          A.go(-1); if (A.x < 8.6) A.jumpOnce('c'); if (A.x < 3.4 && A.g) A.go(0);
          B.go(1); if (B.x > 23.4) B.jumpOnce('c'); if (B.x > 28.5 && B.g) B.go(0);
          if (a.down && b.down) st.ph = 1; return;
        }
        if (st.ph === 1) { A.go(1); A.jumpOnce('out'); B.go(-1); B.jumpOnce('out'); if (A.x > 9 && B.x < 23) st.ph = 2; return; }
        if (st.ph === 2) { if (cageOpen) { A.to(15.75); B.to(15.75); } else { A.to(11); B.to(20); } return; }
      },
      // 5 Going Up
      (L, A, B, st) => {
        const lift = L.blocks[3], d = L.doors[0];
        const ride = (P, nm) => { if (P.g && P.y > 14) { if (P.x < 11.1) P.go(1); else { P.go(1); P.jumpOnce(nm); } } else if (!P.g && P.x > 12.8) P.go(0); else if (!P.g) P.go(1); };
        if (!st.ph) { ride(B, 'on'); if (B.g && Math.abs(B.p.y + B.p.h - lift.y) < 0.05) st.ph = 1; return; }
        if (st.ph === 1) { A.to(5.7); if (lift.y < 6.5 && B.to(14.6)) B.jumpOnce('sp'); if (st.j || B.p.vy < 0) { st.j = 1; B.go(1); } if (B.x > 20 && B.g) st.ph = 2; return; }
        if (st.ph === 2) { B.to(25); if (lift.y <= 14.3 && !st.r) A.to(9); if (lift.y > 14.3 || st.r) { st.r = 1; ride(A, 'on'); if (A.g && A.y < 14.3 && Math.abs(A.p.y + A.p.h - lift.y) < 0.05) st.ph = 3; } return; }
        if (st.ph === 3) { B.to(22.7); if (lift.y < 6.5 && !st.k && A.to(14.6)) A.jumpOnce('sp'); if (st.k || A.p.vy < 0) { st.k = 1; A.go(1); } if (A.x > 20 && A.g) st.ph = 4; return; }
        if (st.ph === 4) { for (const P of [A, B]) { if (!d.tween && d.y < 10) P.to(26.5); else if (P.y < 10) P.go(1); else P.to(23.6, 0.3); } return; }
      },
      // 6 Two Lanes
      (L, A, B, st) => {
        const g1open = L.blocks[3].y < 0.05, g2open = L.blocks[4].y < 1.05;
        if (!st.ph) { B.to(9.7); if (g1open) { A.to(17.7); if (near(A, 17.7) && g2open) st.ph = 1; } else A.to(12.5); return; }
        if (st.ph === 1) { A.to(17.7); B.go(1); if (B.x > 11.7 && B.g) B.jumpOnce('mid'); if (B.x > 22.4) B.jumpOnce('sp'); return void (B.p.done && (st.ph = 2)); }
        if (st.ph === 2) { if (!st.off) { if (A.to(15.5)) st.off = 1; return; } if (L.blocks[4].y > 7.95) { A.go(1); if (A.x > 15.9) A.jumpOnce('hop'); if (A.x > 21.5 && A.g) A.jumpOnce('sp'); } return; }
      },
      // 7 Weight Limit
      (L, A, B, st) => {
        if (!st.ph) { A.to(7.5); B.go(1); if (L.saws[0].vx > 0) st.ph = 1; return; }
        A.go(1); B.go(1); for (const P of [A, B]) if (P.g && P.x > 14.2 && P.x < 15) P.jumpOnce('hop', 6);
      },
      // 8 Swap Meet
      (L, A, B, st) => {
        for (const P of [A, B]) { P.go(1); for (const [x, n] of [[10.3, 'a'], [17.3, 'b'], [22.5, 'c']]) if (P.x > x && P.g) P.jumpOnce(n); if (P.x > 26.4 && P.g && L.spikes[1].target === 1) P.jumpOnce('d'); }
      },
      // 9 Crate Expectations
      (L, A, B, st) => {
        const crate = L.blocks.find((b) => b.crate && !b.mimic), mim = L.blocks.find((b) => b.mimic), btn = L.buttons[0], cageOpen = L.blocks[L.blocks.length - 1].y < 5;
        if (!st.ph) { A.to(8.45); if (near(A, 8.45) && A.g) { B.go(-1); if (B.x < 10.6) B.jumpOnce('head'); if (B.p.onP) st.ph = 1; } else B.to(10.6); return; }
        if (st.ph === 1) { B.go(-1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 2; return; }
        if (st.ph === 2) { A.to(13); if (!mim.gone) { if (!mim.armed) { if (B.to(7.6)) st.tap = 1; if (st.tap) B.go(-1); } else B.to(7.7); return; } if (!st.back) { if (B.g && B.x < crate.x + 2.2 && B.x > crate.x) B.jumpOnce('over'); B.to(1.5); if (near(B, 1.5) && B.y > 10) st.back = 1; } else if (crate.y < 11.5) B.go(1); else B.to(6.5); if (crate.y > 13.5 && btn.down) st.ph = 3; return; }
        if (st.ph === 3) { if (B.x < 17) { A.to(17.5); if (B.g && B.x > crate.x - 1.3 && B.x < crate.x) B.jumpOnce('crate'); B.go(1); return; } for (const P of [A, B]) { if (P.g && P.x > crate.x - 1.3 && P.x < crate.x) P.jumpOnce('crate'); if (P.y > 13.5 && P.x > 18.3 && P.x < 19.5 && P.g) P.jumpOnce('sp'); if (cageOpen || P.x < 19) P.to(26.25); else P.to(23); } return; }
      },
      // 10 Trust Issues
      (L, A, B, st) => {
        const lift = L.blocks[3];
        const ride = (P, nm) => { if (P.g && P.y > 14) { if (P.x < 13.1) P.go(1); else { P.go(1); P.jumpOnce(nm); } } else if (!P.g && P.x > 14.8) P.go(0); else if (!P.g) P.go(1); };
        if (!st.ph) { ride(B, 'on'); if (B.g && Math.abs(B.p.y + B.p.h - lift.y) < 0.05) st.ph = 1; return; }
        if (st.ph === 1) { A.to(6.7); if (lift.y < 6.1 && !st.j && B.to(16.6)) B.jumpOnce('sp'); if (st.j || B.p.vy < 0) { st.j = 1; B.go(1); } if (B.x > 21 && B.g && B.y < 7) st.ph = 2; return; }
        if (st.ph === 2) { B.to(26.5); if (lift.y <= 14.3 && !st.r) A.to(10); if (lift.y > 14.3 || st.r) { st.r = 1; ride(A, 'on'); if (A.g && A.y < 14.3 && Math.abs(A.p.y + A.p.h - lift.y) < 0.05) st.ph = 3; } return; }
        if (st.ph === 3) { B.to(24.7); if (lift.y < 6.1 && !st.k && A.to(16.6)) A.jumpOnce('sp'); if (st.k || A.p.vy < 0) { st.k = 1; A.go(1); } if (A.x > 21 && A.g && A.y < 7) st.ph = 4; return; }
        if (st.ph === 4) { const d = L.doors[0]; for (const P of [A, B]) { if (d.y > 10 || d.tween) { if (P.y < 7) { P.go(-1); if (P.g && P.x < 22.6) P.jumpOnce('back'); } else P.to(25.6); } else P.to(29.6); } }
      },
      // 11 Hot Potato: both clear x=6 first, A holds btn, B crosses to b2, A crosses, both enter door
      (L, A, B, st) => {
        const gate = L.blocks[2];
        if (!st.ph) { A.to(6.2); B.to(6.2); if (A.x > 6 && B.x > 6) st.ph = 0.5; return; }
        if (st.ph === 0.5) { A.to(7.7); B.to(14); if (L.buttons[0].down && gate.y < -2.5 && near(B, 14, 0.5)) st.ph = 1; return; }
        if (st.ph === 1) { A.to(7.7); B.go(1); if (B.x > 18.6 && B.g) B.jumpOnce('sp'); if (B.x > 24.4 && B.g) st.ph = 2; return; }
        if (st.ph === 2) { B.to(24.7); A.go(1); if (A.x > 18.6 && A.g) A.jumpOnce('sp'); if (A.x > 23 && A.g) st.ph = 3; return; }
        A.go(1); B.go(1);
      },
      // 12 Switcheroo: latch partner's gate, then each runs into their door
      (L, A, B, st) => {
        const btnL = L.buttons[0], btnR = L.buttons[1];
        if (!st.ph) { A.to(8.7); B.to(22.7); if (btnL.down && btnR.down) st.ph = 1; return; }
        A.go(-1); B.go(1);
      },
      // 13 Chain Reaction: press b1, b2, b3 in order (jumping stationary saws), then enter door
      (L, A, B, st) => {
        const gate = L.blocks[2];
        for (const P of [A, B]) {
          P.go(1);
          if (P.x > 8.2 && P.g) P.jumpOnce('s1');
          if (P.x > 16.2 && P.g) P.jumpOnce('s2');
          if (gate.y > -6 && P.x > 22.8) P.to(22.0);
          if (gate.y <= -6 && P.x > 26.2 && P.g) P.jumpOnce('sp');
        }
      },
      // 14 Gravity Split: gate opens when anyone passes x=14; both go right, jump hidden spike early
      // Spike pops when leader passes x=24; fatal at x≈24.3 — must jump at x=23.5
      (L, A, B, st) => {
        for (const P of [A, B]) { P.go(1); if (P.x > 23.5 && P.g) P.jumpOnce('sp'); }
      },
      // 15 Detonator: A holds b1 -> B crosses g1 to b2 -> A crosses g1 to b2 -> B crosses g2 to b3 -> A crosses g2
      (L, A, B, st) => {
        const g1 = L.blocks[2], g2 = L.blocks[4];
        if (!st.ph) { A.to(7.7); if (g1.y < 1) B.go(1); else B.to(9.8); if (B.x > 16.2) st.ph = 1; return; }
        if (st.ph === 1) { B.to(16.7); if (g1.y < 1) A.go(1); else A.to(9.8); if (A.x > 16.2) st.ph = 2; return; }
        if (st.ph === 2) { A.to(16.7); if (g2.y < 1) B.go(1); else B.to(18.8); if (B.x > 25.2) st.ph = 3; return; }
        if (st.ph === 3) { B.to(25.7); if (g2.y < 1) A.go(1); else A.to(18.8); if (A.x > 24.5) st.ph = 4; return; }
        for (const P of [A, B]) { P.go(1); if (P.x > 27.6 && P.g) P.jumpOnce('sp', 10); }
      },
      // 16 The See-Saw: jump onto platforms, hold both buttons to lift archGate, then jump into door
      (L, A, B, st) => {
        const gate = L.blocks[5];
        if (!st.ph) {
          A.go(1); if (A.x > 6.8 && A.g) A.jumpOnce('up');
          B.go(-1); if (B.x < 25.2 && B.g) B.jumpOnce('up');
          if (A.y < 13 && B.y < 13 && A.g && B.g) st.ph = 1;
          return;
        }
        if (st.ph === 1) { A.to(10.7); B.to(20.7); if (gate.y < -8.5) st.ph = 2; return; }
        A.to(16); if (A.x > 11.8 && A.g) A.jumpOnce('sp', 18);
        B.to(16); if (B.x < 20.0 && B.g) B.jumpOnce('sp', 18);
      },
      // 17 Mimic City: push crate2 onto btn2 first, boost B to push crate1 onto btn, jump sp into door
      (L, A, B, st) => {
        const c1 = L.blocks.find(b => b.crate && !b.mimic && b.y < 12);
        const c2 = L.blocks.find(b => b.crate && !b.mimic && b.y >= 12);
        const btn = L.buttons[0], btn2 = L.buttons[1];
        if (!st.ph) {
          // A jumps over mimic at x=14, pushes crate2 onto btn2 (x=22..24.4), then returns
          if (!btn2.down) { A.go(1); if (A.x > 12.2 && A.x < 13.5 && A.g) A.jumpOnce('m2'); }
          else { A.to(8.45); if (A.x < 16.5 && A.x > 15.2 && A.g) A.jumpOnce('m2b'); if (near(A, 8.45)) st.ph = 1; }
          B.to(10.6);
          return;
        }
        if (st.ph === 1) {
          A.to(8.45);
          if (near(A, 8.45) && A.g) { B.go(-1); if (B.x < 10.6) B.jumpOnce('head'); if (B.p.onP) st.ph = 2; }
          else B.to(10.6);
          return;
        }
        if (st.ph === 2) { B.go(-1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 3; return; }
        if (st.ph === 3) {
          A.to(13);
          if (!st.left) {
            if (B.g && B.x < c1.x + 2.0 && B.x > c1.x) B.jumpOnce('over');
            B.to(3.8); if (near(B, 3.8)) st.left = 1;
          } else if (!btn.down) B.go(1);
          else st.ph = 4;
          return;
        }
        for (const P of [A, B]) {
          P.go(1);
          if (P.y > 13.5 && P.x > 12.5 && P.x < 14 && P.g) P.jumpOnce('m');
          if (P.y > 13.5 && P.x > 19.6 && P.x < 21 && P.g) P.jumpOnce('sp');
        }
      },
      // 18 Rope-a-Dope: both go right, jump gaps before edges
      (L, A, B, st) => {
        for (const P of [A, B]) {
          P.go(1);
          for (const [x, n] of [[7.3, 'a'], [15.3, 'b'], [23.3, 'c']]) if (P.x > x && P.g) P.jumpOnce(n);
        }
      },
      // 19 The Big Push: boost B onto ledge, push realCrate onto btn (x=14), jump sp into door
      (L, A, B, st) => {
        const c = L.blocks.find(b => b.crate && !b.mimic);
        const btn = L.buttons[0];
        if (!st.ph) {
          A.to(6.45);
          if (near(A, 6.45) && A.g) { B.go(-1); if (B.x < 8.6) B.jumpOnce('head'); if (B.p.onP) st.ph = 1; }
          else B.to(8.6);
          return;
        }
        if (st.ph === 1) { B.go(-1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 2; return; }
        if (st.ph === 2) {
          A.to(18);
          if (!st.left) {
            if (B.g && B.x < c.x + 1.8 && B.x > c.x) B.jumpOnce('over');
            B.to(2.8); if (near(B, 2.8)) st.left = 1;
          } else if (c.y < 13.5) B.go(1);
          else if (!st.behind) { B.to(c.x - 0.8); if (B.y > 13.5 && B.x < c.x) st.behind = 1; }
          else if (c.x < 14.2) B.go(1);
          else st.ph = 3;
          return;
        }
        for (const P of [A, B]) {
          P.go(1);
          if (P.x > c.x - 1.5 && P.x < c.x + 0.5 && P.g) P.jumpOnce('cr');
          if (P.x > 19.6 && P.x < 21 && P.g) P.jumpOnce('sp');
        }
      },
      // 20 No Way Out: lift B up to b2, lower lift for A, lift A up, both enter door at (29,6)
      (L, A, B, st) => {
        const lift = L.blocks[3];
        const ride = (P, nm) => { if (P.g && P.y > 14) { if (P.x < 13.1) P.go(1); else { P.go(1); P.jumpOnce(nm); } } else if (!P.g && P.x > 14.8) P.go(0); else if (!P.g) P.go(1); };
        if (!st.ph) { ride(B, 'on'); if (B.g && Math.abs(B.p.y + B.p.h - lift.y) < 0.05) st.ph = 1; return; }
        if (st.ph === 1) { A.to(5.7); if (lift.y < 6.1 && !st.j && B.to(16.6)) B.jumpOnce('sp'); if (st.j || B.p.vy < 0) { st.j = 1; B.go(1); } if (B.x > 21 && B.g && B.y < 7) st.ph = 2; return; }
        if (st.ph === 2) { B.to(23.5); if (lift.y <= 14.3 && !st.r) A.to(10); if (lift.y > 14.3 || st.r) { st.r = 1; ride(A, 'on'); if (A.g && A.y < 14.3 && Math.abs(A.p.y + A.p.h - lift.y) < 0.05) st.ph = 3; } return; }
        if (st.ph === 3) { B.to(26.7); if (lift.y < 6.1 && !st.k && A.to(16.6)) A.jumpOnce('sp'); if (st.k || A.p.vy < 0) { st.k = 1; A.go(1); } if (A.x > 21 && A.g && A.y < 7) st.ph = 4; return; }
        A.go(1); B.go(1);
      },
    ];

    // move both together, side by side
    const pair = (A, B, fn) => { fn(A); fn(B); };
    const SPECIAL = [
      // 1 Tethered
      (L, A, B, st) => {
        if (!st.ph) { A.to(9); B.to(9); if (near(A, 9) && near(B, 9)) st.ph = 1; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 13.4) P.jumpOnce('pit'); });
        // past the pit: line up one tile apart, then both jump together, twice
        if (A.x > 18.3 && !st.al) { const a = A.to(18.6), b = B.to(19.6); if (a && b && A.g && B.g && A.p.ground && B.p.ground) st.al = 1; return; }
        if (st.al) { if (B.x > 21.2 && A.g && B.g) { A.jumpOnce('sp'); B.jumpOnce('sp'); } if (B.x > 25.4 && A.g && B.g) { A.jumpOnce('sp2'); B.jumpOnce('sp2'); } if (B.x > 30.5 && B.g) { A.go(-1); B.go(-1); } }
      },
      // 2 Haul
      (L, A, B, st) => {
        if (!st.ph) { A.to(11.3); if (near(A, 11.3) && A.g) { B.go(1); if (B.x > 9.6) B.jumpOnce('head'); if (B.p.onP) st.ph = 1; } else B.to(9.6); return; }
        if (st.ph === 1) { B.go(1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 2; return; }
        if (st.ph === 2) { B.go(1); if (B.x > 18.2 && B.y < 15) B.jumpOnce('gap2', 8); if (A.x > 19.6) A.go(1); if (A.p.hang > 0 && !A.g && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.5; } if (A.y < 11 && A.g) st.ph = 3; return; }
        if (st.ph === 3) { if (!st.al) { B.to(16); A.to(16); if (near(A, 16) && near(B, 16)) st.al = 1; return; } pair(A, B, (P) => { P.go(1); if (P.x > 18.6) P.jumpOnce('sp'); }); }
      },
      // 3 Counterweight
      (L, A, B, st) => {
        const btn = L.buttons[0], open = L.blocks.find((b) => b.link && b.x === 21).y < -2.9;
        const crate = L.blocks.find((b) => b.crate && !b.mimic), mim = L.blocks.find((b) => b.mimic);
        if (!mim.gone) { A.to(1.4); if (!mim.armed) { if (B.to(3.4)) st.tap = 1; if (st.tap) B.go(1); } else B.to(2.6); return; }
        if (!st.ph) { A.to(4); if (crate.x < 10.05) B.go(1); else B.to(8.5); if (btn.down) st.ph = 1; return; }
        if (st.ph === 1) { A.to(8.5); B.to(8.5); if (near(A, 8.5) && near(B, 8.5) && open) st.ph = 2; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 9.4) P.jumpOnce('pit'); if (P.x > 24.4 && P.g) P.jumpOnce('sp'); });
      },
      // 4 Lift Together
      (L, A, B, st) => {
        const lift = L.blocks.find((b) => b.x === 12 && b.h === 0.6);
        if (!st.ph) { A.to(10.8); B.to(10.8); if (near(A, 10.8) && near(B, 10.8) && lift.y > 14.39) st.ph = 1; return; }
        if (st.ph === 1) { pair(A, B, (P) => { if (P.x < 13) { P.go(1); P.jumpOnce('on'); } else P.go(0); }); if (lift.y < 7.01) st.ph = 2; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 17.7 && P.g) P.jumpOnce('sp'); });
      },
      // 5 Leash
      (L, A, B, st) => {
        if (!st.al) { A.to(3.2); B.to(3.2); if (near(A, 3.2) && near(B, 3.2)) st.al = 1; return; }
        pair(A, B, (P) => P.go(P.x > 30.9 ? -1 : 1));
        const lead = Math.max(A.x, B.x);
        for (const [x, n] of [[8.3, 'a'], [15.3, 'b'], [21.3, 'c'], [26.7, 'd']]) if (lead > x && A.g && B.g) { A.jumpOnce(n); B.jumpOnce(n); }
      },
      // 6 Weight Limit
      (L, A, B, st) => {
        if (!st.ph) { B.to(10.5); if (B.x > 6.3 && B.x < 7) B.jumpOnce('gap', 6); A.to(5.5); if (near(B, 10.5) && B.g) st.ph = 1; return; }
        if (st.ph === 1) { B.to(10.5); if (A.y < 15.2) A.go(1); if (A.y > 16) st.ph = 2; return; }
        if (st.ph === 2) { B.go(1); if (B.x > 18.2 && B.y < 15) B.jumpOnce('gap2', 8); if (A.x > 19.6) A.go(1); if (A.p.hang > 0 && A.x > 18.5 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.5; } if (A.g && A.y < 15 && A.x > 20) st.ph = 3; return; }
        pair(A, B, (P) => P.go(1));
      },
      // 7 Up Is Down (Together)
      (L, A, B, st) => {
        if (st.al === 2) { A.go(1); B.go(1); return; }
        if (L.g < 0 && A.x > 17 && B.x > 17 && !st.al) { const a = A.to(17.6), b = B.to(18.6); if (a && b && A.p.ground && B.p.ground) { st.al = 2; A.jumpOnce('sp'); B.jumpOnce('sp'); } return; }
        pair(A, B, (P) => { P.go(1); if (L.g < 0 && P.g && P.x > 13.3) P.jumpOnce('hole'); });
      },
      // 8 Lift Off
      (L, A, B, st) => {
        const pillar = L.blocks.find((b) => b.x === 15 && b.h === 0.6);
        const lie = L.spikes.find((x) => x.y === 14.4);
        if (!st.ph) { A.to(8.7); B.to(8.7); if (lie.target === 1) st.ph = 0.5; return; }
        if (st.ph === 0.5) { A.to(6); B.to(6); if (lie.target === 0 && lie.out < 0.05 && near(A, 6, 0.4) && near(B, 6, 0.4)) st.ph = 0.7; return; }
        if (st.ph === 0.7) { A.to(8.7); B.to(8.7); if (L.buttons[0].down && near(A, 8.7, 0.5) && near(B, 8.7, 0.5)) st.ph = 1; return; }
        if (st.ph === 1) { pair(A, B, (P) => { if (P.x < 15.6) { P.go(1); if (P.x > 13.6) P.jumpOnce('on'); } else P.go(0); }); if (pillar.y < 6.01) st.ph = 2; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 19.8 && P.g) P.jumpOnce('sp'); });
      },
      // 9 Crumble Run
      (L, A, B, st) => {
        if (!st.ph) { A.to(4); B.to(4); if (near(A, 4) && near(B, 4)) st.ph = 1; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 16.4) P.jumpOnce('m'); if (P.x > 25.5) P.jumpOnce('sp'); });
      },
      // 10 The End (Together): reveal the hidden steps, then climb them side by side
      (L, A, B, st) => {
        const h1 = L.blocks.find((b) => b.x === 9 && b.y === 12);
        if (!st.ph) { A.to(10); B.to(10); if (near(A, 10, 0.3) && near(B, 10, 0.3) && A.g && B.g) { A.jumpOnce('bump'); st.ph = 1; } return; }
        if (st.ph === 1) { if (!h1.hidden && A.g && B.g) st.ph = 2; return; }
        if (st.ph === 2) { A.to(6); B.to(6); if (near(A, 6, 0.3) && near(B, 6, 0.3)) st.ph = 3; return; }
        pair(A, B, (P) => {
          if (P.y > 13) { P.right(P.x < 9.6); if (P.x > 6.5) P.jumpOnce('s1'); }
          else if (P.y > 10) { P.right(P.x < 13.6); if (P.g && P.x > 10.2) P.jumpOnce('s2'); }
          else if (P.y > 7) { P.go(1); if (P.g && P.y < 9 && P.x > 14.2) P.jumpOnce('s3'); }
          else P.go(L.doors[0].x < 20 ? -1 : 1);
        });
      },
      // 11 Short Leash: align and jump pits+spikes together
      (L, A, B, st) => {
        if (!st.al) { A.to(5, 0.05); B.to(5, 0.05); if (near(A, 5, 0.08) && near(B, 5, 0.08)) st.al = 1; return; }
        pair(A, B, (P) => {
          P.go(1);
          if (P.x > 8.1) P.jumpOnce('p1');
          if (P.x > 16.1) P.jumpOnce('p2');
          if (P.x > 24.1) P.jumpOnce('p3');
        });
      },
      // 12 Tandem Vault: boost onto ledge 1, haul partner, boost onto ledge 2, drop to door
      (L, A, B, st) => {
        if (!st.ph) {
          A.to(9.3);
          if (near(A, 9.3, 0.25) && A.g) { B.go(1); if (B.x > 7.8) B.jumpOnce('h1'); if (B.p.onP) st.ph = 1; }
          else B.to(7.6);
          return;
        }
        if (st.ph === 1) { B.go(1); B.jumpOnce('u1'); if (B.y < 11 && B.g && B.x > 10.2) st.ph = 2; return; }
        if (st.ph === 2) {
          B.to(13.7); if (B.x > 11.2 && B.x < 12 && B.g) B.jumpOnce('s1b', 16);
          if (A.y > 11) A.go(1); else A.to(11.0);
          if (A.p.hang > 0 && !A.g && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
          if (A.y < 11 && A.g && A.x > 10.2) st.ph = 3;
          return;
        }
        if (st.ph === 3) {
          if (A.x > 11.1 && A.x < 12 && A.g) A.jumpOnce('s1a', 12);
          A.to(13.6);
          if (near(A, 13.6, 0.25) && A.g && B.x > 13.3 && B.g) { B.to(13.6); B.jumpOnce('h2'); if (B.p.onP) st.ph = 4; }
          else if (B.p.onP) st.ph = 4;
          else B.to(13.6);
          return;
        }
        if (st.ph === 4) { B.go(1); B.jumpOnce('u2'); A.go(1); A.jumpOnce('a2'); if (B.y < 7 && B.g && B.x > 16.2) st.ph = 5; return; }
        if (st.ph === 5) {
          B.to(17.2);
          if (A.y > 7.5 && A.p.hang <= 0 && !st.pulled) A.go(-1);
          else { A.go(1); if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { st.pulled = 1; A.jump(); st.cool = L.t + 0.3; } }
          if (A.y < 7 && A.g && A.x > 16.2) st.ph = 6;
          return;
        }
        if (L.saws[0].x > 20 && L.saws[0].x < 28 && B.y < 8 && B.x > 19.0) { B.to(19.4); A.to(19.4); return; }
        B.go(1); A.go(1);
        if (B.x > 17.0 && B.x < 18 && B.g) B.jumpOnce('s2b', 20);
        if (A.x > 17.0 && A.x < 18 && A.g) A.jumpOnce('s2a', 20);
      },
      // 13 Inverse Tether: align, flip up, coyote-jump gap+s1 onto pad down, jump gap+s3
      (L, A, B, st) => {
        if (!st.al) { A.to(4, 0.05); B.to(4, 0.05); if (near(A, 4, 0.08) && near(B, 4, 0.08)) st.al = 1; return; }
        if (st.al === 1 && L.g > 0 && Math.max(A.x, B.x) > 24.4) {
          A.to(24.9, 0.08); B.to(24.9, 0.08);
          if (!A.g && A.p.hang > 0) A.jump();
          if (!B.g && B.p.hang > 0) B.jump();
          if (near(A, 24.9, 0.25) && near(B, 24.9, 0.25) && A.g && B.g) st.al = 2;
          return;
        }
        pair(A, B, (P) => {
          if (L.g > 0 && !P.g && P.x > 19.5 && P.x < 21.5) P.go(0);
          else P.go(1);
          if (L.g < 0 && P.x > 12.2) P.jumpOnce('c1');
          if (L.g > 0 && P.y > 14 && P.g && P.x > 21.0) P.jumpOnce('g2', 16);
          if (st.al === 2 && P.x > 25.0 && P.g) P.jumpOnce('sp3');
        });
      },
      // 14 Guillotine Run: align and sprint under crushers, jumping s1 & s2
      (L, A, B, st) => {
        if (!st.al) { A.to(4); B.to(4); if (near(A, 4) && near(B, 4)) st.al = 1; return; }
        pair(A, B, (P) => {
          P.go(1);
          if (P.x > 10.6 && P.g) P.jumpOnce('sp1');
          if (P.x > 18.6 && P.g) P.jumpOnce('sp2');
        });
      },
      // 15 Slipknot: handle swaps while jumping pits
      (L, A, B, st) => {
        pair(A, B, (P) => {
          P.go(1);
          if (P.x > 7.5 && P.g) P.jumpOnce('p1');
          if (P.x > 15.5 && P.g) P.jumpOnce('p2');
          if (P.x > 23.5 && P.g) P.jumpOnce('p3');
        });
      },
      // 16 Fragile Unity: align tightly before crumble, sprint together, jump spikes
      (L, A, B, st) => {
        if (!st.ph) { A.to(4, 0.03); B.to(4, 0.03); if (near(A, 4, 0.05) && near(B, 4, 0.05)) st.ph = 1; return; }
        pair(A, B, (P) => P.go(1));
        if (Math.max(A.x, B.x) > 16.6) { A.jumpOnce('m'); B.jumpOnce('m'); }
        if (Math.max(A.x, B.x) > 26.5) { A.jumpOnce('sp'); B.jumpOnce('sp'); }
      },
      // 17 Twin Hazards: align and jump s1+sawR and s2
      (L, A, B, st) => {
        if (!st.al) { A.to(3.5); B.to(3.5); if (near(A, 3.5) && near(B, 3.5)) st.al = 1; return; }
        pair(A, B, (P) => {
          P.go(1);
          if (P.x > 14.0 && P.g) P.jumpOnce('s1');
          if (P.x > 22.8 && P.g) P.jumpOnce('s2');
        });
      },
      // 18 The Chasm Swing: A anchors at ledge, B swings & chain-jumps across, then hauls A
      (L, A, B, st) => {
        if (!st.ph) {
          A.to(7.5); B.go(1);
          if (B.x > 7.5 && B.g) B.jumpOnce('j1');
          if (B.x > 11.5 && B.p.hang > 0) { B.jumpOnce('j2'); st.ph = 1; }
          return;
        }
        if (st.ph === 1) {
          B.go(1);
          if (B.x > 13.0) { if (A.x < 11.2) A.go(1); else A.go(0); if (A.x > 7.9 && A.g) A.jumpOnce('ja'); } else A.to(7.9);
          if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
          if (B.x > 16.5 && B.g) st.ph = 2;
          return;
        }
        if (st.ph === 2) {
          B.to(22); A.go(1);
          if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
          if (A.x > 16.5 && A.g) st.ph = 3;
          return;
        }
        if (st.ph === 3) {
          A.to(24.0, 0.1); B.to(24.0, 0.1);
          if (near(A, 24.0, 0.2) && near(B, 24.0, 0.2) && A.g && B.g) st.ph = 4;
          return;
        }
        B.go(1); A.go(1);
        if (B.x > 25.1 && B.g) B.jumpOnce('sp');
        if (A.x > 25.1 && A.g) A.jumpOnce('sp');
      },
      // 19 Chaos Bond: align, jump early for 0.16s lag (~1.3 tiles)
      (L, A, B, st) => {
        if (!st.al) { A.to(4); B.to(4); if (near(A, 4) && near(B, 4)) st.al = 1; return; }
        pair(A, B, (P) => {
          P.go(1);
          if (P.x > 7.2 && P.g) P.jumpOnce('s1');
          if (P.x > 16.2 && P.g) P.jumpOnce('s2');
          if (P.x > 25.5 && P.g) P.jumpOnce('s3');
        });
      },
      // 20 Eternal Bond: align tightly, sprint crumble & crusher, jump over pad onto hidden blocks to real door
      (L, A, B, st) => {
        if (!st.ph) {
          const a = A.to(4.2, 0.08), b = B.to(4.2, 0.08);
          if (a && b && Math.abs(A.p.vx) < 0.1 && Math.abs(B.p.vx) < 0.1) st.ph = 1;
          return;
        }
        pair(A, B, (P) => P.go(1));
        if (Math.max(A.x, B.x) > 18.0) { A.jumpOnce('skipPad'); B.jumpOnce('skipPad'); }
        if (A.g && A.y < 13.5 && A.x > 21.8) { A.jumpOnce('up2'); B.jumpOnce('up2'); }
      },
    ];

    const out = [];
    const runSingle = (i) => {
      R.load(i, 'single');
      const k = R.keys; const st = {};
      for (let n = 0; n < 120 * 40; n++) {
        const L = R.game.level;
        if (L.over) return `DEAD at px=${L.px.toFixed(2)} py=${L.py.toFixed(2)}`;
        if (L.won) return `won t=${L.t.toFixed(2)}`;
        k.left = 0; k.right = 0;
        const j = SINGLE[i](L, k, st);
        k.left = !!k.left; k.right = !!k.right;
        // a policy returns true for a full jump, or a step count for a short tap
        if (j) { k.jump = true; R.pressed.add('jump'); st.hold = j === true ? 60 : j; }
        if (st.hold > 0) { st.hold--; k.jump = true; } else k.jump = false;
        L.step(R.STEP);
      }
      return 'timeout';
    };
    const runDuo = (mode, i, pol) => {
      R.load(i, mode);
      const st = {}, hold = [0, 0], once = [{}, {}];
      const L0 = R.game.level;
      const actors = L0.players.map((p, k) => {
        const kb = () => (R.game.level.swap ? 1 - k : k);
        const a = {
          p, get x() { return p.x + p.w / 2; }, get y() { return p.y + p.h / 2; }, get g() { return p.grounded; },
          set(l, r) { const c = R.ctl[kb()]; c.left = l; c.right = r; },
          go(d) { a.set(d < 0, d > 0); },
          right(on) { a.set(false, !!on); },
          to(x, tol = 0.15) { const dx = x - a.x; if (Math.abs(dx) < tol) { a.go(0); return true; } a.go(Math.sign(dx)); return false; },
          jump(h = 60) { R.pressedAll[kb()].add('jump'); hold[kb()] = h; },
          jumpOnce(n, h) { if (!once[k][n]) { once[k][n] = 1; a.jump(h); } },
        };
        return a;
      });
      for (let n = 0; n < 120 * 30; n++) {
        const L = R.game.level;
        if (L.over) { const d = L.victim; return `DEAD (P${d.idx + 1}, ${L.cause}) at x=${(d.x + 0.4).toFixed(2)} y=${(d.y + 0.45).toFixed(2)} ph=${st.ph}`; }
        if (L.won) return `won t=${L.t.toFixed(2)}`;
        for (const c of R.ctl) { c.left = false; c.right = false; }
        pol(L, actors[0], actors[1], st);
        for (let k = 0; k < 2; k++) { R.ctl[k].jump = hold[k] > 0; if (hold[k] > 0) hold[k]--; }
        L.step(R.STEP);
      }
      const L = R.game.level;
      return `timeout ph=${st.ph} ` + L.players.map((p) => `P${p.idx + 1}(${(p.x + 0.4).toFixed(1)},${(p.y + 0.45).toFixed(1)}${p.done ? ' in' : ''})`).join(' ');
    };
    const want = (c, i) => (!onlyCourse || onlyCourse === c) && (!onlyLevel || +onlyLevel === i + 1);
    const names = (m) => window.LEVELS[m];
    SINGLE.forEach((_, i) => want('single', i) && out.push(`[single] ${i + 1} ${names('single')[i].name}: ${runSingle(i)}`));
    // levels that change with the death count: also prove their odd-death layout
    for (const i of [27, 29]) {
      if (!want('single', i)) continue;
      R.save.levelDeaths[String(i)] = 1;
      out.push(`[single] ${i + 1} ${names('single')[i].name} (after a death): ${runSingle(i)}`);
      delete R.save.levelDeaths[String(i)];
    }
    MULTI.forEach((pol, i) => want('multi', i) && out.push(`[multi] ${i + 1} ${names('multi')[i].name}: ${runDuo('multi', i, pol)}`));
    SPECIAL.forEach((pol, i) => want('special', i) && out.push(`[special] ${i + 1} ${names('special')[i].name}: ${runDuo('special', i, pol)}`));
    return out;
  }, [onlyCourse, onlyLevel]);
  console.log(res.join('\n'));
  console.log('errors:', errs);
  await b.close();
  const failed = res.filter((r) => !/: won/.test(r)).length + errs.length;
  process.exit(failed ? 1 : 0);
})();
