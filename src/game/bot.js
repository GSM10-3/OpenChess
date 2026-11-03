// 봇: 몇 초마다 한 번씩 상황을 보고 하나를 한다
import * as C from './constants';
import { PIECES } from './pieces';
import { castleOptions, enPassantOptions } from './chess';

export const BOT_NAMES = [
  '아르덴', '카스티야', '노르드', '사보이', '비잔티움', '페르시아',
  '아라곤', '브리타니아', '프로이센', '베네치아', '보헤미아', '플랑드르',
  '헝가리', '스코틀랜드', '바바리아', '피렌체',
];

// 난이도는 경제 배율(troopCap · regen · startTroops, 어려움 = 사람과 같은 기준)과 판단의 질로 나눈다
// interval: 생각 간격(틱), order: 표적을 고르는 순서, strengthCap: 내 병력의 이 배수보다 강한 나라는 치지 않는다
// runaway: 1위가 2위의 이 배수면 폭주 선두, leaderGap: 폭주 선두와 점유율 차가 이만큼이면 핵, maxAllies: 이만큼 동맹이 있는 나라와는 동맹하지 않는다
// targetHuman: 사람을 공격 대상에 넣을 확률, gangLeader: 아무도 치지 않는 선두를 혼자 먼저 칠 확률 (false 면 선두도 다른 나라와 똑같이 친다)
export const DIFFICULTY = {
  easy: {
    label: '쉬움', interval: 65, troopCap: 0.55, regen: 0.9, startTroops: 0.6,
    order: ['weakest', 'retaliate'], strengthCap: 0, runaway: 0, leaderGap: 0, maxAllies: 0,
    nukeChance: 0.01, kingSnipe: 0.1, generals: 0.35, targetHuman: 0.3, allyOffer: 0.12, gangLeader: false,
  },
  normal: {
    label: '보통', interval: 55, troopCap: 0.8, regen: 0.95, startTroops: 0.85,
    order: ['retaliate', 'victim', 'traitor', 'weakest'], strengthCap: 1.2, runaway: 3, leaderGap: 0.3, maxAllies: 3,
    nukeChance: 0.03, kingSnipe: 0.25, generals: 0.55, targetHuman: 0.75, allyOffer: 0.06, gangLeader: 0.25,
  },
  hard: {
    label: '어려움', interval: 40, troopCap: 1, regen: 1, startTroops: 1,
    order: ['retaliate', 'victim', 'traitor', 'weakest'], strengthCap: 1.2, runaway: 2, leaderGap: 0.2, maxAllies: 2,
    nukeChance: 0.05, kingSnipe: 0.4, generals: 0.75, targetHuman: 1, allyOffer: 0.03, gangLeader: false,
    instantRevenge: true, neighborCap: 0.75, minHit: 0.2,
  },
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
    const g = game.readyPiece(p.id, type);
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

// 나를 치고 있는 나라별 병력 합
function incoming(game, pid) {
  const m = new Map();
  for (const a of game.attacks) if (!a.done && a.target === pid) m.set(a.attacker, (m.get(a.attacker) || 0) + a.troops);
  return m;
}

// 땅 1위
function landLeader(game) {
  let best = null;
  for (const q of game.players) if (q && q.alive && q.spawned && (!best || q.tiles > best.tiles)) best = q;
  return best;
}

// 핵 표적: 육지 절반을 넘긴 1위 → 크게 앞서 달아나는 선두 → 지금 나를 치는 나라 순 (늘 1위만 노리지 않는다)
export function nukeVictim(game, p, d) {
  const share = (q) => q.tiles / game.landCount;
  const leader = landLeader(game);
  if (leader && leader.id !== p.id && !game.allied(p.id, leader.id)) {
    if (share(leader) >= C.NUKE_CROWN_SHARE) return leader;
    if (d.runaway && game.runawayLeader(d.runaway) === leader.id) {
      const gap = d.leaderGap * (game.neighborsOf(p.id).has(leader.id) ? 1 : 2); // 멀리 있는 선두는 더 크게 앞서야 쏜다
      if (share(leader) - share(p) > gap) return leader;
    }
  }
  let victim = null;
  let most = 0;
  for (const [id, troops] of incoming(game, p.id)) {
    const q = game.players[id];
    if (q.alive && !game.allied(p.id, id) && troops > most) {
      most = troops;
      victim = q;
    }
  }
  return victim;
}

// 킹 조준은 주로 그 나라가 체크에 걸려 있을 때
function tryNuke(game, p, d) {
  const kind = p.gold >= C.NUKES.hydrogen.cost && game.rng() < 0.4 ? 'hydrogen' : 'atom';
  if (p.gold < C.NUKES[kind].cost) return;
  const victim = nukeVictim(game, p, d);
  if (!victim) return;
  const tile = game.rng() < d.kingSnipe * (victim.check ? 1 : 0.2) ? victim.king : randomTileOf(game, victim.id);
  const r = C.NUKES[kind].radius + 2;
  if (game.dist2(tile, p.king) <= r * r) return; // 내 킹까지 날리지는 않는다
  game.launchNuke(p.id, tile, kind);
}

// 궁성 안에 들어온 적 땅 하나
function palaceIntruder(game, p) {
  const r = C.PALACE_RADIUS;
  const kx = p.king % game.W;
  const ky = (p.king / game.W) | 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = kx + dx;
      const y = ky + dy;
      if (x < 0 || y < 0 || x >= game.W || y >= game.H || dx * dx + dy * dy > r * r) continue;
      const t = y * game.W + x;
      if (game.owner[t] === p.check) return t;
    }
  }
  return -1;
}

function pickBoatTarget(game, p, neutralOnly) {
  const cx = p.sumX / Math.max(1, p.tiles);
  const cy = p.sumY / Math.max(1, p.tiles);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < 30; i++) {
    const t = game.coastTiles[Math.floor(game.rng() * game.coastTiles.length)];
    const o = game.owner[t];
    if (t === undefined || o === p.id || (neutralOnly && o) || (o && game.allied(p.id, o))) continue;
    const d = ((t % game.W) - cx) ** 2 + (((t / game.W) | 0) - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

// 표적 고르기: 난이도별 순서(order)대로 처음 후보가 나오는 규칙을 쓴다
const PICKERS = {
  retaliate: (game, p, c, hits) => c.filter((o) => hits.has(o)), // 나를 치는 나라에 맞받아친다
  victim: (game, p, c) => {
    // 킹이 체크이거나 받는 공격이 병력의 절반을 넘는 나라 (협공)
    return c.filter((o) => {
      const q = game.players[o];
      let sum = 0;
      for (const v of incoming(game, o).values()) sum += v;
      return q.check || sum > q.troops * 0.5;
    });
  },
  traitor: (game, p, c) => c.filter((o) => game.isTraitor(o)), // 배신자는 모두의 표적
  weakest: (game, p, c) => c,
};

function pickTarget(game, p, d, cands, hits) {
  for (const key of d.order) {
    const pool = PICKERS[key](game, p, cands, hits);
    if (pool.length) return pool.reduce((a, b) => (game.density(game.players[b]) < game.density(game.players[a]) ? b : a));
  }
  return 0;
}

// 다른 나라들이 이미 선두를 치고 있는지 (선두 병력의 10% 이상)
function ganged(game, leader, pid) {
  let sum = 0;
  for (const a of game.attacks) if (!a.done && a.target === leader.id && a.attacker !== pid) sum += a.troops;
  return sum >= leader.troops * 0.1;
}

export function botThink(game, p) {
  if (!p.alive || !p.spawned || game.tick < p.bot.nextThink) return;
  const d = game.botLevel();
  const rng = game.rng;
  p.bot.nextThink = game.tick + d.interval + Math.floor(rng() * d.interval * 0.5);

  // 체스 규칙부터: 위협받으면 캐슬링, 기회가 오면 앙파상
  const co = castleOptions(game, p.id);
  if (co.available) game.castle(p.id);
  for (const ev of enPassantOptions(game, p.id)) {
    if (ev.ok) {
      game.enPassant(p.id, ev.attackId);
      break;
    }
  }

  if (game.tick >= game.nukeUnlockTick && rng() < d.nukeChance) tryNuke(game, p, d);

  // 내 킹이 체크면 먼저 궁성에 들어온 적을 몰아낸다
  const inCheck = p.check && game.players[p.check]?.alive && !game.allied(p.id, p.check);
  if (inCheck) {
    const t = palaceIntruder(game, p);
    if (t >= 0 && game.touches(t, p.id)) {
      const general = idle(game, p, ['rook', 'pawn']);
      game.launchAttack(p.id, t, { ratio: 0.5, generalId: general?.id });
      return;
    }
  }
  const max = game.maxTroopsOf(p);
  const nb = scanNeighbors(game, p.id);
  const peace = game.peaceLeft() > 0;
  const hits = incoming(game, p.id);

  // 무주지는 조금만 남기고 보낸다
  if (!inCheck && nb.has(0) && (nb.size === 1 || peace || rng() < 0.7)) {
    const send = p.troops - max * p.bot.expand;
    if (send > 0) game.launchAttack(p.id, nb.get(0), { ratio: send / p.troops });
    return;
  }

  // 맞닿은 봇은 평화 기간이 끝나면 가끔 사람에게 동맹을 제안한다 (OpenFront 식 외교)
  const human = game.human;
  if (!peace && human && human.alive && nb.has(human.id) && !game.allied(p.id, human.id) && rng() < d.allyOffer) {
    if (!game.allianceRefusal(human.id, p.id) && !game.recentlyHostile(p.id, human.id)) game.offerAlliance(p.id, human.id);
  }

  const leader = landLeader(game);
  let cands = peace
    ? []
    : [...nb.keys()].filter((o) => o !== 0 && !game.allied(p.id, o) && (!game.players[o].isHuman || game.isTraitor(o) || rng() < d.targetHuman));
  if (inCheck) cands = cands.filter((o) => o === p.check);
  // 보통: 선두를 혼자 먼저 치는 일은 드물게. 나를 치는 선두에는 늘 반격하고, 다른 나라가 이미 치고 있거나 선두 킹이 체크면 함께 친다
  if (d.gangLeader && leader && !inCheck && !hits.has(leader.id) && !ganged(game, leader, p.id)) {
    const go = leader.check ? rng() < 0.5 : rng() < d.gangLeader;
    if (!go) cands = cands.filter((o) => o !== leader.id);
  }
  // 무모한 공격은 하지 않는다: 내 병력의 1.2배보다 강한 나라는 빼고 (내 궁성에 들어온 적은 예외)
  if (d.strengthCap) cands = cands.filter((o) => o === p.check || game.players[o].troops <= p.troops * d.strengthCap);

  if (cands.length) {
    const revenge = d.instantRevenge && cands.some((o) => hits.has(o)); // 어려움은 맞으면 곧바로 반격
    if (!revenge && p.troops < max * p.bot.trigger && rng() >= 0.1) return;
    const target = pickTarget(game, p, d, cands, hits);
    const tp = game.players[target];
    let send = p.troops - max * p.bot.reserve;
    if (d.neighborCap) {
      // 어려움: 보내고 나서도 가장 강한 비동맹 이웃의 75%는 남긴다
      let strongest = 0;
      for (const o of nb.keys()) if (o && !game.allied(p.id, o)) strongest = Math.max(strongest, game.players[o].troops);
      send = Math.min(send, p.troops - strongest * d.neighborCap);
      if (send < tp.troops * d.minHit) return; // 너무 약한 공격은 하지 않는다
    }
    if (send <= 0) return;
    let aim = nb.get(target);
    let general = null;
    if (rng() < d.generals) {
      const kingClose = game.dist2(aim, tp.king) <= 35 * 35;
      if (kingClose && rng() < 0.5) general = idle(game, p, ['knight', 'bishop']);
      if (!general && p.gold > 15000 && rng() < 0.25) general = idle(game, p, ['queen']);
      if (!general) general = idle(game, p, ['rook', 'pawn', 'knight'], 1000); // 비숍은 킹 가까이가 아니면 상륙에 아낀다
      if (general?.type === 'knight' || general?.type === 'bishop') aim = kingClose ? tp.king : randomTileOf(game, target);
    }
    game.launchAttack(p.id, aim, { ratio: Math.min(1, send / p.troops), generalId: general?.id });
    return;
  }

  // 맞닿은 적이 없으면 바다 건너로. 공격받는 중에는 원정을 미룬다
  if (!inCheck && !hits.size && rng() < 0.5) {
    const send = p.troops - max * (peace ? p.bot.expand : p.bot.reserve);
    if (send <= 0 || (!peace && p.troops < max * p.bot.trigger)) return;
    const tile = pickBoatTarget(game, p, peace);
    if (tile < 0) return;
    const general = rng() < d.generals ? idle(game, p, ['bishop', 'pawn'], 1000) : null;
    game.launchAttack(p.id, tile, { ratio: Math.min(1, send / p.troops), generalId: general?.id, forceBoat: true });
  }
}
