// Start-up, the frame loop, HUD, the teleport panel (P), and the planet map (M), where clicking a spot
// travels there.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet, B = BF.B, world = BF.world, player = BF.player, mobs = BF.mobs;
const $ = (id) => document.getElementById(id);
const SKY = 0x8fbde8, SPACE = 0x05070f;
// The view is flat up to ALT0 blocks above sea level (above the build limit) and fully round from ALT1.
const ALT0 = 250, ALT1 = 2500;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
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

function setView(v) { world.viewDist = v; }

// Fills world.view for this frame: blend k from height, the rotation that lines the sphere up with the
// player's grid, then fog, sky and the camera's clip range to suit the height.
const sky = new THREE.Color(), skyA = new THREE.Color(SKY), skyB = new THREE.Color(SPACE);
let forceK = null;
function setupView() {
  const V = world.view, p = player, h = p.y + p.EYE - P.SEA;
  V.f = p.f; V.u = p.u; V.v = p.v; V.eyeY = p.y + p.EYE; V.eye = p.eye;
  V.k = forceK !== null ? forceK : smooth(ALT0, ALT1, h);
  const fr = P.frame(p.f, p.u, p.v, p.y, {}), up = fr.up, e = fr.eu, d = e[0] * up[0] + e[1] * up[1] + e[2] * up[2];
  let x = [e[0] - up[0] * d, e[1] - up[1] * d, e[2] - up[2] * d];
  const l = Math.hypot(x[0], x[1], x[2]); x = [x[0] / l, x[1] / l, x[2] / l];
  const z = [x[1] * up[2] - x[2] * up[1], x[2] * up[0] - x[0] * up[2], x[0] * up[1] - x[1] * up[0]];
  V.M = [x[0], x[1], x[2], up[0], up[1], up[2], z[0], z[1], z[2]];
  const r = world.viewDist * 16, k = V.k, sh = world.shared;
  sh.k.value = k;
  // Fog hides the edge of the loaded chunks. It is pushed out by the height above the ground, so the
  // ground below stays visible when flying; once the globe shows it moves out to the horizon and,
  // high up, away entirely.
  const above = Math.max(0, p.altitude()), horizon = Math.sqrt(Math.max(0, h) * (2 * P.R + Math.max(0, h)));
  const kf = smooth(ALT0, ALT0 + 500, h), lerpLog = (a, b, t) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  const far = lerpLog(r * 0.95 + above, horizon * 1.25, kf) * (1 + 1e4 * smooth(ALT1, 4 * ALT1, h));
  sh.fogFar.value = forceK === 1 ? 1e9 : far;
  sh.fogNear.value = sh.fogFar.value * (0.58 - 0.18 * kf);
  sky.copy(skyA).lerp(skyB, smooth(3000, 60000, h));
  scene.background = sky; sh.fogColor.value.copy(sky);
  camera.near = Math.max(0.05, Math.min(500, (h - 200) * 0.01));
  camera.far = Math.max(r * 1.6 + 400 + above, k > 0 ? horizon * 1.2 + 2000 : 0);
  camera.updateProjectionMatrix();
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
  goGrid(g.f, g.u, g.v);
}
// Travels to grid point (f, u, v), on the ground, or flying at a given layer.
function goGrid(f, u, v, layer) {
  const g = P.wrap(f, u, v, {});
  u = Math.floor(g.u) + 0.5; v = Math.floor(g.v) + 0.5;
  let y = P.H - 1;
  while (y > 1 && !world.solid(world.get(g.f, Math.floor(u), Math.floor(v), y - 1))) y--;
  y = Math.max(y, P.SEA + 1);
  if (layer !== undefined && layer > y) { player.place(g.f, u, v, layer); player.flying = true; }
  else player.place(g.f, u, v, y);
}
function start() {
  seed = parseInt($("seed").value, 10) || 1;
  world.reset();
  world.init(scene, seed);
  BF.globe.reset(scene);
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
  player.setHeading(P.toward({ f: player.f, u: player.u, v: player.v }, { f: v.f, u: v.x, v: v.z }));
  player.pitch = -0.2;
}

// ---- input ----
addEventListener("keydown", (e) => {
  if (!started || tp.open) return;
  if (e.code === "KeyP" || e.code === "Slash") { e.preventDefault(); openTeleport(); return; }
  player.keys[e.code] = true;
  if (e.code === "KeyF") { player.flying = !player.flying; player.vy = 0; }
  if (e.code === "KeyG") player.fast = !player.fast;
  if (e.code === "KeyM") toggleMap();
  if (e.code === "KeyK") flock(4, 6);
  if (e.code === "KeyV") goVillage();
  if (e.code === "KeyL") mobs.lure = !mobs.lure;
  if (e.code === "KeyB") world.showFaces = !world.showFaces;
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

// ---- teleport panel (P) ----
// Corners of the cube: the 8 points where three faces meet. Each is listed by its direction, and
// reached on the face fromDir picks, 40 blocks in from the corner along both grid axes, facing it.
const CORNERS = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
  const lat = Math.asin(sy / Math.sqrt(3)) * 180 / Math.PI, lon = Math.atan2(sx, sz) * 180 / Math.PI;
  CORNERS.push({ d: [sx, sy, sz], lat, lon });
}
function cornerGrid(c) {
  const g = P.fromDir(c.d[0], c.d[1], c.d[2], {});
  return { f: g.f, u: Math.round(g.u), v: Math.round(g.v) };
}
function goCorner(n, inset = 40, height = 30) {
  const c = cornerGrid(CORNERS[n - 1]);
  const su = c.u > 0 ? -1 : 1, sv = c.v > 0 ? -1 : 1;
  goGrid(c.f, c.u + su * inset, c.v + sv * inset);
  player.flying = true; player.y += height;
  const l = Math.SQRT2; player.hu = -su / l; player.hv = -sv / l; player.pitch = -0.35;
}
const tp = { open: false };
function fmt(x) { return Math.round(x).toLocaleString("en-US"); }
function openTeleport() {
  tp.open = true;
  player.keys = {};
  document.exitPointerLock();
  $("tp").style.display = "block";
  $("tpmsg").textContent = `Now: face ${player.f} ${Math.floor(player.u)} ${Math.floor(player.v)}, layer ${Math.floor(player.y)}`;
  $("tpin").value = ""; $("tpin").focus();
}
function closeTeleport() {
  tp.open = false;
  $("tp").style.display = "none";
  renderer.domElement.requestPointerLock();
}
// Accepts "face 2 1000 5000 [layer]", "35.26 45 [layer]" (lat lon, with optional N/S/E/W),
// "corner 3", "up 2000" (fly to that height above sea) or "ground".
function teleport(text) {
  const t = text.trim().toLowerCase(), nums = (t.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  let m;
  if ((m = t.match(/^c(orner)?\s*(\d)/)) && +m[2] >= 1 && +m[2] <= 8) { goCorner(+m[2]); return true; }
  if (t.startsWith("up")) { player.flying = true; player.y = P.SEA + (nums[0] || 2000); return true; }
  if (t.startsWith("ground")) { goGrid(player.f, player.u, player.v); return true; }
  if (/^f/.test(t) && nums.length >= 3 && nums[0] >= 0 && nums[0] <= 5) {
    if (nums[1] < 0 || nums[1] >= P.N || nums[2] < 0 || nums[2] >= P.N) return false;
    goGrid(nums[0], nums[1], nums[2], nums[3]); return true;
  }
  if (nums.length >= 2) {
    let lat = nums[0], lon = nums[1];
    if (/\d\s*s/.test(t)) lat = -Math.abs(lat);
    if (/\d\s*w/.test(t)) lon = -Math.abs(lon);
    if (Math.abs(lat) > 90) return false;
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    const d = [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)], g = P.fromDir(d[0], d[1], d[2], {});
    goGrid(g.f, g.u, g.v, nums[2]); return true;
  }
  return false;
}
function tpGo(text) {
  if (teleport(text)) closeTeleport();
  else $("tpmsg").textContent = "Couldn't read that. Try: face 0 81920 81920 · 35.26 45 · corner 3 · up 5000";
}
$("tpgo").addEventListener("click", () => tpGo($("tpin").value));
$("tpin").addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") tpGo($("tpin").value);
  if (e.key === "Escape") closeTeleport();
});
$("tpclose").addEventListener("click", closeTeleport);
{
  const box = $("tpcorners");
  CORNERS.forEach((c, i) => {
    const g = cornerGrid(c), b = document.createElement("button");
    b.textContent = `${i + 1}`;
    b.title = `${Math.abs(c.lat).toFixed(2)}°${c.lat > 0 ? "N" : "S"} ${Math.abs(c.lon).toFixed(0)}°${c.lon >= 0 ? "E" : "W"} (face ${g.f} ${g.u} ${g.v})`;
    b.addEventListener("click", () => { goCorner(i + 1); closeTeleport(); });
    box.appendChild(b);
  });
  for (const [label, cmd] of [["Ground", "ground"], ["Up 1,000", "up 1000"], ["Up 10,000", "up 10000"], ["Up 300,000", "up 300000"]]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => tpGo(cmd));
    $("tpheights").appendChild(b);
  }
}

// The nearest cube corner: number, distance in blocks, and direction relative to facing.
function cornerLine() {
  const here = { f: player.f, u: player.u, v: player.v };
  let best = null;
  CORNERS.forEach((c, i) => { const g = cornerGrid(c), d = P.distance(here, g); if (!best || d < best.d) best = { n: i + 1, d, g }; });
  return `corner ${best.n} ${best.d < 1000 ? Math.round(best.d) + " blocks" : (best.d / 1000).toFixed(1) + " km"}` + (best.d < 20000 ? " " + bearing(best.g) : "");
}
function bearing(g) {
  const t = P.toward({ f: player.f, u: player.u, v: player.v }, g), h = player.heading, up = player.up;
  const c = [h[1] * t[2] - h[2] * t[1], h[2] * t[0] - h[0] * t[2], h[0] * t[1] - h[1] * t[0]];
  const ang = Math.atan2(c[0] * up[0] + c[1] * up[1] + c[2] * up[2], h[0] * t[0] + h[1] * t[1] + h[2] * t[2]) * 180 / Math.PI;
  return Math.abs(ang) < 15 ? "ahead" : Math.abs(ang) > 165 ? "behind" : `${Math.round(Math.abs(ang))}° ${ang > 0 ? "left" : "right"}`;
}

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
  if (!tp.open) player.update(dt);
  setupView();
  mobs.update(dt, player);
  const st = world.update();
  BF.globe.update(world.view.k);
  const cp = Math.cos(player.pitch);
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(player.hu * cp, Math.sin(player.pitch), -player.hv * cp);
  drawOutline();
  renderer.render(scene, camera);
  if (fpsT === 0) hud(st);
}
function drawOutline() {
  const t = player.target;
  outline.visible = !!t;
  if (!t) return;
  const c = [];
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]])
    c.push(world.toRender(player.f, t.i + x, t.k + z, t.j + y, [0, 0, 0]));
  const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7], arr = outline.geometry.attributes.position.array;
  E.forEach((v, n) => { arr[n * 3] = c[v][0]; arr[n * 3 + 1] = c[v][1]; arr[n * 3 + 2] = c[v][2]; });
  outline.geometry.attributes.position.needsUpdate = true;
}
// Nearest village: distance and direction relative to where the player faces.
function villageLine() {
  const n = BF.villages.near(player.f, player.u, player.v, 3000)[0];
  if (!n) return "no village within 3 km";
  return `${n.v.name} ${n.d < 1000 ? Math.round(n.d) + " blocks" : (n.d / 1000).toFixed(1) + " km"} ${bearing({ f: n.v.f, u: n.v.x, v: n.v.z })}`;
}
function hud(st) {
  const d = P.dir(player.f, player.u, player.v, [0, 0, 0]);
  const lat = Math.asin(d[1]) * 180 / Math.PI, lon = Math.atan2(d[0], d[2]) * 180 / Math.PI;
  const mode = player.flying ? (player.fast ? "fast fly" : "fly") : "walk", k = world.view.k;
  const view = k <= 0 ? "flat" : k >= 1 ? "round" : `blending ${Math.round(k * 100)}% round`;
  $("hud").textContent =
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}  ·  layer ${fmt(player.y)} (sea ${P.SEA})  ·  ${mode}  ·  view ${view}\n` +
    `face ${player.f} u ${Math.floor(player.u)} v ${Math.floor(player.v)}  ·  nearest ${cornerLine()}  ·  travelled ${fmt(player.travelled)} of ${fmt(4 * P.N)} around\n` +
    `nearest village: ${villageLine()}  ·  ${mobs.list.length} sheep${mobs.lure ? " · holding wheat (sheep follow)" : ""}\n` +
    `${fps} fps  ·  view ${world.viewDist} chunks  ·  ${st.meshed}/${st.wanted} chunks meshed`;
}

$("play").addEventListener("click", start);
$("seed").addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
addEventListener("resize", resize);
resize();
setView(8);
requestAnimationFrame(frame);
BF.main = { start, goTo, goGrid, goCorner, teleport, setView, map, renderer, camera, scene, CORNERS, cornerGrid, ALT0, ALT1,
  forceBlend: (k) => { forceK = k; } };
})();
