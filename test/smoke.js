// Headless smoke test: starts a world, walks, flies across a cube edge, opens the map, and saves screenshots.
// Usage: node test/smoke.js <url> <outDir> [threeFile]   (threeFile replaces the CDN copy of three.js when offline)
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const [url, out, three] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (three) await page.route(/three\.min\.js/, (r) => r.fulfill({ body: fs.readFileSync(three), contentType: "text/javascript" }));
  await page.goto(url);
  await page.fill("#seed", "1");
  await page.click("#play");
  const settle = async (ms) => { const t = Date.now(); await page.waitForTimeout(ms); };
  await settle(8000);
  await page.evaluate(() => { BF.player.pitch = -0.25; });
  await settle(1500);
  const hud = () => page.$eval("#hud", (e) => e.textContent);
  console.log("spawn:\n" + await hud());
  await page.screenshot({ path: out + "/spawn.png" });
  // look toward the horizon and walk forward
  await page.evaluate(() => { BF.player.pitch = -0.05; });
  await page.keyboard.down("KeyW"); await settle(4000); await page.keyboard.up("KeyW");
  console.log("after walking:\n" + await hud());
  await page.screenshot({ path: out + "/walk.png" });
  // put the player near a face edge and fly across it
  const before = await page.evaluate(() => {
    const p = BF.player, N = BF.planet.N;
    BF.main.goTo(BF.planet.dir(p.f, N - 15, p.v, [0, 0, 0]));
    p.flying = true; p.y += 30; p.pitch = -0.4;
    p.hu = 1; p.hv = 0;
    return { f: p.f, u: p.u };
  });
  await settle(3000);
  await page.keyboard.down("KeyW"); await settle(6000); await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => ({ f: BF.player.f, u: BF.player.u, v: BF.player.v, chunks: BF.world.meshes.size }));
  console.log("edge crossing:", JSON.stringify(before), "->", JSON.stringify(after));
  await settle(3000);
  await page.screenshot({ path: out + "/edge.png" });
  // high view over a coast
  await page.evaluate(() => { const p = BF.player; BF.main.goTo(BF.planet.dir(p.f, p.u, p.v, [0, 0, 0])); p.y += 120; p.pitch = -0.45; BF.main.setView(16); });
  await settle(10000);
  console.log("high view:\n" + await hud());
  await page.screenshot({ path: out + "/high.png" });
  await page.keyboard.press("KeyM"); await settle(3000);
  await page.screenshot({ path: out + "/map.png" });
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
