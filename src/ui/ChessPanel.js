import * as C from '../game/constants';
import { PIECES, pieceLabel, josa } from '../game/pieces';
import { fmt } from '../game/Game';

const FILES = 'abcdefgh'.split('');
const STATUS = { idle: '대기', busy: '출격 중', moving: '이동 중', captured: '잡힘' };
const THREAT = {
  nuke: '☢ 핵이 킹을 노리고 있습니다',
  boat: '⛵ 적 배가 킹 근처로 상륙 중',
  knight: '♞ 적 나이트가 킹을 향해 돌파 중',
  army: '⚔ 공격 중인 적이 킹 근처까지 왔습니다',
};

function stats(spec) {
  const out = [];
  if (spec.land) out.push(`지상 ×${spec.landPower}`);
  if (spec.sea) out.push(`상륙 ×${spec.seaPower} · 배 ×${spec.seaSpeed || 1}`);
  if (spec.surprise) out.push(`기습 ${spec.surprise}칸`);
  if (spec.navalBattle) out.push('해전');
  if (spec.fortress) out.push(`요새 반경 ${C.FORTRESS_RADIUS}`);
  if (spec.breakthrough) out.push('지형·요새 무시');
  if (spec.troopLoss) out.push(`출격 시 병력 -${spec.troopLoss * 100}%`);
  return out.join(' · ');
}

export default function ChessPanel({ game, generalId, castle, ep, offer, onResolve, onSelect, onFocus, onMove, onCastle, onEnPassant }) {
  const p = game.human;
  const byId = new Map(p.generals.map((g) => [g.id, g]));
  const selected = generalId ? byId.get(generalId) : null;

  const cell = (g, file, rankIndex) => {
    const dark = (FILES.indexOf(file) + rankIndex) % 2 === 1;
    if (!g) {
      return (
        <button key={file} className={`sq ${dark ? 'dark' : ''} king-sq`} title="킹 — 위치 보기" onClick={() => onFocus(p.king)}>
          <span className="glyph">{PIECES.king.glyph}</span>
        </button>
      );
    }
    const spec = PIECES[g.type];
    return (
      <button
        key={g.id}
        className={`sq ${dark ? 'dark' : ''} st-${g.status} ${g.id === generalId ? 'sel' : ''}`}
        disabled={g.status === 'captured'}
        title={`${pieceLabel(g)} · ${STATUS[g.status]}`}
        onClick={() => onSelect(g.id === generalId ? null : g.id)}
      >
        <span className="glyph">{spec.glyph}</span>
        {g.promoted && <span className="promo-mark">↑</span>}
      </button>
    );
  };

  const bestEp = [...ep].sort((a, b) => b.checks.filter((c) => c.ok).length - a.checks.filter((c) => c.ok).length)[0];

  return (
    <div className="panel chess">
      {offer && <PromotionDialog game={game} offer={offer} onResolve={onResolve} />}
      <div className="panel-title">
        킹 <span className={castle.threat ? 'danger' : 'safe'}>{castle.threat ? '위협!' : '안전'}</span>
        <button className="small right" onClick={() => onFocus(p.king)}>
          킹 보기
        </button>
      </div>
      {castle.threat && <div className="threat">{THREAT[castle.threat.kind]} ({game.players[castle.threat.by]?.name})</div>}

      <div className="rule">
        <div className="rule-head">
          <b>캐슬링</b> <span className="muted">한 판에 한 번</span>
        </div>
        {castle.available ? (
          <div className="rule-actions">
            {castle.rooks.map((r) => (
              <button key={r.id} className="go" onClick={() => onCastle(r.id)}>
                {PIECES.rook.glyph} {josa(pieceLabel(r), '과/와')} 자리 바꾸기
              </button>
            ))}
          </div>
        ) : (
          <div className="muted small-text">{p.castled ? '사용함' : castle.reason}</div>
        )}
      </div>

      <div className={`rule ${bestEp?.ok ? 'rule-ready' : ''}`}>
        <div className="rule-head">
          <b>앙파상</b> <span className="muted">깊이 들어온 적을 폰으로 역포위</span>
        </div>
        {bestEp ? (
          <>
            <ul className="checks">
              {bestEp.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'ok' : 'no'}>
                  {c.ok ? '✓' : '✗'} {c.label} <span className="muted">({c.value})</span>
                </li>
              ))}
            </ul>
            <button className="go" disabled={!bestEp.ok} onClick={() => onEnPassant(bestEp.attackId)}>
              {PIECES.pawn.glyph} 앙파상! ({game.players[bestEp.attacker].name})
            </button>
          </>
        ) : (
          <div className="muted small-text">지금 나를 공격 중인 적이 없습니다</div>
        )}
      </div>

      <div className="panel-title">장군</div>
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
          <div className="small-text">{PIECES[selected.type].role}</div>
          <div className="muted small-text">
            금 {fmt(PIECES[selected.type].cost)} · {stats(PIECES[selected.type])}
          </div>
          <div className="rule-actions">
            {selected.tile >= 0 && (
              <button className="small" onClick={() => onFocus(selected.tile)}>
                위치 보기
              </button>
            )}
            {selected.status === 'idle' && (
              <button className="small" onClick={() => onMove(selected.id)}>
                재배치
              </button>
            )}
            <button className="small" onClick={() => onSelect(null)}>
              선택 해제
            </button>
          </div>
        </div>
      ) : (
        <div className="muted small-text">기물을 고르면 다음 공격을 그 장군이 지휘합니다. 내 땅의 기물을 클릭해도 됩니다.</div>
      )}
    </div>
  );
}

export function PromotionDialog({ game, offer, onResolve }) {
  const g = game.findGeneral(game.humanId, offer.generalId);
  if (!g) return null;
  const to = PIECES[offer.toType];
  return (
    <div className="promotion">
      <div className="promo-glyphs">
        <span>{PIECES.pawn.glyph}</span>→<span>{to.glyph}</span>
      </div>
      <div>
        <b>{pieceLabel(g)}</b>이 적 <b>{josa(to.name, '을/를')}</b> 이겼습니다. <b>{josa(to.name, '으로/로')}</b> 프로모션할까요?
        <div className="muted small-text">한 번 바꾸면 되돌릴 수 없습니다. 거절하면 폰으로 남아 다음 기회를 기다립니다.</div>
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
