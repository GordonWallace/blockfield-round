// Headless sheep test: a flock wanders, then follows a wheat-holding player across a cube face edge.
// Usage: node test/sheep.js <url> <outDir> [threeFile]
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [url, out, three] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (three) await page.route(/three\.min\.js/, (r) => r.fulfill({ body: fs.readFileSync(three), contentType: "text/javascript" }));
  await page.goto(url);
  await page.click("#play");
  await page.waitForTimeout(6000);
  // 1. wander: simulate 40 s and measure how far each sheep got
  const wander = await page.evaluate(() => {
    const P = BF.planet, M = BF.mobs, p = BF.player;
    const start = M.list.map((m) => P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]));
    let paths = 0;
    for (let t = 0; t < 800; t++) { M.update(0.05, p); paths += M.list.filter((m) => m.path).length; }
    const moved = M.list.map((m, k) => { const a = P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]); return Math.hypot(a[0] - start[k][0], a[1] - start[k][1], a[2] - start[k][2]).toFixed(1); });
    return { sheep: M.list.length, moved, frames_with_path: paths };
  });
  console.log("wander:", JSON.stringify(wander));
  await page.evaluate(() => { BF.player.pitch = -0.35; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + "/sheep-wander.png" });
  // 2. find grassy land on both sides of the edge between face 0 (u = N) and its neighbour
  const edge = await page.evaluate(() => {
    const P = BF.planet, T = BF.world.terrain, N = P.N, d = [0, 0, 0];
    for (let v = 1000; v < N - 1000; v += 1531) {
      let ok = true;
      for (const du of [-14, -6, 0, 6, 10]) {
        P.dir(0, N - 0.5 + du, v, d);
        const s = T.sample(d[0], d[1], d[2]);
        if (s.top !== BF.B.GRASS || s.h > P.SEA + 40) { ok = false; break; }
      }
      if (ok) return v;
    }
    return null;
  });
  if (edge === null) { console.log("no grassy edge found"); await browser.close(); return; }
  const cross = await page.evaluate((v) => {
    const P = BF.planet, M = BF.mobs, p = BF.player, N = P.N;
    M.clear();
    // player 4 blocks past the edge, on the neighbouring face
    BF.main.goTo(P.dir(0, N + 4, v, [0, 0, 0]));
    // flock 3-9 blocks before the edge on face 0, all within lure range (16)
    for (let k = 0; k < 6; k++) M.spawnSheep(0, N - 3 - Math.random() * 6, v + (Math.random() * 2 - 1) * 4);
    M.lure = true;
    const before = M.list.map((m) => m.f);
    let t = 0;
    for (; t < 1200; t++) { p.update(0.05); M.update(0.05, p); }
    const pp = P.pos(p.f, p.u, p.v, p.y, [0, 0, 0]);
    return {
      player_face: p.f, edge_v: v,
      sheep: M.list.map((m, k) => ({ from: before[k], now: m.f, faces: [...m.faces], dist: Math.hypot(...P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]).map((x, i) => x - pp[i])).toFixed(1) })),
    };
  }, edge);
  console.log("lure across edge:", JSON.stringify(cross));
  // look back at the flock
  await page.evaluate(() => {
    const P = BF.planet, p = BF.player, m = BF.mobs.list[0];
    BF.mobs.lure = false;
    BF.main.goTo(P.dir(p.f, p.u + 9, p.v, [0, 0, 0]));
    const a = P.pos(m.f, m.u, m.v, m.y, [0, 0, 0]), e = P.pos(p.f, p.u, p.v, p.y, [0, 0, 0]);
    const up = P.dir(p.f, p.u, p.v, [0, 0, 0]), d = [a[0] - e[0], a[1] - e[1], a[2] - e[2]], k = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const h = [d[0] - up[0] * k, d[1] - up[1] * k, d[2] - up[2] * k], l = Math.hypot(...h);
    p.setHeading(h.map((x) => x / l)); p.pitch = -0.25;
    p.y += 1.5; p.flying = true;
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out + "/sheep-edge.png" });
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
