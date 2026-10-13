# Porting Blockfield's x/z maths to the globe: the chart method

Gordon asked (2026-10-13) for a method for translating Blockfield's flat-world village code to the cube-sphere planet in blockfield-round. The method below is prototyped in that repo: `js/villages.js`, `js/planet.js` (`distance` and `toward`), and `test/villages.js`.

## The idea in one paragraph

Each cube face is already a flat integer grid, 163,840 blocks square. So any code that works within one place (a village, its buildings, its farms, its pens and its paths) can treat its face as Blockfield's flat world: x = u, z = v, y = layer. That code runs unchanged, block for block. A **chart** is a small adapter that gives Blockfield's world API (`getBlock(x, y, z)`, `setBlock`, `surface`) for one face. The one new rule is that **a village's footprint never crosses a face edge**, so no chart ever has a seam. Code that spans places uses planet helpers that work across faces instead of `Math.hypot(dx, dz)`: villages talking to each other, distances, directions and long journeys.

## What the prototype shows

- **Siting.** The siting code is Blockfield's `siteOK` (strict level) with its region grid (384), jitter and VLIM. It runs unchanged on charts. The only new line is a margin check that keeps regions away from face edges.
- **Layout.** The layout code is written as plain flat-world code: a ring of plots, overlap tests, Blockfield's `rot90` from blueprints.js, and L-shaped paths to the well. It builds coherent villages anywhere on a face. That includes one 330 blocks from a cube corner, where the grid is skewed by 30°.
- **Chunk generation.** Villages are stamped while chunks generate, the same way Blockfield writes structures per chunk. A plan is bucketed by chunk and keyed by (face, region).
- **Cost of the edge rule.** The edge margin excludes **0.8% of regions** (`node tools/village-stats.js`). About 16% of regions get a village, which is roughly 178,000 on the planet.
- **Long-range lookups.** `villages.near()` finds villages across face edges by sampling region centres through `P.wrap`. The HUD shows the nearest village's distance and direction using `P.distance` and `P.toward`.

## Conversion rules, by kind of x/z code

| Kind of code | Where in Blockfield (examples) | Rule on the globe | Effort |
|---|---|---|---|
| **1. Block access** (`getBlock`, `setBlock`, `isLoaded`; about 350 calls in 40 files) | everywhere | Every place-bound system holds a chart for its face and calls `chart.getBlock(x, y, z)`. A villager's chart is its village's chart. | Mechanical |
| **2. Local geometry** (offsets, plots, `rot90`, blueprints, door facings, farm beds, pens, "within N blocks" checks, A* paths) | worldgen villages, blueprints, builder, jobs, farmland, shepherd, cowherd, poultry, pigfarmer, stables, bees, forester, miner | Unchanged, as x/z on the chart. This is most of the village code and needs no rewrite. | None |
| **3. Positions of mobs** | mobs.js and every AI | Store (face, u, v, y). On a chart these are the same numbers as (x, z), so a villager's position needs no conversion. Wild mobs crossing a face edge re-wrap, which already works for sheep. | Small |
| **4. Distances and directions between places** (`Math.hypot(dx, dz)` between villages or to the player; about 365 calls in total, most of them local) | villagesim, village loading (200/216 rules), caravans, merchant, explorer, wildlife spawn zones, audio falloff | One helper: `dist(a, b)` is `hypot` when both are on the same face and close, and `P.distance` otherwise. Directions use `P.toward`. A long route is a chain of great-circle waypoints with a local A* between them; that A* already crosses edges. | Moderate: about 15 files need judgment |
| **5. Grid-keyed worldgen and caches** (`REGION` grid, `zoneKind` 4x4-chunk regions, `"x,z"` keys, save keys) | worldgen, wildlife, mobsave, save | Add the face to every key (`f:rx:rz`). Regions are defined per face on (u, v). Saves need a format version. | Mechanical |
| **6. Compass directions** | door, stair and bed facings; signposts; maps | Block facings stay relative to the grid, so no change is needed. Anything the player reads as a compass (signposts, map north, the sun) uses geographic north from the planet, which is not grid north. | Small |
| **7. Maps** | cartography, mapview, debug screen | Local maps (a village or a map item) draw one chart, as now. World-scale maps use latitude and longitude, like `tools/planet-map.js`. | Moderate |

## Constraints the method accepts

- **Grid distortion.** The cube-sphere grid is not square everywhere. Near the 8 corners it is skewed by up to 30°, and along face edges the blocks are as narrow as 0.71. Villages look exactly as skewed as the terrain around them, because they share its grid. If that matters, siting can also require skew under 15°, which still leaves 77% of the surface eligible.
- **Edge bands.** Villages can't sit across a face edge, and nothing a village owns (farms, pens, bridges) may reach beyond VLIM + margin. Villagers and caravans can still walk across edges.
- **Long journeys aren't straight in grid terms.** A great-circle walk drifts across the grid near edges (seen with the sheep). Code that steers by "dx, dz to target" must steer by `P.toward` instead.

## Suggested order for a full port

1. Port the world, charts and saves with face-keyed data.
2. Port the village generator and builders, which are rules 1, 2 and 5. This is the biggest pile of code but mostly mechanical.
3. Port villager AI within a village, with positions as chart coordinates (rule 3).
4. Port the cross-village systems (rule 4): village loading, villagesim, caravans, merchants and explorers.
5. Port maps and the debug screen (rule 7).

A rough size for steps 2–4 is about one release's worth of work, comparable to the 1.3 economy and village-loading series. Most of it is mechanical, with judgment needed in about 15 files.
