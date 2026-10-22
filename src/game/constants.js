// 게임 전체에서 쓰는 수치. 밸런스는 여기서만 만진다.

export const TICK_MS = 100; // 1초에 10틱

// 지형
export const WATER = 0;
export const PLAINS = 1;
export const HIGHLAND = 2;
export const MOUNTAIN = 3;
export const TERRAIN_NAMES = ['바다', '평야', '고원', '산악'];
// 지형별 점령 비용 배율
export const TERRAIN_COST = [Infinity, 1, 1.4, 1.9];

// 시작
export const SPAWN_RADIUS = 5;
export const START_TROOPS = 3000;
export const START_GOLD = 3000;

// 병력 · 금 (OpenFront 식: 최대치에 가까울수록 회복이 느려진다)
export function maxTroops(tiles) {
  return 5000 + tiles * 40;
}
export function troopRegen(troops, max) {
  if (troops >= max) return 0;
  return (5 + Math.pow(Math.max(troops, 0), 0.7) / 6) * (1 - troops / max);
}
export function goldIncome(tiles) {
  return 3 + tiles * 0.012;
}

// 지상 공격
export const NEUTRAL_TILE_COST = 5; // 무주지 한 칸
export const DEFENSE_FACTOR = 2; // 적 땅 한 칸 = (기본 + 방어 밀도 × 이 값) × 지형
export const DEFENDER_LOSS = 0.5; // 한 칸 잃을 때 방어자가 잃는 병력 (밀도 배수)
export const ATTACK_SPREAD = 0.06; // 매 틱 전선 칸 중 점령 시도 비율
export const MAX_TILES_PER_TICK = 40;
export const RETREAT_KEEP = 0.75; // 후퇴하면 남은 병력의 75% 만 돌아온다

// 바다
export const MAX_BOATS = 3;
export const LANDING_SEARCH = 30; // 클릭한 곳에서 해안을 찾는 거리
export const NAVAL_BATTLE_RANGE = 2;

// 핵
export const NUKES = {
  atom: { name: '원자폭탄', cost: 30000, radius: 6 },
  hydrogen: { name: '수소폭탄', cost: 90000, radius: 13 },
};
export const NUKE_UNLOCK_TICK = 1200; // 시작 2분 뒤부터
export const NUKE_SPEED = 1.5; // 칸/틱
export const NUKE_MIN_FLIGHT = 40; // 최소 4초 비행 → 캐슬링으로 피할 틈
export const FALLOUT_TICKS = 600;

// 장군
export const GENERAL_SPEED = 1; // 재배치 이동 속도 (칸/틱)
export const FORTRESS_RADIUS = 5; // 대기 중인 룩 · 퀸 주변은 요새
export const FORTRESS_MULT = 1.5;
export const KNIGHT_WIDTH = 3; // 나이트 창끝 폭 (칸/틱)

// 체스 규칙
export const THREAT_RADIUS = 8; // 킹 주변 이 거리 안에 공격 중인 적이 오면 '위협'
export const EP_WINDOW = 100; // 앙파상: 최근 10초 안에 빼앗긴 땅만 친다
export const EP_MIN_TILES = 30;
export const EP_MIN_DEPTH = 8;
export const EP_MIN_ENCIRCLE = 0.65;
export const EP_PAWN_RANGE = 8;

// 승리: 다른 킹을 모두 잡거나 육지의 80% 를 차지
export const WIN_LAND_SHARE = 0.8;
