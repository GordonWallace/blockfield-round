// Headless test of flat drawing and the blend to round: walks across a face edge, visits a cube corner,
// climbs through the blend, and uses the teleport panel. Saves screenshots.
// Usage: node test/flat.js <url> <outDir> [threeFile]   (threeFile replaces the CDN copy of three.js when offline)
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
  await page.fill("#seed", process.env.SEED || "1");
  await page.click("#play");
  const wait = (ms) => page.waitForTimeout(ms);
  const hud = () => page.$eval("#hud", (e) => e.textContent);
  const shot = async (name) => { console.log(name + ":\n" + await hud()); await page.screenshot({ path: `${out}/${name}.png` }); };
  const ev = (f, a) => page.evaluate(f, a);
  await wait(8000);
  await ev(() => { BF.player.pitch = -0.25; });
  await wait(1500);
  await shot("flat-spawn");

  // walk straight across a face edge: the facing should turn with the unfold and the walk stay straight
  const before = await ev(() => {
    const p = BF.player, N = BF.planet.N;
    BF.main.goGrid(p.f, N - 12.5, p.v); p.flying = true; p.y += 6; p.hu = 1; p.hv = 0; p.pitch = -0.3;
    return { f: p.f, u: p.u, v: p.v, hu: p.hu, hv: p.hv };
  });
  await wait(3000);
  await page.keyboard.down("KeyW"); await wait(4000); await page.keyboard.up("KeyW");
  const after = await ev(() => { const p = BF.player; return { f: p.f, u: p.u, v: p.v, hu: p.hu, hv: p.hv }; });
  console.log("edge crossing:", JSON.stringify(before), "->", JSON.stringify(after));
  await wait(2000);
  await shot("flat-edge");

  // a cube corner from 40 blocks up, 70 blocks in from it, looking at it: flat, flat with face tints,
  // and the same spot forced into the round view
  for (const n of (process.env.CORNERS || "1,6").split(",").map(Number)) {
    await ev((n) => { BF.main.goCorner(n, 70, 40); BF.main.setView(10); }, n);
    await wait(9000);
    await shot(`corner${n}-flat`);
    await ev(() => { BF.world.showFaces = true; }); await wait(800);
    await shot(`corner${n}-faces`);
    await ev(() => BF.main.forceBlend(1)); await wait(1500);
    await shot(`corner${n}-forced-round`);
    await ev(() => { BF.main.forceBlend(null); BF.world.showFaces = false; });
  }
  // climbing above corner 1
  await ev((n) => { BF.main.goCorner(n, 300, 0); BF.player.pitch = -0.6; }, +(process.env.CORNERS || "1").split(",")[0]);
  for (const h of [600, 1400, 2600, 12000, 60000, 300000]) {
    await ev((h) => { const p = BF.player; p.flying = true; p.y = BF.planet.SEA + h; p.pitch = h > 20000 ? -1.5 : -0.6; }, h);
    await wait(h === 600 ? 9000 : 5000);
    await shot(`climb-${h}`);
  }
  // teleport panel by keyboard
  await ev(() => { BF.main.goGrid(0, 81920, 81920); BF.player.pitch = -0.2; });
  await wait(4000);
  await page.keyboard.press("KeyP"); await wait(500);
  await page.fill("#tpin", "35.26N 45E");
  await page.screenshot({ path: `${out}/teleport-panel.png` });
  await page.press("#tpin", "Enter"); await wait(6000);
  await shot("teleport-latlon");
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await browser.close();
})();
