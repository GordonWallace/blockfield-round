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
  buffers(out) { return [out.h.buffer, out.wl.buffer, out.top.buffer, out.biome.buffer, out.ice.buffer, out.ok.buffer, out.dir.buffer]; },
};

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
    if (++it.row >= it.job.ny) { S.running = null; it.done(it.out); }
  }
};
})();
