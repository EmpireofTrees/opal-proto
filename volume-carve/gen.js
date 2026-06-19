// EXP-003 — 3D opal rough generation (pure, no rendering deps so it's headless-testable).
// A rough is an irregular nodule: host-rock skin shell, a wavy 3D OPAL SEAM inside,
// potch/matrix elsewhere. You carve the volume to expose & keep the seam.

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
    return { N, mat, qual, seed: seedStr, opalCount, center, R };
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
