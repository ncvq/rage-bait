// Solvability + edge-case check: a scripted bot plays every level of every course through the
// deterministic test hook (window.__ragebait). Run: node tests/solve.js  (works with or without playwright)
// Optional filter: node tests/solve.js multi 3   (course, 1-based level)
const path = require('path'), fs = require('fs'), vm = require('vm');
const [onlyCourse, onlyLevel] = process.argv.slice(2);
const root = path.resolve(__dirname, '..');
const run = ([onlyCourse, onlyLevel]) => {
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
  // ---- boss bot helpers (tools: the scratch tracer evals this block too)
  // answer a quick-time event: one key every other step (a key needs a release in between to count again)
  const qteBot = (L, k, st) => {
    const q = L.qte;
    if (!q) { st.qk = 0; return null; }
    st.qk = (st.qk || 0) + 1;
    if (st.qk % 2) return false;
    const key = q.mash ? 'jump' : q.keys[q.i];
    if (key === 'jump') return 2;
    k[key] = 1; return false;
  };
  const goX = (L, k, x, tol = 0.15) => { if (Math.abs(L.px - x) > tol) { if (x > L.px) k.right = 1; else k.left = 1; } };
  // simulate a full jump from where we stand and an orb rolling at us (it steers toward x0 at a, up to vmax):
  // 'stomp' if we come down on top of it, 'hit' if it gets us, null if they never meet in time
  const orbJump = (px, orb, a, vmax, jump = true) => {
    let ox = orb.x, ovx = orb.vx;
    for (let i = 1; i <= 100; i++) {
      const tau = i / 120;
      ovx = Math.max(-vmax, Math.min(vmax, ovx + Math.sign(px - ox) * a / 120)); ox += ovx / 120;
      const hgt = jump ? Math.max(0, 20.5 * tau - 31 * tau * tau) : 0, feet = 15 - hgt;
      const cx = Math.max(px - 0.4, Math.min(px + 0.4, ox)), cy = Math.max(feet - 0.9, Math.min(feet, orb.y));
      if (Math.hypot(ox - cx, orb.y - cy) < orb.r * 0.85) return jump && tau > 0.34 && feet < orb.y - 0.2 ? 'stomp' : 'hit';
      if (jump && tau > 0.66) return null;
    }
    return null;
  };
  // Simulate the knight for T seconds running in direction dir (-1, 0, 1), jumping now or not, against
  // projectiles (circles: x, y, r, vx, vy, g gravity, bounceY / bounceVy, spawn = seconds from now) and timed
  // rects (x, y, w, h live from t0 to t1). True if nothing touches it. floor = the y the knight stands on.
  const planSafe = (p, dir, jump, projs, rects, T = 0.8, floor = 15, hop = false, to = null, out = null, jumpAt = 0) => {
    const now = jump && !jumpAt;   // jumpAt: run first (turning is quicker on the ground), jump that many seconds from now
    let x = p.x, vx = p.vx, y = p.y, vy = now ? -20.5 : p.grounded ? 0 : p.vy, grounded = p.grounded && !now, stomped = false, jumped = now, cut = false;
    const mul = p.mul || 1;   // boots (or cursed ones): speedMul
    const qs = projs.map((q) => ({ ...q }));
    for (let i = 1; i <= T * 120; i++) {
      if (to !== null) dir = Math.abs(to - (x + 0.4)) < 0.15 ? 0 : Math.sign(to - (x + 0.4));   // run to a spot and stop
      const dt = 1 / 120, t = i * dt, want = dir * 8 * mul, acc = (grounded ? (dir ? 90 : 80) : 60) * mul * dt;
      vx = vx < want ? Math.min(want, vx + acc) : Math.max(want, vx - acc);
      x = Math.max(p.minX === undefined ? 1 : p.minX, Math.min((p.maxX === undefined ? 31 : p.maxX) - 0.8, x + (vx + (p.wind || 0)) * dt));   // a current pushes too
      if (grounded && ((hop && jumped) || (jumpAt && !jumped && i / 120 >= jumpAt))) { vy = -20.5; grounded = false; jumped = true; }   // hop again / jump later
      if (jumped && p.cutAt && !cut && t >= p.cutAt && vy < 0) { vy *= 0.5; cut = true; }   // a short hop: jump let go of early
      if (!grounded) { vy = Math.min(vy + 62 * dt, 28); y += vy * dt; if (y >= floor - 0.9) { y = floor - 0.9; vy = 0; grounded = true; if (out && out.land === undefined) out.land = x + 0.4; } }
      if (grounded && p.pits && p.pits.some(([a, z]) => x > a - 0.05 && x + 0.8 < z + 0.05)) return false;   // fell in a pit
      for (const q of qs) {
        if (t < (q.spawn || 0) || q.done || (q.life !== undefined && t > q.life + (q.spawn || 0))) continue;
        if (q.homing) q.vx = Math.max(-q.homing.vmax, Math.min(q.homing.vmax, q.vx + Math.sign(x + 0.4 - q.x) * q.homing.a * dt));
        q.vy = (q.vy || 0) + (q.g || 0) * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.bounceY !== undefined && q.y > q.bounceY) { q.y = q.bounceY; q.vy = q.bounceVy; }
        const cx = Math.max(x, Math.min(x + 0.8, q.x)), cy = Math.max(y, Math.min(y + 0.9, q.y)), dq = Math.hypot(q.x - cx, q.y - cy);
        if (out) out.clear = Math.min(out.clear === undefined ? 9 : out.clear, dq - q.r * 0.85);   // how close it came
        if (dq < q.r * 0.85) {
          if (q.stomp && vy > 0 && y + 0.9 < q.y - 0.12) { q.done = true; stomped = true; vy = -14; continue; }   // landed on it
          return false;
        }
      }
      for (const r of rects) {
        if (t < r.t0 || t > r.t1) continue;
        const rx = r.x + (r.vx || 0) * t, ry = r.y + (r.vy || 0) * t + 0.5 * (r.g || 0) * t * t;   // moving rects (a dash, a leap)
        if (x < rx + r.w && x + 0.8 > rx && y < ry + r.h && y + 0.9 > ry) return false;
      }
    }
    if (out) out.x = x + 0.4;
    return stomped ? 'stomp' : true;
  };
  // planSafe with gravity up: mirror y about the middle of the room (3..15), plan, done
  const planSafeG = (p, dir, jump, projs, rects, up) => {
    if (!up) return planSafe(p, dir, jump, projs, rects, 0.8, 15);
    const m = (y) => 18 - y;
    const pm = { x: p.x, y: m(p.y + p.h), vx: p.vx, vy: -p.vy, grounded: p.grounded };
    return planSafe(pm, dir, jump, projs.map((q) => ({ ...q, y: m(q.y), vy: -(q.vy || 0) })), rects.map((r) => ({ ...r, y: m(r.y + r.h) })), 0.8, 15);
  };
  // up onto block s from the floor: stand just outside its edge, jump straight up, steer in once above it
  // (a running jump would hit its head on the underside)
  const climb = (L, k, s) => {
    const p = L.player, side = L.px < s.x + s.w / 2 ? -1 : 1, spot = side < 0 ? s.x - 0.5 : s.x + s.w + 0.5;
    if (!p.grounded) { if (p.y + p.h < s.y - 0.02) { if (side < 0) k.right = 1; else k.left = 1; } return false; }
    if (Math.abs(L.px - spot) > 0.15) { goX(L, k, spot, 0.1); return false; }
    return Math.abs(p.vx) < 1;
  };
  // ---- end boss bot helpers
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

  // seconds left in a laser's off window (-1 while it is on)
  const off = (l, L) => { const c = (L.t + l.phase) % (l.on + l.off); return c < l.on ? -1 : l.on + l.off - c; };
  // run a hop list, then hand over to tail(L, k, st) once all n hops are done
  const then = (hop, n, tail) => (L, k, st) => { const r = hop(L, k, st); return st.i >= n ? tail(L, k, st) : r; };
  // walk right, but stand still while the next beam ahead is on (or about to be)
  const beamWait = (L, k, g) => { const l = L.lasers.find((b) => b.x + 0.7 > L.px); k.right = !(l && g && L.px > l.x - 3 && L.px < l.x - 0.9 && off(l, L) < 0.6); };
  const ladderLie = then(hopper([
    { d: 1, prep: 10.95, at: 10.95, hold: 130, upTo: 8.3, to: 13 },
    { d: 1, at: 14.2, to: 18.2 },
    { d: 1, prep: 19.95, at: 19.95, hold: 130, upTo: 3.5, to: 24 },
  ]), 3, (L, k, st) => {
    const g = L.player.grounded, d = L.doors[0];
    if (!d.tween && d.x > 20) { k.right = 1; return false; }   // wake the door, then chase it home
    k.left = 1; return J(st, 'h', g && L.px < 22.2 && L.px > 19) || J(st, 'p', g && L.px < 14.6 && L.px > 11);
  });
  const glass = then(hopper([
    { d: 1, at: 4.6, to: 8.6 },
    { d: 1, stop: 1, at: 9.0, to: 13 },
    { d: 1, stop: 1, at: 13.9, to: 18.5 },
  ]), 3, (L, k, st) => { k.right = 1; return J(st, 'z', L.player.grounded && L.px > 27.2) ? 10 : false; });
  const sawtooth = then(hopper([
    { d: 1, at: 10.5, to: 16 }, { d: 1, at: 25.9, to: 30 }, { d: -1, at: 28.4, to: 23 }, { d: -1, at: 18.5, to: 13 }, { d: -1, at: 11.5, to: 6 },
    { d: -1, at: 4.8, to: 1.5 }, { d: 1, at: 2.3, to: 7 }, { d: 1, at: 13.5, to: 19 }, { d: 1, at: 23.6, to: 28 },
  ]), 9, (L, k) => { k.right = 1; return false; });
  const doubleCross = (() => {
    const up = hopper([{ d: 1, at: 23.6, to: 26.3 }, { d: 1, stop: 1, at: 26.6, to: 29.4 }]);
    return (L, k, st) => {
      if (L.doors.find((d) => !d.fake).y > 12) { if (L.invert) k.left = 1; else k.right = 1; return false; }   // low portal: just walk
      const r = up(L, k, st);
      if (st.i >= 2) k.right = 1;
      return r;
    };
  })();
  const tower = then(hopper([
    { d: 1, at: 4.5, to: 8.8 }, { d: 1, at: 9.2, to: 13.6 }, { d: 1, at: 14.2, to: 18.6 }, { d: 1, at: 19.2, to: 23.6 }, { d: 1, at: 24.1, to: 28.2 },
  ]), 5, (L, k, st) => {
    const g = L.player.grounded, d = L.doors[0], sh = L.blocks.find((b) => b.w === 3);
    if (!d.tween && d.x > 20) { k.right = 1; return false; }    // wake the door
    if (L.player.ground === sh) { st.rode = 1; if (sh.x <= 8.2) { k.left = 1; return J(st, 'off', true); } return false; }
    if (st.rode) { k.left = 1; return false; }
    const edge = L.px < 27 && sh.x >= 21.9 && g;
    k.left = edge || (st.on && !g && L.px > 23.8) || (!st.on && L.px > 26.6);
    return J(st, 'on', edge);
  });
  // The Mimic in the air (phases 2-3): fire the lazer when its sweeping aim crosses the chest; when the floor turns
  // to lava, get up on the nearest plain rock; otherwise fetch a lazer (on the floor, or up on plain rock), and dodge
  // the coins with the planner, from floor spots that aren't under any rock (a dodge jump there hits its head)
  const mimicAir = (L, k, st, b) => {
    const p = L.player, g = p.grounded, px = L.px, py = L.py, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    if (p.laser && b.fly && b.inv <= 0 && by < py && !['roar', 'sprout'].includes(b.state)) {
      const want = Math.atan2(by - py, bx - px), tol = Math.max(0.03, Math.atan2(0.55, Math.hypot(bx - px, by - py)));
      if (Math.abs(p.laser.a - want) < tol) R.pressed.add('fire');
    }
    const rock = L.blocks.filter((s) => s.edge && s.h < 1 && s.solid && !s.crumble && !s.trap);
    const on = g && p.ground && p.ground.y < 14 ? p.ground : null;
    const lava = L.hz.some((h) => h.atk === 'rising') || L.marks.some((m) => m.w >= 29);
    // the floor is three stretches between the pits, each with one plain rock: never climb across a pit
    const seg = (x) => (x < 10 ? 0 : x < 22 ? 1 : 2), mine = rock.find((s) => seg(s.x + s.w / 2) === seg(px));
    if (lava && !on) return climb(L, k, mine);
    const lz = !p.laser && L.pickups.find((q) => q.type === 'laser');
    const lzRock = lz && rock.find((s) => lz.x + 0.4 > s.x && lz.x + 0.4 < s.x + s.w && Math.abs(s.y - (lz.y + 1)) < 0.3);
    if (lz && lzRock === mine && !on) return climb(L, k, mine);
    let goal;   // dodging comes first: the rain's gap, out from under a swoop; then the lazer; then a spot to wait in
    if (b.state === 'rainTell' || L.hz.some((h) => h.atk === 'rain' && h.y < 12)) goal = b.gap;
    else if (b.state === 'swoopTell' || b.state === 'swoop') {   // staying on this stretch
      const c = b.to.x + b.w / 2, side = (px >= c ? 1 : -1) * ((seg(c + 3.5 * (px >= c ? 1 : -1)) === seg(px)) ? 1 : -1);
      goal = c + side * 3.5;
    }
    else if (lz && (on ? lzRock === on : lz.y > 13 || (lzRock && lzRock !== mine))) goal = lzRock && !on ? lzRock.x + lzRock.w / 2 : lz.x + 0.4;   // over to its stretch first
    else if (on && !lava) goal = px < on.x + on.w / 2 ? on.x - 0.7 : on.x + on.w + 0.7;   // back down off the rock
    else if (on) goal = Math.max(on.x + 0.3, Math.min(on.x + on.w - 0.3, px));
    else {   // a spot on the stretch of floor we're on (not across a pit), not under rock, about 6 tiles off the chest
      const seg = px < 10 ? [1.8, 7] : px < 22 ? [12.5, 19.5] : [25, 30.2];
      goal = seg.reduce((a, c) => (Math.abs(Math.abs(c - bx) - 6) < Math.abs(Math.abs(a - bx) - 6) ? c : a));
    }
    st.goal = goal;
    const projs = L.hz.filter((h) => h.atk === 'barrage' || h.atk === 'rain').map((h) => ({ x: h.x, y: h.y, r: h.r + 0.06, vx: h.vx, vy: h.vy }));
    const rects = [{ x: b.x - 0.25, y: b.y - 0.25, w: b.w + 0.5, h: b.h + 0.5, t0: 0, t1: 9 }];
    for (const q of L.pickups) if (q.fake) rects.push({ x: q.x - 0.1, y: q.y - 0.1, w: 1, h: 1, t0: 0, t1: 9 });   // perfect information: fakes are hazards
    if (b.state === 'swoopTell' || b.state === 'swoop') rects.push({ x: b.to.x - 0.4, y: b.to.y - 0.4, w: b.w + 0.8, h: b.h + 0.8, t0: 0, t1: 1.3 });
    if (b.state === 'swoop') { const left = Math.max(0.05, 0.45 - b.st); rects.push({ x: b.x - 0.3, y: b.y - 0.3, w: b.w + 0.6, h: b.h + 0.6, t0: 0, t1: left, vx: (b.to.x - b.x) / left, vy: (b.to.y - b.y) / left }); }   // its dive
    const floor = on ? on.y : 15, pw = { mul: L.speedMul, x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: g, minX: on && lava ? on.x - 0.3 : 1, maxX: on && lava ? on.x + on.w + 0.3 : 31, pits: on ? null : BOSSES.mimicBoss.pits };
    if (!g) {   // in the air: steer clear of coins, but never so it comes down in a pit
      const keep = st.plan ? st.plan.dir : Math.sign(goal - px), clear = (x) => on || x === undefined || !BOSSES.mimicBoss.pits.some(([a, z]) => x > a - 0.45 && x < z + 0.45);
      for (const dir of [keep, 0, 1, -1]) { const end = {}; if (planSafe(pw, dir, false, projs, rects, 0.6, floor, false, null, end) && clear(end.land)) { if (dir > 0) k.right = 1; if (dir < 0) k.left = 1; return false; } }
      if (keep > 0) k.right = 1; if (keep < 0) k.left = 1;
      return false;
    }
    st.plan = null;
    if (on && !lava && !(lz && lzRock === on)) { goX(L, k, goal, 0.1); return false; }   // nothing up here: step off
    const pitEdge = (x) => !on && BOSSES.mimicBoss.pits.some(([a, z]) => x > a - 0.45 && x < z + 0.45);
    if (!on && seg(goal) !== seg(px)) {   // the goal is across a pit: jump it once the jump lands clear (take a run at it)
      const d = Math.sign(goal - px), pits = BOSSES.mimicBoss.pits, pit = pits[d > 0 ? seg(px) : seg(px) - 1], edge = d > 0 ? pit[0] : pit[1];
      const crust = pit[0] < 15, end = {};   // the left pit has solid crust over it: only a short hop fits under
      if (planSafe({ ...pw, cutAt: crust ? 0.06 : 0 }, d, true, projs, rects, 1.0, 15, false, null, end) && end.land !== undefined && !pits.some(([a, z]) => end.land > a - 0.6 && end.land < z + 0.6)) {
        if (d > 0) k.right = 1; else k.left = 1;
        st.plan = { dir: d }; return crust ? 7 : true;
      }
      const gap = Math.abs(edge - px);
      if (gap < 2.6 && gap > 0.55 && planSafe(pw, d, false, projs, rects, 0.4, 15)) { if (d > 0) k.right = 1; else k.left = 1; return false; }
    }
    // every plan: run to a spot within 6 tiles and stop, or jump (a short hop under rock: a full jump hits its head).
    // Of the safe ones, take the one the coins come least close to, then the one nearest the goal
    const roofed = L.blocks.some((s) => s.edge && s.h < 1 && s.solid && s.y < floor - 1 && s.y > floor - 4.5 && px > s.x - 0.5 && px < s.x + s.w + 0.5);
    const gd = Math.sign(goal - px) || 1;
    let best = null;
    const consider = (plan, score) => { if (!best || score > best.score) best = { ...plan, score }; };
    for (let d = -6; d <= 6; d++) {
      const x = d ? px + d : goal;
      if (x < 1.5 || x > 30.5 || (on && (x < on.x - 0.3 || x > on.x + on.w + 0.3)) || pitEdge(x)) continue;
      const end = {};
      if (planSafe(pw, 0, false, projs, rects, 1.0, floor, false, x, end)) consider({ to: x }, Math.min(1.2, end.clear === undefined ? 9 : end.clear) - Math.abs(x - goal) * 0.04);
    }
    for (const dir of [gd, 0, -gd]) {
      const end = {};
      if (!planSafe(roofed ? { ...pw, cutAt: 0.06 } : pw, dir, true, projs, rects, 0.8, floor, false, null, end)) continue;
      if (pitEdge(end.x) || (end.land !== undefined && pitEdge(end.land)) || (on && (end.x < on.x - 0.3 || end.x > on.x + on.w + 0.3))) continue;
      consider({ dir, jump: roofed ? 7 : true }, Math.min(1.2, end.clear === undefined ? 9 : end.clear) - Math.abs(end.x - goal) * 0.04 - 0.1);
    }
    if (!best) return false;   // nothing safe: stand still rather than walk into a pit
    if (best.to !== undefined) { goX(L, k, best.to, 0.12); return false; }
    if (best.dir > 0) k.right = 1; if (best.dir < 0) k.left = 1;
    st.plan = { dir: best.dir };
    return best.jump;
  };

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
    // 10 The Warden: hold a spot 5-7 tiles out from the wall on your side of it, so a charge you jump ends in
    // the wall right behind you. Jump its stomp ripples, sweeps and the outgoing halberd at the last moment (stay
    // down when it comes back), jump over charges from a standstill, jump over it when it walks you into the
    // corner, run from the leap's landing spot, walk out from under falling masonry. Dazed: walk into it, strike
    (L, k, st) => {
      const q = qteBot(L, k, st); if (q !== null) return q;
      const b = L.bosses[0];
      if (L.cine || !b || b.dead || b.state === 'dying') return false;
      const p = L.player, g = p.grounded, px = L.px, wc = b.x + b.w / 2, d = px - wc, ad = Math.abs(d), s = b.state;
      const low = p.y + p.h > 14.4, ahead = d * b.face > 0;
      let jump = false;
      // ripples: remember when a stomp or a landing goes off, then jump just before the spike under us pops
      if (s === 'stompTell') st.rip = { at: L.t + b.tellFor - b.st, cx: wc, r: [0, 8, 9, 10][b.phase] };
      if (s === 'leap') st.rip = { at: L.t + 0.85 - b.st, cx: b.leapTo + b.w / 2, r: 3.5 };
      if (st.rip && low) {
        let pop = Infinity;
        for (let x = Math.floor(p.x); x <= Math.floor(p.x + p.w); x++) {
          const dd = Math.abs(x + 0.5 - st.rip.cx);
          if (dd >= b.w / 2 + 0.2 && dd <= st.rip.r && x + 0.12 < p.x + p.w && x + 0.88 > p.x) pop = Math.min(pop, st.rip.at + dd * 0.03);
        }
        if (L.t > pop - 0.06 && L.t < pop + 0.3) jump = true;
        if (L.t > st.rip.at + 0.7) st.rip = null;
      }
      const gap = b.face > 0 ? p.x - (b.x + b.w) : b.x - (p.x + p.w);
      if (s === 'sweepTell' && low && ahead && gap < 3.5 && b.tellFor - b.st < 0.07) jump = true;
      // a charge: from a standstill, jump when its body will pass under the top of the jump
      // jump so that its body starts passing under us 0.33 - 1.5/v s into the jump (it is 2.6 tall: the top of the jump)
      if ((s === 'charge' || s === 'chargeTell') && low && ahead) {
        const v = [0, 13, 15, 17][b.phase], until = (s === 'chargeTell' ? b.tellFor - b.st : 0) + gap / v;
        if (until <= 0.33 - 1.5 / v + 0.004) jump = true;
      }
      if (s === 'grabTell' && ahead && gap < 1.7) jump = true;
      // cornered by a walking Warden: run at it and jump over (only works while it walks at you)
      const room = d > 0 ? 27.2 - px : px - 4.8, corner = s === 'walk' && b.walkDir * d < 0 && low && room < 2.8 && gap < 4;
      if (corner && gap < (5.4 + 8) * 0.22) jump = true;
      const hal = L.hz.find((h) => h.atk === 'throw');
      if (hal && low) {
        const toward = (px - hal.x) * hal.vx > 0;
        if (hal.out && toward && Math.abs(hal.x - px) - 0.95 < 13 * 0.11) jump = true;
        if (!hal.out && Math.abs(hal.x - px) < 4) jump = false;   // it comes back at head height: stay down
      }
      // where to go. Never under a ledge (a jump there hits its head) unless striking
      const under = (x) => x - 0.4 < 4.4 || x + 0.4 > 27.6;
      const deb = L.hz.find((h) => h.atk === 'debris' && h.x < p.x + p.w + 0.5 && h.x + h.w > p.x - 0.5 && h.y < 12);
      const side = px < wc ? -1 : 1, home = side < 0 ? 6.2 : 25.8;
      if (s === 'dazed' && b.stun > Math.max(0, ad - 1.5) / 8 + 0.15) goX(L, k, wc, 0.3);   // only if we get there in time
      else if (corner) goX(L, k, wc);
      else if (s === 'leap') {
        const lc = b.leapTo + b.w / 2, from = b.leapX0 + b.w / 2;
        let dir = Math.sign(px - from) || 1;
        const bad = (x) => x < 4.8 || x > 27.2 || L.hz.some((h) => h.atk === 'debris' && Math.abs(h.x + h.w / 2 - x) < 1.6);
        if (bad(lc + dir * 5.2)) dir = -dir;
        goX(L, k, Math.min(27.2, Math.max(4.8, lc + dir * 5.2)));
      } else if ((s === 'charge' || (s === 'chargeTell' && !g)) && ahead) { /* hold still, on the ground and in the air: the jump is timed for that */ }
      else if (deb) {   // out from under it, on the side away from the Warden
        const l = deb.x - 1.4, r = deb.x + deb.w + 1, ok = (x) => x > 4.8 && x < 27.2;
        goX(L, k, !ok(l) ? r : !ok(r) ? l : Math.abs(l - wc) > Math.abs(r - wc) ? l : r);
      }
      else if (s === 'grabTell' && ahead && gap < 1.7) goX(L, k, Math.min(27.2, Math.max(4.8, px + b.face * 3)));
      else if (low && under(px) && s !== 'charge') goX(L, k, side < 0 ? 5 : 27);
      else if (!['chargeTell', 'stompTell', 'sweepTell'].includes(s)) {
        if (ad < 4.5) goX(L, k, Math.min(27.2, Math.max(4.8, px + side * 3)));   // too close: back off (the corner rule takes over)
        else goX(L, k, home, 0.4);
      }
      return jump && g;
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
    // 17 The Betrayal: jump s1, jump over the evil flag so bridge stays up, climb hidden steps to real door
    (L, k, st) => {
      const p = L.player;
      if (!st.step1) {
        k.right = L.px < 21.8;
        if (p.grounded && p.y < 13.5) st.step1 = 1;
        return J(st, 'a', L.px > 3.6 && p.grounded) || J(st, 'f', L.px > 14.2 && p.grounded) || J(st, 'b', L.px > 19.6 && p.grounded);
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
    // 20 The Undertaker: stay on the floor, away from the walls. When the soul orb rolls at us, jump at the moment that lands us on top of it. Everything else
    // (skulls, including the ones it is about to throw; cracks and mounds about to burst; the scythe) goes through
    // a planner that tries running and jumping options and picks one that nothing touches. Stunned: banish it
    (L, k, st) => {
      const q = qteBot(L, k, st); if (q !== null) return q;
      const b = L.bosses[0];
      if (L.cine || !b || b.dead || b.state === 'dying') return false;
      const p = L.player, g = p.grounded, px = L.px, lc = b.x + b.w / 2;
      const underSlab = () => false;   // (the crypt is flat)
      const clear = (x) => Math.min(29.5, Math.max(2.5, x));
      // what is coming: skulls now and the ones still to be thrown, cracks and mounds, the scythe, the lich
      if (b.state === 'skullTell') { const dir = Math.sign(px - lc) || 1; st.stream = { t0: L.t + b.tellFor - b.st, n: [0, 3, 3, 4][b.phase], dir, x0: lc + dir * 0.9 }; }
      const projs = L.hz.filter((h) => h.atk === 'skull').map((h) => ({ x: h.x, y: h.y, r: h.r, vx: h.vx, vy: h.vy, g: 40, bounceY: 14.64, bounceVy: -5, life: h.life }));
      if (st.stream) for (let i = 0; i < st.stream.n; i++) {
        const at = st.stream.t0 + i * 0.3 - L.t;
        if (at > 0) projs.push({ x: st.stream.x0, y: 14.64, r: 0.36, vx: st.stream.dir * 5.5, vy: -3, g: 40, bounceY: 14.64, bounceVy: -5, spawn: at, life: 2.6 });
      }
      const rects = [];
      for (const h of L.hz) {
        if (h.atk === 'bones') rects.push({ x: h.x, y: h.y, w: h.w, h: h.h, t0: h.live ? 0 : h.warn - 0.02, t1: h.live ? 0.5 - h.up : h.warn + 0.5 });
        if (h.atk === 'hands') rects.push({ x: h.x, y: h.y, w: h.w, h: h.h, t0: h.live ? 0 : h.warn - 0.02, t1: h.live ? 0.4 - h.up : h.warn + 0.4 });
        if (h.atk === 'scythe') rects.push({ x: h.x, y: h.y, w: h.w, h: h.h, t0: 0, t1: 0.25 });
      }
      // skulls are born at the lich's hand: don't be there while a stream is coming out
      if (st.stream && L.t < st.stream.t0 + st.stream.n * 0.3 + 0.2) rects.push({ x: lc - 1.8, y: 13.2, w: 3.6, h: 1.8, t0: 0, t1: st.stream.t0 - L.t + st.stream.n * 0.3 + 0.3 });
      if (b.state === 'scytheTell') rects.push({ x: b.face > 0 ? b.x + b.w : b.x - 2.4, y: b.y + 0.2, w: 2.4, h: 2.4, t0: b.tellFor - b.st - 0.02, t1: b.tellFor - b.st + 0.25 });
      if (b.state === 'blinkIn' && b.scythe) rects.push({ x: b.x - 2.6, y: b.y, w: b.w + 5.2, h: b.h, t0: 0.38, t1: 1.2 });
      // where we would like to be
      let goal = null;
      const orb = L.hz.find((h) => h.atk === 'orb' && !h.kick && h.live);
      if (b.state === 'stunned' && b.stun > Math.max(0, Math.abs(lc - px) - 1) / 8 + 0.1) goal = lc;
      else if (!orb) { const want = clear(lc + (px < lc ? -6 : 6)); if (Math.abs(want - px) > 1.2 && !underSlab(want)) goal = want; }
      if (goal === null && underSlab(px)) goal = clear(px + (px < 16 ? -2.2 : 2.2));
      if (st.stunWalk && b.state !== 'stunned') st.stunWalk = false;
      const wantDir = goal === null ? 0 : Math.abs(goal - px) < 0.2 ? 0 : Math.sign(goal - px);
      if (!g) {   // in the air: keep the plan's direction unless steering elsewhere (or to a spot) keeps us alive
        const keep = st.plan ? st.plan.dir : 0;
        for (const dir of [keep, -1, 1, 0]) if (planSafe(p, dir, false, projs, rects, 0.8)) { if (dir > 0) k.right = 1; if (dir < 0) k.left = 1; return false; }
        const spots = [];
        for (const r of rects) spots.push(r.x - 0.55, r.x + r.w + 0.55);
        spots.sort((a, c) => Math.abs(a - px) - Math.abs(c - px));
        for (const x of spots) if (x > 2 && x < 30 && planSafe(p, 0, false, projs, rects, 0.8, 15, false, x)) { goX(L, k, x, 0.15); return false; }
        if (keep > 0) k.right = 1; if (keep < 0) k.left = 1;
        return false;
      }
      st.plan = null;
      // the orb: stand still and jump straight up as it arrives (it rolls under and we land on it). Too close
      // for that: back away for room; cornered: jump over it
      if (orb) {
        const vmax = [0, 5, 6, 7][b.phase], dist = Math.abs(orb.x - px), away = Math.sign(px - orb.x) || 1;
        const orbP = { x: orb.x, y: orb.y, r: orb.r, vx: orb.vx, homing: { a: 6, vmax } };
        if (orbJump(px, orb, 6, vmax) === 'stomp' && planSafe(p, 0, true, projs, rects, 0.7)) return true;
        if (orbJump(px, orb, 6, vmax, false) === 'hit' && dist < 3.2) {
          const room = away > 0 ? 29.5 - px : px - 2.5;
          if (room > 1.5 && planSafe(p, away, false, projs.concat([orbP]), rects, 0.5)) { if (away > 0) k.right = 1; else k.left = 1; return false; }
          if (planSafe(p, -away, true, projs, rects, 0.7)) { st.plan = { dir: -away }; if (away > 0) k.left = 1; else k.right = 1; return true; }
        }
      }
      // try options; a plan that lands on the orb wins, then any plan nothing touches
      const near = projs.filter((q) => !q.spawn).sort((a, c) => Math.abs(a.x - px) - Math.abs(c.x - px))[0];
      const toward = near ? (Math.sign(near.x - px) || 1) : wantDir || 1;
      const opts = [[wantDir, false], [0, true], [toward, true], [-toward, true], [-toward, false], [0, false], [toward, false], [0, true, true], [toward, true, true], [-toward, true, true],
        [toward, true, false, 0.08], [toward, true, false, 0.16], [toward, true, false, 0.26], [0, true, false, 0.12], [0, true, false, 0.24]];
      // a safe plan that doesn't end up in a corner, else any safe plan; a 'jump later' plan runs now, jumps later
      let pick = null, cornered = null;
      for (const [dir, jump, hop, later] of opts) {
        const end = {}, r = planSafe(p, dir, jump, projs, rects, orb ? 1.0 : 0.8, 15, hop, null, end, later || 0);
        if (!r) continue;
        if (end.x > 3.5 && end.x < 28.5) { pick = [dir, jump && !later]; break; }
        if (!cornered) cornered = [dir, jump && !later];
      }
      if (!pick) pick = cornered;
      if (!pick) {   // run to a spot and stop there: the gaps between cracks, the edges just outside them
        const spots = [];
        for (const r of rects) spots.push(r.x - 0.55, r.x + r.w + 0.55);
        spots.sort((a, c) => Math.abs(a - px) - Math.abs(c - px));
        for (const x of spots) {
          if (x < 2 || x > 30) continue;
          if (planSafe(p, 0, false, projs, rects, 0.8, 15, false, x)) { goX(L, k, x, 0.15); return false; }
        }
      }
      if (pick) {
        const [dir, jump] = pick;
        if (dir > 0) k.right = 1; if (dir < 0) k.left = 1;
        if (jump) st.plan = { dir };
        return jump;
      }
      if (wantDir > 0) k.right = 1; if (wantDir < 0) k.left = 1;
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
      { d: 1, stop: 1, ok: rlGo(1.4), at: (L) => L.saws[0].x - 2.0, to: 23.2 }, // over the frozen saw
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
    // 30 Old Gnasher: hide behind an anchor. The lunge flies straight at where we stood when it aimed, so stand
    // in an anchor's shadow on the floor (seen from its head) and it impales itself. Out of cover when it aims:
    // a planner times the side-step or the jump over its head and body. Jump the rolling saws; walk against the
    // current; step out of bubbling geysers. Stunned on the floor: walk into its head and rip it out
    (L, k, st) => {
      const q = qteBot(L, k, st); if (q !== null) return q;
      const b = L.bosses[0];
      if (L.cine || !b || b.dead || b.state === 'dying') return false;
      const p = L.player, g = p.grounded, px = L.px, up = L.g < 0;
      const surf = up ? 3 : 15, foot = up ? 3.45 : 14.55;   // our surface, and our centre's y on it
      const hx = b.x + b.w / 2, hy = b.y + b.h / 2;
      // the shadow each anchor casts on our surface from the head
      const shadows = [];
      for (const a of BOSSES.gnasher.anchors) {
        const ay = up ? a.y + a.h : a.y;   // the side facing away from us... the face nearest the head
        if ((up && hy <= a.y + a.h) || (!up && hy >= a.y)) continue;   // head on our side of the anchor: no shadow
        const k0 = (foot - hy) / ((up ? a.y + a.h : a.y) - hy);
        const x0 = hx + (a.x - hx) * k0, x1 = hx + (a.x + a.w - hx) * k0;
        shadows.push([Math.min(x0, x1) + 0.5, Math.max(x0, x1) - 0.5]);
      }
      const inShadow = (x) => shadows.some(([a, z]) => x > a && x < z);
      const projs = L.hz.filter((h) => h.atk === 'saw').map((h) => ({ x: h.x, y: h.y, r: h.r, vx: h.vx }));
      // its body and head, a little fattened since it keeps moving
      for (const h of L.hz) if (h.boss === b && h.r === 0.45 && h.live) projs.push({ x: h.x, y: h.y, r: 0.7, vx: 0 });
      const harmless = ['impaled', 'falling', 'stunned', 'choke', 'struck', 'bonk', 'hurt', 'roar'].includes(b.state);
      const rects = L.hz.filter((h) => h.atk === 'geyser').map((h) => ({ x: h.x - 0.2, y: 3, w: h.w + 0.4, h: 12, t0: h.live ? 0 : h.warn - 0.05, t1: h.live ? 0.7 - h.up : h.warn + 0.7 }));
      if (!harmless) rects.push({ x: b.x - 0.3, y: b.y - 0.3, w: b.w + 0.6, h: b.h + 0.6, t0: 0, t1: 9 });
      if (b.state === 'lunge' || b.state === 'lungeTell') {
        // the line it will fly along: from the head through the aim point, to the edge of the room
        const ax = b.state === 'lunge' ? hx + b.dir.x * 40 : b.aim.x + (b.aim.x - hx) * 3, ay = b.state === 'lunge' ? hy + b.dir.y * 40 : b.aim.y + (b.aim.y - hy) * 3;
        const blocked = BOSSES.gnasher.anchors.some((a) => {
          for (let i = 0; i <= 60; i++) { const x = hx + ((b.state === 'lunge' ? hx + b.dir.x * 40 : b.aim.x) - hx) * i / 60, y = hy + ((b.state === 'lunge' ? hy + b.dir.y * 40 : b.aim.y) - hy) * i / 60; if (x > a.x - 0.8 && x < a.x + a.w + 0.8 && y > a.y - 0.6 && y < a.y + a.h + 0.6) return true; }
          return false;
        });
        // each point of the line is dangerous only while the head goes past it (24 tiles a second)
        const wait = b.state === 'lungeTell' ? b.tellFor - b.st : 0, len = Math.hypot(ax - hx, ay - hy);
        if (!blocked) for (let i = 0; i <= 80; i++) {
          const x = hx + (ax - hx) * i / 80, y = hy + (ay - hy) * i / 80, at = wait + (len * i / 80) / 24;
          if (x < 0 || x > 32 || y < 2.5 || y > 15.5) break;
          rects.push({ x: x - 1.3, y: y - 1.1, w: 2.6, h: 2.2, t0: at - 0.08, t1: at + 0.6 });
        }
      }
      let goal = null;
      if ((b.state === 'stunned' || b.state === 'choke') && Math.abs(b.y + b.h / 2 - foot) < 1.5) goal = hx;
      else if (b.state === 'gape') goal = px + (Math.sign(px - hx) || 1) * 4;
      else if (shadows.length) {
        const c = shadows.map(([a, z]) => (a + z) / 2).filter((x) => x > 5 && x < 27).sort((u, v) => Math.abs(u - px) - Math.abs(v - px))[0];
        if (c !== undefined) goal = c;
      }
      // keep off the walls
      if (goal !== null && !(b.state === 'stunned' || b.state === 'choke')) goal = Math.min(27, Math.max(5, goal));
      if ((px < 4.5 || px > 27.5) && goal === null) goal = px < 16 ? 6 : 26;
      const wantDir = goal === null || Math.abs(goal - px) < 0.2 ? 0 : Math.sign(goal - px);
      if (!g) { const pa = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: false, wind: L.wind, minX: 0, maxX: 32 }, keep = st.plan ? st.plan.dir : wantDir; for (const dir of [keep, -1, 1, 0]) if (planSafe(pa, dir, false, projs, rects, 0.7, surf)) { if (dir > 0) k.right = 1; if (dir < 0) k.left = 1; return false; } return false; }
      st.plan = null;
      const opts = [[wantDir, false], [0, true], [1, true], [-1, true], [1, false], [-1, false], [0, false], [0, true, true], [1, true, true], [-1, true, true]];
      let pick = null, cornered = null;
      const pw = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, wind: L.wind, minX: 0, maxX: 32 };   // no walls in the depths
      if (b.state === 'gape') rects.push({ x: b.x - 0.4, y: b.y - 0.4, w: b.w + 0.8, h: b.h + 0.8, t0: 0, t1: 9 });   // its open mouth
      for (const [dir, jump, hop] of opts) {
        const end = {};
        if (!planSafe(pw, dir, jump, projs, rects, 0.8, 15, hop, null, end)) continue;
        if (end.x > 4.5 && end.x < 27.5) { pick = [dir, jump]; break; }
        if (!cornered) cornered = [dir, jump];
      }
      if (!pick) pick = cornered;
      if (pick) {
        const [dir, jump] = pick;
        if (dir > 0) k.right = 1; if (dir < 0) k.left = 1;
        if (jump) st.plan = { dir };
        return jump;
      }
      if (wantDir > 0) k.right = 1; if (wantDir < 0) k.left = 1;
      return false;
    },
    // 31 Laser Tag: wait out each beam (the run speeds up halfway), tap over the last spike
    (L, k, st) => { const g = L.player.grounded; beamWait(L, k, g); return J(st, 'a', g && L.px > 27.4) ? 10 : false; },
    // 32 Ladder Lie
    ladderLie,
    // 33 Glass Floor
    glass,
    // 34 Gravity Pinball: brake after each pad so you land short of the spikes, hop each strip
    (L, k, st) => {
      const g = L.player.grounded; k.right = 1;
      if (!g && ((L.g < 0 && L.px > 6 && L.px < 10 && !st.a) || (L.g > 0 && L.px > 14 && L.px < 17.5 && !st.b) || (L.g < 0 && L.px > 22 && L.px < 25 && !st.c))) k.right = 0;
      return J(st, 'a', g && L.g < 0 && L.px > 9.0) || J(st, 'b', g && L.g > 0 && L.px > 16.6) || J(st, 'c', g && L.g < 0 && L.px > 24.6);
    },
    // 35 Shrink Ray: tap-hop the two spikes while tiny, tap the last one at full size
    (L, k, st) => {
      const g = L.player.grounded, tiny = L.player.w < 0.5; k.right = 1;
      return (J(st, 'a', g && tiny && L.px > 13.6) || J(st, 'b', g && tiny && L.px > 17.5) || J(st, 'c', g && !tiny && L.px > 26.3)) ? 10 : false;
    },
    // 36 Strobe Light
    (L, k, st) => {
      const g = L.player.grounded; beamWait(L, k, g);
      if (!g && L.px > 19.4 && L.px < 21 && !st.c) k.right = 0;
      return J(st, 'a', g && L.px > 7.9) || J(st, 'b', g && L.px > 16.0 && L.px < 17) || J(st, 'c', g && L.px > 20.2) || (J(st, 'd', g && L.px > 27.4) ? 10 : false);
    },
    // 37 Double Cross
    doubleCross,
    // 38 Sawtooth
    sawtooth,
    // 39 Crumble Tower
    tower,
    // 40 The Mimic: stand at the right edge of the left lava pit; its leaps from the right overshoot into the
    // lava and it claws out at our feet, stunned: slam it shut. A planner jumps the tongue and the dash, and steps
    // out from under molten coins (its leaps and dashes are modelled as moving boxes). Swallowed: mash out
    (L, k, st) => {
      const q = qteBot(L, k, st); if (q !== null) return q;
      const b = L.bosses[0];
      if (L.cine || !b || b.dead || b.state === 'dying') return false;
      if (b.fly || b.state === 'sprout') return mimicAir(L, k, st, b);
      const p = L.player, g = p.grounded, px = L.px, mc = b.x + b.w / 2;
      const projs = L.hz.filter((h) => h.atk === 'coins' && h.live).map((h) => ({ x: h.x, y: h.y, r: h.r + 0.1, vx: h.vx, vy: h.vy, g: 40 }));
      const rects = [];
      for (const h of L.hz) if (h.atk === 'lava') rects.push({ x: h.x - 0.2, y: h.y, w: h.w + 0.4, h: h.h, t0: h.live ? 0 : h.warn - 0.05, t1: h.live ? 0.75 - h.up : h.warn + 0.75 });
      const tg = L.hz.find((h) => h.atk === 'tongue');
      const face = b.face || -1, mouthX = face > 0 ? b.x + b.w : b.x;
      if (b.state === 'tongueTell' || tg) {
        const t0 = b.state === 'tongueTell' ? b.tellFor - b.st : 0, left = tg ? 0.5 - b.st : 0.5;
        rects.push({ x: face > 0 ? mouthX : mouthX - 8, y: 14.0, w: 8, h: 0.75, t0: t0 - 0.03, t1: t0 + left });
      }
      const danger = !['stunned', 'struck', 'lava', 'hurt', 'roar'].includes(b.state) && !b.hidden;
      if (danger && b.state === 'leap') {   // its arc, from now: x + vx t, y + vy t + 20 t^2
        rects.push({ x: b.x - 0.1, y: b.y - 0.1, w: b.w + 0.2, h: b.h + 0.2, t0: 0, t1: Math.max(0, 0.85 - b.st) + 0.02, vx: b.vx, vy: b.vy, g: 40 });
      } else if (danger && b.state === 'dash') {
        rects.push({ x: b.x - 0.1, y: b.y - 0.1, w: b.w + 0.2, h: b.h + 0.2, t0: 0, t1: Math.max(0, 1.1 - b.st), vx: b.face * [0, 12, 13, 14][b.phase] });
      } else if (danger && b.state === 'dashTell') {
        rects.push({ x: b.x - 0.1, y: b.y - 0.1, w: b.w + 0.2, h: b.h + 0.2, t0: b.tellFor - b.st, t1: b.tellFor - b.st + 1.1, vx: (Math.sign(px - mc) || 1) * [0, 12, 13, 14][b.phase] });
      } else if (danger) rects.push({ x: b.x - 0.2, y: b.y - 0.2, w: b.w + 0.4, h: b.h + 0.4, t0: 0, t1: 9 });
      // where to be: by the pit; stunned at our feet: walk into it
      let goal = 11.65;
      if (b.state === 'stunned' && b.stun > Math.abs(mc - px) / 8 + 0.1) goal = mc;
      if (b.dead) goal = 26;
      const wantDir = Math.abs(goal - px) < 0.12 ? 0 : Math.sign(goal - px);
      const pw = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, minX: 1, maxX: 31, pits: BOSSES.mimicBoss.pits };
      const pitAt = (x) => (x > 8.7 && x < 11.3) || (x > 20.7 && x < 23.3);
      if (!g) {
        const keep = st.plan ? st.plan.dir : wantDir;
        for (const dir of [keep, 0, 1, -1]) if (planSafe(pw, dir, false, projs, rects, 0.7)) { if (dir > 0) k.right = 1; if (dir < 0) k.left = 1; return false; }
        return false;
      }
      st.plan = null;
      // first choice: walk to the goal and stop there
      if (planSafe(pw, 0, false, projs, rects, 0.8, 15, false, goal)) { goX(L, k, goal, 0.12); return false; }
      const opts = [[0, true], [1, true], [-1, true], [1, false], [-1, false], [0, false], [0, true, true], [1, true, true]];
      for (const [dir, jump, hop] of opts) {
        const end = {};
        if (!planSafe(pw, dir, jump, projs, rects, 0.8, 15, hop, null, end)) continue;
        if (pitAt(end.x)) continue;
        if (dir > 0) k.right = 1; if (dir < 0) k.left = 1;
        if (jump) st.plan = { dir };
        return jump;
      }
      if (wantDir > 0) k.right = 1; if (wantDir < 0) k.left = 1;
      return false;
    },
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
    // 14 Gravity Split: flip to ceiling together, rush past gate, flip back down, jump spike
    (L, A, B, st) => {
      for (const P of [A, B]) { P.go(1); if (L.g > 0 && P.x > 24.4 && P.g) P.jumpOnce('sp'); }
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
    // 16 The See-Saw: jump onto platforms, hold both buttons to lift cage, then jump into door
    (L, A, B, st) => {
      const gate = L.blocks[4];
      if (!st.ph) {
        if (A.x > 8.5 && A.g) A.to(10.7); else { A.go(1); if (A.x > 6.8 && A.g) A.jumpOnce('up'); }
        if (B.x < 23.5 && B.g) B.to(21.3); else { B.go(-1); if (B.x < 25.2 && B.g) B.jumpOnce('up'); }
        if (L.buttons[0].down && L.buttons[1].down && A.y < 13 && B.y < 13 && A.g && B.g) st.ph = 1;
        return;
      }
      if (st.ph === 1) { A.to(10.7); B.to(21.3); if (gate.y < 3.0) st.ph = 2; return; }
      A.to(16); if (A.x > 11.6 && A.g) A.jumpOnce('sp');
      B.to(16); if (B.x < 20.1 && B.g) B.jumpOnce('sp');
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
    // 21 Laser Gate: A holds b1 -> B holds b2 -> A hits b3 (latch), both jump sp -> door
    (L, A, B, st) => {
      const l1 = L.lasers[0], l2 = L.lasers[1];
      if (!st.ph) { A.to(10.7); if (l1.y < 0) B.to(18.7); else B.to(12); if (near(B, 18.7) && L.buttons[1].down) st.ph = 1; return; }
      if (st.ph === 1) { B.to(18.7); if (l2.y < 0) A.to(26.7); else A.to(18.7); if (L.buttons[2].latched) st.ph = 2; return; }
      for (const P of [A, B]) { P.go(1); if (P.x > 26.8 && P.g) P.jumpOnce('sp', 10); }
    },
    // 22 Ladder Boost: A holds b1, B climbs ladder and latches b2, wakes door, both drop to (25, 15)
    (L, A, B, st) => {
      const hatch = L.blocks[3], d = L.doors[0];
      if (!st.ph) {
        A.to(7.7);
        if (hatch.x < 11.5) {
          if (B.y < 8.8) { B.go(1); if (B.x > 15.8 && B.g) st.ph = 1; }
          else if (Math.abs(B.x - 14.55) > 0.25) B.to(14.55);
          else B.jump(12);
        } else B.to(11);
        return;
      }
      if (st.ph === 1) { A.to(7.7); B.go(1); if (B.x > 16.3 && B.g) B.jumpOnce('sp'); if (L.buttons[1].latched) st.ph = 2; return; }
      if (st.ph === 2) {
        B.go(1); if (d.tween || d.x < 27) st.ph = 3;
        A.to(25); return;
      }
      if (B.y < 10 && B.x < 20.5 && B.x > 19.2 && B.g) B.jumpOnce('spb');
      if (B.y < 14 && B.x > 13.9 && B.x < 15.2) B.go(0); else if (B.y < 14) B.go(-1); else B.to(25.6);
      A.to(25.6);
    },
    // 23 Crate Relay: boost B onto shelf, bait mimic, push crate onto b1, both jump spike & crate to door
    (L, A, B, st) => {
      const crate = L.blocks.find((b) => b.crate && !b.mimic), mim = L.blocks.find((b) => b.mimic), b1 = L.buttons[0];
      if (!st.ph) { A.to(9.45); if (near(A, 9.45) && A.g) { B.go(-1); if (B.x < 11.6) B.jumpOnce('h'); if (B.p.onP) st.ph = 1; } else B.to(11.6); return; }
      if (st.ph === 1) { B.go(-1); B.jumpOnce('up'); if (B.y < 10.7 && B.g) st.ph = 2; return; }
      if (st.ph === 2) {
        A.to(13.5);
        if (!mim.gone) { if (!mim.armed) { if (B.to(8.6)) st.tap = 1; if (st.tap) B.go(-1); } else B.to(8.7); return; }
        if (!st.left) { if (B.g && B.x > crate.x && B.x < crate.x + 2.2) B.jumpOnce('ov'); B.to(2.0); if (near(B, 2.0)) st.left = 1; return; }
        if (crate.y < 14) B.go(1); else st.ph = 3;
        return;
      }
      if (st.ph === 3) {
        A.to(20);
        if (!b1.down || crate.x < 14.5) { if (B.y < 14) B.to(crate.x - 1.2); else if (B.x < crate.x) B.go(1); else B.to(crate.x - 0.8); }
        else if (B.x > crate.x - 1.2) B.to(crate.x - 1.4);
        else st.ph = 4;
        return;
      }
      for (const P of [A, B]) { P.go(1); if (P.x > crate.x - 1.5 && P.x < crate.x && P.g) P.jumpOnce('cr'); if (P.x > 25.0 && P.g) P.jumpOnce('sp'); }
    },
    // 24 Double Lift: wait for B to board lift1 before A holds b1, repeat for lift2, then exit
    (L, A, B, st) => {
      const l1 = L.blocks[5], l2 = L.blocks[6];
      const board = (P, lx, jx, nm) => { if (P.x < jx) P.go(1); else if (P.g && P.x < lx - 0.3) { P.go(1); P.jumpOnce(nm); } else P.to(lx); };
      if (!st.ph) { A.to(5.5); board(B, 8.5, 6.2, 'on1'); if (B.g && Math.abs(B.p.y + B.p.h - l1.y) < 0.05) st.ph = 1; return; }
      if (st.ph === 1) { A.to(3.7); if (l1.y < 10.2) { B.go(1); B.jumpOnce('off1'); } else B.to(8.5); if (B.g && B.y < 10 && B.x > 11.5) st.ph = 2; return; }
      if (st.ph === 2) {
        if (l1.y < 14.3 && !st.r1) { B.to(15.5); A.to(5.5); }
        else { st.r1 = 1; B.to(15.5); board(A, 8.5, 6.2, 'on1a'); }
        if (A.g && Math.abs(A.p.y + A.p.h - l1.y) < 0.05) st.ph = 3; return;
      }
      if (st.ph === 3) { B.to(12.9); if (l1.y < 10.2) { A.go(1); A.jumpOnce('off1a'); } else A.to(8.5); if (A.g && A.y < 10 && A.x > 11.5) st.ph = 4; return; }
      if (st.ph === 4) { A.to(13.5); board(B, 18.5, 16.2, 'on2'); if (B.g && Math.abs(B.p.y + B.p.h - l2.y) < 0.05) st.ph = 5; return; }
      if (st.ph === 5) { A.to(15.2); if (l2.y < 6.2) { B.go(1); B.jumpOnce('off2'); } else B.to(18.5); if (B.g && B.y < 6 && B.x > 21) st.ph = 6; return; }
      if (st.ph === 6) {
        if (!st.r2) { B.to(25.2); A.to(13.5); if (l2.y >= 9.38 && A.x > 13.2) st.r2 = 1; }
        else { if (A.x > 16.0) B.to(23.7); else B.to(25.2); board(A, 18.5, 16.2, 'on2a'); }
        if (A.g && Math.abs(A.p.y + A.p.h - l2.y) < 0.05) st.ph = 7; return;
      }
      if (st.ph === 7) { B.to(23.7); if (l2.y < 6.2) { A.go(1); A.jumpOnce('off2a'); } else A.to(18.5); if (A.g && A.y < 6 && A.x > 21) st.ph = 8; return; }
      for (const P of [A, B]) { P.go(1); if (P.x > 24.7 && P.g) P.jumpOnce('sp', 10); }
    },
    // 25 Speed Trap: time lasers at 2.5x while holding gate open, latch b2, jump end spike
    (L, A, B, st) => {
      const las1 = L.lasers[0], las2 = L.lasers[1], gate = L.blocks[4];
      if (!st.ph) { A.to(11.7); if (!near(B, 12.6, 0.3)) B.to(12.6); else if (off(las1, L) > 0.6 && gate.y < 0) st.ph = 1; else B.go(0); return; }
      if (st.ph === 1) { A.to(11.7); B.to(17.2); if (near(B, 17.2, 0.3) && Math.abs(B.p.vx) < 2) st.ph = 2; return; }
      if (st.ph === 2) { A.to(11.7); if (off(las2, L) > 0.6 || B.x > 18.8) { B.go(1); if (L.buttons[1].latched) st.ph = 3; } else B.to(17.2); return; }
      for (const P of [A, B]) {
        const next = P.x < 14 ? las1 : las2;
        if (P.x < 19 && P.x > next.x - 1.8 && P.x < next.x && off(next, L) < 0.6) P.go(0);
        else if (P.x > 30.8) P.go(-1);
        else { P.go(1); if (P.x > 24.5 && P.g) P.jumpOnce('sp', 10); }
      }
    },
    // 26 Mirror Twins: latch each other's gate, jump pop spike & pit into center door
    (L, A, B, st) => {
      if (!st.ph) { A.to(7.7); B.to(24.7); if (L.buttons[0].latched && L.buttons[1].latched) st.ph = 1; return; }
      A.go(1); if (A.x > 9.3 && A.g) A.jumpOnce('spA');
      B.go(-1); if (B.x < 22.7 && B.g) B.jumpOnce('spB');
    },
    // 27 Ceiling Walk: flip up together, jump ceiling spike, hit pad down, hold b1->b2, jump spike
    (L, A, B, st) => {
      const gate = L.blocks[2];
      if (L.g < 0 && !st.flipped) st.flipped = 1;
      if (L.g > 0 && st.flipped) {
        if (!st.ph) { A.to(19.7); if (gate.y < 0) B.go(1); else B.to(21); if (L.buttons[1].latched) st.ph = 1; return; }
        for (const P of [A, B]) { P.go(1); if (P.x > 26.2 && P.g) P.jumpOnce('sp', 10); }
        return;
      }
      for (const P of [A, B]) {
        if (L.g < 0 && !P.g && P.x < 10.6) P.go(0);
        else P.go(1);
        if (L.g < 0 && P.g && P.x > 10.1) P.jumpOnce('ceil');
      }
    },
    // 28 False Floor: cross br1 & br2 with buttons, survive swapPlaces, latch b3, jump spike
    (L, A, B, st) => {
      const br1 = L.blocks[3], br2 = L.blocks[4];
      if (!st.ph) { A.to(4.2); if (br1.y < 15.2) B.to(13.7); else B.to(5); if (L.buttons[1].down && near(B, 13.7)) st.ph = 1; return; }
      if (st.ph === 1) { B.to(13.7); if (A.x < 10.6) A.go(1); else if (A.x < 13 && A.g) { A.go(1); A.jumpOnce('sp1'); } else A.to(14.6); if (A.x > 14.3 && A.g) st.ph = 2; return; }
      if (st.ph === 2) {
        if (L.buttons[2].latched) { st.ph = 3; return; }
        const right = A.x > B.x ? A : B, left = right === A ? B : A;
        if (left.x < 16) left.to(13.7); else left.to(23.7);
        if (br2.y < 15.2) right.to(23.7); else right.to(15);
        return;
      }
      for (const P of [A, B]) {
        P.go(1);
        if (P.x > 10.6 && P.x < 12.2 && P.g) P.jumpOnce('sp1');
        if (P.x > 25.0 && P.g) P.jumpOnce('sp2');
      }
    },
    // 29 Crusher Tag: A holds b1, B runs c1 to b2, A crosses c1 to b2, B passes c2+laser+c3 to b3 (latch), both exit
    (L, A, B, st) => {
      const c1 = L.blocks[2], c2 = L.blocks[3], c3 = L.blocks[4], las = L.lasers[0];
      if (!st.ph) { A.to(5.7); if (c1.y < 7) B.to(13.0); else B.to(6.5); if (L.buttons[1].down && near(B, 13.0)) st.ph = 1; return; }
      if (st.ph === 1) { B.to(13.0); if (c1.y < 7) A.to(13.0); if (near(A, 13.0) && c3.y < 7 && off(las, L) > 0.45) st.ph = 2; return; }
      if (st.ph === 2) { A.to(13.0); B.go(1); if (L.buttons[2].latched) st.ph = 3; return; }
      for (const P of [A, B]) {
        if (P.x > 17.2 && P.x < 18.6 && off(las, L) < 0.45) P.go(0);
        else { P.go(1); if (P.x > 26.6 && P.g) P.jumpOnce('sp', 10); }
      }
    },
    // 30 Red Light Duo: only start jumps/moves when L.light === L.go with enough window left
    (L, A, B, st) => {
      const ok = L.light === L.go && L.lightEnds - L.t > 0.45;
      const canJump = L.light === L.go && L.lightEnds - L.t > 0.85;
      for (const P of [A, B]) {
        if (!P.g) { P.go(1); continue; }
        if (!ok) { P.go(0); continue; }
        if (!canJump && (P.x > 6.5 && P.x < 8.5 || P.x > 11.8 && P.x < 13.8 || P.x > 16.5 && P.x < 18.8 || P.x > 22.8 && P.x < 24.8)) { P.go(0); continue; }
        P.go(1);
        if (P.x > 7.4) P.jumpOnce('p1');
        if (P.x > 12.7) P.jumpOnce('s1');
        if (P.x > 17.7) P.jumpOnce('p2');
        if (P.x > 24.1) P.jumpOnce('s2');
      }
    },
    // 31 Swap Elevator: A waits near b1 until B boards lift, then holds b1; lift hits swapPlaces, etc.
    (L, A, B, st) => {
      const lift = L.blocks[3], d = L.doors[0];
      const board = (P, nm) => { if (P.x < 12.1) P.go(1); else if (P.g && P.y > 14 && P.x < 14.2) { P.go(1); P.jumpOnce(nm); } else P.to(14.5); };
      if (!st.ph) {
        if (A.x > 11) st.sw = 1;
        if (!st.sw) {
          if (B.p.ground === lift) st.riding = 1;
          if (!st.riding) { A.to(9.5); board(B, 'b1'); }
          else { A.to(6.7); B.to(14.5); }
        } else {
          B.to(6.7);
          if (lift.y < 7.2) { A.go(1); if (A.x > 16.5) A.jumpOnce('sp1'); } else A.to(14.5);
          if (A.g && A.y < 7.2 && A.x > 21.0) st.ph = 1;
        }
        return;
      }
      if (st.ph === 1) {
        if (lift.y <= 14.3 && !st.r) { A.to(20.6); B.to(9.5); }
        else { st.r = 1; A.to(20.6); board(B, 'b2'); if (B.g && Math.abs(B.p.y + B.p.h - lift.y) < 0.05) st.ph = 2; }
        return;
      }
      if (st.ph === 2) {
        A.to(21.7);
        if (lift.y < 7.2) { B.go(1); if (B.x > 16.5) B.jumpOnce('sp2'); } else B.to(14.5);
        if (B.g && B.y < 7.2 && B.x > 21.0) st.ph = 3;
        return;
      }
      for (const P of [A, B]) { if (d.tween || d.x < 25) P.to(24.1); else P.go(1); }
    },
    // 32 Mimic Gauntlet: A jumps over crate, baits both mimics, B pushes real crate onto b1, both exit
    (L, A, B, st) => {
      const c = L.blocks.find((b) => b.crate && !b.mimic), b1 = L.buttons[0];
      const m1 = L.blocks.filter((b) => b.mimic)[0], m2 = L.blocks.filter((b) => b.mimic)[1];
      if (!st.ph) {
        B.to(4);
        if (!m1.gone) { if (A.g && A.x > c.x - 1.4 && A.x < c.x) A.jumpOnce('ovc'); if (!m1.armed) A.go(1); else A.to(9.5); return; }
        if (!m2.gone) { if (!m2.armed) A.go(1); else A.to(15.5); return; }
        st.ph = 1; return;
      }
      if (st.ph === 1) {
        A.to(19.5);
        if (!b1.down || c.x < 21.5) { if (B.x < c.x) B.go(1); else B.to(c.x - 0.8); }
        else if (B.x > c.x - 1.2) B.to(c.x - 1.4);
        else if (L.blocks[4].y < 5) st.ph = 2;
        return;
      }
      for (const P of [A, B]) { P.go(1); if (P.x > c.x - 1.5 && P.x < c.x && P.g) P.jumpOnce('cr', 12); if (P.x > 23.1 && P.x < 24.4 && P.g) P.jumpOnce('sp'); }
    },
    // 33 Headstack Hotel: boost to tier 1 (latch b1) -> A climbs -> boost to tier 2 (latch b2) -> handle invert
    (L, A, B, st) => {
      const inv = L.invert ? -1 : 1, s1 = L.blocks[3], s2 = L.blocks[4];
      const move = (P, dir) => P.go(dir * inv);
      const goTo = (P, x) => { const dx = x - P.x; if (Math.abs(dx) < 0.15) { P.go(0); return true; } move(P, Math.sign(dx)); return false; };
      if (!st.ph) { A.to(9.4); if (near(A, 9.4) && A.g) { B.go(1); if (B.x > 7.8) B.jumpOnce('h1'); if (B.p.onP) st.ph = 1; } else B.to(7.6); return; }
      if (st.ph === 1) { B.go(1); B.jumpOnce('u1'); if (B.y < 11.2 && B.g && B.x > 10.5) st.ph = 2; return; }
      if (st.ph === 2) { B.to(13.7); if (A.y > 11.2) { if (!st.r1) { A.to(5.0); if (near(A, 5.0, 0.3)) st.r1 = 1; } else if (L.buttons[0].latched && s1.x >= 6.9) { A.go(1); if (A.x > 4.9 && A.g) A.jumpOnce('s1'); if (A.y < 12.6 && A.g && A.x > 7) A.jumpOnce('t1'); } } else if (A.g && A.x > 10.5) st.ph = 3; else A.go(1); return; }
      if (st.ph === 3) { A.to(17.4); if (near(A, 17.4) && A.g) { B.go(1); if (B.x > 15.8) B.jumpOnce('h2'); if (B.p.onP) st.ph = 4; } else B.to(15.6); return; }
      if (st.ph === 4) { B.go(1); B.jumpOnce('u2'); if (B.y < 7.4 && B.g && B.x > 18.5) st.ph = 5; return; }
      if (st.ph === 5) {
        goTo(B, 21.7);
        if (A.y > 7.4) { if (!st.r2) { A.to(13.0); if (near(A, 13.0, 0.3)) st.r2 = 1; } else if (L.buttons[1].latched && s2.x >= 14.9) { A.go(1); if (A.x > 12.9 && A.g) A.jumpOnce('s2'); if (A.y < 8.8 && A.g && A.x > 15) A.jumpOnce('t2'); } }
        else if (A.g && A.x > 18.5) st.ph = 6; else move(A, 1);
        return;
      }
      for (const P of [A, B]) { move(P, 1); if (P.x > 23.6 && P.x < 25 && P.g) P.jumpOnce('sp', 12); }
    },
    // 34 Lag Swap: jump early for 0.16s lag over each pit and pop spike
    (L, A, B, st) => {
      for (const P of [A, B]) {
        P.go(1);
        for (const [x, n] of [[3.8, 'p1'], [10.9, 's1'], [16.1, 'p2'], [23.5, 's2']]) if (P.x > x) P.jumpOnce(n);
      }
    },
    // 35 Split Lanes II: B holds b1 for A; A times laser, latches b2 for B, drops down; both jump spike
    (L, A, B, st) => {
      const las = L.lasers[0], g1 = L.blocks[3], g2 = L.blocks[4];
      if (!st.ph) { B.to(9.7); if (g1.y < 0.2) A.to(15.7); else A.to(11); if (L.buttons[1].latched && near(A, 15.7)) st.ph = 1; return; }
      if (st.ph === 1) {
        if (A.y < 10) { if (A.x > 18.2 && A.x < 19.8 && off(las, L) < 0.45) A.go(0); else A.go(1); }
        else A.go(1);
        if (g2.y > 14.5) B.go(1); else B.to(14.5);
        for (const P of [A, B]) if (P.y > 10 && P.x > 25.6 && P.g) P.jumpOnce('sp', 10);
      }
    },
    // 36 Bridge Collapse: A crosses bridge alone -> latches b1 -> B crosses bridge alone -> both enter
    (L, A, B, st) => {
      const las = L.lasers[0];
      if (!st.ph) {
        B.to(5.5);
        if (A.x > 11 && A.x < 12.8 && off(las, L) < 0.45) A.go(0); else A.go(1);
        if (A.x > 22.7) st.ph = 1; return;
      }
      if (st.ph === 1) {
        A.to(22.7);
        if (B.x > 11 && B.x < 12.8 && off(las, L) < 0.45) B.go(0); else B.go(1);
        if (B.x > 21 && B.g) st.ph = 2; return;
      }
      for (const P of [A, B]) { P.go(1); if (P.x > 26.2 && P.g) P.jumpOnce('sp', 10); }
    },
    // 37 Trapdoor Relay: B holds b1, A jumps crate & baits mimic, jumps back left, pushes crate through trapdoor onto b2
    (L, A, B, st) => {
      const mim = L.blocks.find((b) => b.mimic), crate = L.blocks.find((b) => b.crate && !b.mimic), b2 = L.buttons[1];
      if (!st.ph) {
        B.to(6.7);
        if (!mim.gone) {
          if (A.g && A.x > crate.x - 1.4 && A.x < crate.x) A.jumpOnce('ovc');
          if (!mim.armed) A.go(1); else A.to(7.5);
          return;
        }
        if (!st.left) { if (A.g && A.x > crate.x && A.x < crate.x + 1.8) A.jumpOnce('bk'); A.to(3.0); if (near(A, 3.0)) st.left = 1; return; }
        if (crate.y < 11) A.go(1); else st.ph = 1;
        return;
      }
      if (!b2.down) { B.to(6.7); A.to(13); return; }
      for (const P of [A, B]) { P.go(1); if (P.y > 11 && P.x > 11 && P.x < 13 && P.g) P.jumpOnce('cr'); if (P.y > 11 && P.x > 26.6 && P.g) P.jumpOnce('sp', 10); }
    },
    // 38 Fakeout Plaza: latch b1 & b2 (jumping fake door f1), climb ladder at x=8.5, enter center door upstairs
    (L, A, B, st) => {
      if (!st.ph) {
        A.to(4.7); B.to(24.7);
        if (B.x > 12.0 && B.x < 13.5 && B.g) B.jumpOnce('f1r');
        if (B.x > 17.5 && B.x < 19.0 && B.g) B.jumpOnce('spr');
        if (L.buttons[0].latched && L.buttons[1].latched) st.ph = 1;
        return;
      }
      for (const P of [A, B]) {
        if (P.y > 9.35 || (P.x < 9.8 && P.y > 8.85)) {
          if (P.x > 20.5 && P.x < 22 && P.g) P.jumpOnce('sp');
          if (P.x < 17.0 && P.x > 15.2 && P.g) P.jumpOnce('f1');
          if (P.x > 12.6 && P.x < 15.5) P.go(-1);
          else if (Math.abs(P.x - 9.05) > 0.2) P.to(9.05);
          else P.jump(12);
        } else if (P.x < 10.4) { P.go(1); P.jump(4); } else P.to(16.0);
      }
    },
    // 39 Twin Saws: jump first saw, A holds b1 -> B crosses & latches b2 -> A joins -> jump second saw & spike
    (L, A, B, st) => {
      const gate = L.blocks[2];
      for (const P of [A, B]) {
        if (P.x < 12.5) { P.go(1); if (P.x > 7.5 && P.g) P.jumpOnce('s1'); }
      }
      if (!st.ph) {
        if (A.x >= 12.5) A.to(14.2);
        if (B.x >= 12.5) { if (gate.y < 0) B.to(19.2); else B.to(14.8); }
        if (L.buttons[1].latched && A.x >= 12.5) st.ph = 1;
        return;
      }
      for (const P of [A, B]) {
        if (P.x < 19.2 && gate.y < 0) P.go(1);
        else if (P.x >= 19.0) { P.go(1); if (P.x < 20.5 && P.g) P.jumpOnce('s2'); if (P.x > 25.0 && P.g) P.jumpOnce('sp', 10); }
      }
    },
    // 40 Co-op Finale: boost B onto shelf, bait mimic, drop crate onto b1, ride lift, wait laser, jump spike
    (L, A, B, st) => {
      const mim = L.blocks.find((b) => b.mimic), c = L.blocks.find((b) => b.crate && !b.mimic), b1 = L.buttons[0];
      const lift = L.blocks[6], las = L.lasers[0];
      if (!st.ph) { A.to(7.5); if (near(A, 7.5) && A.g) { B.go(-1); if (B.x < 9.5) B.jumpOnce('h'); if (B.p.onP) st.ph = 1; } else B.to(9.5); return; }
      if (st.ph === 1) { B.go(-1); B.jumpOnce('up'); if (B.y < 11 && B.g) st.ph = 2; return; }
      if (st.ph === 2) {
        A.to(12.5);
        if (!mim.gone) { if (!mim.armed) B.go(1); else B.to(B.x < mim.x + 0.5 ? 3.8 : 6.6); return; }
        if (!st.left) { if (B.g && B.x > c.x && B.x < c.x + 2) B.jumpOnce('ov'); B.to(1.2); if (near(B, 1.2)) st.left = 1; return; }
        if (c.y < 14) B.go(1); else st.ph = 3; return;
      }
      if (st.ph === 3) {
        A.to(13.5);
        if (!b1.down || c.x < 10.5) { if (B.y < 14) B.to(c.x - 1.2); else if (B.x < c.x) B.go(1); else B.to(c.x - 0.8); }
        else if (B.x > c.x - 1.2) B.to(c.x - 1.4);
        else st.ph = 4;
        return;
      }
      for (const P of [A, B]) {
        if (P.p.ground === lift) { if (lift.y < 7.8) { P.go(1); P.jumpOnce('top'); } else P.to(18.5); }
        else if (P.y > 10 || P.x < 20.2) {
          if (P.x < 15.4) { P.go(1); if (P.x > c.x - 1.4 && P.x < c.x && P.g) P.jumpOnce('cr', 14); }
          else if (!P.g) P.to(lift.y < 8.5 ? 21.5 : 18.5);
          else if (lift.y >= 14.35) { P.go(1); if (P.x > 15.9 && !(st['c' + P.p.idx] > L.t)) { st['c' + P.p.idx] = L.t + 0.6; P.jump(30); } }
          else P.to(15.4);
        } else {
          if (P.x > 22.8 && P.x < 24.3 && off(las, L) < 0.45) P.go(0);
          else { P.go(1); if (P.x > 25.7 && P.g) P.jumpOnce('sp', 10); }
        }
      }
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
    // 18 The Chasm Swing: jump onto mid perch (11,12.2,3,1) together, then across chasm & over end spike
    (L, A, B, st) => {
      if (!st.ph) { A.to(5, 0.15); B.to(5, 0.15); if (near(A, 5, 0.2) && near(B, 5, 0.2) && A.g && B.g) st.ph = 1; return; }
      if (st.ph === 1) {
        pair(A, B, (P) => { P.go(P.x < 12.5 ? 1 : 0); if (P.x > 7.5 && P.g && P.y > 13) P.jumpOnce('p1'); });
        if (A.y < 12.2 && B.y < 12.2 && A.g && B.g) st.ph = 2; return;
      }
      if (st.ph === 2) {
        pair(A, B, (P) => { P.go(1); if (P.x > 13.5 && P.g && P.y < 12.5) P.jumpOnce('p2'); });
        if (A.x > 16.5 && B.x > 16.5 && A.g && B.g) st.ph = 3; return;
      }
      if (st.ph === 3) {
        A.to(23.5, 0.15); B.to(23.5, 0.15);
        if (near(A, 23.5, 0.25) && near(B, 23.5, 0.25) && A.g && B.g) st.ph = 4; return;
      }
      pair(A, B, (P) => { P.go(1); if (P.x > 25.1 && P.g) P.jumpOnce('sp'); });
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
    // 21 Tug of War: align, time all three lasers, jump end spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      const nxt = L.lasers.find((l) => l.x + 0.5 > Math.min(A.x, B.x));
      if (nxt && Math.max(A.x, B.x) > nxt.x - 1.5 && Math.min(A.x, B.x) < nxt.x && off(nxt, L) < 0.55) { A.go(0); B.go(0); return; }
      pair(A, B, (P) => { P.go(1); if (P.x > 25.5 && P.g) P.jumpOnce('sp', 10); });
    },
    // 22 Pendulum Pit: A anchors edge, B swings + chain-jumps onto mid, hauls A, repeat over pit 2
    (L, A, B, st) => {
      if (!st.ph) {
        A.to(6.6); B.go(1);
        if (B.x > 6.6 && B.g) B.jumpOnce('j1');
        if (B.x > 11.4 && B.p.hang > 0) B.jumpOnce('j2');
        if (B.x > 12.5 && B.g) st.ph = 1;
        return;
      }
      if (st.ph === 1) {
        B.to(15.5);
        if (B.x > 14.5) { A.go(1); if (A.x > 6.7 && A.g) A.jumpOnce('ja1'); } else A.to(6.6);
        if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
        if (A.x > 12.5 && A.g && B.g) st.ph = 2;
        return;
      }
      if (st.ph === 2) {
        A.to(17.6); B.go(1);
        if (B.x > 17.6 && B.g) B.jumpOnce('k1');
        if (B.x > 22.2 && B.p.hang > 0) B.jumpOnce('k2');
        if (B.x > 23.5 && B.g) st.ph = 3;
        return;
      }
      if (st.ph === 3) {
        B.to(26.5); A.go(1);
        if (A.x > 17.7 && A.g) A.jumpOnce('ka');
        if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
        if (A.x > 23.5 && A.g && B.g) st.ph = 4;
        return;
      }
      pair(A, B, (P) => { P.go(1); if (P.x > 25.5 && P.g) P.jumpOnce('sp', 10); });
    },
    // 23 Chain Ladder: jump spike, climb ladder 1 aligned, jump saw on floor 1, climb ladder 2, jump spike
    (L, A, B, st) => {
      if (!st.ph) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; if (!st.al) return; }
      if (!st.ph) {
        pair(A, B, (P) => { P.go(1); if (P.x > 12.2 && P.g) P.jumpOnce('s1'); });
        if (A.x > 25 && B.x > 25) st.ph = 1; return;
      }
      if (st.ph === 1) {
        const both = A.y <= 9.25 && B.y <= 9.25;
        let up = 0;
        for (const P of [A, B]) { if (!both && !st.go1) { if (Math.abs(P.x - 26.95) > 0.25) P.to(26.95); else P.jump(12); } else { st.go1 = 1; if (P.x > 25.2) { P.go(-1); if (P.x > 26.0) P.jump(4); } else up++; } }
        if (up === 2 && A.g && B.g) st.ph = 2; return;
      }
      if (st.ph === 2) {
        if (!st.al2) { A.to(24.5, 0.08); B.to(24.5, 0.08); if (near(A, 24.5, 0.15) && near(B, 24.5, 0.15)) st.al2 = 1; return; }
        if (Math.min(A.x, B.x) > 17.5 && !(L.saws[0].x > 13.8 && L.saws[0].x < 15.2 && Math.cos(L.t * 1.8) > 0.5) && !st.sgo) { A.to(18.5); B.to(18.5); return; }
        st.sgo = 1;
        pair(A, B, (P) => { P.go(-1); if (P.x < 17.4 && P.g) P.jumpOnce('saw'); });
        if (A.x < 4 && B.x < 4) st.ph = 3; return;
      }
      if (st.ph === 3) {
        const both = A.y <= 4.25 && B.y <= 4.25;
        let up = 0;
        for (const P of [A, B]) { if (!both && !st.go2) { if (Math.abs(P.x - 2.55) > 0.25) P.to(2.55); else P.jump(12); } else { st.go2 = 1; if (P.x < 4.5) { P.go(1); if (P.x < 3.4) P.jump(4); } else up++; } }
        if (up === 2 && A.g && B.g) st.ph = 4; return;
      }
      if (!st.al3) { A.to(5, 0.08); B.to(5, 0.08); if (near(A, 5, 0.15) && near(B, 5, 0.15)) st.al3 = 1; return; }
      pair(A, B, (P) => { P.go(1); if (P.x > 17.2 && P.g) P.jumpOnce('s2', 10); });
    },
    // 24 Anchor Drop: A anchors on 12.2, B drops onto b1 (latch), jumps left back onto 12.2, both jump pit together
    (L, A, B, st) => {
      const b1 = L.buttons[0], gate = L.blocks[4];
      if (!st.ph) { A.to(12.2); B.to(15.0); if (b1.latched && B.g) st.ph = 1; return; }
      if (st.ph === 1) {
        A.to(11.5);
        if (B.y > 9.5 && B.g) { B.go(-1); B.jumpOnce('up'); } else if (!B.g) B.go(-1);
        if (B.y < 9.5 && B.g && B.x < 12.6) st.ph = 2; return;
      }
      if (st.ph === 2) {
        if (!st.al) { A.to(11.5, 0.08); B.to(11.5, 0.08); if (near(A, 11.5, 0.12) && near(B, 11.5, 0.12) && A.g && B.g) st.al = 1; return; }
        pair(A, B, (P) => { P.go(1); if (P.x > 12.6 && P.g) P.jumpOnce('pit'); });
        if (A.x > 17.5 && B.x > 17.5 && A.g && B.g) st.ph = 3; return;
      }
      if (gate.y > 0) { A.to(20); B.to(20); return; }
      pair(A, B, (P) => { P.go(1); if (P.x > 24.5 && P.g) P.jumpOnce('sp', 10); });
    },
    // 25 Bungee Bounce: hit pad up aligned, jump ceiling gap together, hit pad down, jump spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      if (L.g < 0 && !st.al2 && A.x > 12 && B.x > 12 && A.g && B.g) { const a = A.to(13.5, 0.08), b = B.to(13.5, 0.08); if (a && b) st.al2 = 1; return; }
      pair(A, B, (P) => {
        P.go(1);
        if (L.g < 0 && st.al2 && P.g && P.x > 14.3 && P.x < 15.2) P.jumpOnce('cg');
        if (L.g > 0 && st.al2 && P.g && P.x > 24.8) P.jumpOnce('sp', 10);
      });
    },
    // 26 Speed Chain: align, time both 2.5x lasers, jump end spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      const nxt = L.lasers.find((l) => l.x + 0.5 > Math.min(A.x, B.x));
      if (nxt && Math.max(A.x, B.x) > nxt.x - 2.0 && Math.min(A.x, B.x) < nxt.x && off(nxt, L) < 0.55) { A.go(0); B.go(0); return; }
      pair(A, B, (P) => { P.go(1); if (P.x > 24.8 && P.g) P.jumpOnce('sp', 10); });
    },
    // 27 Snag Alley: align tightly (rope=1.4), jump all 5 spikes synchronously
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.06); B.to(4, 0.06); if (near(A, 4, 0.08) && near(B, 4, 0.08)) st.al = 1; return; }
      pair(A, B, (P) => P.go(1));
      const lead = Math.max(A.x, B.x);
      for (const [x, n] of [[6.6, 's1'], [11.6, 's2'], [16.6, 's3'], [21.6, 's4'], [25.6, 's5']]) {
        if (lead > x && A.g && B.g) { A.jumpOnce(n, 14); B.jumpOnce(n, 14); }
      }
    },
    // 28 Crate Tether: A jumps over mimic to bait, pulls back, both push crate onto b1, jump crate & spike
    (L, A, B, st) => {
      const mim = L.blocks.find((b) => b.mimic), c = L.blocks.find((b) => b.crate && !b.mimic), b1 = L.buttons[0];
      if (!st.ph) {
        if (!mim.gone) {
          if (!mim.armed) { A.go(1); B.to(4); } else { A.to(3.8); B.to(3.2); }
          return;
        }
        if (!b1.down || c.x < 16.8) { pair(A, B, (P) => P.go(1)); return; }
        st.ph = 1; return;
      }
      if (st.ph === 1) {
        const a = A.to(15.2, 0.1), b = B.to(15.2, 0.1);
        if (a && b && A.g && B.g) st.ph = 2;
        return;
      }
      pair(A, B, (P) => { P.go(1); if (P.x > c.x - 1.5 && P.x < c.x && P.g) P.jumpOnce('cr', 14); if (P.x > 24.5 && P.g) P.jumpOnce('sp', 10); });
    },
    // 29 Red Light Chain: align, freeze on wrong light, only start jumps with >0.9s green/red left
    (L, A, B, st) => {
      if (!st.al) {
        if (L.light !== L.go || L.lightEnds - L.t < 0.5) { A.go(0); B.go(0); return; }
        A.to(5, 0.08); B.to(5, 0.08); if (near(A, 5, 0.1) && near(B, 5, 0.1)) st.al = 1; return;
      }
      const ok = L.light === L.go && L.lightEnds - L.t > 0.45;
      const canJump = L.light === L.go && L.lightEnds - L.t > 0.9;
      for (const P of [A, B]) {
        if (!P.g) { P.go(1); continue; }
        if (!ok) { P.go(0); continue; }
        if (!canJump && (P.x > 7.8 && P.x < 9.8 || P.x > 17.8 && P.x < 19.8 || P.x > 23.8 && P.x < 25.8)) { P.go(0); continue; }
        P.go(1);
        if (P.x > 8.6) P.jumpOnce('p1');
        if (P.x > 18.6) P.jumpOnce('p2');
        if (P.x > 24.5) P.jumpOnce('s1');
      }
    },
    // 30 Elevator Snap: align, board ferry1 -> mid -> board ferry2 -> top deck -> door
    (L, A, B, st) => {
      const f1 = L.blocks[3], f2 = L.blocks[4];
      if (!st.ph) { A.to(4.8, 0.08); B.to(4.8, 0.08); if (near(A, 4.8, 0.1) && near(B, 4.8, 0.1) && f1.x <= 6.6) st.ph = 1; return; }
      if (st.ph === 1) {
        pair(A, B, (P) => { if (P.p.ground === f1) P.to(f1.x + 1.75); else if (!P.g) P.to(f1.x + 1.75); else { P.go(1); if (P.x > 5.0 && P.g) P.jumpOnce('f1', 12); } });
        if (f1.x >= 13.8 && A.p.ground === f1 && B.p.ground === f1) st.ph = 2; return;
      }
      if (st.ph === 2) { pair(A, B, (P) => { P.go(1); if (P.g && P.x > 16.5) P.jumpOnce('off1'); }); if (A.x > 18.5 && B.x > 18.5 && A.g && B.g) st.ph = 3; return; }
      if (st.ph === 3) {
        A.to(20.5, 0.08); B.to(20.5, 0.08);
        if (near(A, 20.5, 0.15) && near(B, 20.5, 0.15) && f2.y >= 14.3) st.ph = 4; return;
      }
      if (st.ph === 4) {
        pair(A, B, (P) => { if (P.p.ground === f2) P.to(24.2); else { P.go(1); if (P.x > 20.8 && P.g) P.jumpOnce('f2'); } });
        if (f2.y <= 7.6 && A.p.ground === f2 && B.p.ground === f2) st.ph = 5; return;
      }
      pair(A, B, (P) => { P.go(1); if (P.g && P.x > 24.5 && P.x < 26) P.jumpOnce('off2'); });
    },
    // 31 Crusher Chain: align, dash under each crusher right as it lifts, jump end spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      const cs = [L.blocks[2], L.blocks[3], L.blocks[4], L.blocks[5]];
      const nxt = cs.find((c) => c.x + c.w > Math.min(A.x, B.x));
      if (nxt && Math.max(A.x, B.x) > nxt.x - 1.3 && Math.min(A.x, B.x) < nxt.x + nxt.w && nxt.y > 7.5) { A.go(0); B.go(0); return; }
      pair(A, B, (P) => { P.go(1); if (P.x > 25.5 && P.g) P.jumpOnce('sp', 10); });
    },
    // 32 Double Invert: handle L.invert while jumping pits and spikes synchronously
    (L, A, B, st) => {
      const inv = L.invert ? -1 : 1;
      if (!st.al) { A.to(3.5, 0.03); B.to(3.5, 0.03); if (near(A, 3.5, 0.05) && near(B, 3.5, 0.05)) st.al = 1; return; }
      pair(A, B, (P) => P.go(inv));
      const lead = Math.max(A.x, B.x);
      for (const [x, n, h] of [[5.5, 'p1', 60], [10.8, 's1', 18], [15.5, 'p2', 60], [20.8, 's2', 18], [25.5, 'p3', 60]]) {
        if (lead > x && A.g && B.g) { A.jumpOnce(n, h); B.jumpOnce(n, h); }
      }
    },
    // 33 Head Haul: boost B to ledge 1, haul A, boost B to ledge 2, haul A, jump fake & pop spike to door
    (L, A, B, st) => {
      if (!st.ph) { A.to(9.4); if (near(A, 9.4) && A.g) { B.go(1); if (B.x > 7.8) B.jumpOnce('h1'); if (B.p.onP) st.ph = 1; } else B.to(7.6); return; }
      if (st.ph === 1) { B.go(1); B.jumpOnce('u1'); if (B.y < 11.2 && B.g && B.x > 10.5) st.ph = 2; return; }
      if (st.ph === 2) {
        B.to(14.5); if (A.y > 11.2) A.go(1); else A.to(11);
        if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
        if (A.y < 11.2 && A.g && A.x > 10.5) st.ph = 3; return;
      }
      if (st.ph === 3) { A.to(17.4); if (near(A, 17.4) && A.g) { B.go(1); if (B.x > 15.8) B.jumpOnce('h2'); if (B.p.onP) st.ph = 4; } else B.to(15.6); return; }
      if (st.ph === 4) { B.go(1); B.jumpOnce('u2'); if (B.y < 7.4 && B.g && B.x > 18.5) st.ph = 5; return; }
      if (st.ph === 5) {
        B.to(21.2); if (A.y > 7.4) A.go(1); else A.to(18.8);
        if (!A.g && A.p.hang > 0 && !(L.t < st.cool)) { A.jump(); st.cool = L.t + 0.3; }
        if (A.y < 7.4 && A.g && A.x > 18.5) st.ph = 6; return;
      }
      pair(A, B, (P) => { P.go(1); if (P.x > 21.4 && P.x < 22.8 && P.g) P.jumpOnce('fk', 14); if (P.x > 25.0 && P.g) P.jumpOnce('sp', 10); });
    },
    // 34 Glass Chain: jump onto hidden glass steps aligned, then jump end spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4.2, 0.08); B.to(4.2, 0.08); if (near(A, 4.2, 0.1) && near(B, 4.2, 0.1)) st.al = 1; return; }
      pair(A, B, (P) => P.go(1));
      const lead = Math.max(A.x, B.x);
      for (const [x, n, h] of [[4.8, 'g1', 60], [9.5, 'g2', 60], [15.0, 'g3', 24], [20.5, 'g4', 24], [25.6, 'sp', 10]]) {
        if (lead > x && A.g && B.g) { A.jumpOnce(n, h); B.jumpOnce(n, h); }
      }
    },
    // 35 Gravity Zigzag: align, flip up -> jump ceiling spike -> pad down -> jump floor spike -> flip up -> ceiling spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      if (L.g < 0 && (!A.g || !B.g) && Math.max(A.x, B.x) < 8.5) { A.go(0); B.go(0); return; }
      if (L.g > 0 && (!A.g || !B.g) && Math.min(A.x, B.x) > 15.5 && Math.max(A.x, B.x) < 18.2) { A.go(0); B.go(0); return; }
      if (L.g < 0 && (!A.g || !B.g) && Math.min(A.x, B.x) > 23.0 && Math.max(A.x, B.x) < 25.0) { A.go(0); B.go(0); return; }
      pair(A, B, (P) => {
        P.go(1);
        if (L.g < 0 && P.g && P.x > 9.4 && P.x < 10.6) P.jumpOnce('c1');
        if (L.g > 0 && P.g && P.x > 18.6 && P.x < 19.6) P.jumpOnce('f1');
        if (L.g < 0 && P.g && P.x > 25.0) P.jumpOnce('c2');
      });
    },
    // 36 Saw Sandwich II: align, jump onto perch (13.5..18.5, y=12.2), wait for saws to pass, drop & jump spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      if (!st.ph) {
        pair(A, B, (P) => { P.go(1); if (P.x > 11.4 && P.g) P.jumpOnce('up'); });
        if (A.y < 12.2 && B.y < 12.2 && A.g && B.g) st.ph = 1; return;
      }
      if (st.ph === 1) { A.to(16); B.to(16); if (L.saws[0].x > 33 && L.saws[1].x < 12) st.ph = 2; return; }
      pair(A, B, (P) => { P.go(1); if (P.y > 13 && P.x > 23.6 && P.g) P.jumpOnce('sp'); });
    },
    // 37 Lag Tether: align slightly offset so B doesn't land on A's head, queue full jumps 1.44 tiles early
    (L, A, B, st) => {
      if (!st.al) { A.to(3.0, 0.08); B.to(3.8, 0.08); if (near(A, 3.0, 0.1) && near(B, 3.8, 0.1)) st.al = 1; return; }
      pair(A, B, (P) => {
        P.go(1);
        for (const [x, n] of [[5.3, 'c1'], [12.8, 's1'], [18.3, 'c2'], [25.8, 's2']]) if (P.x > x) P.jumpOnce(n);
      });
    },
    // 38 Flip Chase: align, sprint across islands over chasing saw, jump pop spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      pair(A, B, (P) => P.go(1));
      const lead = Math.max(A.x, B.x);
      for (const [x, n, h] of [[8.0, 'p1', 60], [16.0, 'p2', 60], [20.6, 's1', 8], [24.0, 'p3', 60]]) {
        if (lead > x && A.g && B.g) { A.jumpOnce(n, h); B.jumpOnce(n, h); }
      }
    },
    // 39 Rising Tether: align, zigzag 3 tiers over spikes, wait laser on tier 3, jump end spike
    (L, A, B, st) => {
      if (!st.al) { A.to(4, 0.08); B.to(4, 0.08); if (near(A, 4, 0.1) && near(B, 4, 0.1)) st.al = 1; return; }
      if (!st.ph) {
        pair(A, B, (P) => { P.go(1); if (P.x > 12.6 && P.g) P.jumpOnce('s1'); if (P.x > 25.8 && P.g) P.jumpOnce('st1'); });
        if (A.y < 13 && B.y < 13 && A.g && B.g) st.ph = 1; return;
      }
      if (st.ph === 1) {
        pair(A, B, (P) => { P.go(-1); if (P.y > 11.5 && P.x < 28.5 && P.g) P.jumpOnce('t2'); if (P.y < 10 && P.x < 18.0 && P.g) P.jumpOnce('s2'); if (P.y < 10 && P.x < 4.8 && P.g) P.jumpOnce('st2'); });
        if (A.y < 7.5 && B.y < 7.5 && A.g && B.g) st.ph = 2; return;
      }
      const las = L.lasers[1];
      if (Math.max(A.x, B.x) > 16.5 && Math.min(A.x, B.x) < 18.3 && off(las, L) < 0.55) { A.go(0); B.go(0); return; }
      pair(A, B, (P) => { P.go(1); if (P.y > 6 && P.x > 2.2 && P.g) P.jumpOnce('t3'); if (P.y < 5 && P.x > 22.5 && P.g) P.jumpOnce('s3', 10); });
    },
    // 40 Bound Forever: time laser, flip up -> ceiling spike -> pad down -> crumble -> climb hidden steps to top door
    (L, A, B, st) => {
      if (!st.al) { A.to(3.8, 0.08); B.to(3.8, 0.08); if (near(A, 3.8, 0.1) && near(B, 3.8, 0.1)) st.al = 1; return; }
      if (!st.ph) {
        const las = L.lasers[0];
        if (Math.max(A.x, B.x) > 4.2 && Math.min(A.x, B.x) < 5.6 && off(las, L) < 0.55) { A.go(0); B.go(0); return; }
        pair(A, B, (P) => {
          if ((L.g < 0 && !P.g && P.x < 11.4) || (L.g > 0 && !P.g && P.x > 15.5 && P.x < 17.5)) P.go(0);
          else P.go(1);
          if (L.g < 0 && P.g && P.x > 11.0 && P.x < 12.2) P.jumpOnce('cs');
        });
        if (L.g > 0 && A.x > 22.8 && B.x > 22.8 && A.g && B.g) st.ph = 1;
        return;
      }
      if (st.ph === 1) { A.to(23.8, 0.08); B.to(23.8, 0.08); if (near(A, 23.8, 0.12) && near(B, 23.8, 0.12) && A.g && B.g) st.ph = 2; return; }
      if (st.ph === 2) {
        pair(A, B, (P) => { P.go(P.x < 26.0 ? 1 : 0); if (P.g) P.jumpOnce('h1'); });
        if (A.y < 12.5 && B.y < 12.5 && A.g && B.g) st.ph = 3; return;
      }
      if (st.ph === 3) {
        pair(A, B, (P) => { P.go(P.x < 28.3 ? 1 : 0); if (P.g) P.jumpOnce('h2'); });
        if (A.y < 10.0 && B.y < 10.0 && A.g && B.g) st.ph = 4; return;
      }
      pair(A, B, (P) => { P.go(1); if (P.y > 7.5 && P.g) P.jumpOnce('h3'); });
    },
  ];

  const out = [];
  const runSingle = (i) => {
    R.load(i, 'single');
    const k = R.keys; let st = {}, deaths = 0;
    for (let n = 0; n < 120 * 600; n++) {   // bosses take minutes (intros and retries included)
      const L = R.game.level;
      // a boss is played like a player would: lose a run (5 lives), and go again from phase 1 (a new seed), up to 8 runs
      if (L.over && L.bosses.length && ++deaths < 8) { R.game.restart(); st = {}; continue; }
      if (L.over) return `DEAD at px=${L.px.toFixed(2)} py=${L.py.toFixed(2)}`;
      if (L.won) return `won t=${L.t.toFixed(2)}${deaths ? ` after ${deaths} lost runs` : ''}`;
      k.left = 0; k.right = 0;
      const j = SINGLE[i](L, k, st);
      k.left = !!k.left; k.right = !!k.right;
      if (L.invert && L.bosses.length) [k.left, k.right] = [k.right, k.left];   // a boss's WRONG WAY hex: the bots know
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
  for (const i of [27, 36]) {
    if (!want('single', i)) continue;
    R.save.levelDeaths[String(i)] = 1;
    out.push(`[single] ${i + 1} ${names('single')[i].name} (after a death): ${runSingle(i)}`);
    delete R.save.levelDeaths[String(i)];
  }
  MULTI.forEach((pol, i) => want('multi', i) && out.push(`[multi] ${i + 1} ${names('multi')[i].name}: ${runDuo('multi', i, pol)}`));
  SPECIAL.forEach((pol, i) => want('special', i) && out.push(`[special] ${i + 1} ${names('special')[i].name}: ${runDuo('special', i, pol)}`));

  // ---- edge cases: every level loads clean, spawns safe, survives idling, restarts, and its fakes don't throw
  const bad = [], snap = JSON.stringify([R.save.deaths, R.save.levelDeaths, R.save.shame]);
  const chk = (tag, cond, why) => { if (!cond) bad.push(`${tag}: ${why}`); };
  let n = 0;
  for (const mode of ['single', 'multi', 'special']) {
    const course = window.LEVELS[mode], pols = { single: SINGLE, multi: MULTI, special: SPECIAL }[mode];
    if (!onlyCourse && !onlyLevel) {
      chk(mode, pols.length === course.length, `${pols.length} policies for ${course.length} levels`);
      chk(mode, new Set(course.map((l) => l.name)).size === course.length, 'duplicate level names');
    }
    course.forEach((def, i) => {
      if (!want(mode, i)) return;
      const tag = `${mode} ${i + 1} ${def.name}`; n++;
      try {
        R.load(i, mode);
        let L = R.game.level;
        for (const p of L.players) {
          chk(tag, p.x >= 0 && p.x + p.w <= 32 && p.y >= 0 && p.y + p.h <= 18, `spawn out of bounds (${p.x}, ${p.y})`);
          chk(tag, !L.blocks.some((b) => b.solid && !b.gone && !b.hidden && b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y), 'spawns inside a block');
        }
        if (mode === 'special') chk(tag, Math.hypot(L.players[0].x - L.players[1].x, L.players[0].y - L.players[1].y) <= L.rope + 0.01, 'spawns beyond chain length');
        for (let f = 0; f < 60; f++) L.step(R.STEP);
        chk(tag, !L.over && !L.won, 'dies or wins in 0.5 s of standing still');
        L.kill(); R.load(i, mode); L = R.game.level;
        chk(tag, L.t === 0 && !L.over && !L.won && L.players.every((p) => !p.dead), 'restart is not clean');
        for (const d of L.doors.filter((x) => x.fake)) {
          R.load(i, mode); L = R.game.level;
          const p = L.players[0]; p.x = d.x + 0.3; p.y = d.y + d.h - p.h - 0.05; p.vx = p.vy = 0;
          for (let f = 0; f < 180; f++) L.step(R.STEP);   // a throw here is caught below
        }
      } catch (e) { bad.push(`${tag}: threw ${e.message}`); }
    });
  }
  // ---- gamepad support check: deadzone, 1P/2P movement+jump, menus, and clean disconnect
  if (!onlyCourse && !onlyLevel) {
    const origNav = Object.getOwnPropertyDescriptor(window, 'navigator');
    let fakePads = [];
    const mkPad = (btns = [], axes = [0, 0]) => ({ buttons: Array.from({ length: 16 }, (_, j) => ({ pressed: btns.includes(j), value: btns.includes(j) ? 1 : 0 })), axes });
    const setPads = (arr) => { fakePads = arr; R.pollPads(); };
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : {};
      const origGet = nav.getGamepads;
      Object.defineProperty(nav, 'getGamepads', { configurable: true, value: () => fakePads });
      if (typeof navigator === 'undefined') window.navigator = nav;
      R.load(0, 'single');
      setPads([mkPad([], [0.2, 0])]);                                    // inside deadzone
      chk('gamepad', !R.ctl[0].left && !R.ctl[0].right, 'deadzone failed');
      setPads([mkPad([0], [0.8, 0])]);                                   // P1 right + jump
      chk('gamepad', R.ctl[0].right && R.ctl[0].jump && R.pressedAll[0].has('jump'), '1P stick/jump failed');
      R.load(0, 'multi');
      setPads([mkPad([], [-0.8, 0]), mkPad([0], [0.8, 0])]);             // P1 left, P2 right + jump
      chk('gamepad', R.ctl[0].left && R.ctl[1].right && R.ctl[1].jump && R.pressedAll[1].has('jump'), '2P dual controllers failed');
      setPads([mkPad([9])]);                                             // Start -> level select
      chk('gamepad', R.game.state === 'select', 'Start pause/select failed');
      setPads([mkPad([1])]);                                             // B -> mode select
      chk('gamepad', R.game.state === 'mode', 'B back failed');
      setPads([]);                                                       // disconnect clears held inputs
      chk('gamepad', !R.ctl[0].left && !R.ctl[0].right && !R.ctl[1].right && !R.ctl[1].jump, 'disconnect cleanup failed');
      if (origGet) Object.defineProperty(nav, 'getGamepads', { configurable: true, value: origGet });
      else delete nav.getGamepads;
    } catch (e) { bad.push(`gamepad: threw ${e.message}`); }
    if (origNav) Object.defineProperty(window, 'navigator', origNav);
  }
  // ---- knights (profiles) keep separate saves; death messages name the right trap
  if (!onlyCourse && !onlyLevel) {
    try {
      const k = R.knights, home = k.cur, n0 = k.list.length, d0 = R.save.deaths;
      R.addKnight('TEST');
      const id = k.cur;
      chk('knights', id !== home && R.save.deaths === 0 && k.list.length === n0 + 1, 'new knight did not start fresh');
      R.load(0, 'single'); R.game.level.kill(); R.load(0, 'single');
      chk('knights', R.save.deaths === 1, 'death not counted on the new knight');
      R.useKnight(home);
      chk('knights', R.save.deaths === d0 && k.cur === home, 'switching back lost the old save');
      chk('knights', R.deleteKnight(id) && k.list.length === n0 && !localStorage.getItem('ragebait.save.v1:' + id), 'delete left the knight behind');
      // rename: keyboard types on the name screen, touch goes through prompt(); both must end the same
      const oldName = k.list.find((q) => q.id === home).name, oldPrompt = window.prompt;
      window.prompt = () => 'sir test!';
      R.game.state = 'knights'; R.game.kId = home; R.key('KeyE');
      if (R.game.state === 'name') { R.game.name = 'sir test!'; R.key('Enter'); }
      window.prompt = oldPrompt;
      chk('knights', k.list.find((q) => q.id === home).name === 'SIR TEST' && k.cur === home && R.game.state === 'knights', 'rename failed');
      k.list.find((q) => q.id === home).name = oldName;
      // bosses: 5 lives; a hit costs one (and blinks), the last one ends the run, and a new run starts at phase 1
      // with 5 lives again; the death count (the seed) only moves when a run ends. 6 hits in phases of 2; every
      // attack hitbox has its own death line; the intro plays once per knight
      for (const i of [9, 19, 29, 39]) {
        R.load(i, 'single'); let L = R.game.level, b = L.bosses[0];
        chk('boss', b && b.phase === 1 && b.hp === 6 && b.perPhase === 2, `level ${i + 1}: no boss at phase 1 with 6 hp`);
        chk('boss', !L.cine, `level ${i + 1}: the intro played again for a knight who has seen it`);
        chk('boss', L.lives === 5, `level ${i + 1}: started with ${L.lives} lives`);
        b.hidden = false; L.hitBoss(b); b.inv = 0; b.hidden = false; L.hitBoss(b);
        chk('boss', b.phase === 2 && b.hp === 4, `level ${i + 1}: two hits should start phase 2 (phase ${b.phase}, hp ${b.hp})`);
        const d0 = L.deaths;
        L.kill(L.player, 'boss', b);
        chk('boss', !L.over && L.lives === 4 && L.player.hurtT > 0 && L.deaths === d0, `level ${i + 1}: a hit should cost one life (lives ${L.lives}, over ${L.over})`);
        L.kill(L.player, 'boss', b);
        chk('boss', L.lives === 4, `level ${i + 1}: a hit while blinking cost a life`);
        L.player.hurtT = 0; L.lives = 1; L.kill(L.player, 'boss', b);
        chk('boss', L.over && L.kind === b.id && L.deaths === d0 + 1, `level ${i + 1}: the last life should end the run (over ${L.over}, kind ${L.kind})`);
        R.game.restart(); L = R.game.level; b = L.bosses[0];
        chk('boss', b.phase === 1 && b.hp === 6 && L.lives === 5, `level ${i + 1}: a new run should start at phase 1 with 5 lives (phase ${b.phase}, lives ${L.lives})`);
        chk('boss', L.pickups.length === 0 && L.blocks.some((k) => !k.solid) && L.blocks.some((k) => k.crumble), `level ${i + 1}: no fake or crumbling platform`);
      }
      // pickups: a heart adds a life (up to 9), a fake one bites, the sword parries one hit, boots speed you up
      { R.load(0, 'single'); const L = R.game.level, p = L.player; L.lives = 5;   // level 1: no boss, so no pickups of its own
        const take = (type, fake) => { const k = L.pickup(type, p.x + 0.4, p.y + 0.45, { fake }); L.checkContacts(p); return k; };
        take('heart'); chk('pickup', L.lives === 6, `a heart gave ${L.lives} lives`);
        take('heart', 'bite'); chk('pickup', L.lives === 5 && !L.over, `a fake heart left ${L.lives} lives`);
        p.hurtT = 0; take('sword'); chk('pickup', p.parry, 'the sword did not arm a parry');
        L.kill(p, 'spikes', null); chk('pickup', L.lives === 5 && !p.parry, `a parry still cost a life (${L.lives})`);
        take('boots'); for (let n = 0; n < 20; n++) L.step(R.STEP); chk('pickup', L.speedMul > 1, 'boots did not speed you up');
        for (let n = 0; n < 120 * 6; n++) L.step(R.STEP);
        chk('pickup', L.speedMul === 1, 'the speed boost never wore off');
        for (let n = 0; n < 120 * 8; n++) L.pickup('heart', 99, 99, { life: 1 }) && L.step(R.STEP);
        chk('pickup', L.pickups.length < 200, 'pickups with a life never faded'); }
      for (const k of Object.keys(window.BOSSES.lines)) chk('boss', window.BOSSES.lines[k].length > 0, `no death lines for ${k}`);
      // a first visit plays the intro; jump skips it after half a second, and the fight starts
      { const seen = R.save.seen; R.save.seen = {};
        R.load(9, 'single'); const L = R.game.level, b = L.bosses[0];
        chk('cine', !!L.cine && b.state === 'wait', 'the Warden intro did not play on a first visit');
        L.kill(); chk('cine', !L.over, 'a knight died during a cutscene');
        R.step(70); R.pressed.add('jump'); R.step(2);
        chk('cine', !L.cine && b.state !== 'wait' && R.save.seen.warden, 'skipping the intro did not start the fight');
        R.save.seen = seen; }
      // quick-time events: the right keys in order win, a wrong key fails, mashing escapes
      { R.load(0, 'single'); const L = R.game.level; let res = null;
        L.startQte({ keys: ['left', 'jump', 'right'], time: 1, onWin: () => (res = 'win'), onFail: () => (res = 'fail') });
        R.keys.left = true; R.step(1); R.keys.left = false; R.pressed.add('jump'); R.step(1); R.keys.right = true; R.step(1); R.keys.right = false;
        chk('qte', res === 'win' && !L.qte, `a correct sequence gave ${res}`);
        res = null; L.startQte({ keys: ['left', 'right'], time: 1, onWin: () => (res = 'win'), onFail: () => (res = 'fail') });
        R.keys.right = true; R.step(1); R.keys.right = false;
        chk('qte', res === 'fail', `a wrong key gave ${res}`);
        res = null; L.startQte({ mash: 4, time: 1, onWin: () => (res = 'win'), onFail: () => (res = 'fail') });
        for (let n = 0; n < 4; n++) { R.pressed.add('jump'); R.step(1); }
        chk('qte', res === 'win', `mashing gave ${res}`);
        res = null; L.startQte({ mash: 4, time: 0.2, onWin: () => (res = 'win'), onFail: () => (res = 'fail') });
        R.step(30);
        chk('qte', res === 'fail', `running out of time gave ${res}`); }
      // title buttons: PLAY / SETTINGS / LEADERBOARD / EXIT
      const G = R.game, calm0 = R.save.calm;
      G.state = 'title'; G.tSel = 0; R.key('Enter');
      chk('title', G.state === 'mode', 'PLAY did not open the mode screen');
      G.state = 'title'; R.key('ArrowRight'); R.key('Enter');
      chk('title', G.state === 'settings', 'SETTINGS did not open');
      R.key('ArrowDown'); R.key('Enter');
      chk('title', R.save.calm === !calm0, 'flashing toggle failed');
      R.key('Enter'); R.key('Escape');
      chk('title', R.save.calm === calm0 && G.state === 'title', 'settings back failed');
      R.key('ArrowRight'); R.key('Enter');
      chk('title', G.state === 'knights' && G.kBack === 'title', 'LEADERBOARD did not open');
      R.key('Escape'); R.key('ArrowRight'); R.key('Enter');
      chk('title', G.state === 'title' && G.exitT === G.time, 'EXIT did not respond');
      G.exitT = -9;
      R.load(32, 'single'); let L = R.game.level;   // Lv 33: fake floors over spikes
      const fb = L.blocks.find((b) => !b.solid && !b.hidden && !b.ghost), p = L.players[0];
      p.x = fb.x + fb.w / 2 - 0.4; p.y = fb.y - p.h - 0.3; p.vx = p.vy = 0;
      for (let f = 0; f < 600 && !L.over; f++) L.step(R.STEP);
      chk('knights', L.kind === 'fakeFloor', `fake floor death read as ${L.kind}`);
      R.load(0, 'single'); L = R.game.level; L.kill();
      chk('knights', L.kind === 'restart' && /R|self|over/.test(R.game.message.text), 'restart message wrong');
    } catch (e) { bad.push(`knights: threw ${e.message}`); }
  }
  const s0 = JSON.parse(snap); R.save.deaths = s0[0]; R.save.levelDeaths = s0[1]; R.save.shame = s0[2];   // kill() above counted deaths
  out.push(bad.length ? bad.map((b) => `[edge] ${b}`).join('\n') : `[edge] ${n} levels load, spawn safe, idle, restart, fake doors: won`);
  return out;
};

// no browser needed: load the game files into a stubbed DOM
function inVm() {
  const noop = () => {}, store = {};
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop: noop, width: 50 }) });
  const el = () => ({ style: {}, hidden: false, addEventListener: noop, querySelectorAll: () => [], getContext: () => ctx, classList: { add: noop, remove: noop }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
  const sb = {
    console, Math, Date, Set, Map, Array, Object, String, Number, Boolean, JSON, performance: { now: () => 0 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false }), document: { getElementById: el }, location: { reload: noop },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
  sb.window = sb; vm.createContext(sb);
  for (const f of ['levels.js', 'bosses.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), sb, { filename: f });
  return vm.runInContext('(' + run.toString() + ')', sb)([onlyCourse, onlyLevel]);
}

(async () => {
  let res, errs = [], pw;
  try { pw = require('playwright'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  if (pw) {
    const b = await pw.chromium.launch();
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('file://' + path.join(root, 'index.html'));
    await page.waitForTimeout(300);
    res = await page.evaluate(run, [onlyCourse, onlyLevel]);
    await b.close();
  } else {
    try { res = inVm(); } catch (e) { res = []; errs.push(e.stack); }
  }
  console.log(res.join('\n'));
  console.log('errors:', errs);
  const failed = res.filter((r) => !/: won/.test(r)).length + errs.length;
  console.log(failed ? `FAILED: ${failed}` : `OK: ${res.length} checks`);
  process.exit(failed ? 1 : 0);
})();
