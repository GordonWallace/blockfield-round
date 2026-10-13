// Chunks (16 x 16 columns on one face, full height), block access across face edges, and meshing.
// Meshes are built in face grid coordinates and each vertex is bent onto the sphere. Every mesh is
// stored relative to its own anchor point and placed relative to the camera each frame (floating
// origin), so float32 precision holds anywhere on the planet.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, CS = 16, H = P.H, NC = P.N / CS;

// Block colours (top, side). Vertex colours stand in for textures in this prototype.
const COL = [];
COL[B.STONE] = [0x7d7d7d, 0x7d7d7d]; COL[B.DIRT] = [0x86603e, 0x86603e];
COL[B.GRASS] = [0x6aa84f, 0x86603e]; COL[B.SAND] = [0xdbcf9a, 0xdbcf9a];
COL[B.WATER] = [0x2f5fc4, 0x2f5fc4]; COL[B.SNOW] = [0xf2f5f8, 0x86603e];
COL[B.ICE] = [0xa9c8f0, 0xa9c8f0]; COL[B.GRAVEL] = [0x8a8580, 0x8a8580];
COL[B.SANDSTONE] = [0xd2c088, 0xc9b47c]; COL[B.BEDROCK] = [0x3a3a3a, 0x3a3a3a];
COL[B.PLANKS] = [0xb08850, 0xa07a45]; COL[B.LOG] = [0x9a7a4a, 0x5e4426];
COL[B.COBBLE] = [0x8c8c8c, 0x7a7a7a]; COL[B.GLASS] = [0xc8e4f0, 0xb4d8ea]; COL[B.PATH] = [0xa08a5a, 0x86603e]; COL[B.ROOF] = [0x7a4a2a, 0x6a3e22];
const rgb = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const COLF = COL.map(p => p && [rgb(p[0]), rgb(p[1])]);
const solid = (b) => b !== B.AIR && b !== B.WATER;
const opaque = (b) => solid(b) && b !== B.ICE;

const world = (BF.world = {
  chunks: new Map(), meshes: new Map(), viewDist: 8, terrain: null, scene: null,
  matSolid: null, matWater: null, genCount: 0, meshCount: 0,
});
const key = (f, cx, cz) => f * NC * NC + cx * NC + cz;

world.init = function (scene, seed) {
  world.scene = scene;
  world.terrain = BF.makeTerrain(seed);
  world.matSolid = new THREE.MeshBasicMaterial({ vertexColors: true });
  world.matWater = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false });
};

function genChunk(f, cx, cz) {
  const c = { f, cx, cz, blocks: new Uint8Array(CS * CS * H), top: new Int16Array(CS * CS), tint: new Float32Array(CS * CS), dirty: true, edited: false };
  const d = [0, 0, 0];
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    P.dir(f, cx * CS + x + 0.5, cz * CS + z + 0.5, d);
    const base = z * CS + x;
    const s = world.terrain.column(d[0], d[1], d[2], (y, b) => { c.blocks[y * CS * CS + base] = b; });
    c.top[base] = s.h;
    c.tint[base] = Math.max(0, Math.min(1, (s.temp - 0.2) * 1.4)) * 0.5 + Math.max(-0.5, Math.min(0.5, s.wet));
  }
  // structures (villages) write their blocks that fall inside this chunk
  if (BF.villages) BF.villages.decorate(c);
  world.genCount++;
  return c;
}

world.chunk = function (f, cx, cz) {
  const k = key(f, cx, cz);
  let c = world.chunks.get(k);
  if (!c) { c = genChunk(f, cx, cz); world.chunks.set(k, c); }
  return c;
};

// Block at integer cell (f, i, j, y); cells off the face are looked up on the face they fall on.
const w = { f: 0, u: 0, v: 0 };
world.cell = function (f, i, j, out) {
  if (i >= 0 && i < P.N && j >= 0 && j < P.N) { out.f = f; out.u = i; out.v = j; return out; }
  P.wrap(f, i + 0.5, j + 0.5, out);
  out.u = Math.floor(out.u); out.v = Math.floor(out.v);
  return out;
};
world.get = function (f, i, j, y) {
  if (y < 0) return B.BEDROCK;
  if (y >= H) return B.AIR;
  world.cell(f, i, j, w);
  const c = world.chunk(w.f, w.u >> 4, w.v >> 4);
  return c.blocks[y * CS * CS + (w.v & 15) * CS + (w.u & 15)];
};
world.set = function (f, i, j, y, b) {
  if (y < 1 || y >= H) return;
  world.cell(f, i, j, w);
  const c = world.chunk(w.f, w.u >> 4, w.v >> 4), lx = w.u & 15, lz = w.v & 15;
  c.blocks[y * CS * CS + lz * CS + lx] = b;
  c.edited = true; c.dirty = true;
  let t = c.top[lz * CS + lx];
  if (solid(b) && y > t) t = y;
  else if (!solid(b) && y === t) while (t > 0 && !solid(c.blocks[t * CS * CS + lz * CS + lx])) t--;
  c.top[lz * CS + lx] = t;
  // neighbours share faces along chunk borders
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if ((lx + dx) >> 4 === 0 && (lz + dz) >> 4 === 0) continue;
    world.cell(w.f, w.u + dx, w.v + dz, w);
    const n = world.chunks.get(key(w.f, w.u >> 4, w.v >> 4));
    if (n) n.dirty = true;
    world.cell(f, i, j, w);
  }
};

// ---- meshing ----
const SHADE = { top: 1, bottom: 0.5, u: 0.82, v: 0.68 };

function buildMesh(c) {
  const { f, cx, cz } = c, u0 = cx * CS, v0 = cz * CS;
  // unit directions at the 17 x 17 grid corners of this chunk
  const dirs = new Float64Array(17 * 17 * 3), d = [0, 0, 0];
  for (let z = 0; z <= CS; z++) for (let x = 0; x <= CS; x++) {
    P.dir(f, u0 + x, v0 + z, d);
    const o = (z * 17 + x) * 3; dirs[o] = d[0]; dirs[o + 1] = d[1]; dirs[o + 2] = d[2];
  }
  const anchor = P.pos(f, u0 + 8, v0 + 8, P.SEA, [0, 0, 0]);
  // the lowest solid top in this chunk and its border ring bounds the layers that can show faces
  let lo = H;
  for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) {
    let t;
    if (x >= 0 && x < CS && z >= 0 && z < CS) t = c.top[z * CS + x];
    else { world.cell(f, u0 + x, v0 + z, w); t = world.chunk(w.f, w.u >> 4, w.v >> 4).top[(w.v & 15) * CS + (w.u & 15)]; }
    if (t < lo) lo = t;
  }
  lo = Math.max(0, lo - 1);
  const S = { p: [], c: [], i: [] }, W = { p: [], c: [], i: [] };
  const blk = c.blocks, SL = CS * CS;
  const at = (x, y, z) => {
    if (y < 0) return B.BEDROCK; if (y >= H) return B.AIR;
    if (x >= 0 && x < CS && z >= 0 && z < CS) return blk[y * SL + z * CS + x];
    return world.get(f, u0 + x, v0 + z, y);
  };
  const vtx = (M, x, y, z, col) => {
    const o = (z * 17 + x) * 3, r = P.R + (y - P.SEA);
    M.p.push(dirs[o] * r - anchor[0], dirs[o + 1] * r - anchor[1], dirs[o + 2] * r - anchor[2]);
    M.c.push(col[0], col[1], col[2]);
  };
  // quad from four (x, y, z) corners; flipped if its winding faces away from outward vector o
  const quad = (M, q, col, o) => {
    const n = M.p.length / 3;
    for (const v of q) vtx(M, v[0], v[1], v[2], col);
    const p = M.p;
    const ax = p[(n + 1) * 3] - p[n * 3], ay = p[(n + 1) * 3 + 1] - p[n * 3 + 1], az = p[(n + 1) * 3 + 2] - p[n * 3 + 2];
    const bx = p[(n + 2) * 3] - p[n * 3], by = p[(n + 2) * 3 + 1] - p[n * 3 + 1], bz = p[(n + 2) * 3 + 2] - p[n * 3 + 2];
    const cxp = ay * bz - az * by, cyp = az * bx - ax * bz, czp = ax * by - ay * bx;
    if (cxp * o[0] + cyp * o[1] + czp * o[2] >= 0) M.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
    else M.i.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  const dv = (x, z) => { const o = (z * 17 + x) * 3; return [dirs[o], dirs[o + 1], dirs[o + 2]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const neg = (a) => [-a[0], -a[1], -a[2]];
  const col = [0, 0, 0];
  const shade = (base, s, x, y, z) => {
    const j = 0.94 + 0.06 * ((((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000) / 1000;
    col[0] = base[0] * s * j; col[1] = base[1] * s * j; col[2] = base[2] * s * j;
    return col;
  };
  for (let y = lo; y < H - 1; y++) {
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = blk[y * SL + z * CS + x];
      if (b === B.AIR) continue;
      if (b === B.WATER) {
        if (at(x, y + 1, z) === B.AIR) {
          const t = y + 0.875;
          quad(W, [[x, t, z], [x + 1, t, z], [x + 1, t, z + 1], [x, t, z + 1]], shade(COLF[B.WATER][0], 1, x, y, z), dv(x, z));
        }
        continue;
      }
      let topCol = COLF[b][0];
      if (b === B.GRASS) {
        const t = c.tint[z * CS + x];  // dry yellow-green to lush green
        topCol = [0.42 + 0.25 * (0.5 - t) * 0.6, 0.66 - 0.1 * Math.abs(t), 0.31 - 0.1 * t];
      }
      const sideCol = COLF[b][1];
      const show = (n) => !opaque(n) && n !== b;
      if (show(at(x, y + 1, z))) quad(S, [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], shade(topCol, SHADE.top, x, y, z), dv(x, z));
      if (y > 0 && show(at(x, y - 1, z))) quad(S, [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], shade(sideCol, SHADE.bottom, x, y, z), neg(dv(x, z)));
      if (show(at(x - 1, y, z))) quad(S, [[x, y, z], [x, y + 1, z], [x, y + 1, z + 1], [x, y, z + 1]], shade(sideCol, SHADE.u, x, y, z), sub(dv(x, z), dv(x + 1, z)));
      if (show(at(x + 1, y, z))) quad(S, [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], shade(sideCol, SHADE.u, x, y, z), sub(dv(x + 1, z), dv(x, z)));
      if (show(at(x, y, z - 1))) quad(S, [[x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]], shade(sideCol, SHADE.v, x, y, z), sub(dv(x, z), dv(x, z + 1)));
      if (show(at(x, y, z + 1))) quad(S, [[x, y, z + 1], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], shade(sideCol, SHADE.v, x, y, z), sub(dv(x, z + 1), dv(x, z)));
    }
  }
  const group = new THREE.Group();
  for (const [M, mat] of [[S, world.matSolid], [W, world.matWater]]) {
    if (!M.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(M.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(M.c, 3));
    g.setIndex(M.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(M.i, 1) : new THREE.Uint16BufferAttribute(M.i, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    if (mat === world.matWater) m.renderOrder = 1;
    group.add(m);
  }
  group.userData.anchor = anchor;
  world.meshCount++;
  return group;
}

function dropMesh(k) {
  const g = world.meshes.get(k);
  if (!g) return;
  world.scene.remove(g);
  for (const m of g.children) m.geometry.dispose();
  world.meshes.delete(k);
}

// Chunks wanted around a grid position, nearest first (sampled in grid steps, so they run across face edges).
let wantKey = null, want = [];
function wanted(f, u, v) {
  const id = f + ":" + Math.floor(u / CS) + ":" + Math.floor(v / CS) + ":" + world.viewDist;
  if (id === wantKey) return want;
  wantKey = id;
  const seen = new Map(), V = world.viewDist, g = { f: 0, u: 0, v: 0 };
  const bu = (Math.floor(u / CS) + 0.5) * CS, bv = (Math.floor(v / CS) + 0.5) * CS;
  for (let dz = -V; dz <= V; dz++) for (let dx = -V; dx <= V; dx++) {
    const d2 = dx * dx + dz * dz;
    if (d2 > V * V + V) continue;
    P.wrap(f, bu + dx * CS, bv + dz * CS, g);
    const k = key(g.f, g.u >> 4, g.v >> 4);
    if (!seen.has(k) || seen.get(k).d2 > d2) seen.set(k, { k, f: g.f, cx: g.u >> 4, cz: g.v >> 4, d2 });
  }
  want = [...seen.values()].sort((a, b) => a.d2 - b.d2);
  return want;
}

// Called each frame: builds missing or edited meshes within a time budget, drops far ones,
// and places every mesh relative to the camera's 3D position.
world.update = function (f, u, v, eye, budgetMs = 6) {
  const list = wanted(f, u, v), keep = new Set();
  const t0 = performance.now();
  for (const e of list) {
    keep.add(e.k);
    const c = world.chunks.get(e.k);
    if (world.meshes.has(e.k) && c && !c.dirty) continue;
    if (performance.now() - t0 > budgetMs && world.meshes.has(e.k)) continue;
    if (performance.now() - t0 > budgetMs) break;
    const ch = world.chunk(e.f, e.cx, e.cz);
    dropMesh(e.k);
    const g = buildMesh(ch);
    ch.dirty = false;
    world.meshes.set(e.k, g);
    world.scene.add(g);
  }
  for (const k of [...world.meshes.keys()]) if (!keep.has(k)) dropMesh(k);
  // forget unedited chunk data well outside the view
  if (world.chunks.size > list.length * 3) {
    for (const [k, c] of world.chunks) if (!keep.has(k) && !c.edited) world.chunks.delete(k);
  }
  for (const g of world.meshes.values()) {
    const a = g.userData.anchor;
    g.position.set(a[0] - eye[0], a[1] - eye[1], a[2] - eye[2]);
  }
  return { wanted: list.length, meshed: world.meshes.size };
};

world.reset = function () {
  for (const k of [...world.meshes.keys()]) dropMesh(k);
  world.chunks.clear();
  wantKey = null;
};

world.solid = solid;

// Does a box of half-width hw and height ht with its feet centred at (u, v, y) on face f touch a solid block?
world.boxHits = function (f, u, v, y, hw, ht) {
  for (let i = Math.floor(u - hw); i <= Math.floor(u + hw - 1e-6); i++)
    for (let j = Math.floor(v - hw); j <= Math.floor(v + hw - 1e-6); j++)
      for (let k = Math.floor(y); k <= Math.floor(y + ht - 1e-6); k++)
        if (solid(world.get(f, i, j, k))) return true;
  return false;
};
})();
