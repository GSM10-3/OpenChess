import { useRef } from 'react';
import { PIECES, josa } from '../game/pieces';
import * as C from '../game/constants';
import { play } from './sound';

const SHOW_MS = 2200;
const STALE_TICKS = 30; // 이보다 오래 기다린 연출은 늦었으니 버린다 (배속을 올려도 제때 뜨게)
const MAX_QUEUE = 3;
const REPEAT_TICKS = 150; // 같은 상대 · 같은 종류 · 같은 방향(당함/걺)의 연출이 15초 안에 또 오면 소리만
// 연출 종류별 기본 효과음
const BANNER_SOUND = { check: 'check', castle: 'castle', promotion: 'promotion', enpassant: 'enpassant' };

// 체스 사건 하나를 화면 가운데 연출로 바꾼다. 나와 상관없으면 null (다른 나라끼리의 체크메이트만 작게)
function toBanner(game, e) {
  const hid = game.humanId;
  const [a, b] = e.involved;
  const name = (id) => game.players[id]?.name ?? '';
  switch (e.tag) {
    case 'check':
      if (a === hid) return { glyph: PIECES.king.glyph, title: '체크!', sub: `${josa(name(b), '이/가')} 궁성에 들어왔습니다`, tone: 'danger' };
      if (b === hid) return { glyph: PIECES.king.glyph, title: '체크!', sub: `${name(a)}의 궁성에 들어갔습니다`, tone: 'good', sound: 'checkGive' };
      return null;
    case 'castle':
      return a === hid ? { glyph: PIECES.rook.glyph, title: '캐슬링!', sub: '룩이 킹을 영토 안쪽으로 피신시켰습니다', tone: 'chess' } : null;
    case 'promotion':
      return a === hid ? { glyph: PIECES[e.data.type].glyph, title: '프로모션!', sub: `폰이 ${josa(PIECES[e.data.type].name, '이/가')} 되었습니다`, tone: 'chess' } : null;
    case 'enpassant':
      if (a === hid) return { glyph: PIECES.pawn.glyph, title: '앙파상!', sub: '돌파 부대를 역포위했습니다', tone: 'good' };
      if (b === hid) return { glyph: PIECES.pawn.glyph, title: '앙파상 당함', sub: `${josa(name(a), '이/가')} 우리 부대를 역포위했습니다`, tone: 'danger' };
      return null;
    case 'alliance':
      if (a !== hid && b !== hid) return null;
      return { glyph: '🤝', title: '동맹!', sub: `${josa(name(a === hid ? b : a), '과/와')} 5분 동안 서로 공격하지 않습니다`, tone: 'good', sound: 'alliance' };
    case 'betray':
      if (a === hid) return { glyph: '⚠', title: '배신', sub: `${C.TRAITOR_TICKS / 10}초 동안 방어가 절반, 모두의 표적`, tone: 'danger', sound: 'betray' };
      if (b === hid) return { glyph: '⚠', title: '배신당했습니다', sub: `${josa(name(a), '이/가')} 동맹을 깼습니다`, tone: 'danger', sound: 'betray' };
      return null;
    case 'capture':
      return b === hid ? { soundOnly: true, sound: 'capture' } : null; // 내가 기물을 잡았다
    case 'nuke':
      return e.involved.includes(hid) ? { soundOnly: true, sound: 'nuke' } : null;
    case 'checkmate':
      if (a === hid) return null; // 내가 졌으면 결과 화면이 뜬다
      if (b === hid) return { glyph: PIECES.king.glyph, title: '체크메이트!', sub: `${name(a)}의 킹을 잡았습니다`, tone: 'good', sound: 'win' };
      return {
        glyph: e.data?.nuke ? '☢' : PIECES.king.glyph,
        title: e.data?.nuke ? `${name(a)} 피폭` : `${name(b)} ▸ ${name(a)}`,
        sub: e.data?.nuke ? '킹이 핵에 맞았습니다' : '체크메이트',
        tone: 'muted',
        small: true,
        sound: 'mate',
      };
    default:
      return null;
  }
}

// 화면 읽기 프로그램용 알림: 같은 문장이 반복되면 끝에 nbsp 를 붙여 다시 읽게 한다
const sayNext = (prev, text) => (prev === text ? `${text} ` : text);

export default function ChessBanner({ game }) {
  const seen = useRef(game.nextId);
  const queue = useRef([]);
  const current = useRef(null);
  const lastShown = useRef({}); // "종류:방향:상대" → 마지막으로 보여 준 틱
  const said = useRef('');

  const otherOf = (e) => e.involved.find((id) => id !== game.humanId) ?? 0;

  // 화면은 0.25초마다 다시 그려진다: 그때마다 새 사건을 줄에 세우고, 지금 보여 줄 연출을 고른다
  for (const e of game.events) {
    if (e.id < seen.current) continue;
    seen.current = e.id + 1;
    if (game.phase === 'over') continue; // 판이 끝나면 결과 화면과 승패음만
    const b = e.tag && toBanner(game, e);
    if (!b) continue;
    if (b.soundOnly) {
      play(b.sound);
      continue;
    }
    const sound = b.sound || BANNER_SOUND[e.tag];
    const rep = `${e.tag}:${b.tone}:${otherOf(e)}`; // 체크 당함과 체크 걺은 따로 센다
    if (game.tick - (lastShown.current[rep] ?? -Infinity) < REPEAT_TICKS) {
      play(sound); // 같은 알림이 금방 또 오면 배너 없이 소리만
      continue;
    }
    const q = queue.current;
    if (b.small && (q.length || current.current)) continue; // 다른 나라 소식은 한가할 때만
    const item = { ...b, sound, tag: e.tag, rep, tick: e.tick, key: e.id };
    // 같은 종류 · 같은 방향은 최신 하나만 (위험 알림은 다른 알림이 덮지 못한다)
    const same = q.findIndex((x) => x.tag === e.tag && x.tone === b.tone);
    if (same >= 0) q.splice(same, 1);
    if (b.tone === 'danger' && current.current && current.current.tone !== 'danger') {
      current.current = null; // 위험 알림은 지금 연출을 끊고 바로 뜬다
      q.unshift(item);
    } else q.push(item);
    while (q.length > MAX_QUEUE) {
      const drop = q.findIndex((x) => x.tone !== 'danger'); // 넘치면 위험 알림이 아닌 오래된 것부터
      q.splice(Math.max(0, drop), 1);
    }
  }
  const now = Date.now();
  const cur = current.current;
  if (cur && now - cur.start > (cur.small ? SHOW_MS * 0.8 : SHOW_MS)) current.current = null;
  while (!current.current && queue.current.length) {
    const next = queue.current.shift();
    if (game.tick - next.tick > STALE_TICKS) continue; // 이미 지난 일
    current.current = { ...next, start: now };
    lastShown.current[next.rep] = game.tick;
    play(next.sound);
    said.current = sayNext(said.current, `${next.title} ${next.sub}`);
  }

  const b = current.current;
  return (
    <>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {said.current}
      </div>
      {b && (
        <div key={b.key} className={`chess-banner tone-${b.tone} ${b.small ? 'small' : ''}`}>
          <div className="banner-glyph">{b.glyph}</div>
          <div className="banner-title">{b.title}</div>
          <div className="banner-sub">{b.sub}</div>
        </div>
      )}
    </>
  );
}
