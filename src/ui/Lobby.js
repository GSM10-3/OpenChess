import { useEffect, useState } from 'react';
import * as C from '../game/constants';
import { PIECES, PIECE_ORDER } from '../game/pieces';
import { DIFFICULTY } from '../game/bot';
import { fmt } from '../game/Game';
import { unlock } from './sound';
import { getGamesPlayed, getLobby, saveLobby } from './progress';

const randomSeed = () => Math.floor(Math.random() * 99999) + 1;

// 이름을 비워 두면 쓰는 체스 테마 이름 ('날쌘 기사' 처럼)
const NAME_ADJ = ['날쌘', '용감한', '조용한', '붉은', '푸른', '영리한', '젊은', '늙은'];
const NAME_NOUN = ['기사', '성주', '주교', '파수꾼', '전령', '궁수', '장군', '영주'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const randomName = () => `${pick(NAME_ADJ)} ${pick(NAME_NOUN)}`;

function Segmented({ value, options, onChange }) {
  return (
    <span className="segmented">
      {options.map(([k, label, title]) => (
        <button key={k} type="button" className={value === k ? 'active' : ''} title={title} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </span>
  );
}

// 첫 화면: 로고 · 이름 · 플레이 버튼이 전부. 나머지 설정은 접어 두고, 규칙은 창으로.
export default function Lobby({ onStart, initial }) {
  // 지난 설정을 기억한다 (저장값 우선). 첫 판은 쉬움으로
  const [saved] = useState(() => ({ ...initial, ...getLobby() }));
  const [firstGame] = useState(() => getGamesPlayed() === 0);
  const [name, setName] = useState(typeof saved.name === 'string' ? saved.name : '');
  const [autoName] = useState(randomName);
  const [size, setSize] = useState(C.MAP_SIZES[saved.size] ? saved.size : 'normal');
  const [bots, setBots] = useState(Number(saved.bots) || C.MAP_SIZES[C.MAP_SIZES[saved.size] ? saved.size : 'normal'].bots);
  const [difficulty, setDifficulty] = useState(firstGame ? 'easy' : DIFFICULTY[saved.difficulty] ? saved.difficulty : 'normal');
  const [seed, setSeed] = useState(randomSeed);
  const [more, setMore] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => {
    if (!rulesOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setRulesOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rulesOpen]);

  const start = (e) => {
    e.preventDefault();
    unlock(); // 플레이를 누른 순간에 소리를 깨워 둔다
    saveLobby({ name: name.trim(), size, bots, difficulty });
    onStart({ name: name.trim() || autoName, bots, size, difficulty, seed: Number(seed) || 1 });
  };

  return (
    <div className="lobby">
      <main className="hero">
        <div className="brand">
          <span className="logo-glyph">{PIECES.king.glyph}</span>
          <h1>OpenChess</h1>
        </div>
        <p className="tagline">땅을 넓히고, 기물로 이끌고, 킹을 지켜라</p>

        <form className="play-card" onSubmit={start}>
          <div className="play-row">
            <input className="name" value={name} maxLength={12} placeholder={autoName} aria-label="닉네임" onChange={(e) => setName(e.target.value)} />
            <button className="play" type="submit">
              플레이
            </button>
          </div>

          <div className="quick">
            <label>
              <span>지도</span>
              <Segmented
                value={size}
                options={Object.entries(C.MAP_SIZES).map(([k, m]) => [
                  k,
                  <>
                    {m.label} <small>~{m.minutes[difficulty] ?? m.minutes.normal}분</small>
                  </>,
                  `${m.width}×${m.height} · 봇 ${m.bots} · ${DIFFICULTY[difficulty]?.label ?? ''} 한 판 약 ${m.minutes[difficulty] ?? m.minutes.normal}분`,
                ])}
                onChange={(k) => {
                  setSize(k);
                  setBots(C.MAP_SIZES[k].bots);
                }}
              />
            </label>
            <label>
              <span>난이도</span>
              <Segmented value={difficulty} options={Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label])} onChange={setDifficulty} />
            </label>
            {firstGame && difficulty === 'easy' && <p className="first-hint muted small-text">첫 판은 쉬움으로 시작해요</p>}
          </div>

          {more ? (
            <div className="quick more">
              <label>
                <span>
                  봇 나라 <b>{bots}</b>
                </span>
                <input type="range" min="2" max={C.MAX_BOTS} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
              </label>
              <label>
                <span>지도 번호</span>
                <span className="seed">
                  <input type="number" min="1" value={seed} onChange={(e) => setSeed(e.target.value)} />
                  <button type="button" onClick={() => setSeed(randomSeed())} title="다른 지도">
                    🎲
                  </button>
                </span>
              </label>
            </div>
          ) : (
            <button type="button" className="link" onClick={() => setMore(true)}>
              고급 설정
            </button>
          )}
        </form>

        <ul className="pillars">
          <li>
            <span>⚔</span>클릭으로 공격
          </li>
          <li>
            <span>{PIECES.knight.glyph}</span>기물 1~5
          </li>
          <li>
            <span>{PIECES.king.glyph}</span>체크를 막아라
          </li>
        </ul>
        <button type="button" className="link" onClick={() => setRulesOpen(true)}>
          규칙 보기
        </button>
      </main>

      {rulesOpen && (
        <div className="modal" onClick={() => setRulesOpen(false)} role="presentation">
          <div className="panel rules" role="dialog" aria-label="규칙" onClick={(e) => e.stopPropagation()}>
            <button className="icon close" type="button" onClick={() => setRulesOpen(false)} aria-label="닫기">
              ✕
            </button>

        <h2>기본 — OpenFront 그대로</h2>
        <ul>
          <li>빈 땅이나 적 땅을 클릭하면 슬라이더 비율(Q/E)만큼 병력을 보내 공격합니다. 바다 건너는 배로 갑니다.</li>
          <li>영토가 넓을수록 병력과 금이 늘어납니다. 시작 {C.MAP_SIZES[size].peace / 10}초는 평화 기간이라 빈 땅만 넓힐 수 있어요.</li>
          <li>한 나라에게 완전히 둘러싸인 떨어진 땅은 저절로 그 나라 땅이 됩니다.</li>
          <li>
            순위표에서 맞닿은 나라(이웃)를 누르면 동맹, 금이 모이면 핵. 다른 나라의 킹을 모두 잡거나 육지의 {C.WIN_LAND_SHARE * 100}%를
            차지하면 승리합니다. 판이 길어지면 이 기준이 1분에 2%p씩 내려가요.
          </li>
          <li>
            동맹을 깨면 {C.TRAITOR_TICKS / 10}초 동안 <b>배신자</b>: 방어가 절반이고 모두의 표적이 됩니다(지도에 빗금). 배신자와의 동맹을 끊는 것은
            벌칙이 없어요.
          </li>
          <li>내 나라는 파랑, 동맹과 맞닿은 국경은 하늘색으로 보여요.</li>
          <li>난이도는 봇의 병력 상한 · 회복 · 판단으로 나뉩니다. 어려움은 봇이 사람과 같은 기준으로 싸우는 공정한 판이에요.</li>
          <li>폰에서는 두 손가락으로 확대, 탭하면 공격. 나라를 길게 누르면 외교 시트가 뜨고, 핵은 같은 곳을 두 번 탭해야 발사됩니다.</li>
        </ul>

        <h2>체스 — 킹과 기물</h2>
        <ul>
          <li>
            <span className="glyph inline-glyph">{PIECES.king.glyph}</span> <b>킹</b>은 수도입니다. 킹 주변 {C.PALACE_RADIUS}칸(궁성, 국경이 더 진해요)에 적이 들어오면 <b>체크</b>, {C.CHECKMATE_TICKS / 10}초 안에
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
            <b>캐슬링</b> — 체크일 때(또는 핵이 킹을 노릴 때) 한 번, 룩이 킹을 영토 가장 안쪽으로 피신시킵니다 (C).
          </li>
          <li>
            <b>앙파상</b> — 적이 우리 땅을 깊게 파고들어 거의 둘러싸이면, 성의 폰이 출동해 그 땅을 되찾고 부대를 섬멸합니다. 나이트는
            뛰어넘어 와서 잡을 수 없고, 출동한 폰은 {C.EP_PAWN_REST / 10}초 뒤 돌아옵니다.
          </li>
          <li>
            <b>프로모션</b> — 폰이 다른 기물을 이기면 그 기물로 바뀝니다.
          </li>
        </ul>
        <p className="muted small-text">깜빡이는 효과(체크 · 핵)가 있습니다. 기기의 '동작 줄이기' 설정을 켜면 멈춘 채로 보입니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
