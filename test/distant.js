// Headless test of distant terrain: climbs above land, waits for the rings, then flies fast at 2,500 blocks
// up, then goes out to planet scale. Saves screenshots and logs how much was built and how fast frames came.
// Usage: node test/distant.js <url> <outDir> [threeFile]   (threeFile replaces the CDN copy of three.js when offline)
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [url, out, three] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);   // software rendering of the whole globe is slow
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (three) await page.route(/three\.min\.js/, (r) => r.fulfill({ body: fs.readFileSync(three), contentType: "text/javascript" }));
  await page.goto(url);
  await page.fill("#seed", process.env.SEED || "1");
  await page.click("#play");
  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (f, a) => page.evaluate(f, a);
  const state = () => ev(() => ({
    hud: document.querySelector("#hud").textContent.split("\n").slice(0, 2).join(" | "),
    rings: BF.lod.levels.map((L) => (L.mesh ? (L.show ? "+" : "-") : ".") + (L.building ? "*" : "")).join(" "),
    globe: BF.globe.built + "/" + BF.globe.tiles.length, queue: BF.sampler.pending(), workers: BF.sampler.workers.length, inline: BF.sampler.inline,
  }));
  const shot = async (name) => { console.log(name, JSON.stringify(await state()), errors.slice(0, 3).join(" / ")); await page.screenshot({ path: `${out}/${name}.png` }); };
  await wait(8000);
  // over land near the spawn, 2,500 blocks up, looking ahead and down
  await ev(() => { const p = BF.player; p.flying = true; p.fast = true; p.y = BF.planet.SEA + 2600; p.pitch = -0.7; });
  for (const t of [3000, 10000, 20000]) { await wait(t === 3000 ? 3000 : t - (t === 10000 ? 3000 : 10000)); await shot(`high-${t / 1000}s`); }
  // fast flight forward
  await page.keyboard.down("KeyW");
  for (let i = 1; i <= 4; i++) { await wait(2500); await shot(`flying-${i}`); }
  await page.keyboard.up("KeyW");
  await wait(6000); await shot("stopped");
  // straight down
  await ev(() => { BF.player.pitch = -1.5; }); await wait(2000); await shot("down");
  // above a big river, 2,500 and 600 blocks up
  await ev(() => {
    const RV = BF.world.terrain.rivers();
    let best = RV.link[0];
    for (const n of RV.link) if (RV.acc[n] > RV.acc[best] && RV.acc[n] < 400) best = n;
    BF.main.goGrid(RV.faceOf(best), RV.U[best], RV.V[best]);
    const p = BF.player; p.flying = true; p.fast = true; p.y = BF.planet.SEA + 2600; p.pitch = -1.0;
  });
  await wait(15000); await shot("river-2600");
  await ev(() => { const p = BF.player; p.y = BF.planet.SEA + 700; p.pitch = -0.8; });
  await wait(10000); await shot("river-700");
  // planet scale
  for (const h of [20000, 180000]) {
    await ev((h) => { const p = BF.player; p.y = BF.planet.SEA + h; p.pitch = -1.5; }, h);
    await wait(6000); await shot(`planet-${h}`);
  }
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
