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

// Puts grid coordinates that ran off a face back onto the face they belong to.
const tmp = [0, 0, 0];
function wrap(f, u, v, out) {
  if (u >= 0 && u < N && v >= 0 && v < N) { out.f = f; out.u = u; out.v = v; return out; }
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

BF.planet = { toGrid, N, R, SEA, H, FACES, dir, fromDir, pos, wrap, frame };
})();
