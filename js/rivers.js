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
//  5. Each link is a smooth curve through the nodes (no corners where links meet), with meanders from 3D
//     noise at its world position, so the curve is the same whichever face it is looked at from.
//  6. Water surface, worked from the sources down: it sits just below the lowest nearby ground and never
//     rises, so a river fits into the land and cuts through any rise in its way instead of being built up
//     above it.
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
const DROP = 1.5;                     // water surface this far below the lower bank
const FLAT = 250;                     // blocks before a junction where the water is level with it
const REACH = 150;                    // how far from the water a river shapes its valley
const CELL = 512, KC = N / CELL;      // lookup cells per face edge
const MARGIN = REACH + WCAP + 110;    // a link is listed in every cell within this of its chord
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

BF.rivers = { M, NS, ACC_MIN, WCAP, REACH };

// sample(x, y, z) -> { e (routing height), hf (ground), land, rain, elat } for a unit direction;
// ground(x, y, z) -> ground height (hf) alone, for the many samples along each river
BF.makeRivers = function (seed, sample, ground) {
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

  // 5. links (one per river node, to its downstream node); main[m] is the biggest river flowing into m
  const link = [];   // node ids that start a river link
  for (let n = 0; n < NN; n++) if (!sea[n] && acc[n] >= ACC_MIN) link.push(n);
  link.sort((a, b) => rank[b] - rank[a]);   // sources before the rivers they feed
  const main = new Int32Array(NN).fill(-1);
  for (const n of link) { const m = down[n]; if (main[m] < 0 || acc[n] > acc[main[m]]) main[m] = n; }
  const halfWidth = (n) => Math.min(WCAP, 1 + 0.75 * Math.sqrt(acc[n]));
  const faceOf = (n) => (n / MM) | 0;
  // node m's grid position in face F's (extended) grid; false if m's face doesn't border F
  function inFace(F, m, out) {
    const g = faceOf(m);
    if (g === F) { out[0] = U[m]; out[1] = V[m]; return out; }
    const e = P.UNFOLD[F][g];
    if (!e) return false;
    const A = e.A;
    out[0] = A[0] * U[m] + A[1] * V[m] + e.t[0]; out[1] = A[2] * U[m] + A[3] * V[m] + e.t[1];
    return out;
  }

  // 6. each link's centre line: a smooth curve through the nodes (cubic Hermite, tangent at each node
  // pointing from the river above it to the river below, so a river bends gradually through a node instead
  // of turning a corner there), plus meanders from 3D noise at the world position, tapered to nothing at
  // the nodes so that every link through a node meets it on the same line.
  const curves = new Array(link.length);
  const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const A = [0, 0], B = [0, 0], C = [0, 0], q = [0, 0, 0];
  // level 0: curved and meandering; 1: curved, no meanders; 2: straight (used where rivers would touch)
  function build(li, level) {
    const n = link[li], F = faceOf(n), m = down[n];
    A[0] = U[n]; A[1] = V[n]; inFace(F, m, B);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ch = unit(B[0] - A[0], B[1] - A[1]);
    // tangent leaving n: along (m - the main river above n)
    let ta = ch, tb = ch;
    if (main[n] >= 0 && inFace(F, main[n], C)) ta = unit(B[0] - C[0], B[1] - C[1]);
    // tangent arriving at m: along the main river through m; a side river joins at a slant, half way
    // between its own direction and the main river's
    if (!sea[m] && main[m] >= 0) {
      const D2 = [0, 0];
      if (inFace(F, down[m], D2) && inFace(F, main[m], C)) {
        const tm = unit(D2[0] - C[0], D2[1] - C[1]);
        tb = main[m] === n ? tm : unit(tm[0] + ch[0], tm[1] + ch[1]);
      }
    }
    // never let a tangent point back across the link (that would loop)
    if (ta[0] * ch[0] + ta[1] * ch[1] < 0.3) ta = unit(ta[0] + 2 * ch[0], ta[1] + 2 * ch[1]);
    if (tb[0] * ch[0] + tb[1] * ch[1] < 0.3) tb = unit(tb[0] + 2 * ch[0], tb[1] + 2 * ch[1]);
    if (level >= 2) { ta = ch; tb = ch; }
    const wn = halfWidth(n), amp = level >= 1 ? 0 : Math.min(L * 0.1, 80 + wn), cnt = Math.max(2, Math.ceil(L / STEP));
    const xs = new Float64Array(cnt + 1), ys = new Float64Array(cnt + 1);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k <= cnt; k++) {
      const t = k / cnt, t2 = t * t, t3 = t2 * t, s = t * L;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      const d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d01 = -6 * t2 + 6 * t, d11 = 3 * t2 - 2 * t;
      const x = h00 * A[0] + h10 * L * ta[0] + h01 * B[0] + h11 * L * tb[0];
      const y = h00 * A[1] + h10 * L * ta[1] + h01 * B[1] + h11 * L * tb[1];
      const tg = unit(d00 * A[0] + d10 * L * ta[0] + d01 * B[0] + d11 * L * tb[0], d00 * A[1] + d10 * L * ta[1] + d01 * B[1] + d11 * L * tb[1]);
      P.dir(F, x, y, q);
      const X = q[0] * P.R, Y = q[1] * P.R, Z = q[2] * P.R;
      const off = amp && (nz.n3(X / 900, Y / 900, Z / 900) * 0.6 + nz.n3(X / 260 + 9, Y / 260, Z / 260) * 0.4) * amp
        * smooth(0, 260, s) * smooth(0, 260, L - s);
      xs[k] = x - tg[1] * off; ys[k] = y + tg[0] * off;
      x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); y0 = Math.min(y0, ys[k]); y1 = Math.max(y1, ys[k]);
    }
    curves[li] = { F, xs, ys, r: null, w: wn, L, x0, x1, y0, y1, views: [], level };
  }
  for (let li = 0; li < link.length; li++) build(li, 0);
  // Rivers that don't meet must not touch: where two curves on one face come within their widths plus a
  // gap, both lose their meanders, then their curvature. (Their straight chords never cross.)
  const linkOf = new Int32Array(NN).fill(-1);
  link.forEach((n, li) => { linkOf[n] = li; });
  const meets = (a, b) => { const na = link[a], nb2 = link[b]; return down[na] === nb2 || down[nb2] === na || down[na] === down[nb2]; };
  let straightened = 0;
  for (let pass = 0; pass < 3; pass++) {
    const SC = 128, grid = new Map(), hit = new Set();
    curves.forEach((c, li) => {
      for (let k = 0; k < c.xs.length; k++) {
        const key = (c.F * 4096 + Math.floor(c.xs[k] / SC)) * 4096 + Math.floor(c.ys[k] / SC);
        let a = grid.get(key); if (!a) grid.set(key, (a = [])); if (a[a.length - 1] !== li) a.push(li);
      }
    });
    curves.forEach((c, li) => {
      for (let k = 0; k < c.xs.length; k++) {
        const cx = Math.floor(c.xs[k] / SC), cy = Math.floor(c.ys[k] / SC);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const a = grid.get((c.F * 4096 + cx + dx) * 4096 + cy + dy);
          if (a) for (const lj of a) {
            if (lj <= li || meets(li, lj) || (hit.has(li) && hit.has(lj))) continue;
            const o = curves[lj], gap = c.w + o.w + 8;
            for (let j = 0; j < o.xs.length; j++) {
              if (Math.abs(o.xs[j] - c.xs[k]) < gap && Math.abs(o.ys[j] - c.ys[k]) < gap && Math.hypot(o.xs[j] - c.xs[k], o.ys[j] - c.ys[k]) < gap) {
                hit.add(li); hit.add(lj); break;
              }
            }
          }
        }
      }
    });
    if (!hit.size) break;
    for (const li of hit) if (curves[li].level < 2) { build(li, curves[li].level + 1); straightened++; }
  }

  // 7. water surface. The river fits the land: along each curve the water sits DROP below the lowest of the
  // ground at the centre line and just outside both banks, and where the ground ahead rises (a rise between
  // two dips) the river keeps the lower level and cuts through it, never being built up above the land.
  // Worked from the sources down, so a river never rises: rsN at a node is the lowest level any river
  // reaching it carries, and along a link
  //   rs = max(rsN at its end, min(rsN at its start, lowest ground so far - DROP, a gentle ramp to the end)),
  // level with the end for the last FLAT blocks, so where rivers join, their water meets at one level.
  // The network pass reads the ground every 64 blocks along each centre line (with SLACK to spare for what
  // lies between); the full profile, every 16 blocks and both banks, is read when a link is first used.
  const SLACK = 3;
  const rsN = new Float32Array(NN), w3 = {}, d3 = [0, 0, 0];
  for (let n = 0; n < NN; n++) rsN[n] = sea[n] ? SEA : Math.max(SEA, p[n] - DROP - SLACK);
  const groundAt = (F, x, y) => { P.wrap(F, x, y, w3); P.dir(w3.f, w3.u, w3.v, d3); return ground(d3[0], d3[1], d3[2]); };
  const low = new Float32Array(NN).fill(Infinity);
  for (let li = 0; li < link.length; li++) {
    const n = link[li], c = curves[li], cnt = c.xs.length - 1;
    for (let k = 2; k < cnt; k += 4) low[n] = Math.min(low[n], groundAt(c.F, c.xs[k], c.ys[k]) - DROP - SLACK);
  }
  for (let r = no - 1; r >= 0; r--) {
    const n = order[r], m = down[n];
    if (!sea[n] && !sea[m]) rsN[m] = Math.max(SEA, Math.min(rsN[m], rsN[n], low[n]));
  }
  const rs = rsN;
  // links into each node
  const into = new Map();
  link.forEach((n, li) => { const m = down[n]; if (!into.has(m)) into.set(m, []); into.get(m).push(li); });
  function profile(li) {
    const n = link[li], m = down[n], c = curves[li], xs = c.xs, ys = c.ys, cnt = xs.length - 1, off = c.w + 2;
    const r = new Float32Array(cnt + 1);
    // two rivers heading for the same junction can run side by side before they get there; from where
    // their channels first touch, the water is already at the junction's level
    let joined = cnt + 1;
    for (const lj of into.get(m)) {
      if (lj === li) continue;
      const o = curves[lj], gap = c.w + o.w + 2;
      for (let k = 0; k < joined; k++) {
        let near = false;
        for (let j = 0; j < o.xs.length && !near; j++) near = Math.abs(o.xs[j] - xs[k]) < gap && Math.abs(o.ys[j] - ys[k]) < gap && Math.hypot(o.xs[j] - xs[k], o.ys[j] - ys[k]) < gap;
        if (near) { joined = k; break; }
      }
    }
    let run = rsN[n];
    for (let k = 0; k <= cnt; k++) {
      if (k >= joined) { r[k] = rsN[m]; continue; }
      const k0 = Math.max(0, k - 1), k1 = Math.min(cnt, k + 1), tg = unit(xs[k1] - xs[k0], ys[k1] - ys[k0]);
      const g = Math.min(groundAt(c.F, xs[k], ys[k]), groundAt(c.F, xs[k] - tg[1] * off, ys[k] + tg[0] * off),
        groundAt(c.F, xs[k] + tg[1] * off, ys[k] - tg[0] * off));
      run = Math.min(run, g - DROP);
      // the last FLAT blocks before a node sit at the node's level, so rivers that join there run level
      r[k] = Math.max(rsN[m], Math.min(run, rsN[m] + Math.max(0, (1 - k / cnt) * c.L - FLAT) * 0.03));
    }
    r[0] = rsN[n]; r[cnt] = rsN[m];
    c.r = r;
  }
  // geom(li): the curve alone; curve(li): with its water surface
  const geom = (li) => curves[li];
  const curve = (li) => { if (!curves[li].r) profile(li); return curves[li]; };

  // lookup cells: every link is listed in each cell (on any face) within MARGIN of its curve
  const cells = new Map();
  const list = (f, cu, cv, li) => { const k = (f * KC + cu) * KC + cv; let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(li); };
  for (let li = 0; li < link.length; li++) {
    const c = curves[li], F = c.F;
    const x0 = c.x0 - MARGIN, x1 = c.x1 + MARGIN, y0 = c.y0 - MARGIN, y1 = c.y1 + MARGIN;
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
      // nearest river, except that inside two channels at once (where rivers join) the lower water wins
      const dd = Math.sqrt(bd), r = c.r[bk] + (c.r[bk + 1] - c.r[bk]) * bt, e = dd - c.w;
      if (e < 0 && best < 0 ? r < out.rs : e < best) {
        best = Math.min(best, e);
        out.d = dd; out.w = c.w; out.li = li; out.rs = r;
      }
    }
    return out;
  }

  const stats = { nodes: NN, links: link.length, bent, straightened, ms: Date.now() - t0, nodeMs: tNodes };
  return { at, geom, link, down, main, acc, rs, p, filled, rank, order, sea, U, V, D, nb, curve, view, halfWidth, inFace, faceOf, stats, M, NS };
};
})();
