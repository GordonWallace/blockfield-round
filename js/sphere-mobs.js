// Sheep on the true sphere: they stand on the blocks, wander, and follow a player holding wheat, finding their
// way with A* over the sphere grid (sphere-path.js), where each step costs its real distance.
//
// A sheep's position is a point on the sphere (a unit vector) and a layer, like the player's. It walks
// towards the centre of the next block on its path along a great circle, at a fixed speed in real blocks per
// second, so its trips take as long as they would on a real sphere. The grid only says which block it is on.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const S = BF.sphere, B = BF.B, SP = BF.spherePath, R = S.R, SEA = S.SEA;
const W = () => BF.sworld;

const WANDER = 1.0, FOLLOW = 3.2, SEE = 16, CLIMB = 1;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const solid = (b) => b !== undefined && b !== B.AIR && b !== B.WATER && !(BF.flora && BF.flora.isLeaves(b));

// The layer a mob stands on in column (r, c): the highest ground block with two open blocks above it, at
// or below `from` + CLIMB (so a sheep under a tree stands on the ground, not the canopy). -1 for water.
function ground(r, c, from = S.H - 3) {
  const get = W().get;
  for (let y = Math.min(S.H - 3, from + CLIMB); y > 1; y--) {
    const b = get(r, c, y);
    if (b === B.WATER) return -1;
    if (solid(b) && !solid(get(r, c, y + 1)) && !solid(get(r, c, y + 2))) return y;
  }
  return -1;
}
const cellOf = (p) => { const g = S.latLonOf(p[0], p[1], p[2]), b = S.fromLatLon(g.lat, g.lon); return [Math.floor(b.r), Math.floor(b.c)]; };
const centreDir = (r, c) => { const g = S.toLatLon(r + 0.5, c + 0.5); return S.dir(g.lat, g.lon); };

const sheep = [];
let wheat = false, rngState = 12345;
const rnd = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Plans a path from the sheep's block to (r1, c1): steps only onto dry ground no more than one block up
// (any drop is allowed, as for a falling sheep, but capped at 3).
function plan(s, r1, c1, maxNodes) {
  const [r0, c0] = cellOf(s.p), hs = new Map();
  const gAt = (r, c) => { const k = r * 1048576 + c; if (!hs.has(k)) hs.set(k, ground(r, c)); return hs.get(k); };
  const walkable = (r, c) => gAt(r, c) >= 0;
  const canStep = (r, c, r2, c2) => { const a = gAt(r, c), b = gAt(r2, c2); return b - a <= CLIMB && a - b <= 3; };
  const path = SP.astar(r0, c0, r1, c1, walkable, maxNodes, canStep);
  s.path = path ? path.slice(1) : null;
  s.planned = path ? SP.length(path) : 0;
}

function spawnNear(p, count) {
  const [r0, c0] = cellOf(p);
  for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
    const r = r0 + Math.round((rnd() - 0.5) * 16), c = c0 + Math.round((rnd() - 0.5) * 16), g = ground(r, c);
    if (g < SEA) continue;
    const pd = centreDir(r, c), f = S.frame(...Object.values(S.latLonOf(pd[0], pd[1], pd[2])));
    sheep.push({ p: pd, y: g + 1, h: f.north, path: null, planned: 0, walked: 0, think: rnd() * 3, mesh: null });
    i++;
  }
}

function update(dt) {
  const pl = W().player;
  for (const s of sheep) {
    s.think -= dt;
    const dPlayer = R * Math.acos(Math.min(1, dot(s.p, pl.p)));
    const following = wheat && dPlayer < SEE && Math.abs(pl.y - s.y) < 8;
    if (s.think <= 0) {
      if (following) {
        s.think = 1;
        if (dPlayer > 2.5) { const [r, c] = cellOf(pl.p); plan(s, r, c, 6000); } else s.path = null;
      } else if (!s.path) {
        s.think = 3 + rnd() * 5;
        const [r, c] = cellOf(s.p);
        if (rnd() < 0.6) plan(s, r + Math.round((rnd() - 0.5) * 20), c + Math.round((rnd() - 0.5) * 20), 3000);
      }
    }
    if (following && dPlayer < 2) s.path = null;   // close enough: stop at the player's feet
    if (!s.path || !s.path.length) continue;
    // walk along the great circle towards the next block centre
    const [r, c] = s.path[0], t = centreDir(r, c), dist = R * Math.acos(Math.min(1, dot(s.p, t)));
    const step = (following ? FOLLOW : WANDER) * dt;
    if (dist <= step) {
      s.walked += dist; s.p = t; s.path.shift();
      const g = ground(r, c, Math.floor(s.y)); if (g >= 0) s.y = g + 1;
    } else {
      const m = norm([t[0] - s.p[0] * dot(s.p, t), t[1] - s.p[1] * dot(s.p, t), t[2] - s.p[2] * dot(s.p, t)]);
      s.h = m;
      const q = W().along(s.p, m, step, R + s.y - SEA);
      s.walked += R * Math.acos(Math.min(1, dot(s.p, q)));
      s.p = q;
      // climb onto the next block halfway there
      if (dist < 0.5) { const g = ground(r, c, Math.floor(s.y)); if (g >= 0 && g + 1 > s.y) s.y = g + 1; }
    }
  }
}

// ---- drawing: a box body and head, upright (along the sphere's up) and facing the way it walks ----
let geoBody = null, geoHead = null, matWool = null, matFace = null;
const mtx = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
function makeMesh() {
  if (!geoBody) {
    geoBody = new THREE.BoxGeometry(0.9, 0.8, 1.3); geoBody.translate(0, 0.75, 0);
    geoHead = new THREE.BoxGeometry(0.55, 0.55, 0.5); geoHead.translate(0, 1.05, 0.8);
    matWool = new THREE.MeshBasicMaterial({ color: 0xeeeeea }); matFace = new THREE.MeshBasicMaterial({ color: 0x8a6f5a });
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geoBody, matWool), new THREE.Mesh(geoHead, matFace));
  g.matrixAutoUpdate = false;
  W().scene.add(g);
  return g;
}
function place(eye) {
  for (const s of sheep) {
    if (!s.mesh) s.mesh = makeMesh();
    const rr = R + s.y - SEA, up = s.p, fwd = norm([s.h[0] - up[0] * dot(s.h, up), s.h[1] - up[1] * dot(s.h, up), s.h[2] - up[2] * dot(s.h, up)]);
    const right = cross(up, fwd);
    vx.set(right[0], right[1], right[2]); vy.set(up[0], up[1], up[2]); vz.set(fwd[0], fwd[1], fwd[2]);
    mtx.makeBasis(vx, vy, vz).setPosition(up[0] * rr - eye[0], up[1] * rr - eye[1], up[2] * rr - eye[2]);
    s.mesh.matrix.copy(mtx);
    s.mesh.visible = Math.hypot(up[0] * rr - eye[0], up[1] * rr - eye[1], up[2] * rr - eye[2]) < 400;
  }
}
function clear() { for (const s of sheep) if (s.mesh) W().scene.remove(s.mesh); sheep.length = 0; }

BF.smobs = { sheep, update, place, spawnNear, clear, ground, plan, setWheat: (v) => { wheat = v; }, wheat: () => wheat };
})();
