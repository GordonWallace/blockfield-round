// Terrain: every value is a function of the column's direction from the planet's centre, sampled
// with 3D noise, so continents, coasts and climate run seamlessly across the cube's faces and edges.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet;

const B = (BF.B = { AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, SAND: 4, WATER: 5, SNOW: 6, ICE: 7,
  GRAVEL: 8, SANDSTONE: 9, BEDROCK: 10, PLANKS: 11 });

const LAND = 0.1;    // continent noise threshold: about a third of the surface is land
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

BF.makeTerrain = function (seed) {
  const nA = BF.makeNoise(seed), nB = BF.makeNoise(seed ^ 0x5bd1e995), nC = BF.makeNoise(seed + 7777);
  const R = P.R, SEA = P.SEA;
  // continental and climate fields scale with the planet; S = 1 at the first prototype's radius (10,430)
  const S = R / 10430, C = S * 9000, WP = S * 5000, WA = S * 2600, M = S * 6000, RG = 1600 * Math.sqrt(S), CL = S * 3000, WE = S * 4000;
  const out = { h: 0, land: 0, temp: 0, wet: 0, top: 0, sub: 0, ice: false };

  // Surface at unit direction (x, y, z). detail = false skips the small-scale noise (planet map).
  function sample(x, y, z, detail = true) {
    const X = x * R, Y = y * R, Z = z * R;
    const wx = nB.fbm3(X / WP, Y / WP, Z / WP, 3) * WA;
    const wy = nB.fbm3(X / WP + 31.7, Y / WP, Z / WP, 3) * WA;
    const wz = nB.fbm3(X / WP + 57.3, Y / WP, Z / WP, 3) * WA;
    const c = nA.fbm3((X + wx) / C, (Y + wy) / C, (Z + wz) / C, detail ? 9 : 5);
    const land = c - LAND;
    let h;
    if (land < 0) {
      h = SEA - 3 - 55 * smooth(0, 0.12, -land) + (detail ? nC.n3(X / 60, Y / 60, Z / 60) * 3 : 0);
    } else {
      const inland = smooth(0, 0.12, land);
      const hills = detail ? nC.fbm3(X / 400, Y / 400, Z / 400, 3) * 22 * inland : 0;
      const ridge = 1 - Math.abs(nA.fbm3(X / RG + 100, Y / RG, Z / RG, detail ? 5 : 3));
      const mask = smooth(0, 0.3, nB.fbm3(X / M + 200, Y / M, Z / M, 3)) * smooth(0.03, 0.2, land);
      h = SEA + 1 + 60 * smooth(0, 0.3, land) + hills + ridge * ridge * ridge * mask * 150;
    }
    h = Math.max(4, Math.min(P.H - 8, Math.floor(h)));
    const lat = Math.abs(y);
    const temp = 1 - 1.2 * lat * lat + nC.fbm3(X / CL + 300, Y / CL, Z / CL, 3) * 0.2 - Math.max(0, h - SEA) / 260;
    const wet = nB.fbm3(X / WE + 500, Y / WE, Z / WE, 3);

    let top, sub;
    if (h < SEA - 1) { top = h < SEA - 20 ? B.GRAVEL : B.SAND; sub = top; }
    else if (h <= SEA + 2 && land < 0.04) { top = B.SAND; sub = B.SAND; }
    else if (temp < 0.18) { top = B.SNOW; sub = B.DIRT; }
    else if (h > SEA + 150) { top = B.STONE; sub = B.STONE; }
    else if (temp > 0.75 && wet < -0.12) { top = B.SAND; sub = B.SANDSTONE; }
    else { top = B.GRASS; sub = B.DIRT; }
    out.h = h; out.land = land; out.temp = temp; out.wet = wet; out.top = top; out.sub = sub;
    out.ice = temp < 0.12;
    return out;
  }

  // Fills one column of a chunk. put(y, block) writes a block.
  function column(x, y, z, put) {
    const s = sample(x, y, z);
    const h = s.h;
    for (let k = 0; k <= h; k++) {
      let b;
      if (k <= 1) b = B.BEDROCK;
      else if (k < h - 3) b = B.STONE;
      else if (k < h) b = s.sub;
      else b = s.top;
      put(k, b);
    }
    for (let k = h + 1; k <= P.SEA; k++) put(k, k === P.SEA && s.ice ? B.ICE : B.WATER);
    return s;
  }

  return { sample, column, seed };
};
})();
