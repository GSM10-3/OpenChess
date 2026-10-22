import { useState } from 'react';
import * as C from '../game/constants';
import { PIECES, PIECE_ORDER } from '../game/pieces';
import { DIFFICULTY } from '../game/bot';
import { fmt } from '../game/Game';

const randomSeed = () => Math.floor(Math.random() * 99999) + 1;

export default function Lobby({ onStart, initial }) {
  const [name, setName] = useState(initial?.name || '나');
  const [bots, setBots] = useState(initial?.bots || 7);
  const [difficulty, setDifficulty] = useState(initial?.difficulty || 'normal');
  const [seed, setSeed] = useState(randomSeed);

  const start = (e) => {
    e.preventDefault();
    onStart({ name: name.trim() || '나', bots, difficulty, seed: Number(seed) || 1 });
  };

  return (
    <div className="lobby">
      <header>
        <h1>
          <span className="logo-glyph">{PIECES.king.glyph}</span> OpenChess
        </h1>
        <p className="muted">OpenFront 식 영토 전쟁 + 체스 장군 · 킹 · 특수 규칙</p>
      </header>

      <form className="panel lobby-form" onSubmit={start}>
        <label>
          이름
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          봇 나라 <b>{bots}</b>
          <input type="range" min="2" max="9" value={bots} onChange={(e) => setBots(Number(e.target.value))} />
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

      <section className="panel rules">
        <h2>기본 (OpenFront 그대로)</h2>
        <ul>
          <li>지도의 빈 땅이나 적 땅을 클릭하면 아래 슬라이더 비율만큼 병력을 보내 공격합니다. 맞닿지 않은 곳은 배로 건너갑니다.</li>
          <li>병력은 영토가 넓을수록 많이, 최대치에 가까울수록 천천히 찹니다. 금으로 장군을 출격시키고 핵을 쏩니다.</li>
          <li>마우스 휠로 확대, 끌어서 이동. Esc 취소, Space 일시정지, B 상륙 모드.</li>
        </ul>

        <h2>킹</h2>
        <p>
          처음 고른 칸에 {PIECES.king.glyph} 킹이 놓이고 <b>움직일 수 없습니다</b>. 킹이 있는 칸을 빼앗기면 체크메이트 — 그 나라의 남은
          영토와 금은 킹을 잡은 나라가 가져갑니다. 킹이 <b>핵에 맞으면</b> 그대로 패배하고 땅은 무주지가 됩니다.
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

        <h2>특수 규칙</h2>
        <ul>
          <li>
            <b>프로모션</b> — 폰이 다른 장군과의 전투(맞공격 · 해전 · 주둔지 점령 · 앙파상)에서 이기면 그 기물로 바꿀지 고릅니다. 한 번
            바꾸면 되돌릴 수 없습니다.
          </li>
          <li>
            <b>캐슬링</b> — 킹이 위협받을 때(근처까지 온 적 공격, 킹을 노리는 나이트 · 배 · 핵) 대기 중인 룩과 킹의 자리를 맞바꿉니다. 한
            판에 한 번.
          </li>
          <li>
            <b>앙파상</b> — 적 공격이 최근 {C.EP_WINDOW / 10}초 안에 {C.EP_MIN_TILES}칸 이상, {C.EP_MIN_DEPTH}칸 이상 깊이 파고들었고, 그
            둘레의 {Math.round(C.EP_MIN_ENCIRCLE * 100)}% 이상이 우리 땅이며, {C.EP_PAWN_RANGE}칸 안에 대기 중인 폰이 있으면 — 돌파 지역을
            통째로 되찾고 그 부대를 섬멸합니다.
          </li>
        </ul>
      </section>
    </div>
  );
}
