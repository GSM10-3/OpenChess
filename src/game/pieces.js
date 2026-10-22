// 장군(체스 기물) 정의
// land/sea: 지상 공격 · 보트 상륙에 쓸 수 있는지
// landPower/seaPower: 전투력 배율 (점령 비용을 이 값으로 나눈다)
// landSpeed/seaSpeed: 전선 확장 속도 · 배 속도 배율
// surprise: 상륙 직후 방어 병력을 무시하고 점령하는 칸 수 (기습)
// navalBattle: 근처 적 배와 해전을 벌인다
// fortress: 대기 중이면 주둔지 주변 방어 ×1.5
// breakthrough: 좁은 창끝으로 목표를 향해 돌파, 지형 · 요새 무시
// troopLoss: 출격할 때 투입 병력 중 잃는 비율

const T = '︎'; // 글리프를 이모지가 아니라 글자로 그리게 한다

export const PIECES = {
  king: {
    name: '킹',
    glyph: '♚' + T,
    value: 100,
    role: '움직일 수 없습니다. 킹이 있는 칸을 빼앗기거나 핵에 맞으면 패배합니다.',
  },
  queen: {
    name: '퀸',
    glyph: '♛' + T,
    value: 9,
    cost: 9000,
    land: true,
    sea: true,
    landPower: 3.4,
    landSpeed: 1.4,
    seaPower: 3.4,
    seaSpeed: 2.5,
    surprise: 40,
    navalBattle: true,
    fortress: true,
    troopLoss: 0.5,
    role: '비숍 + 룩. 지상 · 상륙 · 해전 · 기습 모두 가능. 대신 출격할 때마다 투입 병력 50% 손실, 비용 최대.',
  },
  rook: {
    name: '룩',
    glyph: '♜' + T,
    value: 5,
    cost: 5000,
    land: true,
    landPower: 1.5,
    landSpeed: 1.3,
    fortress: true,
    role: '육군 · 지상전. 넓은 전선을 빠르게 밀고, 대기 중이면 주변을 요새로 만듭니다. 캐슬링 상대.',
  },
  bishop: {
    name: '비숍',
    glyph: '♝' + T,
    value: 3,
    cost: 3000,
    sea: true,
    seaPower: 1.5,
    seaSpeed: 2,
    surprise: 25,
    navalBattle: true,
    role: '해군 · 상륙. 배가 2배 빠르고, 적 배와 해전을 벌이며, 상륙 직후 기습합니다.',
  },
  knight: {
    name: '나이트',
    glyph: '♞' + T,
    value: 3,
    cost: 3000,
    land: true,
    landPower: 1.8,
    landSpeed: 1,
    breakthrough: true,
    role: '전방 · 정면돌파. 클릭한 곳을 향해 좁은 창끝으로 파고들며 지형과 요새를 무시합니다.',
  },
  pawn: {
    name: '폰',
    glyph: '♟' + T,
    value: 1,
    cost: 1000,
    land: true,
    sea: true,
    landPower: 1.1,
    seaPower: 1.1,
    role: '조커픽. 육지 · 바다 어디든 출격. 다른 장군과의 전투에서 이기면 그 기물로 프로모션할 수 있습니다.',
  },
};

export const PIECE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

// 시작 배치: 킹 옆으로 체스 첫 줄, 그 위로 폰 여덟
const FILES = 'abcdefgh';
const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
export const FORMATION = [];
BACK_RANK.forEach((type, i) => {
  if (type !== 'king') FORMATION.push({ type, file: FILES[i], dx: i - 4, dy: 0 });
});
for (let i = 0; i < 8; i++) FORMATION.push({ type: 'pawn', file: FILES[i], dx: i - 4, dy: -1 });

export function pieceLabel(g) {
  return `${PIECES[g.type].name}(${g.file}${g.promoted ? '·승격' : ''})`;
}

// 한국어 조사: josa('룩(a)', '을/를') → '룩(a)을'
export function josa(word, pair) {
  if (word === '나' && pair === '이/가') return '내가';
  const [withFinal, withoutFinal] = pair.split('/');
  const base = word.replace(/\([^)]*\)$/, '');
  const code = base.charCodeAt(base.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return word + withoutFinal;
  const final = (code - 0xac00) % 28;
  if (pair === '으로/로' && final === 8) return word + withoutFinal;
  return word + (final ? withFinal : withoutFinal);
}
