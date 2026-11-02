// The true-sphere prototype (sphere.html): chunks on the latitude-row grid of sphere.js, drawn at their real
// place on the sphere, a player who moves in real space (great circles, real distances), and a coarse
// globe for high views. Terrain is the same 3D-noise terrain as the cube-sphere (terrain.js sample()),
// sampled at each block column's direction; rivers and trees aren't carried over yet.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const S = BF.sphere, B = BF.B, CS = S.CS, H = S.H, SEA = S.SEA, R = S.R;
const $ = (id) => document.getElementById(id);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEG = 180 / Math.PI;

// ---- colours (top, side), as in world.js ----
const COL = [];
COL[B.STONE] = [0x7d7d7d, 0x7d7d7d]; COL[B.DIRT] = [0x86603e, 0x86603e]; COL[B.GRASS] = [0x6aa84f, 0x86603e];
COL[B.SAND] = [0xdbcf9a, 0xdbcf9a]; COL[B.WATER] = [0x2f5fc4, 0x2f5fc4]; COL[B.SNOW] = [0xf2f5f8, 0xdfe5ea];
COL[B.ICE] = [0xa9c8f0, 0xa9c8f0]; COL[B.GRAVEL] = [0x8a8580, 0x8a8580]; COL[B.SANDSTONE] = [0xd2c088, 0xc9b47c];
COL[B.BEDROCK] = [0x3a3a3a, 0x3a3a3a]; COL[B.PLANKS] = [0xb08850, 0xa07a45]; COL[B.RED_SAND] = [0xbe6a32, 0xbe6a32];
COL[B.TERRACOTTA] = [0x9a5a3e, 0x9a5a3e];
const rgb = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const COLF = COL.map((p) => p && [rgb(p[0]), rgb(p[1])]);
const GRASS = BF.climate.GRASS;
const solid = (b) => b !== B.AIR && b !== B.WATER;

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1e6);
const sky = new THREE.Color(), skyA = new THREE.Color(0x8fbde8), skyB = new THREE.Color(0x05070f);
scene.background = sky;
scene.fog = new THREE.Fog(0x8fbde8, 100, 200);
// every block face gets a faint outline, so single blocks (and the offset at band seams) can be seen
const edgeTex = (() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 16;
  const g = cv.getContext("2d"); g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 16, 16); g.fillStyle = "#fff"; g.fillRect(1, 1, 14, 14);
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
})();
const matChunk = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map: edgeTex });
const matGlobe = new THREE.MeshBasicMaterial({ vertexColors: true });
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}

// ---- world state ----
let T = null, seed = 1, started = false;
const chunks = new Map();     // key -> { cr, cc, n, blocks, mesh, anchor }
let viewDist = 12;            // chunks
const ckey = (cr, cc) => cr * 65536 + cc;

// The block column at row r, column c: sampled once at its centre.
function genChunk(cr, cc) {
  const n = S.cols(cr * CS), blocks = new Uint8Array(CS * CS * H), top = new Int16Array(CS * CS), biome = new Uint8Array(CS * CS);
  const d = [0, 0, 0];
  for (let i = 0; i < CS; i++) for (let j = 0; j < CS; j++) {
    const r = cr * CS + i, c = cc * CS + j;
    S.dir(S.latOf(r + 0.5), S.lonOf(c + 0.5, n), d);
    const s = T.sample(d[0], d[1], d[2]), h = s.h, base = i * CS + j;
    for (let y = 0; y <= h; y++) blocks[y * CS * CS + base] = y <= 1 ? B.BEDROCK : y < h - 3 ? B.STONE : y < h ? s.sub : s.top;
    for (let y = h + 1; y <= SEA; y++) blocks[y * CS * CS + base] = s.ice && y === SEA ? B.ICE : B.WATER;
    top[base] = h; biome[base] = s.biome;
  }
  return { cr, cc, n, blocks, top, biome, mesh: null, anchor: null, dirty: true };
}
function chunk(cr, cc) {
  const k = ckey(cr, cc);
  let ch = chunks.get(k);
  if (!ch) { ch = genChunk(cr, cc); chunks.set(k, ch); }
  return ch;
}
// Block at row r, column c (wrapped round the row), layer y.
function get(r, c, y) {
  if (y < 0) return B.BEDROCK;
  if (y >= H || r < 0 || r >= S.ROWS) return B.AIR;
  const n = S.cols(r); c = ((c % n) + n) % n;
  const ch = chunk(r >> 4, Math.floor(c / CS));
  return ch.blocks[y * CS * CS + (r & 15) * CS + (c & 15)];
}
function set(r, c, y, b) {
  const n = S.cols(r); c = ((c % n) + n) % n;
  const ch = chunk(r >> 4, Math.floor(c / CS));
  ch.blocks[y * CS * CS + (r & 15) * CS + (c & 15)] = b; ch.dirty = true;
  // neighbours' faces may change too
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const r2 = r + dr; if (r2 < 0 || r2 >= S.ROWS) continue;
    const n2 = S.cols(r2), c2 = dr ? Math.floor((c + 0.5) * n2 / n) : ((c + dc) % n + n) % n;
    const o = chunks.get(ckey(r2 >> 4, Math.floor(c2 / CS)));
    if (o) o.dirty = true;
  }
}

// ---- meshing: every block is drawn at its real place on the sphere ----
// Corner (row edge r, column edge c of a row with n columns, layer edge y) relative to the anchor.
function corner(r, c, n, y, anchor, out) {
  const lat = S.latOf(r), lon = S.lonOf(c, n), cl = Math.cos(lat), rr = R + (y - SEA);
  out[0] = cl * Math.sin(lon) * rr - anchor[0]; out[1] = Math.sin(lat) * rr - anchor[1]; out[2] = cl * Math.cos(lon) * rr - anchor[2];
  return out;
}
function buildMesh(ch) {
  const { cr, cc, n } = ch, r0 = cr * CS, c0 = cc * CS;
  const anchor = ch.anchor || (ch.anchor = S.xyz(S.latOf(r0 + 8), S.lonOf(c0 + 8, n), SEA));
  const pos = [], col = [], uv = [], q = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], UV = [0, 0, 1, 0, 1, 1, 0, 1];
  const quad = (pts, rgbc, k) => {
    // two triangles
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(pts[i][0], pts[i][1], pts[i][2]); col.push(rgbc[0] * k, rgbc[1] * k, rgbc[2] * k); uv.push(UV[i * 2], UV[i * 2 + 1]);
    }
  };
  const exposed = (b) => b === B.AIR || (b === B.WATER) || b === B.ICE;
  for (let i = 0; i < CS; i++) for (let j = 0; j < CS; j++) {
    const r = r0 + i, c = c0 + j, base = i * CS + j;
    const hTop = Math.min(H - 1, Math.max(ch.top[base], SEA) + 1);
    for (let y = 0; y <= hTop; y++) {
      const b = ch.blocks[y * CS * CS + base];
      if (b === B.AIR) continue;
      const pal = COLF[b] || COLF[B.STONE];
      // a little brightness variation per block, so single blocks (and band seams) can be told apart
      const jit = 0.9 + 0.1 * (((r * 73856093) ^ (c * 19349663) ^ (y * 83492791)) >>> 0) / 4294967296;
      const topCol = (b === B.GRASS ? GRASS[ch.biome[base]] : pal[0]).map((x) => x * jit);
      if (b === B.WATER || b === B.ICE) {
        // water: only its surface
        if (get(r, c, y + 1) === B.AIR) {
          corner(r, c, n, y + 0.88, anchor, q[0]); corner(r, c + 1, n, y + 0.88, anchor, q[1]);
          corner(r + 1, c + 1, n, y + 0.88, anchor, q[2]); corner(r + 1, c, n, y + 0.88, anchor, q[3]);
          quad(q, pal[0], 1);
        }
        continue;
      }
      // top
      if (exposed(get(r, c, y + 1))) {
        corner(r, c, n, y + 1, anchor, q[0]); corner(r, c + 1, n, y + 1, anchor, q[1]);
        corner(r + 1, c + 1, n, y + 1, anchor, q[2]); corner(r + 1, c, n, y + 1, anchor, q[3]);
        quad(q, topCol, 1);
      }
      // east and west: same row
      for (const dc of [1, -1]) {
        if (!exposed(get(r, c + dc, y))) continue;
        const e = dc > 0 ? c + 1 : c;
        corner(r, e, n, y, anchor, q[0]); corner(r + 1, e, n, y, anchor, q[1]);
        corner(r + 1, e, n, y + 1, anchor, q[2]); corner(r, e, n, y + 1, anchor, q[3]);
        quad(q, pal[1], 0.7 * jit);
      }
      // north and south: across a band seam the face borders several columns; drawn if any is open
      for (const dr of [1, -1]) {
        const r2 = r + dr;
        if (r2 < 0 || r2 >= S.ROWS) continue;
        const [a, z] = S.overlap(r, c, r2);
        let open = false;
        for (let c2 = a; c2 <= z && !open; c2++) open = exposed(get(r2, c2, y));
        if (!open) continue;
        const e = dr > 0 ? r + 1 : r;
        corner(e, c, n, y, anchor, q[0]); corner(e, c + 1, n, y, anchor, q[1]);
        corner(e, c + 1, n, y + 1, anchor, q[2]); corner(e, c, n, y + 1, anchor, q[3]);
        quad(q, pal[1], 0.85 * jit);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
  ch.mesh = new THREE.Mesh(g, matChunk);
  ch.mesh.frustumCulled = false;
  scene.add(ch.mesh);
  ch.dirty = false;
}

// ---- player: position and facing on the sphere, moved in real space ----
const player = {
  p: [0, 0, 1], y: SEA + 1, h: [1, 0, 0], pitch: -0.2, vy: 0, flying: false, fast: false, onGround: false, keys: {},
  travelled: 0, mark: null,
};
const EYE = 1.62, WALK = 4.3, SPRINT = 5.6, FLY = 11, JUMP_V = 8.4, GRAVITY = 28, RAD = 0.3;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// keep the facing a unit vector tangent at p
function retangent() {
  const p = player.p, h = player.h, k = dot(h, p);
  let t = [h[0] - p[0] * k, h[1] - p[1] * k, h[2] - p[2] * k];
  if (Math.hypot(...t) < 1e-6) t = cross([0, 1, 0], p);
  player.h = norm(t);
}
// Moves point p a distance s (blocks, at radius rr) along unit tangent m: a step along the great circle.
function along(p, m, s, rr) {
  const a = s / rr, ca = Math.cos(a), sa = Math.sin(a);
  return norm([p[0] * ca + m[0] * sa, p[1] * ca + m[1] * sa, p[2] * ca + m[2] * sa]);
}
// block under direction p at layer y
const tmpLL = {}, tmpRC = {};
function blockAtDir(p, y) {
  S.latLonOf(p[0], p[1], p[2], tmpLL);
  S.fromLatLon(tmpLL.lat, tmpLL.lon, tmpRC);
  return get(Math.floor(tmpRC.r), Math.floor(tmpRC.c), Math.floor(y));
}
// Does the player's box with its feet at direction p, layer y touch a solid block? Checks the four corners
// of its footprint (east/north offsets of RAD) at each layer it spans.
function collides(p, y) {
  const up = p, e = norm(cross([0, 1, 0], up)), nn = cross(up, e), rr = R + (y - SEA);
  for (const [a, b] of [[RAD, RAD], [RAD, -RAD], [-RAD, RAD], [-RAD, -RAD]]) {
    const q = norm([p[0] + (e[0] * a + nn[0] * b) / rr, p[1] + (e[1] * a + nn[1] * b) / rr, p[2] + (e[2] * a + nn[2] * b) / rr]);
    for (let k = Math.floor(y + 0.001); k <= Math.floor(y + 1.75); k++) if (solid(blockAtDir(q, k))) return true;
  }
  return false;
}
// Moves the player to direction q, counting the distance and carrying the facing along.
function moveTo(q) {
  const p = player.p;
  // distance along the ground (at sea level), the honest measure of a trip
  player.travelled += R * Math.acos(Math.min(1, dot(p, q)));
  // carry the facing along the great circle (parallel transport), so straight ahead stays straight
  const k = dot(player.h, q), w = 1 + dot(p, q);
  player.p = q; player.h = [player.h[0] - (p[0] + q[0]) * k / w, player.h[1] - (p[1] + q[1]) * k / w, player.h[2] - (p[2] + q[2]) * k / w];
  retangent();
}
function update(dt) {
  const K = player.keys, p = player.p;
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  const alt = Math.max(0, player.y - groundY());
  let speed = player.flying ? FLY * (player.fast ? 12 : 1) * (K.ControlLeft ? 2 : 1) : K.ControlLeft ? SPRINT : WALK;
  if (player.flying && player.fast) speed *= Math.max(1, alt / 150);
  const right = cross(player.h, p);
  let m = [player.h[0] * fw + right[0] * st, player.h[1] * fw + right[1] * st, player.h[2] * fw + right[2] * st];
  const ml = Math.hypot(...m);
  if (ml > 0) {
    const s = speed * dt, free = player.flying && alt > 40;
    // Try the move; blocked, step up a one-block rise (auto-jump) when on the ground; still blocked, slide
    // along the wall: try the move's east-west and north-south parts on their own.
    const tryMove = (dir, len) => {
      const l = Math.hypot(...dir);
      if (l < 1e-9) return false;
      const d = [dir[0] / l, dir[1] / l, dir[2] / l], q = along(player.p, d, len, R + (player.y - SEA));
      if (free || !collides(q, player.y)) { moveTo(q); return true; }
      if (!player.flying && player.onGround && !collides(player.p, player.y + 1.01) && !collides(q, player.y + 1.01)) {
        player.y = Math.floor(player.y) + 1; moveTo(q); return true;
      }
      return false;
    };
    if (!tryMove(m, s)) {
      const e = norm(cross([0, 1, 0], p)), nn = cross(p, e), me = dot(m, e) / ml, mn = dot(m, nn) / ml;
      if (!tryMove(e.map((v) => v * me), s * Math.abs(me))) tryMove(nn.map((v) => v * mn), s * Math.abs(mn));
    }
  }
  if (player.flying) {
    const vy = ((K.Space ? 1 : 0) - (K.ShiftLeft ? 1 : 0)) * speed * dt;
    if (vy && (alt > 40 || !collides(player.p, player.y + vy))) player.y += vy;
    player.vy = 0;
  } else {
    if (K.Space && player.onGround) player.vy = JUMP_V;
    player.vy = Math.max(-60, player.vy - GRAVITY * dt);
    const dy = player.vy * dt;
    if (!collides(player.p, player.y + dy)) { player.y += dy; player.onGround = false; }
    else { if (player.vy < 0) { player.y = Math.floor(player.y + dy) + 1; player.onGround = true; } player.vy = 0; }
  }
  player.y = Math.max(1, Math.min(4 * R, player.y));
}
// ground (or sea) layer under the player: from loaded blocks near the ground, from the terrain high up
function groundY() {
  S.latLonOf(player.p[0], player.p[1], player.p[2], tmpLL);
  S.fromLatLon(tmpLL.lat, tmpLL.lon, tmpRC);
  const r = Math.floor(tmpRC.r), c = Math.floor(tmpRC.c), ch = chunks.get(ckey(r >> 4, Math.floor(c / CS)));
  if (ch) return Math.max(ch.top[(r & 15) * CS + (c & 15)], SEA) + 1;
  const s = T.sample(player.p[0], player.p[1], player.p[2]);
  return Math.max(s.h, SEA) + 1;
}
function look(dx, dy) {
  const a = dx * 0.0025, right = cross(player.h, player.p), c = Math.cos(a), s = Math.sin(a);
  player.h = norm([player.h[0] * c + right[0] * s, player.h[1] * c + right[1] * s, player.h[2] * c + right[2] * s]);
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * 0.0025));
}

// Places the player on the ground (or at a layer) at lat, lon (radians), facing north.
function goTo(lat, lon, layer) {
  player.p = S.dir(lat, lon);
  const f = S.frame(lat, lon); player.h = f.north;
  if (Math.abs(lat) > 1.5707) player.h = f.east;
  retangent();
  const s = T.sample(player.p[0], player.p[1], player.p[2]);
  player.y = layer !== undefined ? layer : Math.max(s.h, SEA) + 1.01;
  player.flying = layer !== undefined && layer > Math.max(s.h, SEA) + 2;
  player.vy = 0; player.travelled = 0; player.mark = { lat, lon };
}
function spawn() {
  const n = BF.makeNoise(seed);
  for (let i = 0; i < 3000; i++) {
    const lat = Math.asin((n.hash(i, 1) * 2 - 1) * 0.7), lon = (n.hash(i, 2) * 2 - 1) * Math.PI;
    const d = S.dir(lat, lon), s = T.sample(d[0], d[1], d[2]);
    if (s.h > SEA + 2 && s.h < SEA + 40 && s.top === B.GRASS) return goTo(lat, lon);
  }
  goTo(0, 0);
}

// ---- chunk loading around the player ----
let chunksOn = true;
function wanted() {
  S.latLonOf(player.p[0], player.p[1], player.p[2], tmpLL);
  const lat = tmpLL.lat, lon = tmpLL.lon, r = Math.floor((lat + Math.PI / 2) / S.D), cr0 = r >> 4;
  const out = [], reach = viewDist * CS;
  for (let dcr = -viewDist; dcr <= viewDist; dcr++) {
    const cr = cr0 + dcr;
    if (cr < 0 || cr >= S.CROWS) continue;
    const n = S.cols(cr * CS), ncc = n / CS, lat2 = S.latOf(cr * CS + 8);
    const cc0 = Math.floor(((S.wrapLon(lon) + Math.PI) / (2 * Math.PI)) * n / CS);
    // east-west: chunks within reach (rows near a pole are short: then the whole row)
    const span = Math.min(Math.floor(ncc / 2), Math.ceil(reach / Math.max(1, CS * S.blockSize(cr * CS).w * 1)) + 1);
    for (let d = -span; d <= span; d++) {
      const cc = ((cc0 + d) % ncc + ncc) % ncc;
      const dist = S.distance(lat, lon, lat2, S.lonOf(cc * CS + 8, n));
      if (dist <= reach + 12) out.push({ cr, cc, dist });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
let wantStamp = 0, wantList = [], lastWantAt = null;
function updateChunks() {
  const pkey = Math.round(player.p[0] * 1e4) + "," + Math.round(player.p[1] * 1e4) + "," + Math.round(player.p[2] * 1e4) + "," + viewDist;
  if (!chunksOn) wantList = [];
  else if (pkey !== lastWantAt) { wantList = wanted(); lastWantAt = pkey; }
  const keep = new Set(wantList.map((w) => ckey(w.cr, w.cc)));
  const t0 = performance.now();
  let meshed = 0;
  for (const w of wantList) {
    const ch = chunk(w.cr, w.cc);
    if (ch.mesh && !ch.dirty) { meshed++; continue; }
    if (performance.now() - t0 > 10) continue;
    buildMesh(ch); meshed++;
  }
  // let go of chunks well out of range
  if (++wantStamp % 30 === 0) for (const [k, ch] of chunks) {
    if (keep.has(k)) continue;
    if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
    if (!chunksOn || S.distance(...llOf(player.p), S.latOf(ch.cr * CS + 8), S.lonOf(ch.cc * CS + 8, ch.n)) > (viewDist + 3) * CS) chunks.delete(k);
  }
  return { meshed, wanted: wantList.length };
}
const llOf = (p) => { S.latLonOf(p[0], p[1], p[2], tmpLL); return [tmpLL.lat, tmpLL.lon]; };

// ---- globe: the whole planet as a coarse lat/lon mesh, for high views (built a few rows a frame) ----
const GW = 720, GH = 360, globe = { mesh: null, row: 0, pos: null, col: null };
function globeStep() {
  if (globe.row > GH) return;
  if (!globe.pos) { globe.pos = new Float32Array((GW + 1) * (GH + 1) * 3); globe.col = new Float32Array((GW + 1) * (GH + 1) * 3); }
  const t0 = performance.now(), d = [0, 0, 0];
  while (globe.row <= GH && performance.now() - t0 < 6) {
    const j = globe.row++, lat = -Math.PI / 2 + Math.PI * j / GH;
    for (let i = 0; i <= GW; i++) {
      const lon = -Math.PI + 2 * Math.PI * i / GW;
      S.dir(lat, lon, d);
      const s = T.sample(d[0], d[1], d[2], false), o = (j * (GW + 1) + i) * 3;
      // 30 blocks low, so where it is coarser than the real ground it never covers the loaded chunks
      const rr = R + Math.max(s.h, SEA) - SEA - 30;
      globe.pos[o] = d[0] * rr; globe.pos[o + 1] = d[1] * rr; globe.pos[o + 2] = d[2] * rr;
      const c = BF.climate.mapColour(s), k = s.h >= SEA ? 0.9 + 0.2 * Math.min(1, (s.h - SEA) / 200) : 1;
      globe.col[o] = c[0] * k; globe.col[o + 1] = c[1] * k; globe.col[o + 2] = c[2] * k;
    }
  }
  if (globe.row > GH) {
    const idx = [];
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const a = j * (GW + 1) + i, b = a + 1, c = a + GW + 1, e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(globe.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(globe.col, 3));
    g.setIndex(idx);
    globe.mesh = new THREE.Mesh(g, matGlobe);
    globe.mesh.frustumCulled = false;
    scene.add(globe.mesh);
  }
}

// ---- skirt: middle-distance terrain between the loaded chunks and the globe ----
// A disc of terrain centred under the player: NR rings, spaced further apart the further out they are (from just
// inside the chunks to beyond the horizon), each NA points round, every point a terrain sample at the end of a
// great-circle step from the centre. It is built a few rings a frame into fresh arrays and swapped in whole, when
// the player has moved a tenth of its inner radius or the view needs a different reach.
const NR = 56, NA = 192;
const skirt = { mesh: null, build: null };
function skirtWant() {
  const h = Math.max(1, player.y - SEA), horizon = Math.sqrt(h * (2 * R + h));
  const rin = chunksOn ? viewDist * CS * 0.7 : 24;
  return { rin, rout: Math.min(40000, Math.max(3000, horizon * 1.4)) };
}
function skirtStep() {
  const want = skirtWant();
  const cur = skirt.mesh && skirt.mesh.userData;
  if (!skirt.build) {
    const moved = cur ? R * Math.acos(Math.min(1, dot(cur.c, player.p))) : Infinity;
    const stale = !cur || moved > cur.rin * 0.1 + 2 || Math.abs(Math.log(want.rout / cur.rout)) > 0.2 || Math.abs(want.rin - cur.rin) > 8;
    if (!stale) return;
    const c = player.p.slice(), e = norm(Math.abs(c[1]) > 0.999 ? cross([1, 0, 0], c) : cross([0, 1, 0], c)), n = cross(c, e);
    skirt.build = { c, e, n, rin: want.rin, rout: want.rout, ring: 0, pos: new Float32Array(NR * NA * 3), col: new Float32Array(NR * NA * 3), hgt: new Float32Array(NR * NA), rho: new Float64Array(NR) };
  }
  const b = skirt.build, t0 = performance.now(), v = [0, 0, 0];
  while (b.ring < NR && performance.now() - t0 < 4) {
    const i = b.ring++, rho = b.rin * Math.pow(b.rout / b.rin, i / (NR - 1)), a = rho / R, ca = Math.cos(a), sa = Math.sin(a);
    // lowered further the coarser it is, so it stays under the real ground it stands for
    const drop = 1.5 + rho * 0.004;
    b.rho[i] = rho;
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * 2 * Math.PI, ct = Math.cos(th), st = Math.sin(th);
      for (let k = 0; k < 3; k++) v[k] = b.c[k] * ca + (b.e[k] * ct + b.n[k] * st) * sa;
      const smp = T.sample(v[0], v[1], v[2], rho < 2000), rr = R + Math.max(smp.h + 1, SEA + 0.88) - SEA - drop, o = (i * NA + j) * 3;
      for (let k = 0; k < 3; k++) b.pos[o + k] = v[k] * rr - b.c[k] * R;
      b.hgt[i * NA + j] = Math.max(smp.h, SEA);
      // the colour the loaded chunks give this column's top, so the two match where they meet
      const tb = smp.h < SEA ? (smp.ice ? B.ICE : B.WATER) : smp.top, cl = tb === B.GRASS ? GRASS[smp.biome] : (COLF[tb] || COLF[B.STONE])[0], kk = 0.92;
      b.col[o] = cl[0] * kk; b.col[o + 1] = cl[1] * kk; b.col[o + 2] = cl[2] * kk;
    }
  }
  if (b.ring < NR) return;
  // shade by slope (light from the north-west, high), so hills and mountains read from above
  const L = [-0.35, 0.5, 0.79];
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(NR - 1, i + 1), H0 = b.hgt, th = (j / NA) * 2 * Math.PI;
    const gr = (H0[i1 * NA + j] - H0[i0 * NA + j]) / (b.rho[i1] - b.rho[i0]);
    const gt = (H0[i * NA + (j + 1) % NA] - H0[i * NA + (j + NA - 1) % NA]) / (2 * b.rho[i] * 2 * Math.PI / NA);
    const gx = gr * Math.cos(th) - gt * Math.sin(th), gy = gr * Math.sin(th) + gt * Math.cos(th), l = Math.hypot(gx, gy, 1);
    const k = Math.max(0.55, Math.min(1.15, 0.3 + 0.8 * (-gx * L[0] - gy * L[1] + L[2]) / l)), o = (i * NA + j) * 3;
    b.col[o] *= k; b.col[o + 1] *= k; b.col[o + 2] *= k;
  }
  if (!skirtIdx) {
    skirtIdx = [];
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) {
      const a = i * NA + j, bb = i * NA + (j + 1) % NA, c = a + NA, d = bb + NA;
      skirtIdx.push(a, c, d, a, d, bb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(b.col, 3));
  g.setIndex(skirtIdx);
  if (skirt.mesh) { scene.remove(skirt.mesh); skirt.mesh.geometry.dispose(); }
  skirt.mesh = new THREE.Mesh(g, matGlobe);
  skirt.mesh.frustumCulled = false;
  skirt.mesh.userData = { c: b.c, rin: b.rin, rout: b.rout, anchor: [b.c[0] * R, b.c[1] * R, b.c[2] * R] };
  scene.add(skirt.mesh);
  skirt.build = null;
}
let skirtIdx = null;

// ---- view: everything placed relative to the eye (floating origin) ----
const bufSize = new THREE.Vector2();
function view() {
  const p = player.p, rr = R + (player.y + EYE - SEA), eye = [p[0] * rr, p[1] * rr, p[2] * rr];
  for (const ch of chunks.values()) if (ch.mesh) ch.mesh.position.set(ch.anchor[0] - eye[0], ch.anchor[1] - eye[1], ch.anchor[2] - eye[2]);
  if (globe.mesh) globe.mesh.position.set(-eye[0], -eye[1], -eye[2]);
  if (skirt.mesh) { const a = skirt.mesh.userData.anchor; skirt.mesh.position.set(a[0] - eye[0], a[1] - eye[1], a[2] - eye[2]); }
  const h = player.y - SEA, alt = Math.max(0, player.y - groundY());
  const horizon = Math.sqrt(Math.max(1, h) * (2 * R + Math.max(1, h)));
  const near = viewDist * CS;
  // fog hides the edge of the loaded chunks near the ground and lifts towards the horizon with height
  const k = smooth(60, 600, alt);
  scene.fog.far = (near * 0.95 + alt) * (1 - k) + horizon * 1.3 * k + (h > 3000 ? 1e9 : 0);
  scene.fog.near = scene.fog.far * 0.6;
  sky.copy(skyA).lerp(skyB, smooth(3000, 60000, h));
  scene.fog.color.copy(sky);
  camera.near = Math.max(0.05, Math.min(500, (alt - 200) * 0.01));
  camera.far = Math.max(near * 2 + alt, horizon * 1.3 + 4000);
  camera.updateProjectionMatrix();
  // pixels across a block straight below: chunks stop when it is under one (as in the cube-sphere)
  const pxScale = renderer.getDrawingBufferSize(bufSize).y / (2 * Math.tan(camera.fov * Math.PI / 360));
  chunksOn = alt < (chunksOn ? Math.min(1500, pxScale) : Math.min(1500, pxScale) * 0.9);
  // camera: up is straight out from the centre, looking along the facing, tipped by the pitch
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch), f = player.h;
  camera.position.set(0, 0, 0);
  camera.up.set(p[0], p[1], p[2]);
  camera.lookAt(f[0] * cp + p[0] * sp, f[1] * cp + p[1] * sp, f[2] * cp + p[2] * sp);
}

// ---- HUD ----
const fmt = (x, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ll = (lat, lon) => `${Math.abs(lat * DEG).toFixed(4)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon * DEG).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
let fps = 0, frames = 0, fpsT = 0;
function hud(st) {
  const [lat, lon] = llOf(player.p);
  const rc = S.fromLatLon(lat, lon), r = Math.floor(rc.r), c = Math.floor(rc.c), bd = S.band(r), sz = S.blockSize(r);
  const P = S.xyz(lat, lon, player.y);
  const m = player.mark, straight = m ? S.distance(m.lat, m.lon, lat, lon) : 0;
  $("hud").textContent =
    `${ll(lat, lon)}  ·  layer ${fmt(player.y, 1)} (sea ${SEA})  ·  ${player.flying ? (player.fast ? "fast fly" : "fly") : "walk"}\n` +
    `block: row ${fmt(r)} of ${fmt(S.ROWS)}, column ${fmt(c)} of ${fmt(rc.n)} (band ${bd.i + 1} of ${S.bands.length}), layer ${Math.floor(player.y)}  ·  this block ${sz.w.toFixed(3)} wide x ${sz.d.toFixed(3)} deep\n` +
    `in space: x ${fmt(P[0], 1)}  y ${fmt(P[1], 1)}  z ${fmt(P[2], 1)}  (blocks from the planet's centre; +y is the north pole)  ·  cell ${Math.floor(P[0])}, ${Math.floor(P[1])}, ${Math.floor(P[2])}\n` +
    `since ${m ? ll(m.lat, m.lon) : "-"}: walked ${fmt(player.travelled, 1)} blocks, straight line on the sphere ${fmt(straight, 1)} (M marks here)\n` +
    `${fps} fps  ·  view ${viewDist} chunks  ·  ` + (chunksOn ? `${st.meshed}/${st.wanted} chunks` : "no chunks (blocks below are under a pixel)") +
    (globe.mesh ? "" : `  ·  building globe ${Math.round(100 * globe.row / GH)}%`);
}

// ---- input ----
addEventListener("keydown", (e) => {
  if (!started) return;
  player.keys[e.code] = true;
  if (e.code === "KeyF") { player.flying = !player.flying; player.vy = 0; }
  if (e.code === "KeyG") player.fast = !player.fast;
  if (e.code === "KeyM") { const [lat, lon] = llOf(player.p); player.mark = { lat, lon }; player.travelled = 0; }
  if (e.code === "KeyT") { const n = BF.makeNoise(Date.now() & 0xffff); for (let i = 0; i < 2000; i++) { const lat = Math.asin(n.hash(i, 1) * 2 - 1), lon = (n.hash(i, 2) * 2 - 1) * Math.PI, d = S.dir(lat, lon); if (T.sample(d[0], d[1], d[2]).h > SEA + 1) { goTo(lat, lon); break; } } }
  if (e.code === "KeyP") {
    e.preventDefault(); document.exitPointerLock(); player.keys = {};
    const t = prompt("Go to: latitude longitude [layer] (degrees; S and W negative or with letters), e.g. 51.5 -0.12 or 89.99N 0E 200");
    if (t) teleport(t);
  }
  if (e.code === "Equal" || e.code === "NumpadAdd") { e.preventDefault(); viewDist = Math.min(24, viewDist + 2); }
  if (e.code === "Minus" || e.code === "NumpadSubtract") { e.preventDefault(); viewDist = Math.max(4, viewDist - 2); }
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", (e) => { player.keys[e.code] = false; });
addEventListener("blur", () => { player.keys = {}; });
document.addEventListener("mousemove", (e) => { if (document.pointerLockElement === renderer.domElement) look(e.movementX, e.movementY); });
renderer.domElement.addEventListener("mousedown", (e) => {
  if (!started) return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  edit(e.button === 0);
});
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
function teleport(t) {
  const nums = t.trim().split(/[\s,]+/).map((x) => { const v = parseFloat(x); return /[SsWw]$/.test(x) ? -v : v; });
  if (nums.length < 2 || nums.some((v) => isNaN(v))) return;
  goTo(nums[0] / DEG, nums[1] / DEG, nums[2]);
}
// Break (left) or place planks (right) at the block looked at, up to 6 blocks away: steps along the view ray in
// real space and asks the grid which block each point is in.
function edit(breaking) {
  const p = player.p, cp = Math.cos(player.pitch), sp = Math.sin(player.pitch), f = player.h;
  const dirv = [f[0] * cp + p[0] * sp, f[1] * cp + p[1] * sp, f[2] * cp + p[2] * sp];
  const rr = R + (player.y + EYE - SEA), eye = [p[0] * rr, p[1] * rr, p[2] * rr];
  let prev = null;
  for (let t = 0; t < 6; t += 0.05) {
    const q = [eye[0] + dirv[0] * t, eye[1] + dirv[1] * t, eye[2] + dirv[2] * t], a = S.blockAt(q[0], q[1], q[2]);
    if (a.y < 0 || a.y >= H) break;
    const b = get(a.r, a.c, a.y);
    if (solid(b)) {
      if (breaking) { if (a.y > 1) set(a.r, a.c, a.y, B.AIR); }
      else if (prev) set(prev.r, prev.c, prev.y, B.PLANKS);
      return;
    }
    prev = a;
  }
}

// ---- loop ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!started) return;
  frames++; fpsT += dt; if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  update(dt);
  globeStep();
  skirtStep();
  const st = updateChunks();
  view();
  renderer.render(scene, camera);
  if (fpsT === 0) hud(st);
}
function start() {
  seed = parseInt($("seed").value, 10) || 1;
  T = BF.makeTerrain(seed);
  $("title").style.display = "none";
  spawn();
  started = true;
  renderer.domElement.requestPointerLock();
}
$("play").addEventListener("click", start);
addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
BF.sworld = { start, goTo, look, teleport, player, chunks, get, set, renderer, scene, camera, globe, skirt, along, update,
  setView: (v) => { viewDist = v; }, state: () => ({ chunksOn }) };
})();
