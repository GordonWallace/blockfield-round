// Terrain surfaces sampled on a regular grid, for distant terrain (lod.js) and the globe (globe.js).
//
// BF.gridJob does the sampling and runs the same way in the page and in js/lodworker.js. BF.sampler hands
// jobs to a few background workers, lowest priority number first, so the page keeps its frame rate while
// distant terrain is sampled. If workers can't start (the page opened from a file), it runs the jobs in the
// page instead, a few rows per frame.
(() => {
"use strict";
const BF = (self.BF = self.BF || {});

// A job samples nx x ny points of face f's grid, starting at (u0, v0) and `cell` blocks apart. Points past
// one face edge are wrapped onto the next face; points in a cube corner's empty wedge are skipped, or
// clamped onto face f when `clamp` is set. With `exact`, dir is the direction of the grid point itself on
// face f (not of the sampled column's centre), so meshes on neighbouring faces share their edge vertices.
BF.gridJob = {
  alloc(job) {
    const n = job.nx * job.ny;
    return {
      id: job.id, h: new Float32Array(n), wl: new Float32Array(n), top: new Uint8Array(n), biome: new Uint8Array(n),
      ice: new Uint8Array(n), ok: new Uint8Array(n), dir: new Float32Array(3 * n),
    };
  },
  rows(T, job, out, j0, j1) {
    const P = BF.planet, N = P.N, w = {}, d = [0, 0, 0];
    for (let j = j0; j < j1; j++) for (let i = 0; i < job.nx; i++) {
      let u = job.u0 + i * job.cell, v = job.v0 + j * job.cell;
      const o = j * job.nx + i;
      if ((u < 0 || u >= N) && (v < 0 || v >= N)) {
        if (!job.clamp) continue;
        u = Math.min(N - 1, Math.max(0, u)); v = Math.min(N - 1, Math.max(0, v));
      }
      P.wrap(job.f, u, v, w);
      const g = w.f, gu = Math.min(N - 1, Math.max(0, Math.floor(w.u))), gv = Math.min(N - 1, Math.max(0, Math.floor(w.v)));
      P.dir(g, gu + 0.5, gv + 0.5, d);
      const s = T.surface(g, gu, gv, d);
      if (job.exact) P.dir(job.f, u, v, d);
      out.h[o] = s.h; out.wl[o] = s.wl; out.top[o] = s.top; out.biome[o] = s.biome; out.ice[o] = s.ice ? 1 : 0; out.ok[o] = 1;
      out.dir[3 * o] = d[0]; out.dir[3 * o + 1] = d[1]; out.dir[3 * o + 2] = d[2];
    }
  },
  buffers(out) {
    const b = [out.h.buffer, out.wl.buffer, out.top.buffer, out.biome.buffer, out.ice.buffer, out.ok.buffer, out.dir.buffer];
    if (out.stand) for (const k of STAND) b.push(out.stand[k].buffer);
    return b;
  },
  // With job.stand, after the rows are sampled: stand-ins for the trees and village houses in the job's area,
  // for distant views where they are a few pixels across (see lod.js). Each is two boxes, a trunk and a crown
  // (walls and a roof for a house). Each sample stands for the tree cells (4 x 4 blocks) around it: a cell's
  // tree is decided by the same random numbers as the real one (flora.js), with the sample's ground in place
  // of the tree's own column. Far rings thin them out: one cell in each square of 2^m x 2^m cells (picked at
  // random); the ground's canopy colour makes up the rest (lod.js).
  // job.stand is the ring they are for: { cu, cv, anchor, gu0, gv0, m, max } (max: none further from its centre). out.stand holds, per stand-in:
  //   base: the middle of its foot in face f's grid relative to (cu, cv), and its layer; sph: the same point on
  //   the sphere relative to the anchor; top, low: crown (roof) and trunk (wall) colours; a: trunk width x and
  //   z, height, crown top width (0-255 for 0-1); b: crown width x and z, height, a random byte; c: crown
  //   bottom; bin: its sample's column and row in the ring (from gu0, gv0), for reusing it when the ring moves.
  stand(T, job, out) {
    const P = BF.planet, N = P.N, C = BF.climate, B = BF.B, c = job.cell, nx = job.nx, ny = job.ny;
    if (!noise || noiseSeed !== T.seed) { noise = BF.makeNoise(T.seed ^ 0x68e31da4); noiseSeed = T.seed; }
    const R = job.stand, K = {}, w = {}, d = [0, 0, 0], V = BF.villages, M = 1 << R.m, BS = 4 * M;
    for (const k of STAND) K[k] = [];
    const lo = 4 * Math.floor(c / 8);   // a sample's tree cells start this far before it (whole cells)
    // the drawn ground height at grid point (x, y) of face f: bilinear between the job's samples
    const ground = (x, y, o) => {
      const fi = Math.min(nx - 1.001, Math.max(0, (x - job.u0) / c)), fj = Math.min(ny - 1.001, Math.max(0, (y - job.v0) / c));
      const i = Math.floor(fi), j = Math.floor(fj), a = j * nx + i, s = fi - i, t = fj - j;
      const g = (q) => (out.ok[q] ? Math.max(out.h[q], out.wl[q]) + 1 : Math.max(out.h[o], out.wl[o]) + 1);
      if (nx < 2 || ny < 2) return g(o);
      return (g(a) * (1 - s) + g(a + 1) * s) * (1 - t) + (g(a + nx) * (1 - s) + g(a + nx + 1) * s) * t;
    };
    const rgb = (col, k) => [Math.min(255, (col >> 16 & 255) * k), Math.min(255, (col >> 8 & 255) * k), Math.min(255, (col & 255) * k)];
    // g: the stand-in's own face and grid point; (x, y): the same point in face f's grid; e: the map from g's
    // grid into f's (null on f), which turns x and z widths round with a quarter turn
    const emit = (g, x, y, layer, e, top, low, lx, lz, lh, taper, ux, uz, uh, ub, r, bu, bv) => {
      if (e && Math.abs(e.A[0]) < 0.5) { let t = lx; lx = lz; lz = t; t = ux; ux = uz; uz = t; }
      K.base.push(x - R.cu, layer, y - R.cv); K.bin.push((bu - R.gu0) / c, (bv - R.gv0) / c);
      P.dir(g.f, g.u, g.v, d);
      const rr = P.R + layer - P.SEA;
      K.sph.push(d[0] * rr - R.anchor[0], d[1] * rr - R.anchor[1], d[2] * rr - R.anchor[2]);
      K.top.push(...top); K.low.push(...low);
      K.a.push(lx, lz, lh, Math.round(taper * 255)); K.b.push(ux, uz, uh, Math.floor(r * 255.99)); K.c.push(ub);
    };
    const villages = new Set();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      if (!out.ok[o]) continue;
      const U = job.u0 + i * c, Vv = job.v0 + j * c, h = out.h[o];
      if (R.max && Math.hypot(U - R.cu, Vv - R.cv) > R.max) continue;
      // villages whose well is in this sample's area
      if (V) {
        P.wrap(job.f, U, Vv, w);
        const vk = w.f + ":" + V.regionOf(w.u) + ":" + V.regionOf(w.v);
        if (!villages.has(vk)) {
          villages.add(vk);
          const v = V.site(w.f, V.regionOf(w.u), V.regionOf(w.v));
          if (v) village(v);
        }
      }
      const tr = C.TREES[out.biome[o]];
      if (!tr || !tr.d || out.wl[o] > h || h <= P.SEA) continue;
      const top = out.top[o], cactus = tr.kinds[0] === "cactus";
      if (cactus ? top !== B.SAND && top !== B.RED_SAND : top !== B.GRASS && top !== B.SNOW) continue;
      // squares of M x M tree cells (whole squares: a sample's cells are a multiple of M across)
      for (let qv = Vv - lo; qv < Vv - lo + c; qv += BS) for (let qu = U - lo; qu < U - lo + c; qu += BS) {
        // the square on its own face, one cell of it picked at random, and the map from there into face f's grid
        let g = job.f, ci = qu / 4, cj = qv / 4, e = null;
        if (qu < 0 || qu >= N || qv < 0 || qv >= N) {
          if ((qu < 0 || qu >= N) && (qv < 0 || qv >= N)) continue;
          P.wrap(job.f, qu + BS / 2, qv + BS / 2, w);
          g = w.f; ci = Math.floor(w.u / BS) * M; cj = Math.floor(w.v / BS) * M; e = P.UNFOLD[job.f][g];
        }
        if (M > 1) { ci += Math.floor(noise.hash(ci * 7 + g, cj, 11) * M); cj += Math.floor(noise.hash(ci * 7 + g, cj, 12) * M); }
        const hs = (salt) => noise.hash(ci * 7 + g, cj, salt);
        if (hs(3) >= tr.d) continue;
        const tu = ci * 4 + Math.floor(hs(1) * 4), tv = cj * 4 + Math.floor(hs(2) * 4);
        if (V && V.inVillage(g, tu, tv)) continue;
        const kind = tr.kinds[Math.floor(hs(4) * tr.kinds.length)];
        const [th, tw, cb, ch, cw, taper, tc, lc] = C.shape(kind, hs(5));
        let x = tu + 0.5, y = tv + 0.5;
        if (e) { x = e.A[0] * (tu + 0.5) + e.A[1] * (tv + 0.5) + e.t[0]; y = e.A[2] * (tu + 0.5) + e.A[3] * (tv + 0.5) + e.t[1]; }
        w.f = g; w.u = tu + 0.5; w.v = tv + 0.5;
        // a little variety in brightness (canopy colours in climate.js use the average)
        const k = 0.8 + 0.2 * hs(8);
        emit(w, x, y, ground(x, y, o), e, rgb(lc, k), rgb(tc, 0.9), tw, tw, th, taper, cw, cw, ch, cb, hs(9), U, Vv);
      }
    }
    // a village's well and houses (walls and roofs), placed by the village's own layout; it belongs to the
    // sample whose area holds its well, so it comes out once even where jobs and rings overlap
    function village(v) {
      const e = v.f === job.f ? null : P.UNFOLD[job.f][v.f];
      if (v.f !== job.f && !e) return;
      let wx = v.x + 0.5, wy = v.z + 0.5;
      if (e) { const a = e.A[0] * wx + e.A[1] * wy + e.t[0]; wy = e.A[2] * wx + e.A[3] * wy + e.t[1]; wx = a; }
      const i = Math.floor((wx - job.u0 + lo) / c), j = Math.floor((wy - job.v0 + lo) / c);
      if (i < 0 || i >= nx || j < 0 || j >= ny || !out.ok[j * nx + i]) return;
      const bu = job.u0 + i * c, bv = job.v0 + j * c;
      const L = V.layout(v), g = { f: v.f, u: 0, v: 0 }, roof = rgb(0x7a4a2a, 1), wall = rgb(0xb08850, 0.85), stone = rgb(0x8c8c8c, 1);
      const put = (u, vv, layer, ...rest) => {
        let x = u + 0.5, y = vv + 0.5;
        if (e) { const a = e.A[0] * x + e.A[1] * y + e.t[0]; y = e.A[2] * x + e.A[3] * y + e.t[1]; x = a; }
        g.u = u + 0.5; g.v = vv + 0.5;
        // thinned like the trees (houses keep their own random byte, so the same ones stay)
        const r = noise.hash(u, vv, 13);
        if (M > 1 && noise.hash(vv, u, 14) * M * M >= 1) return;
        emit(g, x, y, layer, e, ...rest, r, bu, bv);
      };
      // the well: a stone rim under a little roof
      put(v.x, v.z, L.wy, roof, stone, 5, 5, 2, 1, 5, 5, 1, 5);
      for (const hs of L.houses) {
        const lx = hs.box[2] - hs.box[0] - 3, lz = hs.box[3] - hs.box[1] - 3;   // walls (the box has a 1-block margin and overhang)
        put(hs.cx, hs.cz, hs.gy, roof, wall, lx, lz, 4, 0.25, lx + 2, lz + 2, Math.min(hs.hw, hs.hd) + 2, 4);
      }
    }
    out.stand = { base: new Float32Array(K.base), sph: new Float32Array(K.sph), top: new Uint8Array(K.top), low: new Uint8Array(K.low),
      a: new Uint8Array(K.a), b: new Uint8Array(K.b), c: new Uint8Array(K.c), bin: new Uint16Array(K.bin) };
  },
};
const STAND = ["base", "sph", "top", "low", "a", "b", "c", "bin"];
let noise = null, noiseSeed = null;

if (typeof document === "undefined") return;   // in a worker: only the sampling above is needed

// ---- the job queue ----
// request(job, prio, done): prio is a number or a function returning one (read when a worker comes free);
// done(result) is called with the arrays from BF.gridJob.alloc. cancel(tag) drops queued jobs with that tag.
const S = (BF.sampler = { workers: [], queue: [], seed: null, inline: false, running: null, seq: 0 });
S.reset = function (seed) {
  for (const w of S.workers) w.terminate();
  S.workers = []; S.queue = []; S.running = null; S.seed = seed;
  S.inline = typeof Worker === "undefined" || location.protocol === "file:";
  if (S.inline) return;
  const k = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < k; i++) {
    let w;
    try { w = new Worker("js/lodworker.js"); } catch (e) { S.inline = true; break; }
    w.busy = null;
    w.onmessage = (e) => { const it = w.busy; w.busy = null; if (!it.dead) it.done(e.data); pump(); };
    w.onerror = () => {
      // a worker that can't load: fall back to sampling in the page
      S.inline = true;
      if (w.busy) S.queue.push(w.busy);
      for (const x of S.workers) x.terminate();
      S.workers = [];
    };
    S.workers.push(w);
  }
};
const prio = (it) => (typeof it.prio === "function" ? it.prio() : it.prio);
function next() {
  let b = -1, bp = Infinity;
  for (let i = 0; i < S.queue.length; i++) { const p = prio(S.queue[i]); if (p < bp) { bp = p; b = i; } }
  if (b < 0) return null;
  const it = S.queue[b];
  S.queue[b] = S.queue[S.queue.length - 1]; S.queue.pop();
  return it;
}
function pump() {
  if (S.inline) return;
  for (const w of S.workers) {
    if (w.busy) continue;
    const it = next();
    if (!it) return;
    w.busy = it;
    w.postMessage({ ...it.job, seed: S.seed });
  }
}
S.request = function (job, prio, done, tag = null) {
  job.id = ++S.seq;
  S.queue.push({ job, prio, done, tag, dead: false });
  pump();
};
S.cancel = function (tag) {
  S.queue = S.queue.filter((it) => it.tag !== tag);
  for (const w of S.workers) if (w.busy && w.busy.tag === tag) w.busy.dead = true;
  if (S.running && S.running.tag === tag) S.running = null;
};
S.pending = () => S.queue.length + S.workers.filter((w) => w.busy).length + (S.running ? 1 : 0);
// Called each frame: hands out work, or (without workers) samples rows in the page within the budget.
S.tick = function (budgetMs) {
  if (!S.inline) { pump(); return; }
  const t0 = performance.now(), T = BF.world.terrain;
  while (performance.now() - t0 < budgetMs) {
    if (!S.running) {
      const it = next();
      if (!it) return;
      it.out = BF.gridJob.alloc(it.job); it.row = 0;
      S.running = it;
    }
    const it = S.running;
    BF.gridJob.rows(T, it.job, it.out, it.row, it.row + 1);
    if (++it.row >= it.job.ny) { if (it.job.stand) BF.gridJob.stand(T, it.job, it.out); S.running = null; it.done(it.out); }
  }
};
})();
