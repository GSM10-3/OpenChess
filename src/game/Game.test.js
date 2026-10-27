import { Game } from './Game';
import * as C from './constants';
import { PIECES } from './pieces';
import { castleOptions, kingThreat, enPassantOptions } from './chess';
import { generateMap } from './mapgen';

// 전부 평야인 작은 지도 (water: [x, y] 목록을 바다로)
function flatMap(width, height, water = []) {
  const terrain = new Uint8Array(width * height).fill(C.PLAINS);
  for (const [x, y] of water) terrain[y * width + x] = C.WATER;
  return { width, height, terrain };
}

function setup({ width = 60, height = 40, water = [] } = {}) {
  const game = new Game({ map: flatMap(width, height, water), bots: 0, human: false, seed: 7 });
  game.tick = C.PEACE_TICKS; // 평화 기간은 따로 시험한다
  const at = (x, y) => y * width + x;
  const add = (name, x, y) => {
    const id = game.addPlayer({ name });
    game.spawn(id, at(x, y));
    game.players[id].bot.nextThink = Infinity; // 봇 생각 끄기
    return id;
  };
  return { game, at, add };
}

const run = (game, n) => {
  for (let i = 0; i < n; i++) game.update();
};

describe('지도', () => {
  test('같은 시드면 같은 지도, 육지는 절반쯤', () => {
    const a = generateMap({ seed: 3 });
    const b = generateMap({ seed: 3 });
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.landCount / (a.width * a.height)).toBeGreaterThan(0.4);
    expect(a.landCount / (a.width * a.height)).toBeLessThan(0.55);
  });

  test('봇이 섞인 기본 판이 몇 분 동안 오류 없이 돈다', () => {
    const game = new Game({ seed: 11, bots: 6, human: false });
    run(game, 3000);
    const alive = game.players.filter((p) => p && p.alive);
    expect(alive.length).toBeGreaterThan(0);
    for (const p of alive) {
      expect(p.tiles).toBeGreaterThan(0);
      expect(game.owner[p.king]).toBe(p.id);
    }
  });
});

describe('시작 배치', () => {
  test('킹과 체스 첫 줄 · 폰 여덟이 내 땅에 선다', () => {
    const { game, add, at } = setup();
    const id = add('A', 20, 20);
    const p = game.players[id];
    expect(p.king).toBe(at(20, 20));
    expect(p.generals.map((g) => g.type).sort()).toEqual(
      ['bishop', 'bishop', 'knight', 'knight', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'queen', 'rook', 'rook'].sort()
    );
    for (const g of p.generals) expect(game.owner[g.tile]).toBe(id);
    const rookA = p.generals.find((g) => g.id === `${id}:a`);
    expect(rookA.tile).toBe(at(16, 20));
  });
});

describe('킹', () => {
  test('킹이 있는 칸을 빼앗기면 패배하고, 킹 주변 영토와 금고 절반은 잡은 나라가 갖는다', () => {
    const { game, add, at } = setup({ width: 80 });
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    add('C', 75, 35); // 한 나라만 남으면 판이 끝나므로
    // B 에게 킹에서 먼 땅도 준다
    for (let x = 50; x < 60; x++) game.setOwner(at(x, 20), b);
    game.players[a].troops = 200000;
    game.players[a].gold = 0;
    game.players[b].troops = 100;
    game.players[b].gold = 10000;
    const res = game.launchAttack(a, game.players[b].king, { ratio: 1 });
    expect(res.ok).toBe(true);
    run(game, 200);
    expect(game.players[b].alive).toBe(false);
    expect(game.players[b].deathCause).toBe('conquest');
    expect(game.players[b].tiles).toBe(0);
    expect(game.players[b].generals.every((g) => g.status === 'captured')).toBe(true);
    expect(game.owner[at(26, 24)]).toBe(a); // 킹 곁은 넘어오고
    expect(game.owner[at(55, 20)]).toBe(0); // 먼 땅은 무주지
    expect(game.players[a].gold).toBeGreaterThanOrEqual(10000 * C.HEIR_GOLD_SHARE);
    expect(game.players[a].gold).toBeLessThan(10000);
  });

  test('궁성 칸은 점령 비용이 비싸고, 나이트도 이를 무시하지 못한다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    for (const g of game.players[b].generals) game.captureGeneral(g, 0, null); // 요새 효과 빼고
    const knight = game.findGeneral(a, `${a}:b`);
    for (const general of [null, knight]) {
      const atk = game.newAttack({ attacker: a, target: b, troops: 1, general, kind: general ? 'knight' : 'land', origin: 0, frontier: new Set() });
      atk.breakthrough = !!general?.breakthrough;
      const inside = game.tileCost(atk, at(26, 23));
      const outside = game.tileCost(atk, at(26, 25));
      expect(inside).toBeCloseTo(outside * C.PALACE_MULT);
    }
  });

  test('적이 궁성에 들어오면 체크가 되고 캐슬링할 수 있다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    run(game, 1);
    expect(game.players[a].check).toBe(0);
    game.setOwner(at(17, 20), b);
    run(game, 1);
    expect(game.players[a].check).toBe(b);
    expect(kingThreat(game, a)).toEqual({ kind: 'check', by: b });
    expect(castleOptions(game, a).available).toBe(true);
    expect(game.events.some((e) => e.text.includes('체크!'))).toBe(true);
  });

  test('체크가 충분히 이어지기 전에는 킹 칸을 빼앗을 수 없다', () => {
    const { game, add } = setup({ width: 80 });
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    add('C', 75, 35);
    game.players[a].troops = 500000;
    game.players[b].troops = 0;
    game.launchAttack(a, game.players[b].king, { ratio: 1 });
    let mateTick = -1;
    for (let i = 0; i < 300 && mateTick < 0; i++) {
      game.update();
      if (!game.players[b].alive) mateTick = game.tick;
    }
    const pb = game.players[b];
    expect(pb.alive).toBe(false);
    expect(mateTick - pb.checkSince).toBeGreaterThanOrEqual(C.CHECKMATE_TICKS);
  });

  test('킹이 핵에 맞으면 패배하고, 남은 영토는 무주지가 된다', () => {
    const { game, add } = setup();
    const a = add('A', 10, 10);
    const b = add('B', 45, 25);
    game.tick = C.NUKE_UNLOCK_TICK;
    game.players[a].gold = 100000;
    expect(game.launchNuke(a, game.players[b].king, 'atom').ok).toBe(true);
    run(game, 200);
    expect(game.players[b].alive).toBe(false);
    expect(game.players[b].deathCause).toBe('nuke');
    expect(game.players[b].tiles).toBe(0);
    expect(game.players[a].tiles).toBeGreaterThan(0);
  });

  test('핵은 시작 2분 전에는 쓸 수 없다', () => {
    const { game, add } = setup();
    const a = add('A', 10, 10);
    game.players[a].gold = 100000;
    expect(game.launchNuke(a, 500, 'atom').ok).toBe(false);
  });
});

describe('장군', () => {
  test('룩 · 나이트는 바다를 못 건너고, 비숍은 배로 건넌다', () => {
    // 가운데 x=30 줄이 바다
    const water = [];
    for (let y = 0; y < 40; y++) water.push([30, y]);
    const { game, add, at } = setup({ water });
    const a = add('A', 25, 20);
    const b = add('B', 36, 20);
    game.players[a].gold = 50000;
    const rook = game.findGeneral(a, `${a}:a`);
    const res = game.launchAttack(a, at(36, 20), { ratio: 0.5, generalId: rook.id });
    expect(res.ok).toBe(false);
    expect(rook.status).toBe('idle');

    const bishop = game.findGeneral(a, `${a}:c`);
    const ok = game.launchAttack(a, at(36, 20), { ratio: 0.5, generalId: bishop.id });
    expect(ok.ok).toBe(true);
    expect(game.boats).toHaveLength(1);
    expect(game.boats[0].speed).toBe(PIECES.bishop.seaSpeed);
    void b;
  });

  test('퀸은 출격할 때 투입 병력 4분의 1을 잃고 비용이 가장 비싸다', () => {
    const { game, add, at } = setup();
    const a = add('A', 20, 20);
    const p = game.players[a];
    p.troops = 10000;
    p.gold = 20000;
    const queen = game.findGeneral(a, `${a}:d`);
    game.launchAttack(a, at(40, 20), { ratio: 0.5, generalId: queen.id });
    expect(p.gold).toBe(20000 - PIECES.queen.cost);
    expect(game.attacks[0].troops).toBe(3750);
    expect(p.troops).toBe(5000);
    const costs = ['rook', 'bishop', 'knight', 'pawn'].map((t) => PIECES[t].cost);
    expect(Math.max(...costs)).toBeLessThan(PIECES.queen.cost);
  });

  test('나이트는 클릭한 곳을 향해 좁게 파고든다', () => {
    const { game, add, at } = setup({ width: 80 });
    const a = add('A', 10, 20);
    add('B', 70, 32); // 한 나라만 남으면 판이 끝나므로
    const p = game.players[a];
    p.troops = 50000;
    p.gold = 10000;
    const knight = game.findGeneral(a, `${a}:b`);
    game.launchAttack(a, at(40, 20), { ratio: 0.5, generalId: knight.id });
    run(game, 20);
    expect(game.owner[at(30, 20)]).toBe(a);
    expect(game.owner[at(25, 5)]).toBe(0);
    expect(game.owner[at(25, 35)]).toBe(0);
  });

  test('비숍은 땅에서 클릭한 쪽 대각선으로 좁고 길게 뻗는다', () => {
    const { game, add, at } = setup({ width: 80, height: 60 });
    const a = add('A', 15, 15);
    add('B', 75, 55);
    const p = game.players[a];
    p.troops = 50000;
    p.gold = 10000;
    const bishop = game.findGeneral(a, `${a}:c`);
    expect(game.launchAttack(a, at(40, 40), { ratio: 0.5, generalId: bishop.id }).ok).toBe(true);
    expect(game.attacks[0].kind).toBe('diagonal');
    run(game, 30);
    // 남동쪽 대각선 위는 차지하고, 같은 거리의 정동 · 정남은 비어 있다
    expect(game.owner[at(30, 30)]).toBe(a);
    expect(game.owner[at(37, 15)]).toBe(0);
    expect(game.owner[at(15, 37)]).toBe(0);
  });

  test('공격이 끝나면 장군은 마지막으로 점령한 칸에 주둔하고, 그 칸을 빼앗기면 잡힌다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 40, 20);
    game.players[a].gold = 10000;
    const rook = game.findGeneral(a, `${a}:h`);
    game.players[a].troops = 1000;
    game.launchAttack(a, at(25, 20), { ratio: 1, generalId: rook.id });
    run(game, 100);
    expect(rook.status).toBe('idle');
    expect(game.owner[rook.tile]).toBe(a);
    // B 가 그 칸을 빼앗는다
    game.setOwner(rook.tile, b);
    expect(rook.status).toBe('captured');
  });
});

describe('평화 기간', () => {
  test('시작 직후에는 다른 나라를 공격할 수 없고, 무주지는 넓힐 수 있다', () => {
    const { game, add, at } = setup();
    game.tick = 0;
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.players[a].troops = 10000;
    expect(game.launchAttack(a, game.players[b].king, { ratio: 0.5 }).ok).toBe(false);
    expect(game.launchAttack(a, at(15, 30), { ratio: 0.2 }).ok).toBe(true);
    game.tick = C.PEACE_TICKS;
    expect(game.launchAttack(a, game.players[b].king, { ratio: 0.5 }).ok).toBe(true);
  });
});

describe('프로모션', () => {
  function clash() {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.players[a].gold = 10000;
    game.players[b].gold = 10000;
    game.players[a].isHuman = true;
    const knight = game.findGeneral(b, `${b}:b`);
    game.players[b].troops = 1000;
    game.launchAttack(b, at(15, 20), { ratio: 1, generalId: knight.id });
    const pawn = game.findGeneral(a, `${a}:pe`);
    game.players[a].troops = 50000;
    game.launchAttack(a, at(26, 20), { ratio: 1, generalId: pawn.id });
    return { game, a, b, pawn, knight };
  }

  test('폰이 맞공격에서 나이트를 이기면 나이트를 잡고 프로모션 제안을 받는다', () => {
    const { game, a, pawn, knight } = clash();
    expect(knight.status).toBe('captured');
    expect(game.players[a].offers).toEqual([expect.objectContaining({ generalId: pawn.id, toType: 'knight' })]);
  });

  test('프로모션은 거절할 수 있고, 받아들이면 다시 바꿀 수 없다', () => {
    const { game, a, pawn } = clash();
    expect(game.resolvePromotion(a, pawn.id, true).ok).toBe(true);
    expect(pawn.type).toBe('knight');
    expect(pawn.promoted).toBe(true);
    game.offerPromotion(pawn, 'queen');
    expect(game.players[a].offers).toHaveLength(0);
    expect(pawn.type).toBe('knight');
  });

  test('거절하면 폰으로 남는다', () => {
    const { game, a, pawn } = clash();
    game.resolvePromotion(a, pawn.id, false);
    expect(pawn.type).toBe('pawn');
    expect(pawn.promoted).toBe(false);
  });
});

describe('캐슬링', () => {
  test('위협이 없으면 못 하고, 위협받으면 룩과 자리를 바꾸며, 한 번뿐이다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    const p = game.players[a];
    expect(castleOptions(game, a).available).toBe(false);

    game.players[b].troops = 30000;
    game.launchAttack(b, at(15, 20), { ratio: 0.5 });
    expect(kingThreat(game, a)).not.toBeNull();
    const co = castleOptions(game, a);
    expect(co.available).toBe(true);
    const rook = co.rooks[0];
    const rookTile = rook.tile;
    const kingTile = p.king;
    expect(game.castle(a, rook.id).ok).toBe(true);
    expect(p.king).toBe(rookTile);
    expect(rook.tile).toBe(kingTile);
    expect(game.castle(a).ok).toBe(false);
  });

  test('날아오는 핵도 위협으로 친다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 45, 20);
    game.tick = C.NUKE_UNLOCK_TICK;
    game.players[b].gold = 100000;
    game.launchNuke(b, game.players[a].king, 'atom');
    expect(kingThreat(game, a)).toEqual({ kind: 'nuke', by: b });
  });
});

describe('앙파상', () => {
  // A 의 넓은 영토 깊숙이 B 의 나이트가 창끝으로 파고든다
  function breakthrough() {
    const { game, add, at } = setup({ width: 80, height: 50 });
    const a = add('A', 40, 25);
    const b = add('B', 70, 25);
    // A 에게 넓은 땅을 준다
    for (let y = 5; y < 45; y++) {
      for (let x = 15; x < 65; x++) if (game.owner[at(x, y)] !== b) game.setOwner(at(x, y), a);
    }
    const pa = game.players[a];
    pa.troops = 5000;
    const pawn = game.findGeneral(a, `${a}:pe`);
    game.station(pawn, at(48, 22));
    const pb = game.players[b];
    pb.troops = 200000;
    pb.gold = 10000;
    const knight = game.findGeneral(b, `${b}:g`);
    game.launchAttack(b, at(30, 25), { ratio: 1, generalId: knight.id });
    return { game, a, b, at, pawn, knight };
  }

  test('얕게 들어온 공격에는 쓸 수 없다', () => {
    const { game, a } = breakthrough();
    run(game, 2);
    const [ev] = enPassantOptions(game, a);
    expect(ev.ok).toBe(false);
  });

  test('깊이 들어온 돌파는 근처 폰으로 역포위해 되찾고 부대를 없앤다', () => {
    const { game, a, b, pawn, knight } = breakthrough();
    run(game, 12);
    const [ev] = enPassantOptions(game, a);
    expect(ev.checks.every((c) => c.ok)).toBe(true);
    const before = game.players[a].tiles;
    const res = game.enPassant(a, ev.attackId);
    expect(res.ok).toBe(true);
    expect(game.players[a].tiles).toBe(before + ev.pocket.size);
    expect(game.attacks.find((x) => x.id === ev.attackId).done).toBe(true);
    expect(knight.status).toBe('captured');
    expect(pawn.type).toBe('knight'); // 봇 폰은 바로 프로모션
    void b;
  });

  test('폰이 멀리 있으면 쓸 수 없다', () => {
    const { game, a, at, pawn } = breakthrough();
    game.station(pawn, at(16, 6));
    for (const g of game.players[a].generals) if (g.type === 'pawn' && g !== pawn) game.station(g, at(16, 44));
    run(game, 12);
    const [ev] = enPassantOptions(game, a);
    expect(ev.checks.find((c) => c.key === 'pawn').ok).toBe(false);
    expect(game.enPassant(a, ev.attackId).ok).toBe(false);
  });
});
