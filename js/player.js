// Player: movement and collision run in face grid coordinates, where "down" is always -y, exactly
// like a flat world. Facing is a direction in the grid (hu, hv), so walking straight is a straight grid
// line. Crossing a face edge re-expresses the position on the next face and turns the facing by the
// edge's 90-degree unfold, so the walk carries on straight in the drawn (flat) world.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world;
const GRAVITY = 32, JUMP_V = 8.4, WALK = 4.3, SPRINT = 5.6, FLY = 11, EYE = 1.62, HW = 0.3, HT = 1.8;

const p = (BF.player = {
  f: 0, u: 0, v: 0, y: 0, vy: 0, hu: 1, hv: 0, pitch: 0, flying: false, fast: false,
  onGround: false, keys: {}, travelled: 0, eye: [0, 0, 0], up: [0, 1, 0], heading: [1, 0, 0], target: null, EYE,
});

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const collides = (u, v, y) => world.boxHits(p.f, u, v, y, HW, HT);

// Moves along one grid axis; walking into a one-block ledge steps up onto it.
function moveH(du, dv) {
  const steps = Math.min(400, Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) / 0.25) || 1);
  for (let s = 0; s < steps; s++) {
    for (const [a, b] of [[du / steps, 0], [0, dv / steps]]) {
      if (!a && !b) continue;
      if (!collides(p.u + a, p.v + b, p.y)) { p.u += a; p.v += b; }
      else if ((p.onGround || p.flying) && !collides(p.u + a, p.v + b, Math.floor(p.y) + 1) && !collides(p.u, p.v, Math.floor(p.y) + 1)) {
        p.y = Math.floor(p.y) + 1; p.u += a; p.v += b;
      }
      if (p.u < 0 || p.u >= P.N || p.v < 0 || p.v >= P.N) cross();
    }
  }
}

// Ran off the face: move onto the neighbouring face and turn the facing with the unfold.
function cross() {
  const f0 = p.f, g = P.wrap(p.f, p.u, p.v, {});
  p.f = g.f; p.u = g.u; p.v = g.v;
  const e = P.UNFOLD[f0][p.f];
  if (e) {
    // e maps the new face's grid into the old one's; facing goes the other way (transpose)
    const A = e.A, hu = A[0] * p.hu + A[2] * p.hv, hv = A[1] * p.hu + A[3] * p.hv;
    p.hu = hu; p.hv = hv;
  } else setHeading(p.heading);
}

// Facing from a 3D tangent vector (for P.toward and friends).
function setHeading(h) {
  const fr = P.frame(p.f, p.u, p.v, p.y, {});
  const [du, dv] = P.toGrid(h, fr), l = Math.hypot(du, dv) || 1;
  p.hu = du / l; p.hv = dv / l;
}
p.setHeading = setHeading;

p.place = function (f, u, v, y) {
  p.f = f; p.u = u; p.v = v; p.y = y; p.vy = 0;
  p.hu = 1; p.hv = 0;
  derive();
};

p.look = function (dx, dy) {
  const a = dx * 0.0025, c = Math.cos(a), s = Math.sin(a);
  // turning right: the grid right of facing (hu, hv) is (hv, -hu)
  const hu = p.hu * c + p.hv * s, hv = p.hv * c - p.hu * s, l = Math.hypot(hu, hv);
  p.hu = hu / l; p.hv = hv / l;
  p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - dy * 0.0025));
};

// Height above the ground or sea below, in blocks.
p.altitude = function () {
  const c = world.chunk(p.f, Math.floor(p.u) >> 4, Math.floor(p.v) >> 4);
  const top = c.top[(Math.floor(p.v) & 15) * 16 + (Math.floor(p.u) & 15)];
  return p.y - Math.max(top + 1, P.SEA);
};

p.update = function (dt) {
  const K = p.keys;
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  let speed = p.flying ? FLY * (p.fast ? 12 : 1) * (K.ControlLeft ? 2 : 1) : K.ControlLeft ? SPRINT : WALK;
  // fast flight speeds up with height, so a few seconds of Space reach orbit
  if (p.flying && p.fast) speed *= Math.max(1, p.altitude() / 150);
  const before = P.pos(p.f, p.u, p.v, P.SEA, [0, 0, 0]);
  let du = p.hu * fw + p.hv * st, dv = p.hv * fw - p.hu * st;
  const l = Math.hypot(du, dv);
  if (l > 0) moveH(du / l * speed * dt, dv / l * speed * dt);
  if (p.flying) {
    const vy = ((K.Space ? 1 : 0) - (K.ShiftLeft ? 1 : 0)) * speed * dt;
    if (vy && !collides(p.u, p.v, p.y + vy)) p.y += vy;
    p.vy = 0;
  } else {
    if (K.Space && p.onGround) p.vy = JUMP_V;
    p.vy = Math.max(-60, p.vy - GRAVITY * dt);
    const dy = p.vy * dt;
    if (!collides(p.u, p.v, p.y + dy)) { p.y += dy; p.onGround = false; }
    else { if (p.vy < 0) { p.y = Math.floor(p.y + dy) + 1; p.onGround = true; } p.vy = 0; }
  }
  p.y = Math.max(1, Math.min(3 * P.R, p.y));
  const after = P.pos(p.f, p.u, p.v, P.SEA, [0, 0, 0]);
  p.travelled += Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  derive();
  p.target = raycast();
};

// Sphere quantities other code uses: eye position, local up, and facing as a 3D tangent vector.
function derive() {
  const fr = P.frame(p.f, p.u, p.v, p.y, {}), up = (p.up = fr.up);
  const h = [fr.eu[0] * p.hu + fr.ev[0] * p.hv, fr.eu[1] * p.hu + fr.ev[1] * p.hv, fr.eu[2] * p.hu + fr.ev[2] * p.hv];
  const k = dot(h, up);
  p.heading = norm([h[0] - up[0] * k, h[1] - up[1] * k, h[2] - up[2] * k]);
  p.eye = P.pos(p.f, p.u, p.v, p.y + EYE, [0, 0, 0]);
}

// Grid-space DDA along the view ray, up to 6 blocks. Returns the hit cell and the cell before it.
function raycast() {
  const cp = Math.cos(p.pitch), du = p.hu * cp, dv = p.hv * cp, dy = Math.sin(p.pitch);
  let x = p.u, y = p.y + EYE, z = p.v;
  let i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const sx = Math.sign(du), sy = Math.sign(dy), sz = Math.sign(dv);
  const tdx = Math.abs(1 / du), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dv);
  let tx = du ? (sx > 0 ? i + 1 - x : x - i) * tdx : Infinity;
  let ty = dy ? (sy > 0 ? j + 1 - y : y - j) * tdy : Infinity;
  let tz = dv ? (sz > 0 ? k + 1 - z : z - k) * tdz : Infinity;
  let prev = null, t = 0;
  while (t < 6) {
    const b = world.get(p.f, i, k, j);
    if (b !== B.AIR && b !== B.WATER) return { i, j, k, prev };
    prev = { i, j, k };
    if (tx < ty && tx < tz) { i += sx; t = tx; tx += tdx; }
    else if (ty < tz) { j += sy; t = ty; ty += tdy; }
    else { k += sz; t = tz; tz += tdz; }
  }
  return null;
}

p.breakBlock = function () { const t = p.target; if (t && t.j > 1) world.set(p.f, t.i, t.k, t.j, B.AIR); };
p.placeBlock = function () {
  const t = p.target; if (!t || !t.prev) return;
  const q = t.prev;
  world.set(p.f, q.i, q.k, q.j, B.PLANKS);
  if (collides(p.u, p.v, p.y)) world.set(p.f, q.i, q.k, q.j, B.AIR);
};
})();
