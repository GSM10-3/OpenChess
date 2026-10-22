// 봇: 몇 초마다 한 번씩 상황을 보고 하나를 한다
import * as C from './constants';
import { PIECES } from './pieces';
import { castleOptions, enPassantOptions } from './chess';

export const BOT_NAMES = [
  '아르덴', '카스티야', '노르드', '사보이', '비잔티움', '페르시아',
  '아라곤', '브리타니아', '프로이센', '베네치아', '보헤미아',
];

export const DIFFICULTY = {
  easy: { label: '쉬움', interval: 30, minTroops: 0.5, ratio: 0.2, nukeChance: 0.02, kingSnipe: 0.1, generals: 0.3 },
  normal: { label: '보통', interval: 18, minTroops: 0.4, ratio: 0.28, nukeChance: 0.05, kingSnipe: 0.25, generals: 0.5 },
  hard: { label: '어려움', interval: 10, minTroops: 0.3, ratio: 0.35, nukeChance: 0.08, kingSnipe: 0.4, generals: 0.7 },
};

// 내 땅에 맞닿은 주인별로 칸 하나씩
function scanNeighbors(game, pid) {
  const m = new Map();
  const { owner, nbr, terrain, N } = game;
  for (let t = 0; t < N; t++) {
    if (owner[t] !== pid) continue;
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n < 0 || terrain[n] === C.WATER) continue;
      const o = owner[n];
      if (o !== pid && !m.has(o)) m.set(o, n);
    }
  }
  return m;
}

function idle(game, p, types, reserve = 0) {
  for (const type of types) {
    const g = p.generals.find((x) => x.type === type && x.status === 'idle');
    if (g && p.gold >= PIECES[type].cost + reserve) return g;
  }
  return null;
}

function randomTileOf(game, pid) {
  for (let i = 0; i < 300; i++) {
    const t = Math.floor(game.rng() * game.N);
    if (game.owner[t] === pid) return t;
  }
  return game.players[pid].king;
}

function tryNuke(game, p, d) {
  const enemies = game.players.filter((q) => q && q.alive && q.spawned && q.id !== p.id);
  if (!enemies.length) return;
  const kind = p.gold >= C.NUKES.hydrogen.cost && game.rng() < 0.4 ? 'hydrogen' : 'atom';
  if (p.gold < C.NUKES[kind].cost) return;
  const victim = enemies.reduce((a, b) => (b.tiles > a.tiles ? b : a));
  const tile = game.rng() < d.kingSnipe ? victim.king : randomTileOf(game, victim.id);
  const r = C.NUKES[kind].radius + 2;
  if (game.dist2(tile, p.king) <= r * r) return; // 내 킹까지 날리지는 않는다
  game.launchNuke(p.id, tile, kind);
}

function pickBoatTarget(game, p) {
  const cx = p.sumX / Math.max(1, p.tiles);
  const cy = p.sumY / Math.max(1, p.tiles);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < 30; i++) {
    const t = game.coastTiles[Math.floor(game.rng() * game.coastTiles.length)];
    if (t === undefined || game.owner[t] === p.id) continue;
    const d = ((t % game.W) - cx) ** 2 + (((t / game.W) | 0) - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function botThink(game, p) {
  if (!p.alive || !p.spawned || game.tick < p.bot.nextThink) return;
  const d = DIFFICULTY[game.difficulty] || DIFFICULTY.normal;
  const rng = game.rng;
  p.bot.nextThink = game.tick + d.interval + Math.floor(rng() * d.interval);

  // 체스 규칙부터: 위협받으면 캐슬링, 기회가 오면 앙파상
  const co = castleOptions(game, p.id);
  if (co.available) {
    const far = co.rooks.reduce((a, b) => (game.dist2(b.tile, p.king) > game.dist2(a.tile, p.king) ? b : a));
    game.castle(p.id, far.id);
  }
  for (const ev of enPassantOptions(game, p.id)) {
    if (ev.ok) {
      game.enPassant(p.id, ev.attackId);
      break;
    }
  }

  if (game.tick >= C.NUKE_UNLOCK_TICK && rng() < d.nukeChance) tryNuke(game, p, d);

  if (p.troops < C.maxTroops(p.tiles) * d.minTroops) return;
  const ratio = d.ratio + rng() * 0.15;
  const nb = scanNeighbors(game, p.id);

  if (nb.has(0) && (nb.size === 1 || rng() < 0.7)) {
    game.launchAttack(p.id, nb.get(0), { ratio });
    return;
  }

  const enemies = [...nb.keys()].filter((o) => o !== 0);
  if (enemies.length && rng() < 0.92) {
    const target = enemies.reduce((a, b) => (game.density(game.players[b]) < game.density(game.players[a]) ? b : a));
    const tp = game.players[target];
    let aim = nb.get(target);
    let general = null;
    if (rng() < d.generals) {
      const kingClose = game.dist2(aim, tp.king) <= 35 * 35;
      if (kingClose && rng() < 0.5) general = idle(game, p, ['knight']);
      if (!general && p.gold > 25000 && rng() < 0.15) general = idle(game, p, ['queen']);
      if (!general) general = idle(game, p, ['rook', 'pawn', 'knight'], 1000);
      if (general?.type === 'knight') aim = kingClose ? tp.king : randomTileOf(game, target);
    }
    game.launchAttack(p.id, aim, { ratio, generalId: general?.id });
    return;
  }

  if (rng() < 0.5) {
    const tile = pickBoatTarget(game, p);
    if (tile < 0) return;
    const general = rng() < d.generals ? idle(game, p, ['bishop', 'pawn'], 1000) : null;
    game.launchAttack(p.id, tile, { ratio, generalId: general?.id, forceBoat: true });
  }
}
