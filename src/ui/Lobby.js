import { useState } from 'react';
import * as C from '../game/constants';
import { PIECES, PIECE_ORDER } from '../game/pieces';
import { DIFFICULTY } from '../game/bot';
import { fmt } from '../game/Game';

const randomSeed = () => Math.floor(Math.random() * 99999) + 1;

export default function Lobby({ onStart, initial }) {
  const [name, setName] = useState(initial?.name || '나');
  const [size, setSize] = useState(initial?.size || 'normal');
  const [bots, setBots] = useState(initial?.bots || C.MAP_SIZES.normal.bots);
  const [difficulty, setDifficulty] = useState(initial?.difficulty || 'normal');
  const [seed, setSeed] = useState(randomSeed);

  const start = (e) => {
    e.preventDefault();
    onStart({ name: name.trim() || '나', bots, size, difficulty, seed: Number(seed) || 1 });
  };

  return (
    <div className="lobby">
      <header>
        <h1>
          <span className="logo-glyph">{PIECES.king.glyph}</span> OpenChess
        </h1>
        <p className="muted">OpenFront 식 영토 전쟁 + 체스 장군 · 킹 · 특수 규칙</p>
      </header>

      <section className="intro">
        <div className="panel">
          <span className="intro-glyph">{PIECES.king.glyph}</span>
          <span>
            <b>킹을 지켜라</b>
            <span className="small-text muted">킹 주변 궁성에 적이 들어오면 체크, {C.CHECKMATE_TICKS / 10}초 버티지 못하면 체크메이트</span>
          </span>
        </div>
        <div className="panel">
          <span className="intro-glyph">{PIECES.knight.glyph}</span>
          <span>
            <b>기물로 출격</b>
            <span className="small-text muted">룩은 넓게, 나이트는 정면돌파, 비숍은 대각선 — 금으로 장군을 붙여 공격</span>
          </span>
        </div>
        <div className="panel">
          <span className="intro-glyph">{PIECES.rook.glyph}</span>
          <span>
            <b>체스 규칙</b>
            <span className="small-text muted">캐슬링으로 탈출, 앙파상으로 역포위, 폰은 프로모션</span>
          </span>
        </div>
      </section>

      <form className="panel lobby-form" onSubmit={start}>
        <label>
          이름
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          지도 크기
          <span className="segmented">
            {Object.entries(C.MAP_SIZES).map(([k, m]) => (
              <button
                key={k}
                type="button"
                className={size === k ? 'active' : ''}
                title={`${m.width}×${m.height}`}
                onClick={() => {
                  setSize(k);
                  setBots(m.bots);
                }}
              >
                {m.label}
              </button>
            ))}
          </span>
        </label>
        <label>
          <span>
            봇 나라 <b>{bots}</b>
          </span>
          <input type="range" min="2" max={C.MAX_BOTS} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
        </label>
        <label>
          난이도
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {Object.entries(DIFFICULTY).map(([k, d]) => (
              <option key={k} value={k}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          지도 번호
          <span className="seed">
            <input type="number" min="1" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <button type="button" onClick={() => setSeed(randomSeed())} title="다른 지도">
              🎲
            </button>
          </span>
        </label>
        <button className="go big" type="submit">
          시작
        </button>
      </form>

      <details className="panel rules">
        <summary>규칙 보기</summary>
        <h2>기본 (OpenFront 그대로)</h2>
        <ul>
          <li>지도의 빈 땅이나 적 땅을 클릭하면 아래 슬라이더 비율만큼 병력을 보내 공격합니다. 맞닿지 않은 곳은 배로 건너갑니다.</li>
          <li>병력은 영토가 넓을수록 많이, 최대치에 가까울수록 천천히 찹니다. 금으로 장군을 출격시키고 핵을 쏩니다.</li>
          <li>
            시작하고 <b>{C.PEACE_TICKS / 10}초</b>는 평화 기간 — 무주지만 넓힐 수 있고 다른 나라는 공격할 수 없습니다.
          </li>
          <li>마우스 휠로 확대, 끌어서 이동. Esc 취소, Space 일시정지, B 상륙 모드.</li>
        </ul>

        <h2>킹</h2>
        <p>
          처음 고른 칸에 {PIECES.king.glyph} 킹이 놓이고 <b>움직일 수 없습니다</b>. 킹 주변 {C.PALACE_RADIUS}칸은 <b>궁성</b>으로, 점령
          비용이 {C.PALACE_MULT}배입니다. 적이 궁성에 들어오면 <b>체크</b>이고, 체크가 {C.CHECKMATE_TICKS / 10}초 이어진 뒤 킹 칸까지
          빼앗기면 체크메이트 — 킹을 잡은 나라는 킹 주변 {C.HEIR_LAND_RADIUS}칸 안의 영토와 금 {C.HEIR_GOLD_SHARE * 100}%를 가져가고,
          나머지 땅은 무주지가 됩니다. 킹이 <b>핵에 맞으면</b> 그대로 패배하고 땅은 모두 무주지가 됩니다.
        </p>

        <h2>장군 (체스 기물)</h2>
        <table className="piece-table">
          <tbody>
            {PIECE_ORDER.map((k) => (
              <tr key={k}>
                <td className="glyph">{PIECES[k].glyph}</td>
                <td>
                  <b>{PIECES[k].name}</b>
                </td>
                <td className="num">금 {fmt(PIECES[k].cost)}</td>
                <td>{PIECES[k].role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small-text">
          대기 중인 장군은 지도 위 칸에 서 있습니다. 공격이 끝나면 마지막으로 점령한 칸에 머물고, 그 칸을 빼앗기면 잡힙니다. 내 땅
          어디로든 재배치할 수 있습니다.
        </p>

        <h2>외교</h2>
        <p>
          순위표에서 나라를 누르면 <b>동맹</b>을 제안합니다. 동맹은 {C.ALLIANCE_TICKS / 600}분 동안 서로 공격할 수 없고, 깨면{' '}
          {C.TRAITOR_TICKS / 600}분 동안 <b>배신자</b>가 되어 모두의 표적이 됩니다. 공격을 마친 장군은 {C.GENERAL_REST_TICKS / 10}초
          쉬어야 다시 출격합니다.
        </p>

        <h2>특수 규칙</h2>
        <ul>
          <li>
            <b>프로모션</b> — 폰이 다른 장군과의 전투(맞공격 · 해전 · 주둔지 점령 · 앙파상)에서 이기면 그 기물로 바꿀지 고릅니다. 한 번
            바꾸면 되돌릴 수 없습니다.
          </li>
          <li>
            <b>캐슬링</b> — 킹이 위협받을 때(체크, 근처까지 온 적 공격, 킹을 노리는 나이트 · 배 · 핵) 대기 중인 룩과 킹의 자리를 맞바꿉니다. 한
            판에 한 번.
          </li>
          <li>
            <b>앙파상</b> — 적 공격이 최근 {C.EP_WINDOW / 10}초 안에 {C.EP_MIN_TILES}칸 이상, {C.EP_MIN_DEPTH}칸 이상 깊이 파고들었고, 그
            둘레의 {Math.round(C.EP_MIN_ENCIRCLE * 100)}% 이상이 우리 땅이며, {C.EP_PAWN_RANGE}칸 안에 대기 중인 폰이 있으면 — 돌파 지역을
            통째로 되찾고 그 부대를 섬멸합니다.
          </li>
        </ul>
      </details>
    </div>
  );
}
