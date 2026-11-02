// A true sphere made of near-cubic blocks: rows of latitude, each split into columns of longitude.
//
// Rows. The planet is C = 655,360 blocks around. Pole to pole is cut into C / 2 = 327,680 rows of latitude,
// so every row is exactly one block from south to north.
//
// Columns. A row at latitude lat is C cos(lat) blocks around, so the number of columns has to fall
// towards the poles. Rows are grouped into bands (whole chunk rows of 16), and every row in a band has the
// same number of columns, a multiple of 16. A band ends where its blocks would get more than 3% too narrow
// (EPS), and the next band starts with fewer columns. So everywhere but the last few hundred blocks round
// each pole a block is between 0.97 and 1.03 blocks wide and exactly 1 deep. Columns are radial, so a
// block's top is also 0.3% wider 320 layers up, which nobody can see.
//
// Seams. Where two bands meet, columns don't line up: the blocks on either side are offset, like a course
// of bricks. A band is several kilometres tall at mid latitudes and 40 degrees tall at the equator, so seams
// are rare; nothing else about them is special.
//
// Coordinates. Every point has three equivalent descriptions:
//   - lat, lon (radians; lon from -pi to pi, 0 at +z, east towards +x) and a layer y;
//   - a block address: row r (0 at the south pole), column c (0 at longitude 180, counting east), layer y;
//   - x, y, z in blocks in space, with the planet's centre at the origin, +y through the north pole.
// Movement (sphere-world.js) happens in real space, so walking takes exactly as long as the distance on a
// real sphere, and the block grid only says which block a point is in.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});

const C = 655360;                 // blocks around the equator
const R = C / (2 * Math.PI);      // sea-level radius, 104,301.6 blocks
const ROWS = C / 2;               // rows from pole to pole, each exactly one block tall
const CS = 16;                    // chunk size (rows and columns)
const CROWS = ROWS / CS;          // chunk rows
const SEA = 96, H = 320;
const EPS = 0.03;                 // blocks stay within 3% of one block wide
const D = Math.PI / ROWS;         // latitude per row (radians)

// Bands, built once. Northern hemisphere outward from the equator, mirrored for the south.
// band: { n: columns, k0, k1: chunk rows (in the whole-planet numbering) it covers, k1 exclusive }
const bands = [], bandOf = new Int32Array(CROWS);
{
  const half = CROWS / 2, north = [];
  let k = 0;
  while (k < half) {
    const a = k * CS * D;                                   // latitude of the band's equator-side edge
    let n = Math.max(CS, CS * Math.ceil(C * Math.cos(a) / (1 + EPS) / CS));
    let k2 = k + 1;
    // grow while the band's poleward edge is still at least 1 - EPS wide (always at least one chunk row)
    while (k2 < half && C * Math.cos(Math.min(Math.PI / 2, (k2 + 1) * CS * D)) / n >= 1 - EPS) k2++;
    if (n === CS) k2 = half;                                // the last band runs to the pole
    north.push({ n, a: k, b: k2 });
    k = k2;
  }
  // south (from the pole up to the equator), then north
  for (let i = north.length - 1; i >= 0; i--) bands.push({ n: north[i].n, k0: half - north[i].b, k1: half - north[i].a });
  for (const B of north) bands.push({ n: B.n, k0: half + B.a, k1: half + B.b });
  // the two equator bands have the same column count: join them, so there is no seam at the equator
  const s = bands.findIndex((B) => B.k1 === half);
  if (bands[s + 1] && bands[s + 1].n === bands[s].n) { bands[s].k1 = bands[s + 1].k1; bands.splice(s + 1, 1); }
  bands.forEach((B, i) => { B.i = i; for (let q = B.k0; q < B.k1; q++) bandOf[q] = i; });
}

const clampRow = (r) => Math.max(0, Math.min(ROWS - 1, r));
// columns in row r
const cols = (r) => bands[bandOf[clampRow(r) >> 4]].n;
const band = (r) => bands[bandOf[clampRow(r) >> 4]];
// latitude of a (fractional) row position: row r spans [latOf(r), latOf(r + 1))
const latOf = (r) => -Math.PI / 2 + r * D;
// longitude of a (fractional) column position in a row of n columns: column 0 starts at lon -pi
const lonOf = (c, n) => -Math.PI + (c / n) * 2 * Math.PI;
const wrapLon = (l) => l - 2 * Math.PI * Math.floor((l + Math.PI) / (2 * Math.PI));

// lat, lon -> fractional block position { r, c } (c wrapped into [0, n))
function fromLatLon(lat, lon, out = {}) {
  const r = clampRow(Math.floor((lat + Math.PI / 2) / D)), fr = (lat + Math.PI / 2) / D;
  const n = cols(r), fc = ((wrapLon(lon) + Math.PI) / (2 * Math.PI)) * n;
  out.r = Math.min(ROWS - 1e-9, Math.max(0, fr)); out.c = fc - n * Math.floor(fc / n); out.n = n;
  return out;
}
// fractional block position -> lat, lon (the block's centre for r + 0.5, c + 0.5)
function toLatLon(r, c, out = {}) {
  const n = cols(Math.floor(r));
  out.lat = latOf(r); out.lon = wrapLon(lonOf(c, n));
  return out;
}
// unit direction of lat, lon
function dir(lat, lon, out = [0, 0, 0]) {
  const cl = Math.cos(lat);
  out[0] = cl * Math.sin(lon); out[1] = Math.sin(lat); out[2] = cl * Math.cos(lon);
  return out;
}
// direction (any length) -> lat, lon
function latLonOf(x, y, z, out = {}) {
  out.lat = Math.atan2(y, Math.hypot(x, z)); out.lon = Math.atan2(x, z);
  return out;
}
// point in space (blocks from the centre) of lat, lon at layer y (sea level is layer SEA, radius R)
function xyz(lat, lon, y, out = [0, 0, 0]) {
  dir(lat, lon, out);
  const rr = R + (y - SEA);
  out[0] *= rr; out[1] *= rr; out[2] *= rr;
  return out;
}
// point in space -> lat, lon, layer
function fromXYZ(x, y, z, out = {}) {
  latLonOf(x, y, z, out);
  out.y = Math.hypot(x, y, z) - R + SEA;
  return out;
}
// block address of a point in space: { r, c, y } (integers) and the band it is in
function blockAt(x, y, z, out = {}) {
  const g = fromXYZ(x, y, z), p = fromLatLon(g.lat, g.lon);
  out.r = Math.floor(p.r); out.c = Math.floor(p.c); out.y = Math.floor(g.y); out.n = p.n;
  return out;
}
// The block next to (r, c) one row north (dr = 1) or south (dr = -1): the same column within a band, the
// column covering the same longitude across a seam. East and west are c +/- 1, wrapping round the row.
function neighbour(r, c, dr, dc, out = {}) {
  const n = cols(r);
  if (dr === 0) { out.r = r; out.c = ((c + dc) % n + n) % n; return out; }
  const r2 = clampRow(r + dr), n2 = cols(r2);
  out.r = r2;
  out.c = n2 === n ? c : Math.floor((c + 0.5) * n2 / n);
  return out;
}
// The columns of row r2 that share a border with column c of the next row r (a seam can make it several).
function overlap(r, c, r2) {
  const n = cols(r), n2 = cols(r2);
  if (n === n2) return [c, c];
  const a = Math.floor(c * n2 / n + 1e-9), b = Math.ceil((c + 1) * n2 / n - 1e-9) - 1;
  return [a, b];
}
// Great-circle distance (blocks at sea level) between two lat/lon points.
function distance(lat1, lon1, lat2, lon2) {
  const s = Math.sin((lat2 - lat1) / 2), t = Math.sin((lon2 - lon1) / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s * s + Math.cos(lat1) * Math.cos(lat2) * t * t)));
}
// Local frame at lat, lon: east, north and up unit vectors.
function frame(lat, lon) {
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return { east: [co, 0, -so], north: [-sl * so, cl, -sl * co], up: [cl * so, sl, cl * co] };
}
// Real size of block (r, c) at sea level: width (east-west, at its middle row) and depth (always 1).
function blockSize(r) {
  return { w: C * Math.cos(latOf(r + 0.5)) / cols(r), d: 1 };
}

BF.sphere = { C, R, ROWS, CS, CROWS, SEA, H, EPS, D, bands, bandOf, cols, band, latOf, lonOf, wrapLon,
  fromLatLon, toLatLon, dir, latLonOf, xyz, fromXYZ, blockAt, neighbour, overlap, distance, frame, blockSize };
})();
