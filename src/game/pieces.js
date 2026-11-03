// 기물 정의. 기물은 지도에 서지 않고 성(킹) 안에서 대기하다가, 고르면 다음 공격을 이끈다.
// land/sea: 지상 공격 · 보트 상륙에 쓸 수 있는지
// landPower/seaPower: 전투력 배율 (점령 비용을 이 값으로 나눈다)
// landSpeed/seaSpeed: 전선 확장 속도 · 배 속도 배율
// surprise: 상륙 직후 방어 병력을 무시하고 점령하는 칸 수 (기습)
// navalBattle: 근처 적 배와 해전을 벌인다
// fortress: 성에 대기 중이면 킹 주변 방어 ×1.5
// breakthrough: 좁은 창끝으로 목표를 향해 돌파, 지형 · 요새 무시
// diagonal: 클릭한 쪽 대각선으로 좁고 길게 뻗는다

const T = '︎'; // 글리프를 이모지가 아니라 글자로 그리게 한다

export const PIECES = {
  king: {
    name: '킹',
    glyph: '♚' + T,
    role: '수도. 킹을 잃으면 패배합니다.',
  },
  queen: {
    name: '퀸',
    glyph: '♛' + T,
    cost: 9000,
    land: true,
    sea: true,
    landPower: 2.6,
    landSpeed: 1.4,
    seaPower: 2.6,
    seaSpeed: 2.5,
    surprise: 40,
    navalBattle: true,
    fortress: true,
    role: '룩 + 비숍. 땅 · 바다 모두 가장 강하게 (가장 비쌈)',
  },
  rook: {
    name: '룩',
    glyph: '♜' + T,
    cost: 5000,
    land: true,
    landPower: 1.5,
    landSpeed: 1.3,
    fortress: true,
    role: '강공. 넓은 전선을 세게 밀고, 성에 있으면 킹 주변이 요새',
  },
  bishop: {
    name: '비숍',
    glyph: '♝' + T,
    cost: 3000,
    land: true,
    sea: true,
    landPower: 1.3,
    diagonal: true,
    seaPower: 1.5,
    seaSpeed: 2,
    surprise: 25,
    navalBattle: true,
    role: '대각선 돌파 · 상륙. 배가 빠르고 상륙하자마자 기습',
  },
  knight: {
    name: '나이트',
    glyph: '♞' + T,
    cost: 3000,
    land: true,
    landPower: 1.8,
    landSpeed: 1,
    breakthrough: true,
    role: '정면돌파. 클릭한 곳까지 좁게 뚫고 들어감 (킹 저격)',
  },
  pawn: {
    name: '폰',
    glyph: '♟' + T,
    cost: 1000,
    land: true,
    sea: true,
    landPower: 1.1,
    seaPower: 1.1,
    role: '싸고 어디든. 기물을 잡으면 그 기물로 프로모션',
  },
};

export const PIECE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

// 시작 기물: 체스 첫 줄 7개(킹 제외) + 폰 8개. 이름은 파일 a~h
const FILES = 'abcdefgh';
const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
export const FORMATION = [];
BACK_RANK.forEach((type, i) => {
  if (type !== 'king') FORMATION.push({ type, file: FILES[i] });
});
for (let i = 0; i < 8; i++) FORMATION.push({ type: 'pawn', file: FILES[i] });

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
