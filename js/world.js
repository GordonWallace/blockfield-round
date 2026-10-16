// Chunks (16 x 16 columns on one face, full height), block access across face edges, and meshing.
//
// Drawing has two views, blended by world.view.k:
//  - Flat (k = 0, near the ground): the player's face grid is drawn flat, exactly like a flat world,
//    so every block is square. Chunks on a neighbouring face are unfolded rigidly across the shared
//    edge (a 90-degree rotation plus an offset). Around a cube corner only three faces meet, so a
//    90-degree wedge is left empty there.
//  - Round (k = 1, high up): every vertex sits at its true place on the sphere.
// Each mesh carries both positions (flat ones chunk-local, round ones relative to the chunk's anchor)
// and a small shader mixes them. Both are placed relative to the eye each frame (floating origin), so
// float32 precision holds anywhere on the planet.
//
// Render space: x = grid u, y = layer (up), z = -grid v, with the eye at the origin. In the round view
// the sphere is turned so the player's local up, u and v directions line up with those axes.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, CS = 16, H = P.H, NC = P.N / CS;

// Block colours (top, side). Vertex colours stand in for textures in this prototype.
const COL = [];
COL[B.STONE] = [0x7d7d7d, 0x7d7d7d]; COL[B.DIRT] = [0x86603e, 0x86603e];
COL[B.GRASS] = [0x6aa84f, 0x86603e]; COL[B.SAND] = [0xdbcf9a, 0xdbcf9a];
COL[B.WATER] = [0x2f5fc4, 0x2f5fc4]; COL[B.SNOW] = [0xf2f5f8, 0xdfe5ea];
COL[B.ICE] = [0xa9c8f0, 0xa9c8f0]; COL[B.GRAVEL] = [0x8a8580, 0x8a8580];
COL[B.SANDSTONE] = [0xd2c088, 0xc9b47c]; COL[B.BEDROCK] = [0x3a3a3a, 0x3a3a3a];
COL[B.PLANKS] = [0xb08850, 0xa07a45]; COL[B.LOG] = [0x9a7a4a, 0x5e4426];
COL[B.LEAVES] = [0x4a8a2a, 0x4a8a2a]; COL[B.BIRCH_LOG] = [0xc8b07a, 0xd9d6cc]; COL[B.SPRUCE_LOG] = [0x6e5434, 0x3e2c1a];
COL[B.SPRUCE_LEAVES] = [0x3a5e3a, 0x3a5e3a]; COL[B.JUNGLE_LOG] = [0x9a7a40, 0x5a4a22]; COL[B.JUNGLE_LEAVES] = [0x3a9a24, 0x3a9a24];
COL[B.ACACIA_LOG] = [0xb0603a, 0x6a6460]; COL[B.ACACIA_LEAVES] = [0x7a8a2a, 0x7a8a2a]; COL[B.BIRCH_LEAVES] = [0x6a9a4a, 0x6a9a4a];
COL[B.DARK_LEAVES] = [0x2f5a1c, 0x2f5a1c]; COL[B.CHERRY_LEAVES] = [0xf0b8d0, 0xf0b8d0]; COL[B.MANGROVE_LEAVES] = [0x4a7a2a, 0x4a7a2a];
COL[B.CACTUS] = [0x5a8a3a, 0x4a7a2e]; COL[B.RED_SAND] = [0xbe6a32, 0xbe6a32]; COL[B.TERRACOTTA] = [0x9a5a3e, 0x9a5a3e];
COL[B.COBBLE] = [0x8c8c8c, 0x7a7a7a]; COL[B.GLASS] = [0xc8e4f0, 0xb4d8ea]; COL[B.PATH] = [0xa08a5a, 0x86603e]; COL[B.ROOF] = [0x7a4a2a, 0x6a3e22];
const rgb = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const COLF = COL.map(p => p && [rgb(p[0]), rgb(p[1])]);
const solid = (b) => b !== B.AIR && b !== B.WATER;
const GRASS = BF.climate.GRASS;
const opaque = (b) => solid(b) && b !== B.ICE;

const world = (BF.world = {
  chunks: new Map(), meshes: new Map(), viewDist: 32, terrain: null, scene: null,
  // false high up, where blocks are smaller than a pixel: no chunks are loaded around the player (main.js decides)
  chunksOn: true,
  matSolid: null, matWater: null, genCount: 0, meshCount: 0,
});
const key = (f, cx, cz) => f * NC * NC + cx * NC + cz;

// Shared by every chunk material, so one write per frame updates them all.
const shared = {
  k: { value: 0 }, fogColor: { value: new THREE.Color(0x8fbde8) }, fogNear: { value: 80 }, fogFar: { value: 120 },
  pxScale: { value: 700 },   // pixels across one block one block away (screen height / (2 tan(fov / 2))); main.js sets it
  // each face's outward normal and grid axes, for finding a point's face and grid position in a shader (CHARTS)
  faceN: { value: P.FACES.map((F) => new THREE.Vector3(...F.n)) },
  faceA: { value: P.FACES.map((F) => new THREE.Vector3(...F.a)) },
  faceB: { value: P.FACES.map((F) => new THREE.Vector3(...F.b)) },
};
const VERT = `
attribute vec3 sphere;
attribute vec3 color;
uniform mat4 flatM;
uniform mat4 sphM;
uniform float k;
varying vec3 vColor;
varying float vDist;
varying vec2 vG;
#ifdef MORPH
// distant terrain: each vertex also carries where the next coarser ring would put it (and its colour there),
// and moves there across the outer part of its ring, so one level of detail fades into the next
attribute vec3 mflat;
attribute vec3 msph;
attribute vec3 mcol;
uniform vec2 morph;   // grid distances from the ring's centre where morphing starts and ends
#endif
#ifdef GLOBE
attribute vec2 grid;  // the globe: grid position on its own face, and the map into the view face's grid
uniform mat3 unf;
#endif
#ifdef CANOPY
// distant terrain and the globe: the average colour of the tree crowns and the fraction of ground they cover
attribute vec4 canopy;
varying vec4 vCanopy;
#endif
#ifdef CHARTS
uniform vec3 anchor;   // what sphere positions are relative to (the planet's centre for the globe)
varying vec3 vP;       // position relative to the planet's centre
#endif
void main() {
  vec3 a = (flatM * vec4(position, 1.0)).xyz;
  vec3 b = (sphM * vec4(sphere, 1.0)).xyz;
  vec3 col = color;
#ifdef CHARTS
  vP = anchor + sphere;
#endif
#ifdef MORPH
  float m = smoothstep(morph.x, morph.y, length(position.xz));
  if (m > 0.0) {
    a = mix(a, (flatM * vec4(mflat, 1.0)).xyz, m);
    b = mix(b, (sphM * vec4(msph, 1.0)).xyz, m);
    col = mix(color, mcol, m);
    vP = anchor + mix(sphere, msph, m);
  }
#endif
#ifdef GLOBE
  vG = (unf * vec3(grid, 1.0)).xy;
#else
  vG = position.xz;
#endif
  vec3 w = mix(a, b, k);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vColor = col;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
#ifdef CANOPY
  vCanopy = canopy;
#endif
}`;
const FRAG = `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float opacity;
uniform vec3 tint;
uniform vec3 hole;
uniform vec3 hole2;
uniform vec3 outer;
uniform float pxScale;
uniform float stand;
uniform vec2 edge;
// how far stand-ins show at distance d: fully while a 10-block patch is 2 pixels or more, not at all below 1
#define NEAR(d) clamp(10.0 * pxScale / (d) - 1.0, 0.0, 1.0)
varying vec3 vColor;
varying float vDist;
varying vec2 vG;
#ifdef CANOPY
varying vec4 vCanopy;
#endif
#ifdef CHARTS
// Distant terrain and the globe test their holes by where each point is in the grid the hole belongs to:
// its own face and grid position (from its direction, as P.fromDir does), unfolded into that grid
// (toHole: the view face's, where the loaded chunks are; toHole2: the next finer ring's). Measuring both
// sides of every cut the same way keeps them matched near a cube corner, where unfolding depends on the
// route taken around the corner (measured in each mesh's own grid, they left black slivers there).
uniform vec3 faceN[6];
uniform vec3 faceA[6];
uniform vec3 faceB[6];
uniform mat3 toHole[6];
uniform mat3 toHole2[6];
uniform float seam2;   // width of the strip along the finer ring's corner wedge that it leaves to coarser terrain
varying vec3 vP;
#endif
void main() {
  // distant terrain leaves a hole where the loaded chunks are and one where the next finer ring is drawn,
  // and each ring stops at its own edge: discs (centre x, z; radius)
#ifdef CHARTS
  float best = -2.0;
  int fi = 0;
  vec3 fa = faceA[0], fb = faceB[0];
  for (int i = 0; i < 6; i++) {
    float c = dot(vP, faceN[i]);
    if (c > best) { best = c; fi = i; fa = faceA[i]; fb = faceB[i]; }
  }
  vec3 g = vec3((vec2(atan(dot(vP, fa) / best), atan(dot(vP, fb) / best)) / 0.7853981633974483 + 1.0) * (FACE_N * 0.5), 1.0);
  vec2 gh = vec2(1e9), gh2 = vec2(1e9);
  for (int i = 0; i < 6; i++) if (i == fi) { gh = (toHole[i] * g).xy; gh2 = (toHole2[i] * g).xy; }
  bool inner = hole2.z > 0.0 && length(gh2 - hole2.xy) < hole2.z;
  // The finer ring can't join the two faces that meet beyond a cube corner of its grid (it has no samples in
  // the corner's empty wedge), which leaves a crack about one of its cells wide along that edge and around
  // the corner itself: this fills it (near a corner of the grid's face along both axes, or past it).
  bool nu = gh2.x < seam2 || gh2.x > FACE_N - seam2, nv = gh2.y < seam2 || gh2.y > FACE_N - seam2;
  if (nu && nv) inner = false;
  bool eye = hole.z > 0.0 && length(gh - hole.xy) < hole.z;
#else
  bool inner = hole2.z > 0.0 && length(vG - hole2.xy) < hole2.z;
  bool eye = hole.z > 0.0 && length(vG - hole.xy) < hole.z;
#endif
  if (eye || inner || (outer.z > 0.0 && length(vG - outer.xy) > outer.z)) discard;
  vec3 col = vColor;
#ifdef CANOPY
  // Tree crowns: where stand-ins are drawn (stand: the share of trees that have one) the canopy colour gives way as they show (see
  // STAND_VERT: until a 10-block patch is a pixel across); elsewhere the ground always takes it. Either way
  // the average colour holds at every distance.
  col = mix(col, vCanopy.rgb, vCanopy.a * (1.0 - stand * NEAR(vDist) * (1.0 - smoothstep(edge.x, edge.y, length(vG)))));
#endif
  gl_FragColor = vec4(mix(col * tint, fogColor, smoothstep(fogNear, fogFar, vDist)), opacity);
}`;
// Stand-ins for trees and houses (lod.js, grid.js): instanced, one per tree or house, either as two boxes
// (BOXES: a trunk and a crown, or walls and a roof; position is a corner of a unit box) or as one point.
// Each is placed at its foot (base, flat; sph, round) and built out along the grid axes there (frame: grid u,
// up and grid v as planet-space vectors at the ring's centre, close enough across a ring).
const STAND_VERT = `
attribute vec3 base;
attribute vec3 sph;
attribute vec3 top;
attribute vec3 low;
attribute vec4 a;   // trunk width x, z, height, crown top width (of 255)
attribute vec4 b;   // crown width x, z, height, random byte
attribute float c;  // crown bottom
#ifdef BOXES
attribute float part;
attribute float shade;
#endif
uniform mat4 flatM;
uniform mat4 sphM;
uniform mat3 frame;
uniform float k;
uniform float pxScale;
uniform vec2 edge;
uniform vec3 hole;
uniform vec3 hole2;
uniform vec3 outer;
varying vec3 vColor;
varying float vDist;
varying vec2 vG;
#define NEAR(d) clamp(10.0 * pxScale / (d) - 1.0, 0.0, 1.0)
void main() {
#ifndef BOXES
  gl_PointSize = 1.0;   // dropped points still need a size, or some drivers draw them huge
#endif
  vG = base.xz;
  // outside this ring's own part (see FRAG): dropped here, before it costs any pixels
  if ((hole.z > 0.0 && length(vG - hole.xy) < hole.z) || (hole2.z > 0.0 && length(vG - hole2.xy) < hole2.z) || (outer.z > 0.0 && length(vG - outer.xy) > outer.z)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;
  }
  vec3 w0 = mix((flatM * vec4(base, 1.0)).xyz, (sphM * vec4(sph, 1.0)).xyz, k);
  float d = length((viewMatrix * vec4(w0, 1.0)).xyz);
  // Shown while a 10-block patch is a pixel or more (the ground's canopy colour takes over beyond, and
  // across the outer edge of the last ring with stand-ins); when smaller than a pixel, drawn as one pixel by
  // a share of them that keeps the covered area right. The random byte decides which ones.
  float px = max(b.x, b.y) * pxScale / d;
  float show = NEAR(d) * (1.0 - smoothstep(edge.x, edge.y, length(base.xz))) * min(1.0, px * px);
  if (b.w >= 256.0 * show) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#ifdef BOXES
  bool up = part > 0.5;
  vec2 wd = up ? b.xy * mix(1.0, a.w / 255.0, position.y) : a.xy;
  vec3 l = vec3(position.x * wd.x, up ? c + position.y * b.z : position.y * a.z, position.z * wd.y);
  vColor = (up ? top : low) * shade;
#else
  vec3 l = vec3(0.0, c + 0.5 * b.z, 0.0);
  vColor = top;
  gl_PointSize = max(px, 1.0);
#endif
  vec3 w = mix((flatM * vec4(base + l, 1.0)).xyz, (sphM * vec4(sph + frame * l, 1.0)).xyz, k);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// kind: "morph" for distant-terrain rings, "globe" for the globe, "boxes" or "points" for stand-ins.
function material(water, kind = null) {
  const defines = kind === "morph" ? { MORPH: 1, CANOPY: 1, CHARTS: 1, FACE_N: P.N.toFixed(1) }
    : kind === "globe" ? { GLOBE: 1, CANOPY: 1, CHARTS: 1, FACE_N: P.N.toFixed(1) }
    : kind === "boxes" ? { BOXES: 1 } : {};
  const stand = kind === "boxes" || kind === "points";
  const m = new THREE.ShaderMaterial({
    vertexShader: stand ? STAND_VERT : VERT, fragmentShader: FRAG, defines, side: kind === "boxes" ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      ...shared, flatM: { value: new THREE.Matrix4() }, sphM: { value: new THREE.Matrix4() }, opacity: { value: water ? 0.72 : 1 },
      tint: { value: new THREE.Color(1, 1, 1) }, hole: { value: new THREE.Vector3() }, hole2: { value: new THREE.Vector3() }, outer: { value: new THREE.Vector3() },
      morph: { value: new THREE.Vector2(1e30, 2e30) }, unf: { value: new THREE.Matrix3() }, stand: { value: 0 },
      edge: { value: new THREE.Vector2(1e30, 2e30) }, frame: { value: new THREE.Matrix3() },
      anchor: { value: new THREE.Vector3() }, seam2: { value: 0 },
      toHole: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix3()) }, toHole2: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Matrix3()) },
    },
    transparent: water, depthWrite: !water,
  });
  return m;
}
world.material = material;
// Top colour of block b in biome bi (grass takes the biome's colour).
world.topColour = (b, bi) => b === B.GRASS ? GRASS[bi] : COLF[b][0];
world.shared = shared;

world.init = function (scene, seed) {
  world.scene = scene;
  world.terrain = BF.makeTerrain(seed);
};

// What the camera sees from: the player's face and grid position, eye layer, eye position on the sphere,
// the rotation M (rows: render x, y, z axes in planet space) and the blend k. main.js fills it each frame.
world.view = { f: 0, u: 0, v: 0, eyeY: 0, eye: [0, 0, 0], M: [1, 0, 0, 0, 1, 0, 0, 0, 1], k: 0 };

// Sets m to the map from face g's grid into face f's (the unfold as a 3x3 matrix), or far away if g can't be
// unfolded next to f (the far side).
world.unfoldMatrix = function (m, f, g) {
  const e = unfold(f, g);
  if (!e) m.set(0, 0, 1e9, 0, 0, 1e9, 0, 0, 1);
  else m.set(e.A[0], e.A[1], e.t[0], e.A[2], e.A[3], e.t[1], 0, 0, 1);
  return m;
};

// The rigid map { A, t } from face g's grid into the view face f's flat grid (see P.EDGE), or null
// when g is the opposite face (never drawn flat).
const IDENT = { A: [1, 0, 0, 1], t: [0, 0] };
function unfold(f, g) { return f === g ? IDENT : P.UNFOLD[f][g] || null; }
world.unfold = unfold;

// Render-space position of grid point (g, u, v) at layer y, in the current blend.
world.toRender = function (g, u, v, y, out) {
  const V = world.view, k = V.k, e = unfold(V.f, g);
  let fx = 0, fy = y - V.eyeY, fz = 0;
  if (e) {
    const U = e.A[0] * u + e.A[1] * v + e.t[0], W = e.A[2] * u + e.A[3] * v + e.t[1];
    fx = U - V.u; fz = -(W - V.v);
  }
  if (k <= 0 && e) { out[0] = fx; out[1] = fy; out[2] = fz; return out; }
  const p = P.pos(g, u, v, y, [0, 0, 0]), M = V.M;
  const dx = p[0] - V.eye[0], dy = p[1] - V.eye[1], dz = p[2] - V.eye[2];
  const sx = M[0] * dx + M[1] * dy + M[2] * dz, sy = M[3] * dx + M[4] * dy + M[5] * dz, sz = M[6] * dx + M[7] * dy + M[8] * dz;
  if (!e) { out[0] = sx; out[1] = sy; out[2] = sz; return out; }
  out[0] = fx + (sx - fx) * k; out[1] = fy + (sy - fy) * k; out[2] = fz + (sz - fz) * k;
  return out;
};
// Render-space direction of a 3D tangent vector d at grid point (g, u, v), in the current blend.
world.dirToRender = function (g, u, v, y, d) {
  const V = world.view, k = V.k, e = unfold(V.f, g), M = V.M;
  const s = [M[0] * d[0] + M[1] * d[1] + M[2] * d[2], M[3] * d[0] + M[4] * d[1] + M[5] * d[2], M[6] * d[0] + M[7] * d[1] + M[8] * d[2]];
  if (!e) return s;
  const fr = P.frame(g, u, v, y, {}), up = fr.up, dot = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const [du, dv] = P.toGrid([d[0] - up[0] * dot, d[1] - up[1] * dot, d[2] - up[2] * dot], fr);
  const U = e.A[0] * du + e.A[1] * dv, W = e.A[2] * du + e.A[3] * dv;
  const l = Math.hypot(U, W) || 1, h = Math.hypot(d[0] - up[0] * dot, d[1] - up[1] * dot, d[2] - up[2] * dot);
  const fl = [U / l * h, dot, -W / l * h];
  return [fl[0] + (s[0] - fl[0]) * k, fl[1] + (s[1] - fl[1]) * k, fl[2] + (s[2] - fl[2]) * k];
};

function genChunk(f, cx, cz) {
  const c = { f, cx, cz, blocks: new Uint8Array(CS * CS * H), top: new Int16Array(CS * CS), biome: new Uint8Array(CS * CS), dirty: true, edited: false };
  const d = [0, 0, 0];
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    P.dir(f, cx * CS + x + 0.5, cz * CS + z + 0.5, d);
    const base = z * CS + x;
    const s = world.terrain.column(f, cx * CS + x, cz * CS + z, d, (y, b) => { c.blocks[y * CS * CS + base] = b; });
    c.top[base] = s.h;
    c.biome[base] = s.biome;
  }
  // trees, then structures (villages), write their blocks that fall inside this chunk
  if (BF.flora) BF.flora.decorate(c);
  if (BF.villages) BF.villages.decorate(c);
  world.genCount++;
  return c;
}

world.loaded = (f, cx, cz) => world.chunks.has(key(f, cx, cz));
world.chunk = function (f, cx, cz) {
  const k = key(f, cx, cz);
  let c = world.chunks.get(k);
  if (!c) {
    c = genChunk(f, cx, cz);
    if (world.meshes.has(k)) c.dirty = false;   // generated again after being let go: its mesh is still right
    world.chunks.set(k, c);
  }
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
  const S = { s: [], f: [], c: [], i: [] }, W = { s: [], f: [], c: [], i: [] };
  const blk = c.blocks, SL = CS * CS;
  const at = (x, y, z) => {
    if (y < 0) return B.BEDROCK; if (y >= H) return B.AIR;
    if (x >= 0 && x < CS && z >= 0 && z < CS) return blk[y * SL + z * CS + x];
    return world.get(f, u0 + x, v0 + z, y);
  };
  const vtx = (M, x, y, z, col) => {
    const o = (z * 17 + x) * 3, r = P.R + (y - P.SEA);
    M.s.push(dirs[o] * r - anchor[0], dirs[o + 1] * r - anchor[1], dirs[o + 2] * r - anchor[2]);
    M.f.push(x, y, z);
    M.c.push(col[0], col[1], col[2]);
  };
  // quad from four (x, y, z) corners; flipped if its winding faces away from outward vector o
  const quad = (M, q, col, o) => {
    const n = M.s.length / 3;
    for (const v of q) vtx(M, v[0], v[1], v[2], col);
    const p = M.s;
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
      if (b === B.GRASS) topCol = GRASS[c.biome[z * CS + x]];
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
  for (const [M, water] of [[S, false], [W, true]]) {
    if (!M.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(M.f, 3).onUpload(freeArray));
    g.setAttribute("sphere", new THREE.Float32BufferAttribute(M.s, 3).onUpload(freeArray));
    g.setAttribute("color", new THREE.Uint8BufferAttribute(M.c.map((x) => Math.round(Math.min(1, x) * 255)), 3, true).onUpload(freeArray));
    g.setIndex((M.s.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(M.i, 1) : new THREE.Uint16BufferAttribute(M.i, 1)).onUpload(freeArray));
    const m = new THREE.Mesh(g, material(water));
    m.frustumCulled = false;   // placement happens in the shader
    if (water) m.renderOrder = 1;
    group.add(m);
  }
  group.userData = { anchor, f, cx, cz };
  world.meshCount++;
  return group;
}

// A chunk mesh's arrays are only needed until they are on the GPU (a mesh is rebuilt from blocks if it changes).
function freeArray() { this.array = null; }

function dropMesh(k) {
  const g = world.meshes.get(k);
  if (!g) return;
  world.scene.remove(g);
  for (const m of g.children) { m.geometry.dispose(); m.material.dispose(); }
  world.meshes.delete(k);
}

// Chunks wanted around a grid position, nearest first. Sampled in the view face's flat grid: past one edge
// a sample lands on the unfolded neighbour; past two edges it is inside a corner's empty wedge and skipped.
let wantKey = null, want = [];
function wanted(f, u, v) {
  const round = world.view.k > 0;
  const id = f + ":" + Math.floor(u / CS) + ":" + Math.floor(v / CS) + ":" + world.viewDist + ":" + round;
  if (id === wantKey) return want;
  wantKey = id;
  const seen = new Map(), V = world.viewDist, g = { f: 0, u: 0, v: 0 };
  const bu = (Math.floor(u / CS) + 0.5) * CS, bv = (Math.floor(v / CS) + 0.5) * CS;
  for (let dz = -V; dz <= V; dz++) for (let dx = -V; dx <= V; dx++) {
    const d2 = dx * dx + dz * dz;
    if (d2 > V * V + V) continue;
    const su = bu + dx * CS, sv = bv + dz * CS;
    // inside a corner's wedge: nothing to draw flat, but the round view fills it from the nearest face
    if (!round && (su < 0 || su >= P.N) && (sv < 0 || sv >= P.N)) continue;
    P.wrap(f, su, sv, g);
    const k = key(g.f, g.u >> 4, g.v >> 4);
    if (!seen.has(k) || seen.get(k).d2 > d2) seen.set(k, { k, f: g.f, cx: g.u >> 4, cz: g.v >> 4, d2 });
  }
  want = [...seen.values()].sort((a, b) => a.d2 - b.d2);
  return want;
}

// Called each frame: builds missing or edited meshes within a time budget, drops far ones,
// and places every mesh for the current view (see world.view). With chunks off, all meshes go.
world.update = function (budgetMs = 6) {
  const V = world.view, list = world.chunksOn ? wanted(V.f, V.u, V.v) : [], keep = new Set();
  const t0 = performance.now();
  for (const e of list) keep.add(e.k);
  for (const e of list) {
    const c = world.chunks.get(e.k);
    if (world.meshes.has(e.k) && !(c && c.dirty)) continue;   // meshed (its data may have been let go)
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
  forget(list);
  for (const g of world.meshes.values()) place(g);
  // how far out every wanted chunk has a mesh (distant terrain fills in beyond that while chunks load)
  const gap = list.find((e) => !world.meshes.has(e.k));
  world.covered = !world.chunksOn ? 0 : gap ? Math.max(0, Math.sqrt(gap.d2) - 1) * CS : world.viewDist * CS;
  return { wanted: list.length, meshed: world.meshes.size };
};

// Block data is kept only where it is needed: near the player (for walking, building and sheep), for chunks
// still to be meshed and their neighbours (meshing reads one column past each side), and wherever the player
// has changed something. Further out, once a chunk and its neighbours have meshes, only the mesh is kept,
// which is what lets the view reach far. Runs every so often, once enough data has piled up.
const KEEP = 8;   // chunks from the player whose data always stays
let lastForget = 0;
function forget(list) {
  if (world.chunks.size < lastForget + 256 && list.length) return;
  const want = new Map();
  for (const e of list) want.set(e.k, e);
  const g = { f: 0, u: 0, v: 0 }, pending = (c, dx, dz) => {
    world.cell(c.f, c.cx * CS + dx * CS, c.cz * CS + dz * CS, g);
    const k = key(g.f, g.u >> 4, g.v >> 4);
    return want.has(k) && !world.meshes.has(k);
  };
  for (const [k, c] of world.chunks) {
    if (c.edited) continue;
    const e = want.get(k);
    if (e && (e.d2 <= KEEP * KEEP || !world.meshes.has(k) || c.dirty)) continue;
    if (e && (pending(c, 1, 0) || pending(c, -1, 0) || pending(c, 0, 1) || pending(c, 0, -1))) continue;
    world.chunks.delete(k);
  }
  lastForget = world.chunks.size;
}

// Sets a chunk's two placements: flat (chunk-local grid -> unfolded view grid -> render space) and
// round (anchor-relative sphere -> rotated by M, relative to the eye).
// Face tints for the B key, so face edges and the three faces at a corner are easy to tell apart.
const FACE_TINT = [[1, 0.78, 0.78], [0.8, 1, 0.8], [0.8, 0.85, 1], [1, 1, 0.7], [1, 0.8, 1], [0.75, 1, 1]];
world.showFaces = false;
function place(grp) {
  const V = world.view, { anchor, f, cx, cz } = grp.userData, e = unfold(V.f, f), M = V.M;
  const tint = world.showFaces ? FACE_TINT[f] : [1, 1, 1];
  grp.visible = !!e || V.k >= 1;
  if (!grp.visible) return;
  const ax = anchor[0] - V.eye[0], ay = anchor[1] - V.eye[1], az = anchor[2] - V.eye[2];
  for (const m of grp.children) {
    const u = m.material.uniforms;
    u.tint.value.setRGB(tint[0], tint[1], tint[2]);
    u.sphM.value.set(
      M[0], M[1], M[2], M[0] * ax + M[1] * ay + M[2] * az,
      M[3], M[4], M[5], M[3] * ax + M[4] * ay + M[5] * az,
      M[6], M[7], M[8], M[6] * ax + M[7] * ay + M[8] * az,
      0, 0, 0, 1);
    if (!e) { u.flatM.value.copy(u.sphM.value); continue; }   // never happens below k = 1
    const A = e.A, u0 = cx * CS, v0 = cz * CS;
    u.flatM.value.set(
      A[0], 0, A[1], A[0] * u0 + A[1] * v0 + e.t[0] - V.u,
      0, 1, 0, -V.eyeY,
      -A[2], 0, -A[3], -(A[2] * u0 + A[3] * v0 + e.t[1] - V.v),
      0, 0, 0, 1);
  }
}

world.reset = function () {
  for (const k of [...world.meshes.keys()]) dropMesh(k);
  world.chunks.clear();
  wantKey = null;
};

world.solid = solid;
world.place = place;

// Does a box of half-width hw and height ht with its feet centred at (u, v, y) on face f touch a solid block?
world.boxHits = function (f, u, v, y, hw, ht) {
  for (let i = Math.floor(u - hw); i <= Math.floor(u + hw - 1e-6); i++)
    for (let j = Math.floor(v - hw); j <= Math.floor(v + hw - 1e-6); j++)
      for (let k = Math.floor(y); k <= Math.floor(y + ht - 1e-6); k++)
        if (solid(world.get(f, i, j, k))) return true;
  return false;
};
})();
