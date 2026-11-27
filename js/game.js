(() => {
  'use strict';

  // ---------------------------------------------------------------- constants
  const TILE = 30, COLS = 32, ROWS = 18, VW = COLS * TILE, VH = ROWS * TILE;
  const STEP = 1 / 120;
  const EPS = 1e-4;
  const P = {
    grav: 62, jump: 20.5, speed: 8, accG: 90, accA: 60, fric: 80,
    maxFall: 28, coyote: 0.08, buffer: 0.12, w: 0.8, h: 0.9,
  };
  // the descent palette: dungeon stone, bone, fire-gold portal light
  const C = {
    bg1: '#16121c', bg2: '#221b2a',
    block: '#4a4352', blockTop: '#6d6578', blockEdge: '#6b6b78',
    spike: '#d8ccb0', player: '#c83a4a', playerDark: '#7a1c2e', eye: '#0c080c',
    portal: '#ffae35', danger: '#e0453a', text: '#e8dcc0', dim: 'rgba(232,220,192,0.4)',
    pad: '#9a48ec', flag: '#5cc83a', saw: '#a8754f',
    crate: '#8a5a2b', crateDark: '#4a2e1a',
  };
  const LINK = { orange: '#ff9f43', green: '#5cff8f', purple: '#a77bff', red: '#ff3b5c', blue: '#4fb6ff' };
  const FONT = '"BoldPixels", ui-monospace, monospace';
  const SKINS = [
    { main: '#c83a4a', dark: '#7a1c2e', hi: '#e8707a', plume: '#ffd23f', name: 'RED' },
    { main: '#3a7ac8', dark: '#1c3e7a', hi: '#70a8e8', plume: '#ff8a2a', name: 'BLUE' },
  ];
  const STRIKES = 3; // deaths in one level (2-player modes) before you get sent back
  const ROPE = 4.2; // chain length in tiles (special mode)
  const MODES = [
    {
      id: 'single', name: 'SINGLE PLAYER', sub: 'you vs. the level', players: 1,
      hint: '←/→ or A/D move · SPACE / ↑ / W jump'
    },
    {
      id: 'multi', name: 'MULTIPLAYER', sub: '2P · one keyboard', players: 2,
      hint: 'P1: A/D move, W jump   ·   P2: ←/→ move, ↑ jump'
    },
    {
      id: 'special', name: 'SPECIAL', sub: '2P · trust us', players: 2, chained: true,
      label: 'SPECIAL (CHAINED)', hint: 'P1: A/D move, W jump   ·   P2: ←/→ move, ↑ jump'
    },
  ];
  const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));
  const course = (mode) => LEVELS[mode];
  // single-player keys stay numeric so old saves keep their per-level death counts
  const dkey = (mode, idx) => (mode === 'single' ? String(idx) : `${mode}:${idx}`);

  const DEATH_LINES = [
    'skill issue', 'did you even look?', 'the floor was lava. sort of.', 'classic.',
    'that was on purpose, right?', 'again!', 'we saw that.', 'so close. not really.',
    'have you tried not dying?', 'trust no tile.', 'muscle memory: 0', 'press R to cope',
    'ouch.', 'the level says hi.', 'bold strategy.', 'noted for the highlight reel.',
    'that one was mean, sorry. (not sorry)', 'gravity: 1, you: 0', 'certified rage moment',
  ];
  const TEAM_LINES = [
    'blame your partner.', 'teamwork makes the dream... die.', 'friendship ended.',
    'who was that?', 'that was NOT a team effort.', 'you both lose. together.',
  ];
  // {v} = victim, {o} = the other player
  const BLAME_LINES = [
    '{o}, this is on you.', '{v} is the weak link.', '{o} saw that coming.', '{v} trusted {o}. mistake.',
    'carried by {o}? not today.', '{v} needs a new partner.', '{o} is typing an apology...',
  ];
  const MOCK_LINES = [
    '{l} died {n} times. {w} did the work.', '{w} carried. {l} was luggage.', '{l}: {n} deaths. legendary.',
    '{l} should hold the controller the right way up.', '{w} would like a refund on {l}.',
  ];
  const CHAIN_LINES = ['you dragged them, didn\'t you', 'til death do you part. so, now.', 'dead weight.'];

  // ---------------------------------------------------------------- save data
  const SAVE_KEY = 'ragebait.save.v1';
  const save = (() => {
    const def = { unlocked: 1, deaths: 0, levelDeaths: {}, muted: false };
    let s;
    try { s = Object.assign(def, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); }
    catch (e) { s = def; }
    s.progress = Object.assign({ single: s.unlocked || 1, multi: 1, special: 1 }, s.progress || {});
    s.shame = Object.assign({ multi: [0, 0], special: [0, 0] }, s.shame || {});
    return s;
  })();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  // admin panel settings: session only, never saved
  const admin = { unlock: false, god: false, speed: 1, mode: 0, sel: 0, confirmReset: false, back: 'title' };

  // ---------------------------------------------------------------- audio
  let actx = null;
  function audioOn() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (actx.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
    if (!actx || save.muted) return;
    const t0 = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol = 0.15) {
    if (!actx || save.muted) return;
    const len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = actx.createBufferSource(), g = actx.createGain();
    s.buffer = buf; g.gain.value = vol; s.connect(g).connect(actx.destination); s.start();
  }
  const sfx = {
    jump: () => tone(440, 0.1, 'square', 0.04, 320),
    die: () => { noise(0.3, 0.18); tone(180, 0.35, 'sawtooth', 0.06, -140); },
    trap: () => tone(110, 0.18, 'triangle', 0.12, -60),
    thud: () => { noise(0.18, 0.2); tone(70, 0.2, 'sine', 0.2, -30); },
    pop: () => tone(1200, 0.06, 'square', 0.04, -700),
    flip: () => tone(260, 0.22, 'sine', 0.09, 520),
    move: () => tone(700, 0.15, 'triangle', 0.05, 500),
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'square', 0.05, 0, i * 0.07)),
    reveal: () => tone(880, 0.08, 'triangle', 0.06, 200),
    click: () => tone(600, 0.04, 'square', 0.03),
  };

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const overlap = (a, b) =>
    a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const solid = (b) => b.solid && !b.gone;

  function spikeBox(s) {
    return s.dir === 'up'
      ? { x: s.x + 0.12, y: s.y - 0.48, w: s.w - 0.24, h: 0.48 }
      : { x: s.x + 0.12, y: s.y, w: s.w - 0.24, h: 0.48 };
  }
  function padBox(p) { return p.g < 0 ? { x: p.x, y: p.y - 0.25, w: p.w, h: 0.25 } : { x: p.x, y: p.y, w: p.w, h: 0.25 }; }
  function doorBox(d) { return { x: d.x + 0.2, y: d.y + 0.2, w: d.w - 0.4, h: d.h - 0.3 }; }

  // ---------------------------------------------------------------- input
  // ctl[i] is what player i is holding; pressed[i] holds fresh jump presses.
  const ctl = [{ left: false, right: false, jump: false }, { left: false, right: false, jump: false }];
  const pressed = [new Set(), new Set()];
  const down = new Set();
  const touch = { left: false, right: false, jump: false };
  const pad = [{ left: false, right: false, jump: false }, { left: false, right: false, jump: false }];
  const padPrev = [{}, {}];
  let padCount = 0, hadPad = false;
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  };
  const P2_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp']);
  // in 2-player modes the arrow keys belong to player 2; everything else is player 1
  function owner(code) { return MODE[game.mode].players > 1 && P2_KEYS.has(code) ? 1 : 0; }
  function syncCtl() {
    for (const c of ctl) c.left = c.right = c.jump = false;
    for (const code of down) { const k = KEYMAP[code]; if (k) ctl[owner(code)][k] = true; }
    for (const k in touch) if (touch[k]) ctl[0][k] = true;
    for (let i = 0; i < 2; i++) for (const k in pad[i]) if (pad[i][k]) ctl[i][k] = true;
  }
  function pollPads() {
    const raw = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    const gps = raw ? Array.from(raw).filter(Boolean) : [];
    padCount = gps.length;
    if (!padCount) {
      if (!hadPad) return;
      hadPad = false;
      for (let i = 0; i < 2; i++) { pad[i].left = pad[i].right = pad[i].jump = false; padPrev[i] = {}; }
      syncCtl();
      return;
    }
    hadPad = true;
    const multi = MODE[game.mode].players > 1;
    for (let i = 0; i < 2; i++) pad[i].left = pad[i].right = pad[i].jump = false;
    gps.slice(0, 2).forEach((gp, idx) => {
      const slot = multi ? idx : 0, b = gp.buttons || [], ax = gp.axes || [];
      const btn = (n) => !!(b[n] && (b[n].pressed || b[n].value > 0.5));
      const cur = {
        left: btn(14) || (ax[0] || 0) < -0.35,
        right: btn(15) || (ax[0] || 0) > 0.35,
        up: btn(12) || (ax[1] || 0) < -0.5,
        down: btn(13) || (ax[1] || 0) > 0.5,
        jump: btn(0) || btn(2) || btn(12),
        ok: btn(0) || btn(9),
        back: btn(1),
        aux: btn(3),
        pause: btn(9),
        sel: btn(8),
      };
      const prev = padPrev[idx], edge = (k) => cur[k] && !prev[k];
      if (Object.keys(cur).some(edge)) audioOn();
      if (game.state === 'play') {
        if (cur.left) pad[slot].left = true;
        if (cur.right) pad[slot].right = true;
        if (cur.jump) pad[slot].jump = true;
        if (edge('jump')) pressed[slot].add('jump');
        if (edge('aux') || edge('sel')) onKey('KeyR');
        else if (edge('pause')) onKey('Escape');
      } else {
        if (edge('left')) onKey('ArrowLeft');
        if (edge('right')) onKey('ArrowRight');
        if (edge('up')) onKey('ArrowUp');
        if (edge('down')) onKey('ArrowDown');
        if (edge('ok')) onKey('Enter');
        else if (edge('back')) onKey('Escape');
        else if (edge('aux') && game.state === 'mode') onKey('KeyL');
      }
      padPrev[idx] = cur;
    });
    syncCtl();
  }
  addEventListener('keydown', (e) => {
    audioOn();
    const k = KEYMAP[e.code];
    if (k) {
      if (!down.has(e.code)) { down.add(e.code); if (k === 'jump') pressed[owner(e.code)].add('jump'); }
      syncCtl(); e.preventDefault();
    }
    if (!e.repeat) onKey(e.code);
  });
  addEventListener('keyup', (e) => { down.delete(e.code); syncCtl(); });
  addEventListener('blur', () => { down.clear(); touch.left = touch.right = touch.jump = false; for (const p of pad) p.left = p.right = p.jump = false; syncCtl(); });

  // touch buttons (always player 1)
  const touchEl = document.getElementById('touch');
  if (matchMedia('(pointer: coarse)').matches) touchEl.hidden = false;
  touchEl.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.key;
    const on = (e) => {
      e.preventDefault(); audioOn(); btn.classList.add('on');
      if (k === 'restart') { onKey('KeyR'); return; }
      if (!touch[k] && k === 'jump') pressed[0].add('jump');
      touch[k] = true; syncCtl();
      if (k === 'jump' && game.state !== 'play') onKey('Enter');
    };
    const off = (e) => { e.preventDefault(); btn.classList.remove('on'); if (k !== 'restart') { touch[k] = false; syncCtl(); } };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });

  // ---------------------------------------------------------------- particles & fx
  let particles = [];
  function burst(x, y, color, n = 24, speed = 9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, life: 0.6 + Math.random() * 0.5, t: 0, color, size: 0.12 + Math.random() * 0.18 });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) { p.t += dt; p.vy += 30 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter((p) => p.t < p.life);
  }

  // ---------------------------------------------------------------- level runtime
  function makePlayer(x, floorY, idx) {
    return {
      idx, x, y: floorY - P.h, w: P.w, h: P.h, vx: 0, vy: 0, face: 1,
      grounded: false, ground: null, coy: 0, buf: 0, hang: 0, jumping: false, cut: false, lagged: false,
      jq: [], dead: false, done: false, taut: false, sx: 1, sy: 1,
    };
  }

  class Level {
    constructor(idx, modeId = 'single') {
      this.idx = idx;
      this.mode = MODE[modeId];
      this.def = course(modeId)[idx];
      this.chained = !!this.mode.chained;
      this.blocks = []; this.spikes = []; this.saws = []; this.lasers = []; this.pads = []; this.flags = []; this.ladders = [];
      this.doors = []; this.texts = []; this.bubbles = [];
      this.buttons = []; this.gates = []; this.jumpHooks = [];
      this.rope = ROPE; this.snagT = 0; this.view = { mirror: false, flip: false };
      this.triggers = []; this.timers = [];
      this.g = 1; this.invert = false; this.swap = false; this.jumpDelay = 0; this.speedMul = 1; this.t = 0;
      this.banner = null; this.won = false; this.over = false; this.shakeT = 0; this.shakeMag = 0;
      this.spawnPt = { x: 2, y: 15 }; this.spawnPt2 = null;
      this.players = [];
      this.cur = null;
      this.def.build(this);
      const s = this.spawnPt;
      for (let i = 0; i < this.mode.players; i++) {
        const sp = i === 1 && this.spawnPt2 ? this.spawnPt2 : { x: s.x + i * 1.3, y: s.y };
        this.players.push(makePlayer(sp.x, sp.y, i));
      }
      this.cur = this.players[0];
    }

    // ---- build API
    spawn(x, floorY) { this.spawnPt = { x, y: floorY }; }
    spawn2(x, floorY) { this.spawnPt2 = { x, y: floorY }; }
    // pressure plate; down while a player or crate rests on it
    button(x, floorY, w = 1.4, o = {}) {
      const b = { kind: 'button', x, y: floorY, w, color: LINK[o.color || 'orange'], down: false, held: 0, latched: false, latch: !!o.latch };
      this.buttons.push(b); return b;
    }
    // block that slides by (dx, dy) while open() is true and back when false
    gate(b, dx, dy, open, o = {}) {
      const g = { b, x0: b.x, y0: b.y, dx, dy, open, speed: o.speed || 8, closeSpeed: o.closeSpeed || o.speed || 8 };
      b.link = o.color ? LINK[o.color] : null;
      this.gates.push(g); return g;
    }
    // o.mimic: looks like a crate; touch it and it grows spikes, then crumbles away
    crate(x, floorY, size = 1, o = {}) { return this.block(x, floorY - size, size, size, { crate: true, mimic: !!o.mimic, armed: 0, spiky: false }); }
    onJump(fn) { this.jumpHooks.push(fn); }
    setRope(n) { if (this.rope !== n) { this.rope = n; if (this.chained) { this.say(n < ROPE ? 'chain shrank!' : 'chain stretched!'); sfx.flip(); } } }
    yank(p, vx, vy) { p.vx = vx; p.vy = vy; p.grounded = false; p.ground = null; p.onP = null; }
    swapPlaces() {
      const [a, b] = this.players;
      if (!a || !b || a.dead || b.dead || a.done || b.done) return;
      for (const k of ['x', 'y', 'vx', 'vy']) { const t = a[k]; a[k] = b[k]; b[k] = t; }
      for (const q of [a, b]) { q.grounded = false; q.ground = null; q.onP = null; burst(q.x + q.w / 2, q.y + q.h / 2, C.pad, 14, 6); }
      this.cur = a; this.say('swap places!'); sfx.flip();
    }
    mirror(on = true) { this.view.mirror = on; if (on) this.say('mirror mode'); sfx.flip(); }
    flipView(on = true) { this.view.flip = on; if (on) this.say('which way is up?'); sfx.flip(); }
    moveBlock(b, x, y, speed = 8) { b.goal = { x, y, speed }; }
    block(x, y, w, h, o = {}) {
      const b = {
        kind: 'block', x, y, w, h, vy: 0, dx: 0, dy: 0, solid: true, hidden: false, crumble: 0,
        pending: false, falling: false, shakeT: 0, land: false, gone: false, flash: 0, sparkle: Math.random() * 3, ...o
      };
      this.blocks.push(b); return b;
    }
    spike(x, y, w, dir = 'up', o = {}) {
      const L = this;
      const s = {
        kind: 'spike', x, y, w, dir, fake: !!o.fake, out: o.hidden ? 0 : 1, target: o.hidden ? 0 : 1,
        pop() { if (s.target !== 1) { s.target = 1; sfx.pop(); L.shake(0.08, 0.08); } },
        hide() { s.target = 0; }
      };
      this.spikes.push(s); return s;
    }
    door(x, floorY, o = {}) {
      const d = { kind: 'door', x, y: floorY - 1.6, w: 1.2, h: 1.6, fake: !!o.fake, tween: null, spin: 0 };
      this.doors.push(d); return d;
    }
    saw(cx, cy, r, o = {}) { const s = { kind: 'saw', x: cx, y: cy, r, vx: 0, vy: 0, rot: 0, buried: !!o.buried }; this.saws.push(s); return s; }
    // beam over the rect that is on for o.on seconds, then off for o.off; o.phase shifts the cycle
    laser(x, y, w, h, o = {}) {
      const l = { kind: 'laser', x, y, w, h, on: o.on || 1, off: o.off || 1, phase: o.phase || 0, live: false, warn: false };
      this.lasers.push(l); return l;
    }
    ladder(x, y, w, h) { const l = { kind: 'ladder', x, y, w, h }; this.ladders.push(l); return l; }
    pad(x, y, w, g) { const p = { kind: 'pad', x, y, w, g }; this.pads.push(p); return p; }
    flag(x, floorY) { const f = { kind: 'flag', x, y: floorY - 2.2, w: 1, h: 2.2, evil: false }; this.flags.push(f); return f; }
    text(x, y, str) { this.texts.push({ x, y, str }); }

    // ---- scripting API
    // Trigger conditions are checked once per active player; L.player / L.px / L.near / L.touch
    // refer to whichever player is being checked, so level scripts work in every mode.
    on(cond, fn, o = {}) { this.triggers.push({ cond, fn, repeat: !!o.repeat, done: false }); }
    wait(sec, fn) { this.timers.push({ at: this.t + sec, fn }); }
    drop(b, delay = 0, o = {}) {
      if (b.pending || b.falling) return;
      b.pending = true; b.shakeT = delay; b.land = !!o.land;
    }
    moveDoor(d, x, floorY, speed = 30) { d.tween = { x, y: floorY - d.h, speed }; sfx.move(); }
    say(str) { this.bubbles.push({ str, t: 0, p: this.cur }); }
    shake(t = 0.2, mag = 0.25) { this.shakeT = Math.max(this.shakeT, t); this.shakeMag = Math.max(this.shakeMag, mag); }
    fakeWin() { this.banner = { text: 'LEVEL COMPLETE', sub: 'well done!', t: 0 }; sfx.win(); }
    get deaths() { return save.levelDeaths[dkey(this.mode.id, this.idx)] || 0; }
    get player() { return this.cur; }
    get other() { return this.players.find((p) => p !== this.cur); }
    all(fn) { const was = this.cur, ps = this.active(); let ok = ps.length > 0; for (const p of ps) { this.cur = p; if (!fn(p)) { ok = false; break; } } this.cur = was; return ok; }
    count(fn) { const was = this.cur; let n = 0; for (const p of this.active()) { this.cur = p; if (fn(p)) n++; } this.cur = was; return n; }
    any(fn) { const was = this.cur; let ok = false; for (const p of this.active()) { this.cur = p; if (fn(p)) { ok = true; break; } } this.cur = was; return ok; }
    get px() { return this.cur.x + this.cur.w / 2; }
    get py() { return this.cur.y + this.cur.h / 2; }
    near(o, d) { return Math.hypot(o.x + o.w / 2 - this.px, o.y + o.h / 2 - this.py) < d; }
    touch(o) { return overlap(this.cur, o.kind === 'door' ? doorBox(o) : o); }
    active() { return this.players.filter((p) => !p.dead && !p.done); }

    // ---- simulation
    step(dt) {
      this.t += dt;
      if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeMag = 0; }
      if (this.banner) {
        this.banner.t += dt;
        if (this.banner.life && this.banner.t > this.banner.life) this.banner = null;
      }
      for (const b of this.bubbles) b.t += dt;
      this.bubbles = this.bubbles.filter((b) => b.t < 1.4);

      for (let i = this.timers.length - 1; i >= 0; i--) {
        const tm = this.timers[i];
        if (this.t >= tm.at) { this.timers.splice(i, 1); tm.fn(); }
      }
      const live = () => !this.over && !this.won;
      this.updateButtons(dt);
      if (live()) {
        for (let i = 0; i < this.triggers.length; i++) {
          const tr = this.triggers[i];
          if (tr.done) continue;
          for (const p of this.active()) {
            this.cur = p;
            if (tr.cond()) { tr.fn(); if (!tr.repeat) tr.done = true; break; }
          }
        }
      }
      this.cur = this.active()[0] || this.players[0];

      this.stepWorld(dt);
      if (live()) for (const p of this.active()) this.stepPlayer(p, dt);
      if (live() && this.chained) this.chain();
      if (live()) for (const p of this.active()) { this.checkContacts(p); if (!live()) break; }
    }

    updateButtons(dt) {
      const ps = this.active();
      for (const bt of this.buttons) {
        const zone = { x: bt.x, y: bt.y - 0.4, w: bt.w, h: 0.45 };
        const was = bt.down;
        bt.down = bt.latched || ps.some((p) => overlap(p, zone)) || this.blocks.some((b) => b.crate && !b.gone && overlap(b, zone));
        if (bt.down && bt.latch) bt.latched = true;
        bt.held = bt.down ? bt.held + dt : 0;
        if (bt.down && !was) sfx.click();
      }
    }

    stepWorld(dt) {
      const ps = this.active();
      for (const g of this.gates) {
        const op = !!g.open();
        const tx = g.x0 + (op ? g.dx : 0), ty = g.y0 + (op ? g.dy : 0);
        if (!g.b.goal || g.b.goal.x !== tx || g.b.goal.y !== ty) g.b.goal = { x: tx, y: ty, speed: op ? g.speed : g.closeSpeed };
      }
      for (const b of this.blocks) {
        if (b.gone) continue;
        const ox = b.x, oy = b.y;
        if (b.goal && !b.falling) {
          const gx = b.goal.x - b.x, gy = b.goal.y - b.y, dist = Math.hypot(gx, gy), mv = b.goal.speed * dt;
          if (dist <= mv) { b.x = b.goal.x; b.y = b.goal.y; } else { b.x += (gx / dist) * mv; b.y += (gy / dist) * mv; }
        }
        if (b.crate && !b.falling) {
          b.vy = Math.min(b.vy + P.grav * dt, P.maxFall);
          b.y += b.vy * dt;
          for (const o of this.blocks) {
            if (o === b || !solid(o) || !overlap(b, o)) continue;
            if (b.vy > 0) { if (b.vy > 6) sfx.thud(); b.y = o.y - b.h; } else b.y = o.y + o.h;
            b.vy = 0;
          }
          if (b.y > ROWS + 4) b.gone = true;
        }
        if (b.mimic && !b.gone) {
          const zone = { x: b.x - 0.06, y: b.y - 0.06, w: b.w + 0.12, h: b.h + 0.12 };
          const toucher = ps.find((p) => overlap(p, zone));
          if (!b.armed && toucher) { b.armed = this.t; sfx.trap(); this.cur = toucher; this.say('that is not a crate'); }
          if (b.armed && !b.spiky && this.t - b.armed > 0.25) { b.spiky = true; sfx.pop(); }
          if (b.spiky && toucher) this.kill(toucher, 'mimic');
          if (b.armed && this.t - b.armed > 1.75) { b.gone = true; burst(b.x + b.w / 2, b.y + b.h / 2, C.crate, 20, 6); }
        }
        if (b.flash > 0) b.flash -= dt;
        if (b.crumble && !b.pending && !b.falling && ps.some((p) => p.ground === b)) this.drop(b, b.crumble);
        if (b.pending) {
          b.shakeT -= dt;
          if (b.shakeT <= 0) { b.pending = false; b.falling = true; sfx.trap(); }
        }
        if (b.falling) {
          const f = b.fall || 1;   // block option: fall faster (broken platforms)
          b.vy = Math.min(b.vy + P.grav * 1.4 * f * dt, 40 * f);
          b.y += b.vy * dt;
          if (b.land) {
            for (const o of this.blocks) {
              if (o !== b && solid(o) && !o.falling && overlap(b, o)) {
                b.y = o.y - b.h; b.vy = 0; b.falling = false; b.land = false;
                this.shake(0.3, 0.35); sfx.thud();
                burst(b.x + b.w / 2, b.y + b.h, C.block, 18, 6);
              }
            }
          }
          if (b.y > ROWS + 6) b.gone = true;
        }
        b.dx = b.x - ox; b.dy = b.y - oy;
      }

      for (const p of ps) {
        if (this.over) break;
        // carry the player horizontally with whatever (or whoever) they stand on
        if (p.ground && p.ground.dx) p.x += p.ground.dx;
        if (p.onP && !p.onP.dead && !p.onP.done) p.x += p.onP.lastDx || 0;
        // moving solids push (and crush) the player
        for (const b of this.blocks) {
          if (!solid(b) || (!b.dx && !b.dy) || !overlap(p, b)) continue;
          if (Math.abs(b.dy) >= Math.abs(b.dx)) { p.y = b.dy > 0 ? b.y + b.h : b.y - p.h; p.vy = b.vy || 0; }
          else p.x = b.dx > 0 ? b.x + b.w : b.x - p.w;
          for (const o of this.blocks) {
            if (o !== b && solid(o) && overlap(p, o)) { this.kill(p, 'crushed'); break; }
          }
          if (this.over) break;
        }
      }

      for (const s of this.spikes) s.out = approach(s.out, s.target, dt * 14);
      for (const s of this.saws) { s.x += s.vx * dt; s.y += s.vy * dt; s.rot += dt * 12; }
      for (const l of this.lasers) {
        const c = (this.t + l.phase) % (l.on + l.off);
        l.live = c < l.on; l.warn = !l.live && c > l.on + l.off - 0.35;
      }
      for (const d of this.doors) {
        d.spin += dt;
        if (d.tween) {
          const tw = d.tween, dx = tw.x - d.x, dy = tw.y - d.y, dist = Math.hypot(dx, dy), mv = tw.speed * dt;
          if (dist <= mv) { d.x = tw.x; d.y = tw.y; d.tween = null; }
          else { d.x += (dx / dist) * mv; d.y += (dy / dist) * mv; }
        }
      }
    }

    stepPlayer(p, dt) {
      const g = this.g, src = this.swap ? 1 - p.idx : p.idx, c = ctl[src], pr = pressed[src];
      const x0 = p.x;
      let dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
      if (this.invert) dir = -dir;
      let acc = p.grounded ? P.accG : P.accA;
      if (!dir && p.grounded) acc = P.fric;
      p.vx = approach(p.vx, dir * P.speed * this.speedMul, acc * this.speedMul * dt);
      if (dir) p.face = dir;

      // jump input (optionally lagged)
      if (pr.has('jump')) {
        pr.delete('jump');
        if (this.jumpDelay > 0) p.jq.push(this.t + this.jumpDelay);
        else { p.buf = P.buffer; p.lagged = false; }
      }
      while (p.jq.length && p.jq[0] <= this.t) { p.jq.shift(); p.buf = 0.04; p.lagged = true; }
      p.buf -= dt;
      p.coy = p.grounded ? P.coyote : p.coy - dt;
      p.hang -= dt;
      if (p.buf > 0 && (p.coy > 0 || p.hang > 0)) {
        p.vy = -P.jump * g; p.buf = 0; p.coy = 0; p.hang = 0; p.grounded = false; p.ground = null;
        p.jumping = !p.lagged; p.cut = false; p.sx = 0.7; p.sy = 1.3; sfx.jump();
        const was = this.cur; this.cur = p;
        for (const fn of this.jumpHooks) fn(p);
        this.cur = was;
      }
      if (p.jumping && !p.cut && !c.jump && p.vy * g < 0) { p.vy *= 0.5; p.cut = true; }

      p.vy = clamp(p.vy + P.grav * g * dt, -P.maxFall, P.maxFall);
      // ladders: hold jump to climb, otherwise slide down slowly
      if (this.ladders.some((l) => overlap(p, l))) p.vy = c.jump ? -6 * g : Math.min(p.vy * g, 2) * g;

      // horizontal
      p.x += p.vx * dt;
      for (const b of this.blocks) {
        if (!solid(b) || !overlap(p, b)) continue;
        if (b.crate && p.vx && this.pushCrate(b, p.vx > 0 ? p.x + p.w - b.x : p.x - (b.x + b.w))) continue;
        this.reveal(b);
        if (p.vx > 0) p.x = b.x - p.w; else if (p.vx < 0) p.x = b.x + b.w;
        p.vx = 0;
      }
      if (p.x < 0) { p.x = 0; p.vx = 0; }
      if (p.x > COLS - p.w) { p.x = COLS - p.w; p.vx = 0; }

      // vertical
      const was = p.grounded;
      p.grounded = false; p.ground = null; p.onP = null;
      const foot0 = g > 0 ? p.y + p.h : p.y;
      p.y += p.vy * dt;
      for (const b of this.blocks) {
        if (!solid(b) || !overlap(p, b)) continue;
        this.reveal(b);
        if (p.vy > 0) p.y = b.y - p.h; else if (p.vy < 0) p.y = b.y + b.h;
        if (p.vy * g > 0) { p.grounded = true; p.ground = b; }
        p.vy = 0;
      }
      // players can stand on each other's heads
      if (p.vy * g >= 0) {
        for (const q of this.active()) {
          if (q === p || !overlap(p, q)) continue;
          const head = g > 0 ? q.y : q.y + q.h;
          if (g > 0 ? foot0 <= head + 0.12 : foot0 >= head - 0.12) {
            p.y = g > 0 ? q.y - p.h : q.y + q.h;
            p.vy = 0; p.grounded = true; p.onP = q;
          }
        }
      }
      p.lastDx = p.x - x0;
      if (p.grounded && !was) { p.sx = 1.25; p.sy = 0.78; p.jumping = false; }
      p.sx = approach(p.sx, 1, dt * 4); p.sy = approach(p.sy, 1, dt * 4);
    }

    // try to shove a crate sideways by amt tiles; returns false if it is blocked
    pushCrate(b, amt) {
      const ox = b.x;
      b.x += amt;
      let ok = b.x >= 0 && b.x + b.w <= COLS;
      if (ok) for (const o of this.blocks) if (o !== b && solid(o) && overlap(b, o)) { ok = false; break; }
      if (!ok) { b.x = ox; return false; }
      b.dx = (b.dx || 0) + amt;
      return true;
    }

    // Special mode: keep the two players within ROPE of each other. Whoever stands on solid
    // ground is the heavier anchor, and a player dangling from an anchored partner may jump.
    chain() {
      const [a, b] = this.players;
      a.taut = b.taut = false;
      if (a.dead || b.dead) return;
      const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
      this.snagCheck(ax, ay, bx, by);
      if (d <= this.rope || d === 0) return;
      const nx = dx / d, ny = dy / d, ex = d - this.rope;
      let wa = a.grounded ? 0.2 : 1, wb = b.grounded ? 0.2 : 1;
      const sum = wa + wb; wa /= sum; wb /= sum;
      a.x += nx * ex * wa; a.y += ny * ex * wa;
      b.x -= nx * ex * wb; b.y -= ny * ex * wb;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) { a.vx += nx * rel * wa; a.vy += ny * rel * wa; b.vx -= nx * rel * wb; b.vy -= ny * rel * wb; }
      a.taut = b.taut = true;
      this.unstick(a); this.unstick(b);
      if (!a.grounded && b.grounded) a.hang = P.coyote;
      if (!b.grounded && a.grounded) b.hang = P.coyote;
    }

    // the chain catches on popped spikes and saws: both players get yanked toward each other
    snagCheck(ax, ay, bx, by) {
      if (this.t < this.snagT) return;
      for (let i = 1; i < 10; i++) {
        const x = ax + ((bx - ax) * i) / 10, y = ay + ((by - ay) * i) / 10;
        const pt = { x: x - 0.05, y: y - 0.05, w: 0.1, h: 0.1 };
        const hit = this.spikes.some((s) => !s.fake && s.out > 0.6 && overlap(pt, spikeBox(s))) || this.saws.some((s) => Math.hypot(s.x - x, s.y - y) < s.r);
        if (!hit) continue;
        const [a, b] = this.players, dir = Math.sign(bx - ax) || 1;
        this.yank(a, dir * 7, -9 * this.g); this.yank(b, -dir * 7, -9 * this.g);
        this.snagT = this.t + 1; this.cur = a; this.say('chain snagged!'); sfx.thud(); this.shake(0.15, 0.2);
        burst(x, y, C.saw, 10, 5);
        return;
      }
    }

    unstick(p) {
      for (const b of this.blocks) {
        if (!solid(b) || !overlap(p, b)) continue;
        this.reveal(b);
        const l = p.x + p.w - b.x, r = b.x + b.w - p.x, u = p.y + p.h - b.y, dn = b.y + b.h - p.y;
        const m = Math.min(l, r, u, dn);
        if (m === l) { p.x -= l; p.vx = Math.min(p.vx, 0); }
        else if (m === r) { p.x += r; p.vx = Math.max(p.vx, 0); }
        else if (m === u) { p.y -= u; if (p.vy > 0) p.vy = 0; if (this.g > 0) { p.grounded = true; p.ground = b; } }
        else { p.y += dn; if (p.vy < 0) p.vy = 0; if (this.g < 0) { p.grounded = true; p.ground = b; } }
      }
      p.x = clamp(p.x, 0, COLS - p.w);
    }

    reveal(b) {
      if (!b.hidden) return;
      b.hidden = false; b.flash = 0.4; sfx.reveal();
      burst(b.x + b.w / 2, b.y + b.h / 2, C.portal, 12, 5);
    }

    checkContacts(p) {
      for (const s of this.spikes) if (!s.fake && s.out > 0.6 && overlap(p, spikeBox(s))) return this.kill(p, 'spikes');
      for (const s of this.saws) {
        const cx = clamp(s.x, p.x, p.x + p.w), cy = clamp(s.y, p.y, p.y + p.h);
        if (Math.hypot(s.x - cx, s.y - cy) < s.r * 0.82) return this.kill(p, 'saw');
      }
      for (const l of this.lasers) if (l.live && overlap(p, l)) return this.kill(p, 'laser');
      if (p.y > ROWS + 1 || p.y < -3) return this.kill(p, 'fell');
      for (const pd of this.pads) {
        if (this.g !== pd.g && overlap(p, padBox(pd))) {
          this.g = pd.g; sfx.flip();
          for (const q of this.players) { q.jumping = false; q.grounded = false; q.ground = null; }
          burst(p.x + p.w / 2, p.y + p.h / 2, C.pad, 14, 6);
        }
      }
      for (const d of this.doors) {
        if (d.fake || d.tween || !overlap(p, doorBox(d))) continue;
        // multiplayer: everyone has to make it in; single and chained: one touch is enough
        if (this.mode.players > 1 && !this.chained) {
          p.done = true; sfx.reveal();
          burst(p.x + p.w / 2, p.y + p.h / 2, SKINS[p.idx].main, 20, 7);
          this.cur = p; this.say('in!');
          if (this.active().length === 0) this.win();
        } else this.win();
        return;
      }
    }

    kill(p = this.active()[0], cause = 'restart') {
      if (this.over || !p) return;
      if (admin.god && cause !== 'fell' && cause !== 'restart') return;
      this.over = true; this.victim = p; this.cause = cause;
      save.deaths++;
      const dk = dkey(this.mode.id, this.idx);
      save.levelDeaths[dk] = (save.levelDeaths[dk] || 0) + 1;
      persist();
      // one dies, everyone restarts
      for (const q of this.players) {
        if (q.done) continue;
        q.dead = true;
        spawnFx('poof', (q.x + q.w / 2) * TILE, (this.g > 0 ? q.y + q.h : q.y) * TILE);
        burst(q.x + q.w / 2, q.y + q.h / 2, SKINS[q.idx].main, q === p ? 34 : 18, q === p ? 11 : 7);
      }
      this.shake(0.3, 0.4);
      sfx.die();
      if (this.mode.players === 1) {
        game.message = { text: pick(DEATH_LINES), t: 0 };
        this.wait(0.75, () => game.restart());
        return;
      }
      // 2-player modes: blame, shame stats, strikes
      const v = SKINS[p.idx].name, o = SKINS[1 - p.idx].name;
      save.shame[this.mode.id][p.idx]++; persist();
      game.runDeaths[p.idx]++;
      game.strikes++;
      const r = Math.random();
      const line = r < 0.4 ? pick(BLAME_LINES).replace(/\{v\}/g, v).replace(/\{o\}/g, o)
        : `${v}: ${pick(this.chained && r < 0.7 ? CHAIN_LINES : r < 0.85 ? TEAM_LINES : DEATH_LINES)}`;
      game.message = { text: line, t: 0 };
      if (game.strikes >= STRIKES) this.wait(0.9, () => game.strikeOut());
      else this.wait(0.75, () => game.restart());
    }

    win() {
      this.won = true;
      this.banner = { text: pick(['NICE', 'OKAY FINE', 'LUCKY', 'HMPH']), sub: '', t: 0 };
      if (this.mode.players > 1) {
        const [d0, d1] = game.runDeaths;
        if (d0 !== d1) {
          const li = d0 > d1 ? 0 : 1;
          this.banner.sub = pick(MOCK_LINES).replace(/\{l\}/g, SKINS[li].name).replace(/\{w\}/g, SKINS[1 - li].name).replace(/\{n\}/g, Math.max(d0, d1));
        } else if (d0 > 0) this.banner.sub = `${d0} deaths each. equally bad.`;
        else this.banner.sub = 'first try?? suspicious.';
      }
      sfx.win();
      const p = this.cur;
      burst(p.x + p.w / 2, p.y + p.h / 2, C.portal, 40, 10);
      const prog = save.progress;
      if (!admin.unlock && this.idx + 2 > prog[this.mode.id]) { prog[this.mode.id] = Math.min(course(this.mode.id).length, this.idx + 2); persist(); }
      this.wait(this.mode.players > 1 ? 1.8 : 1.0, () => game.next());
    }
  }

  // ---------------------------------------------------------------- game state
  const game = {
    state: 'title', // title | mode | select | play | end
    mode: 'single', modeSel: 0,
    level: null, idx: 0, sel: 0, scrollY: 0, targetScrollY: 0, message: null, time: 0, strikes: 0, runDeaths: [0, 0],
    reached() { return Math.min(save.progress[this.mode] || 1, course(this.mode).length); },
    unlocked() { return admin.unlock ? course(this.mode).length : this.reached(); },
    clearInput() { pressed[0].clear(); pressed[1].clear(); },
    setMode(id) { this.mode = id; syncCtl(); },
    start(idx, keepMessage = false) {
      this.idx = idx; this.level = new Level(idx, this.mode); this.state = 'play';
      particles = []; fxs = []; this.clearInput(); if (!keepMessage) this.message = null;
      this.strikes = 0; this.runDeaths = [0, 0];
      if (MODE[this.mode].chained && idx === 0) this.level.banner = { text: 'SURPRISE!', sub: "you're chained together. good luck.", t: 0, life: 2.4 };
    },
    restart() { this.level = new Level(this.idx, this.mode); this.clearInput(); },
    // too many deaths in one level: back one level, and that level's unlock is gone
    strikeOut() {
      const back = Math.max(0, this.idx - 1);
      save.progress[this.mode] = back + 1; persist();
      this.start(back, true);
      this.level.banner = {
        text: `${STRIKES} STRIKES`, t: 0, life: 2.6,
        sub: this.idx === 0 && back === 0 ? 'back to level 1. again.' : `back to level ${back + 1}. progress deleted.`,
      };
    },
    next() {
      const n = this.idx + 1;
      if (n >= course(this.mode).length) playCut('ending', () => { this.state = 'end'; sfx.win(); });
      else if (n % 10 === 0) playCut('area' + n / 10, () => this.start(n));   // down into the next area
      else this.start(n);
    },
  };

  const SPEEDS = [1, 0.5, 0.25];
  // act(d): d = 0 for ENTER/click, -1/+1 for left/right
  const ADMIN_ITEMS = [
    { label: () => `play any level:  < ${MODES[admin.mode].name} >`, act(d) {
      if (d) { admin.mode = (admin.mode + d + MODES.length) % MODES.length; return; }
      admin.unlock = true; game.setMode(MODES[admin.mode].id);
      game.state = 'select'; game.sel = 0; updateSelectScroll(true);
    } },
    { label: () => `unlock all levels: ${admin.unlock ? 'ON  (N skips a level)' : 'off'}`, act() { admin.unlock = !admin.unlock; } },
    { label: () => `god mode (traps can't kill): ${admin.god ? 'ON' : 'off'}`, act() { admin.god = !admin.god; } },
    { label: () => `game speed: ${admin.speed}x`, act(d) { admin.speed = SPEEDS[(SPEEDS.indexOf(admin.speed) + (d < 0 ? SPEEDS.length - 1 : 1)) % SPEEDS.length]; } },
    { label: () => (admin.confirmReset ? 'erase ALL progress + deaths? ENTER again' : 'reset save data'), act(d) {
      if (d) return;
      if (!admin.confirmReset) { admin.confirmReset = true; return; }
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      location.reload();
    } },
  ];
  const ADMIN_ROW = { top: 200, h: 46 };

  function onKey(code) {
    const go = code === 'Enter' || code === 'Space' || code === 'KeyZ';
    if (code === 'KeyM') { save.muted = !save.muted; persist(); return; }
    if (code === 'Backquote' && (game.state === 'title' || game.state === 'mode')) {
      sfx.click(); admin.back = game.state; game.state = 'admin'; return;
    }
    if (game.state === 'title') {
      if (go) { sfx.click(); game.state = 'mode'; }
    } else if (game.state === 'admin') {
      const n = ADMIN_ITEMS.length, it = ADMIN_ITEMS[admin.sel];
      const was = admin.sel;
      if (code === 'ArrowDown' || code === 'KeyS') admin.sel = (admin.sel + 1) % n;
      if (code === 'ArrowUp' || code === 'KeyW') admin.sel = (admin.sel + n - 1) % n;
      if (admin.sel !== was) { admin.confirmReset = false; sfx.click(); }
      if (code === 'ArrowLeft' || code === 'KeyA') { sfx.click(); it.act(-1); }
      if (code === 'ArrowRight' || code === 'KeyD') { sfx.click(); it.act(1); }
      if (go) { sfx.click(); it.act(0); }
      if (code === 'Escape' || code === 'Backquote') { admin.confirmReset = false; game.state = admin.back; }
    } else if (game.state === 'mode') {
      if (code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowDown' || code === 'KeyS') { game.modeSel = Math.min(MODES.length - 1, game.modeSel + 1); sfx.click(); }
      if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowUp' || code === 'KeyW') { game.modeSel = Math.max(0, game.modeSel - 1); sfx.click(); }
      if (go) {
        sfx.click(); game.setMode(MODES[game.modeSel].id);
        const i = game.reached() - 1;
        if (i === 0) playCut('intro', () => game.start(0)); else game.start(i);   // a fresh run opens at the castle
      }
      if (code === 'KeyL') {
        sfx.click();
        game.setMode(MODES[game.modeSel].id);
        game.state = 'select';
        game.sel = game.reached() - 1;
        updateSelectScroll(true);
      }
      if (code === 'Escape') game.state = 'title';
    } else if (game.state === 'select') {
      const n = game.unlocked();
      const prevSel = game.sel;
      if (code === 'ArrowRight' || code === 'KeyD') game.sel = Math.min(n - 1, game.sel + 1);
      if (code === 'ArrowLeft' || code === 'KeyA') game.sel = Math.max(0, game.sel - 1);
      if (code === 'ArrowDown' || code === 'KeyS') game.sel = Math.min(n - 1, game.sel + SEL.cols);
      if (code === 'ArrowUp' || code === 'KeyW') game.sel = Math.max(0, game.sel - SEL.cols);
      if (game.sel !== prevSel) {
        sfx.click();
        updateSelectScroll();
      }
      if (go) { sfx.click(); game.start(game.sel); }
      if (code === 'Escape') game.state = 'mode';
    } else if (game.state === 'play') {
      if (code === 'KeyR' && !game.level.won) { if (game.level.mode.players > 1) game.restart(); else game.level.kill(); }
      if (code === 'KeyN' && admin.unlock && !game.level.won && !game.level.over) game.level.win();
      if (code === 'Escape') {
        game.state = 'select';
        game.sel = game.idx;
        updateSelectScroll(true);
      }
    } else if (game.state === 'cutscene') {
      if (game.cut && game.cut.t > 0.5 && (go || code === 'Escape')) endCut();   // a short grace so a held jump doesn't skip it
    } else if (game.state === 'end') {
      if (go || code === 'Escape') game.state = 'mode';
    }
  }

  // clicks / taps on menus & wheel scrolling
  {
    const cv = document.getElementById('game');
    cv.addEventListener('pointerdown', (e) => {
      audioOn();
      const r = cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * VW, y = ((e.clientY - r.top) / r.height) * VH;
      if (game.state === 'title') onKey(y > VH - 40 && x > VW - 120 ? 'Backquote' : 'Enter');
      else if (game.state === 'admin') {
        const i = Math.floor((y - ADMIN_ROW.top + ADMIN_ROW.h / 2) / ADMIN_ROW.h);
        if (i >= 0 && i < ADMIN_ITEMS.length) { if (admin.sel !== i) admin.confirmReset = false; admin.sel = i; onKey('Enter'); }
        else if (y < 90) onKey('Escape');
      } else if (game.state === 'mode') {
        const i = modeHit(x, y);
        if (i >= 0) { game.modeSel = i; onKey('Enter'); }
        else if (y > VH - 70) onKey('KeyL');
        else if (y < 90) onKey('Escape');
      } else if (game.state === 'select') {
        const i = selectHit(x, y);
        if (i >= 0 && i < game.unlocked()) { game.sel = i; updateSelectScroll(); onKey('Enter'); }
        else if (y < 90) onKey('Escape');
      } else if (game.state === 'cutscene') { if (x > SKIP.x && y < SKIP.y + SKIP.h) onKey('Enter'); }
      else if (game.state === 'end') onKey('Enter');
    });

    cv.addEventListener('wheel', (e) => {
      if (game.state === 'select') {
        e.preventDefault();
        const maxScroll = maxSelectScroll();
        game.targetScrollY = clamp(game.targetScrollY + Math.sign(e.deltaY) * 60, 0, maxScroll);
      }
    }, { passive: false });
  }

  // ---------------------------------------------------------------- rendering
  // Everything is drawn in VW units (960x540) onto a 480x270 canvas, so one art pixel is PX = 2 units.
  // The canvas is then scaled up by a whole number with CSS (black bars around it), never smoothed.
  const PX = 2, LW = VW / PX, LH = VH / PX;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  cv.width = LW; cv.height = LH;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / LW, (innerHeight * dpr) / LH)));
    cv.style.width = (LW * k) / dpr + 'px';
    cv.style.height = (LH * k) / dpr + 'px';
  }
  addEventListener('resize', resize);
  resize();
  function baseTransform() { ctx.setTransform(1 / PX, 0, 0, 1 / PX, 0, 0); ctx.imageSmoothingEnabled = false; }

  const sn = (v) => Math.round(v / PX) * PX;   // snap to the art-pixel grid
  // a rect snapped to whole art pixels, never thinner than one
  function R(x, y, w, h, col) {
    const x0 = sn(x), y0 = sn(y), x1 = Math.max(x0 + PX, sn(x + w)), y1 = Math.max(y0 + PX, sn(y + h));
    ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  // a rect in art pixels, relative to the current transform (for sprites drawn around an origin)
  function r(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x * PX, y * PX, w * PX, h * PX); }

  // ---- small offscreen painter for cached art (backgrounds, tiles, saw frames, darkness masks)
  const HEX = {};
  const hex = (h) => HEX[h] || (HEX[h] = (() => { let s = h.slice(1); if (s.length === 3) s = [...s].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); })());
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const dith = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function paint(W, H, fn) {
    const d = new Float32Array(W * H * 4);
    const c = {
      W, H,
      px(x, y, col, a = 1) {
        x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
        const [cr, cg, cb] = typeof col === 'string' ? hex(col) : col, i = (y * W + x) * 4, da = d[i + 3], oa = a + da * (1 - a);
        d[i] = (cr * a + d[i] * da * (1 - a)) / oa; d[i + 1] = (cg * a + d[i + 1] * da * (1 - a)) / oa; d[i + 2] = (cb * a + d[i + 2] * da * (1 - a)) / oa; d[i + 3] = oa;
      },
      add(x, y, col, k) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const [cr, cg, cb] = hex(col), i = (y * W + x) * 4; d[i] += cr * k; d[i + 1] += cg * k; d[i + 2] += cb * k; },
      rect(x, y, w, h, col, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) c.px(x + i, y + j, col, a); },
      disc(cx, cy, rr, col, a = 1) { for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr + rr * 0.6) c.px(cx + x, cy + y, col, a); },
      glow(cx, cy, rr, col, k = 0.5) { for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) { const f = 1 - Math.hypot(x, y) / rr; if (f > 0) c.add(cx + x, cy + y, col, k * f * f); } },
    };
    fn(c);
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
    const g = cvs.getContext('2d'), img = g.createImageData(W, H);
    for (let i = 0; i < d.length; i += 4) { img.data[i] = d[i]; img.data[i + 1] = d[i + 1]; img.data[i + 2] = d[i + 2]; img.data[i + 3] = d[i + 3] * 255; }
    g.putImageData(img, 0, 0);
    return cvs;
  }

  // ---- the four areas of the descent, ten levels each (all three courses)
  const AREAS = [
    { name: 'THE UPPER HALLS', mortar: '#16121c', brick: '#2a2333', brickHi: '#352c40', stone: ['#2a2430', '#4a4352', '#6d6578'], top: ['#4f7a3a', '#6b9a48'], text: '#d8ccb0', title: '#ffae35' },
    { name: 'THE CRYPT', mortar: '#0e0e16', brick: '#1c1c28', brickHi: '#242434', stone: ['#1e1e2a', '#3a3a4c', '#58586e'], top: ['#b8b4a0', '#d8d4c0'], text: '#c8d0e0', title: '#9bdcff' },
    { name: 'THE FLOODED DEPTHS', mortar: '#08141a', brick: '#11262c', brickHi: '#173238', stone: ['#14282e', '#2a4a50', '#4a7076'], top: ['#3aa890', '#6ae0c0'], text: '#c0f0e0', title: '#6ae0c0' },
    { name: 'THE MOLTEN CORE', mortar: '#0a0606', brick: '#1a1110', brickHi: '#221614', stone: ['#1a1414', '#3a2a28', '#5a4038'], top: ['#ff5a1a', '#ffb43a'], text: '#ffd8b0', title: '#ffe27a' },
  ];
  const areaOf = (idx) => Math.min(AREAS.length - 1, Math.floor(idx / 10));

  // the wall behind everything: bricks plus each area's set dressing, painted once per area
  const BG = [];
  function bgArt(n) {
    if (BG[n]) return BG[n];
    const A = AREAS[n];
    return (BG[n] = paint(LW, LH, (c) => {
      c.rect(0, 0, c.W, c.H, A.mortar);
      for (let y = 0; y < c.H; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < c.W; x += 16) {
        c.rect(x + 1, y + 1, 15, 7, A.brick); c.rect(x + 1, y + 1, 15, 1, A.brickHi);
        if (hash(x, y) < 0.12) c.rect(x + 3, y + 3, 10, 3, A.mortar, 0.5);   // a worn brick
      }
      if (n === 1) {   // crypt: cracks, skull niches, hanging chains, cobwebs
        for (const [x0, y0] of [[120, 20], [330, 60], [40, 150]]) { let x = x0; for (let y = y0; y < y0 + 30; y++) { x += Math.round(hash(x, y) * 2 - 1); c.px(x, y, '#08080e'); } }
        for (const nx of [95, 255, 395]) { c.rect(nx - 6, 98, 13, 11, '#08080e'); c.rect(nx - 4, 100, 9, 7, '#a8a490'); c.rect(nx - 3, 102, 2, 2, '#08080e'); c.rect(nx + 1, 102, 2, 2, '#08080e'); c.rect(nx - 2, 106, 5, 1, '#78745e'); }
        for (const [cx, len] of [[180, 50], [300, 34], [450, 60]]) for (let y = 0; y < len; y += 3) c.rect(cx + (y / 3) % 2, y, 2, 2, '#3a3a4c');
        for (const [ox, sx] of [[0, 1], [c.W - 1, -1]]) for (let k = 0; k < 18; k++) { c.px(ox + sx * k, k, '#c8d0e0', 0.3); c.px(ox + sx * k, 0, '#c8d0e0', 0.2); c.px(ox, k, '#c8d0e0', 0.2); if (k % 6 === 0) for (let j = 0; j < k; j++) c.px(ox + sx * j, k, '#c8d0e0', 0.15); }
      }
      if (n === 2) {   // flooded: water stains running down, a waterline, still water in the lower third
        for (let x = 0; x < c.W; x++) { const run = hash(x, 7) < 0.08 ? 20 + hash(x, 9) * 40 : 0; for (let y = 0; y < run; y++) c.px(x, y + 9, '#2a5a58', 0.35 * (1 - y / run)); }
        for (let y = 170; y < c.H; y++) for (let x = 0; x < c.W; x++) c.px(x, y, y === 170 ? '#4aa0a0' : (y - 170) % 6 === 0 && hash(x >> 3, y) < 0.4 ? '#2a6a70' : '#103a44', y === 170 ? 0.8 : 0.6);
        for (const [x, y, col] of [[150, 150, '#6ae0c0'], [395, 160, '#9a8cff'], [60, 162, '#6ae0c0']]) { c.glow(x, y, 18, col, 0.3); for (let k = 0; k < 3; k++) { const h = 7 - k * 2; for (let j = 0; j < h; j++) c.rect(x - 4 + k * 4, y - j, 2, 1, j > h - 3 ? '#ffffff' : col); } }
      }
      if (n === 3) {   // molten: lava falls far back, glowing cracks, heat from below
        for (const lx of [60, 300]) for (let y = 0; y < c.H; y++) for (let i = 0; i < 9; i++) { const k = dith(lx + i, y) < 0.5 + 0.3 * Math.sin((y + i * 3) / 5) ? '#ff8a2a' : '#c8401a'; c.px(lx + i, y, i === 0 || i === 8 ? '#701a14' : k, 0.55); }
        for (let y = 120; y < c.H; y++) for (let x = 0; x < c.W; x++) if (dith(x, y) < (y - 120) / 220) c.add(x, y, '#ff4a10', 0.15);
        for (const [x0, y0] of [[140, 30], [400, 40], [230, 90], [20, 60]]) { let x = x0; for (let y = y0; y < y0 + 40; y++) { x += Math.round(hash(x, y) * 2 - 1); c.px(x, y, '#ff6a1a'); c.add(x + 1, y, '#ff4a10', 0.2); c.add(x - 1, y, '#ff4a10', 0.2); } }
      }
    }));
  }
  // block faces: a repeating brick tile, and a ragged top edge (moss, bone, algae, lava) per area
  const TILES = [];
  function tileArt(n) {
    if (TILES[n]) return TILES[n];
    const A = AREAS[n], [base, mid, hi] = A.stone;
    const face = paint(28, 14, (c) => {
      c.rect(0, 0, 28, 14, base);
      for (const j of [0, 7]) for (const i of j ? [7, 21] : [0, 14]) for (let k = 1; k < 14; k++) {
        const x = (i + k) % 28;
        c.rect(x, j + 1, 1, 6, mid); c.px(x, j + 1, hi);
        if (n === 3 && k > 3 && k < 8 && hash(i, j) < 0.5) c.px(x, j + 4, '#ff6a1a');
        if (n === 2 && k === 2) c.px(x, j + 2, '#9bf0e0', 0.5);
      }
    });
    const top = paint(60, 5, (c) => {
      for (let i = 0; i < 60; i++) {
        const t = hash(i, n + 1);
        c.px(i, 0, A.top[t < 0.5 ? 0 : 1]); if (t < 0.3) c.px(i, 1, A.top[0]);
        if (n === 1 && t > 0.85) c.rect(i, 1, 1, 3, A.top[1]);
        if (n === 2 && t > 0.9) c.rect(i, 1, 1, 4, '#6ae0c0', 0.7);
      }
    });
    return (TILES[n] = { face: ctx.createPattern(face, 'repeat'), top: ctx.createPattern(top, 'repeat') });
  }
  // fill a rect with a pattern whose pixels are art pixels, anchored at (ax, ay)
  function patternRect(pat, x, y, w, h, ax, ay) {
    pat.setTransform(new DOMMatrix([PX, 0, 0, PX, ax, ay]));
    ctx.fillStyle = pat; ctx.fillRect(x, y, w, h);
  }

  // ---- pixelfx sprite sheets (assets/fx, frame data in js/fx-data.js)
  const FXIMG = {};
  for (const name in window.FX_DATA || {}) { FXIMG[name] = new Image(); FXIMG[name].src = `assets/fx/${name}.png`; }
  function drawFx(name, t, x, y, a = 1) {
    const m = window.FX_DATA && FX_DATA[name], img = FXIMG[name];
    if (!m || !img.naturalWidth) return;
    let f = Math.floor(t * m.fps); f = m.loop ? ((f % m.n) + m.n) % m.n : Math.min(f, m.n - 1);
    ctx.globalAlpha = a;
    ctx.drawImage(img, (f % m.cols) * m.w, Math.floor(f / m.cols) * m.h, m.w, m.h, sn(x) - m.px * PX, sn(y) - m.py * PX, m.w * PX, m.h * PX);
    ctx.globalAlpha = 1;
  }
  // one-shot effects in the level (death poofs), in VW units at their pivot
  let fxs = [];
  function spawnFx(name, x, y) { fxs.push({ name, x, y, t: 0 }); }
  function updateFx(dt) {
    for (const f of fxs) f.t += dt;
    fxs = fxs.filter((f) => f.t < FX_DATA[f.name].n / FX_DATA[f.name].fps);
  }

  // ---- text: BoldPixels (YukiPixels, CC BY-SA 4.0) at its native 16px or whole multiples of it
  const fsz = (size) => (size <= 28 ? 32 : size <= 60 ? 64 : 96);
  function text(str, x, y, size, color = C.text, align = 'center', _weight, outline) {
    str = String(str).replace(/✕/g, '×');
    const s = fsz(size);
    ctx.font = `${s}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(str).width;
    const lx = sn(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x), by = sn(y + s / 4);
    if (outline) { ctx.fillStyle = outline; for (const [dx, dy] of [[-PX, 0], [PX, 0], [0, -PX], [0, PX]]) ctx.fillText(str, lx + dx, by + dy); }
    ctx.fillStyle = color; ctx.fillText(str, lx, by);
    return w;
  }
  // the font has no skull, so death counts get this one
  function skullIcon(x, y, col) {
    x = sn(x); y = sn(y);
    R(x + 2, y, 8, 6, col); R(x, y + 2, 12, 4, col); R(x + 2, y + 6, 8, 4, col);
    R(x + 2, y + 2, 2, 2, C.bg1); R(x + 8, y + 2, 2, 2, C.bg1); R(x + 4, y + 8, 2, 2, C.bg1); R(x + 6, y + 8, 2, 2, C.bg1);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawBg(n = 0) { ctx.drawImage(bgArt(n), 0, 0, VW, VH); }

  // wall lights and life behind the level; never anything that could pass for a hazard
  function drawDecor(n, t) {
    if (n === 0) for (const tx of [5, 13, 21, 29]) drawFx('torch', t + tx * 0.37, tx * TILE, 6.2 * TILE);
    if (n === 1) {
      for (const tx of [9, 25]) drawFx('torch-blue', t + tx * 0.37, tx * TILE, 6.2 * TILE);
      const bx = ((t * 40) % (VW + 600)) - 300;   // a bat crosses the top every so often
      drawFx('bat', t, bx, 2.6 * TILE, 0.55);
    }
    if (n === 2) for (const tx of [7, 24]) drawFx('torch-green', t + tx * 0.37, tx * TILE, 6.2 * TILE);
    // ambient motes: dust falls in the crypt, spores drift in the depths, embers rise in the core
    if (n >= 1) for (let k = 0; k < 28; k++) {
      const sx = hash(k, n) * VW, sp = 10 + hash(n, k) * 18, ph = hash(k, k + n) * VH;
      if (n === 1) R(sx + Math.sin(t + k) * 6, (ph + t * sp) % VH, PX, PX, 'rgba(200,208,224,0.35)');
      if (n === 2 && k % 2) R(sx + Math.sin(t * 0.7 + k) * 14, (ph - t * sp * 0.5 + VH * 4) % VH, PX, PX, 'rgba(155,240,224,0.7)');
      if (n === 3) R(sx + Math.sin(t * 2 + k) * 8, (ph - t * sp * 2.4 + VH * 40) % VH, PX, PX, k % 3 ? '#ff8a2a' : '#ffe27a');
    }
  }

  function drawButton(bt) {
    const x = bt.x * TILE, y = bt.y * TILE, w = bt.w * TILE, depth = bt.down ? 2 : 6;
    R(x - 2, y - 4, w + 4, 4, '#4a4352');
    R(x + 4, y - 4 - depth, w - 8, depth, bt.color);
    R(x + 4, y - 4 - depth, w - 8, PX, 'rgba(255,255,255,0.45)');
  }

  function drawCrate(b) {
    const j = b.armed && !b.spiky ? (Math.random() - 0.5) * 4 : 0;
    const x = b.x * TILE + j, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    if (b.spiky) {
      const cx = x + w / 2, cy = y + h / 2;
      for (let i = 0; i < 16; i++) {   // bone spikes all round
        const a = (i / 16) * Math.PI * 2, len = i % 2 ? w * 0.5 : w * 0.85;
        for (let s = 0; s < len; s += PX) R(cx + Math.cos(a) * s - 1, cy + Math.sin(a) * s - 1, PX, PX, C.spike);
      }
      R(x + 4, y + 4, w - 8, h - 8, '#5a1010'); R(x + 6, y + 6, w - 12, h - 12, C.danger);
      R(x + w * 0.3, y + h * 0.35, 4, 4, '#fff'); R(x + w * 0.62, y + h * 0.35, 4, 4, '#fff'); R(x + w * 0.32, y + h * 0.62, w * 0.36, 2, '#2a0808');
      return;
    }
    R(x, y, w, h, '#3a2010'); R(x + 2, y + 2, w - 4, h - 4, C.crate);
    for (let k = 12; k < h - 4; k += 12) R(x + 2, y + k, w - 4, 2, '#5e3a1c');
    R(x, y + 6, w, 6, '#6b6b78'); R(x, y + h - 12, w, 6, '#6b6b78'); R(x, y + 6, w, 2, '#9a9aa8'); R(x, y + h - 12, w, 2, '#9a9aa8');
  }

  function drawBlock(b, L) {
    if (b.gone) return;
    if (b.crate) return drawCrate(b);
    let ox = 0, oy = 0;
    if (b.pending) { ox = (Math.random() - 0.5) * 3; oy = (Math.random() - 0.5) * 2; }
    const x = sn(b.x * TILE + ox), y = sn(b.y * TILE + oy), w = sn(b.w * TILE), h = sn(b.h * TILE);
    if (b.hidden) {
      // a few gold twinkles, staggered so one is always shining
      const n = Math.max(3, Math.round(b.w * 2));
      for (let i = 0; i < n; i++) {
        const ph = (L.t + b.sparkle + i * (1.6 / n) * 1.7) % 1.6;
        if (ph >= 0.7) continue;
        const k = Math.sin((ph / 0.7) * Math.PI), s = Math.round(1 + 2 * k) * PX;
        const sx = x + w * ((b.sparkle * 7 + i * 0.618) % 1), sy = y + h * (0.2 + 0.6 * ((b.sparkle * 3 + i * 0.382) % 1));
        ctx.globalAlpha = 0.95 * k;
        R(sx - s, sy, s * 2 + PX, PX, C.portal); R(sx, sy - s, PX, s * 2 + PX, C.portal); R(sx, sy, PX, PX, '#fff8d6');
      }
      ctx.globalAlpha = 1;
      return;
    }
    // the texture rides along when a block moves, and lines up across blocks that haven't
    if (b.bx0 === undefined) { b.bx0 = b.x; b.by0 = b.y; }
    const T = tileArt(areaOf(L.idx)), ax = sn((b.x - b.bx0) * TILE + ox), ay = sn((b.y - b.by0) * TILE + oy);
    if (b.ghost) ctx.globalAlpha = 0.14;   // see-through: a secret room drawn behind it
    patternRect(T.face, x, y, w, h, ax, ay);
    patternRect(T.top, x, y, w, Math.min(h, 5 * PX), ax, y);
    R(x, y + h - PX, w, PX, 'rgba(0,0,0,0.35)');
    if (b.link) {   // linked to a button of the same colour: a column of gems
      for (let k = 0; k * 12 < h - 8; k++) { R(x + w / 2 - 4, y + 6 + k * 12, 8, 6, '#0c080c'); R(x + w / 2 - 2, y + 6 + k * 12, 4, 6, b.link); R(x + w / 2 - 4, y + 8 + k * 12, 8, 2, b.link); }
    }
    ctx.globalAlpha = 1;
    if (b.flash > 0) { ctx.globalAlpha = b.flash / 0.4; R(x, y, w, h, C.portal); ctx.globalAlpha = 1; }
  }

  function drawLadder(l) {
    const x = l.x * TILE, y = l.y * TILE, w = l.w * TILE, h = l.h * TILE;
    R(x + 4, y, 4, h, '#6e4a2a'); R(x + w - 8, y, 4, h, '#6e4a2a');
    for (let k = 6; k < h; k += 12) { R(x + 4, y + k, w - 8, 4, '#8a5a2b'); R(x + 4, y + k, w - 8, PX, '#a8754f'); }
  }

  function drawSpike(s) {
    if (s.out <= 0.01) return;
    const hgt = Math.max(1, Math.round((0.62 * TILE * s.out) / PX));   // in art pixels
    // whole triangles spread over the exact width, so fractional rows don't spill into their neighbours
    const n = Math.max(1, Math.round(s.w)), tw = (s.w / n) * TILE, up = s.dir === 'up';
    for (let i = 0; i < n; i++) {
      const x0 = sn(s.x * TILE + i * tw), x1 = sn(s.x * TILE + (i + 1) * tw), mid = sn((x0 + x1) / 2), half = (x1 - x0) / 2 - PX, y0 = sn(s.y * TILE);
      for (let j = 0; j < hgt; j++) {
        const hw = sn((half * (j + 1)) / hgt), yy = up ? y0 - (hgt - j) * PX : y0 + (hgt - j - 1) * PX;
        R(mid - hw, yy, hw, PX, '#f4ecd8'); R(mid, yy, PX, PX, C.spike); R(mid + PX, yy, hw, PX, '#9a8c70');
      }
      R(x0 + PX, up ? y0 - PX : y0, x1 - x0 - 2 * PX, PX, '#5a5048');
    }
  }

  function drawDoor(d, t, L) {
    // real and fake portals are the same sprite: that's the joke
    drawFx(areaOf(L.idx) === 3 ? 'portal-hot' : 'portal', t, (d.x + d.w / 2) * TILE, (d.y + d.h) * TILE + 2);
  }

  // saws: pre-painted frames per radius, 8 steps through one tooth
  const SAWS = {};
  function sawArt(rpx, step) {
    const key = rpx + ':' + step;
    if (SAWS[key]) return SAWS[key];
    const S = 2 * (rpx + 4);
    return (SAWS[key] = paint(S, S, (c) => {
      const cx = S / 2, rot = (step / 8) * ((Math.PI * 2) / 10);
      for (let y = -rpx - 3; y <= rpx + 3; y++) for (let x = -rpx - 3; x <= rpx + 3; x++) {
        const d = Math.hypot(x, y), a = Math.atan2(y, x) + rot, f = (((a / (Math.PI * 2)) * 10) % 1 + 1) % 1, tooth = rpx + (f < 0.5 ? 3 * (1 - f * 2) : 0);
        if (d <= tooth) c.px(cx + x, cx + y, d > rpx - 1 ? '#d8b088' : x + y < 0 ? '#a8754f' : '#6e4a36');
      }
      c.disc(cx, cx, Math.max(1, Math.round(rpx * 0.3)), '#2a1a14'); c.px(cx - 1, cx - 1, '#c83a2a');
    }));
  }
  function drawSaw(s) {
    const rpx = Math.max(3, Math.round((s.r * TILE) / PX)), step = ((Math.floor((s.rot / ((Math.PI * 2) / 10)) * 8) % 8) + 8) % 8;
    const art = sawArt(rpx, step);
    ctx.drawImage(art, sn(s.x * TILE) - art.width, sn(s.y * TILE) - art.height, art.width * PX, art.height * PX);
  }

  function drawLaser(l, t) {
    const x = l.x * TILE, y = l.y * TILE, w = l.w * TILE, h = l.h * TILE, vert = l.h >= l.w;
    if (l.live) {
      ctx.globalAlpha = 0.35; R(x - (vert ? 2 : 0), y - (vert ? 0 : 2), w + (vert ? 4 : 0), h + (vert ? 0 : 4), C.danger); ctx.globalAlpha = 1;
      R(x, y, w, h, C.danger);
      if (vert) R(x + w / 2 - 1, y, PX, h, '#ffd6dd'); else R(x, y + h / 2 - 1, w, PX, '#ffd6dd');
    } else {
      ctx.globalAlpha = l.warn ? (Math.sin(t * 60) > 0 ? 0.9 : 0.3) : 0.25;
      if (vert) for (let j = 0; j < h; j += 6) R(x + w / 2 - 1, y + j, PX, PX, C.danger);
      else for (let j = 0; j < w; j += 6) R(x + j, y + h / 2 - 1, PX, PX, C.danger);
      ctx.globalAlpha = 1;
    }
    // emitters at both ends
    if (vert) { R(x - 4, y, w + 8, 6, '#4a4352'); R(x - 4, y + h - 6, w + 8, 6, '#4a4352'); R(x + w / 2 - 1, y + 2, PX, PX, C.danger); }
    else { R(x, y - 4, 6, h + 8, '#4a4352'); R(x + w - 6, y - 4, 6, h + 8, '#4a4352'); R(x + 2, y + h / 2 - 1, PX, PX, C.danger); }
  }

  function drawPad(pd, t) {
    const b = padBox(pd), x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE, up = pd.g < 0;
    R(x, y, w, h, '#2a2430'); R(x + 2, up ? y : y + h - 4, w - 4, 4, C.pad);
    const n = Math.round(pd.w * 2), on = Math.sin(t * 5) > 0;
    for (let i = 0; i < n; i++) {   // chevrons that climb away from the pad
      const ax = x + (i + 0.5) * (w / n), k = Math.floor((t * 6) % 3), ay = up ? y - 6 - k * 6 : y + h + 6 + k * 6;
      ctx.globalAlpha = on ? 0.9 : 0.6;
      R(ax - 1, ay, PX, PX, '#c684ff'); R(ax - 3, ay + (up ? 2 : -2), PX, PX, '#c684ff'); R(ax + 1, ay + (up ? 2 : -2), PX, PX, '#c684ff');
    }
    ctx.globalAlpha = 1;
  }

  function drawFlag(f, t) {
    const x = (f.x + 0.45) * TILE, top = f.y * TILE, bot = (f.y + f.h) * TILE;
    R(x, top, 4, bot - top, '#6b6b78');
    const col = f.evil ? C.danger : C.flag, wave = Math.sin(t * 6) > 0 ? 2 : 0;
    for (let j = 0; j < 9; j++) R(x + 4, top + j * PX + (j > 4 ? wave : 0), (11 - Math.abs(j - 4) * 2) * PX, PX, col);
    if (f.evil) { R(x + 8, top + 6, PX, PX, '#000'); R(x + 12, top + 6, PX, PX, '#000'); }
  }

  // the knight: a small helmeted blob drawn to its hitbox (0.8 x 0.9 tiles = 12 x 13 art pixels)
  function drawPlayer(p, L) {
    if (p.dead || p.done) return;
    const k = p.w / P.w;   // k < 1: shrunk player
    const cx = sn((p.x + p.w / 2) * TILE), base = sn(L.g > 0 ? (p.y + p.h) * TILE : p.y * TILE);
    const skin = SKINS[p.idx || 0], o = '#0c080c';
    const w = Math.max(6, Math.round(12 * (p.sx || 1))), h = Math.max(6, Math.round(13 * (p.sy || 1)));
    ctx.save();
    ctx.translate(cx, base);
    ctx.scale(k, L.g < 0 ? -k : k);
    const l = -Math.round(w / 2), t = -h;
    r(l - 1, t - 1, w + 2, h + 1, o);
    r(l, t, w, h, skin.dark); r(l, t, w, h - 3, skin.main); r(l + 1, t + 4, 1, Math.max(1, h - 8), skin.hi);
    r(l, t, w, 4, '#8a8494'); r(l, t, w, 1, '#c8c4d0');                       // helmet
    r(l + 2, t - 2, w - 4, 2, skin.plume); r(l + 3, t - 3, w - 6, 1, skin.plume);  // crest
    const look = p.face < 0 ? -1 : p.face > 0 ? 1 : 0, ey = t + 5, py = L.invert ? 0 : 1;
    for (const ex of [2, w - 5]) { r(l + ex, ey, 3, 3, '#ffffff'); r(l + ex + 1 + Math.max(0, look) - (look < 0 ? 1 : 0), ey + py, 2, 2, o); }
    // feet while running
    if (L.t !== undefined && p.grounded && Math.abs(p.vx) > 1) {
      const s = Math.floor(L.t * 10) % 2;
      r(l + 1 + s * 2, 0, 3, 1, o); r(l + w - 4 - s * 2, 0, 3, 1, o);
    }
    ctx.restore();
  }

  function drawChain(L) {
    const [a, b] = L.players;
    if (a.dead || b.dead) return;
    const ax = (a.x + a.w / 2) * TILE, ay = (a.y + a.h / 2) * TILE, bx = (b.x + b.w / 2) * TILE, by = (b.y + b.h / 2) * TILE;
    const d = Math.hypot(bx - ax, by - ay) / TILE, sag = Math.max(0, L.rope - d) * 0.55 * TILE * L.g;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + sag, n = 18;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * ax + 2 * u * t * mx + t * t * bx, y = u * u * ay + 2 * u * t * my + t * t * by;
      R(x - 2, y - 2, 4, 4, a.taut ? C.danger : i % 2 ? '#6b6b78' : '#9a9aa8');
    }
  }

  function drawBubble(b, L) {
    const p = b.p || L.players[0];
    if (p.dead) return;
    const x = (p.x + p.w / 2) * TILE, y = (L.g > 0 ? p.y - 0.9 : p.y + p.h + 0.9) * TILE - Math.min(b.t, 0.3) * 20 * L.g;
    ctx.globalAlpha = clamp((1.4 - b.t) / 0.3, 0, 1);
    ctx.font = `32px ${FONT}`;
    const w = sn(ctx.measureText(b.str).width + 16), bx = sn(x - w / 2), by = sn(y - 12);
    R(bx, by, w, 24, '#d8ccb0'); R(bx + PX, by - PX, w - 2 * PX, PX, '#d8ccb0'); R(bx + PX, by + 24, w - 2 * PX, PX, '#d8ccb0'); R(sn(x), by + 26, PX, PX, '#d8ccb0');
    text(b.str, x, y, 14, '#1a1410');
    ctx.globalAlpha = 1;
  }

  // darkness: a dithered circle of light around the player, painted once per radius
  const DARK = {};
  function darkArt(rpx) {
    if (DARK[rpx]) return DARK[rpx];
    const S = rpx * 2 + 2;
    return (DARK[rpx] = paint(S, S, (c) => {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const f = (Math.hypot(x - S / 2, y - S / 2) - rpx * 0.55) / (rpx * 0.45);
        if (f > dith(x, y)) c.px(x, y, '#05050e');
      }
    }));
  }

  function drawLevel(L) {
    const t = L.t, n = areaOf(L.idx);
    ctx.save();
    if (L.shakeT > 0) ctx.translate(sn((Math.random() - 0.5) * L.shakeMag * TILE), sn((Math.random() - 0.5) * L.shakeMag * TILE));
    if (L.view.mirror) { ctx.translate(VW, 0); ctx.scale(-1, 1); }
    if (L.view.flip) { ctx.translate(0, VH); ctx.scale(1, -1); }
    drawBg(n);
    drawDecor(n, t);
    for (const f of L.flags) drawFlag(f, t);
    for (const d of L.doors) drawDoor(d, t, L);
    for (const s of L.spikes) drawSpike(s);
    for (const l of L.ladders) drawLadder(l);
    for (const s of L.saws) if (s.buried) drawSaw(s);   // drawn under blocks: only the exposed half shows
    for (const b of L.blocks) drawBlock(b, L);
    for (const pd of L.pads) drawPad(pd, t);
    for (const bt of L.buttons) drawButton(bt);
    for (const s of L.saws) if (!s.buried) drawSaw(s);
    for (const l of L.lasers) drawLaser(l, t);
    // level text sits above blocks with a dark outline so gates/ceilings never cut it off
    for (const tx of L.texts) text(tx.str, tx.x * TILE, tx.y * TILE, 18, AREAS[n].text, 'left', null, '#0a080c');
    if (L.chained) drawChain(L);
    for (const p of L.players) drawPlayer(p, L);
    for (const f of fxs) drawFx(f.name, f.t, f.x, f.y);
    for (const p of particles) {
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      R(p.x * TILE, p.y * TILE, Math.max(PX, p.size * TILE), Math.max(PX, p.size * TILE), p.color);
    }
    ctx.globalAlpha = 1;
    if (L.dark) {
      const p = L.cur, cx = sn((p.x + p.w / 2) * TILE), cy = sn((p.y + p.h / 2) * TILE), rpx = Math.round((L.dark * TILE) / PX), art = darkArt(rpx);
      const x0 = cx - art.width, y0 = cy - art.height, x1 = x0 + art.width * PX, y1 = y0 + art.height * PX;
      ctx.drawImage(art, x0, y0, art.width * PX, art.height * PX);
      ctx.fillStyle = '#05050e';
      ctx.fillRect(-VW, -VH, VW * 3, y0 + VH); ctx.fillRect(-VW, y1, VW * 3, VH * 2);
      ctx.fillRect(-VW, y0, x0 + VW, y1 - y0); ctx.fillRect(x1, y0, VW * 2, y1 - y0);
    }
    for (const b of L.bubbles) drawBubble(b, L);
    ctx.restore();

    // HUD
    const two = L.mode.players > 1, barH = two ? 56 : 30;
    ctx.fillStyle = 'rgba(10,8,12,0.85)'; ctx.fillRect(0, 0, VW, barH);
    text(`${String(L.idx + 1).padStart(2, '0')}/${course(L.mode.id).length}  ${L.def.name.toUpperCase()}`, 10, 14, 15, C.text, 'left');
    const ld = save.levelDeaths[dkey(L.mode.id, L.idx)] || 0;
    text(`deaths ${ld}  total ${save.deaths}`, VW - 10, 14, 15, C.danger, 'right');
    if (two) {
      const sh = save.shame[L.mode.id];
      text(`strikes ${'×'.repeat(game.strikes)}${'·'.repeat(Math.max(0, STRIKES - game.strikes))}`, 10, 42, 12, C.portal, 'left');
      text(`shame: RED ${sh[0]} · BLUE ${sh[1]}`, VW - 10, 42, 11, C.text, 'right');
    }
    // persistent red/green light indicator with 0.45s yellow pre-change warning
    if (L.light) {
      const warn = L.lightEnds && L.lightEnds - L.t < 0.45;
      const col = warn ? C.spike : L.light === 'green' ? C.flag : C.danger, ly = barH + 22;
      const w = text(warn ? 'CHANGE!' : `${L.light.toUpperCase()} · ${L.light === L.go ? 'MOVE' : 'FREEZE'}`, VW / 2 + 12, ly, 15, col);
      // a shape as well as a colour: square = go, cross = freeze
      const ix = sn(VW / 2 + 12 - w / 2 - 26);
      if (warn || L.light !== L.go) { for (let k = 0; k < 6; k++) { R(ix + k * PX * 2, ly - 6 + k * PX * 2, 4, 4, col); R(ix + 10 * PX - k * PX * 2 - 4, ly - 6 + k * PX * 2, 4, 4, col); } }
      else R(ix, ly - 8, 16, 16, col);
    }

    if (L.banner) {
      let k = Math.min(1, L.banner.t * 6);
      if (L.banner.life) k = Math.min(k, clamp((L.banner.life - L.banner.t) / 0.3, 0, 1));
      ctx.fillStyle = `rgba(10,8,12,${0.7 * k})`; ctx.fillRect(0, VH / 2 - 60, VW, 120);
      ctx.globalAlpha = k;
      text(L.banner.text, VW / 2, VH / 2 - 12, 54, L.banner.color || C.portal, 'center', null, '#2a0a0a');
      if (L.banner.sub) text(L.banner.sub, VW / 2, VH / 2 + 30, 16, C.text);
      ctx.globalAlpha = 1;
    }
    if (game.message) {
      const m = game.message, a = clamp((1.6 - m.t) / 0.3, 0, 1);
      ctx.globalAlpha = a; text(m.text, VW / 2, barH + 60, 26, C.danger, 'center', null, '#0a080c'); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(10,8,12,0.8)'; ctx.fillRect(0, VH - 28, VW, 28);
    const hint = padCount ? 'stick move · A jump · Y restart · start levels' : `${two ? 'P1 A D W · P2 ← → ↑' : '← → move · space jump'} · R restart · esc levels · M mute`;
    text(hint, VW / 2, VH - 14, 12, 'rgba(232,220,192,0.7)');
    const tags = [admin.unlock && 'N skip', admin.god && 'GOD', admin.speed !== 1 && `${admin.speed}x`].filter(Boolean);
    if (tags.length) text(`ADMIN: ${tags.join(' · ')}`, VW - 10, barH + 16, 12, C.danger, 'right');
  }

  // ---------------------------------------------------------------- cutscenes (js/cutscenes.js; skipped without WebGL)
  const CUT = window.Cutscenes && window.Cutscenes.ok ? window.Cutscenes : null;
  const SKIP = { x: VW - 150, y: 6, w: 140, h: 30 };
  function playCut(id, then) {
    if (!CUT) return then();
    const m = MODE[game.mode];
    let s;
    try { s = CUT.make(id, { players: m.players, chained: !!m.chained, skins: SKINS, areas: AREAS, deaths: save.deaths, sfx }); }
    catch (e) { console.error(e); return then(); }
    game.cut = { s, t: 0, then }; game.state = 'cutscene'; game.clearInput(); particles = []; fxs = [];
  }
  function endCut() {
    const c = game.cut; if (!c) return;
    game.cut = null; CUT.end(c.s); c.then();
  }
  // what a scene can draw over its 3D frame
  const cutUI = {
    bars() { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, 42); ctx.fillRect(0, VH - 56, VW, 56); },
    caption(t, a, b, str) {
      if (t < a || t > b) return;
      ctx.globalAlpha = Math.min(1, (t - a) / 0.3, (b - t) / 0.3); text(str, VW / 2, VH - 28, 16, C.text); ctx.globalAlpha = 1;
    },
    label(str, k) { ctx.globalAlpha = clamp(k * 1.6, 0, 1); text(str, VW / 2, 84, 54, C.portal, 'center', null, '#2a0a0a'); ctx.globalAlpha = 1; },
    shout(str) { text(str, VW / 2 + sn((Math.random() - 0.5) * 8), VH / 2 - 60, 80, C.danger, 'center', null, '#000'); },
    fadeOut(t, a, b) { if (t > a) { ctx.fillStyle = `rgba(0,0,0,${clamp((t - a) / (b - a), 0, 1)})`; ctx.fillRect(0, 0, VW, VH); } },
    card(t, title, sub, color) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = clamp(t / 0.4, 0, 1);
      text(title, VW / 2, VH / 2 - 20, 54, color || C.portal, 'center', null, '#2a0a0a');
      text(sub, VW / 2, VH / 2 + 30, 16, C.text);
      ctx.globalAlpha = 1;
    },
  };
  function drawCut(c) {
    if (!c) return;
    let img;
    try { img = CUT.render(c.s, c.t); } catch (e) { console.error(e); endCut(); return; }
    ctx.drawImage(img, 0, 0, VW, VH);
    c.s.overlay(c.t, cutUI);
    // the skip button, top right, always there
    R(SKIP.x, SKIP.y, SKIP.w, SKIP.h, '#2a2430'); R(SKIP.x, SKIP.y, SKIP.w, PX, '#6d6578');
    text('SKIP >>', SKIP.x + SKIP.w / 2, SKIP.y + SKIP.h / 2, 14, c.t > 0.5 ? C.text : C.dim);
  }

  let titleScene = null;
  function drawTitle(t) {
    if (CUT) {
      try { titleScene = titleScene || CUT.make('title', {}); ctx.drawImage(CUT.render(titleScene, t), 0, 0, VW, VH); }
      catch (e) { console.error(e); }
      return drawTitleText(t);
    }
    drawBg();
    // a little demo: the hero keeps getting got
    const cycle = t % 3.2, floorY = 10.5 * TILE;
    const gone = cycle > 1.6;
    ctx.fillStyle = C.blockEdge; ctx.fillRect(10 * TILE, floorY, 12 * TILE, 4);
    ctx.fillStyle = C.block; ctx.fillRect(10 * TILE, floorY + 4, 12 * TILE, TILE - 4);
    if (!gone) { ctx.fillStyle = C.block; ctx.fillRect(18 * TILE, floorY, 2 * TILE, TILE); }
    const px = 10.5 + Math.min(cycle, 1.6) * 5, fall = gone ? (cycle - 1.6) ** 2 * 40 : 0;
    if (fall < 8) {
      const fakeL = { g: 1, invert: false };
      drawPlayer({ x: px, y: 10.5 - P.h + fall, w: P.w, h: P.h, sx: 1, sy: 1, face: 1, dead: false }, fakeL);
    }
    ctx.fillStyle = C.bg1; if (gone) ctx.fillRect(18 * TILE, floorY, 2 * TILE, TILE);

    drawTitleText(t);
  }
  function drawTitleText(t) {
    text('MASTER BAITER', VW / 2, 62, 80, C.player, 'center', null, '#1a0408');
    text('a platformer that does not like you', VW / 2, 112, 18, C.text, 'center', null, '#0a080c');
    const blink = Math.sin(t * 4) > -0.3;
    if (blink) text('press SPACE / tap to play', VW / 2, VH * 0.74, 22, C.portal, 'center', null, '#0a080c');
    text(`deaths so far: ${save.deaths}`, VW / 2, VH * 0.82, 16, C.danger, 'center', null, '#0a080c');
    text(save.muted ? 'sound off (M)' : 'sound on (M)', VW / 2, VH - 20, 12, C.dim, 'center', null, '#0a080c');
    text('` admin', VW - 14, VH - 20, 12, C.dim, 'right', null, '#0a080c');
  }

  function drawAdmin() {
    drawBg();
    text('ADMIN PANEL', VW / 2, 90, 48, C.danger);
    text('this session only · not saved', VW / 2, 132, 14, C.dim, 'center', 'normal');
    ADMIN_ITEMS.forEach((it, i) => {
      const on = i === admin.sel;
      text(on ? `> ${it.label()} <` : it.label(), VW / 2, ADMIN_ROW.top + i * ADMIN_ROW.h, 20, on ? C.portal : C.text, 'center', on ? undefined : 'normal');
    });
    text('↑/↓ choose · ←/→ or ENTER change · ESC back', VW / 2, VH - 30, 14, C.dim, 'center', 'normal');
  }

  const SEL = { cols: 5, w: 120, h: 86, gapX: 24, gapY: 14, viewTop: 116, viewBottom: 404 };
  function rowStep() { return SEL.h + SEL.gapY; }
  function maxSelectScroll() {
    const totalLevels = course(game.mode).length;
    const totalRows = Math.ceil(totalLevels / SEL.cols);
    const visibleRows = Math.floor((SEL.viewBottom - SEL.viewTop + SEL.gapY) / rowStep());
    const extraRows = Math.max(0, totalRows - visibleRows);
    return extraRows * rowStep();
  }
  function selectRect(i, scroll = 0) {
    const totalW = SEL.cols * SEL.w + (SEL.cols - 1) * SEL.gapX, x0 = (VW - totalW) / 2;
    const row = Math.floor(i / SEL.cols);
    const col = i % SEL.cols;
    return {
      x: x0 + col * (SEL.w + SEL.gapX),
      y: SEL.viewTop + row * rowStep() - scroll,
      w: SEL.w,
      h: SEL.h
    };
  }
  function selectHit(x, y) {
    if (y < SEL.viewTop || y > SEL.viewBottom) return -1;
    for (let i = 0; i < course(game.mode).length; i++) {
      const r = selectRect(i, game.scrollY);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }
  function updateSelectScroll(instantly = false) {
    const sel = game.sel;
    const row = Math.floor(sel / SEL.cols);
    const step = rowStep();
    const visibleRows = Math.floor((SEL.viewBottom - SEL.viewTop + SEL.gapY) / step);
    const maxScroll = maxSelectScroll();

    const curScrollRow = Math.round(game.targetScrollY / step);
    if (row < curScrollRow) {
      game.targetScrollY = row * step;
    } else if (row >= curScrollRow + visibleRows) {
      game.targetScrollY = (row - visibleRows + 1) * step;
    }
    game.targetScrollY = clamp(game.targetScrollY, 0, maxScroll);
    if (instantly) game.scrollY = game.targetScrollY;
  }
  function drawSelect(t) {
    drawBg();
    text('PICK YOUR POISON', VW / 2, 45, 36, C.player);
    text(`${MODE[game.mode].name} · ESC back · ↑/↓/Wheel to scroll`, VW / 2, 82, 13, C.dim, 'center', 'normal');

    // Smooth scroll interpolation
    game.scrollY = approach(game.scrollY, game.targetScrollY, 20);

    // Clip to scroll viewable area
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, SEL.viewTop, VW, SEL.viewBottom - SEL.viewTop);
    ctx.clip();

    for (let i = 0; i < course(game.mode).length; i++) {
      const r = selectRect(i, game.scrollY);
      if (r.y + r.h < SEL.viewTop - 5 || r.y > SEL.viewBottom + 5) continue;
      const open = i < game.unlocked(), on = i === game.sel;
      ctx.fillStyle = on ? 'rgba(255,79,139,0.25)' : 'rgba(232,230,240,0.06)';
      roundRect(r.x, r.y, r.w, r.h, 10); ctx.fill();
      ctx.strokeStyle = on ? C.player : open ? C.blockEdge : 'rgba(232,230,240,0.15)'; ctx.lineWidth = on ? 3 : 1.5; ctx.stroke();
      text(open ? String(i + 1) : '?', r.x + r.w / 2, r.y + 32, 30, open ? C.text : C.dim);
      const d = save.levelDeaths[dkey(game.mode, i)] || 0;
      if (open) { const w = text(String(d), r.x + r.w / 2 + 10, r.y + 65, 13, C.danger); skullIcon(r.x + r.w / 2 + 10 - w / 2 - 20, r.y + 55, C.danger); }
      else text('locked', r.x + r.w / 2, r.y + 65, 13, C.dim);
    }
    ctx.restore();

    // Scrollbar indicator
    const maxScroll = maxSelectScroll();
    if (maxScroll > 0) {
      const barTrackX = VW - 30;
      const barTrackY = SEL.viewTop;
      const barTrackH = SEL.viewBottom - SEL.viewTop;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(barTrackX, barTrackY, 5, barTrackH, 2.5);
      ctx.fill();

      const totalH = (SEL.viewBottom - SEL.viewTop) + maxScroll;
      const viewRatio = (SEL.viewBottom - SEL.viewTop) / totalH;
      const thumbH = Math.max(32, barTrackH * viewRatio);
      const thumbY = barTrackY + (game.scrollY / maxScroll) * (barTrackH - thumbH);
      ctx.fillStyle = C.portal;
      roundRect(barTrackX, thumbY, 5, thumbH, 2.5);
      ctx.fill();
    }

    // Selected level description footer
    const s = course(game.mode)[game.sel];
    if (s) text(s.name, VW / 2, VH - 50, 22, C.portal);
  }

  const MCARD = { w: 300, h: 260, gap: 10, top: 140 };
  function modeRect(i) {
    const x0 = (VW - (MODES.length * MCARD.w + (MODES.length - 1) * MCARD.gap)) / 2;
    return { x: x0 + i * (MCARD.w + MCARD.gap), y: MCARD.top, w: MCARD.w, h: MCARD.h };
  }
  function modeHit(x, y) {
    for (let i = 0; i < MODES.length; i++) { const r = modeRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; }
    return -1;
  }
  function drawMode(t) {
    drawBg();
    text('CHOOSE YOUR SUFFERING', VW / 2, 80, 36, C.player);
    const fakeL = { g: 1, invert: false };
    MODES.forEach((m, i) => {
      const r = modeRect(i), on = i === game.modeSel, cx = r.x + r.w / 2;
      ctx.fillStyle = on ? 'rgba(255,79,139,0.22)' : 'rgba(232,230,240,0.06)';
      roundRect(r.x, r.y, r.w, r.h, 14); ctx.fill();
      ctx.strokeStyle = on ? C.player : C.blockEdge; ctx.lineWidth = on ? 3 : 1.5; ctx.stroke();
      // little preview
      const bob = (k) => Math.abs(Math.sin(t * 3 + k)) * 0.5;
      ctx.save(); ctx.translate(cx, r.y + 105); ctx.scale(1.6, 1.6); ctx.translate(-cx, -(r.y + 105));
      const py = (r.y + 105) / TILE;
      if (m.id === 'single') {
        drawPlayer({ idx: 0, x: cx / TILE - 0.4, y: py - P.h - bob(0), w: P.w, h: P.h, sx: 1, sy: 1, face: 1 }, fakeL);
      } else if (m.id === 'multi') {
        drawPlayer({ idx: 0, x: cx / TILE - 1.2, y: py - P.h - bob(0), w: P.w, h: P.h, sx: 1, sy: 1, face: 1 }, fakeL);
        drawPlayer({ idx: 1, x: cx / TILE + 0.4, y: py - P.h - bob(1.5), w: P.w, h: P.h, sx: 1, sy: 1, face: -1 }, fakeL);
      }
      ctx.restore();
      if (m.id === 'special') {
        const wob = Math.sin(t * 5) * 0.12;
        ctx.save(); ctx.translate(cx, r.y + 85); ctx.rotate(wob);
        text('?', 0, 0, 96, C.portal); ctx.restore();
        for (let k = 0; k < 5; k++) {
          const a = t * 1.5 + k * 1.256;
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6 + k);
          ctx.fillStyle = k % 2 ? C.player : C.spike;
          ctx.fillRect(cx + Math.cos(a) * 70 - 2, r.y + 85 + Math.sin(a) * 40 - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
      }
      text(m.name, cx, r.y + 175, 22, on ? C.text : C.blockEdge);
      text(m.sub, cx, r.y + 205, 14, C.dim, 'center', 'normal');
      const lvl = Math.min(save.progress[m.id] || 1, course(m.id).length);
      text(`level ${lvl} / ${course(m.id).length}`, cx, r.y + 235, 13, C.danger, 'center', 'normal');
    });
    const m = MODES[game.modeSel];
    text(padCount ? `Controller${padCount > 1 ? `s (${padCount})` : ''} connected · Stick/D-pad move · A jump` : m.hint, VW / 2, MCARD.top + MCARD.h + 45, 15, C.portal, 'center', 'normal');
    if (m.players > 1 && matchMedia('(pointer: coarse)').matches && padCount < 2) text('2-player modes need a keyboard or 2 controllers', VW / 2, MCARD.top + MCARD.h + 72, 13, C.danger, 'center', 'normal');
    text(padCount ? '←/→ choose · A play · Y pick level · B back' : '←/→ choose · ENTER play · L pick level · ESC back', VW / 2, VH - 30, 14, C.dim, 'center', 'normal');
  }

  function drawEnd(t) {
    drawBg();
    text('YOU WIN.', VW / 2, 170, 80, C.portal);
    const endSub = { single: 'for real this time.', multi: 'together. somehow.', special: 'and you are STILL chained together.' };
    text(endSub[game.mode], VW / 2, 230, 18, C.text, 'center', 'normal');
    text(`total deaths: ${save.deaths}`, VW / 2, 300, 30, C.danger);
    const rank = save.deaths < 25 ? 'suspiciously good' : save.deaths < 60 ? 'respectable suffering' : save.deaths < 120 ? 'certified rager' : 'controller is in the wall';
    text(`rank: ${rank}`, VW / 2, 345, 18, C.text, 'center', 'normal');
    if (Math.sin(t * 4) > -0.3) text('press SPACE', VW / 2, 430, 20, C.player);
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now; game.time += dt;
    pollPads();
    if (game.state === 'play') {
      acc += dt * admin.speed;
      while (acc >= STEP) { game.level.step(STEP); acc -= STEP; }
    }
    updateParticles(dt);
    updateFx(dt);
    if (game.message) { game.message.t += dt; if (game.message.t > 1.6) game.message = null; }
    if (game.state === 'cutscene' && game.cut) { game.cut.t += dt; if (game.cut.t >= game.cut.s.dur) endCut(); }

    baseTransform();
    if (game.state === 'title') drawTitle(game.time);
    else if (game.state === 'mode') drawMode(game.time);
    else if (game.state === 'select') drawSelect(game.time);
    else if (game.state === 'admin') drawAdmin();
    else if (game.state === 'play') drawLevel(game.level);
    else if (game.state === 'cutscene') drawCut(game.cut);
    else drawEnd(game.time);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // deterministic hooks for automated tests (no effect on normal play)
  window.__ragebait = {
    game, save, playCut, keys: ctl[0], pressed: pressed[0], ctl, pressedAll: pressed, pollPads,
    load(i, mode = 'single') { game.setMode(mode); game.start(i); },
    step(n = 1) { for (let i = 0; i < n; i++) game.level.step(STEP); },
    STEP,
  };
})();
