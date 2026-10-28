import { useRef } from 'react';
import { PIECES, josa } from '../game/pieces';

const SHOW_MS = 1800;

// 체스 사건 하나를 화면 가운데 연출로 바꾼다. 나와 상관없으면 null (다른 나라끼리의 체크메이트만 작게)
function toBanner(game, e) {
  const hid = game.humanId;
  const [a, b] = e.involved;
  const name = (id) => game.players[id]?.name ?? '';
  switch (e.tag) {
    case 'check':
      if (a === hid) return { glyph: PIECES.king.glyph, title: '체크!', sub: `${josa(name(b), '이/가')} 궁성에 들어왔습니다`, tone: 'danger' };
      if (b === hid) return { glyph: PIECES.king.glyph, title: '체크!', sub: `${name(a)}의 궁성에 들어갔습니다`, tone: 'good' };
      return null;
    case 'castle':
      return a === hid ? { glyph: PIECES.rook.glyph, title: '캐슬링!', sub: '킹과 룩이 자리를 바꿨습니다', tone: 'chess' } : null;
    case 'promotion':
      return a === hid ? { glyph: PIECES[e.data.type].glyph, title: '프로모션!', sub: `폰이 ${josa(PIECES[e.data.type].name, '이/가')} 되었습니다`, tone: 'chess' } : null;
    case 'enpassant':
      if (a === hid) return { glyph: PIECES.pawn.glyph, title: '앙파상!', sub: '돌파 부대를 역포위했습니다', tone: 'good' };
      if (b === hid) return { glyph: PIECES.pawn.glyph, title: '앙파상 당함', sub: `${josa(name(a), '이/가')} 우리 부대를 역포위했습니다`, tone: 'danger' };
      return null;
    case 'checkmate':
      if (a === hid) return null; // 내가 졌으면 결과 화면이 뜬다
      if (b === hid) return { glyph: PIECES.king.glyph, title: '체크메이트!', sub: `${name(a)}의 킹을 잡았습니다`, tone: 'good' };
      return {
        glyph: e.data?.nuke ? '☢' : PIECES.king.glyph,
        title: e.data?.nuke ? `${name(a)} 피폭` : `${name(b)} ▸ ${name(a)}`,
        sub: e.data?.nuke ? '킹이 핵에 맞았습니다' : '체크메이트',
        tone: 'muted',
        small: true,
      };
    default:
      return null;
  }
}

export default function ChessBanner({ game }) {
  const seen = useRef(game.nextId);
  const queue = useRef([]);
  const current = useRef(null);

  // 화면은 0.25초마다 다시 그려진다: 그때마다 새 사건을 줄에 세우고, 지금 보여 줄 연출을 고른다
  for (const e of game.events) {
    if (e.id < seen.current) continue;
    seen.current = e.id + 1;
    const b = e.tag && toBanner(game, e);
    if (b) queue.current.push({ ...b, key: e.id });
  }
  const now = Date.now();
  const cur = current.current;
  if (cur && now - cur.start > (cur.small ? SHOW_MS * 0.8 : SHOW_MS)) current.current = null;
  if (!current.current && queue.current.length) current.current = { ...queue.current.shift(), start: now };

  const b = current.current;
  if (!b) return null;
  return (
    <div key={b.key} className={`chess-banner tone-${b.tone} ${b.small ? 'small' : ''}`}>
      <div className="banner-glyph">{b.glyph}</div>
      <div className="banner-title">{b.title}</div>
      <div className="banner-sub">{b.sub}</div>
    </div>
  );
}
