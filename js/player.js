// Player: movement and collision run in face grid coordinates, where "down" is always -y, exactly
// like a flat world. Facing is kept as a 3D tangent vector, so it carries across face edges with no
// per-edge rules: each frame it is re-flattened against the local up.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world;
const GRAVITY = 32, JUMP_V = 8.4, WALK = 4.3, SPRINT = 5.6, FLY = 11, EYE = 1.62, HW = 0.3, HT = 1.8;

const p = (BF.player = {
  f: 0, u: 0, v: 0, y: 0, vy: 0, heading: [1, 0, 0], pitch: 0, flying: false, fast: false,
  onGround: false, keys: {}, travelled: 0, eye: [0, 0, 0], up: [0, 1, 0], fwd: [1, 0, 0], target: null,
});

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const toGrid = P.toGrid;

const collides = (u, v, y) => world.boxHits(p.f, u, v, y, HW, HT);

// Moves along one grid axis; walking into a one-block ledge steps up onto it.
function moveH(du, dv) {
  const steps = Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) / 0.25) || 1;
  for (let s = 0; s < steps; s++) {
    for (const [a, b] of [[du / steps, 0], [0, dv / steps]]) {
      if (!a && !b) continue;
      if (!collides(p.u + a, p.v + b, p.y)) { p.u += a; p.v += b; }
      else if ((p.onGround || p.flying) && !collides(p.u + a, p.v + b, Math.floor(p.y) + 1) && !collides(p.u, p.v, Math.floor(p.y) + 1)) {
        p.y = Math.floor(p.y) + 1; p.u += a; p.v += b;
      }
    }
  }
}

p.place = function (f, u, v, y) {
  p.f = f; p.u = u; p.v = v; p.y = y; p.vy = 0;
  const fr = P.frame(f, u, v, y, {});
  let h = fr.eu.slice();
  h = norm([h[0] - fr.up[0] * dot(h, fr.up), h[1] - fr.up[1] * dot(h, fr.up), h[2] - fr.up[2] * dot(h, fr.up)]);
  p.heading = h;
};

p.look = function (dx, dy) {
  const up = p.up, right = cross(p.heading, up), a = -dx * 0.0025;
  // turning right rotates the heading toward the right vector
  p.heading = norm([p.heading[0] * Math.cos(a) - right[0] * Math.sin(a), p.heading[1] * Math.cos(a) - right[1] * Math.sin(a), p.heading[2] * Math.cos(a) - right[2] * Math.sin(a)]);
  p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - dy * 0.0025));
};

p.update = function (dt) {
  const fr = P.frame(p.f, p.u, p.v, p.y, {});
  const up = (p.up = fr.up);
  let h = p.heading;
  h = p.heading = norm([h[0] - up[0] * dot(h, up), h[1] - up[1] * dot(h, up), h[2] - up[2] * dot(h, up)]);
  const right = cross(h, up), K = p.keys;
  const fw = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), st = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  let speed = p.flying ? FLY * (p.fast ? 12 : 1) * (K.ControlLeft ? 2 : 1) : K.ControlLeft ? SPRINT : WALK;
  let d = [h[0] * fw + right[0] * st, h[1] * fw + right[1] * st, h[2] * fw + right[2] * st];
  const l = Math.hypot(d[0], d[1], d[2]);
  const before = P.pos(p.f, p.u, p.v, P.SEA, [0, 0, 0]);
  if (l > 0) {
    d = [d[0] / l * speed * dt, d[1] / l * speed * dt, d[2] / l * speed * dt];
    const [du, dv] = toGrid(d, fr);
    moveH(du, dv);
  }
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
  p.y = Math.max(1, Math.min(P.H + 200, p.y));
  // crossed onto another face: re-express the position there
  if (p.u < 0 || p.u >= P.N || p.v < 0 || p.v >= P.N) {
    const g = P.wrap(p.f, p.u, p.v, {});
    p.f = g.f; p.u = g.u; p.v = g.v;
  }
  const after = P.pos(p.f, p.u, p.v, P.SEA, [0, 0, 0]);
  p.travelled += Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  p.eye = P.pos(p.f, p.u, p.v, p.y + EYE, [0, 0, 0]);
  p.fwd = norm([h[0] * Math.cos(p.pitch) + up[0] * Math.sin(p.pitch), h[1] * Math.cos(p.pitch) + up[1] * Math.sin(p.pitch), h[2] * Math.cos(p.pitch) + up[2] * Math.sin(p.pitch)]);
  p.target = raycast(fr);
};

// Grid-space DDA along the view ray, up to 6 blocks. Returns the hit cell and the cell before it.
function raycast(fr) {
  const [du, dv] = toGrid(p.fwd, fr), dy = dot(p.fwd, p.up);
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
