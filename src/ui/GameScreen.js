import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import * as C from '../game/constants';
import { PIECES, pieceLabel, josa } from '../game/pieces';
import { castleOptions, enPassantOptions } from '../game/chess';
import MapView, { focusTile } from './MapView';
import { TopBar, Leaderboard, ControlPanel, EventLog } from './Hud';
import ChessPanel, { PromotionDialog } from './ChessPanel';
import ChessBanner from './ChessBanner';
import Coach from './Coach';
import { isMuted, setMuted } from './sound';

const SPEEDS = [1, 2, 3];
const PIECE_KEYS = { 1: 'queen', 2: 'rook', 3: 'bishop', 4: 'knight', 5: 'pawn' };

// 결과 화면: 내 영토 비율 변화를 작은 꺾은선으로
function Sparkline({ values }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.01);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 260},${60 - (v / max) * 56}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 260 62" preserveAspectRatio="none">
      <polyline points={`0,62 ${pts} 260,62`} className="spark-fill" />
      <polyline points={pts} className="spark-line" />
    </svg>
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

  const [ratio, setRatio] = useState(0.3);
  const [mode, setMode] = useState('attack'); // attack | boat | atom | hydrogen | move
  const [generalId, setGeneralId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState(null);
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
  const castle = playing ? castleOptions(game, human.id) : { available: false, reason: '', threat: null, rooks: [] };
  const ep = playing ? enPassantOptions(game, human.id) : [];
  const epReady = ep.find((e) => e.ok);
  const selected = generalId ? game.findGeneral(human.id, generalId) : null;
  // 잡히거나 출격한 장군은 선택에서 뺀다
  const leader = selected && selected.status === 'idle' ? selected : null;
  uiRef.current = { mode, generalId, epPocket: epReady ? epReady.pocket : null, threat: castle.threat };

  const focus = (tile, zoom) => focusTile(camRef.current, game, tile, zoom);

  const cancel = () => {
    setMode('attack');
    if (mode === 'attack') setGeneralId(null);
  };

  const handleTileClick = (tile) => {
    if (tile < 0) return;
    if (game.phase === 'spawn') {
      const res = game.spawnHuman(tile);
      show(res);
      if (res.ok) focus(tile, 5);
      return;
    }
    if (!playing) return;
    if (C.NUKES[mode]) {
      const res = game.launchNuke(human.id, tile, mode);
      show(res);
      if (res.ok) setMode('attack');
      return;
    }
    if (mode === 'move') {
      const res = game.moveGeneral(human.id, generalId, tile);
      show(res);
      if (res.ok) setMode('attack');
      return;
    }
    if (game.owner[tile] === human.id) {
      const here = game.stationed.get(tile);
      const mine = here && [...here].find((g) => g.owner === human.id);
      if (mine) setGeneralId(mine.id === generalId ? null : mine.id);
      return;
    }
    const res = game.launchAttack(human.id, tile, { ratio, generalId: leader?.id, forceBoat: mode === 'boat' });
    show(res);
    if (res.ok) {
      if (leader) setGeneralId(null);
      if (mode === 'boat') setMode('attack');
    }
  };

  // 단축키 (OpenFront 처럼 비율 조절 · 기물 선택을 키보드로)
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      setMode('attack');
      setGeneralId(null);
    } else if (k === ' ') {
      e.preventDefault();
      setPaused((v) => !v);
    } else if (k === 'b') setMode((m) => (m === 'boat' ? 'attack' : 'boat'));
    else if (k === 'q') setRatio((r) => Math.max(0.05, Math.round((r - 0.1) * 100) / 100));
    else if (k === 'e') setRatio((r) => Math.min(1, Math.round((r + 0.1) * 100) / 100));
    else if (k === 'k' && human.king >= 0) focus(human.king, 6);
    else if (k === 'c' && castle.available) show(game.castle(human.id, castle.rooks[0].id));
    else if (PIECE_KEYS[k] && playing) {
      // 같은 종류의 대기 중인 기물을 차례로 고른다
      const ready = human.generals.filter((g) => g.type === PIECE_KEYS[k] && g.status === 'idle');
      if (!ready.length) return show({ ok: false, msg: `대기 중인 ${PIECES[PIECE_KEYS[k]].name}이 없습니다` });
      const i = ready.findIndex((g) => g.id === generalId);
      setGeneralId(ready[(i + 1) % ready.length].id);
    }
    return undefined;
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
      keyRef.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const offer = human.offers[0];
  const allyOffer = human.allianceOffers[0];
  const checkLeft = playing && human.check ? Math.max(0, Math.ceil((C.CHECKMATE_TICKS - (game.tick - human.checkSince)) / 10)) : 0;

  return (
    <div className={`game mode-${mode}`}>
      <MapView game={game} camRef={camRef} uiRef={uiRef} onTileClick={handleTileClick} onCancel={cancel} />
      {playing && human.check > 0 && <div className="check-vignette" />}

      {game.phase === 'spawn' ? (
        <div className="panel spawn-banner">
          <b>시작할 위치를 클릭하세요</b>
          <div className="small-text muted">그 자리에 {PIECES.king.glyph} 킹이 놓입니다 · 킹을 잃으면 패배</div>
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
              setMuted(!isMuted());
              refresh();
            }}
            onExit={onExit}
          />
          {playing && human.check > 0 && (
            <div className="check-timer">
              {PIECES.king.glyph} 체크 — 체크메이트까지 <b>{checkLeft}</b>초
            </div>
          )}
          <Leaderboard
            game={game}
            onFocus={(t) => focus(t, 4)}
            onAlly={(id) => show(game.requestAlliance(human.id, id))}
            onBreak={(id) => show(game.breakAlliance(human.id, id))}
          />
          <Coach game={game} />
          <ControlPanel
            game={game}
            ratio={ratio}
            setRatio={setRatio}
            mode={mode}
            setMode={setMode}
            general={leader}
            clearGeneral={() => setGeneralId(null)}
            onRetreat={(id) => show(game.retreat(human.id, id))}
            onFocus={(t) => focus(t, 5)}
          />
          <ChessPanel
            game={game}
            generalId={generalId}
            threat={castle.threat}
            onSelect={(id) => {
              setGeneralId(id);
              if (mode === 'move') setMode('attack');
            }}
            onFocus={(t) => focus(t, 6)}
            onMove={(id) => {
              setGeneralId(id);
              setMode('move');
            }}
          />
          <EventLog game={game} />
          <ChessBanner game={game} />

          {/* 체스 규칙은 쓸 수 있을 때만 화면 가운데 아래에 큰 버튼으로 뜬다 */}
          <div className="action-dock">
            {offer && <PromotionDialog game={game} offer={offer} onResolve={(gid, yes) => show(game.resolvePromotion(human.id, gid, yes))} />}
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
            {castle.available &&
              castle.rooks.map((r) => (
                <button key={r.id} className="action castle" onClick={() => show(game.castle(human.id, r.id))} title="단축키 C">
                  <span className="action-glyph">{PIECES.rook.glyph}</span>
                  <span>
                    <b>캐슬링</b>
                    <small>킹 ↔ {josa(pieceLabel(r), '과/와')} 자리 바꾸기</small>
                  </span>
                </button>
              ))}
            {epReady && (
              <button className="action enpassant" onClick={() => show(game.enPassant(human.id, epReady.attackId))}>
                <span className="action-glyph">{PIECES.pawn.glyph}</span>
                <span>
                  <b>앙파상</b>
                  <small>{game.players[epReady.attacker].name}의 돌파 부대를 역포위</small>
                </span>
              </button>
            )}
          </div>
        </>
      )}

      {paused && game.phase === 'play' && <div className="paused">일시정지 — Space로 계속</div>}

      {toast && (
        <div key={toast.key} className={`toast ${toast.ok ? '' : 'bad'}`}>
          {toast.msg}
        </div>
      )}

      {game.phase === 'over' && (
        <div className="overlay">
          <div className="panel result">
            <div className="result-glyph">{game.result === 'win' ? PIECES.king.glyph : '✝'}</div>
            <h1>{game.result === 'win' ? '승리!' : '체크메이트'}</h1>
            <p className="muted">
              {game.result === 'win'
                ? '모든 왕을 무너뜨렸거나 대륙의 대부분을 차지했습니다.'
                : human.deathCause === 'nuke'
                  ? '킹이 핵에 맞았습니다.'
                  : `${game.players[human.killedBy]?.name ?? '적'}에게 킹을 잃었습니다.`}
            </p>
            <Sparkline values={game.stats.history} />
            <div className="result-stats">
              <div>
                <b>{Math.floor(game.stats.endTick / 600)}분 {Math.floor((game.stats.endTick / 10) % 60)}초</b>
                <span>버틴 시간</span>
              </div>
              <div>
                <b>{(game.stats.peak * 100).toFixed(1)}%</b>
                <span>최대 영토</span>
              </div>
              <div>
                <b>{game.stats.captured}</b>
                <span>잡은 기물</span>
              </div>
              <div>
                <b>{game.stats.lost}</b>
                <span>잃은 기물</span>
              </div>
              <div>
                <b>{game.stats.mates}</b>
                <span>체크메이트</span>
              </div>
            </div>
            <div className="rule-actions">
              <button className="go" onClick={onRestart}>
                다시 하기
              </button>
              <button onClick={onExit}>로비로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
