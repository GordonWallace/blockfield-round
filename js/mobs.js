// Mobs on the planet: Blockfield's sheep (model, size, speed, wander and follow-the-wheat behaviour) ported to
// face grid coordinates. A mob lives at (face, u, v, y) like the player. Paths are A* over grid cells whose
// neighbours are looked up through world.cell, so a route runs across face edges with no special cases, and
// steering aims at each waypoint in 3D, which stays correct when the waypoint is on another face.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world;
const PX = 1 / 16, GRAVITY = 32, JUMP_V = 8.4;
const SHEEP = { hw: 0.45, h: 1.3, speed: 1.2, follow: 2.2, lureRange: 16 };   // from Blockfield's TYPES.sheep

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const flat = (a, up) => { const k = dot(a, up); return [a[0] - up[0] * k, a[1] - up[1] * k, a[2] - up[2] * k]; };
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- model (pixel units, faces +Z, origin = feet centre; Blockfield MODELS.sheep with flat-coloured faces) ----------
const FACE_SHADE = [0.8, 0.8, 1, 0.5, 0.68, 0.68];   // +x -x +y -y +z -z
function box(min, max, color) {
  const g = new THREE.BoxGeometry((max[0] - min[0]) * PX, (max[1] - min[1]) * PX, (max[2] - min[2]) * PX);
  g.translate((min[0] + max[0]) / 2 * PX, (min[1] + max[1]) / 2 * PX, (min[2] + max[2]) / 2 * PX);
  const c = new THREE.Color(color), col = [];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) col.push(c.r * FACE_SHADE[f], c.g * FACE_SHADE[f], c.b * FACE_SHADE[f]);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const MAT = () => (MAT.m = MAT.m || new THREE.MeshBasicMaterial({ vertexColors: true }));
function part(group, pivot, boxes) {
  const g = new THREE.Group();
  g.position.set(pivot[0] * PX, pivot[1] * PX, pivot[2] * PX);
  for (const b of boxes) g.add(new THREE.Mesh(box(b[0], b[1], b[2]), MAT()));
  group.add(g);
  return g;
}
function sheepModel() {
  const wool = 0xe9e9e6, skin = 0xd6c1a4, eye = 0x1d1a16;
  const root = new THREE.Group();
  part(root, [0, 0, 0], [[[-6, 11, -8], [6, 21, 8], wool]]);
  const head = part(root, [0, 18, 7], [
    [[-3, -3, 0], [3, 4, 8], skin],
    [[-3.2, 1, -0.2], [3.2, 4.2, 6], wool],
    [[-2, 0, 8], [-1, 1, 8.2], eye], [[1, 0, 8], [2, 1, 8.2], eye],
  ]);
  const legs = [];
  for (const [x, z, s] of [[-3, 5, 1], [3, 5, -1], [-3, -5, -1], [3, -5, 1]]) {
    const l = part(root, [x, 12, z], [[[-2, -12, -2], [2, -5, 2], skin], [[-2.2, -5, -2.2], [2.2, 0, 2.2], wool]]);
    l.userData.swing = s;
    legs.push(l);
  }
  return { root, head, legs };
}

// ---------- navigation ----------
const cellKey = (c) => c.f + ":" + c.i + ":" + c.j + ":" + c.y;
const isWater = (b) => b === B.WATER;
// A cell a sheep can stand in: solid floor, feet and head clear and not water.
function standable(f, i, j, y) {
  if (y < 2 || y + 2 >= P.H) return false;
  const fl = world.get(f, i, j, y - 1), feet = world.get(f, i, j, y), head = world.get(f, i, j, y + 1);
  return world.solid(fl) && !world.solid(feet) && !isWater(feet) && !world.solid(head);
}
const center = (c, y = c.y) => P.pos(c.f, c.i + 0.5, c.j + 0.5, y, [0, 0, 0]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// A* over standable cells: 4-way in the current cell's face grid, step up 1, drop up to 3. Neighbours that
// fall off the face are re-expressed on the face they belong to. near = stop within that many blocks.
function findPath(start, goal, maxNodes = 900, near = 0) {
  const g3 = center(goal), h = (c) => dist3(center(c), g3);
  const open = [{ c: start, g: 0, s: h(start) }], from = new Map([[cellKey(start), null]]), cost = new Map([[cellKey(start), 0]]);
  const w = { f: 0, u: 0, v: 0 };
  let best = null;
  for (let n = 0; open.length && n < maxNodes; n++) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].s < open[bi].s) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    const c = cur.c, hc = cur.s - cur.g;
    if (!best || hc < best.h) best = { c, h: hc };
    if ((c.f === goal.f && c.i === goal.i && c.j === goal.j && Math.abs(c.y - goal.y) <= 1) || hc <= near) return trace(from, c);
    for (const [di, dj] of DIRS) {
      world.cell(c.f, c.i + di, c.j + dj, w);
      for (const dy of [0, 1, -1, -2, -3]) {
        const nc = { f: w.f, i: w.u, j: w.v, y: c.y + dy };
        if (!standable(nc.f, nc.i, nc.j, nc.y)) continue;
        if (dy > 0 && world.solid(world.get(c.f, c.i, c.j, c.y + 2))) break;      // no room to jump
        if (dy < 0 && world.solid(world.get(nc.f, nc.i, nc.j, c.y + 1))) break;  // wall: cannot step off
        const k = cellKey(nc), ng = cur.g + 1 + (dy ? 0.5 : 0);
        if (cost.has(k) && cost.get(k) <= ng) break;
        cost.set(k, ng); from.set(k, c);
        open.push({ c: nc, g: ng, s: ng + h(nc) });
        break;
      }
    }
  }
  // goal out of reach within the budget: walk to the closest cell found
  return best && best.c !== start ? trace(from, best.c) : null;
}
function trace(from, c) {
  const out = [];
  for (let k = c; k; k = from.get(cellKey(k))) out.push(k);
  out.pop();
  return out.reverse();
}

// ---------- mobs ----------
const mobs = (BF.mobs = { list: [], lure: false, scene: null });

// Spawns a sheep on the surface at grid point (f, u, v), facing a random way.
mobs.spawnSheep = function (f, u, v) {
  const g = P.wrap(f, u, v, {});
  const i = Math.floor(g.u), j = Math.floor(g.v);
  let y = P.H - 3;
  while (y > 2 && !world.solid(world.get(g.f, i, j, y - 1))) y--;
  if (isWater(world.get(g.f, i, j, y)) || !standable(g.f, i, j, y)) return null;
  const fr = P.frame(g.f, i + 0.5, j + 0.5, y, {}), a = Math.random() * Math.PI * 2;
  const eu = norm(fr.eu), ev = norm(cross(fr.up, eu));
  const model = sheepModel();
  const m = {
    type: "sheep", f: g.f, u: i + 0.5, v: j + 0.5, y, vy: 0, onGround: true, model,
    heading: norm([eu[0] * Math.cos(a) + ev[0] * Math.sin(a), eu[1] * Math.cos(a) + ev[1] * Math.sin(a), eu[2] * Math.cos(a) + ev[2] * Math.sin(a)]),
    mode: "idle", t: rnd(1, 4), path: null, pi: 0, replan: 0, stuck: 0, lastD: Infinity, phase: 0, moving: 0, faces: new Set([g.f]),
  };
  mobs.scene.add(model.root);
  mobs.list.push(m);
  return m;
};

mobs.clear = function () {
  for (const m of mobs.list) mobs.scene.remove(m.model.root);
  mobs.list.length = 0;
};

const feetCell = (m) => ({ f: m.f, i: Math.floor(m.u), j: Math.floor(m.v), y: Math.floor(m.y + 0.01) });

function pickWander(m) {
  // a random spot 3-8 blocks away along the ground, found by stepping in 3D and converting back to the grid
  const fr = P.frame(m.f, m.u, m.v, m.y, {}), a = Math.random() * Math.PI * 2, d = rnd(3, 8);
  const eu = norm(fr.eu), ev = norm(cross(fr.up, eu));
  const dir = [(eu[0] * Math.cos(a) + ev[0] * Math.sin(a)) * d, (eu[1] * Math.cos(a) + ev[1] * Math.sin(a)) * d, (eu[2] * Math.cos(a) + ev[2] * Math.sin(a)) * d];
  const [du, dv] = P.toGrid(dir, fr);
  const g = world.cell(m.f, Math.floor(m.u + du), Math.floor(m.v + dv), {});
  for (let y = Math.floor(m.y) + 3; y >= Math.floor(m.y) - 4; y--) if (standable(g.f, g.u, g.v, y)) return { f: g.f, i: g.u, j: g.v, y };
  return null;
}

function think(m, dt, player) {
  const pl = mobs.lure && player ? dist3(P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]), P.pos(player.f, player.u, player.v, player.y, [0, 0, 0])) : Infinity;
  if (pl < SHEEP.lureRange && !player.flying) {
    // follow the player holding wheat: re-plan each second, stop two blocks short
    m.mode = "follow";
    m.replan -= dt;
    if (m.replan <= 0) {
      m.replan = 1;
      const goal = { f: player.f, i: Math.floor(player.u), j: Math.floor(player.v), y: Math.floor(player.y + 0.01) };
      m.path = pl > 2.5 ? findPath(feetCell(m), goal, 900, 2) : null; m.pi = 0;
    }
    return;
  }
  if (m.mode === "follow") { m.mode = "idle"; m.path = null; m.t = rnd(1, 3); }
  m.t -= dt;
  if (m.t <= 0) {
    if (m.mode === "idle" && Math.random() < 0.6) {
      const goal = pickWander(m);
      m.path = goal ? findPath(feetCell(m), goal, 300) : null; m.pi = 0;
      m.mode = m.path ? "walk" : "idle"; m.t = rnd(4, 9);
    } else { m.mode = "idle"; m.path = null; m.t = rnd(2, 6); }
  }
}

// Walks toward the next waypoint. Returns the desired 3D velocity (tangent to the ground).
function steer(m, fr, pos3, dt) {
  if (!m.path || m.pi >= m.path.length) { m.path = null; if (m.mode === "walk") { m.mode = "idle"; m.t = rnd(2, 5); } return null; }
  const c = m.path[m.pi], to = flat(((t) => [t[0] - pos3[0], t[1] - pos3[1], t[2] - pos3[2]])(center(c, m.y)), fr.up);
  const d = Math.hypot(to[0], to[1], to[2]);
  if (d < 0.3) { m.pi++; m.stuck = 0; m.lastD = Infinity; return steer(m, fr, pos3, dt); }
  // no progress for two seconds: give up on this route
  if (d < m.lastD - 0.05) { m.lastD = d; m.stuck = 0; } else if ((m.stuck += dt) > 2) { m.path = null; return null; }
  const sp = m.mode === "follow" ? SHEEP.follow : SHEEP.speed;
  return [to[0] / d * sp, to[1] / d * sp, to[2] / d * sp];
}

function move(m, dt, vel, fr) {
  const hits = (u, v, y) => world.boxHits(m.f, u, v, y, SHEEP.hw, SHEEP.h);
  let blocked = false;
  if (vel) {
    const [du, dv] = P.toGrid([vel[0] * dt, vel[1] * dt, vel[2] * dt], fr);
    if (!hits(m.u + du, m.v, m.y)) m.u += du; else blocked = true;
    if (!hits(m.u, m.v + dv, m.y)) m.v += dv; else blocked = true;
    // turn the body toward the walking direction
    const h = norm(vel), k = Math.min(1, dt * 8);
    m.heading = norm([m.heading[0] + (h[0] - m.heading[0]) * k, m.heading[1] + (h[1] - m.heading[1]) * k, m.heading[2] + (h[2] - m.heading[2]) * k]);
  }
  if (blocked && m.onGround) m.vy = JUMP_V;
  const feet = world.get(m.f, Math.floor(m.u), Math.floor(m.v), Math.floor(m.y + 0.3));
  if (isWater(feet)) m.vy = Math.min(2, m.vy + 30 * dt);   // swim up
  m.vy = Math.max(-40, m.vy - GRAVITY * dt);
  const dy = m.vy * dt;
  if (!hits(m.u, m.v, m.y + dy)) { m.y += dy; m.onGround = false; }
  else { if (m.vy < 0) { m.y = Math.floor(m.y + dy) + 1; m.onGround = true; } m.vy = 0; }
  if (m.u < 0 || m.u >= P.N || m.v < 0 || m.v >= P.N) {
    const g = P.wrap(m.f, m.u, m.v, {});
    m.f = g.f; m.u = g.u; m.v = g.v;
    m.faces.add(m.f);
  }
  m.moving = vel ? Math.min(1, m.moving + dt * 6) : Math.max(0, m.moving - dt * 6);
}

function draw(m, eye, up) {
  const p = P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]);
  const r = m.model.root, h = norm(flat(m.heading, up)), x = cross(up, h);
  r.position.set(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
  r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...up), new THREE.Vector3(...h)));
  m.phase += m.moving * 0.25;
  for (const l of m.model.legs) l.rotation.x = Math.sin(m.phase) * 0.6 * m.moving * l.userData.swing;
}

// Simulates mobs within the loaded area around the player and places their models.
mobs.update = function (dt, player) {
  const range = world.viewDist * 16;
  const pp = P.pos(player.f, player.u, player.v, player.y, [0, 0, 0]);
  for (const m of mobs.list) {
    const pos3 = P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]);
    const far = dist3(pos3, pp) > range;
    m.model.root.visible = !far;
    if (far) continue;
    const fr = P.frame(m.f, m.u, m.v, m.y, {});
    think(m, dt, player);
    move(m, dt, steer(m, fr, pos3, dt), fr);
    draw(m, player.eye, fr.up);
  }
};

mobs.init = function (scene) { mobs.scene = scene; };
mobs.findPath = findPath;
mobs.standable = standable;
})();
