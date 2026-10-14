// Village siting statistics for a seed: how many regions get a village, and how much the face-edge margin excludes.
// Usage: node tools/village-stats.js [seed] [samples]
const path = require("path");
global.window = global;
for (const f of ["noise", "planet", "climate", "rivers", "terrain"]) require(path.join(__dirname, "..", "js", f + ".js"));
BF.world = { terrain: BF.makeTerrain(+(process.argv[2] || 1)), get() { return 0; }, set() {} };
require(path.join(__dirname, "..", "js", "villages.js"));
const P = BF.planet, V = BF.villages, n = +(process.argv[3] || 4000), R = V.REGION, RN = Math.floor(P.N / R);
let land = 0, villages = 0, edge = 0, t0 = Date.now();
const d = [0, 0, 0];
for (let k = 0; k < n; k++) {
  const f = k % 6, rx = Math.floor(Math.random() * RN), rz = Math.floor(Math.random() * RN);
  P.dir(f, rx * R, rz * R, d);
  const s = BF.world.terrain.sample(d[0], d[1], d[2]);
  if (s.h > P.SEA) land++;
  const inEdge = rx * R < V.MARGIN + 192 || rx * R >= P.N - V.MARGIN - 192 || rz * R < V.MARGIN + 192 || rz * R >= P.N - V.MARGIN - 192;
  if (inEdge) edge++;
  if (V.site(f, rx, rz)) villages++;
}
const total = 6 * RN * RN;
console.log(`${n} random regions of ${total}: ${(100 * land / n).toFixed(1)}% land, ${(100 * villages / n).toFixed(1)}% have a village, ${(100 * edge / n).toFixed(2)}% lie in the face-edge margin`);
console.log(`estimated villages on the planet: ${Math.round(total * villages / n).toLocaleString()} (${(Date.now() - t0)} ms)`);
