# Blockfield Round

A prototype of [Blockfield](https://github.com/GordonWallace/blockfield) on a round planet. The question it
answers is whether a voxel world can be wrapped onto a sphere and still be coherent and cheap to run.
It has one mob, Blockfield's sheep. There are no textures, saving or inventory yet.

Run it with `./run.sh` and open http://localhost:8000.

## The planet

- **Cube-sphere.** Six square faces, each 163,840 x 163,840 block columns, are projected onto a sphere.
  The equator is 655,360 blocks around, which is about 127 game days or 42 hours of nonstop walking at
  Blockfield's speed (4.3 blocks/s, 20-minute days). The sea-level radius is about 104,300 blocks, so the
  ground looks flat: even at the largest view distance the horizon drops less than a block.
- **Blocks.** A block is addressed by face, grid coordinates (u, v) and layer y. Columns point straight
  out from the centre, so "down" is always -y within a face and physics works exactly as on a flat world.
  A tan warp spaces columns by equal angle. On the true sphere that keeps blocks within about 30% of
  square, skewed into rhombuses near the 8 cube corners, but near the ground they are drawn flat (below).
- **Face edges.** Two neighbouring faces lie flat side by side exactly: grid rows line up one to one along
  the shared edge, so the neighbour's grid is placed by a 90-degree rotation plus an offset (`P.EDGE`,
  `P.UNFOLD`). Any lookup that runs off a face goes through `BF.planet.wrap`, which applies that unfold.
  The player's facing is a grid direction, and crossing an edge turns it by the same rotation, so a
  straight walk stays straight (`node tools/check-edges.js` checks all 24 edges).
- **Corners.** Only three faces meet at a cube corner (270 degrees instead of 360), so flat drawing can't
  close up there. Within about a kilometre of each of the 8 corners the view switches to the true round
  drawing instead (blocks there are skewed by up to 30 degrees), and terrain keeps every corner open ocean
  (land fades out between 4 and 1.5 km), so all you see is water. Press C to show the alternative, a
  90-degree wedge left empty, visible only within view distance of the corner point. Press P and pick a
  corner to visit one; B tints each face so the three are easy to tell apart.
- **Terrain.** Heights and coasts are 3D noise sampled at each column's direction, so continents run
  seamlessly across faces. The planet is about a third land.
- **Climate bands** (`js/climate.js`). Five bands run from the equator to the poles, as on Earth: tropical,
  subtropical, temperate, subarctic and arctic. A column's band comes from its climate latitude: its real
  latitude, wandered by slow noise (edges are ragged and reach up to about 10 degrees past their average) and
  raised by altitude (about 20 degrees colder on high ground, so mountains carry snow and taiga further toward
  the equator). Within a band, rainfall picks the biome. Rainfall also follows latitude like Earth's: a wet
  equator, a dry belt around 22 degrees where the deserts and badlands sit, wet mid-latitudes and dry poles,
  plus noise and drier continental interiors. Each band has several biomes: jungle, sparse jungle, mangrove,
  savanna and desert in the tropics; desert, badlands, savanna, plains, forest, cherry grove and swamp in the
  subtropics; plains, meadow, forest, flower forest, birch and dark forest in the temperate band; taiga, old
  taiga, snowy taiga and snowy plains in the subarctic; and snowy plains, snowy taiga and ice sheet in the
  arctic. Biome ids and names are Blockfield's. Trees (`js/flora.js`) follow the biome.
- **Rivers** (`js/rivers.js`). The whole planet's drainage is solved when a world starts (under a second):
  a node about every kilometre, a priority flood from the sea so every node has a way down, steepest descent
  so water gathers into trunk rivers, flow summed from the sources so tributaries join into wider rivers,
  and a water surface set from the sea upward so it never rises downstream. The blocks are carved from
  that: channel, banks one block above the water, valley sides cut back where hills stand in the way, and a
  levee where a river crosses low ground. Rivers freeze over in the arctic band. `node tools/river-check.js`
  proves the network and the generated blocks never go uphill (see the file for exactly what it checks).
- **Precision.** Each chunk mesh is built relative to its own anchor and placed relative to the camera every
  frame, so float32 rendering stays exact anywhere on the planet.

## Flat near the ground, round from high up

- **Flat view.** Up to 250 blocks above sea level (above the 320-layer build limit) the world is drawn like
  a flat world in the player's face grid, so every block is a perfect square, even at a corner. Chunks on
  the next face are unfolded rigidly across the edge.
- **Round view.** Each chunk mesh also carries its true position on the sphere. Between 250 and 2,500
  blocks above the sea a small shader blends every vertex from flat to round. Up there a coarse mesh of
  the whole planet (192 x 192 cells per face, built the first time it is needed) fills in beyond the
  loaded chunks, and fog lifts toward the horizon. Higher still the sky darkens and the planet hangs in space.
- **What changes in the blend.** Away from corners, flat and round differ by under a block across the
  loaded area, so the blend is invisible there; the planet's roundness shows through the distant mesh.
  At a corner the wedge closes and the three faces meet as rhombuses, as they really are.
- **Getting up there.** Fast flight (G) speeds up with height, so holding Space reaches orbit in seconds.
  The teleport panel has buttons for 1,000, 10,000 and 300,000 blocks up.

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
fast flying (faster the higher you are). M opens the planet map, where you drag to turn, scroll to zoom and click
to travel. P opens the teleport panel (also /): type `face 0 81920 81920 [layer]`, `35.26 45 [layer]` (latitude
and longitude, N/S/E/W allowed), `corner 1`-`corner 8` or `up 5000`, or press a corner or height button.
B tints each cube face, C switches corners between the round view and an empty wedge, and R draws the
true sphere everywhere, to compare (for example, rows of blocks bending where they cross a face edge). T jumps to random land, V goes to the nearest village, K spawns more sheep, L holds
wheat, and + / - change the view distance. Left click breaks a block and right click places planks.

## Files

| File | Purpose |
|---|---|
| `js/noise.js` | Seeded simplex noise, copied unchanged from Blockfield |
| `js/planet.js` | Cube-sphere maths: grid to direction, direction to grid, edge unfolds, wrapping and local frames |
| `js/climate.js` | Climate bands, rainfall, biome choice, grass colours, tree table, map colours |
| `js/rivers.js` | The planet-wide river network and the nearest-river lookup used for carving |
| `js/terrain.js` | Continents, heights, surface blocks, and river carving (`surface`, `column`) |
| `js/flora.js` | Trees by biome, whole across face edges |
| `js/world.js` | Chunks, block access across edges, meshing and loading, flat and round placement and the blend shader |
| `js/globe.js` | The coarse whole-planet mesh shown in the round view |
| `js/player.js` | Movement, collision, facing and block picking |
| `js/villages.js` | Charts, village siting, layout and stamping into chunks, nearest-village search |
| `js/mobs.js` | Sheep: model, wandering, A* paths across face edges, following |
| `js/main.js` | Start-up, frame loop, view blend, fog and sky, HUD, teleport panel and planet map |
| `tools/check-edges.js` | `node tools/check-edges.js`: a straight walk across each of the 24 face edges stays straight |
| `test/flat.js` | Headless run: crosses an edge, visits two corners (as drawn, tinted, forced round), climbs to orbit, uses the teleport panel |
| `tools/planet-map.js` | `node tools/planet-map.js [seed] [out.png] [width] [lat lon span]` renders a world map (biomes, band edges, rivers) and prints land, band, biome and river figures |
| `tools/river-check.js` | `node tools/river-check.js [seed] [rivers]`: no loops, no uphill steps, no crossings, and on the blocks no rises, dry stretches or spills |
| `test/smoke.js` | Headless Playwright run: spawn, walk, cross a face edge and open the map, with screenshots |
| `tools/village-stats.js` | `node tools/village-stats.js [seed]`: how many regions get villages and how many the edge margin excludes |
| `test/villages.js` | Headless run: visits the nearest village and one by a cube corner, counts their blocks |
| `test/sheep.js` | Headless run: a flock wanders, then follows the player across a face edge |
