// Online play check: two copies of the game, each in its own VM, talk through server/relay.mjs (its real Room
// class, over fake sockets with latency and jitter). They host and join a room, play 25 s of random inputs, and
// must stay identical tick for tick (through deaths, a restart and a strike-out); then a forced drift must resync, and leaving must end it for both.
// Run: node tests/net.js
const path = require('path'), fs = require('fs'), vm = require('vm');
const root = path.resolve(__dirname, '..');

(async () => {
  // the relay's runtime: WebSocketPair, a 101 Response, and a Durable Object ctx per room
  let clock = 0;
  const due = [];   // [time, fn], delivered in order
  const later = (ms, fn, ch) => { const at = Math.max(ch.last || 0, clock + ms); ch.last = at; due.push([at, fn]); };
  globalThis.Response = class { constructor(body, o) { Object.assign(this, o); } };
  // the server end buffers what the Room does before our fake browser socket wires it up
  globalThis.WebSocketPair = class { constructor() { const c = {}, s = { buf: [], accept() {}, send(m) { this.buf.push(['send', m]); }, close() { this.buf.push(['close']); } }; c.peer = s; return { 0: c, 1: s }; } };
  const relay = await import(path.join(root, 'server/relay.mjs'));
  const rooms = new Map();
  const env = {
    ASSETS: { fetch: () => ({ status: 404 }) },
    ROOMS: {
      idFromName: (n) => n,
      get: (id) => {
        if (!rooms.has(id)) {
          const list = [];
          const ctx = { acceptWebSocket: (ws, tags) => { ws.tags = tags; list.push(ws); }, getWebSockets: (tag) => list.filter((w) => !w.gone && (!tag || w.tags.includes(tag))) };
          rooms.set(id, new relay.Room(ctx));
        }
        return rooms.get(id);
      },
    },
  };

  let lag = 45, jitter = 30, seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const delay = () => lag + rnd() * jitter;

  function boot(name) {
    const noop = () => {}, store = {}, on = {};
    // a canvas that takes any call: every property and every result is this same do-nothing thing
    const sink = new Proxy([], { set: () => true });
    const ctx = new Proxy(function () {}, { get: (t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : k === 'width' ? 50 : k === 'data' ? sink : k === 'toString' || k === 'valueOf' ? () => 0 : ctx), apply: () => ctx, set: () => true });
    const el = () => ({ style: {}, hidden: true, addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, getContext: () => ctx, classList: { add: noop, remove: noop }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) });
    const sb = {
      console, Math, Date, Set, Map, Array, Object, String, Number, Boolean, JSON, performance: { now: () => clock },
      Image: class {}, setInterval: noop, DOMMatrix: class { scaleSelf() { return this; } translateSelf() { return this; } }, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: (t, f) => (on[t] = on[t] || []).push(f), requestAnimationFrame: (f) => { sb.raf = f; },
      matchMedia: () => ({ matches: false }), document: { getElementById: el, createElement: el }, location: { protocol: 'https:', host: 'game.test', reload: noop },
      localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    };
    // the browser side of a socket: sends reach the Room after a delay, and the Room's sends reach us after one
    sb.WebSocket = class {
      constructor(url) {
        this.readyState = 1; this.up = {}; this.down = {};
        const res = relay.default.fetch({ url, headers: { get: () => 'websocket' } }, env);
        const s = res.webSocket.peer;   // the server end
        this.s = s; this.room = rooms.get(url.match(/\/net\/([A-Z]{4})/)[1]);
        s.send = (m) => { if (!s.gone) later(delay(), () => this.readyState === 1 && this.onmessage && this.onmessage({ data: m }), this.down); };
        s.close = () => { if (s.gone) return; s.gone = true; later(delay(), () => { if (this.readyState === 1) { this.readyState = 3; if (this.onclose) this.onclose(); } }, this.down); };
        for (const [op, m] of s.buf) s[op](m);
      }
      send(m) { later(delay(), () => !this.s.gone && this.room.webSocketMessage(this.s, m), this.up); }
      close() { this.readyState = 3; later(delay(), () => { if (!this.s.gone) { this.s.gone = true; this.room.webSocketClose(this.s); } }, this.up); }
    };
    sb.window = sb; vm.createContext(sb);
    for (const f of ['levels.js', 'bosses.js', 'fx-data.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), sb, { filename: f });
    const R = sb.__ragebait;
    const key = (type, code, k = code) => (on[type] || []).forEach((f) => f({ code, key: k, repeat: false, preventDefault: noop }));
    return { name, sb, R, key, down: (c, k) => key('keydown', c, k), up: (c, k) => key('keyup', c, k) };
  }

  const bad = [], chk = (ok, msg) => { if (!ok) { bad.push(msg); console.log(`[net] ${msg}`); } };
  const A = boot('host'), B = boot('guest');
  const seen = [new Map(), new Map()];   // tick -> state, sampled at the end of each frame
  const state = (X) => { const L = X.R.game.level; return `${X.R.game.idx}|${L.t.toFixed(4)}|${X.R.game.runDeaths}|${X.R.game.strikes}|` + L.players.map((p) => `${p.x},${p.y},${p.vx},${p.vy},${p.dead}`).join('|'); };
  const frame = () => {
    clock += 1000 / 60;
    due.sort((a, b) => a[0] - b[0]);
    while (due.length && due[0][0] <= clock) due.shift()[1]();
    [A, B].forEach((X) => X.sb.raf(clock));
  };
  // record every tick each side runs: wrap Level.step once a level exists
  const watch = (X, i) => {
    const proto = Object.getPrototypeOf(X.R.game.level), step = proto.step;
    proto.step = function (dt) { step.call(this, dt); if (X.R.net.on) seen[i].set(X.R.net.tick, state(X)); };
  };
  const run = (sec, each) => { for (let f = 0; f < sec * 60; f++) { if (each) each(f); frame(); } };

  // errors first: a code nobody hosts
  B.R.game.state = 'mode'; B.R.game.modeSel = 1; B.R.key('Enter');
  chk(B.R.game.state === 'net', `multiplayer did not open the online picker (${B.R.game.state})`);
  B.R.net.sel = 2; B.R.key('Enter'); B.R.net.code = 'QQQQ'; B.R.key('Enter');
  run(0.5);
  chk(B.R.net.view === 'pick' && /no room/.test(B.R.net.note), `joining a missing room: view ${B.R.net.view}, note "${B.R.net.note}"`);

  // host a room on the multiplayer course at the host's saved level, and join it
  A.R.save.progress.multi = 4;   // Two Keys: random play dies there, three times strikes back to level 3
  B.R.save.progress.multi = 6;   // the guest got further: online, both may pick up to level 6
  B.R.save.snappy = true;        // and plays SNAPPY: it sends its own inputs 6 ticks less ahead than the host
  A.R.game.state = 'mode'; A.R.game.modeSel = 1; A.R.key('Enter'); A.R.net.sel = 1; A.R.key('Enter');
  const code = A.R.net.code;
  chk(/^[A-Z]{4}$/.test(code) && A.R.net.view === 'wait', `hosting gave code "${code}" view ${A.R.net.view}`);
  run(0.3);
  B.R.net.sel = 2; B.R.key('Enter');
  for (const c of code) B.down('Key' + c, c.toLowerCase()), B.up('Key' + c, c.toLowerCase());   // typed on the keyboard
  chk(B.R.net.code === code, `typed "${B.R.net.code}", wanted "${code}"`);
  B.R.key('Enter');
  run(2);   // three pings through the lag, then go
  chk(A.R.net.on && B.R.net.on && A.R.game.state === 'play' && B.R.game.state === 'play', `did not start: host ${A.R.game.state}/${A.R.net.on}, guest ${B.R.game.state}/${B.R.net.on} "${B.R.net.note}"`);
  chk(A.R.game.idx === 3 && B.R.game.idx === 3 && B.R.game.mode === 'multi', `guest is on ${B.R.game.mode} ${B.R.game.idx + 1}, host on ${A.R.game.idx + 1}`);
  chk(A.R.net.me === 0 && B.R.net.me === 1 && A.R.net.delay - B.R.net.delay === 6, `roles ${A.R.net.me}/${B.R.net.me}, delay host ${A.R.net.delay} / snappy guest ${B.R.net.delay}`);

  // the guest runs right: its own knight is drawn ahead of the shared game (its queued inputs), the host's isn't predicted on its screen
  B.down('ArrowRight'); run(0.4);
  const bp = B.R.net.pred, br = B.R.game.level.players[1];
  chk(bp && bp.idx === 1 && bp.x > br.x + 0.5 && !A.R.net.pred === false && A.R.net.pred.idx === 0, `prediction: guest drawn at ${bp && bp.x.toFixed(2)}, shared game at ${br.x.toFixed(2)}`);
  B.up('ArrowRight'); run(1);

  watch(A, 0); watch(B, 1);
  // a third knight can't get in
  const C = boot('third');
  C.R.game.state = 'mode'; C.R.game.modeSel = 1; C.R.key('Enter'); C.R.net.sel = 2; C.R.key('Enter'); C.R.net.code = code; C.R.key('Enter');
  run(0.5);
  chk(/full/.test(C.R.net.note), `third player: "${C.R.net.note}"`);

  // 25 s of random play from both sides (both use the arrow keys: online, every key is your own knight)
  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp'];
  const held = [new Set(), new Set()];
  const t0 = A.R.net.tick, deaths0 = A.R.save.deaths;
  let lv = null;
  run(25, (f) => {
    [A, B].forEach((X, i) => {
      if (rnd() < 0.08) { const k = KEYS[Math.floor(rnd() * 3)]; if (held[i].has(k)) { held[i].delete(k); X.up(k); } else { held[i].add(k); X.down(k); } }
    });
    if (f === 600) { lv = [A.R.game.level, B.R.game.level]; B.down('KeyR'); B.up('KeyR'); }   // the guest restarts: both must
    lag = f > 900 && f < 1100 ? 140 : 45;          // a laggy patch
  });
  for (const i of [0, 1]) for (const k of held[i]) [A, B][i].up(k);
  const endIdx = A.R.game.idx;
  let common = 0, diff = 0, first = '';
  for (const [t, s] of seen[0]) if (seen[1].has(t)) { common++; if (seen[1].get(t) !== s) { diff++; first = first || `tick ${t}: ${s} vs ${seen[1].get(t)}`; } }
  chk(common > 300 && !diff, `${diff} of ${common} shared ticks differ. ${first}`);
  chk(A.R.net.after === -1 && B.R.net.after === -1, `a resync fired during clean play (host ${A.R.net.after}, guest ${B.R.net.after})`);
  const ran = A.R.net.tick - t0;
  chk(ran > 25 * 120 * 0.75, `only ${ran} ticks in 25 s (${(ran / 30).toFixed(0)}% speed)`);   // the guest plays SNAPPY: less delay, more slow-downs
  chk(A.R.save.deaths > deaths0, 'nobody died in 25 s of random play');   // that both agree on them is in the per-tick states
  chk(lv && A.R.game.level !== lv[0] && B.R.game.level !== lv[1], 'R on the guest did not restart both');

  // a drift on the guest: the hash check must catch it and restart the level on both, then they agree again
  for (let f = 0; f < 600 && (A.R.game.level.over || B.R.game.level.over); f++) frame();   // not while a death restarts the level (that would undo the drift)
  B.R.game.level.players[1].dead = true;   // (a shifted x can be undone by a wall the knight is pressed against)
  seen[0].clear(); seen[1].clear();
  run(3);
  chk(A.R.net.after > 0 && A.R.net.after === B.R.net.after, `no resync after a drift (host ${A.R.net.after}, guest ${B.R.net.after})`);
  common = 0; diff = 0;
  for (const [t, s] of seen[0]) if (t > A.R.net.after && seen[1].has(t)) { common++; if (seen[1].get(t) !== s) diff++; }
  chk(common > 50 && !diff, `after the resync ${diff} of ${common} ticks differ`);

  // the guest's tab stalls for a second: the host waits (and says so) instead of running ahead
  const ht = A.R.net.tick;
  for (let f = 0; f < 60; f++) { clock += 1000 / 60; due.sort((a, b) => a[0] - b[0]); while (due.length && due[0][0] <= clock) due.shift()[1](); A.sb.raf(clock); }
  chk(A.R.net.tick - ht <= A.R.net.delay + 16 && A.R.net.stall > 0.3, `host ran ${A.R.net.tick - ht} ticks alone, stall ${A.R.net.stall.toFixed(2)}`);
  run(1);
  chk(A.R.net.stall === 0 && B.R.net.on, 'did not pick up again after the stall');

  // the guest opens the level select: the host waits and is told why; the guest picks level 6, both go there
  B.R.key('Escape');
  run(0.6);
  chk(B.R.game.state === 'select' && A.R.net.menu && A.R.net.stall > 0.3, `level select: guest ${B.R.game.state}, host told ${A.R.net.menu}, stall ${A.R.net.stall.toFixed(2)}`);
  chk(A.R.game.unlocked() === 6 && B.R.game.unlocked() === 6, `unlocked: host ${A.R.game.unlocked()}, guest ${B.R.game.unlocked()} (want 6 on both)`);
  seen[0].clear(); seen[1].clear();
  B.R.game.sel = 5; B.R.key('Enter');
  run(2);
  chk(A.R.game.idx === 5 && B.R.game.idx === 5 && A.R.game.state === 'play' && !A.R.net.menu, `after the pick: host on ${A.R.game.idx + 1} (${A.R.game.state}), guest on ${B.R.game.idx + 1}`);
  let picked = 0; diff = 0;
  for (const [t, s] of seen[0]) if (seen[1].has(t) && s.startsWith('5|')) { picked++; if (seen[1].get(t) !== s) diff++; }
  chk(picked > 100 && !diff, `after the pick ${diff} of ${picked} ticks differ`);

  // leaving: from the level select (Esc, then X) ends it for both
  A.R.key('Escape'); A.R.key('KeyX');
  run(0.5);
  chk(!A.R.net.on && A.R.game.state === 'net' && /you left/.test(A.R.net.note), `host after leaving: ${A.R.game.state} "${A.R.net.note}"`);
  chk(!B.R.net.on && B.R.game.state === 'net' && /partner left/.test(B.R.net.note), `guest after host left: ${B.R.game.state} "${B.R.net.note}"`);

  // offline is still the old local co-op
  A.R.net.sel = 0; A.R.key('Enter');
  chk(A.R.game.state === 'play' && !A.R.net.on && A.R.game.level.players.length === 2, `OFFLINE gave ${A.R.game.state}`);

  if (!bad.length) console.log(`[net] ${ran} ticks of random co-op in lockstep (${A.R.save.deaths - deaths0} deaths, ending on level ${endIdx + 1}), ${common} in sync after a forced drift`);
  console.log(bad.length ? `FAILED: ${bad.length}` : 'OK');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
