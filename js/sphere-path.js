// Paths on the true-sphere grid (sphere.js): A* over blocks, then pulled straight along great circles.
//
// A* steps between neighbouring blocks: east and west in the same row, north and south to the blocks that
// share a border (one within a band, possibly two across a seam), and the diagonals next to those. Each step
// costs the real great-circle distance between the two blocks' centres, and the estimate is the great-circle
// distance to the goal, so A* finds the shortest path through block centres.
// A grid path zigzags (up to 8% longer than the straight line), so it is then pulled tight: from each point,
// jump to the furthest later point that can be reached in a straight line (a great circle) over walkable
// blocks only. On open ground the result is the great circle itself.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const S = BF.sphere;

const centre = (r, c) => S.toLatLon(r + 0.5, c + 0.5);
const key = (r, c) => r * 1048576 + c;   // up to 2^20 columns per row (the most is 655,360)

// The blocks next to (r, c): [r2, c2] pairs.
function neighbours(r, c) {
  const n = S.cols(r), out = [[r, (c + 1) % n], [r, (c - 1 + n) % n]];
  for (const dr of [1, -1]) {
    const r2 = r + dr;
    if (r2 < 0 || r2 >= S.ROWS) continue;
    const n2 = S.cols(r2), [a, z] = S.overlap(r, c, r2);
    for (let c2 = a - 1; c2 <= z + 1; c2++) out.push([r2, ((c2 % n2) + n2) % n2]);
  }
  return out;
}

// A binary heap of [f, key].
function heap() {
  const a = [];
  return {
    size: () => a.length,
    push(f, k) { a.push([f, k]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (rr < a.length && a[rr][0] < a[m][0]) m = rr; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    },
  };
}

// Shortest path of blocks from (r0, c0) to (r1, c1), stepping only on blocks walkable(r, c) allows.
// canStep(r, c, r2, c2), if given, can also refuse a single step (a climb too high, say).
// Returns [[r, c], ...] or null (no path within maxNodes expanded).
function astar(r0, c0, r1, c1, walkable = () => true, maxNodes = 400000, canStep = null) {
  const goal = centre(r1, c1), gk = key(r1, c1);
  const g = new Map(), from = new Map(), open = heap(), done = new Set();
  const h = (r, c) => { const p = centre(r, c); return S.distance(p.lat, p.lon, goal.lat, goal.lon); };
  g.set(key(r0, c0), 0); open.push(h(r0, c0), key(r0, c0));
  let expanded = 0;
  while (open.size()) {
    const [, k] = open.pop();
    if (done.has(k)) continue;
    done.add(k);
    if (k === gk) break;
    if (++expanded > maxNodes) return null;
    const r = Math.floor(k / 1048576), c = k % 1048576, pc = centre(r, c), gk0 = g.get(k);
    for (const [r2, c2] of neighbours(r, c)) {
      const k2 = key(r2, c2);
      if (done.has(k2) || !walkable(r2, c2) || (canStep && !canStep(r, c, r2, c2))) continue;
      const q = centre(r2, c2), ng = gk0 + S.distance(pc.lat, pc.lon, q.lat, q.lon);
      if (ng < (g.has(k2) ? g.get(k2) : Infinity)) { g.set(k2, ng); from.set(k2, k); open.push(ng + S.distance(q.lat, q.lon, goal.lat, goal.lon), k2); }
    }
  }
  if (!done.has(gk)) return null;
  const path = [];
  for (let k = gk; k !== undefined; k = from.get(k)) path.push([Math.floor(k / 1048576), k % 1048576]);
  return path.reverse();
}

// Can a straight line (great circle) between the centres of two blocks be walked: every block it crosses,
// sampled every quarter block, is walkable?
function clear(a, b, walkable) {
  const p = centre(a[0], a[1]), q = centre(b[0], b[1]);
  const d = S.distance(p.lat, p.lon, q.lat, q.lon), steps = Math.max(1, Math.ceil(d * 4));
  const u = S.dir(p.lat, p.lon), v = S.dir(q.lat, q.lon), w = d / S.R, sw = Math.sin(w) || 1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, ka = Math.sin((1 - t) * w) / sw, kb = Math.sin(t * w) / sw;
    const x = u[0] * ka + v[0] * kb, y = u[1] * ka + v[1] * kb, z = u[2] * ka + v[2] * kb;
    const g = S.latLonOf(x, y, z), rc = S.fromLatLon(g.lat, g.lon);
    if (!walkable(Math.floor(rc.r), Math.floor(rc.c))) return false;
  }
  return true;
}
// Pulls a block path tight: the points kept are joined by great circles over walkable ground.
function smooth(path, walkable = () => true) {
  if (!path || path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    // furthest point reachable straight from i (binary search would miss detours, so scan back from the end)
    let j = path.length - 1;
    while (j > i + 1 && !clear(path[i], path[j], walkable)) j--;
    out.push(path[j]); i = j;
  }
  return out;
}
// Length of a path (blocks, at sea level): great circles between successive block centres.
function length(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) { const p = centre(...path[i - 1]), q = centre(...path[i]); s += S.distance(p.lat, p.lon, q.lat, q.lon); }
  return s;
}

BF.spherePath = { neighbours, astar, smooth, length, clear };
})();
