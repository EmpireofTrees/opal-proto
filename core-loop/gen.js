// EXP-004 — 3D opal rough generation + per-stone intrinsics (Phase B).
// A rough is an irregular nodule: host-rock skin shell, a wavy 3D OPAL SEAM inside,
// potch/matrix elsewhere. Plus per-stone value intrinsics (type, body tone, brightness,
// color-rarity, pattern) rolled to honor real opal rarity. See docs/domain/game-mapping.md.

(function () {
  const SKIN = 0, OPAL = 1, POTCH = 2, MATRIX = 3, EMPTY = 4;

  function hash3(x, y, z) {
    let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
    const x00 = lerp(c(0,0,0), c(1,0,0), u), x10 = lerp(c(0,1,0), c(1,1,0), u);
    const x01 = lerp(c(0,0,1), c(1,0,1), u), x11 = lerp(c(0,1,1), c(1,1,1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
  // tiny string->seed and seeded offset vector
  function seedVec(seedStr, salt) {
    let h = 2166136261 ^ salt;
    const s = seedStr + ':' + salt;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); }
    const r = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
    return [r() * 100, r() * 100, r() * 100, r()];
  }
  function makeRng(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    let a = h >>> 0;
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function weightedPick(rng, pairs) { let tot = 0; for (const p of pairs) tot += p[1]; let x = rng() * tot; for (const p of pairs) { if ((x -= p[1]) <= 0) return p[0]; } return pairs[pairs.length - 1][0]; }

  // intrinsic value lookups — see docs/domain/game-mapping.md §A/§B
  const TONE_BY_TYPE = { white: [7, 9], crystal: [5, 9], boulder: [3, 6], dark: [5, 6], black: [1, 4], ethiopian: [5, 9] };
  const BASE_BY_TYPE = { black: 12, dark: 9, crystal: 8, boulder: 7, ethiopian: 5, white: 5 };
  const COLOR_HUE = { red: 0.00, orange: 0.07, yellow: 0.15, green: 0.38, blue: 0.60, purple: 0.78 };
  const COLOR_SCORE = { red: 1.0, orange: 0.85, yellow: 0.7, green: 0.55, blue: 0.35, purple: 0.4 };
  const PATTERN_SCORE = { none: 0.2, pinfire: 0.4, floral: 0.45, straw: 0.6, broad: 0.65, rolling: 0.68, ribbon: 0.8, flagstone: 0.85, harlequin: 1.0 };

  function generateVolume(seedStr, N) {
    N = N || 22;
    const mat = new Int8Array(N * N * N).fill(EMPTY);
    const qual = new Float32Array(N * N * N);
    const center = (N - 1) / 2;
    const R = N * 0.40;
    const s1 = seedVec(seedStr, 1), s2 = seedVec(seedStr, 2), s3 = seedVec(seedStr, 3), s4 = seedVec(seedStr, 4);
    const hot = [center + (s4[0] - 0.5) * R, center + (s4[1] - 0.5) * R, center + (s4[2] - 0.5) * R];
    let opalCount = 0;

    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - center, dy = y - center, dz = z - center;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const nod = R * (0.80 + 0.42 * noise3(x*0.13 + s1[0], y*0.13 + s1[1], z*0.13 + s1[2]));
      if (d > nod) continue; // empty (outside the nodule)
      const idx = x + N * (y + N * z);
      const depthFromSurf = nod - d;
      if (depthFromSurf < 1.4) { mat[idx] = SKIN; continue; }

      const seam = noise3(x*0.16 + s2[0], y*0.16 + s2[1], z*0.16 + s2[2]);
      const hw = 0.05 + 0.035 * noise3(x*0.09 + s2[2], y*0.09 + s2[0], z*0.09 + s2[1]);
      if (Math.abs(seam - 0.5) < hw) {
        mat[idx] = OPAL; opalCount++;
        const dh = Math.sqrt((x-hot[0])**2 + (y-hot[1])**2 + (z-hot[2])**2) / R;
        qual[idx] = Math.max(0, Math.min(1, 0.85 * (1 - dh) + 0.3 * noise3(x*0.2 + s3[0], y*0.2 + s3[1], z*0.2 + s3[2])));
      } else if (depthFromSurf > R * 0.62) {
        mat[idx] = MATRIX;
      } else {
        mat[idx] = POTCH;
      }
    }
    // ---- per-stone intrinsics (the value ceiling; game-mapping.md §A) ----
    const ri = makeRng(seedStr + ':intrinsics');
    const type = weightedPick(ri, [['white', 38], ['crystal', 16], ['ethiopian', 15], ['boulder', 12], ['dark', 12], ['black', 7]]);
    const tr = TONE_BY_TYPE[type];
    const toneN = tr[0] + Math.floor(ri() * (tr[1] - tr[0] + 1));                    // N1..N9
    const brightnessB = weightedPick(ri, [[1, 3], [2, 7], [3, 14], [4, 24], [5, 26], [6, 18], [7, 8]]); // B1 brilliant..B7 weak
    const color = weightedPick(ri, [['blue', 40], ['green', 28], ['yellow', 14], ['orange', 10], ['purple', 5], ['red', 3]]);
    const pattern = weightedPick(ri, [['none', 45], ['pinfire', 18], ['floral', 12], ['straw', 8], ['broad', 6], ['rolling', 5], ['ribbon', 3], ['flagstone', 2], ['harlequin', 1]]);

    // ---- opal proximity field (for honest surface cues) ----
    const near = new Uint8Array(N * N * N);
    const rad = 2;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (mat[x + N * (y + N * z)] !== OPAL) continue;
      for (let dz = -rad; dz <= rad; dz++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const nx = x + dx, ny = y + dy, nz = z + dz; if (nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N) continue;
        const v = Math.max(0, 255 - (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) * 70);
        const ni = nx + N * (ny + N * nz); if (v > near[ni]) near[ni] = v;
      }
    }

    return {
      N, mat, qual, near, seed: seedStr, opalCount, center, R,
      type, toneN, brightnessB, color, pattern,
      hue: COLOR_HUE[color], colorScore: COLOR_SCORE[color], patternScore: PATTERN_SCORE[pattern], baseValue: BASE_BY_TYPE[type],
    };
  }

  // surface voxel = present and has at least one empty/out-of-bounds 6-neighbour
  function isSurface(vol, x, y, z) {
    const { N, mat } = vol;
    const at = (a,b,c) => (a<0||b<0||c<0||a>=N||b>=N||c>=N) ? EMPTY : mat[a + N*(b + N*c)];
    if (at(x,y,z) === EMPTY) return false;
    return at(x+1,y,z)===EMPTY||at(x-1,y,z)===EMPTY||at(x,y+1,z)===EMPTY||
           at(x,y-1,z)===EMPTY||at(x,y,z+1)===EMPTY||at(x,y,z-1)===EMPTY;
  }

  globalThis.OpalGen = { SKIN, OPAL, POTCH, MATRIX, EMPTY, generateVolume, isSurface, noise3 };
})();
