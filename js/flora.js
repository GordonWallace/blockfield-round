// Trees, by biome (climate.js TREES: chance per 4 x 4 cell and which kinds grow there).
//
// A tree belongs to one 4 x 4 cell on one face. A chunk asks every cell whose tree could reach it, including
// cells just past a face edge: those are looked up on their own face and their blocks turned into this face's
// grid by the same unfold the game draws with, so a tree on an edge comes out whole on both sides.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world, N = P.N, CS = 16;
const CELL = 4, REACH = 6;   // cell size; how far a tree's blocks reach from its trunk
let noise = null, noiseSeed = null;

// Block list { x, y, z, b } of the tree in cell (ci, cj) of face g, relative to its trunk base, or null.
const cache = new Map();
function tree(g, ci, cj) {
  const seed = world.terrain.seed;
  if (noiseSeed !== seed) { noise = BF.makeNoise(seed ^ 0x68e31da4); noiseSeed = seed; cache.clear(); }
  const k = (g * (N / CELL) + ci) * (N / CELL) + cj;
  if (cache.has(k)) return cache.get(k);
  if (cache.size > 200000) cache.clear();
  let t = null;
  const h = (s) => noise.hash(ci * 7 + g, cj, s);
  const u = ci * CELL + Math.floor(h(1) * CELL), v = cj * CELL + Math.floor(h(2) * CELL);
  if (u >= 0 && u < N && v >= 0 && v < N) {
    const d = P.dir(g, u + 0.5, v + 0.5, [0, 0, 0]), s = world.terrain.surface(g, u, v, d);
    const T = BF.climate.TREES[s.biome];
    if (T && T.kinds.length && h(3) < T.d && s.wl < s.h && !s.river && s.h > P.SEA
      && !(BF.villages && BF.villages.inVillage(g, u, v))) {
      const kind = T.kinds[Math.floor(h(4) * T.kinds.length)];
      const ok = kind === "cactus" ? s.top === B.SAND || s.top === B.RED_SAND : s.top === B.GRASS || s.top === B.SNOW;
      if (ok) t = { u, v, y: s.h + 1, blocks: shape(kind, h) };
    }
  }
  cache.set(k, t);
  return t;
}

// Tree shapes, Minecraft-like. h(salt) gives this tree's random numbers.
function shape(kind, h) {
  const out = [];
  const put = (x, y, z, b) => out.push(x, y, z, b);
  const trunk = (n, b, x = 0, z = 0) => { for (let y = 0; y < n; y++) put(x, y, z, b); };
  const disc = (y, r, b, cut = true, cx = 0, cz = 0) => {
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) {
      if (cut && Math.abs(x) === r && Math.abs(z) === r && r > 0) continue;
      if (r >= 3 && x * x + z * z > r * r + 1) continue;
      put(cx + x, y, cz + z, b);
    }
  };
  const roundTop = (n, leaves, wide = 2) => { disc(n - 3, wide, leaves); disc(n - 2, wide, leaves); disc(n - 1, 1, leaves, false); disc(n, 1, leaves); };
  if (kind === "oak" || kind === "birch" || kind === "swamp") {
    const n = (kind === "birch" ? 5 : 4) + Math.floor(h(5) * 3), leaves = kind === "birch" ? B.BIRCH_LEAVES : B.LEAVES;
    roundTop(n, leaves, kind === "swamp" ? 3 : 2); trunk(n, kind === "birch" ? B.BIRCH_LOG : B.LOG);
  } else if (kind === "spruce" || kind === "tallspruce") {
    const n = kind === "tallspruce" ? 12 + Math.floor(h(5) * 5) : 6 + Math.floor(h(5) * 4);
    // a cone of rings that alternate wide and narrow on the way up
    const maxR = kind === "tallspruce" ? 3 : 2;
    for (let y = 2; y <= n; y++) {
      const dist = n - y, r = dist < 1 ? 0 : Math.min(maxR, 1 + Math.floor(dist / 3) - (dist % 2 ? 1 : 0));
      disc(y, Math.max(dist < 1 ? 0 : 1, r), B.SPRUCE_LEAVES);
    }
    put(0, n + 1, 0, B.SPRUCE_LEAVES); trunk(n, B.SPRUCE_LOG);
  } else if (kind === "jungle") {
    const n = 9 + Math.floor(h(5) * 7);
    disc(n - 2, 3, B.JUNGLE_LEAVES); disc(n - 1, 3, B.JUNGLE_LEAVES); disc(n, 2, B.JUNGLE_LEAVES); disc(n + 1, 1, B.JUNGLE_LEAVES, false);
    if (h(6) < 0.5) disc(Math.floor(n / 2), 2, B.JUNGLE_LEAVES, true, h(7) < 0.5 ? 2 : -2, 0);
    trunk(n, B.JUNGLE_LOG);
  } else if (kind === "bush") {
    disc(0, 2, B.JUNGLE_LEAVES); disc(1, 1, B.JUNGLE_LEAVES, false); put(0, 0, 0, B.JUNGLE_LOG);
  } else if (kind === "acacia") {
    // a straight trunk that leans off to one side, under a flat crown
    const n = 4 + Math.floor(h(5) * 2), dx = h(6) < 0.5 ? 1 : -1, dz = h(7) < 0.5 ? 1 : -1;
    trunk(n - 2, B.ACACIA_LOG);
    put(dx, n - 2, dz, B.ACACIA_LOG); put(2 * dx, n - 1, 2 * dz, B.ACACIA_LOG);
    disc(n, 3, B.ACACIA_LEAVES, true, 2 * dx, 2 * dz); disc(n + 1, 1, B.ACACIA_LEAVES, false, 2 * dx, 2 * dz);
    put(2 * dx, n, 2 * dz, B.ACACIA_LOG);
  } else if (kind === "dark") {
    const n = 6 + Math.floor(h(5) * 3);
    disc(n - 2, 3, B.DARK_LEAVES); disc(n - 1, 3, B.DARK_LEAVES); disc(n, 2, B.DARK_LEAVES);
    for (let x = 0; x <= 1; x++) for (let z = 0; z <= 1; z++) trunk(n, B.LOG, x, z);
  } else if (kind === "mangrove") {
    const n = 5 + Math.floor(h(5) * 3);
    disc(n - 2, 3, B.MANGROVE_LEAVES); disc(n - 1, 2, B.MANGROVE_LEAVES); disc(n, 1, B.MANGROVE_LEAVES, false);
    trunk(n, B.LOG); put(1, 0, 0, B.LOG); put(-1, 0, 0, B.LOG); put(0, 0, 1, B.LOG); put(0, 0, -1, B.LOG);
  } else if (kind === "cherry") {
    const n = 5 + Math.floor(h(5) * 2);
    disc(n - 2, 3, B.CHERRY_LEAVES); disc(n - 1, 3, B.CHERRY_LEAVES); disc(n, 2, B.CHERRY_LEAVES); trunk(n, B.LOG);
  } else if (kind === "cactus") {
    trunk(1 + Math.floor(h(5) * 3), B.CACTUS);
  }
  return out;
}

const LEAVES = new Set([B.LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.BIRCH_LEAVES, B.DARK_LEAVES, B.CHERRY_LEAVES, B.MANGROVE_LEAVES]);
const isLeaves = (b) => LEAVES.has(b);

// Called by world.js for every new chunk, before villages: writes the parts of nearby trees inside it.
BF.flora = {
  tree,
  decorate(c) {
    const u0 = c.cx * CS, v0 = c.cz * CS, f = c.f, g = { f: 0, u: 0, v: 0 }, blk = c.blocks, SL = CS * CS;
    const c0 = Math.floor((u0 - REACH) / CELL), c1 = Math.floor((u0 + CS + REACH) / CELL);
    const r0 = Math.floor((v0 - REACH) / CELL), r1 = Math.floor((v0 + CS + REACH) / CELL);
    for (let cj = r0; cj <= r1; cj++) for (let ci = c0; ci <= c1; ci++) {
      // the cell's own face and cell, and the map from that face's grid into this one
      let t, A = null, tx = 0, ty = 0;
      const cu = ci * CELL + CELL / 2, cv = cj * CELL + CELL / 2;
      if (cu >= 0 && cu < N && cv >= 0 && cv < N) t = tree(f, ci, cj);
      else {
        if ((cu < 0 || cu >= N) && (cv < 0 || cv >= N)) continue;   // corner wedge: no face there
        P.wrap(f, cu, cv, g);
        t = tree(g.f, Math.floor(g.u / CELL), Math.floor(g.v / CELL));
        const e = P.UNFOLD[f][g.f]; A = e.A; tx = e.t[0]; ty = e.t[1];
      }
      if (!t) continue;
      const bl = t.blocks;
      let bu = t.u, bv = t.v;
      if (A) { const x = A[0] * t.u + A[1] * t.v + tx, y = A[2] * t.u + A[3] * t.v + ty; bu = x; bv = y; }
      for (let k = 0; k < bl.length; k += 4) {
        let dx = bl[k], dz = bl[k + 2];
        if (A) { const x = A[0] * dx + A[1] * dz, z = A[2] * dx + A[3] * dz; dx = x; dz = z; }
        const x = bu + dx - u0, z = bv + dz - v0, y = t.y + bl[k + 1];
        if (x < 0 || x >= CS || z < 0 || z >= CS || y >= P.H - 1) continue;
        const i = y * SL + z * CS + x, b = bl[k + 3], cur = blk[i];
        // leaves only fill air; wood replaces air and leaves
        if (cur === B.AIR || (!isLeaves(b) && isLeaves(cur))) {
          blk[i] = b;
          if (y > c.top[z * CS + x]) c.top[z * CS + x] = y;
        }
      }
    }
  },
};
})();
