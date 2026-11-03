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
        <p className="muted">OpenFront 식 영토 전쟁 + 체스 킹 · 기물 · 특수 규칙</p>
      </header>

      <section className="intro">
        <div className="panel">
          <span className="intro-glyph">⚔</span>
          <span>
            <b>땅을 넓혀라</b>
            <span className="small-text muted">클릭 한 번으로 공격 · 슬라이더로 병력 비율 · 바다는 배로. OpenFront 그대로</span>
          </span>
        </div>
        <div className="panel">
          <span className="intro-glyph">{PIECES.knight.glyph}</span>
          <span>
            <b>기물로 이끌어라</b>
            <span className="small-text muted">버튼 1~5로 기물을 골라 공격 — 나이트는 돌파, 룩은 강공, 비숍은 상륙</span>
          </span>
        </div>
        <div className="panel">
          <span className="intro-glyph">{PIECES.king.glyph}</span>
          <span>
            <b>킹을 지켜라</b>
            <span className="small-text muted">궁성에 적이 오면 체크! 캐슬링 · 앙파상 버튼이 그때 떠요</span>
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
        <h2>기본 — OpenFront 그대로</h2>
        <ul>
          <li>빈 땅이나 적 땅을 클릭하면 슬라이더 비율(Q/E)만큼 병력을 보내 공격합니다. 바다 건너는 배로 갑니다.</li>
          <li>영토가 넓을수록 병력과 금이 늘어납니다. 시작 {C.PEACE_TICKS / 10}초는 평화 기간이라 빈 땅만 넓힐 수 있어요.</li>
          <li>순위표에서 나라를 누르면 동맹, 금이 모이면 핵. 다른 나라의 킹을 모두 잡으면 승리합니다.</li>
        </ul>

        <h2>체스 — 킹과 기물</h2>
        <ul>
          <li>
            {PIECES.king.glyph} <b>킹</b>은 수도입니다. 킹 주변 점선 원(궁성)에 적이 들어오면 <b>체크</b>, {C.CHECKMATE_TICKS / 10}초 안에
            몰아내지 못하면 <b>체크메이트</b>로 패배합니다.
          </li>
          <li>
            기물은 성 안에서 대기합니다. 오른쪽 버튼(1~5)으로 고르고 공격하면 그 기물이 이끕니다. 맞공격에 지면 잡혀요.
          </li>
        </ul>
        <table className="piece-table">
          <tbody>
            {PIECE_ORDER.map((k, i) => (
              <tr key={k}>
                <td className="glyph">{PIECES[k].glyph}</td>
                <td>
                  <b>{PIECES[k].name}</b> <span className="muted">({i + 1})</span>
                </td>
                <td className="num">금 {fmt(PIECES[k].cost)}</td>
                <td>{PIECES[k].role}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>체스 특수 규칙 — 그때그때 버튼이 떠요</h2>
        <ul>
          <li>
            <b>캐슬링</b> — 체크일 때 한 번, 룩이 킹을 영토 가장 안쪽으로 피신시킵니다 (C).
          </li>
          <li>
            <b>앙파상</b> — 적이 우리 땅을 깊게 파고들어 거의 둘러싸이면, 성의 폰이 출동해 그 땅을 되찾고 부대를 섬멸합니다.
          </li>
          <li>
            <b>프로모션</b> — 폰이 다른 기물을 이기면 그 기물로 바뀝니다.
          </li>
        </ul>
      </details>
    </div>
  );
}
