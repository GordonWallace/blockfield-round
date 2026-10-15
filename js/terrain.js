// Terrain: every value is a function of the column's direction from the planet's centre, sampled
// with 3D noise, so continents, coasts and climate run seamlessly across the cube's faces and edges.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet;

const B = (BF.B = { AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, SAND: 4, WATER: 5, SNOW: 6, ICE: 7,
  GRAVEL: 8, SANDSTONE: 9, BEDROCK: 10, PLANKS: 11, LOG: 12, COBBLE: 13, GLASS: 14, PATH: 15, ROOF: 16,
  LEAVES: 17, BIRCH_LOG: 18, SPRUCE_LOG: 19, SPRUCE_LEAVES: 20, JUNGLE_LOG: 21, JUNGLE_LEAVES: 22, ACACIA_LOG: 23,
  ACACIA_LEAVES: 24, BIRCH_LEAVES: 25, DARK_LEAVES: 26, CHERRY_LEAVES: 27, MANGROVE_LEAVES: 28, CACTUS: 29, RED_SAND: 30, TERRACOTTA: 31 });

const LAND = 0.1;    // continent noise threshold: about a third of the surface is land
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

BF.makeTerrain = function (seed) {
  const nA = BF.makeNoise(seed), nB = BF.makeNoise(seed ^ 0x5bd1e995), nC = BF.makeNoise(seed + 7777);
  const R = P.R, SEA = P.SEA;
  // continental and climate fields scale with the planet; S = 1 at the first prototype's radius (10,430)
  const S = R / 10430, C = S * 9000, WP = S * 5000, WA = S * 2600, M = S * 6000, RG = 1600 * Math.sqrt(S), CL = S * 3000, WE = S * 4000;
  const climate = BF.makeClimate(seed), CB = BF.climate.ID;
  const out = { h: 0, hf: 0, land: 0, temp: 0, rain: 0, band: 0, elat: 0, biome: 0, top: 0, sub: 0, ice: false };

  // Surface at unit direction (x, y, z). detail = false skips the small-scale noise (planet map).
  function sample(x, y, z, detail = true, groundOnly = false) {
    const X = x * R, Y = y * R, Z = z * R;
    const wx = nB.fbm3(X / WP, Y / WP, Z / WP, 3) * WA;
    const wy = nB.fbm3(X / WP + 31.7, Y / WP, Z / WP, 3) * WA;
    const wz = nB.fbm3(X / WP + 57.3, Y / WP, Z / WP, 3) * WA;
    const c = nA.fbm3((X + wx) / C, (Y + wy) / C, (Z + wz) / C, detail ? 9 : 5);
    // The 8 cube corners are always open ocean (land fades out from 4 km to 1.5 km), so the round view
    // drawn there (see main.js, corner mode) is only ever water.
    const corner = Math.acos(Math.min(1, (Math.abs(x) + Math.abs(y) + Math.abs(z)) / Math.sqrt(3))) * R;
    const land = c - LAND - 1.2 * smooth(4000, 1500, corner);
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
    out.hf = h;
    if (groundOnly) return out;
    h = Math.max(4, Math.min(P.H - 8, Math.floor(h)));
    const cl = climate.at(x, y, z, h, land, detail), bi = cl.biome;
    let top, sub;
    if (h < SEA - 1) { top = h < SEA - 20 ? B.GRAVEL : B.SAND; sub = top; }
    else if (bi === CB.BEACH) { top = B.SAND; sub = B.SAND; }
    else if (bi === CB.SNOWY_BEACH) { top = B.SNOW; sub = B.SAND; }
    else if (bi === CB.DESERT) { top = B.SAND; sub = B.SANDSTONE; }
    else if (bi === CB.BADLANDS) { top = B.RED_SAND; sub = B.TERRACOTTA; }
    else if (bi === CB.ICE_SPIKES) { top = B.SNOW; sub = B.ICE; }
    else if (bi === CB.SNOWY_PLAINS || bi === CB.SNOWY_TAIGA) { top = B.SNOW; sub = B.DIRT; }
    else if (bi === CB.SNOWY_SLOPES) { top = B.SNOW; sub = B.STONE; }
    else if (bi === CB.STONY_PEAKS) { top = B.STONE; sub = B.STONE; }
    else if (bi === CB.MOUNTAINS && detail && nC.n3(X / 23, Y / 23, Z / 23) > 0.25) { top = B.STONE; sub = B.STONE; }
    else { top = B.GRASS; sub = B.DIRT; }
    out.h = h; out.land = land; out.temp = cl.temp; out.rain = cl.rain; out.band = cl.band; out.elat = cl.elat; out.biome = bi;
    out.top = top; out.sub = sub;
    out.ice = cl.band === 0 || cl.elat > 62;
    return out;
  }

  // Rivers are solved for the whole planet the first time they are needed (see rivers.js).
  let RV = null;
  const route = { e: 0, hf: 0, land: 0, rain: 0, elat: 0 };
  const rivers = () => RV || (RV = BF.makeRivers(seed, (x, y, z) => {
    const a = sample(x, y, z, false);
    route.e = a.hf + 250 * Math.max(0, a.land); route.land = a.land;
    const b = sample(x, y, z, true);
    route.hf = b.hf; route.rain = b.rain; route.elat = b.elat;
    return route;
  }, (x, y, z) => sample(x, y, z, true, true).hf));
  const rv = { d: 0, w: 0, rs: 0, li: -1 };

  // The surface of column (f, u, v) with rivers carved in: sample() plus wl (top water layer, or -1 for
  // none above the ground) and river (true in and right beside the water).
  function surface(f, u, v, d) {
    const s = sample(d[0], d[1], d[2]);
    const h0 = s.h;
    s.wl = h0 < SEA ? SEA : -1; s.river = false;
    const r = rivers().at(f, u, v, rv);
    // the nearest river (for distant views, which need to know about rivers narrower than their cells)
    s.rd = r.d; s.rw = r.w; s.rwl = Math.floor(r.rs);
    if (r.li < 0) return s;
    const w = r.w, wl = Math.floor(r.rs), e = r.d - w;
    let h = h0;
    if (e < 0) {
      // channel: a rounded bed below the water surface; never builds up the sea floor
      const depth = Math.max(1, Math.round((1.5 + Math.min(5, w * 0.25)) * Math.sqrt(1 - (r.d / w) ** 2)));
      h = h0 < SEA - 1 ? Math.min(h0, wl - depth) : wl - depth;
      s.wl = Math.max(s.wl, wl);
    } else {
      // valley sides cut down to the river where the land stands higher, fading out at REACH (the land is
      // never built up: the water level is chosen to sit below it)
      // a broad valley floor near the water, steepening further out
      const T = wl + 1 + e * 0.15 + e * e * 0.006, fade = smooth(BF.rivers.REACH, BF.rivers.REACH - 50, e);
      if (h > T) h = Math.round(h - (h - T) * fade);
    }
    if (h !== h0) {
      s.h = h;
      if (e < 2) { s.river = true; if (s.top === B.GRASS || s.top === B.SNOW) { s.top = e < 0 ? B.SAND : s.top; s.sub = B.DIRT; } }
      if (e < 0) { s.top = B.SAND; s.sub = B.SAND; if (wl > SEA) s.biome = CB.RIVER; }
    }
    if (e < 4) s.river = true;
    return s;
  }

  // Fills column (f, u, v) of a chunk, whose unit direction is d. put(y, block) writes a block.
  function column(f, u, v, d, put) {
    const s = surface(f, u, v, d);
    const h = s.h;
    for (let k = 0; k <= h; k++) {
      let b;
      if (k <= 1) b = B.BEDROCK;
      else if (k < h - 3) b = B.STONE;
      else if (k < h) b = s.sub;
      else b = s.top;
      put(k, b);
    }
    for (let k = h + 1; k <= s.wl; k++) put(k, k === s.wl && s.ice ? B.ICE : B.WATER);
    return s;
  }

  return { sample, surface, column, rivers, seed };
};
})();
