import { useState } from 'react';
import * as C from '../game/constants';
import { PIECES } from '../game/pieces';
import { fmt } from '../game/Game';
import { soundMode } from './sound';
import { keyHint } from './platform';

// 효과음 버튼: 누를 때마다 전부 → 경보만 → 끔
const SOUND_ICON = { all: ['🔊', '효과음: 전부'], alerts: ['🔉', '효과음: 경보만 (체크 · 배신 · 핵 · 패배)'], off: ['🔇', '효과음: 끔'] };

export const clock = (tick) => {
  const s = Math.floor(tick / 10);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// 회복이 가장 빠른 병력 비율: (10 + t^0.73 / 4)(1 - t) 의 꼭짓점 근처
const REGEN_PEAK = 0.73 / 1.73;
const NEAR_CAP = 0.95; // 이보다 차면 회복이 거의 멈춘다
const LOW_SHARE = 0.1; // 이보다 적으면 막대 테두리가 빨강
const INCOMING_MIN = 0.2; // 받는 공격은 내 병력의 이 비율 이상만 보여 준다 (작은 견제는 숨김)

// 꼭 필요한 숫자만: 병력(막대) · 금 · 시간(또는 평화 기간)
export function TopBar({ game, paused, speed, onPause, onSpeed, onMute, onExit }) {
  const p = game.human;
  const max = game.maxTroopsOf(p);
  const regen = C.troopRegen(p.troops, max) * 10;
  const fill = Math.min(1, p.troops / max);
  // 출전 중인 병력 (지상 공격 + 배): 막대 뒤쪽 회색 구간
  let out = 0;
  for (const a of game.attacks) if (!a.done && a.attacker === p.id) out += a.troops;
  for (const b of game.boats) if (!b.done && b.owner === p.id) out += b.troops;
  const outFill = Math.min(1 - fill, out / max);
  const income = C.goldIncome(p.tiles) * 10;
  const peace = game.peaceLeft();
  const traitorLeft = game.isTraitor(p.id) ? Math.ceil((p.traitorUntil - game.tick) / 10) : 0;
  return (
    <div className="panel topbar">
      <div
        className="stat"
        title={`병력 ${fmt(p.troops)} / 최대 ${fmt(max)}${out > 0 ? ` · 출전 중 ${fmt(out)}` : ''} · 초당 +${fmt(regen)} · 절반쯤일 때 가장 빨리 늘어납니다`}
      >
        <span className="stat-icon">⚔</span>
        <b>{fmt(p.troops)}</b>
        <span className={`rate ${fill >= NEAR_CAP ? 'cap' : 'up'}`}>+{fmt(regen)}/s</span>
        <span className={`bar ${fill < LOW_SHARE ? 'low' : ''}`}>
          <span className="bar-own" style={{ width: `${fill * 100}%` }} />
          {outFill > 0 && <span className="bar-out" style={{ width: `${outFill * 100}%` }} />}
          <i className="bar-mark" style={{ left: `${REGEN_PEAK * 100}%` }} />
        </span>
      </div>
      <div className="stat" title={`금 ${fmt(p.gold)} · 초당 +${fmt(income)}`}>
        <span className="stat-icon gold">●</span>
        <b className="gold">{fmt(p.gold)}</b>
        <span className="rate gold-rate">+{fmt(income)}/s</span>
      </div>
      {peace > 0 ? (
        <div className="stat peace" title="평화 기간: 무주지만 넓힐 수 있습니다">
          <span className="stat-icon">🕊</span>
          <b>
            <span className="peace-word">평화 </span>
            {Math.ceil(peace / 10)}초
          </b>
        </div>
      ) : (
        <div className="stat muted">
          <b>{clock(game.tick)}</b>
          {game.tick > game.overtimeTick && (
            <b className="overtime" title="오버타임: 승리 기준이 1분에 2%p씩 내려갑니다">
              승리 {Math.round(game.winShare() * 100)}%
            </b>
          )}
        </div>
      )}
      {traitorLeft > 0 && (
        <div className="stat traitor-chip" title="방어 절반 · 모두의 표적">
          <b>⚠ 배신자 · {traitorLeft}초</b>
        </div>
      )}
      <div className="topbar-buttons">
        <button className="icon" onClick={onPause} title={`일시정지${keyHint('Space')}`}>
          {paused ? '▶' : '⏸'}
        </button>
        <button className="icon speed-btn" onClick={onSpeed} title="게임 속도">
          ×{speed}
        </button>
        <button className="icon" onClick={onMute} title={SOUND_ICON[soundMode()][1]} aria-label={SOUND_ICON[soundMode()][1]}>
          {SOUND_ICON[soundMode()][0]}
        </button>
        <button className="icon" onClick={onExit} title="나가기">
          ✕
        </button>
      </div>
    </div>
  );
}

// 상위 다섯 나라 + 나 + 이웃 · 동맹국만. 나라를 누르면 외교 버튼이 열린다
// 좁은 화면(태블릿 · 모바일)에서는 접힌 채로 시작한다
const narrow = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1150px)').matches;

export function Leaderboard({ game, onFocus, onAlly, onBreak }) {
  const [open, setOpen] = useState(() => !narrow());
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
            const traitor = game.isTraitor(p.id);
            return (
              <li key={p.id} className={`${p.isHuman ? 'me' : ''} ${sel === p.id ? 'open' : ''}`}>
                <button className="row flat" disabled={p.isHuman} onClick={() => setSel(sel === p.id ? 0 : p.id)} title={p.isHuman ? '' : '외교 · 위치'}>
                  <span className="rank">{all.indexOf(p) + 1}</span>
                  <span className="dot" style={{ background: p.color }} />
                  <span className="name">
                    {p.isHuman && <span aria-label="나">★ </span>}
                    {p.name}
                  </span>
                  {ally && <span title={`동맹 · ${Math.ceil(left / 10)}초 남음`}>🤝</span>}
                  {traitor && <span title="배신자">⚠</span>}
                  {!ally && near.has(p.id) && (
                    <span className="muted tag" title="맞닿은 나라">
                      이웃
                    </span>
                  )}
                  <span className="num">{((p.tiles / game.landCount) * 100).toFixed(1)}%</span>
                </button>
                {sel === p.id && !p.isHuman && (
                  <div className="row-actions">
                    <DiplomacyActions game={game} target={p} onFocus={onFocus} onAlly={onAlly} onBreak={onBreak} />
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

// 한 나라에 대한 외교 버튼: 보기 · 동맹 제안 / 연장 / 깨기 (순위표와 모바일 시트가 같이 쓴다)
function DiplomacyActions({ game, target: p, onFocus, onAlly, onBreak }) {
  const me = game.human;
  const ally = game.allied(me.id, p.id);
  const left = ally ? game.allianceLeft(me.id, p.id) : 0;
  const traitor = game.isTraitor(p.id);
  const near = me?.alive && game.neighborsOf(me.id).has(p.id);
  return (
    <>
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
          <button
            className={`small ${traitor ? '' : 'danger-btn'}`}
            onClick={() => onBreak(p.id)}
            title={traitor ? '상대가 배신자라 벌칙 없음' : `깨면 ${C.TRAITOR_TICKS / 10}초 동안 배신자: 방어 절반 · 모두의 표적`}
          >
            동맹 깨기 · {Math.ceil(left / 10)}초
          </button>
        </>
      ) : (
        near && <AllyButton game={game} me={me} target={p} onAlly={onAlly} />
      )}
    </>
  );
}

// 모바일: 지도에서 나라를 길게 누르면 아래에 뜨는 외교 시트 (지도는 계속 만질 수 있다)
export function DiplomacySheet({ game, id, onFocus, onAlly, onBreak, onClose }) {
  const p = game.players[id];
  if (!p || !p.alive || p.isHuman) return null;
  const me = game.human;
  const ally = game.allied(me.id, p.id);
  const near = me?.alive && game.neighborsOf(me.id).has(p.id);
  return (
    <div className="panel sheet" role="dialog" aria-label={`${p.name} 외교`}>
      <div className="sheet-head">
        <span className="dot" style={{ background: p.color }} />
        <b className="sheet-name">{p.name}</b>
        {ally && <span title="동맹">🤝</span>}
        {game.isTraitor(p.id) && <span title="배신자">⚠</span>}
        <button className="small quiet right" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="muted small-text">
        병력 {fmt(p.troops)} · 영토 {((p.tiles / game.landCount) * 100).toFixed(1)}%{!ally && !near && ' · 맞닿아야 동맹을 제안할 수 있어요'}
      </div>
      <div className="row-actions sheet-actions">
        <DiplomacyActions game={game} target={p} onFocus={onFocus} onAlly={onAlly} onBreak={onBreak} />
      </div>
    </div>
  );
}

// 동맹 제안: 거절될 이유가 보이면 미리 흐리게, 다시 제안까지 남은 초도
function AllyButton({ game, me, target, onAlly }) {
  const retry = Math.max(0, Math.ceil(((game.allyRetry.get(`${me.id}-${target.id}`) || 0) - game.tick) / 10));
  const why = game.allianceRefusal(me.id, target.id);
  const title = why || `${C.ALLIANCE_TICKS / 600}분 동안 서로 공격하지 않습니다`;
  return (
    <button className={`small ${why || retry ? 'dim' : 'go'}`} onClick={() => onAlly(target.id)} title={title}>
      🤝 동맹 제안{retry > 0 && ` · ${retry}초`}
    </button>
  );
}

const MODES = [
  { key: 'attack', label: '⚔', name: '공격', hint: '적 땅이나 무주지를 클릭' },
  { key: 'boat', label: '⛵', name: '상륙', hint: `건너편 해안을 클릭${keyHint('B')}` },
  { key: 'atom', label: '☢', name: '원자', hint: `원자폭탄 · 금 ${fmt(C.NUKES.atom.cost)} · 반경 ${C.NUKES.atom.radius}칸` },
  { key: 'hydrogen', label: '☢', name: '수소', hint: `수소폭탄 · 금 ${fmt(C.NUKES.hydrogen.cost)} · 반경 ${C.NUKES.hydrogen.radius}칸` },
];

export function ControlPanel({ game, ratio, setRatio, mode, setMode, pieceType, clearPiece, onRetreat, onFocus }) {
  const p = game.human;
  const spec = pieceType ? PIECES[pieceType] : null;
  const sending = Math.floor(p.troops * ratio);
  const nukeLocked = game.tick < game.nukeUnlockTick;
  const attacks = game.attacks.filter((a) => a.attacker === p.id);
  const boats = game.boats.filter((b) => b.owner === p.id);
  // 들어오는 공격 (지상 + 내 해안으로 오는 배): 내 병력의 1/5 이상인 큰 것만 (테두리 경보와 같은 기준), 큰 것부터 두 줄, 누르면 그 전선으로
  const incoming = [
    ...game.attacks
      .filter((a) => !a.done && a.target === p.id)
      .map((a) => ({ key: `a${a.id}`, from: a.attacker, troops: a.troops, tile: a.lastTile >= 0 ? a.lastTile : a.origin, boat: false })),
    ...game.boats
      .filter((b) => !b.done && b.owner !== p.id && game.owner[b.landing] === p.id)
      .map((b) => ({ key: `b${b.id}`, from: b.owner, troops: b.troops, tile: b.tile, boat: true })),
  ]
    .filter((x) => x.troops >= p.troops * INCOMING_MIN)
    .sort((x, y) => y.troops - x.troops)
    .slice(0, 2);
  return (
    <div className="panel controls">
      <label className="ratio" title={`공격에 보낼 병력 비율${keyHint('Q/E')}`}>
        <input type="range" min="1" max="100" value={Math.round(ratio * 100)} onChange={(e) => setRatio(e.target.value / 100)} />
        <span className="ratio-value">
          <b>{Math.round(ratio * 100)}%</b>
          <span className="muted">{fmt(sending)}</span>
        </span>
      </label>
      <div className="modes">
        {MODES.map((m) => {
          const nuke = !!C.NUKES[m.key];
          const disabled = nuke && (nukeLocked || p.gold < C.NUKES[m.key].cost);
          const title = nuke && nukeLocked ? `${m.hint} — ${Math.ceil((game.nukeUnlockTick - game.tick) / 10)}초 뒤 사용 가능` : m.hint;
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
      {spec && (
        <div className="leader">
          <span className="leader-glyph">{spec.glyph}</span>
          <span>
            <b>{spec.name}</b> <span className="muted">다음 공격을 이끕니다 · 금 {fmt(spec.cost)}</span>
          </span>
          <button className="small" onClick={clearPiece} title={`기물 선택 해제${keyHint('Esc')}`}>
            ✕
          </button>
        </div>
      )}
      {(attacks.length > 0 || boats.length > 0 || incoming.length > 0) && (
        <ul className="ops">
          {incoming.map((x) => (
            <li key={x.key} className="incoming">
              <button className="flat" onClick={() => onFocus(x.tile)} title="받는 공격 · 눌러서 그 전선 보기">
                <span>
                  {x.boat ? '⛵' : '⚔'} ← {game.players[x.from].name}
                </span>
                <span className="num">{fmt(x.troops)}</span>
              </button>
            </li>
          ))}
          {attacks.map((a) => (
            <li key={a.id}>
              <span>
                {a.general ? PIECES[a.general.type].glyph : '⚔'} {a.target ? game.players[a.target].name : '무주지'}
              </span>
              <span className="num">{fmt(a.troops)}</span>
              <button
                className="small"
                onClick={() => onRetreat(a.id)}
                title={a.target ? `남은 병력의 ${C.RETREAT_KEEP * 100}%만 돌아옵니다` : '병력이 전원 돌아옵니다'}
              >
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
const FEED_MIN_OPACITY = 0.45;

// 나에게 좋은 사건인지 (노란 테두리)
function goodForMe(e, hid) {
  const [a, b] = e.involved;
  if (e.tag === 'checkmate' || e.tag === 'check' || e.tag === 'capture') return b === hid;
  if (e.tag === 'enpassant' || e.tag === 'promotion' || e.tag === 'castle') return a === hid;
  return false;
}

// 나와 관련된 체스 사건과 체크메이트 · 핵만, 최근 세 줄. 같은 종류 · 같은 상대는 ×N 으로 묶고, 누르면 그곳으로 간다
export function EventLog({ game, onFocus }) {
  const hid = game.humanId;
  const groups = new Map();
  for (const e of game.events) {
    if (game.tick - e.tick >= FEED_TICKS) continue;
    if (!(e.kind === 'big' || e.kind === 'nuke' || (e.kind === 'chess' && e.involved.includes(hid)))) continue;
    if (e.tag === 'capture' && e.data?.type === 'pawn') continue; // 폰 잡힘은 너무 잦아서 뺀다
    if (e.tag === 'check' && e.involved[0] === hid) continue; // 체크 당함은 배너 · 상단 타이머가 알린다
    if (e.data?.nukeId && !game.nukes.some((n) => n.id === e.data.nukeId && !n.done)) continue; // 착탄한 핵 경보는 바로 지운다
    const other = e.involved.find((id) => id !== hid) ?? 0;
    const key = `${e.tag || e.text}:${other}`;
    const g = groups.get(key);
    groups.delete(key); // 다시 넣어 최신 순서로
    groups.set(key, { e, other, n: (g?.n || 0) + 1 });
  }
  const rows = [...groups.values()].slice(-3);
  if (!rows.length) return null;
  return (
    <div className="eventlog">
      {rows.map(({ e, other, n }) => {
        const tile = e.data?.tile >= 0 ? e.data.tile : (game.players[other]?.king ?? -1);
        const tone = goodForMe(e, hid) ? 'ev-good' : e.kind === 'big' || e.tag === 'check' ? 'ev-bad' : '';
        return (
          <button
            key={e.id}
            className={`ev ev-${e.kind} ${tone}`}
            style={{ opacity: Math.max(FEED_MIN_OPACITY, Math.min(1, (FEED_TICKS - (game.tick - e.tick)) / 20)) }}
            disabled={tile < 0}
            onClick={() => onFocus(tile)}
            title="눌러서 그곳 보기"
          >
            {e.text}
            {n > 1 && <b className="ev-count"> ×{n}</b>}
          </button>
        );
      })}
    </div>
  );
}
