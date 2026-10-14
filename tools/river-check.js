// Checks a seed's rivers, on the network and on the generated blocks.
// Usage: node tools/river-check.js [seed] [rivers to walk, default 300]
//
// Network (every node): each land node reaches the sea without loops; the water surface never rises
// from a node to the one it drains into; no two river links cross.
// Blocks (the longest rivers, walked from source to sea every 4 blocks along the meandering centre line):
//  - "rises": the water layer at the centre line is higher than somewhere upstream of it (must be 0);
//  - "dry": a centre-line column with no water;
//  - "spills": across the river (every 64 blocks), a water column next to a dry column whose ground is below the water
//    (water standing against air).
const path = require("path");
global.window = global;
for (const f of ["noise", "planet", "climate", "rivers", "terrain"]) require(path.join(__dirname, "..", "js", f + ".js"));
const seed = +(process.argv[2] || 1), WALK = +(process.argv[3] || 300);
const P = BF.planet, T = BF.makeTerrain(seed), RV = T.rivers();
const { link, down, sea, rs, U, V } = RV, NN = sea.length;
const t0 = Date.now();

// ---- network ----
let loops = 0, uphill = 0, maxSteps = 0;
for (let n = 0; n < NN; n++) {
  if (sea[n]) continue;
  let m = n, k = 0;
  while (!sea[m] && k <= NN) { if (rs[down[m]] > rs[m] + 1e-4) uphill++; m = down[m]; k++; }
  if (k > NN) loops++;
  maxSteps = Math.max(maxSteps, k);
}
// crossings: chords of links on the same face (moved into one grid), sharing no node
const A = [0, 0], B = [0, 0], C = [0, 0], D = [0, 0];
const cross = (a, b, c, d) => {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
let crossings = 0;
const byCell = new Map();
for (const n of link) { const f = RV.faceOf(n), k = f * 1e6 + Math.floor(U[n] / 4096) * 1000 + Math.floor(V[n] / 4096); (byCell.get(k) || byCell.set(k, []).get(k)).push(n); }
for (const n of link) {
  const f = RV.faceOf(n);
  RV.inFace(f, n, A); RV.inFace(f, down[n], B);
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) {
    const a = byCell.get(f * 1e6 + (Math.floor(U[n] / 4096) + du) * 1000 + Math.floor(V[n] / 4096) + dv);
    if (a) for (const m of a) {
      if (m <= n || m === down[n] || down[m] === n || down[m] === down[n]) continue;
      RV.inFace(f, m, C); RV.inFace(f, down[m], D);
      if (cross(A, B, C, D)) crossings++;
    }
  }
}
console.log(`seed ${seed}: ${link.length} river links; network: ${loops} loops, ${uphill} uphill steps, ${crossings} crossings; longest path to sea ${maxSteps} nodes`);

// ---- blocks ----
// sources = river nodes nothing flows into; walk the ones with the longest way to the sea
const fed = new Uint8Array(NN), isRiver = new Uint8Array(NN), li = new Int32Array(NN).fill(-1);
link.forEach((n, i) => { isRiver[n] = 1; li[n] = i; fed[down[n]] = 1; });
const sources = link.filter((n) => !fed[n]).map((n) => { let k = 0, m = n; while (isRiver[m]) { m = down[m]; k++; } return [n, k]; });
sources.sort((a, b) => b[1] - a[1]);
const w = {}, d = [0, 0, 0];
function surf(F, x, y) {
  P.wrap(F, x, y, w);
  const f = w.f, u = Math.floor(w.u), v = Math.floor(w.v);
  P.dir(f, u + 0.5, v + 0.5, d);
  return T.surface(f, u, v, d);
}
let cols = 0, rises = 0, dry = 0, spills = 0, worst = 0, walked = 0, sections = 0;
const seen = new Uint8Array(NN);
for (const [src] of sources.slice(0, WALK)) {
  let prev = Infinity, m = src;
  walked++;
  while (isRiver[m]) {
    const c = RV.curve(li[m]);
    for (let k = 0; k < c.xs.length - 1; k++) for (let s = 0; s < 4; s++) {
      const t = s / 4, x = c.xs[k] + (c.xs[k + 1] - c.xs[k]) * t, y = c.ys[k] + (c.ys[k + 1] - c.ys[k]) * t;
      const S = surf(c.F, x, y), wl = S.wl;
      cols++;
      if (wl <= S.h) dry++;
      if (wl > prev) { rises++; worst = Math.max(worst, wl - prev); }
      prev = Math.min(prev, wl);
    }
    // cross-sections every 64 blocks along the link (once per link)
    if (!seen[m]) {
      seen[m] = 1;
      for (let k = 2; k < c.xs.length - 1; k += 4) {
        const tx = c.xs[k + 1] - c.xs[k], ty = c.ys[k + 1] - c.ys[k], l = Math.hypot(tx, ty);
        const nx = -ty / l, ny = tx / l, reach = Math.ceil(c.w) + 8;
        let last = null;
        sections++;
        for (let o = -reach; o <= reach; o++) {
          const S = surf(c.F, c.xs[k] + nx * o, c.ys[k] + ny * o), cur = { h: S.h, wl: S.wl };
          if (last && ((last.wl > last.h && cur.wl <= cur.h && cur.h < last.wl) || (cur.wl > cur.h && last.wl <= last.h && last.h < cur.wl))) spills++;
          last = cur;
        }
      }
    }
    m = down[m];
  }
}
console.log(`blocks: walked ${walked} rivers source to sea, ${cols} centre-line columns: ${rises} rises (worst ${worst}), ${dry} dry; ${spills} spills in ${sections} cross-sections (one every 64 blocks); ${Date.now() - t0} ms`);
