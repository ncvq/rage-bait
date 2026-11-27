// Story cutscenes in pixel-art 3D: voxel scenes rendered by three.js at the game's 480x270, then posterized
// with an ordered dither so they sit next to the 2D pixel art. The game draws the frame and the captions.
//
//   Cutscenes.make(id, opts) -> { dur, update(t), overlay(t, ui) }   ids: title intro area1 area2 area3 ending
//   Cutscenes.render(scene)  -> the canvas to draw this frame
//
// opts: { players: 1|2, chained, skins: [{main,dark,hi,plume}], areas: [{name,...}], deaths, sfx }
// Units are tiles. y is up; the camera mostly looks down -z.
window.Cutscenes = (() => {
  'use strict';
  const THREE = window.THREE;
  if (!THREE) return null;
  const W = 480, H = 270;
  let renderer;
  try {
    THREE.ColorManagement.enabled = false;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.useLegacyLights = true;
  } catch (e) { return null; }

  // ---------------------------------------------------------------- posterize + dither pass
  const target = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const post = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: target.texture }, levels: { value: 9 }, fade: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tex; uniform float levels; uniform float fade; varying vec2 vUv;
      float b2(vec2 p) { return mod(2.0 * p.x + 3.0 * p.y, 4.0); }
      float bayer(vec2 p) { p = mod(p, 4.0); return (4.0 * b2(mod(p, 2.0)) + b2(floor(p / 2.0)) + 0.5) / 16.0; }
      void main() {
        vec3 c = texture2D(tex, vUv).rgb * fade;
        float d = bayer(floor(vUv * vec2(${W}.0, ${H}.0))) - 0.5;
        c = floor(c * levels + d * 0.7 + 0.5) / levels;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const span = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const COL = {};
  const col = (h) => COL[h] || (COL[h] = new THREE.Color(h));

  // a voxel builder: boxes merged into one vertex-coloured mesh (one draw call per builder)
  const LAMBERT = new THREE.MeshLambertMaterial({ vertexColors: true });
  const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
  const SKY = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });   // moon and stars ignore the fog
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  function builder(seed = 1) {
    const p = [], n = [], c = [], r = rng(seed);
    return {
      // box with its min corner at x, y, z; j = random brightness jitter per box
      box(x, y, z, w, h, d, hex, j = 0.08) {
        const k = 1 + (r() - 0.5) * j, cc = col(hex);
        for (const [nn, q] of FACES) for (const i of [0, 1, 2, 0, 2, 3]) {
          p.push(x + q[i][0] * w, y + q[i][1] * h, z + q[i][2] * d); n.push(...nn); c.push(cc.r * k, cc.g * k, cc.b * k);
        }
      },
      mesh(mat = LAMBERT) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
        return new THREE.Mesh(g, mat);
      },
    };
  }
  function camAt(cam, pos, look) { cam.position.set(...pos); cam.lookAt(...look); }
  // keyframed camera: keys = [[t, [pos], [look]], ...], smooth between them
  function camPath(cam, t, keys) {
    let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, p0, l0] = keys[i], [t1, p1, l1] = keys[Math.min(i + 1, keys.length - 1)], k = t1 > t0 ? ease((t - t0) / (t1 - t0)) : 1;
    camAt(cam, p0.map((v, j) => lerp(v, p1[j], k)), l0.map((v, j) => lerp(v, l1[j], k)));
  }

  // ---------------------------------------------------------------- shared props
  const V = 1 / 15;   // one art pixel of the 2D sprites, as a voxel
  // the knight from the game: 12 x 13 voxels, helmet, crest, two eyes on the front
  function knight(skin) {
    const g = new THREE.Group(), body = new THREE.Group(), b = builder(7), o = '#0c080c';
    const vb = (x, y, z, w, h, d, c) => b.box((x - 6) * V, y * V, (z - 4) * V, w * V, h * V, d * V, c, 0.02);
    vb(0, 1, 0, 12, 3, 8, skin.dark); vb(0, 4, 0, 12, 6, 8, skin.main); vb(1, 5, 7.6, 1, 4, 0.5, skin.hi);
    vb(0, 10, 0, 12, 4, 8, '#8a8494'); vb(0, 13.5, 0, 12, 1, 8, '#c8c4d0');
    vb(2, 14, 1, 8, 2, 6, skin.plume); vb(3, 16, 2, 6, 1, 4, skin.plume);
    for (const ex of [2, 7]) { vb(ex, 6, 8, 3, 3, 0.6, '#ffffff'); vb(ex + 1, 6, 8.4, 2, 2, 0.5, o); }
    body.add(b.mesh()); g.add(body);
    const feet = [0, 1].map((i) => { const f = builder(3); f.box(-1.5 * V, 0, -2 * V, 3 * V, 1 * V, 5 * V, o, 0); const m = f.mesh(); m.position.x = (i ? 3 : -3) * V; g.add(m); return m; });
    body.position.y = V;
    g.userData = { body, feet };
    return g;
  }
  // walking: bob and alternate the feet; k = 0 stands still
  function walk(kn, t, k = 1) {
    const s = Math.sin(t * 14) * k;
    kn.userData.body.position.y = V + Math.abs(s) * 1.5 * V;
    kn.userData.feet[0].position.z = s * 2 * V; kn.userData.feet[1].position.z = -s * 2 * V;
  }
  function chain(scene) {
    const links = [];
    for (let i = 0; i < 12; i++) { const b = builder(i); b.box(-0.06, -0.06, -0.06, 0.12, 0.12, 0.12, i % 2 ? '#6b6b78' : '#9a9aa8', 0); const m = b.mesh(); scene.add(m); links.push(m); }
    // the links hide with the knights (e.g. once they're through the gate)
    const fn = (a, c) => links.forEach((m, i) => { const k = (i + 1) / (links.length + 1); m.visible = a.visible && c.visible; m.position.set(lerp(a.position.x, c.position.x, k), lerp(a.position.y, c.position.y, k) + 0.35 - Math.sin(k * Math.PI) * 0.25, lerp(a.position.z, c.position.z, k)); });
    fn.links = links;
    return fn;
  }
  // a wall torch: bracket, flickering flame voxels, a point light
  function torch(scene, x, y, z, flame = ['#ff8a2a', '#ffd23f', '#fff8d6'], light = 0xff8a2a) {
    const b = builder(x * 7); b.box(x - 0.08, y - 0.6, z, 0.16, 0.6, 0.16, '#5a3a22'); b.box(x - 0.15, y - 0.35, z - 0.05, 0.3, 0.08, 0.26, '#6b6b78');
    scene.add(b.mesh());
    const fl = new THREE.Group(); fl.position.set(x, y, z + 0.08); scene.add(fl);
    const parts = flame.map((c, i) => { const f = builder(i); const s = 0.22 - i * 0.06; f.box(-s / 2, 0, -s / 2, s, s * 1.6, s, c, 0); const m = f.mesh(GLOW); fl.add(m); return m; });
    const L = new THREE.PointLight(light, 1.6, 9, 1.5); L.position.set(x, y + 0.3, z + 0.6); scene.add(L);
    return (t) => { parts.forEach((m, i) => { m.position.y = Math.abs(Math.sin(t * (9 + i * 3) + x)) * 0.06 * (i + 1); m.scale.y = 1 + Math.sin(t * 13 + i + x) * 0.25; }); L.intensity = 1.4 + Math.sin(t * 17 + x) * 0.25; };
  }
  // the fire portal: two spiral arms of glowing voxels in an oval rim
  function portal(scene, x, y, z, hot) {
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
    const pal = hot ? ['#fff0a0', '#ffffff', '#ffd060'] : ['#ffae35', '#ffe27a', '#cc3a1a'];
    const rim = builder(5), arms = builder(6);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; rim.box(Math.cos(a) * 0.6 - 0.06, Math.sin(a) * 0.8 - 0.06, -0.06, 0.12, 0.12, 0.12, pal[i % 2], 0); }
    for (let i = 0; i < 36; i++) { const k = i / 36, a = k * Math.PI * 3, rr = 0.55 * (1 - k); for (const s of [0, Math.PI]) arms.box(Math.cos(a + s) * rr - 0.05, Math.sin(a + s) * rr * 1.3 - 0.05, -0.05, 0.1, 0.1, 0.1, pal[(i >> 2) % 3], 0); }
    const back = builder(4); back.box(-0.55, -0.75, -0.1, 1.1, 1.5, 0.05, '#2a0806', 0);
    g.add(back.mesh(GLOW)); g.add(rim.mesh(GLOW)); const am = arms.mesh(GLOW); g.add(am);
    const L = new THREE.PointLight(hot ? 0xfff0a0 : 0xff8a2a, 2.2, 10, 1.4); L.position.set(x, y, z + 0.8); scene.add(L);
    return (t) => { am.rotation.z = -t * 3; g.scale.setScalar(1 + Math.sin(t * 4) * 0.03); };
  }

  // ---------------------------------------------------------------- the castle (title + intro)
  function castleWorld() {
    const scene = new THREE.Scene();
    scene.background = col('#2a1838');
    scene.fog = new THREE.Fog(0x2a1838, 40, 130);
    scene.add(new THREE.HemisphereLight(0x8a7ab8, 0x1a1020, 0.85));
    const moon = new THREE.DirectionalLight(0xc8c0ff, 0.55); moon.position.set(-30, 40, 20); scene.add(moon);
    const sun = new THREE.DirectionalLight(0xff8a50, 0.45); sun.position.set(40, 8, -30); scene.add(sun);
    const s = builder(11), gl = builder(12), sky = builder(13), r = rng(3);
    // ground, a path up to the gate, far hills
    s.box(-90, -1, -90, 180, 1, 180, '#2a3a24', 0);
    for (let z = 0; z < 40; z += 1) for (let x = -1.5; x < 1.5; x += 1) s.box(x + (r() - 0.5) * 0.1, -0.95, z, 0.95, 0.98, 0.95, '#6d6578', 0.2);
    for (let i = 0; i < 40; i++) { const x = -90 + i * 4.6, h = 6 + r() * 14; s.box(x, -1, -85 - r() * 5, 5 + r() * 4, h, 6, '#1e1430', 0.1); }
    for (let i = 0; i < 60; i++) { const a = r() * Math.PI * 2, d = 18 + r() * 40; s.box(Math.cos(a) * d, -0.2, Math.sin(a) * d + 10, 0.6, 0.5 + r() * 1.2, 0.6, r() < 0.5 ? '#1f3a1e' : '#2a4a24', 0.3); }
    // walls with crenellations
    const stone = (x, y, z, w, h, d) => {
      for (let yy = 0; yy < h; yy += 0.5) for (let xx = 0; xx < w; xx += 1) for (let zz = 0; zz < d; zz += 1)
        s.box(x + xx + ((yy * 2) % 2 ? 0.5 : 0) * (d < 2 ? 1 : 0), y + yy, z + zz, Math.min(1, w - xx), 0.5, Math.min(1, d - zz), r() < 0.15 ? '#3a3440' : '#4a4352', 0.15);
    };
    const cren = (x, z, w, d, y) => { for (let i = 0; i < Math.max(w, d); i += 2) s.box(w > d ? x + i : x, y, w > d ? z : z + i, 1, 0.8, 1, '#56505e', 0.1); };
    stone(-12, 0, -1, 10.5, 7, 1); stone(1.5, 0, -1, 10.5, 7, 1); stone(-1.5, 4, -1, 3, 3, 1);   // front wall with the gate hole
    stone(-12, 0, -17, 24, 7, 1); stone(-12, 0, -17, 1, 7, 16); stone(11, 0, -17, 1, 7, 16);
    cren(-12, -1, 24, 1, 7); cren(-12, -17, 24, 1, 7); cren(-12, -17, 1, 16, 7); cren(11, -17, 1, 16, 7);
    s.box(-1.9, 3.5, -1.2, 3.8, 0.6, 1.4, '#6d6578', 0);   // the arch lintel
    // corner towers with roofs and banners
    for (const [tx, tz] of [[-14, -3], [10, -3], [-14, -19], [10, -19]]) {
      stone(tx, 0, tz, 4, 11, 4); cren(tx, tz, 4, 1, 11); cren(tx, tz + 3, 4, 1, 11);
      for (let k = 0; k < 4; k++) s.box(tx + 0.5 + k * 0.5, 11 + k * 0.9, tz + 0.5 + k * 0.5, 3 - k, 0.9, 3 - k, k % 2 ? '#7a1c2e' : '#8a2434', 0.05);
      s.box(tx + 1.9, 15, tz + 1.9, 0.12, 2, 0.12, '#3a2a20', 0); s.box(tx + 2, 16.2, tz + 1.9, 1.2, 0.7, 0.08, '#c83a4a', 0);
      for (const wy of [4, 7.5]) gl.box(tx + 1.6, wy, tz + 4, 0.8, 1, 0.06, '#ffc46a', 0);
    }
    // the keep
    stone(-4, 0, -14, 8, 15, 7); cren(-4, -8, 8, 1, 15); cren(-4, -14, 8, 1, 15);
    for (let k = 0; k < 5; k++) s.box(-3.5 + k * 0.7, 15 + k * 0.9, -13.5 + k * 0.6, 7 - k * 1.4, 0.9, 6 - k * 1.2, k % 2 ? '#3a2a50' : '#4a3a64', 0.05);
    for (const [wx, wy] of [[-2.5, 9], [1.5, 9], [-0.5, 12], [-2.5, 5], [1.5, 5]]) gl.box(wx, wy, -7, 1, 1.4, 0.06, '#ffc46a', 0);
    // moon and stars
    sky.box(62, 26, -95, 6, 6, 1, '#f4ecd8', 0); sky.box(63, 27, -94.9, 2, 1.5, 1, '#c8c0b0', 0);
    for (let i = 0; i < 90; i++) sky.box(-100 + r() * 200, 20 + r() * 60, -100, 0.4, 0.4, 0.4, r() < 0.3 ? '#ffffff' : '#a8a0d0', 0);
    scene.add(s.mesh()); scene.add(gl.mesh(GLOW)); scene.add(sky.mesh(SKY));
    // the portcullis (moves), gate darkness, torches either side
    const dark = builder(2); dark.box(-1.5, 0, -1.4, 3, 3.6, 0.3, '#05040a', 0); scene.add(dark.mesh(GLOW));
    const pb = builder(9); for (let i = 0; i < 6; i++) pb.box(-1.4 + i * 0.55, 0, -0.9, 0.14, 3.5, 0.14, '#3a3a44', 0.05);
    for (let j = 0; j < 4; j++) pb.box(-1.5, 0.4 + j * 0.9, -0.9, 3, 0.12, 0.14, '#3a3a44', 0.05);
    const gate = pb.mesh(); scene.add(gate);
    const torches = [torch(scene, -2.4, 2.6, 0.05), torch(scene, 2.4, 2.6, 0.05)];
    return { scene, gate, update: (t) => torches.forEach((f) => f(t)) };
  }

  // ---------------------------------------------------------------- the areas inside
  const AREA = [
    { brick: ['#2a2333', '#352c40'], stone: ['#4a4352', '#6d6578'], top: '#6b9a48', flame: ['#ff8a2a', '#ffd23f', '#fff8d6'], light: 0xff8a2a, sky: '#16121c', amb: 0x8a7a9a },
    { brick: ['#1c1c28', '#242434'], stone: ['#3a3a4c', '#58586e'], top: '#d8d4c0', flame: ['#2f7fcc', '#9bdcff', '#ffffff'], light: 0x58b4ec, sky: '#0e0e16', amb: 0x6a7a9a },
    { brick: ['#11262c', '#173238'], stone: ['#2a4a50', '#4a7076'], top: '#6ae0c0', flame: ['#3f8a1e', '#a8e04a', '#f4ffd0'], light: 0x6cb82a, sky: '#08141a', amb: 0x5a8a8a },
    { brick: ['#1a1110', '#221614'], stone: ['#3a2a28', '#5a4038'], top: '#ffb43a', flame: ['#cc3a1a', '#ff8a2a', '#ffe27a'], light: 0xff6a1a, sky: '#0a0606', amb: 0x9a5a4a },
  ];
  // a long room: floor, back wall of bricks, ceiling, area dressing. x runs from -8 to 56
  const stationX = (i) => 10 + i * 9;
  const PITS = { crumble: 2.5, leap: 2, glass: 2 };   // stations that stand over a hole in the floor (half-width)
  function areaWorld(n) {
    const A = AREA[n], scene = new THREE.Scene(), r = rng(20 + n);
    const pits = STATIONS[n].map((k, i) => PITS[k] && [stationX(i) - PITS[k], stationX(i) + PITS[k]]).filter(Boolean);
    const inPit = (x) => pits.some(([a, b]) => x >= a && x < b);
    scene.background = col(A.sky);
    scene.fog = new THREE.Fog(A.sky, 14, 34);
    scene.add(new THREE.HemisphereLight(A.amb, 0x100810, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.25); key.position.set(4, 10, 12); scene.add(key);
    const s = builder(30 + n), gl = builder(40 + n);
    for (let x = -8; x < 56; x += 1) {
      if (inPit(x)) { s.box(x, -6, -3, 1, 0.2, 7, '#05040a', 0); for (let z = -3; z < 4; z += 1) s.box(x, -6, z, 1, 5, 0.02, A.stone[0], 0.1); }
      else {
        for (let z = -3; z < 4; z += 1) s.box(x, -1, z, 1, 1, 1, r() < 0.2 ? A.stone[0] : A.stone[1], 0.15);
        s.box(x, -0.04, 3.75, 1, 0.1, 0.25, A.top, 0.3);
        for (let k = 0; k < 3; k++) if (r() < 0.5) s.box(x + r() * 0.7, -0.04, -3 + r() * 6.5, 0.3, 0.08, 0.3, A.top, 0.3);
      }
      for (let y = 0; y < 8; y += 0.5) s.box(x + ((y * 2) % 2 ? 0.5 : 0), y, -4, 1, 0.5, 1, r() < 0.15 ? A.brick[0] : A.brick[1], 0.2);
      s.box(x, 7.5, -3, 1, 1, 4, A.stone[0], 0.1);
    }
    const torches = [];
    for (let x = -4; x < 56; x += 8) torches.push(torch(scene, x + 4, 4.2, -2.9, A.flame, A.light));
    if (n === 1) for (let x = -6; x < 56; x += 6) { s.box(x, 2.5, -3.1, 1, 0.8, 0.2, '#08080e', 0); s.box(x + 0.2, 2.6, -3.05, 0.6, 0.55, 0.3, '#d8d4c0', 0); for (let y = 7.5; y > 5.5; y -= 0.25) s.box(x + 3 + (y * 4) % 2 * 0.05, y, -2.5, 0.12, 0.2, 0.12, '#58586e', 0); }
    if (n === 2) { const w = builder(50); w.box(-8, -0.6, 3, 64, 0.4, 4, '#1a5a64', 0); scene.add(w.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }))); for (let x = -6; x < 56; x += 7) for (let k = 0; k < 3; k++) gl.box(x + k * 0.3, 0, -2.6, 0.2, 0.4 + k * 0.3, 0.2, k === 1 ? '#9a8cff' : '#6ae0c0', 0); }
    if (n === 3) { gl.box(-8, -0.4, 3, 64, 0.3, 4, '#ff6a1a', 0); for (let i = 0; i < 30; i++) gl.box(-6 + r() * 60, 1 + r() * 6, -2.95, 0.08, 0.6 + r(), 0.05, '#ff6a1a', 0); }
    scene.add(s.mesh()); scene.add(gl.mesh(GLOW));
    // drifting motes: dust, spores, embers
    const motes = [];
    if (n) for (let i = 0; i < 40; i++) { const b = builder(i); b.box(-0.04, -0.04, -0.04, 0.08, 0.08, 0.08, n === 1 ? '#c8d0e0' : n === 2 ? '#9bf0e0' : '#ffae35', 0); const m = b.mesh(GLOW); m.userData = { x: -6 + r() * 60, y: r() * 7, z: -2 + r() * 4, s: 0.3 + r() * 0.5 }; scene.add(m); motes.push(m); }
    const update = (t) => {
      torches.forEach((f) => f(t));
      for (const m of motes) { const u = m.userData, dir = n === 1 ? -1 : 1; m.position.set(u.x + Math.sin(t + u.y) * 0.3, ((u.y + dir * t * u.s) % 7 + 7) % 7, u.z); }
    };
    return { scene, update };
  }

  // hazards, each a little looping diorama standing on the floor at x
  const LABELS = {
    saws: 'SAWS', crusher: 'CRUSHERS', gravity: 'GRAVITY FLIPS', crumble: 'CRUMBLING FLOORS',
    leap: 'LEAPS OF FAITH', redlight: 'RED LIGHT, GREEN LIGHT', elevator: 'ELEVATORS', spikes: 'HIDDEN SPIKES',
    lasers: 'LASERS', glass: 'GLASS FLOORS', ladder: 'FAKE LADDERS', shrink: 'SHRINK RAYS',
  };
  const STATIONS = [null, ['saws', 'crusher', 'gravity', 'crumble'], ['leap', 'redlight', 'elevator', 'spikes'], ['lasers', 'glass', 'ladder', 'shrink']];
  function spikeMesh(n, c = '#d8ccb0') { const b = builder(n); for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const s = 0.7 - k * 0.17; b.box(i + 0.5 - s / 2, k * 0.15, -s / 2, s, 0.15, s, k === 3 ? '#f4ecd8' : c, 0.05); } return b.mesh(); }
  function station(scene, kind, x, skins) {
    const g = new THREE.Group(); g.position.x = x; scene.add(g);
    const dummy = () => { const k = knight(skins[0]); k.rotation.y = Math.PI / 4; g.add(k); return k; };
    if (kind === 'saws') {
      const saws = [0, 1].map((i) => { const b = builder(i); for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; for (const rr of [0.35, 0.65, 0.95]) b.box(Math.cos(a) * rr - 0.08, Math.sin(a) * rr - 0.08, -0.06, 0.16, 0.16, 0.12, rr > 0.9 ? '#d8b088' : '#a8754f', 0.1); if (k % 2) b.box(Math.cos(a) * 1.1 - 0.07, Math.sin(a) * 1.1 - 0.07, -0.05, 0.14, 0.14, 0.1, '#d8b088', 0); } b.box(-0.2, -0.2, -0.1, 0.4, 0.4, 0.2, '#2a1a14', 0); const m = b.mesh(); m.position.set(i * 3 - 1.5, 0.9, 0); g.add(m); return m; });
      return (t) => saws.forEach((m, i) => { m.rotation.z = -t * 8; m.position.x = i * 3 - 1.5 + Math.sin(t * 1.6 + i * 2) * 1.2; });
    }
    if (kind === 'crusher') {
      const b = builder(3); b.box(-1.5, 0, -1, 3, 1.6, 2, '#3a3440', 0.1); b.box(-1.5, 1.6, -1, 3, 0.2, 2, '#58586e', 0); const m = b.mesh(); g.add(m);
      const sp = spikeMesh(3); sp.rotation.x = Math.PI; sp.position.set(-1.5, 0, 0); m.add(sp);
      return (t) => { const p = t % 2.2; m.position.y = p < 0.9 ? 6 : p < 1.05 ? lerp(6, 0.55, (p - 0.9) / 0.15) : p < 1.4 ? 0.55 : lerp(0.55, 6, (p - 1.4) / 0.8); };
    }
    if (kind === 'gravity') {
      const b = builder(4); b.box(-0.8, 0, -0.6, 1.6, 0.15, 1.2, '#9a48ec', 0); for (let k = 0; k < 3; k++) b.box(-0.1, 0.4 + k * 0.4, 0, 0.2, 0.2, 0.05, '#c684ff', 0); g.add(b.mesh(GLOW));
      const k = dummy();
      return (t) => { const p = t % 3.2, up = p > 1.2 && p < 2.6, f = up ? ease((p - 1.2) / 0.3) : p > 2.6 ? 1 - ease((p - 2.6) / 0.3) : 0; k.position.set(-2 + clamp(p, 0, 1.2) * 1.6, lerp(0, 7.5, f), 0); k.rotation.z = f * Math.PI; walk(k, t, p < 1.2 ? 1 : 0); };
    }
    if (kind === 'crumble') {
      const blocks = [0, 1, 2, 3, 4].map((i) => { const b = builder(i); b.box(0, -1, -1, 1, 1, 2, '#4a4352', 0.2); b.box(0, -0.05, -1, 1, 0.1, 2, '#6b9a48', 0.2); const m = b.mesh(); m.position.x = i - 2.5; g.add(m); return m; });
      const pit = builder(5); pit.box(-2.5, -1.02, -1, 5, 0.02, 2, '#05040a', 0); g.add(pit.mesh(GLOW));
      return (t) => blocks.forEach((m, i) => { const p = (t - i * 0.25) % 3.4; m.position.y = p > 1.2 && p < 3 ? -((p - 1.2) ** 2) * 6 : 0; m.position.z = p > 0.8 && p < 1.2 ? Math.sin(p * 80) * 0.05 : 0; m.visible = m.position.y > -6; });
    }
    if (kind === 'leap') {
      const pit = builder(1); pit.box(-2, -1.02, -1, 4, 0.04, 2, '#05040a', 0); g.add(pit.mesh(GLOW));
      const b = builder(2); b.box(-1, 1.4, -0.6, 2, 0.3, 1.2, '#ffae35', 0); const plat = b.mesh(GLOW); g.add(plat);
      const sparks = builder(3); for (let i = 0; i < 6; i++) sparks.box(-1 + i * 0.35, 1.5 + (i % 2) * 0.2, 0, 0.08, 0.08, 0.08, '#ffe27a', 0); const sp = sparks.mesh(GLOW); g.add(sp);
      return (t) => { const p = t % 2.4; plat.visible = p > 1 && p < 1.8; sp.visible = !plat.visible && Math.sin(t * 12) > 0; };
    }
    if (kind === 'redlight') {
      const b = builder(4); b.box(-0.1, 0, -1.5, 0.2, 4, 0.2, '#3a3a44', 0); b.box(-0.5, 4, -1.6, 1, 1.4, 0.4, '#2a2430', 0); g.add(b.mesh());
      const lr = builder(5); lr.box(-0.3, 4.75, -1.15, 0.6, 0.5, 0.1, '#e0453a', 0); const red = lr.mesh(GLOW); g.add(red);
      const lg = builder(6); lg.box(-0.3, 4.15, -1.15, 0.6, 0.5, 0.1, '#5cc83a', 0); const green = lg.mesh(GLOW); g.add(green);
      const L = new THREE.PointLight(0xff0000, 1.5, 6, 1.5); L.position.set(x, 4.5, 0); scene.add(L);
      const k = dummy();
      // the knight only walks on green: distance = the green time so far
      return (t) => { const go = Math.floor(t / 1.3) % 2 === 0, moved = (Math.floor(t / 2.6) * 1.3 + Math.min(t % 2.6, 1.3)) * 0.8; red.visible = !go; green.visible = go; L.color.setHex(go ? 0x5cc83a : 0xe0453a); k.position.set(-2 + (moved % 4), 0, 0.5); walk(k, t, go ? 1 : 0); };
    }
    if (kind === 'elevator') {
      const b = builder(7); b.box(-1, 0, -1, 2, 0.3, 2, '#6e4a2a', 0.1); b.box(-1, 0.3, -1, 2, 0.1, 2, '#8a5a2b', 0); const m = b.mesh(); g.add(m);
      const c = builder(8); for (let y = 0; y < 7.5; y += 0.3) { c.box(-0.9, y, -0.95, 0.08, 0.2, 0.08, '#6b6b78', 0); c.box(0.82, y, -0.95, 0.08, 0.2, 0.08, '#6b6b78', 0); } g.add(c.mesh());
      return (t) => { m.position.y = 0.2 + (Math.sin(t * 1.4) * 0.5 + 0.5) * 4.5; };
    }
    if (kind === 'spikes') {
      const rows = [0, 1, 2, 3].map((i) => { const m = spikeMesh(1); m.position.set(i - 2, 0, -0.5); g.add(m); return m; });
      return (t) => rows.forEach((m, i) => { const p = (t * 1.5 - i * 0.3) % 2; m.scale.y = p > 0 && p < 1 ? Math.min(1, p * 6) : 0.01; });
    }
    if (kind === 'lasers') {
      const beams = [-1.5, 0, 1.5].map((bx, i) => {
        const e = builder(i); e.box(bx - 0.3, 0, -0.3, 0.6, 0.4, 0.6, '#4a4352', 0); e.box(bx - 0.3, 6.6, -0.3, 0.6, 0.4, 0.6, '#4a4352', 0); g.add(e.mesh());
        const b = builder(i + 9); b.box(bx - 0.08, 0.4, -0.08, 0.16, 6.2, 0.16, '#ff3b5c', 0); b.box(bx - 0.03, 0.4, 0.05, 0.06, 6.2, 0.06, '#ffd6dd', 0); const m = b.mesh(GLOW); g.add(m); return m;
      });
      const L = new THREE.PointLight(0xff3b5c, 1.2, 6, 1.5); L.position.set(x, 3, 1); scene.add(L);
      return (t) => { beams.forEach((m, i) => { m.visible = Math.sin(t * 3 + i * 2.1) > 0; }); L.intensity = beams.some((m) => m.visible) ? 1.2 : 0; };
    }
    if (kind === 'glass') {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45 });
      const panes = [0, 1, 2, 3].map((i) => { const b = builder(i); b.box(0, -1, -1, 1, 1, 2, '#bfe8ff', 0.1); const m = b.mesh(mat); m.position.x = i - 2; g.add(m); return m; });
      const pit = builder(5); pit.box(-2, -1.5, -1, 4, 0.02, 2, '#05040a', 0); g.add(pit.mesh(GLOW));
      return (t) => panes.forEach((m, i) => { const p = (t - i * 0.15) % 3; m.position.y = p > 1.5 ? -((p - 1.5) ** 2) * 8 : 0; m.rotation.z = p > 1.5 ? (p - 1.5) * (i % 2 ? 2 : -2) : 0; m.visible = m.position.y > -8; });
    }
    if (kind === 'ladder') {
      const ledge = builder(1); ledge.box(-1.5, 4, -1.5, 3, 0.5, 2, '#5a4038', 0.1); g.add(ledge.mesh());
      const b = builder(2); b.box(-0.6, 0, -0.4, 0.12, 4, 0.12, '#6e4a2a', 0); b.box(0.5, 0, -0.4, 0.12, 4, 0.12, '#6e4a2a', 0); for (let y = 0.3; y < 4; y += 0.5) b.box(-0.6, y, -0.4, 1.2, 0.1, 0.1, '#8a5a2b', 0);
      const lad = b.mesh(); g.add(lad);
      return (t) => { const p = t % 3; lad.position.y = p > 1.6 ? -Math.min(4, (p - 1.6) * 6) : 0; };
    }
    if (kind === 'shrink') {
      const gun = builder(3); gun.box(-3, 3.5, -2.9, 1.2, 0.6, 0.8, '#3a3a44', 0); gun.box(-1.8, 3.65, -2.75, 0.5, 0.3, 0.5, '#6cb82a', 0); g.add(gun.mesh());
      const ray = builder(4); for (let i = 0; i < 10; i++) ray.box(-1.3 + i * 0.16, 3.7 - i * 0.33, -2.5 + i * 0.28, 0.12, 0.12, 0.12, '#a8e04a', 0); const rm = ray.mesh(GLOW); g.add(rm);
      const k = dummy(); k.position.set(0.3, 0, 0.3);
      return (t) => { const p = t % 3, on = p > 0.5 && p < 1.1; rm.visible = on && Math.sin(t * 40) > -0.3; const s = p < 1.1 ? lerp(1, 0.4, ease((p - 0.5) / 0.6)) : p > 2.4 ? lerp(0.4, 1, ease((p - 2.4) / 0.4)) : 0.4; k.scale.setScalar(p < 0.5 ? 1 : s); };
    }
    return () => {};
  }

  // ---------------------------------------------------------------- the treasure room (ending)
  function vaultWorld() {
    const scene = new THREE.Scene(), r = rng(77);
    scene.background = col('#0a0606'); scene.fog = new THREE.Fog(0x0a0606, 12, 30);
    scene.add(new THREE.HemisphereLight(0x9a6a4a, 0x100808, 0.6));
    const s = builder(60), gl = builder(61);
    for (let x = -12; x < 12; x++) { for (let z = -6; z < 6; z++) s.box(x, -1, z, 1, 1, 1, r() < 0.3 ? '#3a2a28' : '#5a4038', 0.15); for (let y = 0; y < 9; y += 0.5) s.box(x + ((y * 2) % 2 ? 0.5 : 0), y, -7, 1, 0.5, 1, r() < 0.2 ? '#1a1110' : '#221614', 0.2); }
    // gold heaps and gems
    for (let i = 0; i < 700; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 6, hx = Math.cos(a) * d * 1.6, hz = -3 + Math.sin(a) * d * 0.6; const h = Math.max(0, 1.6 - d * 0.28) * r(); s.box(hx, h * 0.6, hz, 0.3, 0.2, 0.3, r() < 0.08 ? '#fff0a0' : r() < 0.5 ? '#ffd23f' : '#d8a428', 0.2); }
    for (let i = 0; i < 14; i++) gl.box(-8 + r() * 16, 0.4 + r() * 0.6, -5 + r() * 4, 0.18, 0.18, 0.18, ['#e0453a', '#4fb6ff', '#5cff8f'][i % 3], 0);
    s.box(-1.6, 0, -2.2, 3.2, 0.8, 2.4, '#3a2a28', 0.05);   // pedestal
    scene.add(s.mesh()); scene.add(gl.mesh(GLOW));
    const glow = new THREE.PointLight(0xffc46a, 2.4, 14, 1.3); glow.position.set(0, 3, 0); scene.add(glow);
    const torches = [torch(scene, -6, 4, -5.9), torch(scene, 6, 4, -5.9)];
    // the chest, which is a mimic: base, lid (hinged at the back), teeth, tongue, eyes
    const chest = new THREE.Group(); chest.position.set(0, 0.8, -1); scene.add(chest);
    const cb = builder(62); cb.box(-1, 0, -0.7, 2, 1, 1.4, '#8a5a2b', 0.1); cb.box(-1.02, 0.1, -0.72, 2.04, 0.15, 1.44, '#d8a428', 0); cb.box(-1.02, 0.8, -0.72, 2.04, 0.15, 1.44, '#d8a428', 0);
    for (let i = 0; i < 8; i++) cb.box(-0.9 + i * 0.25, 1, 0.45, 0.12, 0.18, 0.12, '#f4ecd8', 0);
    chest.add(cb.mesh());
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 1, -0.7); chest.add(lidPivot);
    const lb = builder(63); lb.box(-1, 0, 0, 2, 0.6, 1.4, '#8a5a2b', 0.1); lb.box(-1.02, 0.25, -0.02, 2.04, 0.15, 1.44, '#d8a428', 0); lb.box(-0.15, 0.1, 1.38, 0.3, 0.35, 0.06, '#ffd23f', 0);
    for (let i = 0; i < 8; i++) lb.box(-0.9 + i * 0.25, -0.18, 1.15, 0.12, 0.18, 0.12, '#f4ecd8', 0);
    lidPivot.add(lb.mesh());
    const inner = builder(64); inner.box(-0.9, 0.9, -0.6, 1.8, 0.1, 1.2, '#2a0606', 0); inner.box(-0.4, 0.95, -0.3, 0.8, 0.1, 0.9, '#c83a4a', 0); chest.add(inner.mesh(GLOW));
    const eyes = builder(65); for (const ex of [-0.5, 0.3]) { eyes.box(ex, 0.3, 1.39, 0.25, 0.2, 0.04, '#ffe27a', 0); eyes.box(ex + 0.08, 0.32, 1.42, 0.1, 0.16, 0.04, '#0c080c', 0); }
    const eyeM = eyes.mesh(GLOW); lidPivot.add(eyeM);
    return { scene, chest, lid: lidPivot, eyes: eyeM, update: (t) => { torches.forEach((f) => f(t)); glow.intensity = 2.2 + Math.sin(t * 3) * 0.3; } };
  }

  // ---------------------------------------------------------------- scenes
  const CAM = () => new THREE.PerspectiveCamera(50, W / H, 0.1, 300);
  function cast(scene, o) {
    const ks = o.skins.slice(0, o.players).map((s) => { const k = knight(s); scene.add(k); return k; });
    const link = o.chained && ks.length > 1 ? chain(scene) : null;
    return { ks, link, parts: [...ks, ...(link ? link.links : [])] };
  }
  let castle = null;
  const SCENES = {
    title(o) {
      castle = castle || castleWorld();
      const cam = CAM();
      return { scene: castle.scene, cam, dur: Infinity, update(t) { castle.update(t); castle.gate.position.y = 0; const a = -0.5 + Math.sin(t * 0.08) * 0.35; camAt(cam, [Math.sin(a) * 34, 9 + Math.sin(t * 0.13), 14 + Math.cos(a) * 26], [0, 6, -8]); }, overlay() {} };
    },
    intro(o) {
      castle = castle || castleWorld();
      const cam = CAM(), { ks, link, parts } = cast(castle.scene, o);
      let creak = false;
      const sc = {
        scene: castle.scene, cam, dur: 15.5,
        update(t) {
          castle.update(t);
          // knights walk the path up to the gate, then in
          const z = t < 4 ? 32 : t < 11 ? lerp(32, 2.5, (t - 4) / 7) : lerp(2.5, -5, (t - 11) / 2.5);
          ks.forEach((k, i) => { k.position.set(ks.length > 1 ? (i ? 0.55 : -0.55) : 0, 0, z + i * 0.3); k.rotation.y = t < 11 ? Math.PI : Math.PI; walk(k, t + i * 0.3, t > 4 && t < 13.5 ? 1 : 0); k.visible = z > -3; });
          if (link) link(ks[0], ks[1]);
          castle.gate.position.y = lerp(0, 3.3, ease(span(t, 9, 11)));
          if (t > 9 && !creak) { creak = true; o.sfx && o.sfx.trap(); }
          if (t < 4.6) camPath(cam, t, [[0, [0, 40, 70], [0, 8, -8]], [4.5, [0, 6, 30], [0, 5, -6]]]);
          else if (t < 10.6) camAt(cam, [1.8, 1.2, z - 3.6], [0, 0.7, z + 0.5]);
          else camPath(cam, t, [[10.6, [0, 1.6, 9], [0, 1.4, -2]], [13.5, [0, 1.4, 4], [0, 1.3, -4]]]);
        },
        overlay(t, ui) {
          ui.bars();
          ui.caption(t, 0.6, 4.3, 'Legend says treasure waits at the very bottom.');
          ui.caption(t, 4.8, 9.2, 'Many went down. Nobody came back up.');
          ui.caption(t, 9.6, 13, 'How hard can it be?');
          ui.fadeOut(t, 13.2, 14);
          if (t > 13.6) ui.card(t - 13.6, o.areas[0].name, 'LEVELS 1-10', o.areas[0].title);
        },
      };
      // the castle is shared with the title screen: take the knights and their chain back out
      sc.done = () => { parts.forEach((m) => castle.scene.remove(m)); };
      return sc;
    },
    ending(o) {
      const vault = vaultWorld(), cam = CAM(), { ks, link } = cast(vault.scene, o);
      let chomped = false, opened = false;
      return {
        scene: vault.scene, cam, dur: 15,
        update(t) {
          vault.update(t);
          const x = t < 4.5 ? lerp(-9, -2.2, t / 4.5) : -2.2;
          ks.forEach((k, i) => { k.position.set(x - i * 0.9, 0, 1.2 + i * 0.2); k.rotation.y = Math.PI / 2 - 0.4; walk(k, t + i * 0.3, t < 4.5 ? 1 : 0); k.visible = t < 8.15; });
          if (link) link(ks[0], ks[1]);
          // the lid creaks a little, flies open, the mimic lunges and snaps shut
          const lid = t < 5 ? 0 : t < 6 ? 0.15 * Math.sin((t - 5) * 30) ** 2 : t < 6.6 ? lerp(0.15, 1.6, ease((t - 6) / 0.6)) : t < 7.8 ? 1.6 + Math.sin(t * 20) * 0.08 : t < 8.1 ? lerp(1.6, 0, (t - 7.8) / 0.3) : t < 10 ? Math.max(0, Math.sin((t - 8.1) * 9)) * 0.25 : 0;
          vault.lid.rotation.x = -lid;
          vault.eyes.visible = t > 6.3;
          vault.chest.position.x = t > 7.6 && t < 8.15 ? lerp(0, -1.4, (t - 7.6) / 0.55) : t >= 8.15 ? lerp(-1.4, 0, Math.min(1, (t - 8.15) / 1.2)) : 0;
          vault.chest.position.y = 0.8 + (t > 6.6 && t < 7.8 ? Math.abs(Math.sin(t * 10)) * 0.2 : 0);
          if (t > 6 && !opened) { opened = true; o.sfx && o.sfx.reveal(); }
          if (t > 8.1 && !chomped) { chomped = true; o.sfx && o.sfx.die(); }
          camPath(cam, t, [[0, [-4, 4, 10], [-1, 1, -1]], [4.5, [-1.5, 2.6, 6.5], [-0.5, 1.2, -1]], [6.4, [-0.6, 2, 4.5], [0, 1.4, -1]], [7.4, [-0.6, 1.8, 3.6], [0, 1.6, -1]], [10, [0, 4, 9], [0, 1, -1]]]);
          if (t > 8.1 && t < 8.5) cam.position.x += Math.sin(t * 90) * 0.12;
        },
        overlay(t, ui) {
          ui.bars();
          ui.caption(t, 0.6, 4.4, 'At last. The treasure.');
          ui.caption(t, 5, 6.2, '...');
          if (t > 6.6 && t < 8.1) ui.shout('MIMIC!');
          ui.caption(t, 8.4, 10.6, o.players > 1 ? 'They were delicious.' : 'It was delicious.');
          ui.fadeOut(t, 10.8, 11.6);
          if (t > 11.6) ui.card(t - 11.6, 'THE REAL TREASURE', `was the ${o.deaths} deaths along the way.`, '#ffd23f');
        },
      };
    },
  };
  // area1..area3: out of the portal, then a flyover of what's coming
  for (const n of [1, 2, 3]) SCENES['area' + n] = (o) => {
    const Wd = areaWorld(n), cam = CAM(), { ks, link } = cast(Wd.scene, o);
    const P = portal(Wd.scene, 0, 1.3, -2.85, n === 3);
    const kinds = STATIONS[n], xs = kinds.map((_, i) => stationX(i)), st = kinds.map((k, i) => station(Wd.scene, k, xs[i], o.skins));
    let whoosh = false;
    return {
      scene: Wd.scene, cam, dur: 13,
      update(t) {
        Wd.update(t); P(t); st.forEach((f) => f(t));
        // out of the portal on an arc, land, look around
        ks.forEach((k, i) => {
          const tt = t - 0.9 - i * 0.35, f = ease(span(tt, 0, 0.7)), tx = 1.6 + i * 1.1;
          k.visible = tt > 0;
          k.position.set(lerp(0, tx, f), lerp(1.1, 0, f) + Math.sin(f * Math.PI) * 1.2, lerp(-2.6, 0.8, f));
          k.rotation.y = tt < 2 ? 0 : Math.PI / 4 + Math.sin(tt * 2) * 0.4;
          k.userData.body.scale.y = tt > 0.7 && tt < 0.85 ? 0.8 : 1;
          walk(k, t, 0);
        });
        if (link) link(ks[0], ks[1]);
        if (t > 0.9 && !whoosh) { whoosh = true; o.sfx && o.sfx.flip(); }
        const cx = t < 3.2 ? 0.8 : lerp(0.8, xs[xs.length - 1] + 1, ease((t - 3.2) / 7.3));
        camPath(cam, Math.min(t, 3.2), [[0, [0.8, 2, 8], [0.8, 1.3, -2]], [3.2, [cx, 2.6, 9.5], [cx + 1.2, 1.8, -2]]]);
        if (t > 3.2) camAt(cam, [cx, 2.6, 9.5], [cx + 1.2, 1.8, -2]);
        this.cx = cx;
      },
      overlay(t, ui) {
        ui.bars();
        ui.caption(t, 1.6, 3, 'Deeper...');
        if (t > 3.2 && t < 10.6) xs.forEach((x, i) => { if (Math.abs(this.cx + 1.2 - x) < 3.2) ui.label(LABELS[kinds[i]], 1 - Math.abs(this.cx + 1.2 - x) / 3.2); });
        ui.fadeOut(t, 10.6, 11.3);
        if (t > 11.3) ui.card(t - 11.3, o.areas[n].name, `LEVELS ${n * 10 + 1}-${n * 10 + 10}`, o.areas[n].title);
      },
    };
  };

  return {
    ok: true,
    make(id, o) { const s = SCENES[id](o); s.id = id; return s; },
    render(s, t) {
      s.update(t);
      renderer.setRenderTarget(target); renderer.render(s.scene, s.cam);
      renderer.setRenderTarget(null); renderer.render(post, postCam);
      return renderer.domElement;
    },
    // free a one-off scene's geometry (the castle is kept for the title screen)
    end(s) {
      if (!s) return;
      if (s.done) s.done();
      if (s.id !== 'intro' && s.id !== 'title') s.scene.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
    },
  };
})();
