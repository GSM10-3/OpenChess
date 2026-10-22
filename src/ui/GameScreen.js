import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import * as C from '../game/constants';
import { PIECES } from '../game/pieces';
import { castleOptions, enPassantOptions } from '../game/chess';
import MapView, { focusTile } from './MapView';
import { TopBar, Leaderboard, ControlPanel, EventLog } from './Hud';
import ChessPanel from './ChessPanel';

const SPEEDS = [1, 2, 3];

export default function GameScreen({ config, onExit, onRestart }) {
  const gameRef = useRef(null);
  if (!gameRef.current) {
    gameRef.current = new Game({ seed: config.seed, bots: config.bots, difficulty: config.difficulty, humanName: config.name });
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        setMode('attack');
        setGeneralId(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPaused((v) => !v);
      } else if (e.key === 'b' || e.key === 'B') setMode((m) => (m === 'boat' ? 'attack' : 'boat'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const offer = human.offers[0];

  return (
    <div className={`game mode-${mode}`}>
      <MapView game={game} camRef={camRef} uiRef={uiRef} onTileClick={handleTileClick} onCancel={cancel} />

      {game.phase === 'spawn' ? (
        <div className="panel spawn-banner">
          <b>시작할 위치를 고르세요</b>
          <div className="small-text">
            클릭한 칸에 {PIECES.king.glyph} 킹이 놓입니다. 킹은 움직일 수 없고, 그 칸을 빼앗기거나 핵에 맞으면 패배합니다.
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
            onExit={onExit}
          />
          <Leaderboard game={game} />
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
            castle={castle}
            ep={ep}
            offer={offer}
            onResolve={(gid, yes) => show(game.resolvePromotion(human.id, gid, yes))}
            onSelect={(id) => {
              setGeneralId(id);
              if (mode === 'move') setMode('attack');
            }}
            onFocus={(t) => focus(t, 6)}
            onMove={(id) => {
              setGeneralId(id);
              setMode('move');
            }}
            onCastle={(rookId) => show(game.castle(human.id, rookId))}
            onEnPassant={(attackId) => show(game.enPassant(human.id, attackId))}
          />
          <EventLog game={game} />
          {epReady && (
            <button className="ep-alert" onClick={() => show(game.enPassant(human.id, epReady.attackId))}>
              {PIECES.pawn.glyph} 앙파상 가능! {game.players[epReady.attacker].name}의 돌파 부대를 역포위
            </button>
          )}
        </>
      )}

      {paused && game.phase === 'play' && <div className="paused">일시정지 — Space 로 계속</div>}

      {toast && (
        <div key={toast.key} className={`toast ${toast.ok ? '' : 'bad'}`}>
          {toast.msg}
        </div>
      )}

      {game.phase === 'over' && (
        <div className="overlay">
          <div className="panel result">
            <h1>{game.result === 'win' ? '승리!' : '패배'}</h1>
            <p>
              {game.result === 'win'
                ? '모든 왕을 무너뜨렸거나 대륙의 대부분을 차지했습니다.'
                : human.deathCause === 'nuke'
                  ? '킹이 핵에 맞았습니다.'
                  : `체크메이트 — ${game.players[human.killedBy]?.name ?? '적'}에게 킹을 잃었습니다.`}
            </p>
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
