import * as C from '../game/constants';
import { PIECES, pieceLabel, josa } from '../game/pieces';
import { fmt } from '../game/Game';

const FILES = 'abcdefgh'.split('');
const STATUS = { idle: '대기', busy: '출격 중', moving: '이동 중', captured: '잡힘' };
export const THREAT = {
  check: '체크! 적이 궁성 안에',
  nuke: '핵이 킹을 노림',
  boat: '적 배가 킹 근처로',
  knight: '적 나이트가 킹으로 돌파 중',
  army: '적이 킹 근처까지',
};

// 오른쪽 위: 내 기물 체스판 + 킹 상태 한 줄. 규칙 버튼은 필요할 때 화면 가운데에 따로 뜬다.
export default function ChessPanel({ game, generalId, threat, onSelect, onFocus, onMove }) {
  const p = game.human;
  const byId = new Map(p.generals.map((g) => [g.id, g]));
  const selected = generalId ? byId.get(generalId) : null;
  const alive = p.generals.filter((g) => g.status !== 'captured').length;

  const cell = (g, file, rankIndex) => {
    const dark = (FILES.indexOf(file) + rankIndex) % 2 === 1;
    if (!g) {
      return (
        <button key={file} className={`sq ${dark ? 'dark' : ''} king-sq ${threat ? 'in-danger' : ''}`} title="킹 — 위치 보기" onClick={() => onFocus(p.king)}>
          <span className="glyph">{PIECES.king.glyph}</span>
        </button>
      );
    }
    const spec = PIECES[g.type];
    const rest = g.status === 'idle' ? Math.max(0, g.restUntil - game.tick) : 0;
    return (
      <button
        key={g.id}
        className={`sq ${dark ? 'dark' : ''} st-${g.status} ${g.id === generalId ? 'sel' : ''} ${rest ? 'resting' : ''}`}
        style={rest ? { '--rest': rest / C.GENERAL_REST_TICKS } : undefined}
        disabled={g.status === 'captured'}
        title={`${pieceLabel(g)} · ${rest ? `휴식 ${Math.ceil(rest / 10)}초` : STATUS[g.status]} · 금 ${fmt(spec.cost)}`}
        onClick={() => onSelect(g.id === generalId ? null : g.id)}
      >
        <span className="glyph">{spec.glyph}</span>
        {g.promoted && <span className="promo-mark">↑</span>}
      </button>
    );
  };

  return (
    <div className="panel chess">
      <button className={`king-line ${threat ? 'danger' : ''}`} onClick={() => onFocus(p.king)} title="킹 위치 보기">
        <span className="king-glyph">{PIECES.king.glyph}</span>
        <span>{threat ? THREAT[threat.kind] : '킹 안전'}</span>
        <span className="right muted">{alive}/15</span>
      </button>
      <div className="board">
        {FILES.map((f) => cell(byId.get(`${p.id}:p${f}`), f, 0))}
        {FILES.map((f) => (f === 'e' ? cell(null, f, 1) : cell(byId.get(`${p.id}:${f}`), f, 1)))}
      </div>

      {selected ? (
        <div className="piece-card">
          <div className="piece-head">
            <span className="leader-glyph">{PIECES[selected.type].glyph}</span>
            <b>{pieceLabel(selected)}</b>
            <span className={`badge st-${selected.status}`}>{STATUS[selected.status]}</span>
          </div>
          <div className="small-text muted">{PIECES[selected.type].role}</div>
          <div className="rule-actions">
            {selected.tile >= 0 && (
              <button className="small" onClick={() => onFocus(selected.tile)}>
                위치
              </button>
            )}
            {selected.status === 'idle' && (
              <button className="small" onClick={() => onMove(selected.id)}>
                재배치
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="small-text muted center">기물을 고르면 다음 공격을 지휘합니다</div>
      )}
    </div>
  );
}

export function PromotionDialog({ game, offer, onResolve }) {
  const g = game.findGeneral(game.humanId, offer.generalId);
  if (!g) return null;
  const to = PIECES[offer.toType];
  return (
    <div className="panel action-card promotion">
      <div className="promo-glyphs">
        <span>{PIECES.pawn.glyph}</span>
        <span className="muted">→</span>
        <span>{to.glyph}</span>
      </div>
      <div>
        <b>프로모션!</b> {pieceLabel(g)}이 적 {josa(to.name, '을/를')} 이겼습니다
        <div className="muted small-text">한 번 바꾸면 되돌릴 수 없습니다</div>
      </div>
      <div className="rule-actions">
        <button className="go" onClick={() => onResolve(g.id, true)}>
          {to.glyph} {josa(to.name, '으로/로')} 승격
        </button>
        <button onClick={() => onResolve(g.id, false)}>폰으로 남기</button>
      </div>
    </div>
  );
}
