import { useState } from 'react';
import * as C from '../game/constants';
import { PIECES, pieceLabel } from '../game/pieces';
import { fmt } from '../game/Game';
import { isMuted } from './sound';

export const clock = (tick) => {
  const s = Math.floor(tick / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// 꼭 필요한 숫자만: 병력(막대) · 금 · 시간(또는 평화 기간)
export function TopBar({ game, paused, speed, onPause, onSpeed, onMute, onExit }) {
  const p = game.human;
  const max = C.maxTroops(p.tiles);
  const regen = C.troopRegen(p.troops, max) * 10;
  const fill = Math.min(1, p.troops / max);
  const peace = game.peaceLeft();
  return (
    <div className="panel topbar">
      <div className="stat" title={`병력 ${fmt(p.troops)} / ${fmt(max)} · 초당 +${fmt(regen)}`}>
        <span className="stat-icon">⚔</span>
        <b>{fmt(p.troops)}</b>
        <span className="bar">
          <span style={{ width: `${fill * 100}%` }} />
        </span>
      </div>
      <div className="stat" title={`초당 +${fmt(C.goldIncome(p.tiles) * 10)}`}>
        <span className="stat-icon gold">●</span>
        <b className="gold">{fmt(p.gold)}</b>
      </div>
      {peace > 0 ? (
        <div className="stat peace" title="평화 기간: 무주지만 넓힐 수 있습니다">
          <span className="stat-icon">🕊</span>
          <b>평화 {Math.ceil(peace / 10)}초</b>
        </div>
      ) : (
        <div className="stat muted">
          <b>{clock(game.tick)}</b>
        </div>
      )}
      <div className="topbar-buttons">
        <button className="icon" onClick={onPause} title="일시정지 (Space)">
          {paused ? '▶' : '⏸'}
        </button>
        <button className="icon" onClick={onSpeed} title="게임 속도">
          ×{speed}
        </button>
        <button className="icon" onClick={onMute} title="효과음">
          {isMuted() ? '🔇' : '🔊'}
        </button>
        <button className="icon" onClick={onExit} title="나가기">
          ✕
        </button>
      </div>
    </div>
  );
}

// 상위 다섯 나라 + 나 + 이웃 · 동맹국만. 나라를 누르면 외교 버튼이 열린다
export function Leaderboard({ game, onFocus, onAlly, onBreak }) {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState(0);
  const me = game.human;
  const all = game.players.filter((p) => p && p.spawned && p.alive).sort((a, b) => b.tiles - a.tiles);
  const near = me?.alive ? game.neighborsOf(me.id) : new Set();
  const shown = all.filter((p, i) => i < 5 || p.isHuman || near.has(p.id) || game.allied(me.id, p.id));
  return (
    <div className="panel leaderboard">
      <button className="panel-title flat" onClick={() => setOpen((v) => !v)}>
        순위 <span className="muted">{all.length}개국</span>
        <span className="right muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol>
          {shown.map((p) => {
            const ally = game.allied(me.id, p.id);
            const left = ally ? game.allianceLeft(me.id, p.id) : 0;
            return (
              <li key={p.id} className={`${p.isHuman ? 'me' : ''} ${sel === p.id ? 'open' : ''}`}>
                <button className="row flat" disabled={p.isHuman} onClick={() => setSel(sel === p.id ? 0 : p.id)} title={p.isHuman ? '' : '외교 · 위치'}>
                  <span className="rank">{all.indexOf(p) + 1}</span>
                  <span className="dot" style={{ background: p.color }} />
                  <span className="name">{p.name}</span>
                  {ally && <span title={`동맹 · ${Math.ceil(left / 10)}초 남음`}>🤝</span>}
                  {game.isTraitor(p.id) && <span title="배신자">⚠</span>}
                  {!ally && near.has(p.id) && <span className="muted tag" title="맞닿은 나라">이웃</span>}
                  <span className="num">{((p.tiles / game.landCount) * 100).toFixed(1)}%</span>
                </button>
                {sel === p.id && !p.isHuman && (
                  <div className="row-actions">
                    <button className="small" onClick={() => onFocus(p.king)}>
                      보기
                    </button>
                    {ally ? (
                      <>
                        {left <= C.ALLIANCE_RENEW_TICKS && (
                          <button className="small go" onClick={() => onAlly(p.id)}>
                            연장
                          </button>
                        )}
                        <button className="small danger-btn" onClick={() => onBreak(p.id)} title="깨면 1분 동안 배신자가 됩니다">
                          동맹 깨기 · {Math.ceil(left / 10)}초
                        </button>
                      </>
                    ) : (
                      <button className="small go" onClick={() => onAlly(p.id)} title={`${C.ALLIANCE_TICKS / 600}분 동안 서로 공격하지 않습니다`}>
                        🤝 동맹 제안
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const MODES = [
  { key: 'attack', label: '⚔', name: '공격', hint: '적 땅이나 무주지를 클릭' },
  { key: 'boat', label: '⛵', name: '상륙', hint: '건너편 해안을 클릭 (B)' },
  { key: 'atom', label: '☢', name: '원자', hint: `원자폭탄 · 금 ${fmt(C.NUKES.atom.cost)} · 반경 ${C.NUKES.atom.radius}칸` },
  { key: 'hydrogen', label: '☢', name: '수소', hint: `수소폭탄 · 금 ${fmt(C.NUKES.hydrogen.cost)} · 반경 ${C.NUKES.hydrogen.radius}칸` },
];

export function ControlPanel({ game, ratio, setRatio, mode, setMode, general, clearGeneral, onRetreat, onFocus }) {
  const p = game.human;
  const spec = general ? PIECES[general.type] : null;
  const sending = Math.floor(p.troops * ratio);
  const nukeLocked = game.tick < C.NUKE_UNLOCK_TICK;
  const attacks = game.attacks.filter((a) => a.attacker === p.id);
  const boats = game.boats.filter((b) => b.owner === p.id);
  return (
    <div className="panel controls">
      <label className="ratio" title="공격에 보낼 병력 비율">
        <input type="range" min="1" max="100" value={Math.round(ratio * 100)} onChange={(e) => setRatio(e.target.value / 100)} />
        <span className="ratio-value">
          <b>{Math.round(ratio * 100)}%</b>
          <span className="muted">{fmt(spec?.troopLoss ? sending * (1 - spec.troopLoss) : sending)}</span>
        </span>
      </label>
      <div className="modes">
        {MODES.map((m) => {
          const nuke = !!C.NUKES[m.key];
          const disabled = nuke && (nukeLocked || p.gold < C.NUKES[m.key].cost);
          const title = nuke && nukeLocked ? `${m.hint} — ${Math.ceil((C.NUKE_UNLOCK_TICK - game.tick) / 10)}초 뒤 사용 가능` : m.hint;
          return (
            <button
              key={m.key}
              className={`${mode === m.key ? 'active' : ''} ${nuke ? 'nuke' : ''}`}
              disabled={disabled}
              title={title}
              onClick={() => setMode(mode === m.key ? 'attack' : m.key)}
            >
              <span className="mode-icon">{m.label}</span>
              <span className="mode-name">{m.name}</span>
            </button>
          );
        })}
      </div>
      {mode === 'move' && <div className="hint">장군을 옮길 내 땅을 클릭하세요 · Esc 취소</div>}
      {general && (
        <div className="leader">
          <span className="leader-glyph">{spec.glyph}</span>
          <span>
            <b>{pieceLabel(general)}</b> <span className="muted">지휘 · 금 {fmt(spec.cost)}</span>
          </span>
          <button className="small" onClick={clearGeneral} title="장군 선택 해제">
            ✕
          </button>
        </div>
      )}
      {(attacks.length > 0 || boats.length > 0) && (
        <ul className="ops">
          {attacks.map((a) => (
            <li key={a.id}>
              <span>
                {a.general ? PIECES[a.general.type].glyph : '⚔'} {a.target ? game.players[a.target].name : '무주지'}
              </span>
              <span className="num">{fmt(a.troops)}</span>
              <button className="small" onClick={() => onRetreat(a.id)} title={`남은 병력의 ${C.RETREAT_KEEP * 100}%만 돌아옵니다`}>
                후퇴
              </button>
            </li>
          ))}
          {boats.map((b) => (
            <li key={b.id}>
              <span>
                {b.general ? PIECES[b.general.type].glyph : '⛵'} → {game.owner[b.landing] ? game.players[game.owner[b.landing]].name : '무주지'}
              </span>
              <span className="num">{fmt(b.troops)}</span>
              <button className="small" onClick={() => onFocus(b.tile)}>
                보기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FEED_TICKS = 80; // 8초 지나면 사라진다

// 나와 관련된 체스 사건과 체크메이트 · 핵만, 최근 네 개
export function EventLog({ game }) {
  const hid = game.humanId;
  const events = game.events
    .filter((e) => game.tick - e.tick < FEED_TICKS)
    .filter((e) => e.kind === 'big' || e.kind === 'nuke' || (e.kind === 'chess' && e.involved.includes(hid)))
    .filter((e) => !(e.tag === 'capture' && e.data?.type === 'pawn')) // 폰 잡힘은 너무 잦아서 뺀다
    .slice(-3);
  if (!events.length) return null;
  return (
    <div className="eventlog">
      {events.map((e) => (
        <div key={e.id} className={`ev ev-${e.kind}`} style={{ opacity: Math.min(1, (FEED_TICKS - (game.tick - e.tick)) / 20) }}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
