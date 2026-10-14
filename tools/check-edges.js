// Checks the unfold maps in planet.js: for all 24 face edges, a straight walk across the edge, with the
// facing turned the way player.js turns it, carries on straight in the flat (unfolded) view.
// Usage: node tools/check-edges.js
global.window = {}; require(__dirname + "/../js/planet.js"); const P = window.BF.planet, N = P.N;
let bad = 0;
for (let f = 0; f < 6; f++) for (let s = 0; s < 4; s++) {
  const h = [[-1,0],[1,0],[0,-1],[0,1]][s];
  const start = [h[0] ? (h[0] < 0 ? 3 : N - 3) : 40000, h[1] ? (h[1] < 0 ? 3 : N - 3) : 40000];
  const pt = [start[0] + h[0] * 7, start[1] + h[1] * 7];
  const g = P.wrap(f, pt[0], pt[1], {}), e = P.UNFOLD[f][g.f], A = e.A;
  const hu = A[0] * h[0] + A[2] * h[1], hv = A[1] * h[0] + A[3] * h[1];      // as player.cross()
  const nxt = [g.u + hu * 10, g.v + hv * 10];                               // 10 more blocks on g
  const back = [A[0] * nxt[0] + A[1] * nxt[1] + e.t[0], A[2] * nxt[0] + A[3] * nxt[1] + e.t[1]];  // into f's flat grid
  const want = [pt[0] + h[0] * 10, pt[1] + h[1] * 10];
  if (Math.hypot(back[0] - want[0], back[1] - want[1]) > 1e-6) { bad++; console.log(f, s, back, want); }
}
console.log(bad ? bad + " bad" : "all 24 edge crossings continue straight in the flat view");
