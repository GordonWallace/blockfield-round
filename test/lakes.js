// Headless look at lakes: finds the lakes with the most rivers flowing in and views each from above, to see
// the inflows end at the shore and one outlet leave from the lowest bank. Saves screenshots. HIGH=1 picks
// the biggest lakes at least 20 blocks above sea level instead; LAKES=n sets how many.
// Usage: node test/lakes.js <url> <outDir> [threeFile]   (threeFile replaces the CDN copy of three.js when offline)
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
  await page.waitForTimeout(8000);
  // lakes by the number of rivers flowing in
  const lakes = await ev(([count, high]) => {
    const RV = BF.world.terrain.rivers(), ins = new Map();
    for (const n of RV.link) if (RV.isLake(RV.down[n])) ins.set(RV.down[n], (ins.get(RV.down[n]) || 0) + 1);
    // the busiest lakes, or (HIGH) the biggest well above sea level
    const pick = high ? RV.lakes.map((L, k) => [RV.NN + k, L]).filter(([, L]) => L.draw > BF.planet.SEA + 20).sort((a, b) => b[1].cells.length - a[1].cells.length).map(([id]) => [id, ins.get(id) || 0])
      : [...ins].sort((a, b) => b[1] - a[1]);
    return pick.slice(0, count).map(([id, k]) => {
      const L = RV.lakes[id - RV.NN];
      let x = 0, y = 0, c = 0;
      for (const n of RV.link) if (RV.down[n] === id && RV.faceOf(n) === L.F) { x += RV.U[n]; y += RV.V[n]; c++; }
      return { id, inflows: k, level: L.draw, F: L.F, u: (L.ox + (c ? x / c : L.ox)) / 2, v: (L.oy + (c ? y / c : L.oy)) / 2, cells: L.cells.length, out: RV.down[id] };
    });
  }, [Number(process.env.LAKES || 3), !!process.env.HIGH]);
  for (const L of lakes) {
    for (const h of [1800, 4000]) {
      await ev(([L, h]) => {
        BF.main.goGrid(L.F, L.u, L.v);
        const p = BF.player; p.flying = true; p.fast = true; p.y = BF.planet.SEA + h; p.pitch = -1.5;
      }, [L, h]);
      // until the distant terrain there is built (or 60 s)
      await page.waitForTimeout(3000);
      for (let t = 0; t < 57000 && (await ev(() => BF.sampler.pending() + BF.lod.levels.filter((L) => L.building).length)); t += 1000) await page.waitForTimeout(1000);
      await page.waitForTimeout(2000);
      console.log(`lake ${L.id}: level ${L.level}, ${L.inflows} rivers in, ${L.cells} cells, outlet to ${L.out}, ${h} up`, errors.slice(0, 3).join(" / "));
      await page.screenshot({ path: `${out}/lake-${L.id}-${h}.png` });
    }
  }
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
