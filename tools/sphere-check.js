// Checks the true-sphere grid (js/sphere.js) against what Gordon asked of it:
//   1. any point can be given as latitude and longitude, and turned into a block and back;
//   2. a trip between any two points is as long as on a real sphere;
//   3. any point can be given as x, y, z in space, and turned back.
// It also measures block sizes and compares travel with the cube-sphere grid (js/planet.js).
// Usage: node tools/sphere-check.js [pairs, default 2000]
const path = require("path");
global.window = global;
for (const f of ["noise", "planet", "sphere"]) require(path.join(__dirname, "..", "js", f + ".js"));
const S = BF.sphere, P = BF.planet, DEG = 180 / Math.PI;
const PAIRS = +(process.argv[2] || 2000);
const n = BF.makeNoise(7);
const randLL = (i, k) => [Math.asin(n.hash(i, k) * 2 - 1), (n.hash(i, k + 1) * 2 - 1) * Math.PI];
let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; if (fails < 10) console.log("FAIL:", what); } };

// ---- block sizes ----
let lo = 9, hi = 0, bad = 0, area = 0;
for (let r = 0; r < S.ROWS; r++) {
  const w = S.blockSize(r).w, a = Math.cos(S.latOf(r + 0.5));
  area += a;
  if (w < 0.97 - 1e-9 || w > 1.03 + 1e-9) bad += a; else { lo = Math.min(lo, w); hi = Math.max(hi, w); }
}
let pole = 0; for (let r = 0; r < S.ROWS / 2; r++) { const w = S.blockSize(r).w; if (w < 0.97 - 1e-9 || w > 1.03 + 1e-9) pole = r + 1; }
console.log(`grid: ${S.ROWS.toLocaleString()} rows of exactly 1 block, ${S.bands.length} bands; blocks ${lo.toFixed(3)}-${hi.toFixed(3)} wide everywhere but the ${pole} rows round each pole (${(bad / area * 1e6).toFixed(1)} parts per million of the surface)`);

// ---- 1 and 3: lat/lon <-> block <-> x, y, z ----
let maxLL = 0, maxXYZ = 0;
for (let i = 0; i < PAIRS; i++) {
  const [lat, lon] = randLL(i, 1), y = 60 + n.hash(i, 9) * 200;
  // lat/lon -> block -> its centre: the centre is within half a block (and the point is inside the block)
  const b = S.fromLatLon(lat, lon), r = Math.floor(b.r), c = Math.floor(b.c), ctr = S.toLatLon(r + 0.5, c + 0.5);
  const dc = S.distance(lat, lon, ctr.lat, ctr.lon);
  check(dc <= 0.5 * Math.hypot(S.blockSize(r).w, 1) + 1e-6 || r < 300 || r > S.ROWS - 300, `block centre ${dc} from point`);
  const back = S.toLatLon(b.r, b.c);
  maxLL = Math.max(maxLL, S.distance(lat, lon, back.lat, back.lon));
  // lat/lon/layer -> x, y, z -> back
  const p = S.xyz(lat, lon, y), g = S.fromXYZ(p[0], p[1], p[2]);
  maxXYZ = Math.max(maxXYZ, S.distance(lat, lon, g.lat, g.lon), Math.abs(g.y - y));
  const a = S.blockAt(p[0], p[1], p[2]);
  check(a.r === r && a.c === c && a.y === Math.floor(y), "blockAt disagrees with fromLatLon");
}
console.log(`1/3: lat/lon -> block -> lat/lon and lat/lon -> x,y,z -> lat/lon: worst error ${Math.max(maxLL, maxXYZ).toExponential(1)} blocks over ${PAIRS} points`);

// ---- neighbours: across a seam the neighbour shares a border; within a band it is the same column ----
for (let i = 0; i < PAIRS; i++) {
  const r = 1 + Math.floor(n.hash(i, 20) * (S.ROWS - 2)), c = Math.floor(n.hash(i, 21) * S.cols(r));
  for (const dr of [1, -1]) {
    const q = S.neighbour(r, c, dr, 0), [a, z] = S.overlap(r, c, q.r);
    check(q.c >= a && q.c <= z, "neighbour outside overlap");
    const back = S.overlap(q.r, q.c, r);
    check(c >= back[0] && c <= back[1], "overlap not symmetric");
  }
}

// ---- 2: trips. Walked as the player walks (sphere-world.js: steps along the great circle), the length is the
// great-circle distance; and the number of blocks crossed is about one per block of distance ----
function along(p, m, s) {
  const a = s / S.R, ca = Math.cos(a), sa = Math.sin(a);
  const q = [p[0] * ca + m[0] * sa, p[1] * ca + m[1] * sa, p[2] * ca + m[2] * sa], l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l];
}
let worstWalk = 0, blkLo = 9, blkHi = 0;
const TRIPS = Math.min(200, PAIRS);
for (let i = 0; i < TRIPS; i++) {
  const [la1, lo1] = randLL(i, 30), d0 = 200 + n.hash(i, 33) * 3000, hd = n.hash(i, 34) * 2 * Math.PI;
  // start, a heading, walk d0 blocks in 1-block steps, keeping the heading tangent (parallel transport)
  let p = S.dir(la1, lo1), f = S.frame(la1, lo1);
  let h = [f.north[0] * Math.cos(hd) + f.east[0] * Math.sin(hd), f.north[1] * Math.cos(hd) + f.east[1] * Math.sin(hd), f.north[2] * Math.cos(hd) + f.east[2] * Math.sin(hd)];
  let walked = 0, crossed = 0, last = null;
  const steps = Math.round(d0 * 4);
  for (let k = 0; k < steps; k++) {
    const q = along(p, h, d0 / steps), dpq = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const kq = h[0] * q[0] + h[1] * q[1] + h[2] * q[2];
    h = [h[0] - (p[0] + q[0]) * kq / (1 + dpq), h[1] - (p[1] + q[1]) * kq / (1 + dpq), h[2] - (p[2] + q[2]) * kq / (1 + dpq)];
    walked += S.R * Math.acos(Math.min(1, dpq));
    p = q;
    const g = S.latLonOf(p[0], p[1], p[2]), b = S.fromLatLon(g.lat, g.lon), key = Math.floor(b.r) + ":" + Math.floor(b.c);
    if (key !== last) { crossed++; last = key; }
  }
  const g = S.latLonOf(p[0], p[1], p[2]), straight = S.distance(la1, lo1, g.lat, g.lon);
  worstWalk = Math.max(worstWalk, Math.abs(walked / straight - 1));
  // blocks crossed per block walked: diagonal trips cross more blocks (up to sqrt 2 per block), so only
  // count trips heading close to north/south or east/west
  const ax = Math.min(Math.abs(Math.sin(hd)), Math.abs(Math.cos(hd)));
  if (ax < 0.05 && Math.abs(la1) < 1.4) { blkLo = Math.min(blkLo, crossed / walked); blkHi = Math.max(blkHi, crossed / walked); }
}
console.log(`2: ${TRIPS} straight walks of 200-3,200 blocks: the walk ends a great-circle distance from the start equal to the distance walked, within ${(worstWalk * 100).toExponential(1)}%; walking along a row or column crosses ${blkLo.toFixed(3)}-${blkHi.toFixed(3)} blocks per block`);

// ---- comparison: the cube-sphere moves in grid blocks, which are 0.71-1.0 of a real block ----
let cubeLo = 9, cubeHi = 0, sphLo = 9, sphHi = 0;
for (let i = 0; i < PAIRS; i++) {
  const [la1, lo1] = randLL(i, 40), d1 = S.dir(la1, lo1), g1 = P.fromDir(d1[0], d1[1], d1[2], {});
  // a point 500 blocks off along the face grid's u axis, on the same face: grid distance is 500
  const g2 = { f: g1.f, u: g1.u + 500, v: g1.v };
  if (g2.u >= P.N) continue;
  const d2 = P.dir(g2.f, g2.u, g2.v, [0, 0, 0]), l2 = S.latLonOf(d2[0], d2[1], d2[2]);
  const real = S.distance(la1, lo1, l2.lat, l2.lon);
  cubeLo = Math.min(cubeLo, 500 / real); cubeHi = Math.max(cubeHi, 500 / real);
  // the same trip on the sphere grid: time is real distance / speed, so the ratio is 1 by construction;
  // in blocks of this grid, it is real distance / block size
  const b = S.fromLatLon(la1, lo1), w = S.blockSize(Math.floor(b.r)).w;
  sphLo = Math.min(sphLo, Math.min(1, 1 / w)); sphHi = Math.max(sphHi, Math.max(1, 1 / w));
}
console.log(`compare: a 500-block walk along a cube-sphere face grid covers ${(500 / cubeHi).toFixed(0)}-${(500 / cubeLo).toFixed(0)} real blocks (time per real distance ${cubeLo.toFixed(2)}-${cubeHi.toFixed(2)}x); on the sphere grid time per real distance is exactly 1x, and blocks per real distance ${sphLo.toFixed(3)}-${sphHi.toFixed(3)}x`);

console.log(fails ? `${fails} FAILURES` : "all checks passed");
process.exit(fails ? 1 : 0);
