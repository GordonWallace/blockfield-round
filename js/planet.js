// Cube-sphere geometry. The planet is six square faces of N x N block columns, each projected onto
// a sphere. A block is addressed by (face, u, v, y): u and v are grid coordinates on the face and y is
// the layer, with "up" pointing away from the planet's centre. Columns are radial, so a block at
// layer y sits at radius R + (y - SEA).
(() => {
"use strict";
const BF = (window.BF = window.BF || {});

const N = 163840;                // columns along a face edge; the equator is 4N blocks around
const R = (2 * N) / Math.PI;     // sea-level radius, so a column at a face centre is one block wide
const SEA = 96, H = 320;         // sea level layer and world height in layers
const Q = Math.PI / 4;

// Each face: outward normal n and grid axes a (u) and b (v), with a x b = n.
const FACES = [
  { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];

// Grid point (f, u, v) to a unit direction. The tan warp spaces columns by equal angle, which keeps
// cells close to square; u and v may run a little past the face, which lands on the neighbouring face.
function dir(f, u, v, out) {
  const F = FACES[f];
  const s = Math.tan((2 * u / N - 1) * Q), t = Math.tan((2 * v / N - 1) * Q);
  const x = F.n[0] + s * F.a[0] + t * F.b[0];
  const y = F.n[1] + s * F.a[1] + t * F.b[1];
  const z = F.n[2] + s * F.a[2] + t * F.b[2];
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

// Direction (any length) to face and grid coordinates.
function fromDir(x, y, z, out) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f;
  if (ax >= ay && ax >= az) f = x > 0 ? 0 : 1;
  else if (ay >= az) f = y > 0 ? 2 : 3;
  else f = z > 0 ? 4 : 5;
  const F = FACES[f];
  const d = x * F.n[0] + y * F.n[1] + z * F.n[2];
  const s = (x * F.a[0] + y * F.a[1] + z * F.a[2]) / d;
  const t = (x * F.b[0] + y * F.b[1] + z * F.b[2]) / d;
  out.f = f;
  out.u = (Math.atan(s) / Q + 1) * N / 2;
  out.v = (Math.atan(t) / Q + 1) * N / 2;
  return out;
}

// 3D position of grid point (f, u, v) at layer y.
function pos(f, u, v, y, out) {
  dir(f, u, v, out);
  const r = R + (y - SEA);
  out[0] *= r; out[1] *= r; out[2] *= r;
  return out;
}

// Grid coordinates of a direction on a given face (no face choice; the direction may lie past its edge).
function onFace(f, x, y, z, out) {
  const F = FACES[f], d = x * F.n[0] + y * F.n[1] + z * F.n[2];
  out.u = (Math.atan((x * F.a[0] + y * F.a[1] + z * F.a[2]) / d) / Q + 1) * N / 2;
  out.v = (Math.atan((x * F.b[0] + y * F.b[1] + z * F.b[2]) / d) / Q + 1) * N / 2;
  return out;
}

// Unfolding. Two faces that share an edge lie flat side by side exactly: grid rows line up one to one
// along the edge, so the neighbour's grid is placed by a 90-degree rotation plus an offset.
// EDGE[f][s] for side s (0: u < 0, 1: u >= N, 2: v < 0, 3: v >= N) is { g, A, t }, mapping neighbour g's
// grid into f's grid extended past that side: U = A0 u + A1 v + t0, V = A2 u + A3 v + t1.
// UNFOLD[f][g] is the same map looked up by neighbour face (undefined for f itself and the opposite face).
const EDGE = [], UNFOLD = [];
(function buildEdges() {
  const d = [0, 0, 0], o = {};
  for (let f = 0; f < 6; f++) {
    EDGE[f] = []; UNFOLD[f] = [];
    for (let s = 0; s < 4; s++) {
      const out = [[-1, 0], [1, 0], [0, -1], [0, 1]][s];
      const edge = (k) => [out[0] ? (out[0] < 0 ? 0 : N) : k * N, out[1] ? (out[1] < 0 ? 0 : N) : k * N];
      const mid = edge(0.5);
      dir(f, mid[0] + out[0] * N * 0.1, mid[1] + out[1] * N * 0.1, d);
      const g = fromDir(d[0], d[1], d[2], {}).f;
      const p = [edge(0.25), edge(0.75)], q = p.map((e) => { dir(f, e[0], e[1], d); onFace(g, d[0], d[1], d[2], o); return [o.u, o.v]; });
      const ang = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) - Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
      const c = Math.round(Math.cos(ang)), sn = Math.round(Math.sin(ang));
      const A = [c, -sn, sn, c];
      const t = [Math.round(p[0][0] - A[0] * q[0][0] - A[1] * q[0][1]), Math.round(p[0][1] - A[2] * q[0][0] - A[3] * q[0][1])];
      EDGE[f][s] = UNFOLD[f][g] = { g, A, t, side: s };
    }
  }
})();

// Puts grid coordinates that ran off a face back onto the face they belong to. Past one edge this is the
// exact unfold, so it agrees with how neighbouring faces are drawn; past two edges at once (only within
// a corner's wedge) it falls back to the nearest point by direction.
const tmp = [0, 0, 0];
function wrap(f, u, v, out, depth = 0) {
  if (u >= 0 && u < N && v >= 0 && v < N) { out.f = f; out.u = u; out.v = v; return out; }
  const offU = u < 0 || u >= N, offV = v < 0 || v >= N;
  if (offU !== offV && depth < 3) {
    const e = EDGE[f][offU ? (u < 0 ? 0 : 1) : (v < 0 ? 2 : 3)], A = e.A, x = u - e.t[0], y = v - e.t[1];
    let nu = A[0] * x + A[2] * y, nv = A[1] * x + A[3] * y;
    // a point exactly on the shared edge can land on the neighbour's far boundary line
    if (nu >= N && nu - N < 1e-6) nu = N - 1e-9;
    if (nv >= N && nv - N < 1e-6) nv = N - 1e-9;
    return wrap(e.g, nu, nv, out, depth + 1);
  }
  dir(f, u, v, tmp);
  fromDir(tmp[0], tmp[1], tmp[2], out);
  if (out.u >= N) out.u = N - 1e-9;
  if (out.v >= N) out.v = N - 1e-9;
  return out;
}

// Local frame at a grid point: up (unit), and eu / ev, the 3D vectors one grid step along u and v.
function frame(f, u, v, y, out) {
  const a = [0, 0, 0], b = [0, 0, 0];
  pos(f, u + 0.5, v, y, a); pos(f, u - 0.5, v, y, b);
  out.eu = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  pos(f, u, v + 0.5, y, a); pos(f, u, v - 0.5, y, b);
  out.ev = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  out.up = dir(f, u, v, [0, 0, 0]);
  return out;
}

// 3D tangent vector to grid steps (du, dv) in a local frame: least squares against the grid axes,
// which are not quite perpendicular away from face centres.
function toGrid(d, fr) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(fr.eu, fr.eu), b = dot(fr.eu, fr.ev), c = dot(fr.ev, fr.ev);
  const x = dot(d, fr.eu), y = dot(d, fr.ev), det = a * c - b * b;
  return [(c * x - b * y) / det, (a * y - b * x) / det];
}

// Great-circle distance in blocks (at sea level) between two grid points {f, u, v}; works across faces.
function distance(a, b) {
  const p = dir(a.f, a.u, a.v, [0, 0, 0]), q = dir(b.f, b.u, b.v, [0, 0, 0]);
  return Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) * R;
}

// Direction from a toward b as a 3D unit vector tangent to the ground at a (the start of the great circle).
function toward(a, b) {
  const p = dir(a.f, a.u, a.v, [0, 0, 0]), q = dir(b.f, b.u, b.v, [0, 0, 0]);
  const k = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const t = [q[0] - p[0] * k, q[1] - p[1] * k, q[2] - p[2] * k], l = Math.hypot(t[0], t[1], t[2]) || 1;
  return [t[0] / l, t[1] / l, t[2] / l];
}

BF.planet = { distance, toward, toGrid, N, R, SEA, H, FACES, EDGE, UNFOLD, dir, fromDir, onFace, pos, wrap, frame };
})();
