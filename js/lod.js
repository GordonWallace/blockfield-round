// Distant terrain: rings of height-field meshes around the player, each coarser than the last, so that
// from high up the land well beyond the loaded chunks shows its real shape, colours and rivers.
//
// Level 0 has a cell every 4 blocks out to 512 blocks, then 16 out to 2 km, 64 out to 8 km and 256 out to
// 33 km; past that the coarse globe takes over. Each ring is drawn only between the previous ring's edge and
// its own (the shader discards the rest), and level 0 leaves a hole where real chunks are loaded. Rings are
// built a few rows per frame and rebuilt around the player once they have moved a quarter of a ring away.
// Each one is laid out on the player's face grid, unfolded across face edges like everything else, and
// carries both flat and true-sphere positions, so it blends between views like the chunks do.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world, N = P.N;
const LEVELS = [{ cell: 4, half: 512 }, { cell: 16, half: 2048 }, { cell: 64, half: 8192 }, { cell: 256, half: 32768 }];
const SHOW_ABOVE = 40;   // blocks above the ground at which distant terrain is drawn
const OVER = 1.25;       // a ring's mesh reaches this far past its drawn edge, so it still covers it while
const MOVE = 0.2;        // the player moves up to this fraction of the ring away, before it is rebuilt
const WATER = [0.27, 0.43, 0.8], ICE = [0.66, 0.78, 0.94];

const lod = (BF.lod = { group: null, levels: [], building: null, active: false });

lod.reset = function (scene) {
  if (lod.group) {
    for (const L of lod.levels) if (L.mesh) dispose(L.mesh);
    if (lod.ribbon) dispose(lod.ribbon);
    scene.remove(lod.group);
  }
  lod.ribbon = null;
  lod.group = new THREE.Group();
  scene.add(lod.group);
  lod.levels = LEVELS.map((d) => ({ ...d, mesh: null, f: -1, cu: 0, cv: 0 }));
  lod.building = null;
};
function dispose(m) { (m.parent || lod.group).remove(m); for (const x of m.isGroup ? m.children : [m]) { x.geometry.dispose(); x.material.dispose(); } }

// The radius covered by built rings (0 if none yet), for fog and the far clip plane.
lod.radius = function () {
  let r = 0;
  for (const L of lod.levels) if (L.mesh && lod.active) r = L.half;
  return r;
};

// Starts building level i around grid point (f, u, v).
function start(i, f, u, v) {
  const L = lod.levels[i], c = L.cell, ext = L.half * OVER, n = Math.round(2 * ext / c) + 1;
  const cu = Math.round(u / (c * 4)) * c * 4, cv = Math.round(v / (c * 4)) * c * 4;
  const u0 = Math.round(cu / 16) * 16, v0 = Math.round(cv / 16) * 16;   // mesh origin, on a chunk corner
  lod.building = {
    i, f, cu, cv, u0, v0, n, ext, row: 0, anchor: P.pos(f, u0, v0, P.SEA, [0, 0, 0]),
    flat: new Float32Array(n * n * 3), sph: new Float32Array(n * n * 3), col: new Float32Array(n * n * 3),
    hgt: new Float32Array(n * n), ok: new Uint8Array(n * n),
  };
}
const w = {}, d = [0, 0, 0];
function buildRow(b) {
  const L = lod.levels[b.i], c = L.cell, T = world.terrain, j = b.row, drop = c / 4;
  for (let i = 0; i < b.n; i++) {
    const u = b.cu - b.ext + i * c, v = b.cv - b.ext + j * c, o = j * b.n + i;
    if ((u < 0 || u >= N) && (v < 0 || v >= N)) continue;   // a cube corner's wedge: no face here
    P.wrap(b.f, u, v, w);
    const g = w.f, gu = Math.floor(w.u), gv = Math.floor(w.v);
    P.dir(g, gu + 0.5, gv + 0.5, d);
    const s = T.surface(g, gu, gv, d);
    const water = s.wl > s.h;
    const y = water ? s.wl + 0.875 - drop : s.h + 1 - drop;
    let col = water ? (s.ice ? ICE : WATER) : world.topColour(s.top, s.biome);
    // trees aren't drawn this far out, so forests darken the ground instead
    if (!water) { const t = BF.climate.TREES[s.biome], k = 1 - 0.4 * Math.min(1, t ? t.d : 0); col = [col[0] * k, col[1] * k, col[2] * k]; }
    b.ok[o] = 1; b.hgt[o] = y;
    b.flat[o * 3] = u - b.u0; b.flat[o * 3 + 1] = y; b.flat[o * 3 + 2] = v - b.v0;
    const r = P.R + (y - P.SEA);
    b.sph[o * 3] = d[0] * r - b.anchor[0]; b.sph[o * 3 + 1] = d[1] * r - b.anchor[1]; b.sph[o * 3 + 2] = d[2] * r - b.anchor[2];
    b.col[o * 3] = col[0]; b.col[o * 3 + 1] = col[1]; b.col[o * 3 + 2] = col[2];
  }
  b.row++;
}
function finish(b) {
  const L = lod.levels[b.i], n = b.n, c = L.cell, idx = [];
  // shade by slope so relief reads from above (light from the u, -v side)
  const lx = 0.45, ly = 0.8, lz = -0.4, ll = Math.hypot(lx, ly, lz);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = j * n + i;
    if (!b.ok[o]) continue;
    const hx = (b.hgt[j * n + Math.min(n - 1, i + 1)] - b.hgt[j * n + Math.max(0, i - 1)]) / (2 * c);
    const hz = (b.hgt[Math.min(n - 1, j + 1) * n + i] - b.hgt[Math.max(0, j - 1) * n + i]) / (2 * c);
    const nl = Math.hypot(hx, 1, hz), sh = 0.6 + 0.4 * Math.max(0, (-hx * lx + ly - hz * lz) / (nl * ll));
    for (let k = 0; k < 3; k++) b.col[o * 3 + k] *= sh;
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    if (b.ok[a] && b.ok[a + 1] && b.ok[a + n] && b.ok[a + n + 1]) idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);   // counter-clockwise seen from above
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.flat, 3));
  g.setAttribute("sphere", new THREE.BufferAttribute(b.sph, 3));
  g.setAttribute("color", new THREE.BufferAttribute(b.col, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(g, world.material(false));
  mesh.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(mesh);
  grp.userData = { anchor: b.anchor, f: b.f, cx: b.u0 / 16, cz: b.v0 / 16 };
  if (L.mesh) dispose(L.mesh);
  L.mesh = grp; L.f = b.f; L.cu = b.cu; L.cv = b.cv;
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
      const h = (prof ? prof[k] : r0 + (r1 - r0) * k / K) + 0.9;
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

// How far the view point is from level L's centre, in blocks of the view face's grid (Infinity if L's face
// can't be unfolded next to it).
function offset(L, V) {
  if (L.f < 0) return Infinity;
  const e = world.unfold(V.f, L.f);
  if (!e) return Infinity;
  const U = e.A[0] * L.cu + e.A[1] * L.cv + e.t[0], W = e.A[2] * L.cu + e.A[3] * L.cv + e.t[1];
  return Math.max(Math.abs(U - V.u), Math.abs(W - V.v));
}

// Called each frame with the player's height above the ground.
lod.update = function (above, budgetMs = 6) {
  const V = world.view;
  lod.active = above > SHOW_ABOVE || V.k > 0;
  lod.group.visible = lod.active;
  if (!lod.active) return;
  // river ribbons cover the largest ring; they are quick, so they come first
  const top = lod.levels[lod.levels.length - 1];
  if (!lod.ribbon || offset({ f: lod.ribbon.userData.f, cu: lod.ribbonAt[0], cv: lod.ribbonAt[1] }, V) > top.half * MOVE) {
    const c = top.cell * 4, cu = Math.round(V.u / c) * c, cv = Math.round(V.v / c) * c;
    ribbons(V.f, cu, cv, top.half * OVER);
    lod.ribbonAt = [cu, cv];
  }
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    if (!lod.building) {
      // the finest ring that is missing or off centre
      const i = lod.levels.findIndex((L) => offset(L, V) > L.half * MOVE);
      if (i < 0) break;
      start(i, V.f, V.u, V.v);
    }
    const b = lod.building;
    buildRow(b);
    if (b.row >= b.n) { finish(b); lod.building = null; }
  }
  // place, and cut each ring to the band between the previous ring (or the loaded chunks) and its edge
  let inner = Math.min(world.viewDist * 16, world.covered || 0) * (V.k > 0 ? 0.65 : 0.9);
  if (lod.ribbon) { world.place(lod.ribbon); lod.ribbon.children[0].material.uniforms.hole.value = inner; }
  for (const L of lod.levels) {
    if (!L.mesh) continue;
    world.place(L.mesh);
    const u = L.mesh.children[0].material.uniforms;
    // rings overlap a little (each coarser ring sits lower), so no gap opens between them
    u.hole.value = inner; u.outer.value = L.half * 0.97;
    inner = L.half * 0.95;
  }
};
})();
