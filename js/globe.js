// The whole planet as one even mesh, 640 x 640 cells per face (256 blocks each, the detail of the coarsest
// distant-terrain ring, so the two meet without a seam), drawn only in the round view, beyond the loaded
// chunks and the distant-terrain rings. Out at planet scale the rings are hidden and this is all there is.
//
// Each face is cut into 10 x 10 tiles, sampled by the background workers (grid.js), nearest the view
// first, from the moment a world starts. Tiles beyond the horizon aren't drawn.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, world = BF.world;
const M = 640, T = 64, CELL = P.N / M, TILES = M / T;   // cells per face edge, cells per tile edge
const PEAK = Math.acos(P.R / (P.R + 300));               // how far past the horizon a mountain top still shows

const globe = (BF.globe = { group: null, tiles: [], materials: [], built: 0 });

// All tiles share one vertex order, split along the same diagonal as the rings (lod.js) so the coarsest
// ring and the globe match.
const n = T + 1, index = (() => {
  const a = new Uint16Array(T * T * 6);
  let k = 0;
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const o = j * n + i;
    a.set([o, o + 1, o + n, o + 1, o + n + 1, o + n], k); k += 6;
  }
  return new THREE.BufferAttribute(a, 1);
})();

// Tile (f, ti, tj): samples one beyond each edge too, for slope shading.
function request(f, ti, tj) {
  const d = [0, 0, 0], c = [0, 0, 0], tile = { f, ti, tj, dir: [0, 0, 0], radius: 0, mesh: null };
  for (const [a, b] of [[0, 0], [T, 0], [0, T], [T, T]]) {
    P.dir(f, (ti * T + a) * CELL, (tj * T + b) * CELL, d);
    c[0] += d[0]; c[1] += d[1]; c[2] += d[2];
  }
  const l = Math.hypot(c[0], c[1], c[2]);
  tile.dir = [c[0] / l, c[1] / l, c[2] / l];
  P.dir(f, ti * T * CELL, tj * T * CELL, d);
  tile.radius = Math.acos(Math.min(1, d[0] * tile.dir[0] + d[1] * tile.dir[1] + d[2] * tile.dir[2])) * 1.05;
  globe.tiles.push(tile);
  const job = { f, u0: (ti * T - 1) * CELL, v0: (tj * T - 1) * CELL, cell: CELL, nx: T + 3, ny: T + 3, clamp: true, exact: true };
  // nearest the view first
  const prio = () => {
    const e = world.view.eye, el = Math.hypot(e[0], e[1], e[2]) || 1;
    return 100 + Math.acos(Math.max(-1, Math.min(1, (e[0] * tile.dir[0] + e[1] * tile.dir[1] + e[2] * tile.dir[2]) / el)));
  };
  BF.sampler.request(job, prio, (raw) => build(tile, raw), globe);
}

function build(tile, raw) {
  const W = T + 3, y = BF.lod.heights(raw), pos = new Float32Array(n * n * 3), col = new Uint8Array(n * n * 3), grid = new Float32Array(n * n * 2), c = [0, 0, 0, 0];
  const can = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = (j + 1) * W + i + 1, v = (j * n + i) * 3, r = P.R + y[o] - P.SEA;
    for (let k = 0; k < 3; k++) pos[v + k] = raw.dir[o * 3 + k] * r;
    BF.lod.colour(raw.h[o], raw.wl[o], raw.top[o], raw.biome[o], raw.ice[o], c, 0);
    const sh = BF.lod.shade(raw, y, W, W, i + 1, j + 1, 1);
    for (let k = 0; k < 3; k++) col[v + k] = Math.round(Math.min(1, c[k] * sh) * 255);
    BF.lod.canopy(raw.h[o], raw.wl[o], raw.top[o], raw.biome[o], c, 0);
    const q = (j * n + i) * 4;
    for (let k = 0; k < 3; k++) can[q + k] = Math.round(Math.min(1, c[k] * sh) * 255);
    can[q + 3] = Math.round(c[3] * 255);
    grid[(j * n + i) * 2] = (tile.ti * T + i) * CELL; grid[(j * n + i) * 2 + 1] = (tile.tj * T + j) * CELL;
  }
  const g = new THREE.BufferGeometry();
  const p = new THREE.BufferAttribute(pos, 3);
  g.setAttribute("position", p);
  g.setAttribute("sphere", p);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
  g.setAttribute("grid", new THREE.BufferAttribute(grid, 2));
  g.setAttribute("canopy", new THREE.BufferAttribute(can, 4, true));
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, globe.materials[tile.f]);
  mesh.frustumCulled = false;
  tile.mesh = mesh;
  globe.group.add(mesh);
  globe.built++;
}

globe.reset = function (scene) {
  if (globe.group) {
    scene.remove(globe.group);
    for (const m of globe.group.children) m.geometry.dispose();
    for (const m of globe.materials) m.dispose();
  }
  BF.sampler.cancel(globe);
  globe.group = new THREE.Group();
  globe.group.renderOrder = -1;
  scene.add(globe.group);
  // one material per face, each with its own map into the view face's grid (for the holes)
  globe.materials = [0, 1, 2, 3, 4, 5].map(() => world.material(false, "globe"));
  globe.tiles = []; globe.built = 0;
  for (let f = 0; f < 6; f++) for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) request(f, ti, tj);
};

// Called each frame with the current blend: places the globe and hides tiles beyond the horizon.
globe.update = function (k) {
  globe.group.visible = k > 0;
  if (k <= 0) return;
  const V = world.view, R = V.M, e = V.eye, el = Math.hypot(e[0], e[1], e[2]);
  // positions are relative to the planet's centre; a hole where the loaded chunks are, and one where the
  // coarsest distant-terrain ring is drawn (measured in the view face's grid)
  const top = BF.lod.top, L = BF.lod;
  for (let f = 0; f < 6; f++) {
    const u = globe.materials[f].uniforms;
    u.sphM.value.set(
      R[0], R[1], R[2], -(R[0] * e[0] + R[1] * e[1] + R[2] * e[2]),
      R[3], R[4], R[5], -(R[3] * e[0] + R[4] * e[1] + R[5] * e[2]),
      R[6], R[7], R[8], -(R[6] * e[0] + R[7] * e[1] + R[8] * e[2]),
      0, 0, 0, 1);
    u.flatM.value.copy(u.sphM.value);
    const m = world.unfold(V.f, f);
    if (!m) { u.hole.value.set(0, 0, 0); u.hole2.value.set(0, 0, 0); continue; }   // the far side
    u.unf.value.set(m.A[0], m.A[1], m.t[0], m.A[2], m.A[3], m.t[1], 0, 0, 1);
    L.disc(u.hole.value, V.f, 0, 0, V.f, V.u, V.v, world.chunksOn ? Math.max(L.eyeHole, world.viewDist * 16 * 0.9) : 0);
    if (top) L.disc(u.hole2.value, V.f, 0, 0, top.f, top.cu, top.cv, top.half * 0.97); else u.hole2.value.set(0, 0, 0);
  }
  const horizon = Math.acos(Math.min(1, P.R / Math.max(P.R, el))) + PEAK;
  for (const t of globe.tiles) {
    if (!t.mesh) continue;
    const a = Math.acos(Math.max(-1, Math.min(1, (e[0] * t.dir[0] + e[1] * t.dir[1] + e[2] * t.dir[2]) / el)));
    t.mesh.visible = a < horizon + t.radius;
  }
};
})();
