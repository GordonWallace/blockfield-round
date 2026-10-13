# Blockfield Round

A prototype of [Blockfield](https://github.com/GordonWallace/blockfield) on a round planet. The question it
answers is whether a voxel world can be wrapped onto a sphere and still be coherent and cheap to run.
It has one mob, Blockfield's sheep. There are no rivers, textures, saving or inventory yet.

Run it with `./run.sh` and open http://localhost:8000.

## The planet

- **Cube-sphere.** Six square faces, each 163,840 x 163,840 block columns, are projected onto a sphere.
  The equator is 655,360 blocks around, which is about 127 game days or 42 hours of nonstop walking at
  Blockfield's speed (4.3 blocks/s, 20-minute days). The sea-level radius is about 104,300 blocks, so the
  ground looks flat: even at the largest view distance the horizon drops less than a block.
- **Blocks.** A block is addressed by face, grid coordinates (u, v) and layer y. Columns point straight
  out from the centre, so "down" is always -y within a face and physics works exactly as on a flat world.
  A tan warp spaces columns by equal angle, which keeps blocks within about 30% of square everywhere.
  Near the 8 cube corners the blocks are visibly skewed into rhombuses.
- **Face edges.** Any lookup that runs off a face goes through `BF.planet.wrap`, which re-expresses it on the
  neighbouring face. The player's facing is a 3D vector, so walking across an edge needs no special rules.
  Grid rows line up one-to-one across every edge, so terrain meets without gaps.
- **Terrain.** Heights, coasts and climate are 3D noise sampled at each column's direction, so continents
  run seamlessly across faces. Latitude drives temperature, which gives you ice caps, snow, deserts and grass.
  The planet is about a third land.
- **Precision.** Each chunk mesh is built relative to its own anchor and placed relative to the camera every
  frame, so float32 rendering stays exact anywhere on the planet.

## Villages

Villages use the **chart method** (see [docs/village-method.md](docs/village-method.md)). Each cube face is a flat
integer grid, so a village uses its face's grid as its own flat world, and Blockfield's x/z village maths runs on it
unchanged. A village's footprint never crosses a face edge, which rules out only 0.8% of regions. Siting uses Blockfield's
region grid and `siteOK`. The layout is a simple flat-world placeholder: houses on a ring around a well, joined by paths.
Press V to travel to the nearest village. The HUD shows the nearest village's distance and direction.

## Sheep

The sheep are a port of Blockfield's: same model, size, speed and lure range, with flat colours. A mob is
located the same way as the player, by face, (u, v) and layer, and walks with the same grid collision.
- **Wandering.** It idles, then picks a spot 3-8 blocks away along the ground and walks there.
- **Paths.** Routes are A* over standable cells, with the same moves as Blockfield's villager paths:
  step up 1, drop up to 3, avoid water. A neighbour that falls off the face is looked up on the face it
  belongs to, so a route runs straight across an edge.
- **Steering.** A sheep aims at each waypoint in 3D, which stays correct when the waypoint is on the next face.
- **Following.** Press L to hold wheat. Sheep within 16 blocks follow you, re-planning every second.

## Controls

WASD to move, Space to jump, Ctrl to sprint. F toggles flying (Space and Shift go up and down) and G toggles
fast flying. M opens the planet map, where you drag to turn, scroll to zoom and click to travel. T jumps to
random land, V goes to the nearest village, K spawns more sheep, L holds wheat, and + / - change the view distance. Left click breaks a block and right click places planks.

## Files

| File | Purpose |
|---|---|
| `js/noise.js` | Seeded simplex noise, copied unchanged from Blockfield |
| `js/planet.js` | Cube-sphere maths: grid to direction, direction to grid, wrapping and local frames |
| `js/terrain.js` | Continents, heights, climate and surface blocks |
| `js/world.js` | Chunks, block access across edges, meshing and loading |
| `js/player.js` | Movement, collision, facing and block picking |
| `js/villages.js` | Charts, village siting, layout and stamping into chunks, nearest-village search |
| `js/mobs.js` | Sheep: model, wandering, A* paths across face edges, following |
| `js/main.js` | Start-up, frame loop, HUD and planet map |
| `tools/planet-map.js` | `node tools/planet-map.js [seed] [out.png]` renders a flat world map and prints the land fraction |
| `test/smoke.js` | Headless Playwright run: spawn, walk, cross a face edge and open the map, with screenshots |
| `tools/village-stats.js` | `node tools/village-stats.js [seed]`: how many regions get villages and how many the edge margin excludes |
| `test/villages.js` | Headless run: visits the nearest village and one by a cube corner, counts their blocks |
| `test/sheep.js` | Headless run: a flock wanders, then follows the player across a face edge |
