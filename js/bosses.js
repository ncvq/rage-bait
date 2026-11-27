/*
 * The four area bosses: single-player levels 10, 20, 30 and 40 (js/levels.js just calls BOSSES.<id>.build).
 *
 * Each boss is { build(L), draw(b, L, t, D), lit?(b, L, t, D) }. build makes the arena, the boss, its moves and
 * its intro and defeat cutscenes; draw paints it with D, the drawing kit from game.js (r = art pixels from the
 * origin D.at() sets, R = screen units). Art faces left; facing right mirrors it.
 *
 * You can't attack. Every boss is beaten by dodging one of its own attacks so that it hurts itself, which stuns
 * it; touching it then starts the STRIKE quick-time event. 6 hits, in 3 phases of 2; a phase is a checkpoint.
 * Grabs start a BREAK FREE mash (fail = death). Each attempt is seeded from the death count: it moves
 * differently every time, but never with Math.random, so the test bot can be run against any attempt.
 */
(function () {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  const overlapR = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const KEYS = ['left', 'right', 'jump'];
  const PACE = 0.4;   // every idle gap between moves is cut to this: the bosses keep you dodging
  const B = { lines: {}, killers: {} };

  // the per-fight toolkit: a seeded random source, the knight's position, attack hitboxes, phase-scaled numbers
  function kit(L, b, area) {
    const R = rng(9973 * (area + 1) + 7919 * L.deaths + 104729 * L.checkpoint);
    const K = {
      R,
      chance: (p) => R() < p,
      range: (a, z) => a + R() * (z - a),
      pick: (a) => a[Math.floor(R() * a.length)],
      weighted(list) {   // [[weight, value], ...]
        let sum = 0;
        for (const [w] of list) sum += Math.max(0, w);
        let x = R() * sum;
        for (const [w, v] of list) { if (w <= 0) continue; x -= w; if (x <= 0) return v; }
        return list[list.length - 1][1];
      },
      px: () => L.player.x + L.player.w / 2,
      py: () => L.player.y + L.player.h / 2,
      hz: (o) => L.hit({ boss: b, ...o }),
      by: (a, z, c) => [a, a, z, c][b.phase],   // a value for phase 1, 2, 3
      set(state, extra) { b.state = state; b.st = 0; b.atk = null; if (extra) Object.assign(b, extra); },
      tick(dt) { for (const h of L.hz) if (h.boss === b && h.step) h.step(h, dt); },
      // a stunned or hit boss drops whatever it had cast (body parts and the given kinds stay)
      clear(...keep) { for (const h of L.hz) if (h.boss === b && h.atk && !keep.includes(h.atk)) h.gone = true; },
      once: {},
      cue(t, at, fn) { if (t >= at && !K.once[at]) { K.once[at] = 1; fn(); } },
    };
    return K;
  }
  // STRIKE: a sequence of 3 / 4 / 5 keys (by phase); a hit if it's all pressed in time, in order
  function strike(L, b, K, label, onFail) {
    const n = K.by(3, 4, 5), keys = [];
    while (keys.length < n) {
      const k = K.pick(KEYS);
      if (keys.length >= 2 && k === keys[keys.length - 1] && k === keys[keys.length - 2]) continue;
      keys.push(k);
    }
    K.set('struck'); b.stun = 0;
    L.startQte({ keys, time: K.by(1.7, 1.6, 1.6), label,
      onWin() { b.safeUntil = L.t + 0.6; L.hitBoss(b, null); },
      onFail() { b.safeUntil = L.t + 0.5; onFail(); } });
  }
  // BREAK FREE: mash jump, or die
  function grab(L, b, K, atk, onEscape) {
    L.startQte({ mash: K.by(7, 8, 10), time: 1.45, label: 'BREAK FREE!', slow: 0.3,
      onWin() { b.safeUntil = L.t + 0.6; onEscape(); },
      onFail() { L.kill(L.player, 'boss', { boss: b, atk }); } });
  }
  // the intro plays on a knight's first visit only; later attempts open straight into the fight
  function opening(L, b, scene, fight) {
    L.atStart(() => {
      if (L.firstVisit(b.id)) L.playCine(scene, () => { L.markSeen(b.id); fight(true); });
      else fight(false);
    });
  }
  // a knight walking in from the left edge during a cutscene
  function walkIn(L, t, x1, dur) {
    const p = L.player, k = clamp(t / dur, 0, 1);
    p.x = lerp(-1.2, x1, ease(k)); p.vx = k < 1 ? 5 : 0; p.face = 1; p.grounded = true;
  }
  function lines(id, name, pools) {
    for (const k in pools) { B.lines[k] = pools[k][1]; B.killers[k] = pools[k][0] || name; }
  }

  // ===================================================================================== THE WARDEN
  // Upper Halls. A giant suit of armour with a halberd, and it never moves the same way twice.
  // STOMP: a ripple of floor spikes (jump it). SWEEP: the halberd at knee height (jump). CHARGE: it runs to the
  // wall and can't stop: get over it (or onto a scaffold) and it rams the wall and is dazed.
  // Phase 2: LEAP (it lands where its shadow is) and GRAB (mash). Phase 3: the halberd thrown like a boomerang
  // (jump it going out, stay down coming back), and masonry falling from the ceiling, which dazes it too.
  lines('warden', 'Warden', {
    warden: ['', ['the Warden stepped on you.', 'you walked into a wall of armour.', 'too close. it is all edges.']],
    'warden:stomp': ["Warden's stomp", ['jump the stomp. every time.', 'the floor grew teeth again.', 'it stomped. you stood there.']],
    'warden:charge': ["Warden's charge", ['it does not stop for knights.', 'charged flat. jump it or get above it.', 'you were in the lane.']],
    'warden:thrust': ['halberd', ['it can reach the scaffolds.', 'skewered from below.', 'step off before it stabs up.']],
    'warden:sweep': ['halberd', ['the halberd took your legs.', 'swept off your feet.', 'jump the sweep, not into it.']],
    'warden:leap': ["Warden's slam", ['watch the shadow. it lands there.', 'squashed from a great height.', 'you stood where it was landing.']],
    'warden:throw': ['flying halberd', ['jump it going out. stay down coming back.', 'the halberd came back. they do that.']],
    'warden:grab': ['gauntlet', ['crushed in a gauntlet. mash faster.', 'it squeezed. you did not mash.']],
    'warden:debris': ['falling masonry', ['the ceiling is falling. read the dust.', 'masonry. on your head.']],
  });
  B.warden = {
    build(L) {
      L.spawn(3.2, 15);
      L.block(0, 15, 32, 3); L.block(0, 0, 32, 2);
      L.block(0, 2, 1, 13); L.block(31, 2, 1, 13);
      L.block(1, 12, 3.2, 0.35); L.block(27.8, 12, 3.2, 0.35);   // ledges by the walls: the Warden fits under them
      const floor = [];
      for (let x = 1; x < 31; x++) floor.push(L.spike(x, 15, 1, 'up', { hidden: true }));
      const b = L.boss({ id: 'warden', name: 'THE WARDEN', x: 22.5, y: 12.4, w: 2.2, h: 2.6, hp: 6, perPhase: 2,
        state: 'wait', st: 0, stun: 0, hasHalberd: true, debrisIn: 2.5, pose: null });
      const K = kit(L, b, 0), FY = 15 - b.h;
      const wc = () => b.x + b.w / 2;

      function stomp(cx, radius) {
        L.sound('thud'); L.shake(0.25, 0.35);
        L.fx(cx, 14.8, '#8a8494', 10, 5);
        for (const s of floor) {
          const d = Math.abs(s.x + 0.5 - cx);
          if (d < b.w / 2 + 0.2 || d > radius) continue;
          s.boss = b; s.atk = 'stomp';
          L.wait(d * 0.03, () => { s.pop(); L.wait(0.35, () => s.hide()); });
        }
      }
      function daze(sec) { K.set('dazed'); b.stun = sec; L.sound('thud'); K.clear('throw'); }
      function idle(lo, hi) { K.set('idle'); b.idleFor = K.range(lo, hi) * PACE; }
      function debris() {
        const x = clamp(K.px() - 0.9 + K.range(-2.6, 2.6), 1.2, 29);
        K.hz({ atk: 'debris', x, y: 2, w: 1.8, h: 1, live: false, warn: 0.75, vy: 0,
          step(h, dt) {
            if (h.warn > 0) { h.warn -= dt; return; }
            h.live = true; h.vy = Math.min(h.vy + 70 * dt, 34); h.y += h.vy * dt;
            if (overlapR(h, b) && !['dazed', 'struck', 'wait'].includes(b.state)) {
              h.gone = true; L.fx(h.x + 0.9, h.y + 0.5, '#8a8494', 18, 7); daze(K.by(1.8, 1.6, 1.5)); return;
            }
            if (h.y + h.h >= 15) { h.gone = true; L.fx(h.x + 0.9, 14.6, '#8a8494', 14, 6); L.sound('thud'); L.shake(0.12, 0.2); }
          } });
      }
      function choose() {
        const d = Math.abs(K.px() - wc()), high = L.player.y + L.player.h < 12.8;
        b.face = Math.sign(K.px() - wc()) || b.face;
        const p = b.phase, rubble = L.hz.some((h) => h.atk === 'debris');   // no stomp, charge or leap under falling masonry
        const pick = K.weighted([
          [d < 1.9 && p >= 2 ? 3 : 0, 'grab'],
          [b.hasHalberd && d < 4.6 && !high ? 3 : 0, 'sweep'],
          [b.hasHalberd && d < 3 && high ? 4 : 0, 'thrust'],
          [rubble ? 0 : d < 10 ? 2.2 : 0.8, 'stomp'],
          [rubble ? 0 : d > 3 ? (high ? 1.2 : 2.6) : 0.5, 'charge'],
          [p >= 2 && !rubble ? (high ? 3 : 1.8) : 0, 'leap'],
          [p >= 3 && b.hasHalberd ? 1.8 : 0, 'throw'],
          [0.9, 'walk'], [0.3, 'hop'], [0.4, 'feint'],
        ]);
        if (pick === 'walk') { K.set('walk'); b.walkDir = K.chance(0.9) ? b.face : -b.face; b.walkFor = K.range(0.2, 0.7); }
        else if (pick === 'hop') { K.set('hop'); b.hopDir = -b.face; }
        else if (pick === 'feint') { K.set('feint'); b.tellFor = K.range(0.22, 0.42); b.feintAs = K.pick(['stompTell', 'chargeTell']); }
        else K.set(pick + 'Tell', { tellFor: { stomp: K.by(0.55, 0.46, 0.38), sweep: K.by(0.45, 0.38, 0.32), charge: K.by(0.6, 0.5, 0.42),
          leap: K.by(0.45, 0.38, 0.32), throw: 0.5, grab: K.by(0.34, 0.3, 0.26), thrust: K.by(0.5, 0.42, 0.36) }[pick] });
      }

      b.update = (b, dt) => {
        if (L.qte) return;
        b.st += dt;
        K.tick(dt);
        if (b.stun > 0) { b.stun -= dt; if (b.stun <= 0 && b.state === 'dazed') idle(0.1, 0.2); }
        // phase 3: masonry falls, but only between its big attacks (never on top of a charge or a leap)
        if (b.phase >= 3 && ['idle', 'walk', 'hop', 'recover', 'dazed'].includes(b.state)) { b.debrisIn -= dt; if (b.debrisIn <= 0) { debris(); b.debrisIn = K.range(2.0, 3.2); } }
        switch (b.state) {
          case 'wait': case 'dazed': case 'struck': return;
          case 'idle': if (b.st >= b.idleFor) choose(); return;
          case 'roar': if (b.st >= 1.1) idle(0.1, 0.3); return;
          case 'walk':
            b.face = b.walkDir; b.x = clamp(b.x + b.walkDir * K.by(3.4, 4.4, 5.4) * dt, 1, 31 - b.w);
            if (K.chance(dt * 0.5)) b.walkDir = -b.walkDir;   // it changes its mind
            if (b.st >= b.walkFor) idle(0.05, K.by(0.55, 0.4, 0.28));
            return;
          case 'hop': {
            const k = Math.min(1, b.st / 0.32);
            b.x = clamp(b.x + b.hopDir * 9 * dt, 1, 31 - b.w); b.y = FY - Math.sin(k * Math.PI) * 1.2;
            if (k >= 1) { b.y = FY; idle(0.05, 0.2); }
            return;
          }
          case 'feint': if (b.st >= b.tellFor) idle(0.05, 0.2); return;
          case 'recover': if (b.st >= b.recoverFor) idle(0.05, 0.3); return;
          case 'hurt':
            b.x = clamp(b.x + b.hurtDir * 7 * dt, 1, 31 - b.w);
            if (b.st >= 0.4) idle(0.2, 0.4);
            return;
          case 'stompTell': if (b.st >= b.tellFor) { stomp(wc(), K.by(8, 9, 10)); K.set('recover', { recoverFor: 0.35 }); } return;
          case 'sweepTell':
            if (b.st >= b.tellFor) {
              K.set('sweep');
              b.sweep = K.hz({ atk: 'sweep', x: b.face > 0 ? b.x + b.w : b.x - 3.4, y: 13.9, w: 3.4, h: 1 });
              L.sound('jump');
            }
            return;
          case 'thrustTell':   // it steps under you, then stabs straight up
            b.x = clamp(b.x + clamp(K.px() - wc(), -6 * dt, 6 * dt), 1, 31 - b.w);
            if (b.st >= b.tellFor) { K.set('thrust'); b.sweep = K.hz({ atk: 'thrust', x: wc() - 0.6, y: b.y - 3.4, w: 1.2, h: 3.4 }); L.sound('jump'); }
            return;
          case 'thrust':
            if (b.st >= 0.25) { b.sweep.gone = true; K.set('recover', { recoverFor: K.by(0.45, 0.35, 0.28) }); }
            return;
          case 'sweep':
            b.sweep.x = b.face > 0 ? b.x + b.w : b.x - 3.4;
            if (b.st >= 0.22) { b.sweep.gone = true; K.set('recover', { recoverFor: K.by(0.4, 0.3, 0.22) }); }
            return;
          case 'chargeTell':
            if (b.st < 0.1) b.face = Math.sign(K.px() - wc()) || b.face;
            if (b.st >= b.tellFor) { K.set('charge'); b.atk = 'charge'; }
            return;
          case 'charge':
            b.atk = 'charge';
            b.x += b.face * K.by(13, 15, 17) * dt;
            if (K.chance(dt * 30)) L.fx(wc() - b.face, 14.8, '#8a8494', 2, 3);
            if (b.x <= 1 || b.x >= 31 - b.w) {
              b.x = clamp(b.x, 1, 31 - b.w); L.shake(0.45, 0.7);
              L.fx(b.face > 0 ? 31 : 1, 12, '#8a8494', 24, 8);
              daze(K.by(2.5, 2.2, 1.9));   // long enough to run back across the hall and strike
            }
            return;
          case 'leapTell':
            if (b.st >= b.tellFor) { K.set('leap', { leapX0: b.x, leapTo: clamp(K.px() - b.w / 2, 1, 31 - b.w) }); b.atk = 'leap'; L.sound('jump'); }
            return;
          case 'leap': {
            const k = Math.min(1, b.st / 0.85);
            b.atk = 'leap';
            b.x = lerp(b.leapX0, b.leapTo, k); b.y = FY - Math.sin(k * Math.PI) * 6;
            if (k >= 1) { b.y = FY; L.shake(0.4, 0.55); stomp(wc(), 3.5); K.set('recover', { recoverFor: K.by(0.5, 0.4, 0.3) }); }
            return;
          }
          case 'grabTell':
            if (b.st >= b.tellFor) {
              const reach = { x: b.face > 0 ? b.x + b.w : b.x - 1.5, y: b.y + 0.3, w: 1.5, h: 2.3 }, p = L.player;
              if (!overlapR(p, reach)) { K.set('recover', { recoverFor: 0.45 }); return; }
              K.set('grab');
              p.x = reach.x + reach.w / 2 - p.w / 2; p.y = b.y + 0.5; p.vx = p.vy = 0;
              grab(L, b, K, 'grab', () => {
                p.vy = -15 * L.g; p.vx = -b.face * 9; p.grounded = false;
                K.set('recover', { recoverFor: 0.7 });
              });
            }
            return;
          case 'throwTell':
            if (b.st >= b.tellFor) {
              b.hasHalberd = false; K.set('throwing'); L.sound('jump');
              K.hz({ atk: 'throw', x: wc() + b.face * 1.4, y: 14.35, r: 0.55, vx: b.face * 13, out: true, rot: 0,
                step(h, dt) {
                  h.x += h.vx * dt; h.rot += dt * 20;
                  if (h.out && (h.x < 1.7 || h.x > 30.3)) { h.out = false; h.y = 12.9; L.sound('click'); }
                  if (!h.out) {
                    const tx = wc();
                    h.vx = Math.sign(tx - h.x) * 13;
                    if (Math.abs(tx - h.x) < 0.5) { h.gone = true; b.hasHalberd = true; if (b.state === 'throwing') K.set('recover', { recoverFor: 0.25 }); }
                  }
                } });
            }
            return;
          case 'throwing': {
            const dir = Math.sign(K.px() - wc());
            b.face = dir || b.face; b.x = clamp(b.x + dir * 1.6 * dt, 1, 31 - b.w);
            return;
          }
          default: return;
        }
      };
      // dazed: touch it to strike. Fumble the keys and it catches your blade, and sweeps at once
      b.onTouch = (b) => {
        if (L.t < (b.safeUntil || 0)) return true;
        if (b.state !== 'dazed') return false;
        strike(L, b, K, 'STRIKE!', () => {
          b.face = Math.sign(K.px() - wc()) || b.face;
          K.set('sweepTell', { tellFor: 0.26 }); L.say('it caught your blade');
        });
        return true;
      };
      b.onHit = () => {
        const p = L.player, dir = Math.sign(wc() - K.px()) || 1;
        K.set('hurt', { hurtDir: dir }); p.vx = -dir * 7; p.vy = -11 * L.g; p.grounded = false;
      };
      b.onPhase = () => {
        K.set('roar'); b.inv = 1.3; L.sound('trap'); L.shake(0.6, 0.6);
        const p = L.player, d = K.px() - wc();
        if (Math.abs(d) < 6) { p.vx = Math.sign(d) * 11; p.vy = -8 * L.g; p.grounded = false; }
        if (b.phase === 3) { b.debrisIn = 1.4; L.say('the ceiling is coming down'); }
      };
      b.onDefeat = () => L.playCine(outro(), () => { L.killBoss(b); L.win(); });

      // ---- cutscenes. Parts of the armour are drawn at offsets (art pixels) from where they sit when whole.
      const PILE = { legs: [12, 0], body: [2, 11], arms: [-8, 13], pauldrons: [6, 22], helmet: [-16, 26], halberd: [40, 8] };
      function intro() {
        const order = [['legs', 2.4], ['body', 2.7], ['arms', 3.0], ['pauldrons', 3.25], ['helmet', 3.55]];
        return {
          dur: 7.2,
          update(t) {
            walkIn(L, t, 3.2, 1.3);
            b.face = -1; b.pose = { visor: t > 4.4 ? (t < 4.9 ? '#ffe27a' : null) : 'off', off: {} };
            for (const [part, at] of order) {
              const k = ease((t - at) / 0.4), [px, py] = PILE[part];
              b.pose.off[part] = [lerp(px, 0, k), lerp(py, 0, k) - Math.sin(k * Math.PI) * 14];
              b.pose.rattle = t > 1.6 && t < 2.4;
              K.cue(t, at + 0.4, () => { L.sound('click'); L.fx(b.x + 1.1, 13.5, '#8a8494', 6, 4); });
            }
            const hk = ease((t - 4.6) / 0.3);
            b.pose.off.halberd = [lerp(PILE.halberd[0], 0, hk), lerp(PILE.halberd[1], 0, hk) - Math.sin(hk * Math.PI) * 10];
            K.cue(t, 1.7, () => L.sound('trap'));
            K.cue(t, 5.0, () => { L.sound('thud'); L.shake(0.5, 0.6); L.fx(b.x + 1.1, 14.8, '#8a8494', 30, 9); });
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 0.4, 2.2, 'The upper halls. Empty, they said.');
            ui.caption(t, 2.3, 4.3, '...');
            if (t > 5.2) ui.label('THE WARDEN', t - 5.2);
            ui.caption(t, 5.5, 7.1, 'keeper of the upper halls');
          },
          end() { b.pose = null; const p = L.player; p.x = 3.2; p.vx = 0; },
        };
      }
      function outro() {
        K.once = {};   // the intro's cues are spent
        const scatter = { legs: [4, 0], body: [-6, 11], arms: [10, 13], pauldrons: [-12, 22], halberd: [18, 37] };
        b.face = Math.sign(K.px() - wc()) || -1;
        const flip = b.face > 0, ox = (flip ? b.x + b.w : b.x) * 30, p = L.player;
        const target = p.x < b.x ? (p.x + p.w + 0.2) * 30 : (p.x - 0.2) * 30 - 26;   // the helmet's left edge, by your feet
        const roll = flip ? (ox - target) / 2 - 23 : (target - ox) / 2 - 10;
        b.pose = { visor: null, off: {} }; b.atk = null; K.set('dying');
        return {
          dur: 6.6,
          update(t) {
            b.pose.visor = t < 2.4 ? 'flicker' : t < 4.2 ? 'off' : t < 4.5 ? '#6a4a20' : 'off';
            const kneel = ease(t / 0.8) * 5;
            for (const part of ['legs', 'body', 'arms', 'pauldrons', 'halberd']) {
              const at = { halberd: 1.0, arms: 1.5, pauldrons: 1.9, body: 2.4, legs: 2.6 }[part], k = ease((t - at) / 0.5), [sx, sy] = scatter[part];
              b.pose.off[part] = [lerp(0, sx, k), lerp(part === 'legs' ? 0 : kneel, sy, k) - Math.sin(k * Math.PI) * 8];
              K.cue(t, at, () => L.sound('click'));
            }
            const hk = ease((t - 1.2) / 1.6);
            b.pose.off.helmet = [lerp(0, roll, hk), lerp(kneel, 26, Math.min(1, hk * 2)) - Math.sin(Math.min(1, hk * 2) * Math.PI) * 12];
            b.pose.roll = hk > 0 && hk < 1 ? Math.floor(t * 10) % 2 : 0;
            K.cue(t, 0.05, () => { L.sound('trap'); L.shake(0.5, 0.7); });
            K.cue(t, 2.6, () => { L.sound('thud'); L.fx(b.x + 1.1, 14.6, '#8a8494', 26, 8); });
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 3.0, 4.6, 'The armour was empty. It always was.');
            if (t > 4.8) ui.label('THE WARDEN', t - 4.8);
            ui.caption(t, 5.0, 6.6, 'scrapped');
          },
        };
      }
      opening(L, b, intro(), (watched) => {
        b.pose = null;
        if (watched) idle(0.3, 0.5); else { K.set('roar'); L.sound('trap'); }
      });
    },

    // ---- art: 33 x 39 art pixels, facing left (the halberd side is the front)
    draw(b, L, t, D) {
      const flip = b.face > 0, pose = b.pose || {}, st = b.state === 'feint' ? b.feintAs : b.state;
      const off = {};
      for (const k in pose.off || {}) off[k] = [pose.off[k][0], pose.off[k][1] - (pose.rattle && !D.calm ? Math.floor(t * 20 + k.length) % 2 : 0)];
      const o = '#0c080c', steel = '#8a8494', hi = '#c8c4d0', dk = '#5a5462', belt = '#3a3040', wood = '#6b4a2b';
      for (const h of L.hz) if (h.boss === b) drawWardenHz(h, b, t, D);
      if (st === 'leap') D.R((b.leapTo) * 30, 15 * 30 - 6, b.w * 30, 6, 'rgba(10,8,12,0.55)');   // where it will land
      const bob = st === 'idle' || st === 'wait' ? Math.floor(t * 2) % 2 : 0;
      const walk = st === 'walk' || st === 'charge' || st === 'throwing' ? Math.floor(t * (st === 'charge' ? 16 : 8)) % 2 : 0;
      const crouch = st === 'leapTell' ? 4 : 0, lean = st === 'chargeTell' || st === 'charge' ? -2 : st === 'stompTell' ? 1 : 0;
      const dazed = st === 'dazed' || st === 'struck';
      const visor = pose.visor === 'flicker' ? (D.calm || Math.floor(t * 6) % 2 ? '#6a4a20' : '#ffe27a') : pose.visor ? pose.visor
        : dazed ? '#6a4a20' : st === 'chargeTell' || st === 'roar' || st === 'charge' ? '#ffe27a' : D.C.portal;
      const halberd = st === 'sweep' || st === 'thrust' || st === 'throwing' || !b.hasHalberd ? 'none'
        : st === 'sweepTell' || st === 'throwTell' ? 'raised' : st === 'thrustTell' ? 'up' : 'held';
      const P = (part) => off[part] || [0, 0];
      D.at(flip ? b.x + b.w : b.x, b.y, () => {
        const r = D.r;
        // back arm
        { const [x, y] = P('arms'); r(24 + x + lean, 15 + y + bob + crouch, 7, 11, o); r(25 + x + lean, 16 + y + bob + crouch, 5, 9, dk); }
        // legs
        { const [x, y] = P('legs');
          const lift = [st === 'stompTell' ? 8 : walk * 3, st === 'leap' ? 4 : (1 - walk) * (st === 'walk' || st === 'charge' ? 3 : 0)];
          if (st === 'leap') lift[0] = 4;
          for (const [i, lx] of [[0, 8], [1, 18]]) {
            const y0 = 25 + y - lift[i] + (crouch ? 2 : 0);
            r(lx - 1 + x, y0, 8, 14 - (crouch ? 2 : 0), o); r(lx + x, y0 + 1, 6, 11 - (crouch ? 2 : 0), dk); r(lx + x, y0 + 1, 6, 3, steel); r(lx + 1 + x, y0 + 5, 4, 2, hi);
            r(lx - 2 + x, 36 + y - lift[i], 9, 3, o); r(lx - 1 + x, 36 + y - lift[i], 7, 2, steel);
          }
        }
        // cuirass
        { const [x, y] = P('body'), yy = 11 + y + bob + crouch, xx = 5 + x + lean;
          r(xx, yy, 23, 17, o); r(xx + 1, yy + 1, 21, 15, steel); r(xx + 2, yy + 2, 3, 11, hi); r(xx + 11, yy + 3, 1, 8, dk);
          r(xx + 4, yy + 8, 15, 1, dk); r(xx + 1, yy + 11, 21, 3, belt); r(xx + 9, yy + 11, 4, 3, '#ffd23f'); }
        // front arm (down, reaching for a grab, or raised with the halberd)
        { const [x, y] = P('arms'), yy = 15 + y + bob + crouch, xx = 2 + x + lean;
          if (st === 'grabTell' || st === 'grab') { r(xx - 16, yy + 1, 18, 6, o); r(xx - 15, yy + 2, 16, 4, steel); r(xx - 20, yy - 2, 7, 11, o); r(xx - 19, yy - 1, 5, 9, hi); }
          else if (halberd === 'raised') { r(xx, yy - 12, 6, 14, o); r(xx + 1, yy - 11, 4, 12, steel); }
          else { r(xx, yy, 6, 11, o); r(xx + 1, yy + 1, 4, 9, steel); r(xx - 1, yy + 9, 7, 5, o); r(xx, yy + 10, 5, 3, hi); } }
        // pauldrons
        { const [x, y] = P('pauldrons'), yy = 9 + y + bob + crouch, xx = x + lean;
          r(xx + 1, yy, 11, 8, o); r(xx + 2, yy + 1, 9, 6, hi); r(xx + 2, yy + 5, 9, 1, dk);
          r(xx + 21, yy, 11, 8, o); r(xx + 22, yy + 1, 9, 6, steel); }
        // helmet: a great helm with a burning visor slit and a red crest
        if (!b.headless) { const [x, y] = P('helmet'), yy = (dazed ? 2 : 0) + y + bob + crouch + (st === 'chargeTell' ? 2 : st === 'roar' ? -2 : 0), xx = 10 + x + lean + (dazed ? 2 : 0) + (pose.roll || 0);
          r(xx, yy + 1, 13, 12, o); r(xx + 1, yy + 2, 11, 10, steel); r(xx + 1, yy + 2, 11, 2, hi);
          if (visor !== 'off') r(xx + 2, yy + 6, 9, 2, visor); else r(xx + 2, yy + 6, 9, 2, o);
          r(xx + 3, yy + 9, 1, 1, o); r(xx + 5, yy + 9, 1, 1, o); r(xx + 7, yy + 9, 1, 1, o);
          r(xx + 5, yy - 1, 3, 2, '#c83a4a');
          if (dazed && !D.calm) for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; r(Math.round(xx + 6 + Math.cos(a) * 9), Math.round(yy - 3 + Math.sin(a) * 2), 2, 2, '#ffe27a'); }
          else if (dazed) for (let i = 0; i < 3; i++) r(xx + i * 6, yy - 4, 2, 2, '#ffe27a'); }
        // halberd: held upright at the front edge, or raised behind for a sweep / throw
        { const [x, y] = P('halberd');
          if (halberd === 'held') {
            r(x, 2 + y, 2, 37, o); r(x, 2 + y, 1, 37, wood);
            r(x - 1, 4 + y, 7, 8, o); r(x, 5 + y, 5, 6, hi); r(x, 0 + y, 2, 4, hi);
          } else if (halberd === 'up') {   // gripped low, the blade pointing at the scaffolds
            r(14, -6, 2, 32, o); r(14, -6, 1, 32, wood); r(12, -12, 6, 7, o); r(13, -11, 4, 5, hi);
          } else if (halberd === 'raised') { r(4, 1, 29, 3, o); r(5, 2, 27, 1, wood); r(27, -3, 6, 10, o); r(28, -2, 4, 8, hi); }
        }
      }, flip);
    },
  };
  // the Warden's attacks: the swept halberd, the thrown one, masonry and its dust
  function drawWardenHz(h, b, t, D) {
    const r = D.r, o = '#0c080c';
    if (h.atk === 'thrust') {   // the halberd stabbing straight up, exactly the hitbox
      D.at(h.x, h.y, () => { const hh = Math.round(h.h * 15); r(8, 8, 2, hh - 8, o); r(8, 8, 1, hh - 8, '#6b4a2b'); r(4, 0, 10, 10, o); r(5, 1, 8, 8, '#c8c4d0'); r(8, -3, 2, 4, '#c8c4d0'); }, false);
    } else if (h.atk === 'sweep') {   // the halberd swung flat at knee height, exactly the hitbox
      D.at(h.x, h.y, () => { const w = Math.round(h.w * 15), y = 6; r(0, y, w, 3, o); r(0, y + 1, w, 1, '#6b4a2b'); const bx = b.face > 0 ? w - 7 : 0; r(bx, 0, 7, 15, o); r(bx + 1, 1, 5, 13, '#c8c4d0'); }, false);
    } else if (h.atk === 'throw') {   // a spinning halberd: a stepped pole, the blade at one end
      const a = Math.round(h.rot / (Math.PI / 4)) * (Math.PI / 4), cx = D.sn(h.x * 30), cy = D.sn(h.y * 30);
      for (let i = -7; i <= 7; i++) D.R(cx + Math.round(Math.cos(a) * i) * 2 - 1, cy + Math.round(Math.sin(a) * i) * 2 - 1, 4, 4, i > 4 ? '#c8c4d0' : '#6b4a2b');
      D.R(cx + Math.round(Math.cos(a) * 7) * 2 - 4, cy + Math.round(Math.sin(a) * 7) * 2 - 4, 8, 8, '#c8c4d0');
    } else if (h.atk === 'debris') {
      if (!h.live) {   // dust trickling from the ceiling, its shadow on the floor
        const x = h.x * 30, k = 1 - h.warn / 0.75;
        D.R(x, 15 * 30 - 6, h.w * 30, 6, `rgba(10,8,12,${0.25 + 0.45 * k})`);
        for (let i = 0; i < 4; i++) D.R(x + 6 + i * 13, 2 * 30 + ((t * 120 + i * 37) % (k * 200 + 20)), 2, 4, '#8a8494');
        return;
      }
      D.at(h.x, h.y, () => { r(0, 0, 27, 15, o); r(1, 1, 25, 13, '#6d6578'); r(1, 1, 25, 3, '#8a8494'); r(9, 4, 1, 10, o); r(18, 1, 1, 7, o); }, false);
    }
  }

  // ================================================================================== THE UNDERTAKER
  // Crypt. A lich in the dark: it drifts, blinks out and back in somewhere else (its eyes show first). It is a
  // ghost: you pass through it; only what it throws and swings can kill you.
  // SKULLS bounce along the floor (jump them). BONES: the floor cracks under you, then spikes (move).
  // SOUL ORB: it rolls after you. Touch it and you die; land on it from above and it shoots back into the lich,
  // which drops, stunned. Phase 2: GRAVE HANDS (mash) and the dark closing in. Phase 3: it blinks in beside
  // you and swings its SCYTHE. The lich and everything it throws glow through the dark.
  lines('undertaker', 'Undertaker', {
    undertaker: ['', ['you walked into the lich.', 'cold hands. colder lich.', 'it was right there in the dark.']],
    'undertaker:skull': ['skull', ['a skull to the shins. jump them.', 'they bounce. you did not.', 'bowled over by a skull.']],
    'undertaker:bones': ['bone spikes', ['the floor cracked. that was the warning.', 'bones from below.', 'move when the floor glows.']],
    'undertaker:orb': ['soul orb', ['land ON the orb, not in it.', 'the soul orb ate you.', 'jump on it. from above.']],
    'undertaker:hands': ['grave hands', ['dragged under. mash faster.', 'the dead wanted company.']],
    'undertaker:scythe': ['scythe', ['eyes beside you in the dark: move.', 'reaped.', 'it appeared next to you. that is the move.']],
  });
  B.undertaker = {
    build(L) {
      L.spawn(2.6, 15);
      L.block(0, 15, 32, 3); L.block(0, 0, 32, 2); L.block(0, 2, 1, 13); L.block(31, 2, 1, 13);
      const coffins = [5, 16, 27].map((cx) => ({ x: cx - 0.8, y: 12.2, w: 1.6, h: 2.8, open: 0, rattle: 0 }));
      const b = L.boss({ id: 'undertaker', name: 'THE UNDERTAKER', x: 15.3, y: 10.4, w: 1.4, h: 2.6, hp: 6, perPhase: 2,
        state: 'wait', st: 0, stun: 0, fade: 0, coffins, tx: 15, ty: 10.4, orbIn: 3, lightR: 5, dim: 0, flick: 2 });
      const K = kit(L, b, 1);
      const lc = () => b.x + b.w / 2;
      const light = (r) => { L.dark = Math.round(r * 2) / 2; };

      function idle(lo, hi) { K.set('idle'); b.idleFor = K.range(lo, hi) * PACE; b.tx = clamp(K.px() + K.range(5, 8) * (K.px() < 16 ? 1 : -1) - b.w / 2, 2, 28.6); b.ty = K.range(9.4, 12.4); }
      function blink(x, y) { K.set('blinkOut'); b.to = { x: clamp(x, 1.4, 29.2), y: clamp(y, 9.2, 12.4) }; }
      function orb() {
        const dir = Math.sign(K.px() - lc()) || 1;
        // it drops from the lich's hand to the floor, harmless until it lands
        K.hz({ atk: 'orb', x: lc() + dir * 1.1, y: b.y + 1, r: 0.55, vx: 0, vy: 0, kick: false, life: 7, live: false,
          step(h, dt) {
            h.life -= dt;
            if (!h.live && !h.kick) { h.vy += 30 * dt; h.y += h.vy * dt; if (h.y >= 14.45) { h.y = 14.45; h.live = true; L.sound('thud'); } return; }
            if (h.kick) {   // flying back into the lich
              if (b.hidden || b.fade < 0.9) { h.y += Math.sin(L.t * 6) * dt; return; }
              const dx = lc() - h.x, dy = b.y + b.h / 2 - h.y, d = Math.hypot(dx, dy);
              if (d < 1.0) { h.gone = true; L.fx(h.x, h.y, '#a77bff', 30, 9); stun(K.by(2.4, 2.1, 1.8)); return; }
              h.x += (dx / d) * 15 * dt; h.y += (dy / d) * 15 * dt; return;
            }
            if (h.life <= 0) { h.gone = true; L.fx(h.x, h.y, '#a77bff', 12, 4); return; }
            const a = 6, vmax = K.by(5, 6, 7);
            h.vx = clamp(h.vx + Math.sign(K.px() - h.x) * a * dt, -vmax, vmax); h.x = clamp(h.x + h.vx * dt, 1.6, 30.4);
          },
          // land on it from above and it flies back at the lich
          onTouch(h, p) {
            if (h.kick) return true;
            if (p.vy * L.g > 0 && p.y + p.h < h.y + 0.05) {   // coming down on its upper half
              h.kick = true; h.live = false; p.vy = -14 * L.g; p.grounded = false; L.sound('flip'); L.fx(h.x, h.y - 0.5, '#ffe27a', 14, 6);
              return true;
            }
            return false;
          } });
      }
      function skulls() {
        const n = K.by(3, 3, 4), dir = Math.sign(K.px() - lc()) || 1;   // one running jump clears the whole stream
        for (let i = 0; i < n; i++) L.wait(i * 0.3, () => {
          if (b.dead) return;
          K.hz({ atk: 'skull', x: lc() + dir * 0.9, y: 14.64, r: 0.36, vx: dir * 5.5, vy: -3, rot: 0, life: 2.6,
            step(h, dt) {
              h.vy += 40 * dt; h.y += h.vy * dt; h.x += h.vx * dt; h.rot += dt * 10; h.life -= dt;
              if (h.y > 14.64) { h.y = 14.64; h.vy = -5; }
              // they crumble at a wall, or after about 14 tiles: you can outrun a stream as well as jump it
              if (h.x < 1.3 || h.x > 30.7 || h.life <= 0) { h.gone = true; L.fx(h.x, h.y, '#e8dcc0', 6, 3); }
            } });
          L.sound('pop');
        });
      }
      function bones() {
        // under you, then (phase 2) where you're heading, then (phase 3) behind you too; the gaps between them are safe
        const xs = [K.px()], dir = Math.sign(L.player.vx) || K.pick([-1, 1]);
        if (b.phase >= 2) xs.push(K.px() + dir * 3.2);
        if (b.phase >= 3) xs.push(K.px() - dir * 3.2);
        for (const x of xs) {
          const cx = clamp(x, 1.9, 30.1);
          K.hz({ atk: 'bones', x: cx - 0.9, y: 13.4, w: 1.8, h: 1.6, live: false, warn: K.by(0.6, 0.5, 0.42), up: 0,
            step(h, dt) {
              if (h.warn > 0) { h.warn -= dt; if (h.warn <= 0) { h.live = true; L.sound('pop'); L.fx(h.x + 0.9, 14.8, '#e8dcc0', 8, 5); } return; }
              h.up += dt; if (h.up > 0.45) h.gone = true;
            } });
        }
      }
      function hands() {
        const cx = clamp(K.px(), 1.7, 30.3);
        K.hz({ atk: 'hands', x: cx - 0.6, y: 14, w: 1.2, h: 1, live: false, warn: K.by(0.5, 0.5, 0.42), up: 0,
          step(h, dt) {
            if (h.warn > 0) { h.warn -= dt; if (h.warn <= 0) { h.live = true; L.fx(h.x + 0.6, 14.9, '#6b4a2b', 10, 5); } return; }
            h.up += dt; if (h.up > 0.35) h.gone = true;
          },
          onTouch(h, p) {   // they grab instead of killing: mash to get free
            h.gone = true; p.vx = p.vy = 0; p.x = h.x + 0.2;
            grab(L, b, K, 'hands', () => { p.vy = -14 * L.g; p.grounded = false; L.fx(h.x + 0.6, 14.6, '#e8dcc0', 12, 6); });
            return true;
          } });
      }
      function stun(sec) { K.set('stunned'); b.stun = sec; b.y = 15 - b.h; b.hidden = false; b.fade = 1; L.sound('thud'); L.shake(0.3, 0.4); K.clear(); }
      function choose() {
        const d = Math.abs(K.px() - lc()), p = b.phase, orbOut = L.hz.some((h) => h.atk === 'orb');
        const pick = K.weighted([
          [orbOut || d < 4 ? 0 : b.orbIn <= 0 ? 6 : 0.6, 'orb'],
          [L.hz.some((h) => h.atk === 'bones') || (L.hz.some((h) => h.atk === 'skull') && p < 3) ? 0 : orbOut ? [0, 0, 0.5, 1][p] : 2.2, 'skulls'],   // one stream at a time
          [(orbOut && p < 3) || (L.hz.some((h) => h.atk === 'skull') && p < 3) ? 0 : 2.4, 'bones'],   // not under a skull stream
          [p >= 2 && !orbOut ? 1.6 : p >= 2 ? 0.8 : 0, 'hands'],
          [p >= 3 ? 2 : 0, 'scythe'],
          [p >= 2 && b.dim <= 0 ? 0.7 : 0, 'dark'],
          [0.9, 'blink'], [0.4, 'drift'],
        ]);
        if (pick === 'orb') { K.set('orbTell', { tellFor: 0.8 }); b.orbIn = K.range(5, 8); }
        else if (pick === 'skulls') K.set('skullTell', { tellFor: K.by(0.5, 0.42, 0.35) });
        else if (pick === 'bones') { K.set('bonesTell', { tellFor: 0.25 }); }
        else if (pick === 'hands') K.set('handsTell', { tellFor: 0.2 });
        else if (pick === 'scythe') { const side = K.px() > 16 ? -1 : 1; b.scythe = true; blink(K.px() + side * 2.5 - b.w / 2, 15 - b.h); }
        else if (pick === 'dark') { K.set('laugh'); b.dim = 2.6; L.sound('trap'); }
        else if (pick === 'blink') blink(K.px() + K.range(4, 9) * K.pick([-1, 1]) - b.w / 2, K.range(9.4, 12.4));
        else idle(0.4, 1.0);
      }

      b.update = (b, dt) => {
        // the light: its radius shrinks with each phase and for a while after it laughs; it flickers off now and then
        b.dim -= dt; b.flick -= dt;
        const want = (b.dim > 0 ? 2.8 : [0, 5, 4.6, 4.2][b.phase]);
        if (b.flick <= 0) { b.flick = K.range(3, 5.5); light(0); L.wait(0.07, () => light(want)); }
        else if (L.dark) light(want);
        if (L.qte) return;
        b.st += dt; b.orbIn -= dt;
        K.tick(dt);
        if (!['stunned', 'struck', 'blinkOut', 'away', 'blinkIn', 'dying', 'wait', 'scytheTell', 'scythe'].includes(b.state)) {
          // a restless drift with a tremor
          b.x = clamp(b.x + clamp(b.tx - b.x, -2.6 * dt, 2.6 * dt), 1.4, 29.2);
          b.y = clamp(b.y + clamp(b.ty - b.y, -2 * dt, 2 * dt) + Math.sin(L.t * 3.1) * 0.6 * dt, 9.2, 12.4);
          b.face = Math.sign(K.px() - lc()) || b.face;
        }
        switch (b.state) {
          case 'wait': case 'struck': return;
          case 'idle': if (b.st >= b.idleFor) choose(); return;
          case 'roar': if (b.st >= 1.2) idle(0.2, 0.5); return;
          case 'laugh': if (b.st >= 0.8) idle(0.1, 0.4); return;
          case 'blinkOut':
            b.fade = Math.max(0, 1 - b.st / 0.25);
            if (b.st >= 0.25) { b.hidden = true; K.set('away'); b.awayFor = K.range(0.15, 0.45); }
            return;
          case 'away':
            if (b.st >= b.awayFor) { b.x = b.to.x; b.y = b.to.y; b.tx = b.x; b.ty = b.y; K.set('blinkIn'); }
            return;
          case 'blinkIn':   // the eyes show first (a fair warning), then the body; it can only hurt you once it's whole
            b.fade = Math.min(1, b.st / 0.4);
            if (b.st >= 0.4) {
              b.hidden = false; b.fade = 1;
              if (b.scythe) { b.scythe = false; b.face = Math.sign(K.px() - lc()) || 1; K.set('scytheTell', { tellFor: 0.32 }); }
              else idle(0.15, 0.5);
            }
            return;
          case 'orbTell': if (b.st >= b.tellFor) { orb(); idle(0.3, 0.6); } return;
          case 'skullTell': if (b.st >= b.tellFor) { skulls(); idle(0.4, 0.8); } return;
          case 'bonesTell': if (b.st >= b.tellFor) { bones(); idle(0.5, 0.9); } return;
          case 'handsTell': if (b.st >= b.tellFor) { hands(); idle(0.5, 0.9); } return;
          case 'scytheTell':
            if (b.st >= b.tellFor) {
              K.set('scythe');
              b.swing = K.hz({ atk: 'scythe', x: b.face > 0 ? b.x + b.w : b.x - 2.4, y: b.y + 0.2, w: 2.4, h: 2.4 });
              L.sound('jump');
            }
            return;
          case 'scythe': if (b.st >= 0.2) { b.swing.gone = true; blink(K.px() + K.range(5, 9) * K.pick([-1, 1]), K.range(9.4, 12)); } return;
          case 'stunned':
            b.stun -= dt;
            if (b.stun <= 0) { L.sound('trap'); blink(K.px() + 8 * (K.px() < 16 ? 1 : -1), 10.4); }
            return;
          case 'hurt': if (b.st >= 0.5) blink(K.px() + 8 * (K.px() < 16 ? 1 : -1), 10.4); return;
          default: return;
        }
      };
      b.onTouch = (b) => {
        if (b.state !== 'stunned' || L.t < (b.safeUntil || 0)) return true;   // a ghost: you pass through it
        strike(L, b, K, 'BANISH!', () => { L.say('it slipped away'); skulls(); blink(K.px() + 8 * (K.px() < 16 ? 1 : -1), 10.4); });
        return true;
      };
      b.onHit = () => {
        K.set('hurt'); K.clear(); const p = L.player, dir = Math.sign(lc() - K.px()) || 1;
        p.vx = -dir * 7; p.vy = -11 * L.g; p.grounded = false;
        for (const c of coffins) c.rattle = 0.6;
      };
      b.onPhase = () => {
        K.set('roar'); b.inv = 1.4; L.sound('trap'); L.shake(0.6, 0.6); b.y = Math.min(b.y, 10.4);
        coffins[b.phase === 2 ? 0 : 2].open = 1;
        L.fx(coffins[b.phase === 2 ? 0 : 2].x + 0.8, 12.5, '#2a1e30', 30, 9);
        const p = L.player, d = K.px() - lc();
        if (Math.abs(d) < 6) { p.vx = Math.sign(d) * 11; p.vy = -8 * L.g; p.grounded = false; }
      };
      b.onDefeat = () => L.playCine(outro(), () => { L.killBoss(b); L.dark = 0; L.win(); });

      function intro() {
        const c = coffins[1];
        return {
          dur: 7.6,
          update(t) {
            walkIn(L, t, 3.4, 1.4);
            light(t < 6.6 ? 14 : lerp(14, 5, ease((t - 6.6) / 0.9)));
            c.rattle = t > 2.2 && t < 3.0 ? 1 : 0;
            if (t >= 3.0) c.open = 1;
            const k = ease((t - 3.0) / 1.4);
            b.x = 15.3; b.y = lerp(13.2, 10.2, k); b.fade = k; b.hidden = t < 3.0; b.face = -1;
            b.scytheOut = t > 5.0;
            K.cue(t, 1.6, () => { L.sound('thud'); L.shake(0.2, 0.25); });
            K.cue(t, 3.0, () => { L.sound('trap'); L.shake(0.4, 0.5); L.fx(16, 12.6, '#2a1e30', 40, 10); L.fx(16, 12, '#4a4352', 16, 7); });
            K.cue(t, 5.0, () => L.sound('reveal'));
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 0.4, 2.4, 'The crypt. Something is breathing.');
            ui.caption(t, 3.6, 5.2, 'heh. heh. heh.');
            if (t > 5.4) ui.label('THE UNDERTAKER', t - 5.4);
            ui.caption(t, 5.6, 7.4, 'keeper of the crypt');
          },
          end() { b.y = 10.2; b.fade = 1; b.hidden = false; b.scytheOut = false; c.open = 1; c.rattle = 0; light(5); const p = L.player; p.x = 3.4; p.vx = 0; },
        };
      }
      function outro() {
        K.once = {};   // the intro's cues are spent
        K.set('dying'); b.hidden = false; b.fade = 1;
        const y0 = b.y;
        return {
          dur: 6.8,
          update(t) {
            b.cracks = clamp((t - 0.3) / 1.6, 0, 1);
            b.burst = t > 2.0;
            b.y = t < 2.0 ? y0 - ease(t / 2) * 0.8 : y0;
            light(t < 2.4 ? 5 : lerp(5, 0, ease((t - 2.4) / 1.8)));
            K.cue(t, 0.1, () => { L.sound('trap'); L.shake(0.6, 0.5); });
            K.cue(t, 2.0, () => { L.sound('thud'); for (let i = 0; i < 4; i++) L.fx(lc(), b.y + 1, i % 2 ? '#2a1e30' : '#a77bff', 26, 12); });
            coffins.forEach((cf, i) => K.cue(t, 3.0 + i * 0.35, () => { cf.open = 0; L.sound('thud'); L.fx(cf.x + 0.8, 12.4, '#4a4352', 8, 4); }));
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 2.6, 4.4, 'The candles relight, one by one.');
            if (t > 4.6) ui.label('THE UNDERTAKER', t - 4.6);
            ui.caption(t, 4.8, 6.8, 'laid to rest');
          },
        };
      }
      opening(L, b, intro(), (watched) => {
        light(5); b.fade = 1; b.hidden = false;
        if (watched) idle(0.3, 0.6); else { K.set('roar'); L.sound('trap'); coffins[1].open = 1; }
      });
    },

    // everything of the crypt is drawn over the darkness, so it can be read
    draw() {},
    lit(b, L, t, D) {
      const r = D.r, o = '#0c080c';
      // coffins: background furniture, a faint violet edge so you can find your way
      for (const c of b.coffins) {
        const jig = c.rattle > 0 && !D.calm ? Math.floor(t * 24) % 2 : 0;
        D.at(c.x, c.y - jig * 0.05, () => {
          const w = 24, h = 42, edge = 'rgba(167,123,255,0.5)';
          r(2, 0, w - 4, h, '#120c16'); r(0, 4, w, h - 8, '#120c16');
          r(2, 0, w - 4, 1, edge); r(0, 4, 1, h - 8, edge); r(w - 1, 4, 1, h - 8, edge); r(2, h - 1, w - 4, 1, edge);
          if (c.open) { r(3, 3, w - 6, h - 6, '#05030a'); r(w + 1, 10, 6, h - 10, '#2a1e30'); r(w + 1, 10, 6, 1, edge); }
          else { r(11, 8, 2, 14, edge); r(7, 12, 10, 2, edge); }
        }, false);
      }
      for (const h of L.hz) if (h.boss === b) drawCryptHz(h, b, t, D);
      if (b.dead || b.burst || (b.hidden && b.state !== 'away' && !(b.state === 'blinkIn'))) return;   // gone in a cloud of bats
      const W = 21, H = 39, flip = b.face > 0;
      // the eyes come first when it blinks in: a warning of where it will be
      if (b.state === 'away' || b.state === 'blinkIn') {
        const at = b.state === 'away' ? b.to : b;
        if (b.state === 'blinkIn' || b.st > 0.05) D.at(at.x, at.y, () => { r(6, 6, 3, 2, '#ffe27a'); r(12, 6, 3, 2, '#ffe27a'); }, false);
        if (b.state === 'away') return;
      }
      const stunned = b.state === 'stunned' || b.state === 'struck';
      D.ctx.globalAlpha = b.fade === undefined ? 1 : Math.max(0.05, b.fade);
      D.at(flip ? b.x + b.w : b.x, b.y, () => {
        const robe = '#2a1e30', fold = '#3e2c48', bone = '#e8dcc0';
        const eye = b.state && b.state.endsWith('Tell') ? '#ffe27a' : stunned ? '#4a3a5a' : '#a77bff';
        if (stunned) {   // collapsed in a heap, the skull on the floor
          r(0, 26, W, 13, o); r(1, 27, W - 2, 11, robe); r(3, 29, 6, 1, fold); r(12, 31, 6, 1, fold);
          r(4, 22, 9, 8, o); r(5, 23, 7, 6, bone); r(6, 25, 2, 2, eye); r(9, 25, 2, 2, eye);
          if (!D.calm) for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; r(Math.round(8 + Math.cos(a) * 8), Math.round(18 + Math.sin(a) * 2), 2, 2, '#ffe27a'); }
          return;
        }
        // scythe behind: pole at the back, the blade over the head
        if (b.state !== 'scythe' && (b.state !== 'wait' || b.scytheOut)) {
          r(17, 1, 2, 38, o); r(17, 1, 1, 38, '#4a3a2a');
          r(5, 0, 14, 3, o); r(6, 1, 12, 1, '#c8c4d0'); r(3, 2, 4, 3, o); r(4, 2, 2, 2, '#c8c4d0');
        }
        const hem = Math.floor(t * 6) % 2;
        r(1, 12, W - 4, H - 14, o); r(2, 13, W - 6, H - 16, robe); r(5, 16, 2, 16, fold); r(11, 18, 2, 14, fold);
        for (let i = 0; i < W - 4; i += 3) r(1 + i, H - 2 - ((i / 3 + hem) % 2) * 2, 2, 2 + ((i / 3 + hem) % 2) * 2, robe);   // the tattered hem
        r(3, 0, W - 8, 14, o); r(4, 1, W - 10, 12, robe);   // hood
        r(6, 3, 9, 9, o); r(6, 4, 8, 7, bone); r(7, 6, 2, 2, eye); r(11, 6, 2, 2, eye); r(8, 10, 4, 1, o);   // the skull
        const up = b.state && b.state.endsWith('Tell') ? -6 : 0;   // hands raised to cast
        r(0, 18 + up, 3, 7, bone); r(W - 5, 18 + up, 3, 7, bone);
        if (b.cracks) for (let i = 0; i < 6; i++) if (b.cracks > i / 6) r(4 + ((i * 5) % 11), 14 + i * 4, 6 - (i % 3), 1, '#ffe27a');
      }, flip);
      D.ctx.globalAlpha = 1;
      if (b.state === 'orbTell') {   // the orb gathering in its hands
        const k = Math.min(1, b.st / b.tellFor);
        D.disc(b.x + b.w / 2 + (flip ? 0.9 : -0.9), b.y + 0.8, Math.max(1, Math.round(8 * k)), k > 0.85 && !D.calm && Math.floor(t * 12) % 2 ? '#ffffff' : '#c8a8ff');
      }
    },
  };
  function drawCryptHz(h, b, t, D) {
    const r = D.r, o = '#0c080c';
    if (h.atk === 'skull') {
      D.disc(h.x, h.y, 5, o); D.disc(h.x, h.y, 4, '#e8dcc0');
      D.at(h.x - 0.2, h.y - 0.13, () => { r(0, 0, 2, 2, o); r(3, 0, 2, 2, o); r(1, 4, 3, 1, o); }, false);
    } else if (h.atk === 'bones') {
      if (!h.live) {   // the crack, glowing brighter until it breaks
        const k = 1 - h.warn / 0.6;
        D.at(h.x, 14.8, () => { for (let i = 0; i < 27; i += 3) r(i, (i / 3) % 2, 3, 1, k > 0.6 && !D.calm && Math.floor(t * 14) % 2 ? '#ffffff' : '#a77bff'); }, false);
        return;
      }
      const k = Math.min(1, h.up / 0.06);
      D.at(h.x, h.y, () => { const hh = Math.round(24 * k); for (let i = 0; i < 4; i++) { const x = 1 + i * 7; for (let j = 0; j < hh; j += 2) { const hw = Math.max(1, Math.round((j / hh) * 3)); r(x + 3 - hw, 24 - hh + j, hw * 2, 2, '#e8dcc0'); } } }, false);
    } else if (h.atk === 'orb') {
      const pulse = D.calm ? 0 : Math.floor(t * 10) % 2;
      D.disc(h.x, h.y, 9 + pulse, h.kick ? 'rgba(255,226,122,0.35)' : 'rgba(167,123,255,0.35)');
      D.disc(h.x, h.y, 8, h.kick ? '#ffd23f' : '#a77bff'); D.disc(h.x, h.y, 5, h.kick ? '#fff0a0' : '#e0d0ff');
    } else if (h.atk === 'hands') {
      if (!h.live) { D.at(h.x, 14.6, () => { r(1, 3, 16, 3, '#6b4a2b'); r(4, 1, 10, 2, '#6b4a2b'); }, false); return; }
      D.at(h.x, h.y, () => { for (const x of [2, 10]) { r(x, 2, 6, 13, '#e8dcc0'); r(x - 1, 0, 2, 5, '#e8dcc0'); r(x + 2, 0, 1, 3, '#e8dcc0'); r(x + 5, 0, 2, 5, '#e8dcc0'); r(x + 1, 6, 4, 1, o); } }, false);
    } else if (h.atk === 'scythe') {   // the blade's arc, exactly the hitbox
      D.at(h.x, h.y, () => { const w = 36, hh = 36; for (let i = 0; i < 12; i++) { const a = (i / 11) * Math.PI; r(Math.round(w / 2 + Math.cos(a) * (w / 2 - 3) * (b.face > 0 ? 1 : -1)) - 2, Math.round(hh / 2 - Math.sin(a) * (hh / 2 - 3)) - 2 + 14, 5, 4, '#c8c4d0'); } }, false);
    }
  }

  // ==================================================================================== OLD GNASHER
  // Flooded Depths. An eel of saw blades. It swims the upper half, darting and doubling back.
  // LUNGE: its jaw opens and it aims at where you stand (the line shows), then flies straight there. Keep one
  // of the spiked anchors between you and it, and it impales itself and tumbles on to your feet, stunned.
  // SAWS roll along your surface (jump them). Phase 2: a CURRENT drags you toward its open mouth (walk against
  // it; get swallowed and you mash; get free and it chokes, stunned). Phase 3: GEYSERS, and upside down.
  lines('gnasher', 'Gnasher', {
    gnasher: ['', ['Old Gnasher ate you.', 'all teeth, and you touched them.', 'its body is saws. all of it.']],
    'gnasher:lunge': ["Gnasher's lunge", ['keep an anchor between you and it.', 'it flew straight at you. it always does.', 'out of the line. or behind an anchor.']],
    'gnasher:saw': ['rolling saw', ['the saws roll. jump them.', 'sawn off at the ankles.']],
    'gnasher:swallow': ["Gnasher's gullet", ['swallowed. mash faster.', 'walk against the current.']],
    'gnasher:geyser': ['geyser', ['the bubbles were the warning.', 'blasted into the ceiling.']],
  });
  const ANCHORS = [{ x: 7, y: 8.4, w: 3, h: 0.8 }, { x: 22, y: 8.4, w: 3, h: 0.8 }];
  B.gnasher = {
    anchors: ANCHORS,
    build(L) {
      L.spawn(1.2, 15);
      L.block(0, 15, 32, 3); L.block(0, 0, 32, 3);
      for (const a of ANCHORS) { L.block(a.x, a.y, a.w, a.h); L.spike(a.x, a.y, a.w, 'up'); L.spike(a.x, a.y + a.h, a.w, 'down'); }
      const b = L.boss({ id: 'gnasher', name: 'OLD GNASHER', x: 24, y: 5.4, w: 1.6, h: 1.2, hp: 6, perPhase: 2,
        state: 'wait', st: 0, stun: 0, tx: 20, ty: 6, speed: 4, jaw: 0, zone: 'up', zoneFor: 4 });
      const K = kit(L, b, 2);
      const head = () => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      // the body: 7 saws following the head's path, one every 0.75 tiles
      const trail = [], body = [];
      for (let i = 0; i < 80; i++) trail.push({ x: 25.6 + i * 0.1, y: 6 });
      for (let i = 0; i < 7; i++) body.push(K.hz({ atk: 'body', x: 26 + i * 0.75, y: 6, r: 0.45, rot: i }));
      for (const s of body) s.atk = null;   // touching the body is a plain Gnasher death
      const surfaceY = () => (L.g > 0 ? 15 : 3);
      const zoneY = (z) => (z === 'up' ? [4.6, 7.4] : [10.6, 13.4]);

      function wander() {
        const [y0, y1] = zoneY(b.zone);
        b.tx = clamp(K.px() + K.range(-9, 9), 3, 29); b.ty = K.range(y0, y1); b.speed = K.range(3, K.by(7, 8.5, 10)); b.pause = K.chance(0.3) ? K.range(0.1, 0.3) : 0;
      }
      function pickZone() { b.zone = 'up'; b.zoneFor = K.range(2.5, 5); }   // it hunts from up high: the anchors give cover
      function idle(lo, hi) { K.set('idle'); b.idleFor = K.range(lo, hi) * PACE; }
      function saws() {
        const n = K.by(2, 3, 4), sy = L.g > 0 ? 15 - 0.42 : 3 + 0.42, from = K.px() < 16 ? 30.5 : 1.5, dir = from > 16 ? -1 : 1;
        for (let i = 0; i < n; i++) L.wait(i * 0.38, () => {
          if (b.dead) return;
          K.hz({ atk: 'saw', x: from, y: sy, r: 0.42, vx: dir * 6.5, rot: 0, step(h, dt) { h.x += h.vx * dt; h.rot += dt * 14; if (h.x < 0.5 || h.x > 31.5) h.gone = true; } });
          L.sound('pop');
        });
      }
      function geysers() {
        const xs = [clamp(K.px() - 0.7, 1, 29.6)];
        while (xs.length < 3) { const x = K.range(1, 29.6); if (xs.every((o) => Math.abs(o - x) > 3)) xs.push(x); }
        for (const x of xs) K.hz({ atk: 'geyser', x, y: 3, w: 1.4, h: 12, live: false, warn: 0.65, up: 0,
          step(h, dt) { if (h.warn > 0) { h.warn -= dt; if (h.warn <= 0) { h.live = true; L.sound('thud'); } return; } h.up += dt; if (h.up > 0.6) h.gone = true; } });
      }
      function stun(sec) { K.set('stunned'); b.stun = sec; L.sound('thud'); L.shake(0.3, 0.4); for (const s of body) s.live = false; K.clear(); }
      function choose() {
        const p = b.phase;
        const sawsOut = L.hz.some((h) => h.atk === 'saw'), high = b.y + b.h / 2 < 9;
        const pick = K.weighted([
          [sawsOut && p < 3 ? 0 : 3.2, 'lunge'],   // not while its saws are still rolling at you (until phase 3)
          [high && !sawsOut ? 1.6 : 0, 'saws'],     // one stream at a time, only from up high (never on a flat lunge)
          [p >= 2 && !sawsOut ? 1.2 : 0, 'current'], [p >= 3 ? 1.4 : 0, 'geysers'], [0.6, 'swim'],
        ]);
        if (pick === 'lunge') { const h = head(); K.set('lungeTell', { tellFor: K.by(0.55, 0.46, 0.38), aim: { x: K.px(), y: K.py() } }); b.face = Math.sign(K.px() - h.x) || b.face; }
        else if (pick === 'saws') K.set('sawTell', { tellFor: 0.45 });
        else if (pick === 'current') {
          // it parks at the far end of your surface, mouth open, and drags you in
          const end = K.px() < 16 ? 29 : 1.4;
          K.set('toMouth', { mouth: { x: end, y: L.g > 0 ? 15 - b.h - 0.05 : 3.05 } });
        } else if (pick === 'geysers') { K.set('geyserTell'); geysers(); }
        else { wander(); idle(0.6, 1.4); }
      }
      function swimTo(x, y, sp, dt) {
        const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
        if (d < 0.05) return true;
        const m = Math.min(d, sp * dt);
        b.x += (dx / d) * m; b.y += (dy / d) * m;
        if (Math.abs(dx) > 0.05) b.face = Math.sign(dx);
        return d <= sp * dt;
      }

      b.update = (b, dt) => {
        if (b.state !== 'gape') L.wind = 0;
        if (L.qte) return;
        b.st += dt;
        K.tick(dt);
        // the body follows the head's path
        const h = head();
        if (Math.hypot(h.x - trail[0].x, h.y - trail[0].y) > 0.1) { trail.unshift({ x: h.x, y: h.y }); trail.length = 80; }
        body.forEach((s, i) => { const q = trail[Math.min(trail.length - 1, (i + 1) * 7 + 1)]; s.x = q.x; s.y = q.y; if (s.live) s.rot += dt * 10; });
        if (b.limpUntil && L.t >= b.limpUntil) { b.limpUntil = 0; for (const s of body) s.live = true; }
        b.jaw = ['lungeTell', 'lunge', 'gape', 'toMouth'].includes(b.state) ? 1 : b.state === 'stunned' || b.state === 'choke' ? 0.5 : 0;
        if (b.lastG !== L.g) { b.lastG = L.g; b.zoneFor = Math.min(b.zoneFor, K.range(0.4, 0.9)); }   // you flipped: it re-hunts from afar
        switch (b.state) {
          case 'wait': case 'struck': return;
          case 'idle': case 'swim': {
            b.zoneFor -= dt;
            if (b.zoneFor <= 0) { pickZone(); wander(); }
            if (b.pause > 0) b.pause -= dt;
            else if (swimTo(b.tx - b.w / 2, b.ty - b.h / 2, b.speed, dt)) wander();
            if (K.chance(dt * 0.8)) { b.tx = clamp(b.x - (b.tx - b.x), 3, 29); }   // it doubles back
            // it only attacks from up high: back down near the floor, it swims up first
            if (b.state === 'idle' && b.st >= b.idleFor && b.y + b.h / 2 < 8) choose();
            else if (b.y + b.h / 2 >= 8 && b.ty > 7.4) wander();
            return;
          }
          case 'roar': swimTo(b.x, 5, 14, dt); if (b.st >= 1.2) { wander(); idle(0.2, 0.5); } return;   // roaring, it rises out of reach
          case 'lungeTell':
            if (b.st >= b.tellFor) {
              const d = Math.hypot(b.aim.x - h.x, b.aim.y - h.y) || 1;
              K.set('lunge', { dir: { x: (b.aim.x - h.x) / d, y: (b.aim.y - h.y) / d } }); b.atk = 'lunge'; L.sound('jump');
            }
            return;
          case 'lunge': {
            b.atk = 'lunge';
            b.x += b.dir.x * 24 * dt; b.y += b.dir.y * 24 * dt;
            for (const a of ANCHORS) if (overlapR(b, a)) {   // impaled on the anchor: it drops onto your floor
              K.set('impaled', { fallDir: Math.sign(b.dir.y) || 1 }); L.sound('thud'); L.shake(0.4, 0.5); L.fx(h.x, h.y, '#9ab0c0', 20, 8);
              for (const s of body) s.live = false;   // impaled, it goes limp: harmless until it shakes free
              return;
            }
            if (b.y < 3 || b.y + b.h > 15 || b.x < 0.5 || b.x + b.w > 31.5) {
              b.x = clamp(b.x, 0.5, 31.5 - b.w); b.y = clamp(b.y, 3, 15 - b.h);
              K.set('bonk'); L.sound('thud'); L.shake(0.25, 0.3);
            }
            return;
          }
          case 'bonk':   // teeth in the floor (harmless for a moment), then straight back up, fast
            if (b.st >= 0.45) { pickZone(); idle(0.3, 0.6); b.tx = b.x + b.w / 2; b.ty = 5.6; b.speed = 12; b.pause = 0; }
            return;
          case 'impaled': if (b.st >= 0.35) K.set('falling'); return;
          case 'falling': {   // through the anchor it tumbles on along its line, to land, stunned, at your feet
            const ty = b.fallDir > 0 ? 15 - b.h : 3;
            b.x = clamp(b.x + b.dir.x * 14 * dt, 0.5, 31.5 - b.w); b.y += Math.abs(b.dir.y) * b.fallDir * 14 * dt;
            if ((b.fallDir > 0 && b.y >= ty) || (b.fallDir < 0 && b.y <= ty)) { b.y = ty; stun(K.by(2.3, 2.0, 1.8)); }
            return;
          }
          case 'stunned': case 'choke':
            b.stun -= dt;
            if (b.stun <= 0) { for (const s of body) s.live = true; pickZone(); wander(); K.set('bonk'); }
            return;
          case 'sawTell': if (b.st >= b.tellFor) { saws(); wander(); idle(0.5, 0.9); } return;
          case 'geyserTell': if (b.st >= 1.4) idle(0.3, 0.6); return;
          case 'toMouth':
            if (swimTo(b.mouth.x - b.w / 2, b.mouth.y, 12, dt)) { K.set('gape'); b.face = Math.sign(K.px() - (b.x + b.w / 2)) || 1; L.sound('trap'); }
            return;
          case 'gape':   // the current drags you toward its open mouth
            L.wind = b.st > 0.5 ? b.face * -1 * K.by(0, 4.5, 5.5) : 0;
            if (b.st >= 2.7) { L.wind = 0; pickZone(); wander(); idle(0.3, 0.6); }
            return;
          case 'hurt':   // hit: it shoots straight back up, out of your way
            swimTo(b.x, 5, 14, dt);
            if (b.st >= 0.5) { pickZone(); idle(0.3, 0.6); b.tx = b.x + b.w / 2; b.ty = 5.6; b.speed = 12; b.pause = 0; }
            return;
          default: return;
        }
      };
      b.onTouch = (b, p) => {
        if (L.t < (b.safeUntil || 0) || ['impaled', 'falling', 'bonk', 'hurt', 'roar'].includes(b.state)) return true;
        if (b.state === 'stunned' || b.state === 'choke') {
          strike(L, b, K, 'RIP IT OUT!', () => { L.say('it shook you off'); for (const s of body) s.live = true; K.set('bonk'); saws(); });
          return true;
        }
        if (b.state === 'gape') {   // swallowed: mash, and if you get out it chokes on you
          L.wind = 0; p.vx = p.vy = 0; K.set('struck');
          grab(L, b, K, 'swallow', () => { p.vy = -14 * L.g; p.vx = -b.face * 9; p.grounded = false; stun(K.by(1.6, 1.4, 1.2)); b.state = 'choke'; });
          return true;
        }
        return false;
      };
      b.onHit = () => {
        K.set('hurt'); b.y = clamp(b.y - L.g * 2.5, 3, 15 - b.h); L.wind = 0;
        const p = L.player; p.vx = -(Math.sign(b.x + b.w / 2 - K.px()) || 1) * 7; p.vy = -10 * L.g; p.grounded = false;
        b.limpUntil = L.t + 1.2;   // its body stays limp a moment: you're standing right next to it
      };
      b.onPhase = () => {
        K.set('roar'); b.inv = 1.4; L.sound('trap'); L.shake(0.6, 0.6);
        b.limpUntil = L.t + 1.4; for (const s of body) s.live = false;
        if (b.phase === 3) L.flipView(true);
      };
      b.onDefeat = () => L.playCine(outro(), () => { L.killBoss(b); L.win(); });

      function intro() {
        return {
          dur: 7.4,
          update(t) {
            walkIn(L, t, 3.6, 1.3);
            // it circles under the surface, a row of saw fins, then bursts out
            const k = clamp((t - 2.2) / 1.8, 0, 1);
            if (t < 4.0) { b.x = lerp(30, 12, k); b.y = 14.6; b.under = true; }
            else { const j = ease((t - 4.0) / 0.6); b.under = false; b.x = lerp(12, 20, j); b.y = lerp(14.6, 5.6, j); }
            b.face = t < 4.0 ? -1 : 1; b.jaw = t > 4.4 && t < 5.6 ? 1 : 0;
            const hd = head();
            if (Math.hypot(hd.x - trail[0].x, hd.y - trail[0].y) > 0.1) { trail.unshift({ x: hd.x, y: hd.y }); trail.length = 80; }
            body.forEach((s, i) => { const q = trail[Math.min(trail.length - 1, (i + 1) * 7 + 1)]; s.x = q.x; s.y = q.y; s.rot += 0.1; });
            K.cue(t, 2.0, () => L.sound('pop'));
            K.cue(t, 4.0, () => { L.sound('thud'); L.shake(0.5, 0.6); L.fx(12.8, 14.6, '#7fd8e8', 40, 11); });
            K.cue(t, 4.6, () => L.sound('trap'));
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 0.4, 2.2, 'The flooded depths. Mind the water.');
            ui.caption(t, 2.4, 3.9, '...is that a fin?');
            if (t > 5.2) ui.label('OLD GNASHER', t - 5.2);
            ui.caption(t, 5.4, 7.2, 'all teeth, no mercy');
          },
          end() { b.under = false; b.x = 20; b.y = 5.6; b.jaw = 0; const p = L.player; p.x = 3.6; p.vx = 0; },
        };
      }
      function outro() {
        K.once = {};   // the intro's cues are spent
        K.set('dying'); for (const s of body) s.live = false;
        L.flipView(false); L.g = 1;
        return {
          dur: 6.6,
          update(t) {
            body.forEach((s, i) => {   // the saws break off from the tail end, one by one
              const at = 0.4 + (body.length - 1 - i) * 0.25;
              if (t > at) { s.y = Math.min(15.6, s.y + (t - at) * 0.6); s.off = true; s.rot += 0.3; }
              K.cue(t, at, () => { L.sound('pop'); L.fx(s.x, s.y, '#9ab0c0', 8, 5); });
            });
            b.jaw = t < 2.4 ? (Math.floor(t * 8) % 2) : 0.5;
            if (t > 2.6) b.y = Math.min(15.2, b.y + 0.08);
            K.cue(t, 2.6, () => { L.sound('thud'); L.fx(b.x + 0.8, 14.6, '#7fd8e8', 30, 9); });
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 3.0, 4.6, 'Bubbles. Then nothing.');
            if (t > 4.6) ui.label('OLD GNASHER', t - 4.6);
            ui.caption(t, 4.8, 6.6, 'scrap metal now');
          },
        };
      }
      opening(L, b, intro(), (watched) => {
        b.under = false;
        if (b.phase >= 3) L.flipView(true);   // a phase 3 checkpoint starts upside down
        if (watched) { wander(); idle(0.4, 0.7); } else { K.set('roar'); L.sound('trap'); }
      });
    },

    draw(b, L, t, D) {
      const r = D.r, o = '#0c080c';
      for (const h of L.hz) if (h.boss === b && h.atk !== 'body' && h.atk !== null) drawDepthsHz(h, b, t, D);
      if (b.state === 'gape' && b.st > 0.5) {   // streaks of current flowing into its mouth
        const y = b.y + b.h / 2, dir = b.face > 0 ? -1 : 1;
        for (let i = 0; i < 9; i++) D.R((((t * 9 * dir + i * 3.6) % 32) + 32) % 32 * 30, (y + ((i % 3) - 1) * 0.5) * 30, 14, 2, 'rgba(232,248,255,0.6)');
      }
      if (b.under) {   // only its saw fins show above the water line
        for (const s of L.hz) if (s.boss === b && s.r === 0.45) D.R(s.x * 30 - 6, 15 * 30 - 14 + (Math.floor(t * 8 + s.x) % 2) * 2, 12, 12, '#9ab0c0');
        return;
      }
      // body: saws, then a tail fin on the last one
      const segs = L.hz.filter((h) => h.boss === b && h.r === 0.45);
      for (const s of segs) D.saw(s.x, s.y, 0.45, s.live ? s.rot : 0);
      const tail = segs[segs.length - 1];
      if (tail && !tail.off) D.at(tail.x - 0.3, tail.y - 0.6, () => { r(0, 0, 9, 4, '#5a6a78'); r(2, 14, 9, 4, '#5a6a78'); }, false);
      if (b.state === 'lungeTell') {   // where it will fly: a dotted line to the spot it locked on
        const h = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, n = 24;
        for (let i = 1; i < n; i++) if (i % 2 === 0) D.R(D.sn(lerp(h.x, b.aim.x, i / n) * 30) - 2, D.sn(lerp(h.y, b.aim.y, i / n) * 30) - 2, 4, 4, '#ffe27a');
      }
      const stunned = b.state === 'stunned' || b.state === 'choke' || b.state === 'struck';
      const flip = b.face > 0, jit = b.state === 'impaled' && !D.calm ? (Math.floor(t * 30) % 2) * 0.06 : 0;
      D.at((flip ? b.x + b.w : b.x) + jit, b.y, () => {
        const W = 24, H = 18, iron = '#5a6a78', lite = '#9ab0c0', jaw = Math.round((b.jaw || 0) * 5);
        // upper head, then the lower jaw dropping open
        r(0, 0, W, 11, o); r(1, 1, W - 2, 9, iron); r(1, 1, W - 2, 2, lite); r(16, -2, 6, 3, o);   // dorsal fin stub
        r(2, 10 + jaw, W - 4, 8 - Math.min(jaw, 3), o); r(3, 11 + jaw, W - 6, 5 - Math.min(jaw, 3), '#4a5866');
        for (let i = 1; i < 12; i += 3) { r(i, 10, 2, 2, '#f4ecd8'); r(i + 1, 10 + jaw - 1, 2, 2, '#f4ecd8'); }   // teeth
        if (jaw > 2) r(1, 12, 10, jaw - 1, '#2a0a10');
        const eyeCol = stunned ? '#6a5a20' : b.state === 'lungeTell' ? '#ffffff' : '#ffe27a';
        r(5, 3, 5, 5, o); r(6, 4, 3, 3, eyeCol); if (!stunned) r(6, 5, 1, 2, o);
        if (stunned && !D.calm) for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; r(Math.round(12 + Math.cos(a) * 9), Math.round(-4 + Math.sin(a) * 2), 2, 2, '#ffe27a'); }
      }, flip);
    },
  };
  function drawDepthsHz(h, b, t, D) {
    const r = D.r;
    if (h.atk === 'saw') D.saw(h.x, h.y, h.r, h.rot);
    else if (h.atk === 'geyser') {
      if (!h.live) {   // bubbles rising from the floor first
        const k = 1 - h.warn / 0.65;
        for (let i = 0; i < 5; i++) D.R(h.x * 30 + 4 + i * 8, 15 * 30 - ((t * 140 + i * 31) % (40 + k * 120)), 4, 4, '#7fd8e8');
        return;
      }
      D.R(h.x * 30, h.y * 30, h.w * 30, h.h * 30, 'rgba(127,216,232,0.75)');
      D.R(h.x * 30, h.y * 30, 4, h.h * 30, '#e8f8ff'); D.R((h.x + h.w) * 30 - 4, h.y * 30, 4, h.h * 30, '#e8f8ff');
    }
  }

  // ======================================================================================== THE MIMIC
  // Molten Core. The treasure chest, on legs. It always leaps a little past where you stand: stand at the edge
  // of a lava pit with the pit behind you and it jumps over you into the lava, then claws back out at the
  // edge, stunned. TONGUE: a lash along the floor (jump it). COINS: molten gold in arcs (step out from
  // under). DASH: it scuttles at you (jump it); caught, it swallows you: mash out and it chokes, stunned.
  // Phase 2: it hides among crates; phase 3 among portals (they look just like the real one). Phase 3: the lava erupts.
  lines('mimicBoss', 'Mimic', {
    mimicBoss: ['', ['the Mimic got you.', 'not treasure. teeth.', 'it jumps past you. stand still.']],
    'mimicBoss:tongue': ['tongue', ['jump the tongue.', 'licked to death. a new low.']],
    'mimicBoss:coins': ['molten gold', ['molten coins. step out from under.', 'rich, briefly.']],
    'mimicBoss:swallow': ["Mimic's mouth", ['chewed. mash faster.', 'swallowed whole. it was the door.']],
    'mimicBoss:lava': ['lava geyser', ['the pit glowed first.', 'the lava wanted a turn too.']],
  });
  const PITS = [[9, 11], [21, 23]];
  B.mimicBoss = {
    pits: PITS,
    build(L) {
      L.spawn(13, 15);
      L.block(0, 15, 9, 3); L.block(11, 15, 10, 3); L.block(23, 15, 9, 3);
      L.block(9, 16.4, 2, 1.6); L.block(21, 16.4, 2, 1.6);
      L.spike(9, 16.4, 2, 'up'); L.spike(21, 16.4, 2, 'up');
      L.block(0, 0, 32, 2); L.block(0, 2, 1, 13); L.block(31, 2, 1, 13);
      const b = L.boss({ id: 'mimicBoss', name: 'THE MIMIC', x: 26.5, y: 13.6, w: 1.8, h: 1.4, hp: 6, perPhase: 2,
        state: 'wait', st: 0, stun: 0, lid: 0, legs: 0, lavaIn: 3 });
      const K = kit(L, b, 3), GR = 40, T = 0.85, FY = 15 - b.h;
      const mc = () => b.x + b.w / 2;
      const overPit = (x) => PITS.some(([a, z]) => x > a && x < z);
      const decoys = [];

      function idle(lo, hi) { K.set('idle'); b.idleFor = K.range(lo, hi) * PACE; }
      function leap() {
        const px = K.px(), dx = px - mc(), dir = Math.sign(dx) || -1;
        // close: it aims a little past you (that's the weakness). far: it hops closer, onto solid floor
        let tx = Math.abs(dx) <= 9 ? px + dir * 2.2 : mc() + dir * 6;
        if (Math.abs(dx) > 9) for (const [a, z] of PITS) if (tx > a - 0.9 && tx < z + 0.9) tx = dir > 0 ? z + 1.4 : a - 1.4;
        tx = clamp(tx, 1.9, 30.1);
        K.set('leap', { vx: (tx - mc()) / T, vy: -0.5 * GR * T, face: dir }); L.sound('jump');
      }
      function coins() {
        const n = K.by(4, 6, 8);
        for (let i = 0; i < n; i++) {
          const land = clamp(K.px() + K.range(-2.8, 2.8), 1.5, 30.5), time = K.range(0.75, 1.05), x0 = mc(), y0 = b.y + 0.2;
          K.hz({ atk: 'coins', x: x0, y: y0, r: 0.28, vx: (land - x0) / time, vy: (14.72 - y0 - 0.5 * GR * time * time) / time, sizzle: 0,
            step(h, dt) {
              if (h.sizzle > 0) { h.sizzle -= dt; if (h.sizzle <= 0) h.gone = true; return; }
              h.vy += GR * dt; h.x += h.vx * dt; h.y += h.vy * dt;
              if (h.y >= 14.72 && !overPit(h.x)) { h.y = 14.72; h.live = false; h.sizzle = 0.3; L.fx(h.x, 14.8, '#ffd23f', 3, 3); }
              if (h.y > 17) h.gone = true;
            } });
        }
        L.sound('pop');
      }
      function geyser() {
        const [a, z] = K.pick(PITS);
        K.hz({ atk: 'lava', x: a, y: 6, w: z - a, h: 10.4, live: false, warn: 0.7, up: 0,
          step(h, dt) { if (h.warn > 0) { h.warn -= dt; if (h.warn <= 0) { h.live = true; L.sound('thud'); L.shake(0.2, 0.3); } return; } h.up += dt; if (h.up > 0.7) h.gone = true; } });
      }
      function stun(sec) { K.set('stunned'); b.stun = sec; L.sound('thud'); K.clear(); }
      function swallowGrab(p) {
        p.vx = p.vy = 0; K.set('struck'); b.lid = 1;
        grab(L, b, K, 'swallow', () => { p.vy = -15 * L.g; p.vx = -(Math.sign(mc() - K.px()) || 1) * 9; p.grounded = false; stun(K.by(1.7, 1.5, 1.3)); b.choke = true; });
      }
      function disguise() {
        // it vanishes, and 3 crates (phase 2) or 3 portals (phase 3) appear; one of them is the Mimic
        L.fx(mc(), b.y + 0.7, '#ffd23f', 20, 8); b.hidden = true;
        const kind = b.phase >= 3 ? 'door' : 'crate', spots = [];
        let guard = 0;
        while (spots.length < 3 && guard++ < 200) {
          const x = K.range(2, 29);
          if (Math.abs(x - K.px()) < 3.5 || overPit(x) || overPit(x + 1.4) || PITS.some(([a, z]) => x + 1.4 > a && x < z)) continue;
          if (spots.every((s) => Math.abs(s - x) > 2.4)) spots.push(x);
        }
        const real = Math.floor(K.R() * spots.length);
        spots.forEach((x, i) => { if (i !== real) decoys.push({ x, y: kind === 'door' ? 13.4 : 13.6, w: kind === 'door' ? 1.2 : 1.4, h: kind === 'door' ? 1.6 : 1.4, kind }); });
        const x = spots[real];
        b.w = kind === 'door' ? 1.2 : 1.4; b.h = kind === 'door' ? 1.6 : 1.4; b.x = x; b.y = 15 - b.h; b.disguise = kind;
        L.wait(0.25, () => { b.hidden = false; });
        K.set('hiding', { hideFor: K.by(1.8, 1.8, 1.6) });
      }
      function reveal() {
        for (const d of decoys) L.fx(d.x + d.w / 2, d.y + d.h / 2, '#8a5a2b', 12, 6);
        decoys.length = 0;
        const mid = mc(); b.w = 1.8; b.h = 1.4; b.x = mid - b.w / 2; b.y = FY; b.disguise = null;
        L.sound('trap'); K.set('leapTell', { tellFor: 0.35 });
      }
      function choose() {
        const d = Math.abs(K.px() - mc()), p = b.phase;
        const pick = K.weighted([
          [d <= 9 ? 3.4 : 5, 'leap'], [d < 8 ? 2 : 0.4, 'tongue'], [1.6, 'coins'], [d > 3 ? 1.6 : 0.3, 'dash'],
          [p >= 2 ? 1.1 : 0, 'disguise'], [0.3, 'scuttle'], [0.1, 'sit'],
        ]);
        b.face = Math.sign(K.px() - mc()) || b.face;
        if (pick === 'leap') K.set('leapTell', { tellFor: K.by(0.5, 0.42, 0.35) });
        else if (pick === 'tongue') K.set('tongueTell', { tellFor: K.by(0.45, 0.38, 0.32) });
        else if (pick === 'coins') K.set('coinTell', { tellFor: 0.4 });
        else if (pick === 'dash') K.set('dashTell', { tellFor: 0.35 });
        else if (pick === 'disguise') disguise();
        else if (pick === 'scuttle') { K.set('scuttle', { dir: K.chance(0.6) ? -b.face : b.face, runFor: K.range(0.25, 0.6) }); }
        else idle(0.4, 0.9);   // sitting still, like any chest
      }

      b.update = (b, dt) => {
        if (L.qte) return;
        b.st += dt;
        K.tick(dt);
        if (b.phase >= 3 && ['idle', 'scuttle'].includes(b.state)) { b.lavaIn -= dt; if (b.lavaIn <= 0) { geyser(); b.lavaIn = K.range(2.6, 4); } }
        b.lid = ['tongueTell', 'tongue', 'coinTell', 'dash', 'leap'].includes(b.state) ? 1 : b.state === 'leapTell' ? 0.5 : 0;
        b.legs = ['idle', 'hiding', 'stunned', 'struck', 'wait'].includes(b.state) ? 0 : 1;
        switch (b.state) {
          case 'wait': case 'struck': return;
          case 'idle': if (b.st >= b.idleFor) choose(); return;
          case 'roar': if (b.st >= 1.2) idle(0.2, 0.4); return;
          case 'scuttle': {
            const nx = clamp(b.x + b.dir * 11 * dt, 1, 31 - b.w);
            if (!overPit(nx + b.w / 2)) b.x = nx; else b.dir = -b.dir;
            if (b.st >= b.runFor) idle(0.05, 0.3);
            return;
          }
          case 'leapTell': if (b.st >= b.tellFor) leap(); return;
          case 'leap':
            b.vy += GR * dt; b.x += b.vx * dt; b.y += b.vy * dt;
            if (b.st >= T) {
              b.y = FY; b.x = clamp(b.x, 1, 31 - b.w);
              if (overPit(mc())) { K.set('lava'); b.vy = 3; L.sound('trap'); }
              else { L.sound('thud'); L.shake(0.15, 0.2); idle(K.by(0.4, 0.3, 0.2), K.by(0.8, 0.6, 0.45)); }
            }
            return;
          case 'lava':   // it burns, then claws its way out at the pit's edge on your side
            b.y = Math.min(b.y + b.vy * dt, 16.4 - b.h * 0.5); L.fx(mc(), 16.2, '#ff7a1a', 1, 4);
            if (b.st >= 0.7) {
              const [a, z] = PITS.find(([a, z]) => mc() > a - 0.5 && mc() < z + 0.5) || PITS[0];
              const right = K.px() > (a + z) / 2;
              b.x = right ? z : a - b.w; b.y = FY; L.fx(mc(), 15, '#ff7a1a', 16, 6); stun(K.by(2.4, 2.1, 1.8));
            }
            return;
          case 'stunned':
            b.stun -= dt;
            if (b.stun <= 0) { b.choke = false; L.sound('trap'); K.set('dashTell', { tellFor: 0.25 }); }
            return;
          case 'tongueTell':
            if (b.st >= b.tellFor) {
              K.set('tongue'); b.tongue = K.hz({ atk: 'tongue', x: mc(), y: 14.15, w: 0, h: 0.6, dir: b.face }); L.sound('jump');
            }
            return;
          case 'tongue': {   // out fast, a moment, back
            const len = b.st < 0.15 ? (b.st / 0.15) * 8 : b.st < 0.35 ? 8 : Math.max(0, 8 - ((b.st - 0.35) / 0.15) * 8);
            b.tongue.w = len; b.tongue.x = b.face > 0 ? b.x + b.w : b.x - len;
            if (b.st >= 0.5) { b.tongue.gone = true; idle(0.2, 0.5); }
            return;
          }
          case 'coinTell': if (b.st >= b.tellFor) { coins(); idle(0.4, 0.8); } return;
          case 'dashTell': if (b.st >= b.tellFor) { b.face = Math.sign(K.px() - mc()) || b.face; K.set('dash'); L.sound('jump'); } return;
          case 'dash': {
            b.x = clamp(b.x + b.face * K.by(12, 13, 14) * dt, 1, 31 - b.w);
            if (overPit(mc())) { K.set('lava'); b.vy = 3; L.sound('trap'); return; }   // dashed straight into the lava
            if (b.st >= 1.1 || b.x <= 1 || b.x >= 31 - b.w) idle(0.3, 0.6);
            return;
          }
          case 'hiding': if (b.st >= b.hideFor) reveal(); return;
          case 'hurt': if (b.st >= 0.5) idle(0.3, 0.5); return;
          default: return;
        }
      };
      // any touch is a bite: it swallows you (mash). Stunned, a touch is your STRIKE
      b.onTouch = (b, p) => {
        if (L.t < (b.safeUntil || 0)) return true;
        if (b.state === 'lava') return true;
        if (b.state === 'stunned') { strike(L, b, K, 'SLAM IT SHUT!', () => { L.say('it bit your sword'); K.set('dashTell', { tellFor: 0.2 }); }); return true; }
        swallowGrab(p); return true;
      };
      b.onHit = () => {
        K.set('hurt'); b.choke = false;
        const p = L.player, dir = Math.sign(mc() - K.px()) || 1;
        p.vx = -dir * 7; p.vy = -11 * L.g; p.grounded = false;
        for (let i = 0; i < 3; i++) L.fx(mc(), b.y + 0.5, '#ffd23f', 10, 7);
      };
      b.onPhase = () => {
        K.set('roar'); b.inv = 1.4; L.sound('trap'); L.shake(0.6, 0.6);
        const p = L.player, d = K.px() - mc();
        if (Math.abs(d) < 6) { p.vx = Math.sign(d) * 11; p.vy = -8 * L.g; p.grounded = false; }
      };
      b.onDefeat = () => L.playCine(outro(), () => { L.killBoss(b); L.win(); });

      function intro() {
        return {
          dur: 7.4,
          update(t) {
            walkIn(L, t, 13, 2.2);
            const p = L.player;
            if (t > 2.4 && t < 3.0) { p.x = 13 + ease((t - 2.4) / 0.6) * 3; p.vx = 4; } else if (t >= 3.0) { p.x = 16; p.vx = 0; }
            b.x = 24; b.y = FY; b.face = -1;
            b.lid = t > 3.2 && t < 3.6 ? 0.3 : t >= 4.0 ? 1 : 0;
            b.eyes = t > 3.4; b.legs = t > 4.0 ? 1 : 0;
            b.y = t > 4.0 && t < 4.6 ? FY - Math.sin(((t - 4.0) / 0.6) * Math.PI) * 1.4 : FY;
            K.cue(t, 3.2, () => L.sound('click'));
            K.cue(t, 4.0, () => { L.sound('trap'); L.shake(0.5, 0.6); for (let i = 0; i < 3; i++) L.fx(24.9, 14, '#ffd23f', 14, 8); });
            K.cue(t, 4.6, () => { L.sound('thud'); L.fx(24.9, 14.8, '#ff7a1a', 20, 7); });
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 0.4, 2.6, 'The molten core. And... treasure?');
            if (t > 4.0 && t < 5.2) ui.shout('MIMIC!');
            if (t > 5.3) ui.label('THE MIMIC', t - 5.3);
            ui.caption(t, 5.5, 7.3, 'the treasure bites back');
          },
          end() { b.lid = 0; b.legs = 0; b.eyes = false; b.y = FY; b.x = 24; const p = L.player; p.x = 16; p.vx = 0; },
        };
      }
      function outro() {
        K.once = {};   // the intro's cues are spent
        K.set('dying'); b.hidden = false; b.disguise = null; b.w = 1.8; b.h = 1.4; b.y = FY; decoys.length = 0;
        return {
          dur: 6.4,
          update(t) {
            b.lid = t < 1.6 ? Math.floor(t * 10) % 2 : 1;
            b.legs = t < 2.2 ? 1 : 0;
            b.burst = t > 1.8;
            if (t > 2.2) b.shrink = Math.min(1, (t - 2.2) / 1.2);
            K.cue(t, 0.1, () => { L.sound('trap'); L.shake(0.5, 0.6); });
            K.cue(t, 1.8, () => { L.sound('thud'); L.shake(0.6, 0.7); for (let i = 0; i < 6; i++) L.fx(mc(), b.y + 0.4, i % 2 ? '#ffd23f' : '#fff0a0', 30, 13); });
          },
          overlay(t, ui) {
            ui.bars();
            ui.caption(t, 2.6, 4.2, 'Gold everywhere. Some of it was teeth.');
            if (t > 4.3) ui.label('THE MIMIC', t - 4.3);
            ui.caption(t, 4.5, 6.4, 'was this the treasure?');
          },
        };
      }
      b.decoys = decoys;
      opening(L, b, intro(), (watched) => { if (watched) idle(0.3, 0.6); else { K.set('roar'); L.sound('trap'); } });
    },

    draw(b, L, t, D) {
      const r = D.r, o = '#0c080c';
      for (const h of L.hz) if (h.boss === b) drawCoreHz(h, b, t, D);
      for (const d of b.decoys || []) drawChest(d, d.kind, L, t, D);
      if (b.hidden) return;
      if (b.disguise) return drawChest(b, b.disguise, L, t, D);
      const flip = b.face > 0, sh = b.shrink || 0;
      if (b.burst && sh >= 1) return;
      D.at(flip ? b.x + b.w : b.x, b.y, () => {
        const W = 27, H = 21, wood = '#8a5a2b', dk = '#4a2e1a', gold = '#ffd23f';
        const legs = b.legs ? 1 : 0, step = Math.floor(t * 14) % 2, lift = legs ? 6 : 0;
        const stunned = b.state === 'stunned' || b.state === 'struck';
        if (legs) for (let i = 0; i < 4; i++) {   // four spidery legs
          const lx = 2 + i * 7, up = (i + step) % 2 ? 2 : 0;
          r(lx, H - 7 + up, 2, 7 - up, o); r(lx - 2, H - 1, 4, 1, o);
        }
        const by = 8 - lift, open = Math.round((b.lid || 0) * 6) + (b.state === 'leapTell' && !D.calm ? Math.floor(t * 16) % 2 * 2 : 0);
        r(0, by, W, H - 8, o); r(1, by + 1, W - 2, H - 10, wood); r(1, by + H - 11, W - 2, 2, dk); r(0, by + 4, W, 2, gold);
        r(W / 2 - 2, by + 2, 4, 4, gold);
        r(0, by - 8 - open, W, 8, o); r(1, by - 7 - open, W - 2, 6, wood); r(0, by - 2 - open, W, 2, gold);   // lid
        if (open) {
          r(1, by - open, W - 2, open, '#3a0a10');
          for (let i = 2; i < W - 2; i += 4) { r(i, by - open, 2, 2, '#f4ecd8'); r(i + 1, by - 2, 2, 2, '#f4ecd8'); }
          r(6, by - open + 2, 3, 2, stunned ? '#6a5a20' : '#ffe27a'); r(W - 9, by - open + 2, 3, 2, stunned ? '#6a5a20' : '#ffe27a');
        } else if (b.eyes) { r(6, by - 2, 3, 1, '#ffe27a'); r(W - 9, by - 2, 3, 1, '#ffe27a'); }
        if (b.state === 'lava' && !D.calm) for (let i = 0; i < 4; i++) r(3 + i * 6, by - 10 - ((Math.floor(t * 12) + i) % 3) * 2, 3, 3, i % 2 ? '#ffd23f' : '#ff7a1a');
        if (stunned && !D.calm) for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; r(Math.round(13 + Math.cos(a) * 10), Math.round(by - 12 + Math.sin(a) * 2), 2, 2, '#ffe27a'); }
      }, flip);
    },
  };
  // a chest disguise: a crate, or a portal that is just like the real one
  function drawChest(d, kind, L, t, D) {
    if (kind === 'door') D.door({ x: d.x, y: d.y, w: d.w, h: d.h }, t, L);
    else D.crate({ x: d.x, y: d.y, w: d.w, h: d.h });
  }
  function drawCoreHz(h, b, t, D) {
    const r = D.r, o = '#0c080c';
    if (h.atk === 'tongue' && h.w > 0) {
      D.at(h.x, h.y, () => { const w = Math.round(h.w * 15); r(0, 1, w, 7, o); r(0, 2, w, 5, '#e0607a'); r(0, 3, w, 1, '#f4a0b0'); const tip = b.face > 0 ? w - 4 : 0; r(tip, 0, 4, 9, '#e0607a'); }, false);
    } else if (h.atk === 'coins') {
      D.disc(h.x, h.y, 4, h.live ? '#ffd23f' : '#ff7a1a'); D.disc(h.x, h.y, 2, '#fff0a0');
    } else if (h.atk === 'lava') {
      if (!h.live) { const k = 1 - h.warn / 0.7; for (let i = 0; i < 4; i++) D.R(h.x * 30 + 6 + i * 13, 16.4 * 30 - ((t * 120 + i * 23) % (20 + k * 60)), 6, 6, i % 2 ? '#ffd23f' : '#ff7a1a'); return; }
      D.R(h.x * 30, h.y * 30, h.w * 30, h.h * 30, 'rgba(255,122,26,0.85)');
      D.R(h.x * 30 + 8, h.y * 30, h.w * 30 - 16, h.h * 30, '#ffd23f');
    }
  }

  window.BOSSES = B;
})();
