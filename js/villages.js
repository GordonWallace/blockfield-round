// Villages on the globe: the "chart" method for place-bound x/z code.
//
// Each cube face is already a flat integer grid, so a village uses its face's grid as its own flat world:
// x = u, z = v, y = layer. Blockfield's village maths (regions, site checks, plots, rotations, paths) runs on
// a chart unchanged, block for block. The one new rule is that a village's footprint never crosses a face
// edge, so no chart ever needs a seam. Anything that spans villages (nearest village, distances, directions)
// uses the planet helpers instead (P.distance, P.toward), which work across faces.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world;

// ---------- charts: Blockfield's world API on one face ----------
// getBlock / setBlock take Blockfield's (x, y, z) order; surface is the terrain height (rivers carved in)
// before any structure.
BF.chart = function (f) {
  const d = [0, 0, 0];
  return {
    f,
    getBlock: (x, y, z) => world.get(f, x, z, y),
    setBlock: (x, y, z, b) => world.set(f, x, z, y, b),
    sample: (x, z) => { P.dir(f, x + 0.5, z + 0.5, d); return world.terrain.surface(f, x, z, d); },
    surface(x, z) { return this.sample(x, z).h; },
  };
};

// ---------- siting (Blockfield worldgen.js, with x/z now face grid coordinates) ----------
const REGION = 384, RHALF = 192, VLIM = 70;   // as Blockfield: one candidate per REGION square, layout within VLIM of the centre
const MARGIN = RHALF + VLIM;                  // new: no region within this distance of a face edge, so footprints stay on one face
const regionOf = (v) => Math.floor((v + RHALF) / REGION);

// Blockfield's siteOK, strict level: dry, flat ground. Unchanged apart from reading terrain through the chart
// (river water counts as wet, as Blockfield's river test does).
function siteOK(ch, x, z) {
  const SEA = P.SEA, s0 = ch.sample(x, z), h0 = s0.h;
  if (h0 <= SEA + 1 || s0.river || (s0.top !== B.GRASS && s0.top !== B.SAND && s0.top !== B.SNOW)) return false;
  let lo = h0, hi = h0, wet = 0;
  for (let dz = -28; dz <= 28; dz += 7) for (let dx = -28; dx <= 28; dx += 7) {
    const s = ch.sample(x + dx, z + dz), h = s.h;
    if (h <= SEA || s.wl > h) wet++;
    if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return wet <= 4 && hi - lo <= 9;
}

let noise = null, noiseSeed = null;
const hash = (a, b, c) => noise.hash(a * 131 + c, b, 977);
const sites = new Map();
// The village of region (rx, rz) on face f, or null. Deterministic from the seed.
function site(f, rx, rz) {
  const seed = world.terrain.seed;
  if (noiseSeed !== seed) { noise = BF.makeNoise(seed ^ 0x2545f491); noiseSeed = seed; sites.clear(); plans.clear(); }
  const k = f + ":" + rx + ":" + rz;
  if (sites.has(k)) return sites.get(k);
  let v = null;
  const x = rx * REGION + Math.round((hash(rx, rz, f) * 2 - 1) * (RHALF - VLIM));
  const z = rz * REGION + Math.round((hash(rz, rx, f + 7) * 2 - 1) * (RHALF - VLIM));
  if (x >= MARGIN && x < P.N - MARGIN && z >= MARGIN && z < P.N - MARGIN) {
    const ch = BF.chart(f);
    if (siteOK(ch, x, z)) v = { f, rx, rz, x, z, key: k, name: villageName(f, rx, rz) };
  }
  sites.set(k, v);
  return v;
}
const SYL = ["ka", "to", "ri", "wai", "ma", "nu", "pe", "ro", "ta", "ha", "ki", "mo", "ra", "te", "whe", "ao"];
function villageName(f, rx, rz) {
  let n = "";
  for (let i = 0; i < 3; i++) n += SYL[Math.floor(hash(rx + i * 31, rz, f + 13) * SYL.length)];
  return n[0].toUpperCase() + n.slice(1);
}

// ---------- layout: written as flat-world code in chart coordinates ----------
const rot90 = (x, z, k) => { for (let i = 0; i < (k & 3); i++) { const t = x; x = -z; z = t; } return [x, z]; };   // Blockfield blueprints.js
const plans = new Map();

// The village's blocks, bucketed by chunk: Map chunkKey -> [x, y, z, block] in chart (face grid) coordinates.
function plan(v) {
  if (plans.has(v.key)) return plans.get(v.key);
  const ch = BF.chart(v.f), cells = new Map(), rnd = mulberry(Math.floor(hash(v.rx, v.rz, v.f + 99) * 4294967296));
  const put = (x, y, z, b) => cells.set(x + "," + y + "," + z, [x, y, z, b]);
  const surf = new Map(), ground = (x, z) => { const k = x + "," + z; if (!surf.has(k)) surf.set(k, ch.surface(x, z)); return surf.get(k); };

  // well in the centre
  const wy = ground(v.x, v.z);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const edge = Math.max(Math.abs(dx), Math.abs(dz)) === 2;
    for (let y = wy - 3; y <= wy; y++) put(v.x + dx, y, v.z + dz, edge ? B.COBBLE : y === wy ? B.WATER : B.WATER);
    if (edge) put(v.x + dx, wy + 1, v.z + dz, B.COBBLE);
    for (let y = wy + 2; y <= wy + 6; y++) if (!edge || (Math.abs(dx) === 2 && Math.abs(dz) === 2 && y < wy + 5)) put(v.x + dx, y, v.z + dz, edge ? B.LOG : B.AIR);
    put(v.x + dx, wy + 5, v.z + dz, B.ROOF);
  }

  // houses on a ring, doors facing the well; plots must not overlap
  const n = 4 + Math.floor(rnd() * 6), boxes = [[v.x - 4, v.z - 4, v.x + 4, v.z + 4]];
  for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
    const a = rnd() * Math.PI * 2, r = 13 + rnd() * 24;
    const cx = v.x + Math.round(Math.cos(a) * r), cz = v.z + Math.round(Math.sin(a) * r);
    const hw = 2 + Math.floor(rnd() * 2), hd = 2 + Math.floor(rnd() * 2);
    // turn the house so its door (local -z side) faces the well
    const rot = (Math.round(Math.atan2(v.x - cx, -(v.z - cz)) / (Math.PI / 2)) + 4) & 3;
    const [ex, ez] = rot90(hw, hd, rot), bx = Math.abs(ex) + 1, bz = Math.abs(ez) + 1;
    const box = [cx - bx - 1, cz - bz - 1, cx + bx + 1, cz + bz + 1];
    if (boxes.some((o) => box[0] <= o[2] && box[2] >= o[0] && box[1] <= o[3] && box[3] >= o[1])) continue;
    const gy = ground(cx, cz);
    if (gy <= P.SEA + 1 || Math.abs(gy - wy) > 6) continue;
    boxes.push(box);
    house(put, ground, cx, gy, cz, hw, hd, rot);
    path(put, ground, cx, cz, rot, hd, v);
    k++;
  }
  // bucket by chunk
  const byChunk = new Map();
  for (const c of cells.values()) {
    const ck = (c[0] >> 4) + ":" + (c[2] >> 4);
    if (!byChunk.has(ck)) byChunk.set(ck, []);
    byChunk.get(ck).push(c);
  }
  const p = { byChunk, houses: boxes.length - 1 };
  plans.set(v.key, p);
  return p;
}

// A small house in local coordinates (door on the -z wall), rotated by rot quarter turns and placed at (cx, gy, cz).
function house(put, ground, cx, gy, cz, hw, hd, rot) {
  const at = (lx, y, lz, b) => { const [x, z] = rot90(lx, lz, rot); put(cx + x, y, cz + z, b); };
  for (let lz = -hd; lz <= hd; lz++) for (let lx = -hw; lx <= hw; lx++) {
    const [x, z] = rot90(lx, lz, rot);
    // foundation down to the ground and air cleared above the roof line
    for (let y = Math.min(gy, ground(cx + x, cz + z)); y < gy; y++) put(cx + x, y, cz + z, B.COBBLE);
    at(lx, gy, lz, B.PLANKS);
    const wall = Math.abs(lx) === hw || Math.abs(lz) === hd, corner = Math.abs(lx) === hw && Math.abs(lz) === hd;
    for (let y = gy + 1; y <= gy + 3; y++) {
      let b = B.AIR;
      if (corner) b = B.LOG;
      else if (wall) b = y === gy + 2 && (lx === 0 || lz === 0) ? B.GLASS : B.PLANKS;
      if (lx === 0 && lz === -hd && y <= gy + 2) b = B.AIR;   // doorway
      at(lx, y, lz, b);
    }
    for (let y = gy + 4; y <= gy + 7; y++) at(lx, y, lz, B.AIR);
  }
  // stepped roof with a one-block overhang
  for (let s = 0; s <= Math.min(hw, hd) + 1; s++)
    for (let lz = -hd - 1 + s; lz <= hd + 1 - s; lz++) for (let lx = -hw - 1 + s; lx <= hw + 1 - s; lx++) at(lx, gy + 4 + s, lz, B.ROOF);
}

// A path from the door straight out, then along each axis to the well (a plain flat-world L route).
function path(put, ground, cx, cz, rot, hd, v) {
  const [ox, oz] = rot90(0, -hd - 1, rot);
  let x = cx + ox, z = cz + oz;
  const step = (nx, nz) => { x = nx; z = nz; const g = ground(x, z); if (g > P.SEA) put(x, g, z, B.PATH); };
  step(x, z);
  while (Math.abs(x - v.x) > 2) step(x + Math.sign(v.x - x), z);
  while (Math.abs(z - v.z) > 2) step(x, z + Math.sign(v.z - z));
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- hooks ----------
const villages = (BF.villages = { REGION, MARGIN, site, plan, siteOK });

// Called by world.js for every new chunk: writes the blocks of any village overlapping it.
villages.decorate = function (c) {
  const u0 = c.cx * 16, v0 = c.cz * 16, CS = 16;
  for (let rz = regionOf(v0 - VLIM - 8); rz <= regionOf(v0 + 15 + VLIM + 8); rz++)
    for (let rx = regionOf(u0 - VLIM - 8); rx <= regionOf(u0 + 15 + VLIM + 8); rx++) {
      const v = site(c.f, rx, rz);
      if (!v) continue;
      const list = plan(v).byChunk.get(c.cx + ":" + c.cz);
      if (!list) continue;
      for (const [x, y, z, b] of list) {
        const lx = x - u0, lz = z - v0, i = lz * CS + lx;
        c.blocks[y * CS * CS + i] = b;
        if (b !== B.AIR && b !== B.WATER && y > c.top[i]) c.top[i] = y;
        else if (b === B.AIR && y === c.top[i]) { let t = y; while (t > 0 && (c.blocks[t * CS * CS + i] === B.AIR || c.blocks[t * CS * CS + i] === B.WATER)) t--; c.top[i] = t; }
      }
    }
};

// True if column (f, u, v) is inside some village's footprint (trees keep out).
villages.inVillage = function (f, u, v) {
  const s = site(f, regionOf(u), regionOf(v));
  return !!s && Math.abs(u - s.x) <= VLIM + 10 && Math.abs(v - s.z) <= VLIM + 10;
};

// Villages within r blocks of grid point (f, u, v), nearest first. Samples region centres around the point
// through P.wrap, so villages on neighbouring faces are found too.
villages.near = function (f, u, v, r) {
  const seen = new Map(), g = { f: 0, u: 0, v: 0 }, n = Math.ceil(r / REGION) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    P.wrap(f, u + i * REGION, v + j * REGION, g);
    const s = site(g.f, regionOf(g.u), regionOf(g.v));
    if (!s || seen.has(s.key)) continue;
    const d = P.distance({ f, u, v }, { f: s.f, u: s.x, v: s.z });
    if (d <= r) seen.set(s.key, { v: s, d });
  }
  return [...seen.values()].sort((a, b) => a.d - b.d);
};
})();
