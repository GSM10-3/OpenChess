import { PIECES, PIECE_ORDER } from '../game/pieces';
import { fmt } from '../game/Game';

export const THREAT = {
  check: '체크! 적이 궁성 안에',
  nuke: '핵이 킹을 노림',
  boat: '적 배가 킹 근처로',
  knight: '적 나이트가 킹으로 돌파 중',
  army: '적이 킹 근처까지',
};

// 오른쪽 위: 킹 상태 한 줄 + 기물 버튼 다섯 개. 기물은 성 안에서 대기하다가, 고르면 다음 공격을 이끈다.
export default function ChessPanel({ game, pieceType, threat, onPick, onFocus }) {
  const p = game.human;
  return (
    <div className="panel chess">
      <button className={`king-line ${threat ? 'danger' : ''}`} onClick={() => onFocus(p.king)} title="킹 위치 보기 (K)">
        <span className="king-glyph">{PIECES.king.glyph}</span>
        <span>{threat ? THREAT[threat.kind] : '킹 안전'}</span>
      </button>
      <div className="pieces">
        {PIECE_ORDER.map((type, i) => {
          const spec = PIECES[type];
          const mine = p.generals.filter((g) => g.type === type);
          const ready = mine.filter((g) => g.status === 'idle').length;
          const alive = mine.filter((g) => g.status !== 'captured').length;
          const usable = ready > 0 && p.gold >= spec.cost;
          return (
            <button
              key={type}
              className={`piece ${pieceType === type ? 'sel' : ''} ${usable ? '' : 'dim'}`}
              disabled={!alive}
              onClick={() => onPick(pieceType === type ? null : type)}
              title={`${spec.name} (${i + 1}) · ${spec.role}${ready < alive ? ` · 출격 중 ${alive - ready}` : ''}`}
            >
              <span className="glyph">{spec.glyph}</span>
              <span className="count">{ready}</span>
              <span className={`cost ${p.gold >= spec.cost ? '' : 'short'}`}>{fmt(spec.cost)}</span>
            </button>
          );
        })}
      </div>
      <div className="small-text muted center">
        {pieceType ? (
          <>
            <b className="piece-name">{PIECES[pieceType].name}</b> {PIECES[pieceType].role}
          </>
        ) : (
          '기물을 고르고 공격하면 그 기물이 이끌어요'
        )}
      </div>
    </div>
  );
}
