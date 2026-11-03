// 이 브라우저에서 몇 판 했는지 · 마지막 공격 비율 · 로비 설정 (신규/숙련자에 따라 안내를 줄인다)
const GAMES = 'openchess.games';
const RATIO = 'openchess.ratio';
const LOBBY = 'openchess.lobby';

export const COACH_GAMES = 20; // 이 판 수 미만이면 첫 판 안내(Coach)를 켠다
export const TIP_GAMES = 3; // 이 판 수 미만이면 패배 화면에 팁 한 줄
export const FIRST_RATIO = 0.2; // 첫 판 기본 공격 비율

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장이 막혀 있으면 이번 판만 기억한다
  }
}

export function getGamesPlayed() {
  const n = Number(read(GAMES));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function incGamesPlayed() {
  write(GAMES, String(getGamesPlayed() + 1));
}

// 첫 판은 20%, 그다음부터는 마지막으로 쓴 비율
export function getRatio() {
  const r = Number(read(RATIO));
  return r >= 0.01 && r <= 1 ? r : FIRST_RATIO;
}

export function saveRatio(r) {
  write(RATIO, String(r));
}

export function getLobby() {
  try {
    const v = JSON.parse(read(LOBBY));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function saveLobby(v) {
  write(LOBBY, JSON.stringify(v));
}

// 한 번만 보여 주는 안내 (예: 저병력 경고)
export function once(key) {
  const k = `openchess.once.${key}`;
  if (read(k) === '1') return false;
  write(k, '1');
  return true;
}
