// EXP-001 — art-free cut/grind/score loop.
// Goal: prove there's a learnable skill in reading a hidden opal band and
// grinding to the right depth with no undo. Visuals are deliberately ugly.

// ---------- seeded randomness ----------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise on a lattice, seeded. Returns f(x,y) in ~[0,1].
function makeNoise(rng, cells) {
  const grid = [];
  for (let j = 0; j <= cells; j++) {
    grid[j] = [];
    for (let i = 0; i <= cells; i++) grid[j][i] = rng();
  }
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  return function (u, v) {
    // u,v in [0,1]
    const x = u * cells, y = v * cells;
    const x0 = Math.min(cells - 1, Math.floor(x)), y0 = Math.min(cells - 1, Math.floor(y));
    const tx = fade(x - x0), ty = fade(y - y0);
    const top = lerp(grid[y0][x0], grid[y0][x0 + 1], tx);
    const bot = lerp(grid[y0 + 1][x0], grid[y0 + 1][x0 + 1], tx);
    return lerp(top, bot, ty);
  };
}

// ---------- materials ----------
const SKIN = 0, OPAL = 1, POTCH = 2, MATRIX = 3, EMPTY = 4;

// ---------- stone generation ----------
// Each column: { skin, bandTop, bandBot, q }  (depths are layer indices 0..D-1)
function generateStone(seedStr, W, H, D) {
  const seedFn = xmur3(seedStr);
  const rng = mulberry32(seedFn());
  const nSkin = makeNoise(rng, 4);
  const nGap = makeNoise(rng, 3);
  const nThick = makeNoise(rng, 5);
  const nDead = makeNoise(rng, 3);
  const nQual = makeNoise(rng, 6);

  // play-of-color hotspot (where quality peaks)
  const hot = { x: 0.2 + 0.6 * rng(), y: 0.2 + 0.6 * rng() };
  const deadCut = 0.30 + 0.25 * rng(); // fraction of stone that's dead-ish
  const colorPalette = rng(); // per-stone hue seed for art-free "play of color"

  const cols = [];
  for (let y = 0; y < H; y++) {
    cols[y] = [];
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = y / (H - 1);
      const skin = 1 + Math.round(2.5 * nSkin(u, v));            // 1..~4
      const gap = Math.round(2 * nGap(u, v));                     // 0..2 potch/clay over band
      const dead = nDead(u, v) < deadCut;
      const thick = dead ? 0 : 1 + Math.round(3 * nThick(u, v));  // 1..4
      const bandTop = skin + gap;
      const bandBot = Math.min(D - 1, bandTop + thick);

      // quality: hotspot falloff + a little noise
      const dx = u - hot.x, dy = v - hot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let q = (1 - Math.min(1, dist / 0.75)) * 0.85 + 0.25 * nQual(u, v);
      q = Math.max(0, Math.min(1, q));

      cols[y][x] = { skin, bandTop, bandBot, q, dead, hue: colorPalette };
    }
  }
  return { W, H, D, cols, seed: seedStr };
}

function materialAt(stone, x, y, depth) {
  const c = stone.cols[y][x];
  if (depth >= stone.D) return EMPTY;
  if (depth < c.skin) return SKIN;
  if (!c.dead && depth >= c.bandTop && depth < c.bandBot) return OPAL;
  if (depth >= stone.D - 2) return MATRIX;
  return POTCH;
}

// opal cells removed above the current grind depth (destroyed waste)
function destroyedInColumn(stone, x, y, grindDepth) {
  const c = stone.cols[y][x];
  if (c.dead) return 0;
  let n = 0;
  const top = Math.max(c.bandTop, 0);
  const bot = Math.min(c.bandBot, grindDepth);
  if (bot > top) n = bot - top;
  return n;
}

// ---------- scoring ----------
// grind: 2D array of current grind depth per column. Returns a breakdown object.
function scoreState(stone, grind) {
  const { W, H } = stone;
  let totalOpal = 0, sumQ = 0, junkExposed = 0, worked = 0, destroyed = 0;
  const isOpal = [];
  for (let y = 0; y < H; y++) {
    isOpal[y] = [];
    for (let x = 0; x < W; x++) {
      const g = grind[y][x];
      if (g > 0) worked++;
      destroyed += destroyedInColumn(stone, x, y, g);
      const m = materialAt(stone, x, y, g);
      if (m === OPAL) {
        totalOpal++; sumQ += stone.cols[y][x].q; isOpal[y][x] = true;
      } else {
        isOpal[y][x] = false;
        if (g > 0 && (m === POTCH || m === MATRIX)) junkExposed++;
      }
    }
  }
  // largest contiguous exposed-opal region (4-neighbour flood)
  let face = 0;
  const seen = [];
  for (let y = 0; y < H; y++) seen[y] = new Array(W).fill(false);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isOpal[y][x] || seen[y][x]) continue;
      let size = 0; const stack = [[x, y]]; seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop(); size++;
        const nb = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        for (const [nx, ny] of nb) {
          if (nx>=0&&nx<W&&ny>=0&&ny<H&&isOpal[ny][nx]&&!seen[ny][nx]) {
            seen[ny][nx] = true; stack.push([nx, ny]);
          }
        }
      }
      if (size > face) face = size;
    }
  }
  const avgColor = totalOpal ? sumQ / totalOpal : 0;
  const cleanliness = (totalOpal + junkExposed) ? totalOpal / (totalOpal + junkExposed) : 0;
  const sizeScore = face + 0.25 * (totalOpal - face);
  const value = Math.max(0, Math.round(
    sizeScore * (0.4 + 0.6 * avgColor) * (0.5 + 0.5 * cleanliness) * 12 - destroyed * 18
  ));
  return { totalOpal, face, avgColor, cleanliness, destroyed, value };
}

// Par: expose every opal column exactly at band top; leave the rest untouched.
function parState(stone) {
  const grind = [];
  for (let y = 0; y < stone.H; y++) {
    grind[y] = [];
    for (let x = 0; x < stone.W; x++) {
      const c = stone.cols[y][x];
      grind[y][x] = c.dead ? 0 : c.bandTop;
    }
  }
  return scoreState(stone, grind);
}

// Flat: best single flat grind depth across the whole face.
function flatBest(stone) {
  let best = { value: -1, depth: 0 };
  for (let d = 0; d < stone.D; d++) {
    const grind = [];
    for (let y = 0; y < stone.H; y++) { grind[y] = new Array(stone.W).fill(d); }
    const s = scoreState(stone, grind);
    if (s.value > best.value) best = { ...s, depth: d };
  }
  return best;
}

// shallowness of opal under a column, 0 (deep/none) .. 1 (right at surface) — for the cue sheen
function opalShallowness(stone, x, y) {
  const c = stone.cols[y][x];
  if (c.dead) return 0;
  return Math.max(0, 1 - c.bandTop / (stone.D * 0.6));
}

window.OpalSim = {
  generateStone, materialAt, scoreState, parState, flatBest, opalShallowness,
  SKIN, OPAL, POTCH, MATRIX, EMPTY,
};
