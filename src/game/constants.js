// 게임 전체에서 쓰는 수치. 밸런스는 여기서만 만진다.

export const TICK_MS = 100; // 1초에 10틱

// 지도 크기 (로비에서 고른다). bots: 그 크기의 기본 봇 수, peace: 평화 기간(틱), overtime: 승리 기준이 내려가기 시작하는 틱
// minutes: 난이도별 예상 판 길이 (봇 8판 시뮬레이션 평균, 반올림)
export const MAP_SIZES = {
  small: { label: '작음', width: 200, height: 130, bots: 7, peace: 450, overtime: 7200, minutes: { easy: 8, normal: 6, hard: 7 } },
  normal: { label: '보통', width: 300, height: 190, bots: 11, peace: 600, overtime: 10800, minutes: { easy: 15, normal: 10, hard: 14 } },
  large: { label: '큼', width: 400, height: 250, bots: 15, peace: 750, overtime: 15000, minutes: { easy: 30, normal: 13, hard: 17 } },
};
export const MAX_BOTS = 15;

// 지형
export const WATER = 0;
export const PLAINS = 1;
export const HIGHLAND = 2;
export const MOUNTAIN = 3;
export const TERRAIN_NAMES = ['바다', '평야', '고원', '산악'];
// 지형별 점령 비용 배율
export const TERRAIN_COST = [Infinity, 1, 1.2, 1.5];

// 시작
export const SPAWN_RADIUS = 5;
export const NAME_EVERY = 15; // 이 틱마다 나라 이름 자리를 다시 찾는다 (지도 표시용)
export const START_TROOPS = 3000;
export const START_GOLD = 3000;

// 병력 · 금 (OpenFront 식: 상한은 기본값이 크고 영토에 따라 완만하게(^0.7) 늘고, 최대치에 가까울수록 회복이 느려진다)
export const TROOP_CAP_BASE = 3000;
export const TROOP_CAP_PER = 120;
export const REGEN_SCALE = 0.4;
export function maxTroops(tiles) {
  return 2 * (Math.pow(Math.max(tiles, 0), 0.7) * TROOP_CAP_PER + TROOP_CAP_BASE);
}
export function troopRegen(troops, max) {
  if (troops >= max) return 0;
  return (10 + Math.pow(Math.max(troops, 0), 0.73) / 4) * (1 - troops / max) * REGEN_SCALE;
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
export const RETREAT_KEEP = 0.75; // 나라를 치다 후퇴하면 남은 병력의 75% 만 돌아온다 (무주지면 전원)
export const NEUTRAL_SPEED_REF = 2000; // 무주지 확장 속도: 보낸 병력 / 이 값 배 (0.6 ~ 3)
export const SPEED_CLAMP = [0.6, 3];
export const ODDS_REF = 3; // 적 땅 비용: 방어 병력 / (보낸 병력 × 3) 배 (0.6 ~ 2, 큰 부대일수록 싸게)
export const ODDS_CLAMP = [0.6, 2];

// 바다
export const MAX_BOATS = 3;
export const LANDING_SEARCH = 30; // 클릭한 곳에서 해안을 찾는 거리
export const NAVAL_BATTLE_RANGE = 2;

// 핵
export const NUKES = {
  atom: { name: '원자폭탄', cost: 30000, radius: 6 },
  hydrogen: { name: '수소폭탄', cost: 90000, radius: 13 },
};
export const NUKE_UNLOCK_AFTER = 600; // 평화 기간이 끝나고 1분 뒤부터
export const NUKE_SPEED = 1.5; // 칸/틱
export const NUKE_MIN_FLIGHT = 40; // 최소 4초 비행 → 캐슬링으로 피할 틈
export const FALLOUT_TICKS = 600;
export const FALLOUT_COST_MULT = 3; // 낙진 칸은 점령 비용 ×3

// 기물
export const FORTRESS_RADIUS = 5; // 성에 룩 · 퀸이 대기 중이면 킹 주변은 요새
export const FORTRESS_MULT = 1.5;
export const KNIGHT_WIDTH = 3; // 나이트 창끝 폭 (칸/틱)
export const BISHOP_WIDTH = 2; // 비숍 대각선 띠: 직선에서 이만큼 벗어난 칸까지
export const BISHOP_RATE = 3; // 비숍이 한 틱에 점령하는 칸 수

// 시작 보호: 평화 기간(지도 크기별 MAP_SIZES.peace) 동안은 다른 나라를 공격할 수 없다 (무주지만)
export const SPAWN_MIN_KING_DIST = 13; // 사람은 다른 킹에서 이만큼 떨어져 시작한다 (궁성 + 시작 땅 두 개)

// 킹
export const PALACE_RADIUS = 3; // 킹 주변 궁성. 적이 들어오면 '체크'
export const PALACE_MULT = 3; // 궁성 칸 점령 비용 배율 (나이트도 무시 못 함)
export const CHECKMATE_TICKS = 80; // 체크가 8초 이어져야 킹 칸을 빼앗을 수 있다 → 캐슬링 · 반격할 틈
export const HEIR_LAND_RADIUS = 20; // 킹을 잡으면 이 반경 안의 영토만 넘어오고 나머지는 무주지
export const HEIR_GOLD_SHARE = 0.5; // 넘어오는 금고 비율

// 외교 (OpenFront 식 동맹을 단순하게)
export const ALLIANCE_TICKS = 3000; // 동맹은 5분
export const ALLIANCE_RENEW_TICKS = 300; // 만료 30초 전부터 연장할 수 있다
export const HOSTILE_MEMORY = 300; // 30초 안에 싸운 상대와는 동맹하지 않는다
export const ALLIANCE_RETRY = 300; // 거절당하면 30초 뒤에 다시 제안
export const TRAITOR_TICKS = 300; // 동맹을 깨면 30초 동안 배신자
export const TRAITOR_DEFENSE = 0.5; // 배신자 땅은 점령 비용이 절반 (방어 절반)
export const ALLY_SIZE_LIMIT = 2; // 봇은 자기보다 2배 넘게 작은 나라와는 동맹하지 않는다
export const ALLIANCE_OFFER_TICKS = 200; // 봇의 동맹 제안은 20초 동안 유효
export const NUKE_CROWN_SHARE = 0.5; // 육지의 절반을 넘긴 1위는 모든 봇의 핵 표적

// 결과 화면 기록
export const STATS_EVERY = 50; // 5초마다 영토 비율 기록

// 체스 규칙
export const THREAT_RADIUS = 8; // 킹 주변 이 거리 안에 공격 중인 적이 오면 '위협'
export const EP_WINDOW = 100; // 앙파상: 최근 10초 안에 빼앗긴 땅만 친다
export const EP_MIN_TILES = 30; // 그 사이 30칸 이상 빼앗겼고
export const EP_MIN_ENCIRCLE = 0.8; // 돌파 지역 둘레의 80% 이상이 우리 땅이면 (성에 폰이 있어야 함)
export const EP_PAWN_REST = 300; // 앙파상에 나간 폰은 30초 뒤에 성으로 돌아온다

// 승리: 다른 킹을 모두 잡거나 육지의 80% 를 차지
export const WIN_LAND_SHARE = 0.8;
// 오버타임: MAP_SIZES.overtime 이 지나면 승리 기준이 1분에 2%p 씩, 50% 까지 내려간다
export const OVERTIME_DROP = 0.02;
export const OVERTIME_MIN_SHARE = 0.5;

// 영토 정리: 한 나라에게 완전히 둘러싸인 떨어진 땅은 그 나라가 흡수한다
export const ENCLAVE_EVERY = 20;
export const ENCLAVE_LOG_TILES = 20; // 고립지가 이 칸 수 이상 넘어가면 기록에 남긴다
