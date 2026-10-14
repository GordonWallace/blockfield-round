// The whole planet as a coarse mesh (192 x 192 cells per face, about 850 blocks each), drawn only in the
// round view, under and beyond the loaded chunks. Built a few rows per frame the first time it is needed.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world;
const M = 192, DROP = 4;   // cells per face edge; land sits a few blocks low so loaded chunks cover it

const globe = (BF.globe = { group: null, faces: [], next: 0, done: false });

function colour(s) {
  if (s.h < P.SEA) return s.ice ? [0.86, 0.92, 0.96] : [0.18 + (s.h - 40) / 900, 0.3 + (s.h - 40) / 400, 0.72];
  if (s.top === B.SNOW) return [0.94, 0.94, 0.96];
  if (s.top === B.SAND) return [0.82, 0.76, 0.55];
  if (s.top === B.STONE) return [0.5, 0.5, 0.5];
  const e = (s.h - P.SEA) / 200;
  return [0.36 + e * 0.35, 0.6 - e * 0.1, 0.28 + e * 0.2];
}

// One face, built row by row: { anchor, rows, pos, col }.
function startFace(f) {
  const anchor = P.pos(f, P.N / 2, P.N / 2, P.SEA, [0, 0, 0]);
  return { f, anchor, row: 0, pos: new Float32Array((M + 1) * (M + 1) * 3), col: new Float32Array((M + 1) * (M + 1) * 3) };
}
function buildRow(F) {
  const d = [0, 0, 0], T = world.terrain, j = F.row;
  for (let i = 0; i <= M; i++) {
    P.dir(F.f, i / M * P.N, j / M * P.N, d);
    const s = T.sample(d[0], d[1], d[2], false);
    const r = P.R + (s.h < P.SEA ? -1.5 : s.h - P.SEA - DROP), o = (j * (M + 1) + i) * 3, c = colour(s);
    F.pos[o] = d[0] * r - F.anchor[0]; F.pos[o + 1] = d[1] * r - F.anchor[1]; F.pos[o + 2] = d[2] * r - F.anchor[2];
    F.col[o] = c[0]; F.col[o + 1] = c[1]; F.col[o + 2] = c[2];
  }
  F.row++;
}
function finishFace(F) {
  const idx = new Uint32Array(M * M * 6);
  let n = 0;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const a = j * (M + 1) + i;
    // a x b = n on every face, so this winding faces outward
    idx.set([a, a + 1, a + M + 2, a, a + M + 2, a + M + 1], n); n += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(F.pos, 3));
  g.setAttribute("sphere", new THREE.BufferAttribute(F.pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(F.col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(g, world.material(false));
  mesh.frustumCulled = false;
  mesh.userData.anchor = F.anchor;
  globe.group.add(mesh);
}

globe.reset = function (scene) {
  if (globe.group) { scene.remove(globe.group); for (const m of globe.group.children) { m.geometry.dispose(); m.material.dispose(); } }
  globe.group = new THREE.Group();
  globe.group.renderOrder = -1;
  scene.add(globe.group);
  globe.faces = []; globe.next = 0; globe.done = false; globe.building = null;
};

// Called each frame with the current blend: builds within a time budget while needed, and places faces.
globe.update = function (k, budgetMs = 8) {
  globe.group.visible = k > 0;
  if (k <= 0) return;
  const t0 = performance.now();
  while (!globe.done && performance.now() - t0 < budgetMs) {
    if (!globe.building) globe.building = startFace(globe.next);
    buildRow(globe.building);
    if (globe.building.row > M) {
      finishFace(globe.building);
      globe.building = null;
      if (++globe.next === 6) globe.done = true;
    }
  }
  const V = world.view, R = V.M;
  for (const m of globe.group.children) {
    const a = m.userData.anchor, ax = a[0] - V.eye[0], ay = a[1] - V.eye[1], az = a[2] - V.eye[2];
    const u = m.material.uniforms;
    u.sphM.value.set(
      R[0], R[1], R[2], R[0] * ax + R[1] * ay + R[2] * az,
      R[3], R[4], R[5], R[3] * ax + R[4] * ay + R[5] * az,
      R[6], R[7], R[8], R[6] * ax + R[7] * ay + R[8] * az,
      0, 0, 0, 1);
    u.flatM.value.copy(u.sphM.value);
  }
};
})();
