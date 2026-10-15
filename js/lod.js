// Distant terrain: rings of height-field meshes around the player, each twice as coarse as the last, so that
// from high up the land well beyond the loaded chunks shows its real shape, colours and rivers.
//
// Level 0 has a cell every 4 blocks out to 512 blocks, then 8 out to 1 km, and so on to 256 out to 33 km;
// past that the globe (globe.js) has the same 256-block detail everywhere. Each ring is drawn as a disc around
// its own centre, minus the disc of the next finer ring and the loaded chunks, so a ring that is still being
// rebuilt never leaves a gap: the coarser ring shows there instead. Across the outer part of its disc each
// vertex moves to where the coarser ring would put it (shader MORPH in world.js), so detail fades level by
// level instead of stepping. Rings are sampled by background workers (grid.js), reusing whatever part of
// the old ring is still inside the new one, and rebuilt once the player has moved a fifth of a ring away.
// A ring is hidden once its cells are smaller than a pixel or so, which, out at planet scale, leaves the
// globe alone, with even detail.
//
// Trees and village houses: the four finest rings carry stand-ins (a point each, sampled in the workers from
// the same random numbers as the real trees), drawn at their true size while that is a pixel or more. Below
// a pixel they thin out and the ground takes the canopy's average colour instead (world.js, CANOPY), which
// every ring and the globe use, so a forest keeps its colour at every distance and height.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, world = BF.world;
const CELLS = [4, 8, 16, 32, 64, 128, 256];
const HALF = 128, EXT = 136;   // cells from a ring's centre to the edge of its disc, and of its mesh
const SHOW_ABOVE = 40;         // blocks above the ground at which distant terrain is drawn
const HIDE = 1500;             // a ring is hidden above this many times its cell size (cells are then ~2 pixels)
const MOVE = 0.2;              // a ring is rebuilt once the player is this fraction of its radius from its centre
const HOLE = 0.97, MORPH0 = 0.6, MORPH1 = 0.95;   // fractions of a ring's radius
const RIBBON_HIDE = 9000;      // rivers drawn as ribbons are hidden above this (narrower than a pixel)
const WATER = [0.27, 0.43, 0.8], ICE = [0.66, 0.78, 0.94];
const STAND_LEVELS = 4;        // rings with tree and house stand-ins (cells of 4 to 32 blocks)
const STAND_W = 9;             // the widest stand-in, in blocks (for hiding them all once smaller than half a pixel)

const lod = (BF.lod = { group: null, levels: [], active: false, top: null, eyeHole: 0 });

lod.reset = function (scene) {
  if (lod.group) {
    for (const L of lod.levels) if (L.mesh) dispose(L.mesh);
    if (lod.ribbon) dispose(lod.ribbon);
    scene.remove(lod.group);
  }
  lod.ribbon = null;
  lod.group = new THREE.Group();
  scene.add(lod.group);
  lod.levels = CELLS.map((cell) => ({ cell, half: cell * HALF, mesh: null, raw: null, building: null, f: -1, cu: 0, cv: 0, buildMs: 0, show: false }));
};
function dispose(m) { (m.parent || lod.group).remove(m); for (const x of m.isGroup ? m.children : [m]) { x.geometry.dispose(); x.material.dispose(); } }

// The radius covered by the coarsest ring drawn (0 if none), for fog and the far clip plane.
lod.radius = function () {
  let r = 0;
  if (lod.active) for (const L of lod.levels) if (L.mesh && L.show) r = L.half;
  return r;
};

// ---- colours and shading (the globe uses these too, so the two match) ----
// Colour of a sampled column: water by depth (ocean) or river blue, ice, or the top block in its biome
// (bare: trees come from lod.canopy).
lod.colour = function (h, wl, top, biome, ice, out, o) {
  let r, g, b;
  if (wl > h) {
    if (ice) [r, g, b] = ICE;
    else if (wl <= P.SEA || wl - h > 3) {
      // the sea and lakes, darker with depth (a lake as deep as the sea is at this height)
      const d = P.SEA - (wl - h);
      r = 0.18 + (d - 40) / 900; g = 0.3 + (d - 40) / 400; b = 0.72;
    }
    else [r, g, b] = WATER;
  } else {
    const c = world.topColour(top, biome);
    r = c[0]; g = c[1]; b = c[2];
  }
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
};
// The canopy over a sampled column, as (r, g, b, cover) at out[o..o+3]: its biome's average crown colour and
// the share of ground covered, wherever trees can grow there (as flora.js decides, on the sample's ground).
const B = BF.B;
lod.canopy = function (h, wl, top, biome, out, o) {
  const t = BF.climate.TREES[biome], c = BF.climate.CANOPY[biome];
  let ok = t && t.d > 0 && wl <= h && h > P.SEA;
  if (ok) ok = t.kinds[0] === "cactus" ? top === B.SAND || top === B.RED_SAND : top === B.GRASS || top === B.SNOW;
  out[o] = c ? c[0] : 0; out[o + 1] = c ? c[1] : 0; out[o + 2] = c ? c[2] : 0; out[o + 3] = ok ? c[3] : 0;
};
// The drawn height of each sample: the water surface, or the top of the ground.
lod.heights = function (raw) {
  const y = new Float32Array(raw.h.length);
  for (let o = 0; o < y.length; o++) y[o] = raw.wl[o] > raw.h[o] ? raw.wl[o] + 0.875 : raw.h[o] + 1;
  return y;
};
// Slope shading of sample (i, j) of an nx x ny grid, measured s samples either side, in true 3D so it
// agrees across faces: light from above, a little from one side of the planet's axis.
const pa = [0, 0, 0], pb = [0, 0, 0];
function point(raw, y, o, out) { const r = P.R + y[o] - P.SEA; out[0] = raw.dir[3 * o] * r; out[1] = raw.dir[3 * o + 1] * r; out[2] = raw.dir[3 * o + 2] * r; return out; }
lod.shade = function (raw, y, nx, ny, i, j, s) {
  const o = j * nx + i;
  const at = (ii, jj) => { ii = Math.min(nx - 1, Math.max(0, ii)); jj = Math.min(ny - 1, Math.max(0, jj)); const q = jj * nx + ii; return raw.ok[q] ? q : o; };
  point(raw, y, at(i + s, j), pa); point(raw, y, at(i - s, j), pb);
  const ax = pa[0] - pb[0], ay = pa[1] - pb[1], az = pa[2] - pb[2];
  point(raw, y, at(i, j + s), pa); point(raw, y, at(i, j - s), pb);
  const bx = pa[0] - pb[0], by = pa[1] - pb[1], bz = pa[2] - pb[2];
  let nx3 = ay * bz - az * by, ny3 = az * bx - ax * bz, nz3 = ax * by - ay * bx;
  const ux = raw.dir[3 * o], uy = raw.dir[3 * o + 1], uz = raw.dir[3 * o + 2];
  if (nx3 * ux + ny3 * uy + nz3 * uz < 0) { nx3 = -nx3; ny3 = -ny3; nz3 = -nz3; }
  const nl = Math.hypot(nx3, ny3, nz3);
  if (!nl) return 0.92;
  // east (around the axis) and north at this point; the light comes from above, the east and the south
  let ex = uz, ez = -ux;
  const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const tx = uy * ez, ty = uz * ex - ux * ez, tz = -uy * ex;
  const lx = 0.8 * ux + 0.45 * ex - 0.4 * tx, ly = 0.8 * uy - 0.4 * ty, lz = 0.8 * uz + 0.45 * ez - 0.4 * tz;
  return 0.6 + 0.4 * Math.max(0, (nx3 * lx + ny3 * ly + nz3 * lz) / (nl * Math.hypot(lx, ly, lz)));
};

// ---- rings ----
const FIELDS = ["h", "wl", "top", "biome", "ice", "ok"];
// Starts rebuilding ring L around grid point (cu, cv) of face f: copies what the old ring already has and
// asks the workers for the rest.
function start(L, f, cu, cv) {
  const c = L.cell, n = 2 * EXT + 1, gu0 = cu - EXT * c, gv0 = cv - EXT * c;
  const anchor = P.pos(f, cu, cv, P.SEA, [0, 0, 0]), stand = CELLS.indexOf(c) < STAND_LEVELS ? { cu, cv, anchor, gu0, gv0 } : null;
  const b = { f, cu, cv, gu0, gv0, n, anchor, pending: 0, t0: performance.now(), raw: BF.gridJob.alloc({ nx: n, ny: n }), parts: [] };
  let rects = [[0, n, 0, n]];   // [j0, j1, i0, i1] still to sample
  const old = L.raw && L.f === f ? L : null;
  if (old) {
    const di = (gu0 - old.gu0) / c, dj = (gv0 - old.gv0) / c;
    if (Math.abs(di) < n && Math.abs(dj) < n) {
      const i0 = Math.max(0, -di), i1 = Math.min(n, n - di), j0 = Math.max(0, -dj), j1 = Math.min(n, n - dj);
      for (let j = j0; j < j1; j++) {
        const d = j * n, s = (j + dj) * n + di;
        for (const k of FIELDS) b.raw[k].set(old.raw[k].subarray(s + i0, s + i1), d + i0);
        b.raw.dir.set(old.raw.dir.subarray(3 * (s + i0), 3 * (s + i1)), 3 * (d + i0));
      }
      // the old ring's stand-ins on the samples kept
      if (stand) b.parts.push(keep(old, b, i0, i1, j0, j1, di, dj));
      rects = [];
      if (j0 > 0) rects.push([0, j0, 0, n]);
      if (j1 < n) rects.push([j1, n, 0, n]);
      if (i0 > 0) rects.push([j0, j1, 0, i0]);
      if (i1 < n) rects.push([j0, j1, i1, n]);
    }
  }
  L.building = b;
  const prio = CELLS.indexOf(c);
  for (const [j0, j1, i0, i1] of rects) {
    const w = i1 - i0, step = Math.max(1, Math.floor(6000 / w));
    for (let j = j0; j < j1; j += step) {
      const job = { f, u0: gu0 + i0 * c, v0: gv0 + j * c, cell: c, nx: w, ny: Math.min(step, j1 - j), clamp: false, stand };
      b.pending++;
      BF.sampler.request(job, prio, (res) => {
        if (L.building !== b) return;
        for (let jj = 0; jj < job.ny; jj++) {
          const s = jj * w, d = (j + jj) * n + i0;
          for (const k of FIELDS) b.raw[k].set(res[k].subarray(s, s + w), d);
          b.raw.dir.set(res.dir.subarray(3 * s, 3 * (s + w)), 3 * d);
        }
        if (res.stand) b.parts.push(res.stand);
        if (--b.pending === 0) finish(L, b);
      }, L);
    }
  }
  if (!b.pending) finish(L, b);
}

// The stand-ins of old ring L on the samples that new ring b keeps (columns i0 to i1 and rows j0 to j1 of b,
// which are di and dj further on in L), moved to b's centre and anchor (see BF.gridJob.stand for the form).
const SK = { flat: 3, sph: 3, col: 3, ws: 2, bin: 2 };
const SA = { flat: Float32Array, sph: Float32Array, col: Uint8Array, ws: Uint8Array, bin: Uint16Array };
function keep(L, b, i0, i1, j0, j1, di, dj) {
  const pts = L.mesh && L.mesh.children[1], n = pts ? L.bin.length / 2 : 0, idx = [];
  for (let q = 0; q < n; q++) {
    const i = L.bin[2 * q] - di, j = L.bin[2 * q + 1] - dj;
    if (i >= i0 && i < i1 && j >= j0 && j < j1) idx.push(q);
  }
  const out = {};
  for (const k in SK) out[k] = new SA[k](idx.length * SK[k]);
  if (!idx.length) return out;
  const A = pts.geometry.attributes, fl = A.position.array, sp = A.sphere.array, cl = A.color.array, ws = A.ws.array;
  const du = L.cu - b.cu, dv = L.cv - b.cv, an = L.mesh.userData.anchor;
  const ax = an[0] - b.anchor[0], ay = an[1] - b.anchor[1], az = an[2] - b.anchor[2];
  for (let p = 0; p < idx.length; p++) {
    const q = idx[p];
    out.flat[3 * p] = fl[3 * q] + du; out.flat[3 * p + 1] = fl[3 * q + 1]; out.flat[3 * p + 2] = fl[3 * q + 2] + dv;
    out.sph[3 * p] = sp[3 * q] + ax; out.sph[3 * p + 1] = sp[3 * q + 1] + ay; out.sph[3 * p + 2] = sp[3 * q + 2] + az;
    out.col[3 * p] = cl[3 * q]; out.col[3 * p + 1] = cl[3 * q + 1]; out.col[3 * p + 2] = cl[3 * q + 2];
    out.ws[2 * p] = ws[2 * q]; out.ws[2 * p + 1] = ws[2 * q + 1];
    out.bin[2 * p] = L.bin[2 * q] - di; out.bin[2 * p + 1] = L.bin[2 * q + 1] - dj;
  }
  return out;
}
function join(parts) {
  const out = {};
  for (const k in SK) {
    let len = 0;
    for (const p of parts) len += p[k].length;
    const a = new SA[k](len);
    let o = 0;
    for (const p of parts) { a.set(p[k], o); o += p[k].length; }
    out[k] = a;
  }
  return out;
}
// The stand-ins as points, laid out like the ring's mesh.
function points(S) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(S.flat, 3));
  g.setAttribute("sphere", new THREE.BufferAttribute(S.sph, 3));
  g.setAttribute("color", new THREE.BufferAttribute(S.col, 3, true));
  g.setAttribute("ws", new THREE.BufferAttribute(S.ws, 2));
  const pts = new THREE.Points(g, world.material(false, "points"));
  pts.frustumCulled = false;
  return pts;
}

// Builds ring L's mesh from its samples.
function finish(L, b) {
  const tf = performance.now();
  const n = b.n, c = L.cell, raw = b.raw, NV = n * n, y = lod.heights(raw);
  const anchor = b.anchor;
  const flat = new Float32Array(NV * 3), sph = new Float32Array(NV * 3), base = new Float32Array(NV * 3), col = new Float32Array(NV * 3);
  const mflat = new Float32Array(NV * 3), msph = new Float32Array(NV * 3), mcol = new Float32Array(NV * 3), can = new Float32Array(NV * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = j * n + i;
    if (!raw.ok[o]) continue;
    const r = P.R + y[o] - P.SEA;
    flat[o * 3] = b.gu0 + i * c - b.cu; flat[o * 3 + 1] = y[o]; flat[o * 3 + 2] = b.gv0 + j * c - b.cv;
    for (let k = 0; k < 3; k++) sph[o * 3 + k] = raw.dir[o * 3 + k] * r - anchor[k];
    lod.colour(raw.h[o], raw.wl[o], raw.top[o], raw.biome[o], raw.ice[o], base, o * 3);
    const sh = lod.shade(raw, y, n, n, i, j, 1);
    for (let k = 0; k < 3; k++) col[o * 3 + k] = base[o * 3 + k] * sh;
    lod.canopy(raw.h[o], raw.wl[o], raw.top[o], raw.biome[o], can, o * 4);
    for (let k = 0; k < 3; k++) can[o * 4 + k] *= sh;
  }
  // morph targets: a point on the coarser ring's grid (even i and j) stays put and takes the coarser ring's
  // shading; any other point goes to the middle of the coarser triangle edge it lies on (that ring's cells
  // are split along the same diagonal as these, below)
  for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) {
    const o = j * n + i;
    if (!raw.ok[o]) continue;
    const sh = lod.shade(raw, y, n, n, i, j, 2);
    for (let k = 0; k < 3; k++) { mflat[o * 3 + k] = flat[o * 3 + k]; msph[o * 3 + k] = sph[o * 3 + k]; mcol[o * 3 + k] = base[o * 3 + k] * sh; }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!(i & 1) && !(j & 1)) continue;
    const o = j * n + i;
    if (!raw.ok[o]) continue;
    let a, e;
    if (!(j & 1)) { a = o - 1; e = o + 1; }               // on a row of the coarser grid
    else if (!(i & 1)) { a = o - n; e = o + n; }          // on a column
    else { a = o - n + 1; e = o + n - 1; }                // on a cell's diagonal: (i + 1, j - 1) to (i - 1, j + 1)
    if (!raw.ok[a] || !raw.ok[e]) {
      for (let k = 0; k < 3; k++) { mflat[o * 3 + k] = flat[o * 3 + k]; msph[o * 3 + k] = sph[o * 3 + k]; mcol[o * 3 + k] = col[o * 3 + k]; }
      continue;
    }
    for (let k = 0; k < 3; k++) {
      mflat[o * 3 + k] = (flat[a * 3 + k] + flat[e * 3 + k]) / 2;
      msph[o * 3 + k] = (sph[a * 3 + k] + sph[e * 3 + k]) / 2;
      mcol[o * 3 + k] = (mcol[a * 3 + k] + mcol[e * 3 + k]) / 2;
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    if (raw.ok[a] && raw.ok[a + 1] && raw.ok[a + n] && raw.ok[a + n + 1]) idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);   // counter-clockwise seen from above
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(flat, 3));
  g.setAttribute("sphere", new THREE.BufferAttribute(sph, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("mflat", new THREE.BufferAttribute(mflat, 3));
  g.setAttribute("msph", new THREE.BufferAttribute(msph, 3));
  g.setAttribute("mcol", new THREE.BufferAttribute(mcol, 3));
  g.setAttribute("canopy", new THREE.BufferAttribute(can, 4));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(g, world.material(false, "morph"));
  mesh.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(mesh);
  const S = CELLS.indexOf(c) < STAND_LEVELS ? join(b.parts) : null;
  if (S) { grp.add(points(S)); mesh.material.uniforms.stand.value = 1; }
  grp.userData = { anchor, f: b.f, cx: b.cu / 16, cz: b.cv / 16 };
  if (L.mesh) dispose(L.mesh);
  L.mesh = grp; L.raw = raw; L.bin = S && S.bin; L.stands = S ? S.ws.length / 2 : 0; L.f = b.f; L.cu = b.cu; L.cv = b.cv; L.gu0 = b.gu0; L.gv0 = b.gv0;
  L.buildMs = performance.now() - b.t0; L.meshMs = performance.now() - tf; L.building = null;
  lod.group.add(grp);
}

// Rivers as ribbons along their curves, out to the largest ring: a sampled grid shows a river narrower than
// its cells only as a broken line, so distant rivers are drawn from the river network itself. Ribbons are at
// least MINW blocks wide so small streams still show from high up, and sit at the water surface.
const MINW = 3;
lod.ribbon = null;
function ribbons(f, cu, cv, ext) {
  if (lod.ribbon) { dispose(lod.ribbon); lod.ribbon = null; }
  const RV = world.terrain.rivers(), u0 = Math.round(cu / 16) * 16, v0 = Math.round(cv / 16) * 16;
  const anchor = P.pos(f, u0, v0, P.SEA, [0, 0, 0]), flat = [], sph = [], col = [], idx = [], g = {}, q = [0, 0, 0];
  for (let li = 0; li < RV.link.length; li++) {
    const n = RV.link[li], c0 = RV.geom(li);
    if (c0.F !== f && !P.UNFOLD[f][c0.F]) continue;
    // quick reject on the link's own nodes, then work in face f's grid
    const A = RV.inFace(f, n, [0, 0]), Bq = RV.inFace(f, RV.down[n], [0, 0]);
    if (!A || !Bq || Math.min(Math.abs(A[0] - cu), Math.abs(Bq[0] - cu)) > ext + 2000 || Math.min(Math.abs(A[1] - cv), Math.abs(Bq[1] - cv)) > ext + 2000) continue;
    const c = RV.view(li, f), r0 = RV.rs[n], r1 = RV.rs[RV.down[n]], hw = Math.max(MINW, c.w), K = c.xs.length - 1;
    const prof = RV.geom(li).r;   // the water profile, if the link has been read already
    for (let k = 0; k <= K; k++) {
      const x = c.xs[k], y = c.ys[k];
      const k0 = Math.max(0, k - 1), k1 = Math.min(K, k + 1), tx = c.xs[k1] - c.xs[k0], ty = c.ys[k1] - c.ys[k0], tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl * hw, ny = tx / tl * hw;
      // lifted by half a ring cell at this distance, since coarse cells bridge across narrow valleys
      const h = (prof ? prof[k] : r0 + (r1 - r0) * k / K) + 0.9 + Math.hypot(x - cu, y - cv) / (2 * HALF);
      const base = flat.length / 3;
      for (const sgn of [-1, 1]) {
        const px = x + nx * sgn, py = y + ny * sgn;
        flat.push(px - u0, h, py - v0);
        P.wrap(f, px, py, g); P.dir(g.f, g.u, g.v, q);
        const rr = P.R + (h - P.SEA);
        sph.push(q[0] * rr - anchor[0], q[1] * rr - anchor[1], q[2] * rr - anchor[2]);
        col.push(WATER[0], WATER[1], WATER[2]);
      }
      if (k > 0 && Math.abs(x - cu) <= ext && Math.abs(y - cv) <= ext) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
  geo.setAttribute("sphere", new THREE.Float32BufferAttribute(sph, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  const mat = world.material(false);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(mesh);
  grp.userData = { anchor, f, cx: u0 / 16, cz: v0 / 16 };
  lod.ribbon = grp;
  lod.group.add(grp);
}

// How far the view point is from ring L's centre, in blocks of the view face's grid (Infinity if L's face
// can't be unfolded next to it).
function offset(L, V) {
  if (L.f < 0) return Infinity;
  const e = world.unfold(V.f, L.f);
  if (!e) return Infinity;
  const U = e.A[0] * L.cu + e.A[1] * L.cv + e.t[0], W = e.A[2] * L.cu + e.A[3] * L.cv + e.t[1];
  return Math.max(Math.abs(U - V.u), Math.abs(W - V.v));
}

// Called each frame with the player's height above the ground.
let last = null, speed = 0;
lod.update = function (above, budgetMs = 6) {
  const V = world.view, now = performance.now();
  BF.sampler.tick(budgetMs);
  // speed over the ground (blocks per second), to skip rebuilding rings the player is outrunning
  if (last && last.f === V.f && now > last.t) {
    const dt = (now - last.t) / 1000;
    speed += (Math.hypot(V.u - last.u, V.v - last.v) / dt - speed) * Math.min(1, dt * 2);
  }
  last = { f: V.f, u: V.u, v: V.v, t: now };
  lod.active = above > SHOW_ABOVE || V.k > 0;
  lod.group.visible = lod.active;
  if (!lod.active) { lod.top = null; return; }
  // river ribbons cover the largest ring; they are quick, so they are built here
  const top = lod.levels[lod.levels.length - 1];
  if (above < RIBBON_HIDE && (!lod.ribbon || offset({ f: lod.ribbon.userData.f, cu: lod.ribbonAt[0], cv: lod.ribbonAt[1] }, V) > top.half * MOVE)) {
    const c = top.cell * 4, cu = Math.round(V.u / c) * c, cv = Math.round(V.v / c) * c;
    ribbons(V.f, cu, cv, top.half * EXT / HALF);
    lod.ribbonAt = [cu, cv];
  }
  for (const L of lod.levels) {
    L.show = above < HIDE * L.cell;
    if (!L.show) { if (L.building) { BF.sampler.cancel(L); L.building = null; } continue; }
    if (L.building || (L.mesh && offset(L, V) <= MOVE * L.half)) continue;
    // too fast for this ring to keep up: leave it where it is (coarser rings fill in) until the player slows
    if (L.mesh && speed * L.buildMs / 1000 > 0.5 * L.half) continue;
    const c = L.cell * 4;
    start(L, V.f, Math.round(V.u / c) * c, Math.round(V.v / c) * c);
  }
  // place, and cut each ring to its disc, minus the next finer ring's disc and the loaded chunks; the discs
  // are measured in the grid each mesh is laid out on (a ring's own centre is its origin)
  lod.eyeHole = Math.min(world.viewDist * 16, world.covered || 0) * 0.95;
  if (lod.ribbon) {
    world.place(lod.ribbon);
    if (above >= RIBBON_HIDE) lod.ribbon.visible = false;
    const d = lod.ribbon.userData;
    disc(lod.ribbon.children[0].material.uniforms.hole.value, d.f, d.cx * 16, d.cz * 16, V.f, V.u, V.v, lod.eyeHole);
  }
  let prev = null;
  for (const L of lod.levels) {
    if (!L.mesh) continue;
    world.place(L.mesh);
    if (!L.show) L.mesh.visible = false;
    if (!L.mesh.visible) continue;
    const coarsest = L === top;
    for (const m of L.mesh.children) {
      const u = m.material.uniforms;
      disc(u.hole.value, L.f, L.cu, L.cv, V.f, V.u, V.v, lod.eyeHole);
      if (prev) disc(u.hole2.value, L.f, L.cu, L.cv, prev.f, prev.cu, prev.cv, prev.half * HOLE); else u.hole2.value.set(0, 0, 0);
      u.outer.value.set(0, 0, L.half);
      u.morph.value.set(coarsest ? 1e30 : L.half * MORPH0, coarsest ? 2e30 : L.half * MORPH1);
      // stand-ins fade out across the outer part of the last ring that has them
      if (L === lod.levels[STAND_LEVELS - 1]) u.edge.value.set(L.half * 0.7, L.half * 0.95);
    }
    // stand-ins all under half a pixel: not drawn at all
    if (L.mesh.children[1]) L.mesh.children[1].visible = STAND_W * world.shared.pxScale.value / Math.max(1, above) > 0.5;
    prev = L;
  }
  lod.top = prev;
};

// Sets out (x, z, radius) to a disc of radius r around point (u, v) of face g, in the grid of face f
// relative to (cu, cv); no disc if g can't be unfolded next to f.
function disc(out, f, cu, cv, g, u, v, r) {
  const e = world.unfold(f, g);
  if (!e) { out.set(0, 0, 0); return; }
  out.set(e.A[0] * u + e.A[1] * v + e.t[0] - cu, e.A[2] * u + e.A[3] * v + e.t[1] - cv, r);
}
lod.disc = disc;
})();
