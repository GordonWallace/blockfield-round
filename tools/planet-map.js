// Renders an equirectangular map of a planet seed to a PNG (biome colours, climate band edges as faint
// lines, rivers in blue) and prints land, biome and river statistics.
// Usage: node tools/planet-map.js [seed] [out.png] [width] [lat lon span]
// With lat lon span (degrees) it draws only that window: span degrees of longitude, half that of latitude.
const fs = require("fs"), zlib = require("zlib"), path = require("path");
global.window = global;
for (const f of ["noise", "planet", "climate", "rivers", "terrain"]) require(path.join(__dirname, "..", "js", f + ".js"));
const seed = +(process.argv[2] || 1), out = process.argv[3] || "planet-" + seed + ".png", W = +(process.argv[4] || 720), H = W / 2;
const T = BF.makeTerrain(seed), P = BF.planet, B = BF.B;
const zoom = process.argv[7] !== undefined ? { lat: +process.argv[5], lon: +process.argv[6], span: +process.argv[7] } : null;
const DEG = Math.PI / 180;
// pixel row/column to latitude/longitude (radians) and back
const latOf = (j) => zoom ? (zoom.lat + zoom.span / 2 * (1 - 2 * (j + 0.5) / H)) * DEG : (0.5 - (j + 0.5) / H) * Math.PI;
const lonOf = (i) => zoom ? (zoom.lon + zoom.span * ((i + 0.5) / W - 0.5)) * DEG : ((i + 0.5) / W - 0.5) * 2 * Math.PI;
const pixOf = (lat, lon) => zoom
  ? [((lon / DEG - zoom.lon) / zoom.span + 0.5) * W - 0.5, (1 - (lat / DEG - zoom.lat) / (zoom.span / 2)) * H / 2 - 0.5]
  : [(lon / (2 * Math.PI) + 0.5) * W - 0.5, (0.5 - lat / Math.PI) * H - 0.5];
const img = Buffer.alloc((W * 3 + 1) * H);
let prevRow = [];
let land = 0, total = 0, maxH = 0;
const byBiome = {}, byBand = [0, 0, 0, 0, 0], bandRow = [];
const t0 = Date.now();
for (let j = 0; j < H; j++) {
  const lat = latOf(j);
  img[j * (W * 3 + 1)] = 0;
  bandRow.length = 0;
  for (let i = 0; i < W; i++) {
    const lon = lonOf(i);
    const x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
    const s = T.sample(x, y, z, false);
    const w = Math.cos(lat); total += w;
    let c = BF.climate.mapColour(s);
    if (s.h >= P.SEA) {
      land += w; maxH = Math.max(maxH, s.h);
      const nm = BF.climate.NAMES[s.biome]; byBiome[nm] = (byBiome[nm] || 0) + w; byBand[s.band] += w;
      const e = Math.min(1, (s.h - P.SEA) / 250); c = c.map((v) => v * (0.85 + 0.3 * e));
    }
    bandRow.push(s.band);
    const o = j * (W * 3 + 1) + 1 + i * 3;
    img[o] = Math.min(255, c[0] * 255); img[o + 1] = Math.min(255, c[1] * 255); img[o + 2] = Math.min(255, c[2] * 255);
  }
  // darken pixels where the climate band changes along the row or from the row above, so band edges show
  for (let i = 0; i < W; i++) {
    const o = j * (W * 3 + 1) + 1 + i * 3, up = j > 0 ? prevRow[i] : bandRow[i];
    if ((i > 0 && bandRow[i] !== bandRow[i - 1]) || up !== bandRow[i]) { img[o] *= 0.55; img[o + 1] *= 0.55; img[o + 2] *= 0.55; }
  }
  prevRow = bandRow.slice();
}
// rivers: every link's meandering centre line, thicker as the river grows
const RV = T.rivers(), q = [0, 0, 0];
const dot = (x, y, c, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = y * (W * 3 + 1) + 1 + x * 3;
  for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - a) + c[k] * a;
};
const blocksPerPx = (zoom ? zoom.span * DEG : 2 * Math.PI) * P.R / W;
let longest = 0, mouths = 0;
for (let li = 0; li < RV.link.length; li++) {
  const c = RV.curve(li), n = RV.link[li];
  if (RV.sea[RV.down[n]]) mouths++;
  const px = Math.max(0.8 + 2.6 * c.w / BF.rivers.WCAP, 2 * c.w / blocksPerPx), col = [40, 90, 230];
  for (let k = 0; k < c.xs.length; k += zoom ? 1 : 4) {
    P.dir(c.F, c.xs[k], c.ys[k], q);
    const lat = Math.asin(q[1]), lon = Math.atan2(q[0], q[2]);
    const [x, y] = pixOf(lat, lon), r = px / 2;
    for (let dy = Math.floor(y - r); dy <= Math.ceil(y + r); dy++) for (let dx = Math.floor(x - r); dx <= Math.ceil(x + r); dx++) {
      const e = Math.hypot(dx - x, dy - y);
      if (e <= r + 0.5) dot(dx, dy, col, Math.min(1, r + 0.5 - e) * (px < 1.5 ? 0.85 : 1));
    }
  }
}
// longest river: from each source (a river node nothing flows into), the length to the sea
const fed = new Uint8Array(RV.acc.length), isRiver = new Uint8Array(RV.acc.length);
for (const n of RV.link) { isRiver[n] = 1; fed[RV.down[n]] = 1; }
const dist = (a, b) => Math.acos(Math.min(1, RV.D[a * 3] * RV.D[b * 3] + RV.D[a * 3 + 1] * RV.D[b * 3 + 1] + RV.D[a * 3 + 2] * RV.D[b * 3 + 2])) * P.R;
for (const n of RV.link) if (!fed[n]) { let L = 0, m = n; while (isRiver[m]) { L += dist(m, RV.down[m]); m = RV.down[m]; } longest = Math.max(longest, L); }

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td));
  return Buffer.concat([len, td, crc]);
}
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
const hdr = Buffer.alloc(13); hdr.writeUInt32BE(W, 0); hdr.writeUInt32BE(H, 4); hdr[8] = 8; hdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", hdr), chunk("IDAT", zlib.deflateSync(img)), chunk("IEND", Buffer.alloc(0))]));
console.log(`seed ${seed}: land ${(100 * land / total).toFixed(1)}%, highest layer ${maxH}, ${Date.now() - t0} ms -> ${out}`);
let maxAcc = 0; for (const n of RV.link) maxAcc = Math.max(maxAcc, RV.acc[n]);
console.log(`rivers: ${RV.link.length} links, ${mouths} reach the sea, longest about ${(longest / 1000).toFixed(0)} km (straight-line between nodes), largest catchment ${(maxAcc * RV.NS * RV.NS / 1e6).toFixed(0)} km2 rain-weighted; network solved in ${RV.stats.ms} ms`);
console.log("land by band: " + BF.climate.BANDS.map((n, k) => `${n} ${(100 * byBand[k] / land).toFixed(0)}%`).join(", "));
console.log("land by biome: " + Object.entries(byBiome).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${(100 * v / land).toFixed(1)}%`).join(", "));
