# A true sphere of near-cubic blocks

Gordon asked (2026-11-02) for a prototype world that is an actual sphere, because on the cube-sphere a
trip takes 0.89 to 1.48 times as long as the same trip would on a real sphere, depending on where it is and
which way it heads. He wanted three things:

1. Any point on the surface can be given as latitude and longitude.
2. A path between any two points is as long as it would be on a real sphere.
3. Any point can be given as x, y, z on a 3D grid, with the planet sitting in that space.

All three work in `sphere.html`, which you open next to the cube-sphere game: run `./run.sh` and go to
http://localhost:8000/sphere.html. `node tools/sphere-check.js` checks them (it takes about a second).

## The method: rows of latitude, cut into columns

Gordon suggested variable or not-quite-cubic blocks, and the prototype uses them, but only a little.

- **Rows.** The planet keeps the cube-sphere's size: 655,360 blocks round the equator, radius 104,302.
  Pole to pole is cut into 327,680 rows of latitude, so every row is **exactly one block** from south to
  north, everywhere.
- **Columns.** A row at latitude L is 655,360 × cos L blocks round, so each row is cut into fewer columns
  the nearer it is to a pole. Rows are grouped into **bands** of whole chunk rows (16 rows), and every row in
  a band has the same number of columns, a multiple of 16. A band ends where its blocks would get 3% too
  narrow, and the next band starts with fewer columns. So blocks are **0.97 to 1.03 blocks wide and exactly
  1 deep** everywhere except the last 257 rows round each pole: 1.3 parts per million of the surface.
- **Bands.** There are 253 bands. The one at the equator runs from 19.7° S to 19.7° N (71,552 rows). They
  get shorter towards the poles: about 10,600 rows tall at 30°, 6,500 at 45°, 3,600 at 60°, 1,100 at 80°,
  and 96 at 89°. The last six bands are one chunk row each.
- **Seams.** Where two bands meet, the columns don't line up, so the blocks on either side are offset like a
  course of bricks. Between 20° and 60° a seam comes every 7 km or so of travel north or south, and between
  60° and 80° every 2 km. Nothing else about a seam is special: you walk over it and see a brick offset in
  the ground. Within a band, the block to the north is the same column; across a seam it is the column
  covering the same longitude (`S.neighbour`), and up to two columns share a border (`S.overlap`).
- **Poles.** The last chunk row round each pole has 112 columns, and those blocks are wedges that narrow
  from 0.9 wide to a point at the pole. That is the only place a block is visibly not square. The
  cube-sphere has 8 corners like this, each about a kilometre across; this has 2, each 16 blocks across.
- **Layers.** Columns point straight out from the centre, as on the cube-sphere: layer 96 is sea level and
  there are 320 layers. A block's top is 0.3% wider at layer 320 than at layer 0, which nobody can see.

## The three descriptions of a point (`js/sphere.js`)

Every point has three equivalent addresses, and each one converts to the others exactly. The worst round
trip error over 2,000 random points is 1.4e-10 blocks.

- **Latitude, longitude and layer.** Longitude 0 points along +z, and east is towards +x.
- **Block: row, column, layer.** Row 0 is at the south pole. Column 0 starts at 180° and counts east.
- **x, y, z in space.** These are in blocks, with the planet's centre at the origin and +y through the
  north pole. A point at layer y is (R + y − 96) from the centre, and its 3D cell is just the floor of each
  coordinate.

The functions are `S.fromLatLon`, `S.toLatLon`, `S.xyz`, `S.fromXYZ` and `S.blockAt` (x, y, z to a block).
The HUD in `sphere.html` shows all three as you move.

## Why trips are the right length

The player's position is a point on the sphere (a unit vector plus a layer), not a grid position. Moving
takes a step along a great circle. The heading is carried along by parallel transport, so "straight ahead"
stays straight. The block grid is only asked which block a point is in, so travel time is real distance
divided by speed, exactly.

- **Walks.** 200 straight walks of 200 to 3,200 blocks each ended a great-circle distance from the start
  equal to the distance walked, to within 0.0012%. A 50 km flight in the browser walked 50,000.48 blocks
  and ended 50,000.52 from the start.
- **The cube-sphere, for comparison.** A 500-block walk along a face grid covers anywhere from 355 to 500
  real blocks.
- **Blocks crossed.** Walking along a row or column crosses 0.99 to 1.04 blocks per block of distance, so
  blocks still feel like blocks.

## Paths for things that find their way (`js/sphere-path.js`)

- **The search.** A* runs over blocks, stepping to the 8 surrounding blocks. Across a seam that is the
  columns that share a border. Each step costs the real distance between the two block centres, so the
  search finds the shortest path through block centres.
- **Pulling the path tight.** A block path zigzags, coming out 0.1% to 8% too long. The path is then pulled
  tight along great circles over walkable ground.
- **Results.** `tools/sphere-check.js` tries a band seam, the column wrap at 180°, a seam at 80°, a trip
  over the north pole, and a 200-block wall. On open ground the tightened path equals the great-circle
  distance. Round the wall it takes the true shortest way, via the wall's end (282.5 blocks against 200
  straight).

## What the viewer has, and what it doesn't

- **What it has:**
  - terrain, climate and biomes from the cube-sphere's `terrain.js`, sampled at each column's direction,
    so continents, coasts and mountains are the same planet;
  - walking with gravity, jumping, stepping up one-block rises, sliding along walls, flying and fast flight;
  - breaking and placing blocks;
  - a middle-distance terrain disc between the loaded chunks and the globe;
  - a whole-planet globe for high views;
  - P to teleport to any latitude and longitude (try 89.99N 0E to see a pole);
  - M to mark a spot and compare the distance walked with the straight-line distance on the sphere;
  - trees by biome (Blockfield's shapes, laid out by row and column, never across a seam) and rivers and
    lakes carved in from the existing river network;
  - sheep (`js/sphere-mobs.js`) that stand on the blocks, wander, and follow you when you hold wheat (L),
    finding their way with the A* above and walking along great circles at a fixed real speed. K adds more.
- **What it doesn't have:** villages, other mobs, textures, saving, and the cube-sphere's distant
  stand-ins.

## Trade-offs against the cube-sphere

| | Cube-sphere (1.4) | True sphere (this) |
|---|---|---|
| Trip length vs a real sphere | 0.89-1.48x | exact |
| Block shape | 0.71-1.0 wide, skewed up to 30° near corners | 0.97-1.03 wide, 1 deep, square corners |
| Special places | 12 face edges (rotation on crossing) and 8 corners (kept as ocean) | 252 seams (brick offset, no rotation) and 2 poles (16-block wedge caps) |
| A flat x/z grid for local code | one per face, 163,840 square, needs unfolding across edges | one per band, wraps east-west on its own, rows never rotate |
| Drawing near the ground | flat drawing, round view near corners | true positions everywhere, floating origin |

The cube-sphere's grid is perfectly regular and the sphere's isn't. The true sphere gives that up to get
exact distances and fewer special cases. A seam is far simpler to cross than a face edge: the column number
is rescaled (c × n2 / n) and nothing turns.

## What a port into Blockfield would involve (inferred, not built)

- **Keep grid coordinates in the sim, but make them honest.** Treat each band as a flat x/z grid: x is the
  column (it wraps at n) and z is the row. Things move in real blocks per second by dividing east-west
  speed by that row's block width (0.97 to 1.03). That gives true travel times to well under a percent
  without changing how mobs and villagers store their positions.
- **Turn the heading as things move.** A straight walk (a great circle) turns in grid terms by sin(latitude)
  times the change in longitude, because meridians converge. That one correction keeps the player and mobs
  walking straight.
- **Cross seams with a rescale.** Neighbour lookups across a seam rescale the column (S.neighbour,
  S.overlap). That replaces the face-edge unfold tables, the rotations and the corner special cases.
- **Keep villages and structures inside one band**, as the cube-sphere keeps them inside one face.
  Mid-latitude bands are kilometres tall, so this only bites above about 85°.
- **Carry over everything that works by direction:** terrain, climate, and the river lattice (via direction
  lookups). The world itself would be new: cube-sphere saves can't be carried over.
- **Rendering:** chunk meshes with true corner positions and a floating origin (as here), plus the existing
  distant rings and stand-ins rebuilt for latitude bands.

My guess is that this is a release-sized change, like the 1.4 port. It would remove code (edges, corners,
unfolding) as well as add it, but that estimate is not measured.

## Files

- `js/sphere.js`: the grid, the bands and all the conversions.
- `js/sphere-path.js`: A* and path tightening.
- `js/sphere-mobs.js`: sheep.
- `js/sphere-world.js`: chunks, meshing, physics, the middle-distance disc, the globe and the HUD.
- `sphere.html`: the page.
- `tools/sphere-check.js`: the checks quoted above.
