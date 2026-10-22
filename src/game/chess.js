// 킹 위협 · 캐슬링 · 앙파상 판정. 상태는 바꾸지 않고 읽기만 한다.
import * as C from './constants';
import { pieceLabel } from './pieces';

// 킹이 위협받고 있으면 { kind, by } 를, 아니면 null
export function kingThreat(game, pid) {
  const p = game.players[pid];
  if (!p || !p.alive || p.king < 0) return null;

  for (const n of game.nukes) {
    if (n.done || n.owner === pid) continue;
    const r = C.NUKES[n.kind].radius + 2;
    if (game.dist2(n.to, p.king) <= r * r) return { kind: 'nuke', by: n.owner };
  }

  const near = C.THREAT_RADIUS;
  for (const b of game.boats) {
    if (b.done || b.owner === pid) continue;
    if (game.dist2(b.landing, p.king) <= (near + 2) * (near + 2)) return { kind: 'boat', by: b.owner };
  }

  const attackers = new Set();
  for (const a of game.attacks) {
    if (a.done || a.target !== pid) continue;
    attackers.add(a.attacker);
    if (a.kind === 'knight' && game.dist2(a.aim, p.king) <= near * near) return { kind: 'knight', by: a.attacker };
  }
  if (!attackers.size) return null;

  const { W, H, owner } = game;
  const kx = p.king % W;
  const ky = (p.king / W) | 0;
  for (let dy = -near; dy <= near; dy++) {
    const y = ky + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -near; dx <= near; dx++) {
      const x = kx + dx;
      if (x < 0 || x >= W || dx * dx + dy * dy > near * near) continue;
      const o = owner[y * W + x];
      if (attackers.has(o)) return { kind: 'army', by: o };
    }
  }
  return null;
}

// 캐슬링: 킹이 위협받을 때, 킹과 떨어져 대기 중인 룩과 자리를 바꾼다 (한 판에 한 번)
export function castleOptions(game, pid) {
  const p = game.players[pid];
  const res = { available: false, reason: '', threat: null, rooks: [] };
  if (!p || !p.alive || !p.spawned) {
    res.reason = '아직 킹이 없습니다';
    return res;
  }
  if (p.castled) {
    res.reason = '캐슬링은 한 판에 한 번만 할 수 있습니다';
    return res;
  }
  res.threat = kingThreat(game, pid);
  res.rooks = p.generals.filter(
    (g) => g.type === 'rook' && g.status === 'idle' && g.tile !== p.king && game.owner[g.tile] === pid
  );
  if (!res.threat) res.reason = '킹이 위협받을 때만 할 수 있습니다';
  else if (!res.rooks.length) res.reason = '킹과 떨어진 곳에 대기 중인 룩이 없습니다';
  else res.available = true;
  return res;
}

// 앙파상: 적 공격 하나가 최근에 우리 땅 깊숙이 파고든 '돌파 지역'을 평가한다
export function evaluatePocket(game, a) {
  const pid = a.target;
  const { owner, nbr, terrain } = game;
  const cutoff = game.tick - C.EP_WINDOW;

  const pocket = new Set();
  for (let i = a.conqTick.length - 1; i >= 0 && a.conqTick[i] >= cutoff; i--) {
    const t = a.conquered[i];
    if (owner[t] === a.attacker) pocket.add(t);
  }

  // 깊이: 적의 원래 땅(또는 상륙한 해안)에서 돌파 지역 안으로 몇 칸 들어왔나
  const dist = new Map();
  const queue = [];
  for (const t of pocket) {
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n < 0) continue;
      if (terrain[n] === C.WATER || (owner[n] === a.attacker && !pocket.has(n))) {
        dist.set(t, 0);
        queue.push(t);
        break;
      }
    }
  }
  let depth = 0;
  if (!queue.length && pocket.size) depth = Infinity; // 본진과 끊겨 이미 고립됨
  for (let h = 0; h < queue.length; h++) {
    const t = queue[h];
    const d = dist.get(t);
    if (d > depth) depth = d;
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n >= 0 && pocket.has(n) && !dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }

  // 포위율: 돌파 지역 바깥 둘레 중 우리 땅의 비율
  const ext = new Set();
  let mine = 0;
  for (const t of pocket) {
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n < 0 || terrain[n] === C.WATER || pocket.has(n) || ext.has(n)) continue;
      ext.add(n);
      if (owner[n] === pid) mine++;
    }
  }
  const encircle = ext.size ? mine / ext.size : 0;

  // 가까이 대기 중인 폰
  const p = game.players[pid];
  let pawn = null;
  let best = Infinity;
  for (const g of p.generals) {
    if (g.type !== 'pawn' || g.status !== 'idle') continue;
    for (const t of pocket) {
      const d2 = game.dist2(g.tile, t);
      if (d2 < best) {
        best = d2;
        pawn = g;
      }
    }
  }
  const pawnDist = Math.sqrt(best);
  if (pawnDist > C.EP_PAWN_RANGE) pawn = null;

  const checks = [
    {
      key: 'size',
      label: `최근 ${C.EP_WINDOW / 10}초 안에 ${C.EP_MIN_TILES}칸 이상 빼앗김`,
      ok: pocket.size >= C.EP_MIN_TILES,
      value: `${pocket.size}칸`,
    },
    {
      key: 'depth',
      label: `${C.EP_MIN_DEPTH}칸 이상 깊이 침투`,
      ok: depth >= C.EP_MIN_DEPTH,
      value: depth === Infinity ? '고립됨' : `${depth}칸`,
    },
    {
      key: 'encircle',
      label: `돌파 지역 둘레의 ${Math.round(C.EP_MIN_ENCIRCLE * 100)}% 이상이 우리 땅`,
      ok: encircle >= C.EP_MIN_ENCIRCLE,
      value: `${Math.round(encircle * 100)}%`,
    },
    {
      key: 'pawn',
      label: `${C.EP_PAWN_RANGE}칸 안에 대기 중인 폰`,
      ok: !!pawn,
      value: pawn ? `${pieceLabel(pawn)} · ${Math.round(pawnDist)}칸` : '없음',
    },
  ];
  return {
    attackId: a.id,
    attacker: a.attacker,
    pocket,
    depth,
    encircle,
    pawn,
    checks,
    ok: checks.every((c) => c.ok),
  };
}

export function enPassantOptions(game, pid) {
  const res = [];
  for (const a of game.attacks) {
    if (a.done || a.target !== pid || !a.attacker) continue;
    res.push(evaluatePocket(game, a));
  }
  return res;
}
