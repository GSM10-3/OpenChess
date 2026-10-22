import { mulberry32 } from './rng';
import { WATER, PLAINS, HIGHLAND, MOUNTAIN } from './constants';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function valueNoise(width, height, cell, rng) {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy);
    const ty = smooth(gy - y0);
    for (let x = 0; x < width; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx);
      const tx = smooth(gx - x0);
      const a = grid[y0 * gw + x0];
      const b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0];
      const d = grid[(y0 + 1) * gw + x0 + 1];
      out[y * width + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }
  }
  return out;
}

// 대륙 몇 개와 섬들이 있는 지도를 만든다
export function generateMap({ width = 200, height = 130, seed = 1, landShare = 0.48 } = {}) {
  const rng = mulberry32(seed * 7919 + 13);
  const N = width * height;
  const h = new Float32Array(N);
  for (const [cell, amp] of [[40, 1], [20, 0.5], [10, 0.25], [5, 0.12]]) {
    const n = valueNoise(width, height, cell, rng);
    for (let i = 0; i < N; i++) h[i] += n[i] * amp;
  }
  // 지도 가장자리는 바다
  const margin = Math.min(width, height) * 0.12;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = Math.min(x, y, width - 1 - x, height - 1 - y) / margin;
      if (e < 1) h[y * width + x] -= (1 - e) * 0.8;
    }
  }
  const sorted = Float32Array.from(h).sort();
  const sea = sorted[Math.floor(N * (1 - landShare))];
  const landHeights = sorted.subarray(Math.floor(N * (1 - landShare)));
  const highCut = landHeights[Math.floor(landHeights.length * 0.68)];
  const mountainCut = landHeights[Math.floor(landHeights.length * 0.9)];

  const terrain = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (h[i] < sea) terrain[i] = WATER;
    else if (h[i] >= mountainCut) terrain[i] = MOUNTAIN;
    else if (h[i] >= highCut) terrain[i] = HIGHLAND;
    else terrain[i] = PLAINS;
  }
  return analyzeMap(width, height, terrain);
}

// 땅덩어리 번호, 해안 칸 등을 계산 (테스트용 지도도 여기를 거친다)
export function analyzeMap(width, height, terrain) {
  const N = width * height;
  const landmass = new Int32Array(N).fill(-1);
  const landmassSize = [];
  const coastal = new Uint8Array(N);
  const coastTiles = [];
  const queue = new Int32Array(N);
  let landCount = 0;

  const forNeighbors = (i, fn) => {
    const x = i % width;
    if (x > 0) fn(i - 1);
    if (x < width - 1) fn(i + 1);
    if (i >= width) fn(i - width);
    if (i < N - width) fn(i + width);
  };

  for (let i = 0; i < N; i++) {
    if (terrain[i] === WATER) continue;
    landCount++;
    let coast = false;
    forNeighbors(i, (n) => {
      if (terrain[n] === WATER) coast = true;
    });
    if (coast) {
      coastal[i] = 1;
      coastTiles.push(i);
    }
    if (landmass[i] >= 0) continue;
    const id = landmassSize.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    landmass[i] = id;
    while (head < tail) {
      const t = queue[head++];
      const x = t % width;
      const around = [x > 0 ? t - 1 : -1, x < width - 1 ? t + 1 : -1, t - width, t + width];
      for (const n of around) {
        if (n >= 0 && n < N && terrain[n] !== WATER && landmass[n] < 0) {
          landmass[n] = id;
          queue[tail++] = n;
        }
      }
    }
    landmassSize.push(tail);
  }
  return { width, height, terrain, landmass, landmassSize, coastal, coastTiles, landCount };
}
