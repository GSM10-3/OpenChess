import { mulberry32 } from './rng';
import { generateMap, analyzeMap } from './mapgen';
import * as C from './constants';
import { PIECES, FORMATION, pieceLabel, josa } from './pieces';
import { botThink, BOT_NAMES, DIFFICULTY } from './bot';
import { castleOptions, evaluatePocket } from './chess';

// 나라 색: 사람은 선명한 파랑 하나로 고정, 봇은 차분한 중채도 색.
// 노랑(나 · 버튼)과 빨강(체크 · 위협), 하늘색(동맹 국경), 검정은 UI 가 쓰므로 봇 색에서 뺐다.
export const HUMAN_COLOR = '#0072B2';
export const BOT_COLORS = [
  '#4d9a5b', '#7fae3e', '#2f8f78', '#9cc48a', '#5c7a3a', '#5fb3b3',
  '#1f6f78', '#7b8fc7', '#2e4a7d', '#7a5aa6', '#a77bca', '#5b3f8c',
  '#b05f9e', '#d08fc0', '#8e4a7a', '#c7798f', '#d9822b', '#e0a46b',
  '#b5651d', '#8c5a3c', '#c06c4f', '#8f8a3c', '#a68a64', '#6b4f3a',
  '#7d8597', '#a3a8b4', '#4f5d6b', '#b8a9d9', '#6f9c8a', '#a0522d',
];

// sRGB → CIE Lab (색 사이 거리를 사람 눈에 가깝게 재려고)
function hexToLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const colorDistance = (a, b) => Math.hypot(...hexToLab(a).map((v, i) => v - hexToLab(b)[i])); // ΔE76

// 이미 쓰인 색들과 가장 먼 봇 색 (max-min 탐욕 배정, 난수를 쓰지 않는다)
function pickBotColor(used) {
  if (!used.length) return BOT_COLORS[0];
  const labs = used.map(hexToLab);
  let best = BOT_COLORS[0];
  let bestD = -1;
  for (const c of BOT_COLORS) {
    if (used.includes(c)) continue;
    const l = hexToLab(c);
    const d = Math.min(...labs.map((u) => Math.hypot(l[0] - u[0], l[1] - u[1], l[2] - u[2])));
    if (d > bestD) [best, bestD] = [c, d];
  }
  return best;
}

const ok = (msg = '', extra = {}) => ({ ok: true, msg, ...extra });
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const fail = (msg) => ({ ok: false, msg });
export const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : `${Math.round(n)}`);

function buildNeighbors(W, H) {
  const N = W * H;
  const nbr = new Int32Array(N * 4).fill(-1);
  for (let i = 0; i < N; i++) {
    const x = i % W;
    if (x > 0) nbr[i * 4] = i - 1;
    if (x < W - 1) nbr[i * 4 + 1] = i + 1;
    if (i >= W) nbr[i * 4 + 2] = i - W;
    if (i < N - W) nbr[i * 4 + 3] = i + W;
  }
  return nbr;
}

export class Game {
  constructor({ seed = 1, bots = 7, difficulty = 'normal', map = null, size = 'small', human = true, humanName = '나' } = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    const dims = C.MAP_SIZES[size] || C.MAP_SIZES.small;
    const m = map ? analyzeMap(map.width, map.height, map.terrain) : generateMap({ seed, width: dims.width, height: dims.height });
    this.W = m.width;
    this.H = m.height;
    this.N = this.W * this.H;
    this.terrain = m.terrain;
    this.landmass = m.landmass;
    this.landmassSize = m.landmassSize;
    this.coastal = m.coastal;
    this.coastTiles = m.coastTiles;
    this.landCount = m.landCount;
    this.nbr = buildNeighbors(this.W, this.H);
    this.peaceTicks = dims.peace; // 평화 기간 · 핵 · 오버타임은 지도 크기에 따라
    this.nukeUnlockTick = dims.peace + C.NUKE_UNLOCK_AFTER;
    this.overtimeTick = dims.overtime;

    this.owner = new Int16Array(this.N); // 0 = 무주지
    this.fallout = new Int32Array(this.N); // 이 틱까지 방사능
    this.falloutZones = [];
    this.alliances = new Map(); // "a-b" → { until } 동맹
    this.hostile = new Map(); // "a-b" → 마지막으로 서로 싸운 틱
    this.allyRetry = new Map(); // "요청-대상" → 이 틱까지 다시 제안 못 함
    this.stats = { history: [], peak: 0, captured: 0, lost: 0, mates: 0, endTick: 0, bestRank: 0 }; // 사람의 기록 (결과 화면, bestRank 0 = 아직 없음)
    this.dirty = []; // 화면을 다시 칠할 칸

    this.players = [null]; // 번호 = 배열 위치
    this.attacks = [];
    this.boats = [];
    this.nukes = [];
    this.events = [];
    this.tick = 0;
    this.nextId = 1;
    this.difficulty = difficulty;
    this.phase = human ? 'spawn' : 'play';
    this.result = null;
    this.winner = 0;

    this.humanId = human ? this.addPlayer({ name: humanName, isHuman: true }) : 0;
    for (let i = 0; i < bots; i++) {
      const id = this.addPlayer({ name: BOT_NAMES[i % BOT_NAMES.length] });
      const t = this.pickSpawnTile();
      if (t >= 0) this.spawn(id, t);
    }
  }

  // ───────────── 기본 도구 ─────────────

  isLand(t) {
    return t >= 0 && t < this.N && this.terrain[t] !== C.WATER;
  }

  dist2(a, b) {
    const dx = (a % this.W) - (b % this.W);
    const dy = ((a / this.W) | 0) - ((b / this.W) | 0);
    return dx * dx + dy * dy;
  }

  dist(a, b) {
    return Math.sqrt(this.dist2(a, b));
  }

  density(p) {
    return p.troops / Math.max(1, p.tiles);
  }

  touches(t, pid) {
    for (let k = 0; k < 4; k++) {
      const n = this.nbr[t * 4 + k];
      if (n >= 0 && this.owner[n] === pid) return true;
    }
    return false;
  }

  ownedNeighbors(t, pid) {
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const n = this.nbr[t * 4 + k];
      if (n >= 0 && this.owner[n] === pid) c++;
    }
    return c;
  }

  takeDirty() {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }
  // tag: 화면 연출용 사건 종류 (check · castle · promotion · enpassant · checkmate · capture · alliance · betray · nuke)
  // tag: 화면 연출용 체스 사건 종류 (check · castle · promotion · enpassant · checkmate · capture)
  // data.tile: 사건이 일어난 칸 (알림을 누르면 그리로 간다)
  log(text, kind = 'info', involved = [], tag = null, data = null) {
    this.events.push({ id: this.nextId++, tick: this.tick, text, kind, involved: involved.filter(Boolean), tag, data });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  get human() {
    return this.players[this.humanId] || null;
  }

  // ───────────── 나라 · 시작 ─────────────

  addPlayer({ name, isHuman = false, color }) {
    const id = this.players.length;
    this.players.push({
      id,
      name,
      isHuman,
      color: color || (isHuman ? HUMAN_COLOR : pickBotColor(this.players.filter(Boolean).map((p) => p.color))),
      alive: true,
      spawned: false,
      troops: C.START_TROOPS,
      gold: C.START_GOLD,
      tiles: 0,
      sumX: 0,
      sumY: 0,
      labelX: 0, // 이름을 놓을 영토 안 가장 큰 직사각형의 가운데 · 크기 (칸, placeNames 가 채운다)
      labelY: 0,
      labelW: 0,
      labelH: 0,
      king: -1,
      castled: false,
      check: 0, // 궁성에 들어온 적 (체크), 없으면 0
      checkSince: 0, // 체크가 시작된 틱
      traitorUntil: 0, // 동맹을 깨면 이 틱까지 배신자
      allianceOffers: [], // 봇이 사람에게 보낸 동맹 제안 { from, until }
      generals: [],
      killedBy: 0,
      deathCause: null,
      bot: isHuman ? { nextThink: 0 } : this.botPersonality(id),
    });
    return id;
  }

  // 봇 성격: 생각 시작 시점과 공격 기준을 봇마다 한 번 뽑는다 (판 진행 난수는 건드리지 않는다)
  botPersonality(id) {
    const r = mulberry32(this.seed * 7919 + id * 104729);
    const d = this.botLevel();
    return {
      nextThink: Math.floor(r() * d.interval),
      trigger: 0.5 + r() * 0.1, // 병력이 상한의 이만큼 차야 나라를 친다
      reserve: 0.3 + r() * 0.1, // 나라를 칠 때 남겨 두는 병력
      expand: 0.1 + r() * 0.1, // 무주지를 넓힐 때 남겨 두는 병력
    };
  }

  botLevel() {
    return DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
  }

  // 병력 상한: 봇은 난이도에 따라 줄어든다 (어려움 = 사람과 같은 기준)
  maxTroopsOf(p) {
    return C.maxTroops(p.tiles) * (p.isHuman ? 1 : this.botLevel().troopCap);
  }

  pickSpawnTile() {
    const kings = this.players.filter((p) => p && p.spawned).map((p) => p.king);
    // 지도가 클수록 서로 멀리 떨어뜨린다 (작은 지도 200칸 너비에서 30칸)
    for (let minD = Math.round((30 * this.W) / 200); minD >= 6; minD -= 4) {
      for (let tries = 0; tries < 500; tries++) {
        const t = Math.floor(this.rng() * this.N);
        if (!this.isLand(t) || this.owner[t]) continue;
        if (this.landmassSize[this.landmass[t]] < 150 && tries < 400) continue;
        if (kings.every((k) => this.dist2(k, t) >= minD * minD)) return t;
      }
    }
    return -1;
  }

  spawn(pid, tile) {
    const p = this.players[pid];
    if (!this.isLand(tile) || this.owner[tile]) return false;
    const r = C.SPAWN_RADIUS;
    const x0 = tile % this.W;
    const y0 = (tile / this.W) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || dx * dx + dy * dy > r * r) continue;
        const t = y * this.W + x;
        if (this.isLand(t) && !this.owner[t]) this.setOwner(t, pid);
      }
    }
    p.king = tile;
    p.spawned = true;
    if (!p.isHuman) p.troops = C.START_TROOPS * this.botLevel().startTroops;
    for (const f of FORMATION) {
      const g = {
        id: `${pid}:${f.type === 'pawn' ? 'p' : ''}${f.file}`,
        owner: pid,
        type: f.type,
        file: f.file,
        promoted: false,
        status: 'idle', // 기물은 지도에 서지 않고 성(킹) 안에서 대기한다: idle · busy(출격 중) · captured
      };
      p.generals.push(g);
    }
    this.placeNames([pid]);
    return true;
  }

  // 나라 이름 자리: 영토(+ 맞닿은 얕은 물 · 낙진 칸) 안에 들어가는 가장 큰 직사각형.
  // 무게중심을 쓰면 C자 영토나 섬나라의 이름이 바다나 남의 땅 위에 뜬다.
  placeNames(ids = null) {
    const { W, N, owner, terrain, nbr, fallout } = this;
    const list = (ids || this.players.map((p) => p?.id)).filter((id) => id && this.players[id].alive && this.players[id].tiles);
    if (!list.length) return;
    const box = new Map(list.map((id) => [id, [W, this.H, -1, -1]])); // minX, minY, maxX, maxY
    for (let t = 0; t < N; t++) {
      const b = box.get(owner[t]);
      if (!b) continue;
      const x = t % W;
      const y = (t / W) | 0;
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
    // 이 칸을 이름 상자에 넣어도 되나
    const fits = (t, pid) => {
      if (owner[t] === pid || fallout[t] > this.tick) return true;
      if (terrain[t] !== C.WATER) return false;
      for (let k = 0; k < 4; k++) if (nbr[t * 4 + k] >= 0 && owner[nbr[t * 4 + k]] === pid) return true;
      return false;
    };
    for (const pid of list) {
      const p = this.players[pid];
      const [x0, y0, x1, y1] = box.get(pid);
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      // 큰 나라는 1/2/4/8 로 줄인 격자에서 찾는다 (격자 한 변 64칸 이하)
      const s = [1, 2, 4, 8].find((k) => Math.max(bw, bh) / k <= 64) || 8;
      const gw = Math.ceil(bw / s);
      const gh = Math.ceil(bh / s);
      const hist = new Int32Array(gw);
      let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
      for (let gy = 0; gy < gh; gy++) {
        const y = Math.min(y1, y0 + gy * s + (s >> 1));
        for (let gx = 0; gx < gw; gx++) {
          const x = Math.min(x1, x0 + gx * s + (s >> 1));
          hist[gx] = fits(y * W + x, pid) ? hist[gx] + 1 : 0;
        }
        // 히스토그램 + 스택으로 이 줄에서 끝나는 가장 큰 직사각형
        const stack = [];
        for (let i = 0; i <= gw; i++) {
          const hgt = i < gw ? hist[i] : 0;
          while (stack.length && hist[stack[stack.length - 1]] >= hgt) {
            const top = stack.pop();
            const left = stack.length ? stack[stack.length - 1] + 1 : 0;
            const area = hist[top] * (i - left);
            if (area > best.area) best = { area, x: left, y: gy - hist[top] + 1, w: i - left, h: hist[top] };
          }
          stack.push(i);
        }
      }
      if (best.area) {
        p.labelW = best.w * s;
        p.labelH = best.h * s;
        p.labelX = x0 + best.x * s + p.labelW / 2 - 0.5;
        p.labelY = y0 + best.y * s + p.labelH / 2 - 0.5;
      } else {
        p.labelW = p.labelH = 1;
        p.labelX = p.sumX / p.tiles;
        p.labelY = p.sumY / p.tiles;
      }
    }
  }

  spawnHuman(tile) {
    if (this.phase !== 'spawn') return fail('이미 시작했습니다');
    if (!this.isLand(tile)) return fail('육지를 골라 주세요');
    if (this.owner[tile]) return fail('이미 다른 나라의 땅입니다');
    if (this.landmassSize[this.landmass[tile]] < 40) return fail('너무 작은 섬입니다');
    const near = C.SPAWN_MIN_KING_DIST ** 2;
    if (this.players.some((q) => q && q.alive && q.spawned && q.id !== this.humanId && this.dist2(q.king, tile) < near)) {
      return fail('다른 나라와 너무 가깝습니다 — 조금 떨어진 곳을 골라 주세요');
    }
    this.spawn(this.humanId, tile);
    this.phase = 'play';
    this.log('게임 시작! 킹을 지키면서 영토를 넓히세요.', 'info', [this.humanId]);
    return ok('시작!');
  }

  // ───────────── 땅 주인 바꾸기 ─────────────

  setOwner(t, pid) {
    const old = this.owner[t];
    if (old === pid) return;
    const x = t % this.W;
    const y = (t / this.W) | 0;
    if (old) {
      const o = this.players[old];
      o.tiles--;
      o.sumX -= x;
      o.sumY -= y;
    }
    if (pid) {
      const n = this.players[pid];
      n.tiles++;
      n.sumX += x;
      n.sumY += y;
    }
    this.owner[t] = pid;
    this.dirty.push(t);
    if (old && this.players[old].alive && this.players[old].king === t) {
      this.eliminate(old, pid, pid ? 'conquest' : 'nuke');
    }
  }

  eliminate(vid, killerId, cause) {
    const v = this.players[vid];
    if (!v.alive) return;
    v.alive = false;
    v.killedBy = killerId;
    v.deathCause = cause;
    const k = killerId ? this.players[killerId] : null;
    // 사람의 체크메이트 기록: 자폭 · 동맹국 피폭은 세지 않는다
    if (this.humanId && killerId === this.humanId && vid !== killerId && !this.allied(vid, killerId)) this.stats.mates++;
    for (const key of [...this.alliances.keys()]) if (key.split('-').map(Number).includes(vid)) this.alliances.delete(key);
    if (cause === 'nuke') {
      this.log(`☢ ${v.name}의 킹이 피폭되었습니다 — ${josa(v.name, '이/가')} 무너졌습니다`, 'big', [vid, killerId], 'checkmate', { nuke: true, tile: v.king });
    } else {
      this.log(`♚ 체크메이트! ${josa(k.name, '이/가')} ${v.name}의 킹을 잡았습니다`, 'big', [vid, killerId], 'checkmate', { tile: v.king });
    }
    for (const g of v.generals) g.status = 'captured';
    for (const a of this.attacks) if (a.attacker === vid) a.done = true;
    for (const b of this.boats) if (b.owner === vid) b.done = true;
    for (const n of this.nukes) if (n.owner === vid) n.done = true;
    // 왕을 잡은 나라는 킹 주변 영토와 금고 절반을 차지하고, 나머지 땅은 무주지가 된다. 피폭이면 전부 무주지.
    const heir = cause === 'conquest' && k && k.alive ? killerId : 0;
    if (heir) k.gold += v.gold * C.HEIR_GOLD_SHARE;
    v.troops = 0;
    v.gold = 0;
    v.check = 0;
    const r2 = C.HEIR_LAND_RADIUS * C.HEIR_LAND_RADIUS;
    for (let t = 0; t < this.N; t++) {
      if (this.owner[t] === vid) this.setOwner(t, heir && this.dist2(t, v.king) <= r2 ? heir : 0);
    }
  }

  // ───────────── 기물 ─────────────

  // 성(킹) 안의 대기 중인 기물 하나 (출격 · 앙파상에 쓴다)
  readyPiece(pid, type) {
    return this.players[pid].generals.find((g) => g.type === type && g.status === 'idle') || null;
  }

  findGeneral(pid, gid) {
    const p = this.players[pid];
    return p ? p.generals.find((g) => g.id === gid) || null : null;
  }

  captureGeneral(g, captorPlayer, captorGeneral, tile = -1) {
    if (g.status === 'captured') return;
    g.status = 'captured';
    const owner = this.players[g.owner];
    const cp = captorPlayer ? this.players[captorPlayer] : null;
    const who = cp ? cp.name : '핵폭발';
    if (this.humanId && captorPlayer === this.humanId) this.stats.captured++;
    if (this.humanId && g.owner === this.humanId) this.stats.lost++;
    this.log(
      `${PIECES[g.type].glyph} ${owner.name}의 ${josa(pieceLabel(g), '이/가')} ${who}에게 잡혔습니다`,
      'chess',
      [g.owner, captorPlayer],
      'capture',
      { type: g.type, tile }
    );
    if (captorGeneral) this.promote(captorGeneral, g.type, tile);
  }

  // 폰이 다른 기물을 이기면 그 기물로 바로 바뀐다 (한 번만)
  promote(g, type, tile = -1) {
    if (g.type !== 'pawn' || g.promoted || g.status === 'captured') return;
    if (type === 'pawn' || type === 'king' || !PIECES[type]) return;
    g.type = type;
    g.promoted = true;
    const p = this.players[g.owner];
    this.log(`${PIECES[type].glyph} 프로모션! ${p.name}의 폰(${g.file})이 ${josa(PIECES[type].name, '이/가')} 되었습니다`, 'chess', [p.id], 'promotion', { type, tile });
  }

  // 성에 룩 · 퀸이 대기 중이면 킹 주변이 요새
  inFortress(pid, t) {
    const p = this.players[pid];
    if (this.dist2(p.king, t) > C.FORTRESS_RADIUS * C.FORTRESS_RADIUS) return false;
    return p.generals.some((g) => g.status === 'idle' && PIECES[g.type].fortress);
  }

  inPalace(pid, t) {
    const p = this.players[pid];
    return !!p && p.alive && p.king >= 0 && this.dist2(p.king, t) <= C.PALACE_RADIUS * C.PALACE_RADIUS;
  }

  // 궁성 안에 적 땅이 있으면 그 나라 번호 (체크), 없으면 0. 동맹국 땅과 평화 기간은 체크가 아니다
  checkBy(pid) {
    const p = this.players[pid];
    if (!p || !p.alive || p.king < 0 || this.peaceLeft()) return 0;
    const r = C.PALACE_RADIUS;
    const kx = p.king % this.W;
    const ky = (p.king / this.W) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = kx + dx;
        const y = ky + dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || dx * dx + dy * dy > r * r) continue;
        const o = this.owner[y * this.W + x];
        if (o && o !== pid && this.players[o].alive && !this.allied(pid, o)) return o;
      }
    }
    return 0;
  }

  // 체크가 충분히 이어지기 전에는 킹 칸을 빼앗을 수 없다
  kingGuarded(pid, t) {
    const p = this.players[pid];
    if (!pid || p.king !== t) return false;
    return !p.check || this.tick - p.checkSince < C.CHECKMATE_TICKS;
  }

  peaceLeft() {
    return Math.max(0, this.peaceTicks - this.tick);
  }

  peaceFail() {
    return fail(`평화 기간: ${Math.ceil(this.peaceLeft() / 10)}초 뒤부터 다른 나라를 공격할 수 있습니다`);
  }

  // ───────────── 외교 ─────────────

  pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  // 내 땅과 맞닿은 나라들 (무주지 제외)
  neighborsOf(pid) {
    const out = new Set();
    const { owner, nbr, N } = this;
    for (let t = 0; t < N; t++) {
      if (owner[t] !== pid) continue;
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0 && owner[n] && owner[n] !== pid) out.add(owner[n]);
      }
    }
    return out;
  }

  allied(a, b) {
    return a !== b && this.alliances.has(this.pairKey(a, b));
  }

  allyFail(target) {
    return fail(`${josa(this.players[target].name, '은/는')} 동맹국입니다 — 먼저 동맹을 깨세요`);
  }

  markHostile(a, b) {
    if (a && b && a !== b) this.hostile.set(this.pairKey(a, b), this.tick);
  }

  recentlyHostile(a, b) {
    const t = this.hostile.get(this.pairKey(a, b));
    return t !== undefined && this.tick - t < C.HOSTILE_MEMORY;
  }

  isTraitor(pid) {
    return this.tick < this.players[pid].traitorUntil;
  }

  // 땅 1위가 2위의 mult배 이상이면 그 나라 (폭주 선두), 아니면 0
  runawayLeader(mult) {
    if (!mult) return 0;
    const [first, second] = this.players.filter((p) => p && p.alive && p.spawned).sort((a, b) => b.tiles - a.tiles);
    if (!first || !second) return 0;
    return first.tiles >= second.tiles * mult ? first.id : 0;
  }

  // 동맹 수 (빼고 셀 나라 하나)
  allyCount(pid, except = 0) {
    let n = 0;
    for (const p of this.players) if (p && p.id !== except && this.allied(pid, p.id)) n++;
    return n;
  }

  // 봇이 동맹을 받아들일지: 최근에 싸우지 않았고, 상대가 배신자가 아니고, 너무 작거나 너무 강한 나라가 아니면
  allianceRefusal(from, to) {
    const a = this.players[from];
    const b = this.players[to];
    const d = this.botLevel();
    if (this.recentlyHostile(from, to)) return `${josa(b.name, '이/가')} 최근에 싸운 상대라 거절했습니다`;
    if (this.isTraitor(from)) return `배신자와는 동맹하지 않는다며 ${josa(b.name, '이/가')} 거절했습니다`;
    if (b.tiles > a.tiles * C.ALLY_SIZE_LIMIT) return `${josa(b.name, '이/가')} 우리가 너무 작다며 거절했습니다`;
    if (d.runaway && this.runawayLeader(d.runaway) === from) return `${josa(b.name, '이/가')} 너무 강한 나라라며 거절했습니다`;
    if (d.maxAllies && this.allyCount(from, to) >= d.maxAllies) return `${josa(b.name, '이/가')} 이미 동맹이 많다며 거절했습니다`;
    return '';
  }

  formAlliance(a, b) {
    this.alliances.set(this.pairKey(a, b), { until: this.tick + C.ALLIANCE_TICKS });
    // 서로를 향한 공격은 멈춘다
    for (const x of this.attacks) if (!x.done && ((x.attacker === a && x.target === b) || (x.attacker === b && x.target === a))) this.endAttack(x);
    // 서로를 노리고 날아가던 핵은 바다에 떨어뜨린다
    let dud = 0;
    for (const n of this.nukes) {
      if (n.done) continue;
      const other = n.owner === a ? b : n.owner === b ? a : 0;
      if (other && this.nukeHits(n.to, n.kind, other)) {
        n.done = true;
        dud++;
      }
    }
    if (dud) this.log('☢ 동맹으로 핵이 취소됐습니다', 'chess', [a, b]);
    this.log(`🤝 ${josa(this.players[a].name, '과/와')} ${josa(this.players[b].name, '이/가')} 동맹을 맺었습니다`, 'chess', [a, b], 'alliance');
  }

  requestAlliance(pid, target) {
    const p = this.players[pid];
    const t = this.players[target];
    if (this.phase !== 'play' || !p?.alive || !t?.alive || pid === target) return fail('지금은 동맹을 맺을 수 없습니다');
    if (this.allied(pid, target)) return this.renewAlliance(pid, target);
    if (!this.neighborsOf(pid).has(target)) return fail('국경을 맞댄 나라와만 동맹할 수 있습니다');
    const retry = this.allyRetry.get(`${pid}-${target}`) || 0;
    if (this.tick < retry) return fail(`${Math.ceil((retry - this.tick) / 10)}초 뒤에 다시 제안할 수 있습니다`);
    const why = t.isHuman ? '' : this.allianceRefusal(pid, target);
    if (why) {
      this.allyRetry.set(`${pid}-${target}`, this.tick + C.ALLIANCE_RETRY);
      return fail(why);
    }
    this.formAlliance(pid, target);
    return ok(`${josa(t.name, '과/와')} 동맹 (${C.ALLIANCE_TICKS / 600}분)`);
  }

  allianceLeft(a, b) {
    const al = this.alliances.get(this.pairKey(a, b));
    return al ? Math.max(0, al.until - this.tick) : 0;
  }

  renewAlliance(pid, target) {
    const al = this.alliances.get(this.pairKey(pid, target));
    if (!al) return fail('동맹이 아닙니다');
    if (al.until - this.tick > C.ALLIANCE_RENEW_TICKS) return fail(`만료 ${C.ALLIANCE_RENEW_TICKS / 10}초 전부터 연장할 수 있습니다`);
    const why = this.players[target].isHuman ? '' : this.allianceRefusal(pid, target); // 봇은 연장도 다시 따져 본다
    if (why) return fail(why);
    al.until = this.tick + C.ALLIANCE_TICKS;
    return ok(`${josa(this.players[target].name, '과/와')} 동맹 연장`);
  }

  breakAlliance(pid, target) {
    if (!this.allied(pid, target)) return fail('동맹이 아닙니다');
    this.alliances.delete(this.pairKey(pid, target));
    this.markHostile(pid, target);
    const p = this.players[pid];
    const t = this.players[target];
    // 배신자를 배신하는 것은 벌칙이 없다
    if (this.isTraitor(target)) {
      this.log(`🤝 ${josa(p.name, '이/가')} 배신자 ${josa(t.name, '과/와')}의 동맹을 끊었습니다`, 'chess', [pid, target]);
      return ok('배신자와의 동맹을 끊었습니다 — 벌칙 없음');
    }
    p.traitorUntil = this.tick + C.TRAITOR_TICKS;
    // 배신 소문은 이웃에게 퍼진다: 맞닿은 봇들은 배신자 기간이 끝난 뒤에도 한동안 동맹을 받지 않는다
    for (const o of this.neighborsOf(pid)) if (!this.players[o].isHuman) this.hostile.set(this.pairKey(o, pid), this.tick + C.TRAITOR_TICKS);
    this.log(`⚠ 배신! ${josa(p.name, '이/가')} ${josa(t.name, '과/와')}의 동맹을 깼습니다`, 'big', [pid, target], 'betray');
    return ok(`동맹을 깼습니다 — ${C.TRAITOR_TICKS / 10}초 동안 방어 절반, 모두의 표적`);
  }

  // 봇이 사람에게 동맹을 제안한다 (사람이 수락 · 거절)
  offerAlliance(from, to) {
    const t = this.players[to];
    if (!t.isHuman || this.allied(from, to) || t.allianceOffers.some((o) => o.from === from)) return;
    t.allianceOffers.push({ from, until: this.tick + C.ALLIANCE_OFFER_TICKS });
    this.log(`🤝 ${josa(this.players[from].name, '이/가')} 동맹을 제안했습니다`, 'chess', [to, from]);
  }

  resolveAllianceOffer(pid, from, accept) {
    const p = this.players[pid];
    const offer = p.allianceOffers.find((o) => o.from === from);
    if (!offer) return fail('제안이 사라졌습니다');
    p.allianceOffers = p.allianceOffers.filter((o) => o !== offer);
    if (!accept) {
      this.allyRetry.set(`${from}-${pid}`, this.tick + C.ALLIANCE_RETRY * 4);
      return ok('동맹 제안을 거절했습니다');
    }
    if (!this.players[from].alive) return fail('그 나라는 이미 무너졌습니다');
    if (this.recentlyHostile(pid, from)) return fail(`${josa(this.players[from].name, '은/는')} 최근에 싸운 상대라 동맹할 수 없습니다`);
    this.formAlliance(pid, from);
    return ok(`${josa(this.players[from].name, '과/와')} 동맹 (${C.ALLIANCE_TICKS / 600}분)`);
  }

  stepDiplomacy() {
    for (const [key, al] of this.alliances) {
      if (this.tick < al.until) continue;
      this.alliances.delete(key);
      const [a, b] = key.split('-').map(Number);
      this.log(`🤝 ${josa(this.players[a].name, '과/와')} ${this.players[b].name}의 동맹이 끝났습니다`, 'chess', [a, b]);
    }
    const h = this.human;
    if (h) h.allianceOffers = h.allianceOffers.filter((o) => o.until > this.tick && this.players[o.from].alive && !this.allied(h.id, o.from));
  }

  // 기물 비용 · 병력 떼어내기
  commitForces(p, ratio, general) {
    const spec = general ? PIECES[general.type] : null;
    if (spec && p.gold < spec.cost) return fail(`${spec.name} 출격에는 금 ${fmt(spec.cost)}이 필요합니다`);
    const troops = Math.floor(p.troops * Math.min(1, Math.max(0, ratio)));
    if (troops < 1) return fail('보낼 병력이 없습니다');
    p.troops -= troops;
    if (spec) {
      p.gold -= spec.cost;
      general.status = 'busy';
      if (p.isHuman) this.usedPiece = true; // 첫 판 안내용
    }
    return { ok: true, troops };
  }

  // ───────────── 지상 공격 ─────────────

  hasLandOn(pid, mass) {
    for (let t = 0; t < this.N; t++) if (this.owner[t] === pid && this.landmass[t] === mass) return true;
    return false;
  }

  borderWith(pid, target) {
    const s = new Set();
    for (let t = 0; t < this.N; t++) {
      if (this.owner[t] !== target || this.terrain[t] === C.WATER) continue;
      if (this.touches(t, pid)) s.add(t);
    }
    return s;
  }

  newAttack({ attacker, target, troops, general, kind, origin, aim = -1, frontier, landing = false }) {
    const spec = general ? PIECES[general.type] : null;
    return {
      id: this.nextId++,
      attacker,
      target,
      troops,
      general,
      kind,
      origin,
      aim,
      frontier,
      power: (landing ? spec?.seaPower : spec?.landPower) || 1,
      speed: (landing ? 1 : spec?.landSpeed) || 1,
      breakthrough: !landing && !!spec?.breakthrough,
      surpriseLeft: landing ? spec?.surprise || 0 : 0,
      lastTile: -1,
      conquered: [],
      conqTick: [],
      troops0: troops, // 출격 때 병력 (큰 부대일수록 적 땅을 싸게 점령)
      done: false,
    };
  }

  // 플레이어가 땅을 클릭했을 때: 맞닿아 있으면 지상 공격, 아니면 배
  launchAttack(pid, tile, { ratio = 0.3, generalId = null, forceBoat = false } = {}) {
    const p = this.players[pid];
    if (this.phase !== 'play' || !p || !p.alive) return fail('지금은 공격할 수 없습니다');
    if (!this.isLand(tile)) return fail('육지를 골라 주세요');
    const target = this.owner[tile];
    if (target === pid) return fail('이미 내 땅입니다');
    if (target && this.peaceLeft()) return this.peaceFail();
    if (target && this.allied(pid, target)) return this.allyFail(target);
    let general = null;
    if (generalId) {
      general = this.findGeneral(pid, generalId);
      if (!general || general.status !== 'idle') return fail(`${general ? josa(pieceLabel(general), '은/는') : '그 기물은'} 지금 출격할 수 없습니다`);
    }
    const spec = general ? PIECES[general.type] : null;
    // 클릭한 곳이 내 땅이 없는 다른 섬 · 대륙이면 배로 간다
    const overland = !forceBoat && (!spec || spec.land) && this.hasLandOn(pid, this.landmass[tile]);
    const frontier = overland ? this.borderWith(pid, target) : null;
    if (!frontier || !frontier.size) return this.launchBoat(p, tile, ratio, general);

    const c = this.commitForces(p, ratio, general);
    if (!c.ok) return c;
    this.markHostile(pid, target);
    const knight = !!spec?.breakthrough;
    const a = this.newAttack({
      attacker: pid,
      target,
      troops: c.troops,
      general,
      kind: knight ? 'knight' : spec?.diagonal ? 'diagonal' : 'land',
      origin: tile,
      aim: knight ? tile : -1,
      frontier,
    });
    if (a.kind === 'diagonal') a.diag = this.diagonalLine(p, tile, frontier);
    const tName = target ? this.players[target].name : '무주지';
    if (general) this.log(`${spec.glyph} ${p.name}의 ${josa(pieceLabel(general), '이/가')} ${josa(tName, '으로/로')} 출격 (병력 ${fmt(c.troops)})`, 'chess', [pid, target], null, { tile });

    this.resolveClash(a);
    if (a.done) return ok('맞공격에 부딪혔습니다');
    if (!general) {
      const same = this.attacks.find((x) => !x.done && x.attacker === pid && x.target === target && !x.general && x.kind === 'land');
      if (same) {
        same.troops += a.troops;
        same.troops0 += a.troops;
        for (const t of frontier) same.frontier.add(t);
        return ok(`${tName} 공격에 병력 ${fmt(a.troops)} 추가`);
      }
    }
    this.attacks.push(a);
    return ok(`${tName} 공격 (병력 ${fmt(a.troops)})`);
  }

  // 서로 공격 중인 두 부대가 맞부딪히면 힘(병력 × 기물 배율)이 큰 쪽만 남는다
  resolveClash(a) {
    if (!a.target) return;
    const opp = this.attacks
      .filter((b) => !b.done && b.attacker === a.target && b.target === a.attacker)
      .sort((x, y) => y.troops * y.power - x.troops * x.power);
    for (const b of opp) {
      const pa = a.troops * a.power;
      const pb = b.troops * b.power;
      if (pa >= pb) {
        a.troops = (pa - pb) / a.power;
        this.destroyAttack(b, a);
        if (a.troops < 1) {
          this.endAttack(a);
          return;
        }
      } else {
        b.troops = (pb - pa) / b.power;
        this.destroyAttack(a, b);
        return;
      }
    }
  }

  destroyAttack(loser, winner) {
    loser.done = true;
    loser.troops = 0;
    const L = this.players[loser.attacker];
    const Wn = this.players[winner.attacker];
    const tag = (a) => (a.general ? `${PIECES[a.general.type].glyph} ${pieceLabel(a.general)} 부대` : '부대');
    const at = loser.lastTile >= 0 ? loser.lastTile : winner.lastTile; // 부딪힌 곳
    this.log(`⚔ 맞공격: ${Wn.name}의 ${josa(tag(winner), '이/가')} ${L.name}의 ${josa(tag(loser), '을/를')} 격파했습니다`, 'chess', [loser.attacker, winner.attacker], null, { tile: at });
    if (loser.general) this.captureGeneral(loser.general, winner.attacker, winner.general, at);
  }

  // 비숍의 대각선: 클릭한 곳에서 가장 가까운 전선 칸에서 출발해, 클릭한 곳 쪽으로 45° 로 뻗는 직선
  diagonalLine(p, tile, frontier) {
    const tx = tile % this.W;
    const ty = (tile / this.W) | 0;
    let start = tile;
    let best = Infinity;
    for (const t of frontier) {
      const d2 = this.dist2(t, tile);
      if (d2 < best) {
        best = d2;
        start = t;
      }
    }
    const sx = start % this.W;
    const sy = (start / this.W) | 0;
    // 출발점과 클릭한 곳이 같은 줄이면 내 영토 중심에서 멀어지는 쪽으로
    const dx = tx !== sx ? Math.sign(tx - sx) : sx >= p.sumX / Math.max(1, p.tiles) ? 1 : -1;
    const dy = ty !== sy ? Math.sign(ty - sy) : sy >= p.sumY / Math.max(1, p.tiles) ? 1 : -1;
    return { sx, sy, dx, dy };
  }

  // 대각선 띠(직선에서 width 이내) 위의 칸이면 진행 거리를, 아니면 -1
  diagonalProgress(line, t, width = C.BISHOP_WIDTH) {
    const x = (t % this.W) - line.sx;
    const y = ((t / this.W) | 0) - line.sy;
    if (Math.abs(x * line.dy - y * line.dx) > width) return -1;
    const along = x * line.dx + y * line.dy;
    return along >= -1 ? along : -1;
  }

  tileCost(a, t) {
    const terr = a.breakthrough ? 1 : C.TERRAIN_COST[this.terrain[t]];
    let cost;
    if (!a.target || a.surpriseLeft > 0) {
      cost = C.NEUTRAL_TILE_COST * terr;
    } else {
      const d = this.players[a.target];
      cost = (C.NEUTRAL_TILE_COST + this.density(d) * C.DEFENSE_FACTOR) * terr;
      if (!a.breakthrough && this.inFortress(a.target, t)) cost *= C.FORTRESS_MULT;
      cost *= clamp(d.troops / (a.troops0 * C.ODDS_REF), C.ODDS_CLAMP); // 큰 부대일수록 싸게
      if (this.isTraitor(a.target)) cost *= C.TRAITOR_DEFENSE; // 배신자는 방어가 절반
    }
    if (a.target && this.inPalace(a.target, t)) cost *= C.PALACE_MULT;
    if (this.fallout[t] > this.tick) cost *= C.FALLOUT_COST_MULT; // 낙진 칸은 비싸다
    return cost / a.power;
  }

  // 한 칸을 값을 치르고 점령. 병력이 모자라면 false
  capture(a, t) {
    const cost = this.tileCost(a, t);
    if (a.troops < cost) return false;
    a.troops -= cost;
    if (a.target) {
      const d = this.players[a.target];
      d.troops = Math.max(0, d.troops - this.density(d) * C.DEFENDER_LOSS);
      if (a.surpriseLeft > 0) a.surpriseLeft--;
    }
    a.lastTile = t;
    a.conquered.push(t);
    a.conqTick.push(this.tick);
    this.setOwner(t, a.attacker, a.general);
    if (a.done) return true;
    for (let k = 0; k < 4; k++) {
      const n = this.nbr[t * 4 + k];
      if (n >= 0 && this.owner[n] === a.target && this.terrain[n] !== C.WATER) a.frontier.add(n);
    }
    return true;
  }

  stepAttack(a) {
    const att = this.players[a.attacker];
    if (!att.alive) {
      a.done = true;
      return;
    }
    if (a.target && !this.players[a.target].alive) return this.endAttack(a);
    if (a.kind === 'knight' && this.owner[a.aim] === a.attacker) return this.endAttack(a);

    const cands = [];
    for (const t of a.frontier) {
      if (this.owner[t] !== a.target || !this.touches(t, a.attacker)) a.frontier.delete(t);
      else cands.push(t);
    }
    if (!cands.length) return this.endAttack(a);

    let n;
    if (a.kind === 'diagonal') {
      // 띠 위의 칸만, 출발점에 가까운 칸부터 → 좁고 길게 뻗는다. 띠가 막히면 띠 근처 전선으로 돌아 계속 간다
      const scored = [];
      for (const width of [C.BISHOP_WIDTH, C.BISHOP_WIDTH * 4]) {
        for (const t of cands) {
          const along = this.diagonalProgress(a.diag, t, width);
          if (along >= 0) scored.push([t, along + this.rng()]);
        }
        if (scored.length) break;
      }
      if (!scored.length) return this.endAttack(a);
      scored.sort((x, y) => x[1] - y[1]);
      cands.length = 0;
      for (const [t] of scored) cands.push(t);
      n = Math.max(1, Math.round(C.BISHOP_RATE * a.speed));
    } else if (a.kind === 'knight') {
      n = Math.max(1, Math.round(C.KNIGHT_WIDTH * a.speed));
      const scored = cands.map((t) => [t, this.dist2(t, a.aim) + this.rng()]);
      scored.sort((x, y) => x[1] - y[1]);
      for (let i = 0; i < cands.length; i++) cands[i] = scored[i][0];
    } else {
      const push = a.target ? 1 : clamp(a.troops / C.NEUTRAL_SPEED_REF, C.SPEED_CLAMP); // 무주지는 많이 보낼수록 빨리 번진다
      n = Math.min(C.MAX_TILES_PER_TICK, Math.max(1, Math.ceil(cands.length * C.ATTACK_SPREAD * a.speed * push)));
      if (n < cands.length) {
        // 이웃이 많이 내 땅인 칸, 그리고 내 영토 중심(상륙이면 해안 거점)에 가까운 칸부터 → 전선이 둥글게 번진다
        const landing = a.kind === 'landing';
        const cx = landing ? a.origin % this.W : att.sumX / Math.max(1, att.tiles);
        const cy = landing ? (a.origin / this.W) | 0 : att.sumY / Math.max(1, att.tiles);
        const score = (t) => {
          const dx = (t % this.W) - cx;
          const dy = ((t / this.W) | 0) - cy;
          return this.ownedNeighbors(t, a.attacker) * 0.8 + this.rng() * 1.2 - Math.sqrt(dx * dx + dy * dy) * 0.3;
        };
        const scored = cands.map((t) => [t, score(t)]);
        scored.sort((x, y) => y[1] - x[1]);
        for (let i = 0; i < cands.length; i++) cands[i] = scored[i][0];
      }
    }

    for (let i = 0; i < n && i < cands.length; i++) {
      const t = cands[i];
      if (this.owner[t] !== a.target || this.kingGuarded(a.target, t)) continue;
      if (!this.capture(a, t)) return this.endAttack(a);
      if (a.done || !att.alive) return;
      if (a.kind === 'knight' && t === a.aim) return this.endAttack(a);
    }
  }

  endAttack(a) {
    if (a.done) return;
    a.done = true;
    const p = this.players[a.attacker];
    if (!p.alive) return;
    p.troops += a.troops;
    a.troops = 0;
    if (a.general && a.general.status === 'busy') a.general.status = 'idle'; // 성으로 돌아온다
  }

  retreat(pid, attackId) {
    const a = this.attacks.find((x) => x.id === attackId && !x.done && x.attacker === pid);
    if (!a) return fail('그 공격은 이미 끝났습니다');
    if (!a.target) {
      this.endAttack(a); // 무주지 확장은 전원 돌아온다
      return ok('후퇴 — 병력이 모두 돌아왔습니다');
    }
    const lost = a.troops * (1 - C.RETREAT_KEEP);
    a.troops -= lost;
    this.endAttack(a);
    return ok(`후퇴 — 병력 ${fmt(lost)} 손실`);
  }

  // ───────────── 바다 ─────────────

  findLanding(pid, tile) {
    if (!this.isLand(tile)) return -1;
    const seen = new Set([tile]);
    let layer = [tile];
    for (let d = 0; d <= C.LANDING_SEARCH && layer.length; d++) {
      for (const t of layer) if (this.coastal[t] && this.owner[t] !== pid) return t;
      const next = [];
      for (const t of layer) {
        for (let k = 0; k < 4; k++) {
          const n = this.nbr[t * 4 + k];
          if (n >= 0 && !seen.has(n) && this.terrain[n] !== C.WATER) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      layer = next;
    }
    return -1;
  }

  // 상륙 지점 앞바다에서 거꾸로 찾아, 내 해안에서 출발하는 바닷길을 돌려준다
  seaPath(pid, landing) {
    const { N, nbr, terrain, owner } = this;
    const prev = new Int32Array(N).fill(-2);
    const q = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    for (let k = 0; k < 4; k++) {
      const w = nbr[landing * 4 + k];
      if (w >= 0 && terrain[w] === C.WATER && prev[w] === -2) {
        prev[w] = -1;
        q[qt++] = w;
      }
    }
    while (qh < qt) {
      const w = q[qh++];
      for (let k = 0; k < 4; k++) {
        const n = nbr[w * 4 + k];
        if (n >= 0 && terrain[n] !== C.WATER && owner[n] === pid) {
          const path = [];
          for (let c = w; c !== -1; c = prev[c]) path.push(c);
          return path;
        }
      }
      for (let k = 0; k < 4; k++) {
        const n = nbr[w * 4 + k];
        if (n >= 0 && terrain[n] === C.WATER && prev[n] === -2) {
          prev[n] = w;
          q[qt++] = n;
        }
      }
    }
    return null;
  }

  launchBoat(p, tile, ratio, general) {
    const spec = general ? PIECES[general.type] : null;
    if (spec && !spec.sea) return fail(`${josa(spec.name, '은/는')} 바다를 건널 수 없습니다 — 맞닿은 땅만 공격할 수 있어요`);
    if (this.owner[tile] && this.peaceLeft()) return this.peaceFail();
    if (this.boats.filter((b) => !b.done && b.owner === p.id).length >= C.MAX_BOATS) {
      return fail(`배는 동시에 ${C.MAX_BOATS}척까지 띄울 수 있습니다`);
    }
    const landing = this.findLanding(p.id, tile);
    if (landing < 0) return fail('근처에 상륙할 해안이 없습니다');
    if (this.owner[landing] && this.peaceLeft()) return this.peaceFail();
    if (this.owner[landing] && this.allied(p.id, this.owner[landing])) return this.allyFail(this.owner[landing]);
    const path = this.seaPath(p.id, landing);
    if (!path) return fail('그곳으로 가는 바닷길이 없습니다');
    const c = this.commitForces(p, ratio, general);
    if (!c.ok) return c;
    this.markHostile(p.id, this.owner[landing]);
    this.boats.push({
      id: this.nextId++,
      owner: p.id,
      troops: c.troops,
      general,
      power: spec?.seaPower || 1,
      speed: spec?.seaSpeed || 1,
      naval: !!spec?.navalBattle,
      path,
      pos: 0,
      tile: path[0],
      landing,
      done: false,
    });
    const target = this.owner[landing];
    if (general) this.log(`${spec.glyph} ${p.name}의 ${josa(pieceLabel(general), '이/가')} 배를 타고 출항했습니다`, 'chess', [p.id, target]);
    return ok(`배 출항 (병력 ${fmt(c.troops)})`);
  }

  stepBoats() {
    for (const b of this.boats) {
      if (b.done) continue;
      if (!this.players[b.owner].alive) {
        b.done = true;
        continue;
      }
      b.pos = Math.min(b.path.length - 1, b.pos + b.speed);
      b.tile = b.path[Math.floor(b.pos)];
      if (b.pos >= b.path.length - 1) this.land(b);
    }
    const r2 = C.NAVAL_BATTLE_RANGE * C.NAVAL_BATTLE_RANGE;
    for (const b of this.boats) {
      if (b.done || !b.naval) continue;
      for (const e of this.boats) {
        if (e.done || e.owner === b.owner) continue;
        if (this.peaceLeft() || this.allied(b.owner, e.owner)) continue; // 평화 기간 · 동맹국 배와는 싸우지 않는다
        if (this.dist2(b.tile, e.tile) <= r2) this.navalBattle(b, e);
        if (b.done) break;
      }
    }
  }

  navalBattle(b, e) {
    const pb = b.troops * b.power;
    const pe = e.troops * e.power;
    const [w, l, pw, pl] = pb >= pe ? [b, e, pb, pe] : [e, b, pe, pb];
    this.markHostile(b.owner, e.owner);
    w.troops = Math.max(1, (pw - pl) / w.power);
    l.done = true;
    const Wn = this.players[w.owner];
    const Ln = this.players[l.owner];
    this.log(`⚓ 해전: ${Wn.name}의 배가 ${Ln.name}의 배(병력 ${fmt(l.troops)})를 침몰시켰습니다`, 'chess', [w.owner, l.owner], null, { tile: l.tile });
    l.troops = 0;
    if (l.general) this.captureGeneral(l.general, w.owner, w.general, l.tile);
  }

  land(b) {
    b.done = true;
    const p = this.players[b.owner];
    if (!p.alive) return;
    const L = b.landing;
    const target = this.owner[L];
    if (target === b.owner || (target && (this.peaceLeft() || this.allied(b.owner, target)))) {
      p.troops += b.troops;
      if (b.general) b.general.status = 'idle';
      return;
    }
    const a = this.newAttack({
      attacker: b.owner,
      target,
      troops: b.troops,
      general: b.general,
      kind: 'landing',
      origin: L,
      frontier: new Set(),
      landing: true,
    });
    this.attacks.push(a);
    if (this.kingGuarded(target, L) || !this.capture(a, L)) {
      a.done = true;
      this.log(`${p.name}의 상륙이 해안에서 막혔습니다`, 'info', [b.owner, target]);
      if (b.general) b.general.status = 'idle';
      return;
    }
    if (b.general && a.surpriseLeft > 0) {
      this.log(`${PIECES[b.general.type].glyph} 기습 상륙! ${p.name}의 ${josa(pieceLabel(b.general), '이/가')} 해안에 올랐습니다`, 'chess', [b.owner, target], null, { tile: L });
    }
  }

  // ───────────── 핵 ─────────────

  launchNuke(pid, tile, kind = 'atom') {
    const p = this.players[pid];
    const spec = C.NUKES[kind];
    if (this.phase !== 'play' || !p || !p.alive || !spec) return fail('지금은 쏠 수 없습니다');
    if (this.tick < this.nukeUnlockTick) return fail(`핵은 ${Math.ceil((this.nukeUnlockTick - this.tick) / 10)}초 뒤에 쓸 수 있습니다`);
    if (p.gold < spec.cost) return fail(`${spec.name}에는 금 ${fmt(spec.cost)}이 필요합니다`);
    if (tile < 0 || tile >= this.N) return fail('지도 안을 골라 주세요');
    const r = spec.radius + 2;
    if (this.owner[tile] === pid) return fail('내 땅에는 쏠 수 없습니다');
    if (this.dist2(p.king, tile) <= r * r) return fail('내 킹이 폭발 범위에 있습니다');
    const ally = this.players.find((q) => q && q.alive && this.allied(pid, q.id) && this.nukeHits(tile, kind, q.id));
    if (ally) return this.allyFail(ally.id);
    let from = -1;
    let best = Infinity;
    for (let t = 0; t < this.N; t++) {
      if (this.owner[t] !== pid) continue;
      const d2 = this.dist2(t, tile);
      if (d2 < best) {
        best = d2;
        from = t;
      }
    }
    if (from < 0) return fail('발사할 땅이 없습니다');
    p.gold -= spec.cost;
    this.markHostile(pid, this.owner[tile]);
    const flight = Math.round(C.NUKE_MIN_FLIGHT + Math.sqrt(best) / C.NUKE_SPEED);
    const nukeId = this.nextId++;
    this.nukes.push({ id: nukeId, owner: pid, kind, from, to: tile, launchTick: this.tick, impactTick: this.tick + flight, done: false });
    const hit = this.players.filter((q) => q && q.alive && q.id !== pid && q.king >= 0 && this.dist2(q.king, tile) <= (spec.radius + 3) ** 2).map((q) => q.id);
    const victim = this.owner[tile];
    const where = victim ? `${this.players[victim].name}의 영토` : '무주지';
    this.log(`☢ ${josa(p.name, '이/가')} ${where}에 ${josa(spec.name, '을/를')} 쐈습니다${hit.length ? ' — 킹이 사정권에 있습니다!' : ''}`, 'nuke', [pid, victim, ...hit], 'nuke', { tile, nukeId });
    return ok(`${spec.name} 발사 — ${(flight / 10).toFixed(1)}초 뒤 착탄`);
  }

  // 핵이 떨어지면 그 나라의 킹(반경 + 2) 이나 땅이 휩쓸리는지
  nukeHits(tile, kind, pid) {
    const q = this.players[pid];
    const r = C.NUKES[kind].radius;
    if (q.king >= 0 && this.dist2(q.king, tile) <= (r + 2) ** 2) return true;
    const cx = tile % this.W;
    const cy = (tile / this.W) | 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(this.W - 1, cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && this.owner[y * this.W + x] === pid) return true;
      }
    }
    return false;
  }

  stepNukes() {
    for (const n of this.nukes) if (!n.done && this.tick >= n.impactTick) this.detonate(n);
  }

  detonate(n) {
    n.done = true;
    const spec = C.NUKES[n.kind];
    const r = spec.radius;
    const r2 = r * r;
    const inner2 = (r * 0.65) ** 2;
    // 킹 피폭 → 그 나라는 패배
    for (const p of this.players) {
      if (p && p.alive && p.spawned && !this.allied(p.id, n.owner) && this.dist2(p.king, n.to) <= r2) this.eliminate(p.id, n.owner, 'nuke');
    }
    const cx = n.to % this.W;
    const cy = (n.to / this.W) | 0;
    const before = new Map();
    const lost = new Map();
    const zone = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d2 = dx * dx + dy * dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || d2 > r2) continue;
        const t = y * this.W + x;
        if (this.terrain[t] === C.WATER) continue;
        zone.push(t);
        this.fallout[t] = this.tick + C.FALLOUT_TICKS;
        this.dirty.push(t);
        const o = this.owner[t];
        if (!o || this.allied(o, n.owner) || (d2 > inner2 && this.rng() < 0.5)) continue; // 동맹국 땅은 건드리지 않는다
        if (!before.has(o)) before.set(o, this.density(this.players[o]));
        lost.set(o, (lost.get(o) || 0) + 1);
        this.setOwner(t, 0);
      }
    }
    this.falloutZones.push({ until: this.tick + C.FALLOUT_TICKS, tiles: zone });
    for (const [o, cnt] of lost) {
      const p = this.players[o];
      p.troops = Math.max(0, p.troops - cnt * before.get(o) * 1.5);
    }
    for (const b of this.boats) {
      if (!b.done && this.dist2(b.tile, n.to) <= r2) {
        b.done = true;
        if (b.general) this.captureGeneral(b.general, 0, null, b.tile);
      }
    }
    this.log(`☢ ${spec.name} 폭발`, 'nuke', [n.owner, ...lost.keys()], null, { tile: n.to });
  }

  expireFallout() {
    while (this.falloutZones.length && this.falloutZones[0].until <= this.tick) {
      for (const t of this.falloutZones.shift().tiles) this.dirty.push(t);
    }
  }

  // ───────────── 체스 규칙 ─────────────

  // 캐슬링: 체크(위협) 중에 한 번, 룩이 킹을 영토 가장 안쪽(국경에서 가장 먼 칸)으로 옮긴다. 날아오는 핵의 폭발 범위는 피한다
  castle(pid) {
    const p = this.players[pid];
    const co = castleOptions(this, pid);
    if (!co.available) return fail(co.reason);
    const blasts = this.nukes
      .filter((n) => !n.done && n.owner !== pid && !this.allied(pid, n.owner))
      .map((n) => [n.to, (C.NUKES[n.kind].radius + 2) ** 2]);
    const safe = (t) => blasts.every(([c, r2]) => this.dist2(t, c) > r2);
    const tile = this.innermostTile(pid, safe);
    if (tile < 0 || tile === p.king) return fail(co.threat?.kind === 'nuke' ? '핵을 피할 곳이 없습니다' : '더 안쪽으로 피할 곳이 없습니다');
    p.king = tile;
    p.castled = true;
    p.check = 0;
    this.log(`♜ 캐슬링! ${p.name}의 룩이 킹을 안쪽 성으로 옮겼습니다`, 'chess', [pid], 'castle');
    return ok('캐슬링 — 킹이 안쪽으로 피신했습니다');
  }

  // 내 영토 칸 중 남의 땅 · 무주지 · 바다에서 가장 먼 칸 (국경에서 시작하는 BFS). 깊이가 같으면 적 땅에서 먼 칸.
  // ok(t) 를 만족하는 칸만 고르고, 지금 킹 칸보다 낫지 않으면 -1
  innermostTile(pid, ok = () => true) {
    const { N, nbr, owner } = this;
    const depth = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let qt = 0;
    for (let t = 0; t < N; t++) {
      if (owner[t] !== pid) continue;
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n < 0 || owner[n] !== pid) {
          depth[t] = 0;
          q[qt++] = t;
          break;
        }
      }
    }
    for (let qh = 0; qh < qt; qh++) {
      const t = q[qh];
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0 && owner[n] === pid && depth[n] < 0) {
          depth[n] = depth[t] + 1;
          q[qt++] = n;
        }
      }
    }
    // 적(동맹이 아닌 다른 나라) 땅까지의 거리
    const far = new Int32Array(N).fill(-1);
    qt = 0;
    for (let t = 0; t < N; t++) {
      const o = owner[t];
      if (o && o !== pid && this.players[o].alive && !this.allied(pid, o)) {
        far[t] = 0;
        q[qt++] = t;
      }
    }
    for (let qh = 0; qh < qt; qh++) {
      const t = q[qh];
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0 && far[n] < 0) {
          far[n] = far[t] + 1;
          q[qt++] = n;
        }
      }
    }
    const score = (t) => depth[t] * 100000 + (far[t] < 0 ? 99999 : far[t]);
    let best = -1;
    let bestS = -1;
    for (let t = 0; t < N; t++) {
      if (owner[t] !== pid || !ok(t)) continue;
      const sc = score(t);
      if (sc > bestS) {
        bestS = sc;
        best = t;
      }
    }
    const king = this.players[pid].king;
    if (best >= 0 && king >= 0 && owner[king] === pid && ok(king) && bestS <= score(king)) return -1;
    return best;
  }

  // 앙파상: 성의 폰이 출동해 깊이 파고든 적 부대를 역포위 — 돌파 지역을 되찾고 부대를 섬멸
  enPassant(pid, attackId) {
    const a = this.attacks.find((x) => x.id === attackId && !x.done);
    if (!a || a.target !== pid) return fail('그 공격은 이미 끝났습니다');
    if (a.kind === 'knight') return fail('나이트는 뛰어넘어 와서 앙파상으로 잡을 수 없습니다');
    const ev = evaluatePocket(this, a);
    if (!ev.ok) return fail(`앙파상 조건 부족: ${ev.checks.find((c) => !c.ok).label}`);
    const pawn = ev.pawn;
    const p = this.players[pid];
    const att = this.players[a.attacker];
    for (const t of ev.pocket) this.setOwner(t, pid);
    const lostTroops = a.troops;
    a.done = true;
    a.troops = 0;
    // 출동한 폰은 잠시 뒤에 성으로 돌아온다
    pawn.status = 'busy';
    pawn.backAt = this.tick + C.EP_PAWN_REST;
    this.log(
      `♟ 앙파상! ${p.name}의 폰이 ${att.name}의 돌파 부대를 역포위 — ${ev.pocket.size}칸 탈환, 병력 ${fmt(lostTroops)} 섬멸`,
      'chess',
      [pid, a.attacker],
      'enpassant'
    );
    if (a.general) this.captureGeneral(a.general, pid, pawn, a.lastTile);
    return ok('앙파상 성공');
  }

  // ───────────── 진행 ─────────────

  update() {
    if (this.phase !== 'play') return;
    this.tick++;
    for (const p of this.players) {
      if (!p || !p.alive || !p.spawned) continue;
      const max = this.maxTroopsOf(p);
      if (p.troops > max) p.troops -= (p.troops - max) * 0.01;
      else p.troops = Math.min(max, p.troops + C.troopRegen(p.troops, max) * (p.isHuman ? 1 : this.botLevel().regen));
      p.gold += C.goldIncome(p.tiles);
    }
    for (const p of this.players) {
      if (!p || !p.alive || !p.spawned) continue;
      for (const g of p.generals) {
        if (g.backAt && this.tick >= g.backAt) {
          g.backAt = 0;
          if (g.status === 'busy') g.status = 'idle';
        }
      }
      const by = this.checkBy(p.id);
      if (by && !p.check) {
        p.checkSince = this.tick;
        p.bot.nextThink = Math.min(p.bot.nextThink, this.tick + 5); // 봇도 곧바로 대응한다
        this.log(`♚ 체크! ${josa(this.players[by].name, '이/가')} ${p.name}의 궁성에 들어왔습니다`, 'chess', [p.id, by], 'check', { tile: p.king });
      }
      p.check = by;
    }
    this.stepDiplomacy();
    for (const p of this.players) if (p && !p.isHuman) botThink(this, p);
    for (const a of this.attacks) if (!a.done) this.stepAttack(a);
    this.stepBoats();
    this.stepNukes();
    this.expireFallout();
    if (this.tick % C.ENCLAVE_EVERY === 0) this.removeEnclaves();
    if (this.tick % C.NAME_EVERY === 0) this.placeNames();
    this.attacks = this.attacks.filter((a) => !a.done);
    this.boats = this.boats.filter((b) => !b.done);
    this.nukes = this.nukes.filter((n) => !n.done);
    this.recordStats();
    this.checkEnd();
  }

  // 킹과 떨어진 땅 덩어리가 한 적국에게만 둘러싸였으면 그 나라가 흡수한다. 덩어리만큼 병력도 잃는다
  // 바다와 닿은 덩어리(상륙 거점)는 배로 이어진 땅이라 그대로 둔다
  removeEnclaves() {
    if (this.peaceLeft()) return;
    const { N, nbr, owner, terrain } = this;
    const seen = new Uint8Array(N);
    const q = new Int32Array(N);
    const moves = [];
    for (let s = 0; s < N; s++) {
      const pid = owner[s];
      if (!pid || seen[s]) continue;
      const p = this.players[pid];
      let qt = 0;
      q[qt++] = s;
      seen[s] = 1;
      let hasKing = false;
      let coast = false;
      let around = -1; // 둘러싼 나라: -1 아직 없음, -2 여럿, 0 무주지
      for (let qh = 0; qh < qt; qh++) {
        const t = q[qh];
        if (t === p.king) hasKing = true;
        for (let k = 0; k < 4; k++) {
          const n = nbr[t * 4 + k];
          if (n < 0) continue;
          if (terrain[n] === C.WATER) {
            coast = true;
            continue;
          }
          const o = owner[n];
          if (o === pid) {
            if (!seen[n]) {
              seen[n] = 1;
              q[qt++] = n;
            }
          } else if (around === -1) around = o;
          else if (around !== o) around = -2;
        }
      }
      if (hasKing || coast || around <= 0 || !this.players[around].alive || this.allied(pid, around)) continue;
      const tiles = q.slice(0, qt);
      // 상륙 · 공격 중인 거점은 그대로 둔다
      if (this.attacks.some((a) => !a.done && a.attacker === pid && (tiles.includes(a.lastTile) || tiles.includes(a.origin)))) continue;
      moves.push([pid, around, tiles]);
    }
    // 다 찾은 뒤에 넘긴다 (찾는 도중에 주인을 바꾸면 덩어리 판정이 꼬인다)
    for (const [pid, to, tiles] of moves) {
      const p = this.players[pid];
      p.troops -= (p.troops * tiles.length) / Math.max(1, p.tiles);
      for (const t of tiles) this.setOwner(t, to);
      if (tiles.length >= C.ENCLAVE_LOG_TILES) this.log(`${p.name}의 고립된 땅 ${tiles.length}칸이 ${this.players[to].name}에게 넘어갔습니다`, 'chess', [pid, to], null, { tile: tiles[0] });
    }
  }

  // 승리 기준: 오버타임이 지나면 1분에 2%p 씩 내려간다
  winShare() {
    const over = this.tick - this.overtimeTick;
    if (over <= 0) return C.WIN_LAND_SHARE;
    return Math.max(C.OVERTIME_MIN_SHARE, C.WIN_LAND_SHARE - C.OVERTIME_DROP * Math.ceil(over / 600));
  }

  recordStats() {
    const h = this.human;
    if (!h) return;
    const share = h.tiles / this.landCount;
    if (share > this.stats.peak) this.stats.peak = share;
    if (this.tick % C.STATS_EVERY === 0 && h.alive) {
      this.stats.history.push(share);
      // 최고 순위: 나보다 땅이 많은 살아 있는 나라 수 + 1
      const rank = 1 + this.players.filter((p) => p && p.alive && p.spawned && p.id !== h.id && p.tiles > h.tiles).length;
      if (!this.stats.bestRank || rank < this.stats.bestRank) this.stats.bestRank = rank;
    }
  }

  // 끝: 킹이 하나만 남거나, 누군가 육지의 승리 기준(80%, 오버타임에는 더 낮게)을 차지하면
  checkEnd() {
    const alive = this.players.filter((p) => p && p.alive && p.spawned);
    const need = this.landCount * this.winShare();
    const leader = alive.find((p) => p.tiles >= need);
    if (this.humanId) {
      const h = this.human;
      if (!h.alive) {
        this.phase = 'over';
        this.result = 'lose';
        this.winner = alive.length === 1 ? alive[0].id : leader?.id || 0;
      } else if (alive.length === 1 || leader === h) {
        this.phase = 'over';
        this.result = 'win';
        this.winner = h.id;
      } else if (leader) {
        this.phase = 'over';
        this.result = 'lose';
        this.winner = leader.id;
      }
    } else if (alive.length <= 1 || leader) {
      this.phase = 'over';
      this.winner = leader?.id || alive[0]?.id || 0;
    }
    if (this.phase === 'over') this.stats.endTick = this.tick;
  }
}
