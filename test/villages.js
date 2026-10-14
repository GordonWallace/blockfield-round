// Headless village test: travels to the nearest village and to one near a cube corner (the most skewed grid),
// checks the houses were built, and saves screenshots. Usage: node test/villages.js <url> <outDir> [threeFile]
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
  await page.waitForTimeout(5000);
  const count = () => page.evaluate(() => {
    // count village blocks within 60 blocks of the village the player is looking at
    const v = BF.villages.near(BF.player.f, BF.player.u, BF.player.v, 200)[0];
    if (!v) return null;
    const ch = BF.chart(v.v.f), n = {};
    for (let z = v.v.z - 60; z <= v.v.z + 60; z++) for (let x = v.v.x - 60; x <= v.v.x + 60; x++)
      for (let y = BF.planet.SEA; y < BF.planet.SEA + 60; y++) {
        const b = ch.getBlock(x, y, z);
        if (b >= BF.B.PLANKS) n[b] = (n[b] || 0) + 1;
      }
    return { name: v.v.name, face: v.v.f, x: v.v.x, z: v.v.z, houses: BF.villages.plan(v.v).houses, blocks: n };
  });
  await page.keyboard.press("KeyV");
  await page.evaluate(() => { BF.player.flying = true; BF.player.y += 25; BF.player.pitch = -0.45; });
  await page.waitForTimeout(9000);
  console.log("nearest village:", JSON.stringify(await count()));
  console.log((await page.$eval("#hud", (e) => e.textContent)).split("\n")[2]);
  await page.screenshot({ path: out + "/village.png" });
  // a village close to a cube corner, where the face grid is most skewed
  const corner = await page.evaluate(() => {
    const V = BF.villages, R = V.REGION;
    for (let f = 0; f < 6; f++) for (let r = 1; r < 20; r++) for (let a = 0; a <= r; a++) {
      const s = V.site(f, a, r) || V.site(f, r, a);
      if (s) {
        const fr = BF.planet.frame(f, s.x, s.z, BF.planet.SEA, {}), eu = fr.eu, ev = fr.ev;
        const cos = (eu[0] * ev[0] + eu[1] * ev[1] + eu[2] * ev[2]) / Math.hypot(...eu) / Math.hypot(...ev);
        BF.main.goTo(BF.planet.dir(f, s.x + 0.5, s.z - 45.5, [0, 0, 0]));
        const p = BF.player;
        p.setHeading(BF.planet.toward({ f: p.f, u: p.u, v: p.v }, { f, u: s.x, v: s.z }));
        p.flying = true; p.y += 25; p.pitch = -0.45;
        return { face: f, x: s.x, z: s.z, skew_deg: +(Math.asin(Math.abs(cos)) * 180 / Math.PI).toFixed(1), aspect: +(Math.hypot(...eu) / Math.hypot(...ev)).toFixed(2) };
      }
    }
    return null;
  });
  await page.waitForTimeout(9000);
  console.log("corner village:", JSON.stringify(corner), JSON.stringify(await count()));
  await page.screenshot({ path: out + "/village-corner.png" });
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
