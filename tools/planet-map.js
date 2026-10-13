// Renders an equirectangular map of a planet seed to a PNG and prints land statistics.
// Usage: node tools/planet-map.js [seed] [out.png] [width]
const fs = require("fs"), zlib = require("zlib"), path = require("path");
global.window = global;
for (const f of ["noise", "planet", "terrain"]) require(path.join(__dirname, "..", "js", f + ".js"));
const seed = +(process.argv[2] || 1), out = process.argv[3] || "planet-" + seed + ".png", W = +(process.argv[4] || 720), H = W / 2;
const T = BF.makeTerrain(seed), P = BF.planet, B = BF.B;
const img = Buffer.alloc((W * 3 + 1) * H);
let land = 0, total = 0, maxH = 0;
const t0 = Date.now();
for (let j = 0; j < H; j++) {
  const lat = (0.5 - (j + 0.5) / H) * Math.PI;
  img[j * (W * 3 + 1)] = 0;
  for (let i = 0; i < W; i++) {
    const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
    const x = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
    const s = T.sample(x, y, z, false);
    const w = Math.cos(lat); total += w;
    let c;
    if (s.h < P.SEA) { c = s.ice ? [220, 235, 245] : [30, 60 + (s.h - 40) * 1.2, 140 + (s.h - 40)]; }
    else {
      land += w; maxH = Math.max(maxH, s.h);
      const e = (s.h - P.SEA) / 200;
      c = s.top === B.SNOW ? [240, 240, 245] : s.top === B.SAND ? [210, 195, 140] : s.top === B.STONE ? [130, 130, 130] : [70 + e * 120, 140 - e * 20, 60 + e * 60];
    }
    const o = j * (W * 3 + 1) + 1 + i * 3;
    img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
}
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
