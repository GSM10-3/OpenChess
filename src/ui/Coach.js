import { useState } from 'react';
import * as C from '../game/constants';

const KEY = 'openchess.coach.off';

function readOff() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

// 첫 판 안내: 지금 상황에 맞는 것 하나만, 한 줄로 (한 번에 한 가지씩 가르친다)
const STEPS = [
  {
    key: 'expand',
    text: '빈 땅을 클릭해 영토를 넓히세요 · 아래 슬라이더(Q/E)로 보낼 병력 비율을 정해요',
    when: (g, h) => g.peaceLeft() > 0 && h.tiles < 150,
  },
  {
    key: 'general',
    text: '오른쪽 체스판에서 기물을 고르면(1~5) 그 장군이 다음 공격을 지휘해요',
    when: (g, h) => h.tiles >= 150 && !h.generals.some((x) => x.restUntil > 0 || x.status === 'busy'),
  },
  {
    key: 'palace',
    text: `평화 끝! 킹 주변 점선 원이 궁성 — 적이 들어오면 체크, ${C.CHECKMATE_TICKS / 10}초 안에 몰아내거나 캐슬링(C)`,
    when: (g) => g.peaceLeft() === 0 && g.tick < C.PEACE_TICKS + 400,
  },
  {
    key: 'ally',
    text: '왼쪽 순위표에서 나라를 누르면 동맹을 맺을 수 있어요 — 싸울 상대를 고르세요',
    when: (g, h) => g.tick >= C.PEACE_TICKS + 400 && ![...g.alliances.keys()].some((k) => k.split('-').map(Number).includes(h.id)),
  },
];

export default function Coach({ game }) {
  const [off, setOff] = useState(readOff);
  const [closed, setClosed] = useState(() => new Set());
  const h = game.human;
  if (off || game.phase !== 'play' || !h?.alive || h.check) return null;
  const step = STEPS.find((s) => !closed.has(s.key) && s.when(game, h));
  if (!step) return null;
  const never = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // 저장이 막혀 있으면 이번 판만 끈다
    }
    setOff(true);
  };
  return (
    <div className="coach" key={step.key}>
      <span className="coach-dot">?</span>
      <span>{step.text}</span>
      <button className="small" onClick={() => setClosed((s) => new Set(s).add(step.key))}>
        알겠어요
      </button>
      <button className="small flat-link" onClick={never}>
        다시 보지 않기
      </button>
    </div>
  );
}
