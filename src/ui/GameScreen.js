import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import * as C from '../game/constants';
import { PIECES, josa } from '../game/pieces';
import { castleOptions, enPassantOptions } from '../game/chess';
import MapView, { focusTile } from './MapView';
import { TopBar, Leaderboard, ControlPanel, EventLog, DiplomacySheet } from './Hud';
import ChessPanel from './ChessPanel';
import ChessBanner from './ChessBanner';
import Coach from './Coach';
import AlertFrame from './AlertFrame';
import { cycleSoundMode, play, unlock } from './sound';
import { buzz, isTouch, keyHint } from './platform';
import { COACH_GAMES, TIP_GAMES, getGamesPlayed, incGamesPlayed, getRatio, saveRatio, once } from './progress';

const SPEEDS = [1, 2, 3];
const PIECE_KEYS = { 1: 'queen', 2: 'rook', 3: 'bishop', 4: 'knight', 5: 'pawn' };
// 문자 단축키는 e.code 로 본다: 한글 입력 상태에서도 같은 자리의 키가 먹도록
const CODE_KEYS = { KeyQ: 'q', KeyE: 'e', KeyB: 'b', KeyC: 'c', KeyK: 'k' };
const keyOf = (e) => {
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code || '');
  if (digit) return digit[1];
  if (e.key === 'Escape') return 'escape';
  if (e.key === ' ' || e.code === 'Space') return ' ';
  return '';
};
const SPARK_MIN = 0.05; // 그래프 세로 축 최소 높이 (영토 5%)
const URGENT_TICKS = 30; // 체크 마지막 3초
const LOW_TROOPS = 0.1; // 첫 판: 공격 뒤 병력이 상한의 10% 아래로 떨어지면 한 번 막는다
const RESULT_LOCK_MS = 800; // 결과 화면이 뜬 직후 연타로 버튼이 눌리지 않게
const NUKE_AIM_TILES = 3; // 터치 핵: 첫 탭 자리에서 이만큼 안을 다시 탭하면 발사

// 결과 화면: 내 영토 비율 변화를 작은 꺾은선으로
function Sparkline({ values }) {
  if (values.length < 2) return null;
  if (Math.max(...values) - Math.min(...values) < 0.002) return null; // 변화가 없으면 그리지 않는다
  const max = Math.max(...values, SPARK_MIN);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 260},${60 - (v / max) * 56}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 260 62" preserveAspectRatio="none">
      <polyline points={`0,62 ${pts} 260,62`} className="spark-fill" />
      <polyline points={pts} className="spark-line" />
    </svg>
  );
}

// 결과 화면: 한 줄 결론 · 통계 넷 · 로비로(조용히) | 다시 하기(노랑, Enter)
function Result({ game, tip, onExit, onRestart }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), RESULT_LOCK_MS);
    return () => clearTimeout(id);
  }, []);
  const restartRef = useRef(null);
  useEffect(() => {
    if (ready) restartRef.current?.focus();
  }, [ready]);

  const human = game.human;
  const won = game.result === 'win';
  const alive = game.players.filter((p) => p && p.alive && p.spawned);
  // 이긴 나라, 없으면 지금 1위
  const top = game.players[game.winner] || alive.filter((p) => !p.isHuman).sort((a, b) => b.tiles - a.tiles)[0];
  const nation = (p) =>
    p && (
      <>
        <span className="dot" style={{ background: p.color }} /> {p.name}
      </>
    );
  const share = `${Math.round(game.winShare() * 100)}%`;
  let line;
  if (won) line = alive.length === 1 ? '마지막 왕국' : `대륙의 ${share}`;
  else if (human.alive)
    line = (
      <>
        {nation(top)} — 대륙의 {share} 차지
      </>
    );
  else {
    const killer = game.players[human.killedBy];
    const cause = human.deathCause === 'nuke' || !killer ? '킹이 핵에 맞았습니다' : <>{nation(killer)}에게 킹을 잃었습니다</>;
    line = (
      <>
        {cause}
        {top && <> · {nation(top)} 우세</>}
      </>
    );
  }
  const st = game.stats;
  return (
    <div className="overlay result-overlay">
      <div className="panel result">
        <div className="result-glyph">{won ? PIECES.king.glyph : '✝'}</div>
        <h1>{won ? '승리!' : human.alive ? '패배' : '체크메이트'}</h1>
        <p className="result-line">{line}</p>
        <Sparkline values={st.history} />
        <div className="result-stats">
          <div>
            <b>
              {Math.floor(st.endTick / 600)}분 {Math.floor((st.endTick / 10) % 60)}초
            </b>
            <span>{won ? '걸린 시간' : '버틴 시간'}</span>
          </div>
          <div>
            <b>{(st.peak * 100).toFixed(1)}%</b>
            <span>최대 영토</span>
          </div>
          <div>
            <b>{st.bestRank ? `${st.bestRank}위` : '—'}</b>
            <span>최고 순위</span>
          </div>
          <div>
            <b>{st.mates}</b>
            <span>체크메이트</span>
          </div>
        </div>
        {!won && tip && <p className="result-tip muted small-text">병력을 다 쓰면 반격당해요 — 20~30%로 자주 공격하세요</p>}
        <div className="rule-actions result-actions">
          <button className="quiet" disabled={!ready} onClick={onExit}>
            로비로
          </button>
          <button ref={restartRef} className="primary" disabled={!ready} onClick={onRestart} title="같은 설정, 새 지도 (Enter)">
            다시 하기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GameScreen({ config, onExit, onRestart }) {
  const gameRef = useRef(null);
  if (!gameRef.current) {
    gameRef.current = new Game({ seed: config.seed, bots: config.bots, size: config.size, difficulty: config.difficulty, humanName: config.name });
  }
  const game = gameRef.current;
  const human = game.human;
  if (process.env.NODE_ENV === 'development') window.openchess = game; // 개발 중 콘솔에서 살펴보기용
  const camRef = useRef({ x: 0, y: 0, zoom: 0 });
  const uiRef = useRef({});
  const clickFx = useRef(null); // 방금 공격을 보낸 칸: 지도에 노란 링이 잠깐 퍼진다
  const coachRef = useRef(null); // Coach 가 지도에 그려 달라는 표시 ('ring')
  const nukeAim = useRef(-1); // 터치로 핵을 겨눈 칸: 한 번 더 탭해야 쏜다
  // 이 판을 시작하기 전까지 한 판 수: 적을수록 안내를 많이 보여 준다
  const [gamesBefore] = useState(getGamesPlayed);
  const firstGame = gamesBefore === 0;
  // 시작 위치 추천 칸 (한 번만 구한다)
  const spawnHint = useRef(null);
  if (spawnHint.current === null) spawnHint.current = game.phase === 'spawn' ? game.pickSpawnTile() : -1;

  // 공격 비율: 첫 판 20%, 그다음부터는 마지막으로 쓴 값
  const [startRatio] = useState(getRatio);
  const [ratio, setRatioRaw] = useState(startRatio);
  const setRatio = useCallback((v) => {
    setRatioRaw((r) => {
      const next = typeof v === 'function' ? v(r) : v;
      saveRatio(next);
      return next;
    });
  }, []);
  const [mode, setMode] = useState('attack'); // attack | boat | atom | hydrogen
  const [pieceType, setPieceType] = useState(null); // 다음 공격을 이끌 기물 종류
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState(null);
  const [sheet, setSheet] = useState(0); // 길게 눌러 연 외교 시트의 나라 (0 = 닫힘)
  const [dismissed, setDismissed] = useState(() => new Set()); // 닫은 동맹 만료 카드 ("나라:만료 틱")
  const [, setFrame] = useState(0);
  const refresh = useCallback(() => setFrame((f) => f + 1), []);

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => game.update(), C.TICK_MS / speed);
    return () => clearInterval(id);
  }, [game, paused, speed]);

  useEffect(() => {
    const id = setInterval(refresh, 250);
    return () => clearInterval(id);
  }, [refresh]);

  // 브라우저는 사용자 제스처 전에는 소리를 막는다: 첫 클릭에서 오디오를 깨운다
  useEffect(() => {
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // 모드가 바뀌면 (핵 해제 · 다른 핵) 겨눈 자리를 지운다
  useEffect(() => {
    nukeAim.current = -1;
  }, [mode]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const show = useCallback(
    (res) => {
      if (res?.msg) setToast({ ok: res.ok, msg: res.msg, key: Date.now() });
      refresh();
    },
    [refresh]
  );

  const playing = game.phase === 'play' && human.alive;
  const castle = playing ? castleOptions(game, human.id) : { available: false, reason: '', threat: null };
  const ep = playing ? enPassantOptions(game, human.id) : [];
  const epReady = ep.find((e) => e.ok);
  // 고른 종류의 기물 중 성에서 대기 중인 하나가 다음 공격을 이끈다
  const leader = pieceType && playing ? game.readyPiece(human.id, pieceType) : null;
  // 체크메이트까지 남은 틱. 마지막 3초는 소수 첫째 자리까지 보여 주고 지도도 깜빡인다
  const checkTicks = playing && human.check ? Math.max(0, C.CHECKMATE_TICKS - (game.tick - human.checkSince)) : 0;
  const urgent = checkTicks > 0 && checkTicks <= URGENT_TICKS;
  uiRef.current = {
    mode,
    epPocket: epReady ? epReady.pocket : null,
    epKey: epReady ? epReady.attackId : null,
    threat: castle.threat,
    urgent,
    clickFx: clickFx.current,
    coachRing: coachRef.current === 'ring',
    spawnHint: spawnHint.current,
    nukeAim: nukeAim.current,
  };

  const focus = (tile, zoom) => focusTile(camRef.current, game, tile, zoom);

  const cancel = () => {
    nukeAim.current = -1;
    setMode('attack');
    if (mode === 'attack') setPieceType(null);
  };

  const handleTileClick = (tile, pointerType) => {
    if (tile < 0) return;
    if (game.phase === 'spawn') {
      const res = game.spawnHuman(tile);
      show(res);
      if (res.ok) focus(tile, 5);
      return;
    }
    if (!playing) return;
    if (C.NUKES[mode]) {
      if (game.owner[tile] === human.id) return show({ ok: false, msg: '내 땅에는 쏠 수 없습니다' });
      // 터치: 첫 탭은 조준만, 같은 곳(3칸 안)을 한 번 더 탭하면 발사 (끌다 미끄러진 손가락이 금을 날리지 않게)
      if (pointerType === 'touch') {
        const aim = nukeAim.current;
        if (aim < 0 || game.dist2(aim, tile) > NUKE_AIM_TILES * NUKE_AIM_TILES) {
          nukeAim.current = tile;
          buzz();
          return refresh();
        }
        tile = aim;
      }
      nukeAim.current = -1;
      const res = game.launchNuke(human.id, tile, mode);
      show(res);
      if (res.ok) {
        buzz();
        setMode('attack');
      }
      return;
    }
    if (game.owner[tile] === human.id) return;
    if (pieceType && !leader) return show({ ok: false, msg: `성에 대기 중인 ${josa(PIECES[pieceType].name, '이/가')} 없습니다` });
    // 첫 판: 병력을 거의 다 쏟아붓는 클릭은 한 번만 막고 알려 준다
    if (firstGame && human.troops * (1 - ratio) < game.maxTroopsOf(human) * LOW_TROOPS && once('lowTroops')) {
      setToast({ ok: false, msg: '병력이 너무 적어요 — 잠시 기다리세요', key: Date.now(), center: true });
      return;
    }
    const res = game.launchAttack(human.id, tile, { ratio, generalId: leader?.id, forceBoat: mode === 'boat' });
    show(res);
    if (res.ok) {
      play('launch');
      if (pointerType === 'touch') buzz();
      clickFx.current = { tile, t: performance.now() };
      if (leader) setPieceType(null);
      if (mode === 'boat') setMode('attack');
    }
  };

  // 단축키 (OpenFront 처럼 비율 조절 · 기물 선택을 키보드로)
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    const k = keyOf(e);
    if (k === 'escape') {
      if (game.phase === 'spawn') return onExit(); // 시작 위치를 고르기 전이면 로비로
      nukeAim.current = -1;
      setSheet(0);
      setMode('attack');
      setPieceType(null);
    } else if (k === ' ') {
      if (game.phase !== 'play') return;
      e.preventDefault();
      setPaused((v) => !v);
    } else if (k === 'b') setMode((m) => (m === 'boat' ? 'attack' : 'boat'));
    else if (k === 'q') setRatio((r) => Math.max(0.05, Math.round((r - 0.1) * 100) / 100));
    else if (k === 'e') setRatio((r) => Math.min(1, Math.round((r + 0.1) * 100) / 100));
    else if (k === 'k' && human.king >= 0) focus(human.king, 6);
    else if (k === 'c' && playing) show(castle.available ? game.castle(human.id) : { ok: false, msg: castle.reason });
    else if (PIECE_KEYS[k] && playing) {
      const t = PIECE_KEYS[k];
      // 전부 잡힌 기물은 고를 수 없다 (패널 버튼도 꺼져 있다)
      if (!human.generals.some((g) => g.type === t && g.status !== 'captured'))
        return show({ ok: false, msg: `${josa(PIECES[t].name, '은/는')} 모두 잡혔습니다` });
      setPieceType((cur) => (cur === t ? null : t));
    }
  };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      // 글을 쓰는 칸에서만 단축키를 끈다 (비율 슬라이더를 만진 뒤에도 단축키는 그대로)
      const typing = (t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'TEXTAREA' || t.isContentEditable;
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      keyRef.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allyOffer = playing ? human.allianceOffers[0] : null;
  // 곧 끝나는 동맹 중 가장 임박한 하나 (닫지 않은 것만)
  let expiring = null;
  if (playing) {
    for (const p of game.players) {
      if (!p || !game.allied(human.id, p.id)) continue;
      const left = game.allianceLeft(human.id, p.id);
      const key = `${p.id}:${game.tick + left}`;
      if (left <= C.ALLIANCE_RENEW_TICKS && !dismissed.has(key) && (!expiring || left < expiring.left)) expiring = { id: p.id, left, key };
    }
  }
  const closeExpiring = () => setDismissed((d) => new Set(d).add(expiring.key));
  const checkLeft = Math.ceil(checkTicks / 10);

  // 소리로 알리는 흐름: 체크 마지막 3 · 2 · 1초, 평화 기간 끝, 판 끝
  const cue = useRef({ sec: 0, peace: game.peaceLeft(), over: false, counted: false });
  useEffect(() => {
    const c = cue.current;
    if (checkLeft !== c.sec && checkLeft > 0 && checkLeft <= URGENT_TICKS / 10) play('tick');
    c.sec = checkLeft;
    if (game.phase !== 'spawn' && !c.counted) {
      c.counted = true;
      incGamesPlayed(); // 시작 위치를 고른 순간 한 판으로 센다
    }
    const peace = game.phase === 'play' ? game.peaceLeft() : 0;
    if (c.peace > 0 && peace === 0 && game.phase === 'play') play('peaceEnd');
    c.peace = peace;
    if (game.phase === 'over' && !c.over) {
      c.over = true;
      const won = game.result === 'win';
      setTimeout(() => play(won ? 'victory' : 'defeat'), 600); // 체크메이트음과 겹치지 않게
    }
  });

  // 다른 탭에 있을 때 체크 · 배신을 탭 제목으로 알린다
  useEffect(() => {
    const original = document.title;
    let flip = false;
    const update = () => {
      const h = game.human;
      const live = game.phase === 'play' && h?.alive;
      const betrayed = live && game.events.some((e) => e.tag === 'betray' && e.involved[1] === h.id && game.tick - e.tick < 100);
      if (!document.hidden || !live || (!h.check && !betrayed)) {
        document.title = original;
        return;
      }
      flip = !flip;
      const left = Math.max(0, Math.ceil((C.CHECKMATE_TICKS - (game.tick - h.checkSince)) / 10));
      document.title = h.check ? `${flip ? PIECES.king.glyph : '·'} 체크! ${left}초 — OpenChess` : `${flip ? '⚠' : '·'} 배신! — OpenChess`;
    };
    const id = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', update);
      document.title = original;
    };
  }, [game]);

  // 터치: 남의 나라 땅을 길게 누르면 외교 시트 (한 번에 하나)
  const handleLongPress = (tile) => {
    if (!playing || tile < 0) return;
    const o = game.owner[tile];
    if (!o || o === human.id) return;
    buzz();
    setSheet(o);
  };
  const pickPiece = (t) => {
    if (t && isTouch) buzz();
    setPieceType(t);
  };

  // 추천 칸(노란 원)에서 시작, 안 되면 다른 빈자리를 몇 번 더 찾는다
  const randomSpawn = () => {
    let t = spawnHint.current;
    for (let i = 0; i < 10 && game.phase === 'spawn'; i++) {
      if (t >= 0 && game.spawnHuman(t).ok) break;
      t = game.pickSpawnTile();
    }
    if (game.phase === 'spawn') return show({ ok: false, msg: '빈자리를 찾지 못했어요 — 직접 골라 주세요' });
    show({ ok: true, msg: '시작!' });
    focus(game.human.king, 5);
  };

  // 토스트는 게임 중엔 아래 묶음 안에 둔다 (폰에서 체스 버튼 · 동맹 카드 위로 쌓이게)
  const toastEl = toast && (
    <div key={toast.key} className={`toast ${toast.ok ? '' : 'bad'} ${toast.center ? 'center' : ''}`}>
      {!toast.ok && '✕ '}
      {toast.msg}
    </div>
  );

  return (
    <div className="game">
      <MapView game={game} camRef={camRef} uiRef={uiRef} onTileClick={handleTileClick} onCancel={cancel} onLongPress={handleLongPress} />
      {game.phase === 'play' && <AlertFrame game={game} />}

      {game.phase === 'spawn' ? (
        <div className="panel spawn-banner">
          <b>{firstGame ? '노란 원을 누르거나 아무 데나 고르세요' : '시작할 위치를 고르세요'}</b>
          <div className="small-text muted">
            그 자리에 <span className="glyph inline-glyph">{PIECES.king.glyph}</span> 킹이 놓입니다 · 킹을 잃으면 패배
          </div>
          <div className="spawn-actions">
            <button className="small quiet" onClick={onExit} title={`로비로${keyHint('Esc')}`}>
              ← 로비
            </button>
            <button className="small" onClick={randomSpawn}>
              랜덤 시작
            </button>
          </div>
        </div>
      ) : (
        <>
          <TopBar
            game={game}
            paused={paused}
            speed={speed}
            onPause={() => setPaused((v) => !v)}
            onSpeed={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
            onMute={() => {
              unlock();
              cycleSoundMode();
              refresh();
            }}
            onExit={() => {
              // 진행 중인 판은 한 번 묻고 버린다 (음소거 옆이라 잘못 누르기 쉽다)
              if (playing && !window.confirm('이 판을 그만둘까요?')) return;
              onExit();
            }}
          />
          {/* 상단 가운데 알림 묶음: 체크 타이머 → 안내 → 작은 체스 배너 (큰 배너는 따로 위치) */}
          <div className="top-stack">
            {playing && human.check > 0 && (
              <div className={`check-timer ${urgent ? 'urgent' : ''}`}>
                <span className="glyph inline-glyph">{PIECES.king.glyph}</span> 체크 — 체크메이트까지 <b>{urgent ? (checkTicks / 10).toFixed(1) : checkLeft}</b>초
              </div>
            )}
            {gamesBefore < COACH_GAMES && <Coach game={game} ui={{ ratioMoved: ratio !== startRatio, firstGame }} coachRef={coachRef} />}
            {game.phase !== 'over' && <ChessBanner game={game} />}
          </div>
          <Leaderboard
            game={game}
            onFocus={(t) => focus(t, 4)}
            onAlly={(id) => show(game.requestAlliance(human.id, id))}
            onBreak={(id) => show(game.breakAlliance(human.id, id))}
          />
          {playing && sheet > 0 && (
            <DiplomacySheet
              game={game}
              id={sheet}
              onFocus={(t) => focus(t, 4)}
              onAlly={(id) => show(game.requestAlliance(human.id, id))}
              onBreak={(id) => show(game.breakAlliance(human.id, id))}
              onClose={() => setSheet(0)}
            />
          )}
          {/* 아래쪽 묶음: 넓은 화면에서는 따로 놓이고, 폰에서는 한 덩어리로 아래에 쌓인다 */}
          <div className="bottom-dock">
            {toastEl}
            <ControlPanel
              game={game}
              ratio={ratio}
              setRatio={setRatio}
              mode={mode}
              setMode={setMode}
              pieceType={pieceType}
              clearPiece={() => setPieceType(null)}
              onRetreat={(id) => show(game.retreat(human.id, id))}
              onFocus={(t) => focus(t, 5)}
            />
            <ChessPanel game={game} pieceType={pieceType} threat={castle.threat} onPick={pickPiece} onFocus={(t) => focus(t, 6)} />

            {/* 체스 규칙은 쓸 수 있을 때만 화면 가운데 아래에 큰 버튼으로 뜬다 */}
            <div className="action-dock">
              {allyOffer && (
                <div className="panel action-card alliance">
                  <div className="promo-glyphs">🤝</div>
                  <div>
                    <b>{josa(game.players[allyOffer.from].name, '이/가')} 동맹을 제안합니다</b>
                    <div className="muted small-text">
                      {C.ALLIANCE_TICKS / 600}분 동안 서로 공격하지 않습니다 · {Math.ceil((allyOffer.until - game.tick) / 10)}초 안에 답하세요
                    </div>
                  </div>
                  <div className="rule-actions">
                    <button className="go" onClick={() => show(game.resolveAllianceOffer(human.id, allyOffer.from, true))}>
                      수락
                    </button>
                    <button onClick={() => show(game.resolveAllianceOffer(human.id, allyOffer.from, false))}>거절</button>
                  </div>
                </div>
              )}
              {expiring && (
                <div className="panel action-card alliance">
                  <div className="promo-glyphs">🤝</div>
                  <div>
                    <b>{josa(game.players[expiring.id].name, '과/와')}의 동맹이 곧 끝납니다</b>
                    <div className="muted small-text">{Math.ceil(expiring.left / 10)}초 남음</div>
                  </div>
                  <div className="rule-actions">
                    <button
                      className="go"
                      onClick={() => {
                        const res = game.renewAlliance(human.id, expiring.id);
                        if (!res.ok) closeExpiring();
                        show(res);
                      }}
                    >
                      연장
                    </button>
                    <button onClick={closeExpiring}>닫기</button>
                  </div>
                </div>
              )}
              {castle.available && (
                <button className="action castle" onClick={() => show(game.castle(human.id))} title={isTouch ? '한 판에 한 번' : '단축키 C · 한 판에 한 번'}>
                  <span className="action-glyph">{PIECES.rook.glyph}</span>
                  <span>
                    <b>캐슬링</b>
                    <small>룩이 킹을 영토 가장 안쪽으로 피신{keyHint('C')}</small>
                  </span>
                </button>
              )}
              {epReady && (
                <button className="action enpassant" onClick={() => show(game.enPassant(human.id, epReady.attackId))}>
                  <span className="action-glyph">{PIECES.pawn.glyph}</span>
                  <span>
                    <b>앙파상</b>
                    <small>폰 출동 — {game.players[epReady.attacker].name}의 돌파 부대를 역포위</small>
                  </span>
                </button>
              )}
            </div>
          </div>
          <EventLog game={game} onFocus={(t) => focus(t, 5)} />
        </>
      )}

      {paused && game.phase === 'play' && <div className="paused">{isTouch ? '일시정지 — ▶를 누르면 계속' : '일시정지 — Space로 계속'}</div>}

      {game.phase === 'spawn' && toastEl}

      {game.phase === 'over' && <Result game={game} tip={gamesBefore < TIP_GAMES} onExit={onExit} onRestart={onRestart} />}
    </div>
  );
}
