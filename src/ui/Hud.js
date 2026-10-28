import * as C from '../game/constants';
import { PIECES, pieceLabel } from '../game/pieces';
import { fmt } from '../game/Game';

const clock = (tick) => {
  const s = Math.floor(tick / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function TopBar({ game, paused, speed, onPause, onSpeed, onExit }) {
  const p = game.human;
  const max = C.maxTroops(p.tiles);
  const regen = C.troopRegen(p.troops, max) * 10;
  const share = (p.tiles / game.landCount) * 100;
  return (
    <div className="panel topbar">
      <div className="stat">
        <span className="stat-label">병력</span>
        <b>{fmt(p.troops)}</b>
        <span className="muted">/ {fmt(max)}</span>
        <span className="gain">+{fmt(regen)}/s</span>
      </div>
      <div className="stat">
        <span className="stat-label">금</span>
        <b className="gold">{fmt(p.gold)}</b>
        <span className="gain">+{fmt(C.goldIncome(p.tiles) * 10)}/s</span>
      </div>
      <div className="stat">
        <span className="stat-label">영토</span>
        <b>{share.toFixed(1)}%</b>
      </div>
      <div className="stat">
        <span className="stat-label">시간</span>
        <b>{clock(game.tick)}</b>
      </div>
      {game.peaceLeft() > 0 && (
        <div className="stat" title="이 시간 동안은 무주지만 넓힐 수 있습니다">
          <span className="stat-label">평화</span>
          <b className="safe">{Math.ceil(game.peaceLeft() / 10)}초</b>
        </div>
      )}
      <div className="topbar-buttons">
        <button onClick={onPause} title="Space">{paused ? '▶ 계속' : '⏸ 멈춤'}</button>
        <button onClick={onSpeed} title="게임 속도">×{speed}</button>
        <button onClick={onExit}>나가기</button>
      </div>
    </div>
  );
}

export function Leaderboard({ game }) {
  const rows = game.players
    .filter((p) => p && p.spawned)
    .sort((a, b) => b.alive - a.alive || b.tiles - a.tiles)
    .slice(0, 10);
  return (
    <div className="panel leaderboard">
      <div className="panel-title">순위</div>
      <table>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id} className={`${p.isHuman ? 'me' : ''} ${p.alive ? '' : 'dead'}`}>
              <td className="rank">{p.alive ? i + 1 : '–'}</td>
              <td>
                <span className="dot" style={{ background: p.color }} />
                {p.name}
              </td>
              <td className="num">{p.alive ? `${((p.tiles / game.landCount) * 100).toFixed(1)}%` : ''}</td>
              <td className="num">{p.alive ? fmt(p.troops) : ''}</td>
              <td className="king-state" title={p.alive ? '킹 생존' : p.deathCause === 'nuke' ? '피폭' : '체크메이트'}>
                {p.alive ? PIECES.king.glyph : p.deathCause === 'nuke' ? '☢' : '✝'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MODES = [
  { key: 'attack', label: '⚔ 공격', hint: '적 땅이나 무주지를 클릭하세요. 맞닿지 않은 곳은 배로 갑니다.' },
  { key: 'boat', label: '⛵ 상륙', hint: '건너편 해안을 클릭하면 배를 띄웁니다.' },
  { key: 'atom', label: `☢ 원자 ${fmt(C.NUKES.atom.cost)}`, hint: `반경 ${C.NUKES.atom.radius}칸. 킹이 맞으면 그 나라는 패배합니다.` },
  { key: 'hydrogen', label: `☢ 수소 ${fmt(C.NUKES.hydrogen.cost)}`, hint: `반경 ${C.NUKES.hydrogen.radius}칸. 킹이 맞으면 그 나라는 패배합니다.` },
];

export function ControlPanel({ game, ratio, setRatio, mode, setMode, general, clearGeneral, onRetreat, onFocus }) {
  const p = game.human;
  const spec = general ? PIECES[general.type] : null;
  const sending = Math.floor(p.troops * ratio);
  const nukeLocked = game.tick < C.NUKE_UNLOCK_TICK;
  const hint = mode === 'move' ? '장군을 옮길 내 땅을 클릭하세요. (Esc 취소)' : MODES.find((m) => m.key === mode)?.hint;
  const attacks = game.attacks.filter((a) => a.attacker === p.id);
  const boats = game.boats.filter((b) => b.owner === p.id);
  return (
    <div className="panel controls">
      <label className="ratio">
        <span>
          공격 병력 <b>{Math.round(ratio * 100)}%</b>
          <span className="muted"> · {fmt(spec?.troopLoss ? sending * (1 - spec.troopLoss) : sending)}명</span>
        </span>
        <input type="range" min="1" max="100" value={Math.round(ratio * 100)} onChange={(e) => setRatio(e.target.value / 100)} />
      </label>
      <div className="leader">
        {general ? (
          <>
            <span className="leader-glyph">{spec.glyph}</span>
            <span>
              <b>{pieceLabel(general)}</b> 지휘 · 금 {fmt(spec.cost)}
              <span className="muted">
                {' '}
                {spec.land && spec.sea ? '육·해' : spec.land ? '육지만' : '바다만'}
              </span>
            </span>
            <button className="small" onClick={clearGeneral}>
              ✕
            </button>
          </>
        ) : (
          <span className="muted">장군 없이 출격 (오른쪽 체스판에서 장군 선택)</span>
        )}
      </div>
      <div className="modes">
        {MODES.map((m) => {
          const nuke = !!C.NUKES[m.key];
          const disabled = nuke && (nukeLocked || p.gold < C.NUKES[m.key].cost);
          return (
            <button
              key={m.key}
              className={mode === m.key ? 'active' : ''}
              disabled={disabled}
              title={nuke && nukeLocked ? `${Math.ceil((C.NUKE_UNLOCK_TICK - game.tick) / 10)}초 뒤 사용 가능` : m.hint}
              onClick={() => setMode(mode === m.key ? 'attack' : m.key)}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="hint">{hint}</div>
      {(attacks.length > 0 || boats.length > 0) && (
        <ul className="ops">
          {attacks.map((a) => (
            <li key={a.id}>
              <span>
                {a.general ? PIECES[a.general.type].glyph : '⚔'} {a.target ? game.players[a.target].name : '무주지'}
                {a.kind === 'landing' ? ' (상륙)' : a.kind === 'knight' ? ' (돌파)' : ''}
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
                {b.general ? PIECES[b.general.type].glyph : '⛵'} 항해 중 → {game.owner[b.landing] ? game.players[game.owner[b.landing]].name : '무주지'}
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

const KIND_CLASS = { big: 'ev-big', nuke: 'ev-nuke', chess: 'ev-chess', info: '' };

export function EventLog({ game }) {
  const hid = game.humanId;
  const events = game.events.filter((e) => e.kind === 'big' || e.kind === 'nuke' || e.involved.includes(hid)).slice(-9);
  return (
    <div className="panel eventlog">
      {events.map((e) => (
        <div key={e.id} className={KIND_CLASS[e.kind]}>
          <span className="ev-time">{clock(e.tick)}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
