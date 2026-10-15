// Headless look at tree and house stand-ins and the chunk cut-off: finds a forest near the spawn and views it
// from just above the trees, from either side of the height where chunks stop, from 2,000 up and from planet
// scale. Saves screenshots and logs the stand-ins per ring and whether chunks are loaded.
// Usage: node test/standins.js <url> <outDir> [threeFile]   (threeFile replaces the CDN copy of three.js when offline)
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [url, out, three] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (three) await page.route(/three\.min\.js/, (r) => r.fulfill({ body: fs.readFileSync(three), contentType: "text/javascript" }));
  await page.goto(url);
  await page.fill("#seed", process.env.SEED || "1");
  await page.click("#play");
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForTimeout(6000);
  // a big forest (BIOME=name picks another biome): a spot whose surroundings are mostly that biome
  const spot = await ev((name) => {
    const P = BF.planet, T = BF.world.terrain, C = BF.climate, n = BF.makeNoise(99), d = [0, 0, 0], g = {};
    const want = C.ID[name];
    const is = (f, u, v) => { P.wrap(f, u, v, g); P.dir(g.f, g.u, g.v, d); const s = T.sample(d[0], d[1], d[2]); return s.h > P.SEA && s.biome === want; };
    for (let i = 0; i < 20000; i++) {
      const q = [n.hash(i, 1) * 2 - 1, n.hash(i, 2) * 2 - 1, n.hash(i, 3) * 2 - 1], c = P.fromDir(q[0], q[1], q[2], {});
      if (!is(c.f, c.u, c.v)) continue;
      let k = 0;
      for (let a = 0; a < 8; a++) k += is(c.f, c.u + Math.cos(a * Math.PI / 4) * 1500, c.v + Math.sin(a * Math.PI / 4) * 1500) ? 1 : 0;
      if (k >= 7) return { f: c.f, u: c.u, v: c.v, biome: name };
    }
    return null;
  }, process.env.BIOME || "FOREST");
  console.log("forest", JSON.stringify(spot));
  const state = () => ev(() => ({
    hud: document.querySelector("#hud").textContent.split("\n")[3],
    chunks: BF.world.chunksOn, meshes: BF.world.meshes.size, data: BF.world.chunks.size,
    rings: BF.lod.levels.map((L) => (L.mesh ? (L.show ? "+" : "-") : ".") + (L.stands || "") + "~" + Math.round(L.meshMs || 0) + (L.building ? "*" : "") + "/" + Math.round(L.buildMs)).join(" "),
    pxScale: BF.world.shared.pxScale ? Math.round(BF.world.shared.pxScale.value) : 0,
  }));
  const settle = async () => {
    await page.waitForTimeout(3000);
    for (let t = 0; t < 60000 && (await ev(() => BF.sampler.pending() + BF.lod.levels.filter((L) => L.building).length)); t += 1000) await page.waitForTimeout(1000);
    await page.waitForTimeout(2500);
  };
  const views = process.env.MOVE_ONLY ? [] : [["low", 60, -0.12], ["chunks-on", 380, -0.45], ["chunks-off", 560, -0.45], ["high", 2000, -0.8], ["high-down", 2000, -1.5], ["planet", 20000, -1.5], ["planet-far", 180000, -1.5]];
  for (const [name, h, pitch] of views) {
    await ev(([s, h, pitch]) => {
      BF.main.goGrid(s.f, s.u, s.v);
      const p = BF.player; p.flying = true; p.fast = false; p.y = p.y + h; p.pitch = pitch;
    }, [spot, h, pitch]);
    await settle();
    console.log(name, JSON.stringify(await state()), errors.slice(0, 3).join(" / "));
    await page.screenshot({ path: `${out}/standins-${name}.png` });
  }
  // moving: rings rebuilt around a new spot keep the stand-ins they share with the old ones; they must match
  // rings built from scratch there
  const go = (du) => ev(([s, du]) => { BF.main.goGrid(s.f, s.u + du, s.v); const p = BF.player; p.flying = true; p.y += 700; p.pitch = -0.5; }, [spot, du]);
  await go(0); await settle();
  await go(900); await settle();
  console.log("moved", JSON.stringify(await state()));
  const ringsAt = () => ev(() => BF.lod.levels.slice(0, 4).map((L) => [L.f, L.cu, L.cv, L.stands]));
  const moved = await ringsAt();
  await page.screenshot({ path: `${out}/standins-moved.png` });
  await ev(() => BF.lod.reset(BF.main.scene));
  await settle();
  console.log("fresh", JSON.stringify(await state()));
  // rings at the same centre must hold the same stand-ins, reused or not
  const fresh = await ringsAt();
  fresh.forEach((r, i) => console.log(`ring ${i}: moved ${moved[i].join(" ")} / fresh ${r.join(" ")}` +
    (r[0] === moved[i][0] && r[1] === moved[i][1] && r[2] === moved[i][2] ? (r[3] === moved[i][3] ? " SAME" : " DIFFERENT") : " (moved centre)")));
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
