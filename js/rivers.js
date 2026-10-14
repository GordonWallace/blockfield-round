// Rivers for the whole planet, worked out once when a world starts.
//
// The planet is finite, so unlike a flat endless world the whole drainage network can be solved at once:
//  1. A lattice of nodes, 160 x 160 per face (one per ~1 km, jittered), samples the terrain. Neighbours
//     across a face edge are found through the same exact unfold the game uses for blocks.
//  2. Priority flood from the ocean: nodes are reached in order of rising (filled) height, so every land
//     node, including ones in basins, gets a path to the sea that never climbs. Basins are filled just
//     enough to spill over their lowest rim (that is where lakes would go).
//  3. Each node drains to its steepest lower neighbour. Diagonal links that would cross another diagonal
//     are bent onto the shared side instead, so rivers never cross.
//  4. Flow (rain-weighted catchment) is summed from the sources down: tributaries join into larger rivers,
//     and a river is as wide as the water reaching it.
//  5. Water surface: rs = max(ground - 3, rs downstream), set from the sea up, so along every river the
//     surface only ever stays level or drops on the way to the sea. Between nodes it is interpolated
//     linearly along the link, so that holds everywhere, not just at nodes.
//  6. Each link is drawn as a meandering curve (3D noise at its world position, so the curve is the same
//     whichever face it is looked at from), tapered to straight where links meet so junctions line up.
//
// at(f, u, v, out) returns the nearest river to a column: d (distance to the centre line), w (half width),
// rs (water surface), the same fields Blockfield's rivers.at() fills, so terrain carving ports across.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, N = P.N, SEA = P.SEA;
const M = 160, NS = N / M;            // nodes per face edge; node spacing in blocks (1024)
const ACC_MIN = 6;                    // rain-weighted catchment (in nodes) at which a river starts
const WCAP = 40;                      // largest half width
const STEP = 16;                      // spacing of the meander polyline
const REACH = 150;                    // how far from the water a river shapes its valley
const CELL = 512, KC = N / CELL;      // lookup cells per face edge
const MARGIN = REACH + WCAP + 110;    // a link is listed in every cell within this of its chord
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

BF.rivers = { M, NS, ACC_MIN, WCAP, REACH };

// sample(x, y, z) -> { e (routing height), hf (ground), land, rain, elat } for a unit direction
BF.makeRivers = function (seed, sample) {
  const t0 = Date.now();
  const nz = BF.makeNoise(seed ^ 0x2c1b3c6d);
  const NN = 6 * M * M, MM = M * M;
  const U = new Float64Array(NN), V = new Float64Array(NN), D = new Float64Array(NN * 3);
  const e = new Float32Array(NN), p = new Float32Array(NN), rain = new Float32Array(NN), sea = new Uint8Array(NN);
  const nb = new Int32Array(NN * 8).fill(-1);
  const d = [0, 0, 0], w = {};

  // 1. nodes and neighbours
  for (let id = 0; id < NN; id++) {
    const f = (id / MM) | 0, j = ((id % MM) / M) | 0, i = id % M;
    U[id] = (i + 0.5 + (nz.hash(id, 1) - 0.5) * 0.6) * NS;
    V[id] = (j + 0.5 + (nz.hash(id, 2) - 0.5) * 0.6) * NS;
    P.dir(f, U[id], V[id], d);
    D[id * 3] = d[0]; D[id * 3 + 1] = d[1]; D[id * 3 + 2] = d[2];
    const s = sample(d[0], d[1], d[2]);
    e[id] = s.e; p[id] = s.hf; sea[id] = s.land < 0 ? 1 : 0;
    // snow and ice sheets feed little water
    rain[id] = (0.25 + s.rain) * (0.25 + 0.75 * smooth(86, 70, s.elat));
    for (let k = 0; k < 8; k++) {
      const ii = i + DIRS[k][0], jj = j + DIRS[k][1], off = ii < 0 || ii >= M || jj < 0 || jj >= M;
      if (!off) { nb[id * 8 + k] = f * MM + jj * M + ii; continue; }
      if (k >= 4) continue;   // no diagonal links across a face edge
      P.wrap(f, (ii + 0.5) * NS, (jj + 0.5) * NS, w);
      nb[id * 8 + k] = w.f * MM + Math.floor(w.v / NS) * M + Math.floor(w.u / NS);
    }
  }
  const tNodes = Date.now() - t0;

  // 2. priority flood from the sea (binary min-heap on filled height, ties by id)
  const filled = new Float32Array(NN), rank = new Int32Array(NN).fill(-1), seen = new Uint8Array(NN);
  const order = new Int32Array(NN);
  const hk = new Float64Array(NN), hv = new Int32Array(NN);
  let hn = 0, no = 0;
  const less = (a, b) => hk[a] < hk[b] || (hk[a] === hk[b] && hv[a] < hv[b]);
  const swap = (a, b) => { const k = hk[a]; hk[a] = hk[b]; hk[b] = k; const v = hv[a]; hv[a] = hv[b]; hv[b] = v; };
  function push(key, id) {
    let c = hn++; hk[c] = key; hv[c] = id;
    while (c > 0) { const q = (c - 1) >> 1; if (!less(c, q)) break; swap(c, q); c = q; }
  }
  function pop() {
    const id = hv[0]; hn--; hk[0] = hk[hn]; hv[0] = hv[hn];
    let c = 0;
    for (;;) {
      const l = 2 * c + 1, r = l + 1; let m = c;
      if (l < hn && less(l, m)) m = l;
      if (r < hn && less(r, m)) m = r;
      if (m === c) break; swap(c, m); c = m;
    }
    return id;
  }
  for (let id = 0; id < NN; id++) if (sea[id]) { filled[id] = SEA - 1; seen[id] = 1; push(filled[id], id); }
  while (hn) {
    const c = pop();
    rank[c] = no; order[no++] = c;
    for (let k = 0; k < 8; k++) {
      const m = nb[c * 8 + k];
      if (m < 0 || seen[m]) continue;
      seen[m] = 1; filled[m] = Math.max(e[m], filled[c] + 0.01);
      push(filled[m], m);
    }
  }
  // (a planet with no sea at all would leave nodes unranked; ours always has ocean)

  // 3. steepest descent on filled height, never crossing another diagonal
  const down = new Int32Array(NN).fill(-1);
  const dist = (a, b) => Math.acos(Math.min(1, D[a * 3] * D[b * 3] + D[a * 3 + 1] * D[b * 3 + 1] + D[a * 3 + 2] * D[b * 3 + 2])) * P.R;
  let bent = 0;
  for (let r = 0; r < no; r++) {
    const n = order[r];
    if (sea[n]) continue;
    let best = -1, bk = -1, bs = -Infinity;
    for (let k = 0; k < 8; k++) {
      const m = nb[n * 8 + k];
      if (m < 0 || rank[m] > rank[n]) continue;
      const s = (filled[n] - filled[m]) / dist(n, m);
      if (s > bs) { bs = s; best = m; bk = k; }
    }
    if (bk >= 4) {
      // the other diagonal of this 2 x 2 square runs between the two side neighbours a and b
      const a = nb[n * 8 + (DIRS[bk][0] > 0 ? 0 : 1)], b = nb[n * 8 + (DIRS[bk][1] > 0 ? 2 : 3)];
      if (down[a] === b) { best = a; bent++; } else if (down[b] === a) { best = b; bent++; }
    }
    down[n] = best;
  }

  // 4. flow, from the sources down
  const acc = new Float32Array(NN);
  for (let r = no - 1; r >= 0; r--) {
    const n = order[r];
    if (sea[n]) continue;
    acc[n] += rain[n];
    acc[down[n]] += acc[n];
  }

  // 5. water surface, from the sea up
  const rs = new Float32Array(NN);
  for (let r = 0; r < no; r++) {
    const n = order[r];
    rs[n] = sea[n] ? SEA : Math.max(p[n] - 3, rs[down[n]]);
  }

  // 6. links (one per river node, to its downstream node), in the upstream node's face grid
  const link = [];   // node ids that start a river link
  for (let n = 0; n < NN; n++) if (!sea[n] && acc[n] >= ACC_MIN) link.push(n);
  const halfWidth = (n) => Math.min(WCAP, 1 + 0.75 * Math.sqrt(acc[n]));
  const faceOf = (n) => (n / MM) | 0;
  // node m's grid position in face F's (extended) grid
  function inFace(F, m, out) {
    const g = faceOf(m);
    if (g === F) { out[0] = U[m]; out[1] = V[m]; return out; }
    const e = P.UNFOLD[F][g], A = e.A;
    out[0] = A[0] * U[m] + A[1] * V[m] + e.t[0]; out[1] = A[2] * U[m] + A[3] * V[m] + e.t[1];
    return out;
  }

  // lookup cells: every link is listed in each cell (on any face) within MARGIN of its chord
  const cells = new Map();
  const list = (f, cu, cv, li) => { const k = (f * KC + cu) * KC + cv; let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(li); };
  const B = [0, 0];
  for (let li = 0; li < link.length; li++) {
    const n = link[li], F = faceOf(n);
    inFace(F, down[n], B);
    const x0 = Math.min(U[n], B[0]) - MARGIN, x1 = Math.max(U[n], B[0]) + MARGIN;
    const y0 = Math.min(V[n], B[1]) - MARGIN, y1 = Math.max(V[n], B[1]) + MARGIN;
    const reg = (f, a0, a1, b0, b1) => {
      const c0 = Math.max(0, Math.floor(a0 / CELL)), c1 = Math.min(KC - 1, Math.floor(a1 / CELL));
      const r0 = Math.max(0, Math.floor(b0 / CELL)), r1 = Math.min(KC - 1, Math.floor(b1 / CELL));
      for (let cu = c0; cu <= c1; cu++) for (let cv = r0; cv <= r1; cv++) list(f, cu, cv, li);
    };
    reg(F, x0, x1, y0, y1);
    // the parts of the box past each edge, moved onto that neighbour's grid
    for (let s = 0; s < 4; s++) {
      if ((s === 0 && x0 >= 0) || (s === 1 && x1 < N) || (s === 2 && y0 >= 0) || (s === 3 && y1 < N)) continue;
      const e = P.EDGE[F][s], g = e.g, back = P.UNFOLD[g][F];
      const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [back.A[0] * x + back.A[1] * y + back.t[0], back.A[2] * x + back.A[3] * y + back.t[1]]);
      reg(g, Math.min(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[1])));
    }
  }

  // the meandering centre line of link li, in its own face's grid: x, y and water surface per point
  const curves = new Map();
  function curve(li) {
    let c = curves.get(li);
    if (c) return c;
    const n = link[li], F = faceOf(n), m = down[n];
    const ax = U[n], ay = V[n]; inFace(F, m, B);
    const bx = B[0], by = B[1], L = Math.hypot(bx - ax, by - ay), cnt = Math.max(2, Math.ceil(L / STEP));
    const tx = (bx - ax) / L, ty = (by - ay) / L;
    const wn = halfWidth(n), amp = Math.min(L * 0.1, 80 + wn), q = [0, 0, 0];
    const xs = new Float64Array(cnt + 1), ys = new Float64Array(cnt + 1), r = new Float32Array(cnt + 1);
    for (let k = 0; k <= cnt; k++) {
      const s = k / cnt * L, x = ax + tx * s, y = ay + ty * s;
      P.dir(F, x, y, q);
      const X = q[0] * P.R, Y = q[1] * P.R, Z = q[2] * P.R;
      const off = (nz.n3(X / 900, Y / 900, Z / 900) * 0.6 + nz.n3(X / 260 + 9, Y / 260, Z / 260) * 0.4) * amp
        * smooth(0, 260, s) * smooth(0, 260, L - s);
      xs[k] = x - ty * off; ys[k] = y + tx * off; r[k] = rs[n] + (rs[m] - rs[n]) * (k / cnt);
    }
    c = { F, xs, ys, r, w: wn, wd: halfWidth(n), x0: Math.min(ax, bx) - amp - 1, x1: Math.max(ax, bx) + amp + 1,
      y0: Math.min(ay, by) - amp - 1, y1: Math.max(ay, by) + amp + 1, views: [] };
    curves.set(li, c);
    return c;
  }
  // the same curve in face f's grid
  function view(li, f) {
    const c = curve(li);
    if (c.F === f) return c;
    let v = c.views[f];
    if (v) return v;
    const e = P.UNFOLD[f][c.F], A = e.A, xs = new Float64Array(c.xs.length), ys = new Float64Array(c.xs.length);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < xs.length; k++) {
      xs[k] = A[0] * c.xs[k] + A[1] * c.ys[k] + e.t[0]; ys[k] = A[2] * c.xs[k] + A[3] * c.ys[k] + e.t[1];
      x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k]);
    }
    v = c.views[f] = { F: f, xs, ys, r: c.r, w: c.w, x0, x1, y0, y1 };
    return v;
  }

  // Nearest river to column (f, u, v): d, w, rs, and li (link index, -1 if none within reach).
  function at(f, u, v, out) {
    out.d = Infinity; out.w = 0; out.rs = SEA; out.li = -1;
    const a = cells.get((f * KC + Math.floor(u / CELL)) * KC + Math.floor(v / CELL));
    if (!a) return out;
    let best = Infinity;
    for (const li of a) {
      const c = view(li, f), lim = REACH + c.w;
      if (u < c.x0 - lim || u > c.x1 + lim || v < c.y0 - lim || v > c.y1 + lim) continue;
      const xs = c.xs, ys = c.ys;
      let bd = Infinity, bk = 0, bt = 0;
      for (let k = 0; k + 1 < xs.length; k++) {
        const ex = xs[k + 1] - xs[k], ey = ys[k + 1] - ys[k], px = u - xs[k], py = v - ys[k];
        const t = Math.max(0, Math.min(1, (px * ex + py * ey) / (ex * ex + ey * ey)));
        const dx = px - ex * t, dy = py - ey * t, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; bk = k; bt = t; }
      }
      const dd = Math.sqrt(bd);
      if (dd - c.w < best) {
        best = dd - c.w;
        out.d = dd; out.w = c.w; out.li = li; out.rs = c.r[bk] + (c.r[bk + 1] - c.r[bk]) * bt;
      }
    }
    return out;
  }

  const stats = { nodes: NN, links: link.length, bent, ms: Date.now() - t0, nodeMs: tNodes };
  return { at, link, down, acc, rs, p, filled, rank, order, sea, U, V, D, nb, curve, view, halfWidth, inFace, faceOf, stats, M, NS };
};
})();
