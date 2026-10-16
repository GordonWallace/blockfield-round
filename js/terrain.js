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

  // The continents are turned (one rotation per seed, chosen below) so that every cube corner lies in open
  // ocean that is part of a real sea, not a lake cut out of a continent.
  let RM = [1, 0, 0, 0, 1, 0, 0, 0, 1], cornerSea = 0;
  function cont(x, y, z) {   // continent value (land where > 0) at unit direction (x, y, z), coarse
    const X = (RM[0] * x + RM[1] * y + RM[2] * z) * R, Y = (RM[3] * x + RM[4] * y + RM[5] * z) * R, Z = (RM[6] * x + RM[7] * y + RM[8] * z) * R;
    const wx = nB.fbm3(X / WP, Y / WP, Z / WP, 3) * WA;
    const wy = nB.fbm3(X / WP + 31.7, Y / WP, Z / WP, 3) * WA;
    const wz = nB.fbm3(X / WP + 57.3, Y / WP, Z / WP, 3) * WA;
    return nA.fbm3((X + wx) / C, (Y + wy) / C, (Z + wz) / C, 5) - LAND;
  }
  // Corners in the sea: the continents are turned so every corner is close to open sea, and a corner that
  // isn't already in it gets a gulf running out to it (see sample). Open sea here: 40 km of unbroken sea
  // along a straight line, too long for an inland lake.
  const KS = [];   // per corner: unit direction c, and its gulf's end direction g (null when none is needed)
  for (let k = 0; k < 8; k++) { const l = Math.sqrt(3); KS.push({ c: [(k & 1 ? -1 : 1) / l, (k & 2 ? -1 : 1) / l, (k & 4 ? -1 : 1) / l], g: null, n: null, a: 0 }); }
  const DIRS = 12, STEP = 2000, OPEN = 40000;
  function ray(c, i, r) {   // direction at distance r from corner c, heading i of DIRS
    let ex = -c[1], ey = c[0]; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const fx = -c[2] * ey, fy = c[2] * ex, fz = c[0] * ey - c[1] * ex;
    const t = r / R, cs = Math.cos(t), sn = Math.sin(t), a = i * 2 * Math.PI / DIRS, ca = Math.cos(a), sa = Math.sin(a);
    return [c[0] * cs + (ex * ca + fx * sa) * sn, c[1] * cs + (ey * ca + fy * sa) * sn, c[2] * cs + fz * sa * sn];
  }
  // Distance (under limit) from corner c to where open sea starts along the best heading, and that heading.
  function reach(c, limit) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < DIRS; i++) {
      let run = 0;
      for (let r = 0; r < Math.min(best, limit) + OPEN; r += STEP) {
        const d = ray(c, i, r);
        if (cont(d[0], d[1], d[2]) < -0.03) { run += STEP; if (run >= OPEN) { best = r - OPEN + STEP; bi = i; break; } }
        else { run = 0; if (r >= Math.min(best, limit)) break; }
      }
    }
    return [best, bi];
  }
  {
    const nR = BF.makeNoise(seed ^ 0x2c1b3c6d);
    let best = 80000, bestM = RM, order = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = 0; i < 300; i++) {
      // a uniformly random rotation (Shoemake's quaternion)
      const u1 = nR.hash(i, 1), u2 = nR.hash(i, 2) * 2 * Math.PI, u3 = nR.hash(i, 3) * 2 * Math.PI;
      const a = Math.sqrt(1 - u1), b = Math.sqrt(u1), qx = a * Math.sin(u2), qy = a * Math.cos(u2), qz = b * Math.sin(u3), qw = b * Math.cos(u3);
      RM = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
        2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
        2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)];
      let worst = 0;
      for (let n = 0; n < 8 && worst < best; n++) {
        const d = reach(KS[order[n]].c, best)[0];
        if (d > worst) { worst = d; if (d >= best) order = [order[n], ...order.filter((o) => o !== order[n])]; }   // check the hard corner first next time
      }
      if (worst < best) { best = worst; bestM = RM; }
    }
    RM = bestM;
    cornerSea = best;
    for (const K of KS) {
      const [d, i] = reach(K.c, Infinity);
      if (!(d > 0) || d === Infinity) continue;
      K.g = ray(K.c, i, d + 3000);
      const n = [K.c[1] * K.g[2] - K.c[2] * K.g[1], K.c[2] * K.g[0] - K.c[0] * K.g[2], K.c[0] * K.g[1] - K.c[1] * K.g[0]], nl = Math.hypot(...n);
      K.n = n.map((v) => v / nl); K.a = (d + 3000) / R;   // the gulf's plane, and its length as an angle
    }
  }
  // How far (blocks) direction (x, y, z), next to corner K, is from K's gulf, or Infinity without one; the
  // gulf's centre line wanders, so it doesn't run dead straight.
  function gulf(K, x, y, z) {
    if (!K.g) return Infinity;
    const c = K.c, n = K.n, off = x * n[0] + y * n[1] + z * n[2];
    // along the gulf: the angle from c towards g in their plane
    const t = [n[1] * c[2] - n[2] * c[1], n[2] * c[0] - n[0] * c[2], n[0] * c[1] - n[1] * c[0]];
    const along = Math.atan2(x * t[0] + y * t[1] + z * t[2], x * c[0] + y * c[1] + z * c[2]);
    const wob = nC.n3(x * R / 9000, y * R / 9000, z * R / 9000) * 2500;
    const side = Math.abs(off * R + wob);
    if (along < 0) return Math.hypot(side, along * R);
    if (along > K.a) return Math.hypot(side, (along - K.a) * R);
    return side;
  }

  // Surface at unit direction (x, y, z). detail = false skips the small-scale noise (planet map).
  function sample(x, y, z, detail = true, groundOnly = false) {
    const X = (RM[0] * x + RM[1] * y + RM[2] * z) * R, Y = (RM[3] * x + RM[4] * y + RM[5] * z) * R, Z = (RM[6] * x + RM[7] * y + RM[8] * z) * R;
    const wx = nB.fbm3(X / WP, Y / WP, Z / WP, 3) * WA;
    const wy = nB.fbm3(X / WP + 31.7, Y / WP, Z / WP, 3) * WA;
    const wz = nB.fbm3(X / WP + 57.3, Y / WP, Z / WP, 3) * WA;
    const c = nA.fbm3((X + wx) / C, (Y + wy) / C, (Z + wz) / C, detail ? 9 : 5);
    // The 8 cube corners are always open ocean (the continents are turned to put them in open sea, and any
    // island left fades out from 4 km to 1.5 km), so the round view drawn there (main.js, corner mode) is
    // only ever water.
    const corner = Math.acos(Math.min(1, (Math.abs(x) + Math.abs(y) + Math.abs(z)) / Math.sqrt(3))) * R;
    let land = c - LAND - 1.2 * smooth(4000, 1500, corner);
    if (corner < 90000) {
      const K = KS[(x < 0 ? 1 : 0) + (y < 0 ? 2 : 0) + (z < 0 ? 4 : 0)];
      // a gulf 3 to 6 km wide, by a noise along it
      const g = gulf(K, x, y, z), w = 2200 + 1200 * nC.n3(X / 7000 + 50, Y / 7000, Z / 7000);
      if (g < w + 2000) land = Math.min(land, land - 1.2 * smooth(w + 2000, w, g));
    }
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
    if (r.li < 0) return lake(f, u, v, s, h0);
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
    return lake(f, u, v, s, h0);
  }
  // Lakes above sea level (see rivers.js): water up to the lake's level wherever the ground (before any
  // river valley was cut into it) is below it.
  function lake(f, u, v, s, h0) {
    const lw = rivers().lakeAt(f, u, v);
    if (lw <= SEA || h0 >= lw) return s;
    s.wl = Math.max(s.wl, lw);
    if (s.top !== B.SAND && s.top !== B.GRAVEL) { s.top = s.h < lw - 6 ? B.GRAVEL : B.SAND; s.sub = s.top; }
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

  return { sample, surface, column, rivers, seed, cornerSea };
};
})();
