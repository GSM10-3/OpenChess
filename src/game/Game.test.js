import { Game, HUMAN_COLOR, BOT_COLORS, colorDistance } from './Game';
import * as C from './constants';
import { PIECES, josa } from './pieces';
import { castleOptions, kingThreat, enPassantOptions } from './chess';
import { generateMap } from './mapgen';
import { botThink, nukeVictim, DIFFICULTY } from './bot';

// 전부 평야인 작은 지도 (water: [x, y] 목록을 바다로)
function flatMap(width, height, water = []) {
  const terrain = new Uint8Array(width * height).fill(C.PLAINS);
  for (const [x, y] of water) terrain[y * width + x] = C.WATER;
  return { width, height, terrain };
}

function setup({ width = 60, height = 40, water = [] } = {}) {
  const game = new Game({ map: flatMap(width, height, water), bots: 0, human: false, seed: 7 });
  game.tick = game.peaceTicks; // 평화 기간은 따로 시험한다
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

describe('지도 크기', () => {
  test('size 옵션대로 지도가 만들어지고, 큰 지도도 봇 판이 오류 없이 돈다', () => {
    const small = new Game({ seed: 5, bots: 2, human: false });
    expect([small.W, small.H]).toEqual([C.MAP_SIZES.small.width, C.MAP_SIZES.small.height]);
    const game = new Game({ seed: 5, bots: C.MAP_SIZES.large.bots, size: 'large', human: false });
    expect([game.W, game.H]).toEqual([C.MAP_SIZES.large.width, C.MAP_SIZES.large.height]);
    const spawned = game.players.filter((p) => p && p.spawned);
    expect(spawned).toHaveLength(C.MAP_SIZES.large.bots);
    expect(new Set(spawned.map((p) => p.color)).size).toBe(spawned.length); // 색이 겹치지 않는다
    run(game, 2000);
    for (const p of game.players.filter((q) => q && q.alive)) expect(game.owner[p.king]).toBe(p.id);
  });
});

describe('시작 배치', () => {
  test('킹과 체스 기물 15개(폰 여덟)가 성 안에서 대기한다', () => {
    const { game, add, at } = setup();
    const id = add('A', 20, 20);
    const p = game.players[id];
    expect(p.king).toBe(at(20, 20));
    expect(p.generals.map((g) => g.type).sort()).toEqual(
      ['bishop', 'bishop', 'knight', 'knight', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'queen', 'rook', 'rook'].sort()
    );
    expect(p.generals.every((g) => g.status === 'idle')).toBe(true);
    expect(game.readyPiece(id, 'knight')).not.toBeNull();
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
    for (const g of game.players[b].generals) g.status = 'captured'; // 체크 중 반격에 금을 쓰지 않게
    const res = game.launchAttack(a, game.players[b].king, { ratio: 1 });
    expect(res.ok).toBe(true);
    run(game, 200);
    expect(game.players[b].alive).toBe(false);
    expect(game.players[b].deathCause).toBe('conquest');
    expect(game.players[b].tiles).toBe(0);
    expect(game.players[b].generals.every((g) => g.status === 'captured')).toBe(true);
    expect(game.events.find((e) => e.tag === 'checkmate')).toMatchObject({ involved: [b, a] });
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
    expect(game.events.find((e) => e.tag === 'check')).toMatchObject({ involved: [a, b], data: { tile: game.players[a].king } }); // 화면 연출용 태그 · 알림을 누르면 갈 칸

    // 캐슬링을 쓴 뒤에도 새 궁성의 체크는 위협으로 보인다
    expect(game.castle(a).ok).toBe(true);
    const k = game.players[a].king;
    game.setOwner(k + 2, b);
    const co = castleOptions(game, a);
    expect(co.available).toBe(false);
    expect(co.threat).toEqual({ kind: 'check', by: b });
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
    game.tick = game.nukeUnlockTick;
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

describe('기물', () => {
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

  test('퀸은 가장 비싸고, 기물을 쓰면 금이 들고 출격 중에는 다시 고를 수 없다', () => {
    const { game, add, at } = setup();
    const a = add('A', 20, 20);
    const p = game.players[a];
    p.troops = 10000;
    p.gold = 20000;
    const queen = game.readyPiece(a, 'queen');
    game.launchAttack(a, at(40, 20), { ratio: 0.5, generalId: queen.id });
    expect(p.gold).toBe(20000 - PIECES.queen.cost);
    expect(game.attacks[0].troops).toBe(5000);
    expect(game.readyPiece(a, 'queen')).toBeNull();
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

  test('공격이 끝나면 기물은 성으로 돌아와 다시 대기하고, 성의 룩이 킹 주변을 요새로 만든다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 40, 20);
    game.players[a].gold = 10000;
    game.players[a].troops = 1000;
    const rook = game.readyPiece(a, 'rook');
    game.launchAttack(a, at(25, 20), { ratio: 1, generalId: rook.id });
    expect(rook.status).toBe('busy');
    run(game, 100);
    expect(rook.status).toBe('idle');
    expect(game.inFortress(a, at(17, 20))).toBe(true);
    expect(game.inFortress(a, at(30, 20))).toBe(false);
    for (const g of game.players[a].generals) if (g.type === 'rook' || g.type === 'queen') g.status = 'captured';
    expect(game.inFortress(a, at(17, 20))).toBe(false);
    void b;
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
    game.tick = game.peaceTicks;
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

  test('폰이 맞공격에서 나이트를 이기면 나이트를 잡고 바로 나이트로 프로모션한다', () => {
    const { game, a, pawn, knight } = clash();
    expect(knight.status).toBe('captured');
    expect(pawn.type).toBe('knight');
    expect(pawn.promoted).toBe(true);
    expect(game.events.some((e) => e.tag === 'promotion' && e.involved.includes(a))).toBe(true);
  });
  test('프로모션은 한 번뿐이다', () => {
    const { game, pawn } = clash();
    game.promote(pawn, 'queen');
    expect(pawn.type).toBe('knight');
  });

});

describe('캐슬링', () => {
  test('위협이 없으면 못 하고, 위협받으면 킹이 영토 가장 안쪽으로 피신하며, 한 번뿐이다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    const p = game.players[a];
    // A 에게 왼쪽으로 넓은 땅을 준다
    for (let y = 5; y < 36; y++) for (let x = 1; x < 18; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), a);
    expect(castleOptions(game, a).available).toBe(false);

    game.players[b].troops = 30000;
    game.launchAttack(b, at(15, 20), { ratio: 0.5 });
    expect(kingThreat(game, a)).not.toBeNull();
    expect(castleOptions(game, a).available).toBe(false); // 적이 다가오기만 해서는 못 한다
    for (let i = 0; i < 100 && !p.check; i++) game.update();
    expect(p.check).toBe(b);
    expect(castleOptions(game, a).available).toBe(true);
    const before = p.king;
    expect(game.castle(a).ok).toBe(true);
    expect(p.king).not.toBe(before);
    expect(game.owner[p.king]).toBe(a);
    expect(game.dist(p.king, game.players[b].king)).toBeGreaterThan(game.dist(before, game.players[b].king));
    expect(game.castle(a).ok).toBe(false);
  });

  test('룩이 모두 잡히면 캐슬링할 수 없다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    for (const g of game.players[a].generals) if (g.type === 'rook') g.status = 'captured';
    game.setOwner(at(17, 20), b);
    run(game, 1);
    expect(castleOptions(game, a).available).toBe(false);
  });
  test('날아오는 핵도 위협으로 친다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 45, 20);
    game.tick = game.nukeUnlockTick;
    game.players[b].gold = 100000;
    game.launchNuke(b, game.players[a].king, 'atom');
    expect(kingThreat(game, a)).toEqual({ kind: 'nuke', by: b });
  });
});

describe('앙파상', () => {
  // A 의 넓은 영토로 B 가 바다의 좁은 틈(66,25)을 지나 파고든다
  function breakthrough(knight = false) {
    const water = [];
    for (let y = 0; y < 50; y++) if (y !== 25) water.push([66, y]);
    const { game, add, at } = setup({ width: 80, height: 50, water });
    const a = add('A', 40, 25);
    const b = add('B', 71, 25);
    for (let y = 5; y < 45; y++) {
      for (let x = 15; x < 66; x++) if (game.owner[at(x, y)] !== b) game.setOwner(at(x, y), a);
    }
    game.players[a].troops = 5000;
    const pb = game.players[b];
    pb.troops = 200000;
    pb.gold = 10000;
    const general = knight ? game.readyPiece(b, 'knight') : null;
    expect(game.launchAttack(b, at(40, 25), { ratio: 1, generalId: general?.id }).ok).toBe(true);
    return { game, a, b, at, general };
  }
  // 돌파 지역이 앙파상 크기에 이를 때까지
  const dig = (game, a) => {
    for (let i = 0; i < 90; i++) {
      game.update();
      const [ev] = enPassantOptions(game, a);
      if (ev && ev.pocket.size >= C.EP_MIN_TILES) return ev;
    }
    return null;
  };

  test('얕게 들어온 공격에는 쓸 수 없다', () => {
    const { game, a } = breakthrough();
    run(game, 2);
    const [ev] = enPassantOptions(game, a);
    expect(ev.ok).toBe(false);
  });

  test('깊이 들어와 둘러싸인 돌파는 성의 폰이 출동해 되찾고 섬멸하며, 폰은 잠시 뒤 돌아온다', () => {
    const { game, a } = breakthrough();
    const ev = dig(game, a);
    expect(ev.checks.every((c) => c.ok)).toBe(true);
    const pawn = ev.pawn;
    const before = game.players[a].tiles;
    const res = game.enPassant(a, ev.attackId);
    expect(res.ok).toBe(true);
    expect(game.players[a].tiles).toBe(before + ev.pocket.size);
    expect(game.events.some((e) => e.tag === 'enpassant')).toBe(true);
    // 출동한 폰은 30초 동안 성에 없다
    expect(pawn.status).toBe('busy');
    run(game, C.EP_PAWN_REST - 1);
    expect(pawn.status).toBe('busy');
    run(game, 2);
    expect(pawn.status).toBe('idle');
  });

  test('나이트 돌파는 앙파상으로 잡을 수 없다', () => {
    const { game, a, b, at } = breakthrough(true);
    run(game, 12);
    const atk = game.attacks.find((x) => x.attacker === b);
    expect(atk.kind).toBe('knight');
    expect(enPassantOptions(game, a)).toHaveLength(0);
    expect(game.enPassant(a, atk.id).ok).toBe(false);
    void at;
  });

  test('성에 폰이 없으면 쓸 수 없다', () => {
    const { game, a } = breakthrough();
    for (const g of game.players[a].generals) if (g.type === 'pawn') g.status = 'captured';
    const ev = dig(game, a);
    expect(ev.checks.find((c) => c.key === 'pawn').ok).toBe(false);
    expect(game.enPassant(a, ev.attackId).ok).toBe(false);
  });
});

describe('외교', () => {
  test('동맹국은 공격 · 상륙 · 핵을 할 수 없고, 동맹은 시간이 지나면 끝난다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    add('C', 50, 30);
    game.players[a].troops = 20000;
    game.players[a].gold = 100000;
    expect(game.requestAlliance(a, b).ok).toBe(true);
    expect(game.allied(a, b)).toBe(true);
    expect(game.launchAttack(a, game.players[b].king, { ratio: 0.3 }).ok).toBe(false);
    expect(game.launchAttack(a, game.players[b].king, { ratio: 0.3, forceBoat: true }).ok).toBe(false);
    game.tick = game.nukeUnlockTick;
    expect(game.launchNuke(a, game.players[b].king, 'atom').ok).toBe(false);
    game.alliances.get(game.pairKey(a, b)).until = game.tick + 1;
    run(game, 2);
    expect(game.allied(a, b)).toBe(false);
    expect(game.launchAttack(a, at(26, 22), { ratio: 0.3 }).ok).toBe(true);
  });

  test('최근에 싸운 상대는 동맹을 거절하고, 동맹을 깨면 배신자가 된다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    const c = add('C', 15, 31); // A 와 국경을 맞댄다
    game.players[a].troops = 20000;
    game.launchAttack(a, game.players[b].king, { ratio: 0.1 });
    expect(game.requestAlliance(a, b).ok).toBe(false);
    expect(game.requestAlliance(a, c).ok).toBe(true);
    expect(game.breakAlliance(a, c).ok).toBe(true);
    expect(game.isTraitor(a)).toBe(true);
    expect(game.events.some((e) => e.tag === 'betray')).toBe(true);
    game.allyRetry.clear();
    expect(game.requestAlliance(a, c).ok).toBe(false); // 배신자와는 동맹하지 않는다
  });

  test('봇이 제안한 동맹을 사람이 수락할 수 있다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    add('C', 50, 30);
    game.players[a].isHuman = true;
    game.humanId = a;
    game.offerAlliance(b, a);
    expect(game.players[a].allianceOffers).toHaveLength(1);
    expect(game.resolveAllianceOffer(a, b, true).ok).toBe(true);
    expect(game.allied(a, b)).toBe(true);
  });
});


describe('기록', () => {
  test('사람의 영토 비율과 잡은 기물이 기록된다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.players[a].isHuman = true;
    game.humanId = a;
    run(game, C.STATS_EVERY * 2);
    expect(game.stats.history.length).toBeGreaterThanOrEqual(1);
    expect(game.stats.peak).toBeGreaterThan(0);
    game.captureGeneral(game.readyPiece(b, 'pawn'), a, null);
    expect(game.stats.captured).toBe(1);
  });

  test('최고 순위는 5초마다 땅 크기로 매기고, 가장 좋았던 순위를 남긴다', () => {
    const { game, add } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.players[a].isHuman = true;
    game.humanId = a;
    expect(game.stats.bestRank).toBe(0);
    game.players[a].tiles = 10;
    game.players[b].tiles = 50;
    game.tick = C.STATS_EVERY;
    game.recordStats();
    expect(game.stats.bestRank).toBe(2);
    game.players[a].tiles = 80;
    game.tick = C.STATS_EVERY * 2;
    game.recordStats();
    expect(game.stats.bestRank).toBe(1);
    game.players[a].tiles = 5; // 다시 밀려도 최고 기록은 그대로
    game.tick = C.STATS_EVERY * 3;
    game.recordStats();
    expect(game.stats.bestRank).toBe(1);
  });
});

describe('체크와 동맹 · 평화 기간', () => {
  test('동맹국 땅은 체크가 아니고, 진짜 적이 들어오면 그때부터 체크 시간을 잰다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    const e = add('E', 45, 20);
    expect(game.requestAlliance(a, b).ok).toBe(true);
    game.setOwner(at(17, 20), b);
    run(game, 100);
    const p = game.players[a];
    expect(p.check).toBe(0);
    expect(castleOptions(game, a).available).toBe(false);
    game.setOwner(at(15, 18), e);
    run(game, 1);
    expect(p.check).toBe(e);
    expect(p.checkSince).toBe(game.tick);
    expect(game.kingGuarded(a, p.king)).toBe(true);
  });

  test('평화 기간에는 체크가 걸리지 않고, 평화가 끝나야 체크 시간이 시작된다', () => {
    const { game, add, at } = setup();
    game.tick = 0;
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.setOwner(at(17, 20), b);
    run(game, 5);
    const p = game.players[a];
    expect(p.check).toBe(0);
    expect(castleOptions(game, a).available).toBe(false);
    game.tick = game.peaceTicks - 1;
    run(game, 2);
    expect(p.check).toBe(b);
    expect(p.checkSince).toBeGreaterThanOrEqual(game.peaceTicks);
    expect(game.kingGuarded(a, p.king)).toBe(true);
  });

  test('사람은 다른 킹 바로 옆에서 시작할 수 없다', () => {
    const game = new Game({ map: flatMap(60, 40), bots: 0, human: true, seed: 3 });
    const bot = game.addPlayer({ name: 'B' });
    game.spawn(bot, 20 * 60 + 20);
    const near = game.spawnHuman(20 * 60 + 27);
    expect(near.ok).toBe(false);
    expect(near.msg).toContain('너무 가깝');
    expect(game.spawnHuman(20 * 60 + 45).ok).toBe(true);
  });

  test('평화 기간은 지도 크기에 따라 다르고, 핵은 평화가 끝나고 1분 뒤부터', () => {
    for (const size of ['small', 'normal']) {
      const game = new Game({ size, bots: 0, human: false, seed: 2 });
      expect(game.peaceTicks).toBe(C.MAP_SIZES[size].peace);
      expect(game.nukeUnlockTick).toBe(game.peaceTicks + C.NUKE_UNLOCK_AFTER);
    }
    expect(C.MAP_SIZES.small.peace).toBeLessThan(C.MAP_SIZES.normal.peace);
    expect(C.MAP_SIZES.normal.peace).toBeLessThan(C.MAP_SIZES.large.peace);
  });
});

describe('해전', () => {
  const boat = (game, owner, tile, troops, general, extra = {}) => {
    const b = { id: game.nextId++, owner, troops, general, power: 1, speed: 1, naval: false, path: new Array(20).fill(tile), pos: 0, tile, landing: tile, done: false, ...extra };
    if (general) general.status = 'busy';
    game.boats.push(b);
    return b;
  };
  function sea() {
    const water = [];
    for (let y = 0; y < 40; y++) for (let x = 25; x < 35; x++) water.push([x, y]);
    const { game, add, at } = setup({ water });
    const a = add('A', 10, 20);
    const b = add('B', 50, 20);
    return { game, a, b, at };
  }

  test('비숍 배가 가까운 적 배를 이기면 침몰시키고, 그 배의 기물을 잡는다', () => {
    const { game, a, b, at } = sea();
    const bishop = game.readyPiece(a, 'bishop');
    const pawn = game.readyPiece(b, 'pawn');
    const mine = boat(game, a, at(30, 20), 1000, bishop, { power: 1.5, naval: true });
    const theirs = boat(game, b, at(31, 20), 500, pawn, { power: 1.1 });
    game.stepBoats();
    expect(theirs.done).toBe(true);
    expect(pawn.status).toBe('captured');
    expect(mine.done).toBe(false);
    expect(mine.troops).toBeCloseTo((1500 - 550) / 1.5);
    expect(game.recentlyHostile(a, b)).toBe(true);
  });

  test('동맹국 배, 평화 기간의 배와는 해전을 하지 않는다', () => {
    for (const mode of ['ally', 'peace']) {
      const { game, a, b, at } = sea();
      if (mode === 'ally') game.formAlliance(a, b);
      else game.tick = 10;
      boat(game, a, at(30, 20), 1000, game.readyPiece(a, 'bishop'), { power: 1.5, naval: true });
      const theirs = boat(game, b, at(31, 20), 500, game.readyPiece(b, 'pawn'));
      game.stepBoats();
      expect(theirs.done).toBe(false);
    }
  });

  test('다른 섬의 무주지를 클릭하면 배가 뜬다', () => {
    const { game, a, at } = sea();
    for (let x = 10; x < 25; x++) game.setOwner(at(x, 20), a); // 해안까지
    game.players[a].troops = 10000;
    expect(game.launchAttack(a, at(40, 5), { ratio: 0.3 }).ok).toBe(true);
    expect(game.boats).toHaveLength(1);
    expect(game.attacks).toHaveLength(0);
    // 같은 섬의 무주지는 지상으로
    expect(game.launchAttack(a, at(10, 35), { ratio: 0.3 }).ok).toBe(true);
    expect(game.attacks).toHaveLength(1);
  });
});

describe('핵과 동맹', () => {
  function nukeSetup() {
    const { game, add, at } = setup();
    const a = add('A', 10, 20);
    const b = add('B', 40, 20);
    game.tick = game.nukeUnlockTick;
    game.players[a].gold = 500000;
    game.players[b].gold = 500000;
    return { game, a, b, at };
  }

  test('내 킹이나 동맹국이 휩쓸리는 곳에는 쏠 수 없다', () => {
    const { game, a, b, at } = nukeSetup();
    const self = game.launchNuke(a, at(17, 20), 'atom');
    expect(self.ok).toBe(false);
    expect(self.msg).toContain('내 킹');
    game.formAlliance(a, b);
    expect(game.launchNuke(a, at(50, 20), 'hydrogen').ok).toBe(false); // 무주지지만 동맹 땅이 반경 안
    expect(game.launchNuke(a, at(56, 20), 'atom').ok).toBe(true);
  });

  test('동맹을 맺으면 서로를 노리던 핵은 떨어지지 않고, 최근에 싸운 나라의 동맹 제안은 받을 수 없다', () => {
    const { game, a, b } = nukeSetup();
    expect(game.launchNuke(a, game.players[b].king, 'atom').ok).toBe(true);
    game.players[a].isHuman = true;
    game.humanId = a;
    game.offerAlliance(b, a);
    expect(game.resolveAllianceOffer(a, b, true).ok).toBe(false);
    game.formAlliance(a, b);
    run(game, 200);
    expect(game.players[b].alive).toBe(true);
  });

  test('내 땅에는 쏠 수 없고, 핵 알림에는 착탄 지점과 핵 id 가 붙는다', () => {
    const { game, a, b, at } = nukeSetup();
    const mine = at(10, 25);
    expect(game.owner[mine]).toBe(a);
    const res = game.launchNuke(a, mine, 'atom');
    expect(res.ok).toBe(false);
    expect(res.msg).toContain('내 땅');
    expect(game.players[a].gold).toBe(500000);
    const target = game.players[b].king;
    expect(game.launchNuke(a, target, 'atom').ok).toBe(true);
    const ev = game.events.find((e) => e.tag === 'nuke');
    expect(ev.data).toEqual({ tile: target, nukeId: game.nukes[0].id });
    run(game, game.nukes[0].impactTick - game.tick);
    expect(game.nukes).toHaveLength(0); // 착탄하면 목록에서 사라진다 (알림도 지운다)
    expect(game.events.find((e) => e.tag === 'checkmate').data).toMatchObject({ nuke: true, tile: target });
  });

  test('자폭 · 동맹국 탈락은 사람의 체크메이트 기록에 들어가지 않는다', () => {
    const { game, a, b } = nukeSetup();
    game.players[a].isHuman = true;
    game.humanId = a;
    game.formAlliance(a, b);
    game.eliminate(b, a, 'nuke');
    expect(game.stats.mates).toBe(0);
  });
});

describe('캐슬링 피신처', () => {
  test('핵이 킹을 노리면 폭발 범위 밖으로 피하고, 피할 곳이 없으면 캐슬링을 쓰지 않는다', () => {
    const { game, add, at } = setup();
    const a = add('A', 12, 20);
    const b = add('B', 52, 20);
    for (let y = 2; y < 38; y++) for (let x = 2; x < 44; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), a);
    game.tick = game.nukeUnlockTick;
    game.players[b].gold = 500000;
    const p = game.players[a];
    expect(game.launchNuke(b, p.king, 'hydrogen').ok).toBe(true);
    const target = game.nukes[0].to;
    expect(game.castle(a).ok).toBe(true);
    expect(game.dist(p.king, target)).toBeGreaterThan(C.NUKES.hydrogen.radius + 2);

    const s2 = setup();
    const c = s2.add('C', 12, 20);
    const d = s2.add('D', 52, 20);
    s2.game.tick = s2.game.nukeUnlockTick;
    s2.game.players[d].gold = 500000;
    s2.game.launchNuke(d, s2.game.players[c].king, 'hydrogen');
    const res = s2.game.castle(c);
    expect(res.ok).toBe(false);
    expect(res.msg).toContain('핵을 피할 곳');
    expect(s2.game.players[c].castled).toBe(false);
  });

  test('좁은 땅에서는 깊이가 같으면 적 땅에서 가장 먼 칸으로 피신한다', () => {
    const { game, add, at } = setup();
    const a = add('A', 30, 20);
    for (let t = 0; t < game.N; t++) if (game.owner[t] === a && t !== at(30, 20)) game.setOwner(t, 0);
    for (let x = 10; x <= 50; x++) for (const y of [20, 21]) game.setOwner(at(x, y), a);
    const c = add('C', 30, 10);
    game.setOwner(at(30, 16), c);
    game.setOwner(at(30, 17), c);
    game.setOwner(at(30, 18), c);
    game.setOwner(at(30, 19), c);
    const e = add('E', 7, 14);
    run(game, 1);
    expect(game.players[a].check).toBe(c);
    expect(game.castle(a).ok).toBe(true);
    expect(game.players[a].king % game.W).toBeGreaterThan(45);
    run(game, 1);
    expect(game.players[a].check).toBe(0);
    void e;
  });
});

describe('후퇴', () => {
  test('나라를 치다 후퇴하면 75%만, 무주지 확장은 전원 돌아오고 기물은 성으로 온다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    const p = game.players[a];
    p.troops = 10000;
    p.gold = 10000;
    const rook = game.readyPiece(a, 'rook');
    expect(game.launchAttack(a, at(26, 20), { ratio: 0.5, generalId: rook.id }).ok).toBe(true);
    const atk = game.attacks[0];
    const before = p.troops;
    const sent = atk.troops;
    const res = game.retreat(a, atk.id);
    expect(res.ok).toBe(true);
    expect(res.msg).toContain('손실');
    expect(atk.done).toBe(true);
    expect(p.troops).toBeCloseTo(before + sent * C.RETREAT_KEEP);
    expect(rook.status).toBe('idle');

    expect(game.launchAttack(a, at(15, 32), { ratio: 0.5 }).ok).toBe(true);
    const free = game.attacks.find((x) => !x.done && x.target === 0);
    const before2 = p.troops;
    const sent2 = free.troops;
    game.retreat(a, free.id);
    expect(p.troops).toBeCloseTo(before2 + sent2);
    expect(game.retreat(a, free.id).ok).toBe(false);
    void b;
  });

  test('바쁜 기물로는 출격할 수 없고, 문구에 기물 이름이 나온다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const rook = game.readyPiece(a, 'rook');
    rook.status = 'busy';
    const res = game.launchAttack(a, at(15, 32), { ratio: 0.3, generalId: rook.id });
    expect(res.ok).toBe(false);
    expect(res.msg).toBe('룩(a)은 지금 출격할 수 없습니다');
  });
});

describe('병력 크기 · 지형 · 낙진', () => {
  test('무주지는 많이 보낼수록 빨리 번진다', () => {
    const grown = (troops) => {
      const { game, add, at } = setup();
      const a = add('A', 30, 20);
      game.players[a].troops = troops;
      game.launchAttack(a, at(30, 30), { ratio: 1 });
      const t0 = game.players[a].tiles;
      run(game, 10);
      return game.players[a].tiles - t0;
    };
    expect(grown(20000)).toBeGreaterThan(grown(800) * 2);
  });

  test('적 땅은 큰 부대일수록 싸게, 낙진 칸은 비싸게 점령한다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 26, 20);
    game.players[b].troops = 10000;
    const atk = (troops) => game.newAttack({ attacker: a, target: b, troops, general: null, kind: 'land', origin: 0, frontier: new Set() });
    const t = at(26, 25);
    expect(game.tileCost(atk(100000), t)).toBeLessThan(game.tileCost(atk(1000), t));
    const plain = game.tileCost(atk(5000), t);
    game.fallout[t] = game.tick + 10;
    expect(game.tileCost(atk(5000), t)).toBeCloseTo(plain * C.FALLOUT_COST_MULT);
  });

  test('병력 상한은 영토에 따라 완만하게 늘고, 산악은 평야의 1.5배', () => {
    expect(C.maxTroops(0)).toBeGreaterThan(5000);
    expect(C.maxTroops(10000) / C.maxTroops(1000)).toBeLessThan(10 ** 0.7 + 0.01);
    expect(C.TERRAIN_COST[C.MOUNTAIN]).toBe(1.5);
  });
});

describe('영토 정리', () => {
  test('한 나라에 완전히 둘러싸인 떨어진 땅은 그 나라가 흡수하고, 무주지와 닿은 땅 · 진행 중인 거점은 그대로 둔다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 45, 20);
    for (let y = 2; y < 38; y++) for (let x = 2; x < 28; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), a);
    game.setOwner(at(8, 8), b);
    game.setOwner(at(9, 8), b);
    game.setOwner(at(27, 30), b); // 오른쪽은 무주지
    game.setOwner(at(8, 30), b); // B 가 상륙해 싸우는 중인 거점
    game.players[b].troops = 200000;
    const landing = game.newAttack({ attacker: b, target: a, troops: 100000, general: null, kind: 'landing', origin: at(8, 30), frontier: new Set([at(8, 31)]), landing: true });
    landing.lastTile = at(8, 30);
    game.attacks.push(landing);
    const troops = game.players[b].troops;
    run(game, C.ENCLAVE_EVERY);
    expect(game.owner[at(8, 8)]).toBe(a);
    expect(game.owner[at(9, 8)]).toBe(a);
    expect(game.owner[at(27, 30)]).toBe(b);
    expect(game.owner[at(8, 30)]).toBe(b);
    expect(game.players[b].troops).toBeLessThan(troops + 1);
  });

  test('공격이 끝난 상륙 거점(바다와 닿은 땅)은 적에게 둘러싸여도 그대로 남는다', () => {
    const water = [];
    for (let y = 0; y < 40; y++) for (let x = 27; x < 34; x++) water.push([x, y]);
    const { game, add, at } = setup({ water });
    const a = add('A', 10, 20);
    const b = add('B', 45, 20);
    for (let y = 0; y < 40; y++) for (let x = 34; x < 60; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), b);
    // A 가 B 섬 해안에 올라 땅을 얻었고, 공격은 이미 끝났다
    for (let y = 4; y < 10; y++) for (let x = 34; x < 38; x++) game.setOwner(at(x, y), a);
    const troops = game.players[a].troops;
    run(game, C.ENCLAVE_EVERY * 2);
    expect(game.owner[at(34, 5)]).toBe(a);
    expect(game.owner[at(37, 9)]).toBe(a);
    expect(game.players[a].troops).toBeGreaterThanOrEqual(troops);
  });

  test('동맹국 땅에 둘러싸였거나 평화 기간이면 흡수하지 않는다', () => {
    const { game, add, at } = setup();
    const a = add('A', 15, 20);
    const b = add('B', 45, 20);
    for (let y = 2; y < 38; y++) for (let x = 2; x < 28; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), a);
    game.setOwner(at(8, 8), b);
    game.formAlliance(a, b);
    run(game, C.ENCLAVE_EVERY);
    expect(game.owner[at(8, 8)]).toBe(b);
  });
});

describe('승리', () => {
  function three() {
    const { game, add, at } = setup();
    const a = add('A', 10, 10);
    const b = add('B', 50, 10);
    const c = add('C', 50, 30);
    game.players[a].isHuman = true;
    game.humanId = a;
    return { game, a, b, c, at };
  }
  const grab = (game, pid, share) => {
    for (let t = 0; t < game.N && game.players[pid].tiles < game.landCount * share; t++) {
      if (!game.owner[t] && game.isLand(t)) game.setOwner(t, pid);
    }
  };

  test('육지의 80%를 차지하면 이기고, 끝난 틱이 기록된다', () => {
    const { game, a } = three();
    grab(game, a, C.WIN_LAND_SHARE);
    run(game, 1);
    expect(game.phase).toBe('over');
    expect(game.result).toBe('win');
    expect(game.winner).toBe(a);
    expect(game.stats.endTick).toBe(game.tick);
  });

  test('다른 킹을 모두 잡으면 이긴다', () => {
    const { game, a, b, c } = three();
    game.eliminate(b, a, 'conquest');
    run(game, 1);
    expect(game.phase).toBe('play');
    game.eliminate(c, a, 'conquest');
    run(game, 1);
    expect(game.result).toBe('win');
  });

  test('다른 나라가 먼저 승리 기준을 넘으면 진다', () => {
    const { game, b } = three();
    grab(game, b, C.WIN_LAND_SHARE);
    run(game, 1);
    expect(game.result).toBe('lose');
    expect(game.winner).toBe(b);
    expect(game.human.alive).toBe(true);
  });

  test('사람 없는 판도 한 나라만 남거나 승리 기준을 넘으면 끝난다', () => {
    const { game, add } = setup();
    const a = add('A', 10, 10);
    add('B', 50, 30);
    run(game, 1);
    expect(game.phase).toBe('play');
    grab(game, a, C.WIN_LAND_SHARE);
    run(game, 1);
    expect(game.phase).toBe('over');
    expect(game.winner).toBe(a);
  });

  test('오버타임에는 승리 기준이 1분에 2%p씩, 50%까지 내려간다', () => {
    const { game, a } = three();
    expect(game.winShare()).toBe(C.WIN_LAND_SHARE);
    game.tick = game.overtimeTick + 1;
    expect(game.winShare()).toBeCloseTo(C.WIN_LAND_SHARE - C.OVERTIME_DROP);
    game.tick = game.overtimeTick + 600 * 5;
    expect(game.winShare()).toBeCloseTo(0.7);
    game.tick = game.overtimeTick + 600 * 60;
    expect(game.winShare()).toBe(C.OVERTIME_MIN_SHARE);
    grab(game, a, 0.51);
    run(game, 1);
    expect(game.result).toBe('win');
  });
});

describe('외교 문구', () => {
  test('상대가 2배 넘게 크면 "우리가 너무 작다며" 거절한다', () => {
    const { game, add, at } = setup();
    const a = add('A', 10, 10);
    const b = add('B', 40, 25);
    for (let y = 5; y < 38; y++) for (let x = 16; x < 58; x++) if (!game.owner[at(x, y)]) game.setOwner(at(x, y), b);
    const res = game.requestAlliance(a, b);
    expect(res.ok).toBe(false);
    expect(res.msg).toBe('B가 우리가 너무 작다며 거절했습니다');
  });
});

// 세 나라가 지도를 나눠 가진 판: 왼쪽 B, 가운데 A, 오른쪽 C (무주지 없음)
function strip(difficulty = 'normal') {
  const game = new Game({ map: flatMap(42, 12), bots: 0, human: false, seed: 7, difficulty });
  game.tick = game.peaceTicks;
  const at = (x, y) => y * 42 + x;
  const ids = [['B', 6], ['A', 20], ['C', 35]].map(([name, x]) => {
    const id = game.addPlayer({ name });
    game.spawn(id, at(x, 6));
    game.players[id].bot.nextThink = Infinity;
    return id;
  });
  for (let y = 0; y < 12; y++) for (let x = 0; x < 42; x++) game.setOwner(at(x, y), x < 14 ? ids[0] : x < 28 ? ids[1] : ids[2]);
  return { game, at, b: ids[0], a: ids[1], c: ids[2] };
}

describe('외교 규칙', () => {
  test('배신하면 30초 동안 배신자이고, 그 땅은 점령 비용이 절반이다', () => {
    const { game, a, b, c, at } = strip();
    game.formAlliance(a, b);
    game.players[c].troops = 20000;
    expect(game.launchAttack(c, at(27, 6), { ratio: 0.2 }).ok).toBe(true);
    const atk = game.attacks[0];
    const before = game.tileCost(atk, at(26, 6));
    expect(game.breakAlliance(a, b).msg).toContain('30초');
    expect(C.TRAITOR_TICKS).toBe(300);
    expect(game.tileCost(atk, at(26, 6))).toBeCloseTo(before * C.TRAITOR_DEFENSE);
    expect(game.events.some((e) => e.tag === 'betray')).toBe(true);
    // 배신 소문: 맞닿은 봇 C 도 A 의 동맹을 받지 않는다
    game.tick += C.TRAITOR_TICKS + 10;
    expect(game.isTraitor(a)).toBe(false);
    expect(game.allianceRefusal(a, c)).toContain('최근에 싸운');
  });

  test('배신자와의 동맹을 끊는 것은 벌칙이 없다', () => {
    const { game, a, b } = strip();
    game.formAlliance(a, b);
    game.players[b].traitorUntil = game.tick + 100;
    const res = game.breakAlliance(a, b);
    expect(res.ok).toBe(true);
    expect(res.msg).toContain('벌칙 없음');
    expect(game.isTraitor(a)).toBe(false);
    expect(game.events.some((e) => e.tag === 'betray')).toBe(false);
  });

  test('국경을 맞댄 나라와만 동맹할 수 있다', () => {
    const { game, b, c } = strip();
    const res = game.requestAlliance(b, c);
    expect(res.ok).toBe(false);
    expect(res.msg).toContain('국경을 맞댄');
  });

  test('봇은 폭주 선두와 동맹이 많은 나라를 거절하고, 연장도 다시 따져 본다', () => {
    const { game, a, b, c, at } = strip();
    expect(game.runawayLeader(3)).toBe(0);
    const kings = [game.players[b].king, game.players[c].king];
    for (let y = 0; y < 12; y++) for (let x = 3; x < 42; x++) if (!kings.includes(at(x, y))) game.setOwner(at(x, y), a); // A 가 거의 다 차지
    expect(game.runawayLeader(3)).toBe(a);
    expect(game.runawayLeader(0)).toBe(0);
    expect(game.allianceRefusal(a, b)).toContain('너무 강한 나라');
    expect(new Game({ map: flatMap(10, 10), bots: 0, human: false, difficulty: 'easy' }).botLevel().runaway).toBe(0);
    // 동맹 연장: 만료 30초 전부터, 봇이 거절할 이유가 있으면 실패
    game.formAlliance(a, b);
    game.alliances.get(game.pairKey(a, b)).until = game.tick + 10;
    expect(game.renewAlliance(a, b).ok).toBe(false);
    for (let y = 0; y < 12; y++) for (let x = 3; x < 20; x++) game.setOwner(at(x, y), b);
    expect(game.renewAlliance(a, b).ok).toBe(true);
    expect(game.allianceLeft(a, b)).toBe(C.ALLIANCE_TICKS);
    // 동맹 수 제한 (보통 3)
    expect(game.allyCount(a)).toBe(1);
    for (let i = 0; i < 3; i++) game.formAlliance(a, game.addPlayer({ name: `X${i}` }));
    expect(game.allianceRefusal(a, c)).toContain('동맹이 많다');
  });
});

describe('봇 난이도 · 판단', () => {
  test('봇의 병력 상한 · 시작 병력은 난이도에 따라 줄고, 사람은 그대로', () => {
    for (const k of ['easy', 'normal', 'hard']) {
      const game = new Game({ map: flatMap(40, 30), bots: 0, human: false, seed: 3, difficulty: k });
      const id = game.addPlayer({ name: 'B' });
      game.spawn(id, 20 * 40 + 20);
      const p = game.players[id];
      expect(p.troops).toBeCloseTo(C.START_TROOPS * DIFFICULTY[k].startTroops);
      expect(game.maxTroopsOf(p)).toBeCloseTo(C.maxTroops(p.tiles) * DIFFICULTY[k].troopCap);
      p.isHuman = true;
      expect(game.maxTroopsOf(p)).toBeCloseTo(C.maxTroops(p.tiles));
    }
    expect(DIFFICULTY.hard.troopCap).toBe(1);
  });

  test('봇마다 성격(trigger · reserve · expand)이 정해진 범위에서 한 번 뽑힌다', () => {
    const { game, a, b } = strip();
    const pa = game.players[a].bot;
    expect(pa.trigger).toBeGreaterThanOrEqual(0.5);
    expect(pa.trigger).toBeLessThan(0.6);
    expect(pa.reserve).toBeGreaterThanOrEqual(0.3);
    expect(pa.expand).toBeLessThan(0.2);
    expect(game.players[b].bot.trigger).not.toBe(pa.trigger);
    expect(strip().game.players[a].bot.trigger).toBe(pa.trigger); // 같은 시드면 같은 성격
  });

  test('공격받으면 더 약한 이웃이 있어도 맞받아친다', () => {
    const { game, a, b, c, at } = strip();
    const pa = game.players[a];
    game.players[b].troops = 20000;
    game.players[c].troops = 500; // 가장 약한 나라
    expect(game.launchAttack(b, at(14, 6), { ratio: 0.1 }).ok).toBe(true);
    game.players[b].troops = 5000; // 내 병력의 1.2배를 넘지 않게
    game.setOwner(at(13, 0), a); // 땅 1위는 A (보통 봇은 선두를 혼자 치지 않는다)
    pa.troops = game.maxTroopsOf(pa);
    pa.bot.nextThink = 0;
    botThink(game, pa);
    const mine = game.attacks.filter((x) => x.attacker === a);
    expect(mine).toHaveLength(1);
    expect(mine[0].target).toBe(b);
  });

  test('땅 1위가 나를 치면 보통 봇도 1위에게 맞받아친다', () => {
    const { game, a, b, c, at } = strip();
    const pa = game.players[a];
    game.setOwner(at(14, 0), b); // 땅 1위는 B
    game.botLevel = () => ({ ...DIFFICULTY.normal, gangLeader: 1e-9 }); // 선두를 혼자 먼저 치는 우연은 빼고
    game.players[b].troops = 20000;
    game.players[c].troops = 500; // 가장 약한 나라
    expect(game.launchAttack(b, at(14, 6), { ratio: 0.1 }).ok).toBe(true);
    game.players[b].troops = 5000;
    pa.troops = game.maxTroopsOf(pa);
    pa.bot.nextThink = 0;
    botThink(game, pa);
    const mine = game.attacks.filter((x) => x.attacker === a);
    expect(mine).toHaveLength(1);
    expect(mine[0].target).toBe(b);
  });

  test('병력이 트리거에 못 미치거나 상대가 훨씬 강하면 치지 않는다', () => {
    const { game, a, b, c } = strip();
    const pa = game.players[a];
    game.players[b].troops = 1e6;
    game.players[c].troops = 1e6;
    pa.troops = game.maxTroopsOf(pa);
    for (let i = 0; i < 20; i++) {
      pa.bot.nextThink = 0;
      botThink(game, pa);
    }
    expect(game.attacks.filter((x) => x.attacker === a)).toHaveLength(0);
  });

  test('핵 표적: 육지 절반을 넘긴 1위 → 달아나는 선두 → 나를 치는 나라', () => {
    const { game, a, b, c, at } = strip();
    const d = DIFFICULTY.normal;
    expect(nukeVictim(game, game.players[c], d)).toBe(null); // 비슷한 셋: 쏠 이유가 없다
    game.players[b].troops = 20000;
    game.launchAttack(b, at(14, 6), { ratio: 0.1 });
    expect(nukeVictim(game, game.players[a], d).id).toBe(b);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 28; x++) if (game.players[b].king !== at(x, y)) game.setOwner(at(x, y), a);
    expect(nukeVictim(game, game.players[c], d).id).toBe(a);
  });
});

describe('조사', () => {
  test.each([
    ['룩(a)', '이/가', '룩(a)이'],
    ['나이트(b)', '으로/로', '나이트(b)로'],
    ['퀸', '으로/로', '퀸으로'],
    ['서울', '으로/로', '서울로'],
    ['나', '이/가', '내가'],
    ['비숍', '을/를', '비숍을'],
    ['아르덴', '과/와', '아르덴과'],
    ['Bot1', '이/가', 'Bot1가'],
    ['폰(c·승격)', '은/는', '폰(c·승격)은'],
  ])('josa(%s, %s) → %s', (word, pair, want) => {
    expect(josa(word, pair)).toBe(want);
  });
});

describe('지도 표시', () => {
  test('나라 이름은 영토 안 가장 큰 직사각형 가운데에 놓인다 (C자 영토의 무게중심이 아니라)', () => {
    const { game, at, add } = setup();
    const id = add('가', 30, 20);
    // C자 영토: 위 · 아래 막대(굵게)와 왼쪽 기둥, 가운데는 남의 땅
    const other = add('나', 50, 35);
    game.players[id].king = at(6, 6); // 킹은 왼쪽 기둥으로 옮겨 둔다
    for (let y = 5; y <= 30; y++) for (let x = 5; x <= 40; x++) game.setOwner(at(x, y), other);
    for (let x = 5; x <= 40; x++) for (let y = 5; y <= 12; y++) game.setOwner(at(x, y), id);
    for (let x = 5; x <= 40; x++) for (let y = 23; y <= 30; y++) game.setOwner(at(x, y), id);
    for (let y = 5; y <= 30; y++) for (let x = 5; x <= 8; x++) game.setOwner(at(x, y), id);
    game.placeNames();
    const p = game.players[id];
    expect(p.labelW).toBeGreaterThanOrEqual(30);
    expect(p.labelH).toBeGreaterThanOrEqual(7);
    expect(game.owner[at(Math.round(p.labelX), Math.round(p.labelY))]).toBe(id);
    // 무게중심은 남의 땅 위
    expect(game.owner[at(Math.round(p.sumX / p.tiles), Math.round(p.sumY / p.tiles))]).not.toBe(id);
  });

  test('이름 자리는 판이 진행되며 저절로 갱신된다', () => {
    const { game, at, add } = setup();
    const id = add('가', 30, 20);
    add('나', 5, 5); // 혼자 남으면 판이 끝나므로
    const before = game.players[id].labelW;
    expect(before).toBeGreaterThan(0);
    for (let x = 10; x <= 50; x++) for (let y = 15; y <= 25; y++) game.setOwner(at(x, y), id);
    run(game, C.NAME_EVERY);
    expect(game.players[id].labelW).toBeGreaterThan(before);
  });

  test('사람은 고정 파랑, 봇은 노랑 · 빨강이 아니고 서로 먼 색부터 받는다', () => {
    const game = new Game({ seed: 4, bots: C.MAX_BOTS, size: 'large', human: true });
    const [human, ...bots] = game.players.filter(Boolean);
    expect(human.color).toBe(HUMAN_COLOR);
    expect(new Set(bots.map((p) => p.color)).size).toBe(bots.length);
    for (const p of bots) {
      expect(BOT_COLORS).toContain(p.color);
      for (const ui of ['#eab308', '#facc15', '#ef4444', '#f43f5e', '#000000']) expect(colorDistance(p.color, ui)).toBeGreaterThan(25);
    }
    // 처음 몇 나라는 서로 아주 멀다 (탐욕 배정)
    const first = [human, ...bots.slice(0, 5)].map((p) => p.color);
    for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) expect(colorDistance(first[i], first[j])).toBeGreaterThan(30);
  });
});
