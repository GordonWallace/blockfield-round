// Climate and biomes on the planet. Five climate bands run from the equator to the poles, like Earth's:
// tropical, subtropical, temperate, subarctic and arctic. A column's band comes from its "effective latitude":
// the real latitude, wandered by slow noise (so band edges are ragged and reach well past their average) and
// raised by altitude (mountains are colder). Within a band the biome is picked by rainfall, which also follows
// latitude the way Earth's does (wet equator, dry belts near 25 degrees where the great deserts sit, wet
// mid-latitudes, dry poles), plus noise and a drier continental interior.
// Biome ids and names are Blockfield's (worldgen.js), so the table ports back as is.
(() => {
"use strict";
const BF = (window.BF = window.BF || {});
const P = BF.planet;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const OCEAN = 0, BEACH = 1, SNOWY_BEACH = 2, STONY_SHORE = 3, RIVER = 4, PLAINS = 5, FOREST = 6, FLOWER_FOREST = 7,
  BIRCH = 8, DARK_FOREST = 9, SWAMP = 10, MANGROVE = 11, DESERT = 12, BADLANDS = 13, SAVANNA = 14, SPARSE_JUNGLE = 15,
  JUNGLE = 16, TAIGA = 17, OLD_TAIGA = 18, SNOWY_PLAINS = 19, ICE_SPIKES = 20, SNOWY_TAIGA = 21, MEADOW = 22,
  CHERRY = 23, MOUNTAINS = 24, SNOWY_SLOPES = 25, PEAKS = 26, STONY_PEAKS = 27, FROZEN_OCEAN = 29;
const NAMES = ["Ocean", "Beach", "Snowy Beach", "Stony Shore", "River", "Plains", "Forest", "Flower Forest",
  "Birch Forest", "Dark Forest", "Swamp", "Mangrove Swamp", "Desert", "Badlands", "Savanna", "Sparse Jungle",
  "Jungle", "Taiga", "Old Growth Taiga", "Snowy Plains", "Ice Sheet", "Snowy Taiga", "Meadow",
  "Cherry Grove", "Windswept Hills", "Snowy Slopes", "Jagged Peaks", "Stony Peaks", "Mushroom Fields", "Frozen Ocean"];
const BANDS = ["arctic", "subarctic", "temperate", "subtropical", "tropical"];
// Band edges in effective latitude (degrees): arctic above 66, subarctic 55-66, temperate 35-55, subtropical 23-35, tropical below 23.
const EDGES = [66, 55, 35, 23];

// Grass colour per biome (Minecraft-like), used for grass tops and the planet maps.
const GRASS = [];
const g = (b, c) => { GRASS[b] = [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; };
for (let b = 0; b <= FROZEN_OCEAN; b++) g(b, 0x79c05a);
g(PLAINS, 0x91bd59); g(FOREST, 0x79c05a); g(FLOWER_FOREST, 0x79c05a); g(BIRCH, 0x88bb67); g(DARK_FOREST, 0x507a32);
g(SWAMP, 0x6a7039); g(MANGROVE, 0x6a7039); g(SAVANNA, 0xbfb755); g(SPARSE_JUNGLE, 0x64c73f); g(JUNGLE, 0x59c93c);
g(TAIGA, 0x86b783); g(OLD_TAIGA, 0x86b87f); g(SNOWY_TAIGA, 0x80b497); g(SNOWY_PLAINS, 0x80b497); g(MEADOW, 0x83bb6d);
g(CHERRY, 0xb6db61); g(MOUNTAINS, 0x8ab689); g(BADLANDS, 0x90814d); g(DESERT, 0xbfb755);

// Trees: chance per 4 x 4 cell (Blockfield's TREE_DENSITY) and kind.
const TREES = [];
const t = (b, d, kinds) => { TREES[b] = { d, kinds }; };
for (let b = 0; b <= FROZEN_OCEAN; b++) t(b, 0, []);
t(PLAINS, 0.03, ["oak"]); t(FOREST, 0.6, ["oak", "oak", "oak", "birch"]); t(FLOWER_FOREST, 0.35, ["oak", "birch"]);
t(BIRCH, 0.65, ["birch"]); t(DARK_FOREST, 0.85, ["dark"]); t(SWAMP, 0.3, ["swamp"]); t(MANGROVE, 0.6, ["mangrove"]);
t(DESERT, 0.03, ["cactus"]); t(BADLANDS, 0.02, ["cactus"]); t(SAVANNA, 0.08, ["acacia"]); t(SPARSE_JUNGLE, 0.28, ["jungle", "oak"]);
t(JUNGLE, 0.92, ["jungle", "jungle", "bush"]); t(TAIGA, 0.5, ["spruce"]); t(OLD_TAIGA, 0.6, ["spruce", "tallspruce"]);
t(SNOWY_PLAINS, 0.02, ["spruce"]); t(SNOWY_TAIGA, 0.5, ["spruce"]); t(MEADOW, 0.015, ["oak", "birch"]); t(CHERRY, 0.22, ["cherry"]);
t(MOUNTAINS, 0.08, ["spruce"]);

// How each kind of tree looks from far away (stand-ins in lod.js): crown width and the height of the crown's
// middle above the ground, in blocks, and its leaf colour (the leaf block's colour in world.js).
const CROWN = {
  oak: [5, 5, 0x4a8a2a], birch: [5, 6, 0x6a9a4a], swamp: [7, 5, 0x4a8a2a], spruce: [5, 6, 0x3a5e3a], tallspruce: [7, 10, 0x3a5e3a],
  jungle: [7, 12, 0x3a9a24], bush: [5, 1, 0x3a9a24], acacia: [7, 6, 0x7a8a2a], dark: [7, 7, 0x2f5a1c], mangrove: [7, 6, 0x4a7a2a],
  cherry: [7, 5, 0xf0b8d0], cactus: [1, 2, 0x5a8a3a],
};
// Each biome's canopy seen from too far away to make out single trees: the average leaf colour and the
// fraction of the ground the crowns cover (a crown covers about 0.85 of its square).
const CANOPY = TREES.map(({ d, kinds }) => {
  if (!kinds.length) return [0, 0, 0, 0];
  let r = 0, gr = 0, b = 0, area = 0;
  for (const k of kinds) {
    const [w, , c] = CROWN[k];
    r += (c >> 16 & 255) / 255; gr += (c >> 8 & 255) / 255; b += (c & 255) / 255; area += 0.85 * w * w;
  }
  const n = kinds.length;
  return [r / n, gr / n, b / n, Math.min(1, d * area / n / 16)];
});

// Rainfall by latitude (degrees): Earth's zonal pattern.
const RAIN_LAT = [[0, 0.88], [8, 0.78], [15, 0.45], [22, 0.14], [29, 0.22], [38, 0.48], [48, 0.62], [58, 0.58], [68, 0.42], [80, 0.25], [90, 0.2]];
function rainLat(a) {
  for (let k = 1; k < RAIN_LAT.length; k++) if (a <= RAIN_LAT[k][0]) {
    const [a0, r0] = RAIN_LAT[k - 1], [a1, r1] = RAIN_LAT[k], s = (a - a0) / (a1 - a0);
    return r0 + (r1 - r0) * s * s * (3 - 2 * s);
  }
  return 0.2;
}

BF.makeClimate = function (seed) {
  const n = BF.makeNoise(seed ^ 0x1b873593), R = P.R, SEA = P.SEA;
  const out = { lat: 0, elat: 0, band: 0, rain: 0, temp: 0, biome: 0 };
  // Climate at unit direction (x, y, z), ground height h and continent value land (< 0 is sea).
  function at(x, y, z, h, land, detail = true) {
    const X = x * R, Y = y * R, Z = z * R;
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) * 180 / Math.PI, alat = Math.abs(lat);
    // band edges wander by up to about 9 degrees over a few hundred km, and a little more locally
    const wander = n.fbm3(X / 60000, Y / 60000, Z / 60000, 3) * 11 + (detail ? n.fbm3(X / 9000 + 40, Y / 9000, Z / 9000, 2) * 3 : 0);
    const alt = Math.max(0, h - SEA);
    const elat = Math.max(0, alat + wander + 22 * smooth(20, 220, alt));
    let band = 4;
    for (let k = 0; k < 4; k++) if (elat >= EDGES[k]) { band = k; break; }
    const dj = detail ? (n.hash(Math.floor(X), Math.floor(Z), 77) - 0.5) * 0.03 : 0;
    const rain = Math.max(0, Math.min(1, rainLat(alat + wander * 0.5) + n.fbm3(X / 25000 + 90, Y / 25000, Z / 25000, 3) * 0.35
      - 0.22 * smooth(0.12, 0.45, land) + dj));
    const temp = 1 - elat / 90;
    let b;
    if (h < SEA - 1) b = band === 0 ? FROZEN_OCEAN : OCEAN;
    else if (h <= SEA + 1 && land < 0.025) b = band === 0 ? SNOWY_BEACH : BEACH;
    else if (alt > 150) b = band <= 2 ? SNOWY_SLOPES : STONY_PEAKS;
    else if (alt > 105 && band <= 1) b = SNOWY_SLOPES;
    else if (alt > 105) b = MOUNTAINS;
    else if (band === 4) b = rain < 0.22 ? DESERT : rain < 0.4 ? SAVANNA : rain < 0.6 ? SPARSE_JUNGLE : alt < 6 && land < 0.08 ? MANGROVE : JUNGLE;
    else if (band === 3) b = rain < 0.25 ? (alt > 35 ? BADLANDS : DESERT) : rain < 0.42 ? SAVANNA : rain < 0.6 ? PLAINS :
      rain < 0.78 ? (n.fbm3(X / 7000, Y / 7000, Z / 7000 + 33, 2) > 0.3 ? CHERRY : FOREST) : alt < 12 ? SWAMP : SPARSE_JUNGLE;
    else if (band === 2) b = rain < 0.3 ? PLAINS : rain < 0.45 ? (alt > 40 ? MEADOW : PLAINS) :
      rain < 0.62 ? (n.fbm3(X / 6000 + 7, Y / 6000, Z / 6000, 2) > 0.25 ? FLOWER_FOREST : FOREST) : rain < 0.8 ? BIRCH : alt < 10 ? SWAMP : DARK_FOREST;
    else if (band === 1) b = rain < 0.25 ? SNOWY_PLAINS : elat > 61 ? SNOWY_TAIGA : rain > 0.7 ? OLD_TAIGA : TAIGA;
    else b = elat > 80 ? ICE_SPIKES : elat < 70 && rain > 0.55 ? SNOWY_TAIGA : SNOWY_PLAINS;
    out.lat = lat; out.elat = elat; out.band = band; out.rain = rain; out.temp = temp; out.biome = b;
    return out;
  }
  return { at };
};

// Map colour of a terrain sample (0..1 RGB): biome colours on land, depth-shaded water, ice and snow.
const MAPC = [];
const mc = (b, c) => { MAPC[b] = [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; };
mc(BEACH, 0xd8cc94); mc(SNOWY_BEACH, 0xe8eef2); mc(DESERT, 0xdcc98c); mc(BADLANDS, 0xb8653a); mc(SAVANNA, 0xb3ab5a);
mc(SPARSE_JUNGLE, 0x4f9e34); mc(JUNGLE, 0x2f7d20); mc(MANGROVE, 0x4b6a2c); mc(PLAINS, 0x8db657); mc(FOREST, 0x4f8a35);
mc(FLOWER_FOREST, 0x6a9a40); mc(CHERRY, 0xc9a2b8); mc(BIRCH, 0x6ea14c); mc(DARK_FOREST, 0x2f5420); mc(SWAMP, 0x4f5a30);
mc(MEADOW, 0x9cc070); mc(TAIGA, 0x4f7a5a); mc(OLD_TAIGA, 0x3e6a4a); mc(SNOWY_TAIGA, 0x8fa8a0); mc(SNOWY_PLAINS, 0xe6ecef);
mc(ICE_SPIKES, 0xc8def0); mc(MOUNTAINS, 0x7d8f72); mc(SNOWY_SLOPES, 0xf2f4f6); mc(STONY_PEAKS, 0x8a8a88); mc(RIVER, 0x3f76e4);
function mapColour(s) {
  if (s.h < P.SEA) return s.ice ? [0.86, 0.92, 0.96] : [0.12, 0.22 + (s.h - 40) / 300, 0.5 + (s.h - 40) / 200];
  return MAPC[s.biome] || [0.5, 0.6, 0.4];
}

BF.climate = {
  NAMES, BANDS, GRASS, TREES, CROWN, CANOPY, mapColour,
  ID: { OCEAN, BEACH, SNOWY_BEACH, STONY_SHORE, RIVER, PLAINS, FOREST, FLOWER_FOREST, BIRCH, DARK_FOREST, SWAMP, MANGROVE, DESERT,
    BADLANDS, SAVANNA, SPARSE_JUNGLE, JUNGLE, TAIGA, OLD_TAIGA, SNOWY_PLAINS, ICE_SPIKES, SNOWY_TAIGA, MEADOW, CHERRY, MOUNTAINS,
    SNOWY_SLOPES, PEAKS, STONY_PEAKS, FROZEN_OCEAN },
};
})();
