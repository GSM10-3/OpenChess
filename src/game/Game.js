import { mulberry32 } from './rng';
import { generateMap, analyzeMap } from './mapgen';
import * as C from './constants';
import { PIECES, FORMATION, pieceLabel, josa } from './pieces';
import { botThink, BOT_NAMES } from './bot';
import { castleOptions, evaluatePocket } from './chess';

const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7',
  '#f97316', '#14b8a6', '#ec4899', '#84cc16', '#64748b',
  '#06b6d4', '#d946ef', '#f43f5e', '#8b5cf6', '#10b981', '#b45309',
];

const ok = (msg = '', extra = {}) => ({ ok: true, msg, ...extra });
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

    this.owner = new Int16Array(this.N); // 0 = 무주지
    this.fallout = new Int32Array(this.N); // 이 틱까지 방사능
    this.falloutZones = [];
    this.stationed = new Map(); // 칸 → 그 칸에 대기 중인 장군들
    this.alliances = new Map(); // "a-b" → { until } 동맹
    this.hostile = new Map(); // "a-b" → 마지막으로 서로 싸운 틱
    this.allyRetry = new Map(); // "요청-대상" → 이 틱까지 다시 제안 못 함
    this.stats = { history: [], peak: 0, captured: 0, lost: 0, mates: 0, endTick: 0 }; // 사람의 기록 (결과 화면)
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

  // tag: 화면 연출용 체스 사건 종류 (check · castle · promotion · enpassant · checkmate · capture)
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
      color: color || COLORS[(id - 1) % COLORS.length],
      alive: true,
      spawned: false,
      troops: C.START_TROOPS,
      gold: C.START_GOLD,
      tiles: 0,
      sumX: 0,
      sumY: 0,
      king: -1,
      castled: false,
      check: 0, // 궁성에 들어온 적 (체크), 없으면 0
      checkSince: 0, // 체크가 시작된 틱
      traitorUntil: 0, // 동맹을 깨면 이 틱까지 배신자
      allianceOffers: [], // 봇이 사람에게 보낸 동맹 제안 { from, until }
      generals: [],
      offers: [], // 프로모션 제안 (사람만)
      killedBy: 0,
      deathCause: null,
      bot: { nextThink: 0 },
    });
    return id;
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
    for (const f of FORMATION) {
      const g = {
        id: `${pid}:${f.type === 'pawn' ? 'p' : ''}${f.file}`,
        owner: pid,
        type: f.type,
        file: f.file,
        promoted: false,
        status: 'idle',
        tile: -1,
        move: null,
        restUntil: 0, // 이 틱까지 휴식 (출격 불가)
      };
      p.generals.push(g);
      this.station(g, this.nearestOwned(pid, x0 + f.dx, y0 + f.dy, tile));
    }
    return true;
  }

  spawnHuman(tile) {
    if (this.phase !== 'spawn') return fail('이미 시작했습니다');
    if (!this.isLand(tile)) return fail('육지를 골라 주세요');
    if (this.owner[tile]) return fail('이미 다른 나라의 땅입니다');
    if (this.landmassSize[this.landmass[tile]] < 40) return fail('너무 작은 섬입니다');
    this.spawn(this.humanId, tile);
    this.phase = 'play';
    this.log('게임 시작! 킹을 지키면서 영토를 넓히세요.', 'info', [this.humanId]);
    return ok('시작!');
  }

  nearestOwned(pid, x, y, fallback) {
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue;
          const t = yy * this.W + xx;
          if (this.owner[t] === pid) return t;
        }
      }
    }
    return fallback;
  }

  // 장군이 돌아갈 곳: 원하는 칸이 아직 내 땅이면 거기, 아니면 킹 곁
  homeTile(p, wanted) {
    if (wanted >= 0 && this.owner[wanted] === p.id) return wanted;
    return p.king;
  }

  // ───────────── 땅 주인 바꾸기 ─────────────

  // captorPlayer/captorGeneral: 이 칸을 빼앗아 주둔 장군을 잡은 쪽 (프로모션 판정용)
  setOwner(t, pid, captorGeneral = null) {
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

    const here = this.stationed.get(t);
    if (here) {
      for (const g of [...here]) if (g.owner !== pid) this.captureGeneral(g, pid, captorGeneral);
    }
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
    if (this.humanId && killerId === this.humanId) this.stats.mates++;
    for (const key of [...this.alliances.keys()]) if (key.split('-').map(Number).includes(vid)) this.alliances.delete(key);
    if (cause === 'nuke') {
      this.log(`☢ ${v.name}의 킹이 피폭되었습니다 — ${josa(v.name, '이/가')} 무너졌습니다`, 'big', [vid, killerId], 'checkmate', { nuke: true });
    } else {
      this.log(`♚ 체크메이트! ${josa(k.name, '이/가')} ${v.name}의 킹을 잡았습니다`, 'big', [vid, killerId], 'checkmate');
    }
    for (const g of v.generals) {
      if (g.status === 'captured') continue;
      this.unstation(g);
      g.status = 'captured';
      g.move = null;
    }
    v.offers = [];
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

  // ───────────── 장군 ─────────────

  station(g, t) {
    this.unstation(g);
    g.tile = t;
    g.status = 'idle';
    g.move = null;
    if (t < 0) return;
    let set = this.stationed.get(t);
    if (!set) this.stationed.set(t, (set = new Set()));
    set.add(g);
  }

  unstation(g) {
    if (g.tile >= 0) {
      const set = this.stationed.get(g.tile);
      if (set) {
        set.delete(g);
        if (!set.size) this.stationed.delete(g.tile);
      }
    }
    g.tile = -1;
  }

  findGeneral(pid, gid) {
    const p = this.players[pid];
    return p ? p.generals.find((g) => g.id === gid) || null : null;
  }

  captureGeneral(g, captorPlayer, captorGeneral) {
    if (g.status === 'captured') return;
    this.unstation(g);
    g.status = 'captured';
    g.move = null;
    const owner = this.players[g.owner];
    owner.offers = owner.offers.filter((o) => o.generalId !== g.id);
    const cp = captorPlayer ? this.players[captorPlayer] : null;
    const who = cp ? cp.name : '핵폭발';
    if (this.humanId && captorPlayer === this.humanId) this.stats.captured++;
    if (this.humanId && g.owner === this.humanId) this.stats.lost++;
    this.log(
      `${PIECES[g.type].glyph} ${owner.name}의 ${josa(pieceLabel(g), '이/가')} ${who}에게 잡혔습니다`,
      'chess',
      [g.owner, captorPlayer],
      'capture',
      { type: g.type }
    );
    if (captorGeneral) this.offerPromotion(captorGeneral, g.type);
  }

  // 폰이 다른 장군을 이기면 그 기물로 바꿀 기회를 준다 (봇은 바로 바꾼다)
  offerPromotion(pawn, toType) {
    if (pawn.type !== 'pawn' || pawn.promoted || pawn.status === 'captured') return;
    if (toType === 'pawn' || toType === 'king' || !PIECES[toType]) return;
    const p = this.players[pawn.owner];
    if (!p.isHuman) {
      this.promote(pawn, toType);
      return;
    }
    const ex = p.offers.find((o) => o.generalId === pawn.id);
    if (ex) {
      if (PIECES[toType].value > PIECES[ex.toType].value) ex.toType = toType;
      return;
    }
    p.offers.push({ generalId: pawn.id, toType, tick: this.tick });
    this.log(`♟ ${josa(pieceLabel(pawn), '이/가')} ${josa(PIECES[toType].name, '을/를')} 꺾었습니다 — 프로모션할 수 있습니다`, 'chess', [p.id]);
  }

  resolvePromotion(pid, gid, accept) {
    const p = this.players[pid];
    const offer = p.offers.find((o) => o.generalId === gid);
    if (!offer) return fail('프로모션 제안이 없습니다');
    p.offers = p.offers.filter((o) => o !== offer);
    const g = this.findGeneral(pid, gid);
    if (!g || g.status === 'captured' || g.type !== 'pawn' || g.promoted) return fail('이 폰은 프로모션할 수 없습니다');
    if (!accept) {
      this.log(`♟ ${josa(pieceLabel(g), '은/는')} 폰으로 남았습니다`, 'chess', [pid]);
      return ok('폰 유지');
    }
    this.promote(g, offer.toType);
    return ok(`${josa(PIECES[offer.toType].name, '으로/로')} 프로모션`);
  }

  promote(g, type) {
    g.type = type;
    g.promoted = true;
    const p = this.players[g.owner];
    this.log(`${PIECES[type].glyph} 프로모션! ${p.name}의 폰(${g.file})이 ${josa(PIECES[type].name, '이/가')} 되었습니다`, 'chess', [p.id], 'promotion', { type });
  }

  moveGeneral(pid, gid, tile) {
    const g = this.findGeneral(pid, gid);
    if (!g || g.status !== 'idle') return fail('대기 중인 장군만 옮길 수 있습니다');
    if (this.owner[tile] !== pid) return fail('내 영토로만 옮길 수 있습니다');
    if (tile === g.tile) return fail('이미 그 자리에 있습니다');
    const from = g.tile;
    this.unstation(g);
    g.status = 'moving';
    g.move = { from, to: tile, start: this.tick, end: this.tick + Math.max(1, Math.ceil(this.dist(from, tile) / C.GENERAL_SPEED)) };
    return ok(`${pieceLabel(g)} 이동 중`);
  }

  stepMovers() {
    for (const p of this.players) {
      if (!p || !p.alive) continue;
      for (const g of p.generals) {
        if (g.status !== 'moving' || this.tick < g.move.end) continue;
        this.station(g, this.homeTile(p, g.move.to));
      }
    }
  }

  inFortress(pid, t) {
    const r2 = C.FORTRESS_RADIUS * C.FORTRESS_RADIUS;
    for (const g of this.players[pid].generals) {
      if (g.status === 'idle' && PIECES[g.type].fortress && this.dist2(g.tile, t) <= r2) return true;
    }
    return false;
  }

  inPalace(pid, t) {
    const p = this.players[pid];
    return !!p && p.alive && p.king >= 0 && this.dist2(p.king, t) <= C.PALACE_RADIUS * C.PALACE_RADIUS;
  }

  // 궁성 안에 적 땅이 있으면 그 나라 번호 (체크), 없으면 0
  checkBy(pid) {
    const p = this.players[pid];
    if (!p || !p.alive || p.king < 0) return 0;
    const r = C.PALACE_RADIUS;
    const kx = p.king % this.W;
    const ky = (p.king / this.W) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = kx + dx;
        const y = ky + dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H || dx * dx + dy * dy > r * r) continue;
        const o = this.owner[y * this.W + x];
        if (o && o !== pid && this.players[o].alive) return o;
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
    return Math.max(0, C.PEACE_TICKS - this.tick);
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

  // 봇이 동맹을 받아들일지: 최근에 싸우지 않았고, 상대가 배신자가 아니고, 너무 작은 나라가 아니면
  allianceRefusal(from, to) {
    const a = this.players[from];
    const b = this.players[to];
    if (this.recentlyHostile(from, to)) return `${josa(b.name, '이/가')} 최근에 싸운 상대라 거절했습니다`;
    if (this.isTraitor(from)) return `배신자와는 동맹하지 않는다며 ${josa(b.name, '이/가')} 거절했습니다`;
    if (b.tiles > a.tiles * C.ALLY_SIZE_LIMIT) return `${josa(b.name, '이/가')} 너무 작은 나라라며 거절했습니다`;
    return '';
  }

  formAlliance(a, b) {
    this.alliances.set(this.pairKey(a, b), { until: this.tick + C.ALLIANCE_TICKS });
    // 서로를 향한 공격은 멈춘다
    for (const x of this.attacks) if (!x.done && ((x.attacker === a && x.target === b) || (x.attacker === b && x.target === a))) this.endAttack(x);
    this.log(`🤝 ${josa(this.players[a].name, '과/와')} ${josa(this.players[b].name, '이/가')} 동맹을 맺었습니다`, 'chess', [a, b], 'alliance');
  }

  requestAlliance(pid, target) {
    const p = this.players[pid];
    const t = this.players[target];
    if (this.phase !== 'play' || !p?.alive || !t?.alive || pid === target) return fail('지금은 동맹을 맺을 수 없습니다');
    if (this.allied(pid, target)) return this.renewAlliance(pid, target);
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
    al.until = this.tick + C.ALLIANCE_TICKS;
    return ok(`${josa(this.players[target].name, '과/와')} 동맹 연장`);
  }

  breakAlliance(pid, target) {
    if (!this.allied(pid, target)) return fail('동맹이 아닙니다');
    this.alliances.delete(this.pairKey(pid, target));
    this.players[pid].traitorUntil = this.tick + C.TRAITOR_TICKS;
    this.markHostile(pid, target);
    this.log(`⚠ 배신! ${josa(this.players[pid].name, '이/가')} ${this.players[target].name}과의 동맹을 깼습니다`, 'big', [pid, target], 'betray');
    return ok('동맹을 깼습니다 — 1분 동안 배신자');
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

  // 장군 비용 · 병력 떼어내기
  commitForces(p, ratio, general) {
    const spec = general ? PIECES[general.type] : null;
    if (spec && p.gold < spec.cost) return fail(`${spec.name} 출격에는 금 ${fmt(spec.cost)}이 필요합니다`);
    let troops = Math.floor(p.troops * Math.min(1, Math.max(0, ratio)));
    if (troops < 1) return fail('보낼 병력이 없습니다');
    p.troops -= troops;
    if (spec) {
      p.gold -= spec.cost;
      if (spec.troopLoss) {
        const lost = Math.floor(troops * spec.troopLoss);
        troops -= lost;
        this.log(`${spec.glyph} ${p.name}의 퀸 출격 — 투입 병력 ${fmt(lost)} 손실`, 'chess', [p.id]);
      }
      this.unstation(general);
      general.status = 'busy';
      general.move = null;
    }
    return { ok: true, troops };
  }

  // ───────────── 지상 공격 ─────────────

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
      startTick: this.tick,
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
      if (!general || general.status !== 'idle') return fail('그 장군은 지금 출격할 수 없습니다');
      if (this.tick < general.restUntil) return fail(`${josa(pieceLabel(general), '은/는')} 휴식 중입니다 — ${Math.ceil((general.restUntil - this.tick) / 10)}초 뒤 출격`);
    }
    const spec = general ? PIECES[general.type] : null;
    const frontier = !forceBoat && (!spec || spec.land) ? this.borderWith(pid, target) : null;
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
    if (general) this.log(`${spec.glyph} ${p.name}의 ${josa(pieceLabel(general), '이/가')} ${josa(tName, '으로/로')} 출격 (병력 ${fmt(c.troops)})`, 'chess', [pid, target]);

    this.resolveClash(a);
    if (a.done) return ok('맞공격에 부딪혔습니다');
    if (!general) {
      const same = this.attacks.find((x) => !x.done && x.attacker === pid && x.target === target && !x.general && x.kind === 'land');
      if (same) {
        same.troops += a.troops;
        for (const t of frontier) same.frontier.add(t);
        return ok(`${tName} 공격에 병력 ${fmt(a.troops)} 추가`);
      }
    }
    this.attacks.push(a);
    return ok(`${tName} 공격 (병력 ${fmt(a.troops)})`);
  }

  // 서로 공격 중인 두 부대가 맞부딪히면 힘(병력 × 장군 배율)이 큰 쪽만 남는다
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
    this.log(`⚔ 맞공격: ${Wn.name}의 ${josa(tag(winner), '이/가')} ${L.name}의 ${josa(tag(loser), '을/를')} 격파했습니다`, 'chess', [loser.attacker, winner.attacker]);
    if (loser.general) this.captureGeneral(loser.general, winner.attacker, winner.general);
  }

  // 비숍의 대각선: 내 영토 중심 → 클릭한 곳 방향을 45° 로 맞추고, 클릭한 곳에서 가장 가까운 전선 칸을 지나는 직선
  diagonalLine(p, tile, frontier) {
    const tx = tile % this.W;
    const ty = (tile / this.W) | 0;
    const dx = tx >= p.sumX / Math.max(1, p.tiles) ? 1 : -1;
    const dy = ty >= p.sumY / Math.max(1, p.tiles) ? 1 : -1;
    let start = tile;
    let best = Infinity;
    for (const t of frontier) {
      const d2 = this.dist2(t, tile);
      if (d2 < best) {
        best = d2;
        start = t;
      }
    }
    return { sx: start % this.W, sy: (start / this.W) | 0, dx, dy };
  }

  // 대각선 띠 위의 칸이면 진행 거리를, 아니면 -1
  diagonalProgress(line, t) {
    const x = (t % this.W) - line.sx;
    const y = ((t / this.W) | 0) - line.sy;
    if (Math.abs(x * line.dy - y * line.dx) > C.BISHOP_WIDTH) return -1;
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
    }
    if (a.target && this.inPalace(a.target, t)) cost *= C.PALACE_MULT;
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
      // 띠 위의 칸만, 출발점에 가까운 칸부터 → 좁고 길게 뻗는다
      const scored = [];
      for (const t of cands) {
        const along = this.diagonalProgress(a.diag, t);
        if (along >= 0) scored.push([t, along + this.rng()]);
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
      n = Math.min(C.MAX_TILES_PER_TICK, Math.max(1, Math.ceil(cands.length * C.ATTACK_SPREAD * a.speed)));
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
    if (a.general && a.general.status === 'busy') {
      this.station(a.general, this.homeTile(p, a.lastTile >= 0 ? a.lastTile : a.origin));
      a.general.restUntil = this.tick + C.GENERAL_REST_TICKS;
    }
  }

  retreat(pid, attackId) {
    const a = this.attacks.find((x) => x.id === attackId && !x.done && x.attacker === pid);
    if (!a) return fail('그 공격은 이미 끝났습니다');
    a.troops *= C.RETREAT_KEEP;
    this.endAttack(a);
    return ok('후퇴');
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
        if (this.dist2(b.tile, e.tile) <= r2) this.navalBattle(b, e);
        if (b.done) break;
      }
    }
  }

  navalBattle(b, e) {
    const pb = b.troops * b.power;
    const pe = e.troops * e.power;
    const [w, l, pw, pl] = pb >= pe ? [b, e, pb, pe] : [e, b, pe, pb];
    w.troops = Math.max(1, (pw - pl) / w.power);
    l.done = true;
    const Wn = this.players[w.owner];
    const Ln = this.players[l.owner];
    this.log(`⚓ 해전: ${Wn.name}의 배가 ${Ln.name}의 배(병력 ${fmt(l.troops)})를 침몰시켰습니다`, 'chess', [w.owner, l.owner]);
    l.troops = 0;
    if (l.general) this.captureGeneral(l.general, w.owner, w.general);
  }

  land(b) {
    b.done = true;
    const p = this.players[b.owner];
    if (!p.alive) return;
    const L = b.landing;
    const target = this.owner[L];
    if (target === b.owner || (target && (this.peaceLeft() || this.allied(b.owner, target)))) {
      p.troops += b.troops;
      if (b.general) {
        this.station(b.general, L);
        b.general.restUntil = this.tick + C.GENERAL_REST_TICKS;
      }
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
      if (b.general) {
        this.station(b.general, p.king);
        b.general.restUntil = this.tick + C.GENERAL_REST_TICKS;
      }
      return;
    }
    if (b.general && a.surpriseLeft > 0) {
      this.log(`${PIECES[b.general.type].glyph} 기습 상륙! ${p.name}의 ${josa(pieceLabel(b.general), '이/가')} 해안에 올랐습니다`, 'chess', [b.owner, target]);
    }
  }

  // ───────────── 핵 ─────────────

  launchNuke(pid, tile, kind = 'atom') {
    const p = this.players[pid];
    const spec = C.NUKES[kind];
    if (this.phase !== 'play' || !p || !p.alive || !spec) return fail('지금은 쏠 수 없습니다');
    if (this.tick < C.NUKE_UNLOCK_TICK) return fail(`핵은 ${Math.ceil((C.NUKE_UNLOCK_TICK - this.tick) / 10)}초 뒤에 쓸 수 있습니다`);
    if (p.gold < spec.cost) return fail(`${spec.name}에는 금 ${fmt(spec.cost)}이 필요합니다`);
    if (tile < 0 || tile >= this.N) return fail('지도 안을 골라 주세요');
    if (this.owner[tile] && this.allied(pid, this.owner[tile])) return this.allyFail(this.owner[tile]);
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
    this.nukes.push({ id: this.nextId++, owner: pid, kind, from, to: tile, launchTick: this.tick, impactTick: this.tick + flight, done: false });
    const hit = this.players.filter((q) => q && q.alive && q.id !== pid && q.king >= 0 && this.dist2(q.king, tile) <= (spec.radius + 3) ** 2).map((q) => q.id);
    const victim = this.owner[tile];
    const where = victim ? `${this.players[victim].name}의 영토` : '무주지';
    this.log(`☢ ${josa(p.name, '이/가')} ${where}에 ${josa(spec.name, '을/를')} 쐈습니다${hit.length ? ' — 킹이 사정권에 있습니다!' : ''}`, 'nuke', [pid, victim, ...hit], 'nuke');
    return ok(`${spec.name} 발사 — ${(flight / 10).toFixed(1)}초 뒤 착탄`);
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
      if (p && p.alive && p.spawned && this.dist2(p.king, n.to) <= r2) this.eliminate(p.id, n.owner, 'nuke');
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
        if (!o || (d2 > inner2 && this.rng() < 0.5)) continue;
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
    for (const p of this.players) {
      if (!p || !p.alive) continue;
      for (const g of p.generals) {
        if (g.status === 'idle' && this.dist2(g.tile, n.to) <= r2) this.captureGeneral(g, 0, null);
      }
    }
    for (const b of this.boats) {
      if (!b.done && this.dist2(b.tile, n.to) <= r2) {
        b.done = true;
        if (b.general) this.captureGeneral(b.general, 0, null);
      }
    }
    this.log(`☢ ${spec.name} 폭발`, 'nuke', [n.owner, ...lost.keys()]);
  }

  expireFallout() {
    while (this.falloutZones.length && this.falloutZones[0].until <= this.tick) {
      for (const t of this.falloutZones.shift().tiles) this.dirty.push(t);
    }
  }

  // ───────────── 체스 규칙 ─────────────

  castle(pid, rookId = null) {
    const p = this.players[pid];
    const co = castleOptions(this, pid);
    if (!co.available) return fail(co.reason);
    const rook = rookId ? co.rooks.find((g) => g.id === rookId) : co.rooks[0];
    if (!rook) return fail('그 룩과는 캐슬링할 수 없습니다');
    const kingTile = p.king;
    p.king = rook.tile;
    this.station(rook, kingTile);
    p.castled = true;
    this.log(`♜ 캐슬링! ${p.name}의 킹이 ${josa(pieceLabel(rook), '과/와')} 자리를 바꿨습니다`, 'chess', [pid], 'castle');
    return ok('캐슬링 완료');
  }

  enPassant(pid, attackId) {
    const a = this.attacks.find((x) => x.id === attackId && !x.done);
    if (!a || a.target !== pid) return fail('그 공격은 이미 끝났습니다');
    const ev = evaluatePocket(this, a);
    if (!ev.ok) return fail(`앙파상 조건 부족: ${ev.checks.find((c) => !c.ok).label}`);
    const pawn = ev.pawn;
    const p = this.players[pid];
    const att = this.players[a.attacker];
    let sx = 0;
    let sy = 0;
    for (const t of ev.pocket) {
      this.setOwner(t, pid, pawn);
      sx += t % this.W;
      sy += (t / this.W) | 0;
    }
    const lostTroops = a.troops;
    a.done = true;
    a.troops = 0;
    this.log(
      `♟ 앙파상! ${p.name}의 ${josa(pieceLabel(pawn), '이/가')} ${att.name}의 돌파 부대를 역포위 — ${ev.pocket.size}칸 탈환, 병력 ${fmt(lostTroops)} 섬멸`,
      'chess',
      [pid, a.attacker],
      'enpassant'
    );
    if (a.general) this.captureGeneral(a.general, pid, pawn);
    const c = Math.round(sy / ev.pocket.size) * this.W + Math.round(sx / ev.pocket.size);
    if (pawn.status !== 'captured') {
      this.station(pawn, this.nearestOwned(pid, c % this.W, (c / this.W) | 0, pawn.tile >= 0 ? pawn.tile : p.king));
    }
    return ok('앙파상 성공');
  }

  // ───────────── 진행 ─────────────

  update() {
    if (this.phase !== 'play') return;
    this.tick++;
    for (const p of this.players) {
      if (!p || !p.alive || !p.spawned) continue;
      const max = C.maxTroops(p.tiles);
      if (p.troops > max) p.troops -= (p.troops - max) * 0.01;
      else p.troops = Math.min(max, p.troops + C.troopRegen(p.troops, max));
      p.gold += C.goldIncome(p.tiles);
    }
    for (const p of this.players) {
      if (!p || !p.alive || !p.spawned) continue;
      const by = this.checkBy(p.id);
      if (by && !p.check) {
        p.checkSince = this.tick;
        p.bot.nextThink = Math.min(p.bot.nextThink, this.tick + 5); // 봇도 곧바로 대응한다
        this.log(`♚ 체크! ${josa(this.players[by].name, '이/가')} ${p.name}의 궁성에 들어왔습니다`, 'chess', [p.id, by], 'check');
      }
      p.check = by;
    }
    this.stepDiplomacy();
    for (const p of this.players) if (p && !p.isHuman) botThink(this, p);
    this.stepMovers();
    for (const a of this.attacks) if (!a.done) this.stepAttack(a);
    this.stepBoats();
    this.stepNukes();
    this.expireFallout();
    this.attacks = this.attacks.filter((a) => !a.done);
    this.boats = this.boats.filter((b) => !b.done);
    this.nukes = this.nukes.filter((n) => !n.done);
    this.recordStats();
    this.checkEnd();
  }

  recordStats() {
    const h = this.human;
    if (!h) return;
    const share = h.tiles / this.landCount;
    if (share > this.stats.peak) this.stats.peak = share;
    if (this.tick % C.STATS_EVERY === 0 && h.alive) this.stats.history.push(share);
  }

  checkEnd() {
    const alive = this.players.filter((p) => p && p.alive && p.spawned);
    if (this.humanId) {
      const h = this.human;
      if (!h.alive) {
        this.phase = 'over';
        this.result = 'lose';
        this.winner = alive.length === 1 ? alive[0].id : 0;
      } else if (alive.length === 1 || h.tiles >= this.landCount * C.WIN_LAND_SHARE) {
        this.phase = 'over';
        this.result = 'win';
        this.winner = h.id;
      }
    } else if (alive.length <= 1) {
      this.phase = 'over';
      this.winner = alive[0]?.id || 0;
    }
    if (this.phase === 'over') this.stats.endTick = this.tick;
  }
}
