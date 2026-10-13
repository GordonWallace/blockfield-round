// Start-up, the frame loop, HUD, and the planet map (M), where clicking a spot travels there.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world, player = BF.player, mobs = BF.mobs;
const $ = (id) => document.getElementById(id);
const SKY = 0x8fbde8;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 80, 120);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
mobs.init(scene);

// selection outline
const outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x000000 }));
outline.geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(72), 3));
outline.frustumCulled = false;
scene.add(outline);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  map.camera.aspect = camera.aspect; map.camera.updateProjectionMatrix();
}

function setView(v) {
  world.viewDist = v;
  const r = v * 16;
  scene.fog.near = r * 0.55; scene.fog.far = r * 0.95;
  camera.far = r * 1.6 + 400; camera.updateProjectionMatrix();
}

// ---- start / spawn ----
let seed = 1, started = false;
function landAt(d) {
  const s = world.terrain.sample(d[0], d[1], d[2]);
  return s.h >= P.SEA + 2 && s.top !== B.SNOW ? s : null;
}
function spawn() {
  const n = BF.makeNoise(seed);
  for (let i = 0; i < 2000; i++) {
    const d = [n.hash(i, 1) * 2 - 1, (n.hash(i, 2) * 2 - 1) * 0.6, n.hash(i, 3) * 2 - 1];
    const s = landAt(d);
    if (s && s.top === B.GRASS && s.h < P.SEA + 50) return goTo(d);
  }
  goTo([1, 0, 0]);
}
function goTo(d) {
  const g = P.fromDir(d[0], d[1], d[2], {});
  const u = Math.floor(g.u) + 0.5, v = Math.floor(g.v) + 0.5;
  let y = P.H - 1;
  while (y > 1 && !world.solid(world.get(g.f, Math.floor(u), Math.floor(v), y - 1))) y--;
  player.place(g.f, u, v, Math.max(y, P.SEA + 1));
}
function start() {
  seed = parseInt($("seed").value, 10) || 1;
  world.reset();
  world.init(scene, seed);
  map.built = false;
  spawn();
  mobs.clear();
  flock(8, 10);
  player.travelled = 0;
  started = true;
  $("title").style.display = "none";
  renderer.domElement.requestPointerLock();
}

// A few sheep scattered within r blocks of the player.
function flock(n, r) {
  for (let k = 0, made = 0; k < n * 6 && made < n; k++)
    if (mobs.spawnSheep(player.f, player.u + (Math.random() * 2 - 1) * r, player.v + (Math.random() * 2 - 1) * r)) made++;
}

// Travels to the nearest village (searching up to 20 km), landing a little outside it, facing its well.
function goVillage() {
  const near = BF.villages.near(player.f, player.u, player.v, 20000);
  const hit = near.find((n) => n.d > 30) || near[0];
  if (!hit) return;
  const v = hit.v;
  goTo(P.dir(v.f, v.x + 0.5, v.z - 45.5, [0, 0, 0]));
  player.heading = P.toward({ f: player.f, u: player.u, v: player.v }, { f: v.f, u: v.x, v: v.z });
  player.pitch = -0.2;
}

// ---- input ----
addEventListener("keydown", (e) => {
  if (!started) return;
  player.keys[e.code] = true;
  if (e.code === "KeyF") { player.flying = !player.flying; player.vy = 0; }
  if (e.code === "KeyG") player.fast = !player.fast;
  if (e.code === "KeyM") toggleMap();
  if (e.code === "KeyK") flock(4, 6);
  if (e.code === "KeyV") goVillage();
  if (e.code === "KeyL") mobs.lure = !mobs.lure;
  if (e.code === "KeyT") { const n = BF.makeNoise(Date.now() & 0xffff); for (let i = 0; i < 500; i++) { const d = [n.hash(i, 1) * 2 - 1, n.hash(i, 2) * 2 - 1, n.hash(i, 3) * 2 - 1]; if (landAt(d)) { goTo(d); break; } } }
  if (e.code === "Equal" || e.code === "NumpadAdd") setView(Math.min(24, world.viewDist + 2));
  if (e.code === "Minus" || e.code === "NumpadSubtract") setView(Math.max(4, world.viewDist - 2));
  if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
});
addEventListener("keyup", (e) => { player.keys[e.code] = false; });
addEventListener("blur", () => { player.keys = {}; });
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === renderer.domElement) player.look(e.movementX, e.movementY);
  else if (map.open && map.drag) map.rotate(e.movementX, e.movementY);
});
renderer.domElement.addEventListener("mousedown", (e) => {
  if (!started) return;
  if (map.open) { map.drag = true; map.moved = 0; return; }
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) player.breakBlock();
  else player.placeBlock();
});
addEventListener("mouseup", (e) => { if (map.open && map.drag) { map.drag = false; if (map.moved < 4) map.click(e); } });
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("wheel", (e) => { if (map.open) map.zoom(e.deltaY); });

// ---- planet map ----
const map = {
  open: false, built: false, drag: false, moved: 0, dist: 3.2,
  scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 1, 0.01, 100), globe: null, marker: null,
  quat: new THREE.Quaternion(),
};
map.scene.background = new THREE.Color(0x05070d);
function buildMap() {
  if (map.globe) { map.scene.remove(map.globe); map.globe.geometry.dispose(); }
  const M = 96, pos = [], col = [], idx = [], d = [0, 0, 0], T = world.terrain;
  for (let f = 0; f < 6; f++) {
    const base = pos.length / 3;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      P.dir(f, i / M * P.N, j / M * P.N, d);
      const s = T.sample(d[0], d[1], d[2], false);
      const r = 1 + Math.max(0, s.h - P.SEA) / P.R * 3;
      pos.push(d[0] * r, d[1] * r, d[2] * r);
      let c;
      if (s.h < P.SEA) c = s.ice ? [0.86, 0.92, 0.96] : [0.12, 0.24 + (s.h - 40) / 250, 0.55 + (s.h - 40) / 200];
      else if (s.top === B.SNOW) c = [0.94, 0.94, 0.96];
      else if (s.top === B.SAND) c = [0.82, 0.76, 0.55];
      else if (s.top === B.STONE) c = [0.5, 0.5, 0.5];
      else { const e = (s.h - P.SEA) / 200; c = [0.27 + e * 0.45, 0.55 - e * 0.08, 0.24 + e * 0.25]; }
      col.push(c[0], c[1], c[2]);
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const a = base + j * (M + 1) + i;
      idx.push(a, a + 1, a + M + 2, a, a + M + 2, a + M + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  map.globe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  map.scene.add(map.globe);
  if (!map.marker) {
    map.marker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    map.scene.add(map.marker);
  }
  map.built = true;
}
function toggleMap() {
  map.open = !map.open;
  $("maphelp").style.display = map.open ? "block" : "none";
  if (map.open) {
    if (!map.built) buildMap();
    document.exitPointerLock();
    // face the player's side of the planet
    const e = new THREE.Vector3(...player.eye).normalize();
    map.quat.setFromUnitVectors(e, new THREE.Vector3(0, 0, 1));
  } else renderer.domElement.requestPointerLock();
}
map.rotate = (dx, dy) => {
  map.moved += Math.abs(dx) + Math.abs(dy);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.005, dx * 0.005, 0));
  map.quat.premultiply(q);
};
map.zoom = (dy) => { map.dist = Math.max(1.4, Math.min(8, map.dist * (dy > 0 ? 1.1 : 0.9))); };
map.click = (e) => {
  const ray = new THREE.Raycaster(), m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(m, map.camera);
  const hit = ray.intersectObject(map.globe)[0];
  if (!hit) return;
  const p = hit.point.clone().applyQuaternion(map.quat.clone().invert()).normalize();
  goTo([p.x, p.y, p.z]);
  toggleMap();
};

// ---- loop ----
let last = performance.now(), fpsT = 0, frames = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!started) return;
  frames++; fpsT += dt; if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  if (map.open) {
    map.globe.quaternion.copy(map.quat);
    map.marker.position.set(...player.eye).normalize().multiplyScalar(1.02).applyQuaternion(map.quat);
    map.camera.position.set(0, 0, map.dist); map.camera.lookAt(0, 0, 0);
    renderer.render(map.scene, map.camera);
    return;
  }
  player.update(dt);
  mobs.update(dt, player);
  const st = world.update(player.f, player.u, player.v, player.eye);
  camera.position.set(0, 0, 0);
  camera.up.set(...player.up);
  camera.lookAt(...player.fwd);
  drawOutline();
  renderer.render(scene, camera);
  if (fpsT === 0) hud(st);
}
function drawOutline() {
  const t = player.target;
  outline.visible = !!t;
  if (!t) return;
  const g = world.cell(player.f, t.i, t.k, {}), c = [], a = [0, 0, 0], e = player.eye;
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]) {
    P.pos(g.f, g.u + x, g.v + z, t.j + y, a);
    c.push([a[0] - e[0], a[1] - e[1], a[2] - e[2]]);
  }
  const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7], arr = outline.geometry.attributes.position.array;
  E.forEach((v, n) => { arr[n * 3] = c[v][0]; arr[n * 3 + 1] = c[v][1]; arr[n * 3 + 2] = c[v][2]; });
  outline.geometry.attributes.position.needsUpdate = true;
}
// Nearest village: distance and direction relative to where the player faces.
function villageLine() {
  const n = BF.villages.near(player.f, player.u, player.v, 3000)[0];
  if (!n) return "no village within 3 km";
  const t = P.toward({ f: player.f, u: player.u, v: player.v }, { f: n.v.f, u: n.v.x, v: n.v.z }), h = player.heading, up = player.up;
  const c = [h[1] * t[2] - h[2] * t[1], h[2] * t[0] - h[0] * t[2], h[0] * t[1] - h[1] * t[0]];
  const ang = Math.atan2(c[0] * up[0] + c[1] * up[1] + c[2] * up[2], h[0] * t[0] + h[1] * t[1] + h[2] * t[2]) * 180 / Math.PI;
  const dir = Math.abs(ang) < 15 ? "ahead" : Math.abs(ang) > 165 ? "behind" : `${Math.round(Math.abs(ang))}° ${ang > 0 ? "left" : "right"}`;
  return `${n.v.name} ${n.d < 1000 ? Math.round(n.d) + " blocks" : (n.d / 1000).toFixed(1) + " km"} ${dir}`;
}
function hud(st) {
  const d = P.dir(player.f, player.u, player.v, [0, 0, 0]);
  const lat = Math.asin(d[1]) * 180 / Math.PI, lon = Math.atan2(d[0], d[2]) * 180 / Math.PI;
  const mode = player.flying ? (player.fast ? "fast fly" : "fly") : "walk";
  $("hud").textContent =
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}  ·  layer ${Math.floor(player.y)} (sea ${P.SEA})  ·  ${mode}\n` +
    `face ${player.f} u ${Math.floor(player.u)} v ${Math.floor(player.v)}  ·  travelled ${Math.round(player.travelled)} of ${4 * P.N} around\n` +
    `nearest village: ${villageLine()}  ·  ${mobs.list.length} sheep${mobs.lure ? " · holding wheat (sheep follow)" : ""}\n` +
    `${fps} fps  ·  view ${world.viewDist} chunks  ·  ${st.meshed}/${st.wanted} chunks meshed`;
}

$("play").addEventListener("click", start);
$("seed").addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
addEventListener("resize", resize);
resize();
setView(8);
requestAnimationFrame(frame);
BF.main = { start, goTo, setView, map, renderer, camera, scene };
})();
