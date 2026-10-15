// Background worker for distant terrain: samples grids of terrain surfaces (see grid.js) off the main thread.
// It builds its own copy of the terrain from the seed (including the river network) on its first job.
self.window = self;
importScripts("noise.js", "planet.js", "climate.js", "rivers.js", "terrain.js", "grid.js");
let T = null;
onmessage = (e) => {
  const job = e.data;
  if (!T || T.seed !== job.seed) T = BF.makeTerrain(job.seed);
  const out = BF.gridJob.alloc(job);
  BF.gridJob.rows(T, job, out, 0, job.ny);
  postMessage(out, BF.gridJob.buffers(out));
};
