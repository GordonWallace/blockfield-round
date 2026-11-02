// Band atlas coordinates: the design r16-s01 specifies for porting Blockfield to the true sphere, tried here on
// the prototype's grid (sphere.js) so the maths is checked before the port (tools/sphere-check.js).
//
// Blockfield keeps its whole simulation on one flat x/z plane. 1.4 gave each cube face its own region of that
// plane; this gives each band one. Band b owns x in [X[b], X[b] + 3 n): the middle third is the band itself
// (column c = x - X[b] - n), the thirds either side are the same row continuing round the planet. Its rows are
// its own plus a margin of M rows north and south, read at this band's column scale. Atlas z counts rows from
// the north pole, so north is -z, as Blockfield's yaw convention needs.
(() => {
"use strict";
const BF = (globalThis.BF = globalThis.BF || {});
const S = BF.sphere, CS = S.CS, ROWS = S.ROWS, M = 4096, GAP = 64;

// sphere row (from the south pole) <-> atlas z (from the north pole): cell z is row ROWS - 1 - z, and a continuous
// z is ROWS minus the continuous row, so latitude is latOf(ROWS - z)
const zOf = (row) => ROWS - 1 - row, rowOf = (z) => ROWS - 1 - z;
// a band's atlas z range (its own rows): z0 inclusive, z1 exclusive
const bands = S.bands.map((B) => ({ n: B.n, z0: ROWS - B.k1 * CS, z1: ROWS - B.k0 * CS, X: 0 }));
let X = 0;
for (const B of bands) { B.X = X; X += 3 * B.n + GAP; }
const SPAN = X;
// x -> band: one entry per 64 columns of x (a table, since canon sits on hot paths)
const xTab = new Int16Array(Math.ceil(SPAN / 64));
bands.forEach((B, i) => { for (let k = Math.floor(B.X / 64); k < Math.ceil((B.X + 3 * B.n + GAP) / 64); k++) xTab[k] = i; });
const bandAtZ = (z) => S.bandOf[rowOf(Math.max(0, Math.min(ROWS - 1, Math.floor(z)))) >> 4];
function bandOfX(x) {
  let i = xTab[Math.max(0, Math.min(xTab.length - 1, Math.floor(x / 64)))];
  if (x < bands[i].X && i > 0) i--;   // a 64-column cell straddling two bands
  return i;
}

// band b, column c (fractional), atlas z -> atlas point
const atlas = (b, c, z, out = {}) => { out.x = bands[b].X + bands[b].n + c; out.z = z; return out; };
// The canonical point an atlas point shows: { x, z, b, c, off }. East-west the column wraps round the row;
// past the band's own rows the column is rescaled to the band that owns the row (no turn: north stays north).
function canon(x, z, out = {}) {
  const b = bandOfX(x), B = bands[b];
  out.off = z < 0 || z >= ROWS;
  if (out.off) { out.x = x; out.z = z; out.b = b; out.c = 0; return out; }
  let c = x - B.X - B.n;
  let b2 = b;
  if (z < B.z0 || z >= B.z1) { b2 = bandAtZ(z); c = c * bands[b2].n / B.n; }
  const n2 = bands[b2].n;
  c = c - n2 * Math.floor(c / n2);
  out.b = b2; out.c = c; out.z = z; out.x = bands[b2].X + n2 + c;
  return out;
}
// integer cell: the canonical cell whose block a margin cell shows (mapped by its centre)
function canonCell(x, z, out = {}) {
  canon(Math.floor(x) + 0.5, Math.floor(z) + 0.5, out);
  out.x = Math.floor(out.x); out.z = Math.floor(out.z); out.c = Math.floor(out.c);
  return out;
}
// point p expressed in band F's frame (column rescaled, east-west position within half a lap of the frame's middle)
function inFrame(F, x, z, out = {}) {
  const q = canon(x, z), BF_ = bands[F];
  let c = q.c * BF_.n / bands[q.b].n;
  const mid = BF_.n / 2;
  c -= BF_.n * Math.round((c - mid) / BF_.n);
  out.x = BF_.X + BF_.n + c; out.z = z;
  return out;
}
// real width (blocks) of a column at atlas point (x, z): the frame band's n at that row's latitude
function blockWidth(x, z) {
  const B = bands[bandOfX(x)], lat = S.latOf(ROWS - z);
  return Math.max(0.05, S.C * Math.cos(lat) / B.n);
}
// a velocity in real blocks per second -> grid units (columns and rows per second); north is -z
function toGridVel(x, z, vxReal, vzReal, out = {}) {
  out.x = vxReal / blockWidth(x, z); out.z = vzReal;
  return out;
}
// lat/lon of an atlas point, and the canonical atlas point of a lat/lon
function latLonAt(x, z, out = {}) {
  const q = canon(x, z);
  out.lat = S.latOf(ROWS - q.z); out.lon = S.wrapLon(S.lonOf(q.c, bands[q.b].n));
  return out;
}
function atlasOfLatLon(lat, lon, out = {}) {
  const p = S.fromLatLon(lat, lon), z = ROWS - p.r, b = bandAtZ(z);
  return atlas(b, p.c, z, out);
}
// distance (blocks): within a frame up to 4,096 blocks, hypot(dx w, dz); beyond, the great circle
function distance(a, b) {
  const F = bandOfX(a.x), q = inFrame(F, b.x, b.z), dz = q.z - a.z, dx = q.x - a.x;
  const w = blockWidth(a.x, (a.z + q.z) / 2), d = Math.hypot(dx * w, dz);
  if (d <= 4096) return d;
  const p = latLonAt(a.x, a.z), r = latLonAt(b.x, b.z);
  return S.distance(p.lat, p.lon, r.lat, r.lon);
}
// a straight walk (great circle) turns, in grid terms, by sin(lat) times the change of longitude. Blockfield's yaw
// is minus the compass bearing (forward = (-sin yaw, -cos yaw), north = -z), and a great circle's bearing grows by
// sin(lat) dlon, so the yaw falls by it
function carryYaw(x, z, dxCols, yaw) {
  const B = bands[bandOfX(x)], lat = S.latOf(ROWS - z);
  return yaw - Math.sin(lat) * dxCols * 2 * Math.PI / B.n;
}

BF.sphereAtlas = { M, SPAN, bands, zOf, rowOf, bandOfX, bandAtZ, atlas, canon, canonCell, inFrame, blockWidth, toGridVel,
  latLonAt, atlasOfLatLon, distance, carryYaw };
})();
