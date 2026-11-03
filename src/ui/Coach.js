import { useEffect, useRef, useState } from 'react';
import * as C from '../game/constants';

const KEY = 'openchess.coach.off';
const DONE_KEY = 'openchess.coach.done'; // 끝낸 단계 (다음 판부터 건너뛴다)
const STEP_TICKS = 300; // 행동 단계도 30초 동안 안 하면 다음으로 넘어간다
const DONE_TICKS = 50; // '준비 끝'은 5초만

function readOff() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function readDone() {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveDone(set) {
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
  } catch {
    // 저장이 막혀 있으면 이번 판만 기억한다
  }
}

// 터치 기기면 '클릭' 대신 '탭', 단축키 표기는 뺀다
const touch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

const narrow = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1150px)').matches;

const allied = (g, h) => [...g.alliances.keys()].some((k) => k.split('-').map(Number).includes(h.id));

// 첫 판 안내: 화면 위 가운데에 큰 한 문장. 한 번에 하나씩, 행동하면 저절로 넘어간다.
// info 단계만 '알겠어요' 버튼이 있다. highlight 는 노랗게 맥동시킬 화면 요소.
// 배열 순서가 우선순위다 (시간 창이 짧은 palace 가 piece 보다 앞).
const STEPS = [
  {
    key: 'expand',
    text: (t) => (t ? '빈 땅을 탭해 영토를 넓히세요' : '빈 땅을 클릭해 영토를 넓히세요'),
    when: (g) => g.peaceLeft() > 0,
    done: (g, h, s) => h.tiles >= s.startTiles + 30,
    ring: true,
  },
  {
    key: 'ratio',
    text: (t) => (t ? '슬라이더로 보낼 병력 비율을 정해요 — 20~30%씩 자주가 좋아요' : '슬라이더(Q/E)로 보낼 병력 비율을 정해요 — 20~30%씩 자주가 좋아요'),
    when: (g, h, s) => s.expanded,
    done: (g, h, s, ui) => ui.ratioMoved || !ui.firstGame, // 두 번째 판부터는 저장된 비율을 그대로 써도 된다
    highlight: '.ratio',
  },
  {
    key: 'palace',
    text: () => `평화 끝! 킹 주변 ${C.PALACE_RADIUS}칸(국경이 진한 곳)이 궁성 — 적이 들어오면 체크, ${C.CHECKMATE_TICKS / 10}초 안에 몰아내세요`,
    when: (g, h, s) => s.expanded && g.peaceLeft() === 0,
    ttl: 400, // 처음 보인 뒤 40초
    info: true,
    highlight: '.king-line',
  },
  {
    key: 'piece',
    text: (t) => (t ? '적과 싸울 때 오른쪽 기물을 고르고 공격하세요 — 나이트는 돌파, 룩은 강공' : '적과 싸울 때 오른쪽 기물(1~5)을 고르고 공격하세요 — 나이트는 돌파, 룩은 강공'),
    when: (g, h, s) => s.expanded && g.peaceLeft() === 0,
    done: (g) => g.usedPiece,
    highlight: '.pieces',
  },
  {
    key: 'ally',
    // 좁은 화면에서는 순위표가 접혀 있으니 펼치는 버튼부터 가리킨다
    text: () =>
      narrow()
        ? '왼쪽 위 「순위 ▸」를 펼쳐 맞닿은 나라(이웃)를 누르면 동맹을 맺을 수 있어요'
        : '순위표에서 맞닿은 나라(이웃)를 눌러 동맹을 맺을 수 있어요 — 싸울 상대를 고르세요',
    when: (g, h, s) => s.expanded && g.tick >= g.peaceTicks + 400,
    done: allied,
    info: true,
    highlight: '.leaderboard',
  },
];

export default function Coach({ game, ui, coachRef }) {
  const [off, setOff] = useState(readOff);
  const [, setClosedCount] = useState(0);
  // 판이 끝날 때까지 기억할 진행 상태 (렌더마다 바뀌어도 다시 그릴 필요는 없다). 지난 판에 끝낸 단계는 건너뛴다
  const mem = useRef(null);
  if (!mem.current) {
    const finished = new Set(readDone());
    mem.current = { finished, saved: finished.size, allDoneBefore: finished.size >= STEPS.length, shownAt: new Map(), startTiles: -1, expanded: finished.has('expand'), readyAt: -1 };
  }
  const s = mem.current;
  const h = game.human;
  const live = !off && game.phase === 'play' && h?.alive;

  let step = null;
  if (live) {
    if (s.startTiles < 0) s.startTiles = h.tiles;
    // 평화 기간 안에 넓히기를 마치지 못했어도 체스 단계는 시작한다
    if (!s.expanded && game.peaceLeft() === 0) {
      s.finished.add('expand');
      s.expanded = true;
    }
    for (const st of STEPS) {
      if (s.finished.has(st.key)) continue;
      if (st.done && st.done(game, h, s, ui)) {
        s.finished.add(st.key);
        if (st.key === 'expand') s.expanded = true;
        continue;
      }
      if (!st.when(game, h, s)) continue;
      if (!s.shownAt.has(st.key)) s.shownAt.set(st.key, game.tick);
      if (game.tick - s.shownAt.get(st.key) >= (st.ttl || STEP_TICKS)) {
        s.finished.add(st.key);
        if (st.key === 'expand') s.expanded = true;
        continue;
      }
      step = st;
      break;
    }
    if (s.finished.size !== s.saved) {
      s.saved = s.finished.size;
      saveDone(s.finished);
    }
    // 모든 단계를 마치면 '준비 끝'을 한 번 (지난 판에 이미 다 끝냈으면 생략)
    if (!step && !s.allDoneBefore && s.finished.size >= STEPS.length) {
      if (s.readyAt < 0) s.readyAt = game.tick;
      if (game.tick - s.readyAt < DONE_TICKS) step = { key: 'ready', text: () => '준비 끝 — 킹을 지키세요', info: true };
    }
  }
  const show = step && !h.check ? step : null;
  if (coachRef) coachRef.current = show?.ring ? 'ring' : null;

  // 가리키는 화면 요소에 노란 맥동 테두리
  const target = show?.highlight;
  useEffect(() => {
    if (!target) return undefined;
    const el = document.querySelector(target);
    if (!el) return undefined;
    el.classList.add('coach-target');
    return () => el.classList.remove('coach-target');
  }, [target]);

  if (!show) return null;
  const close = () => {
    s.finished.add(show.key);
    s.saved = s.finished.size;
    saveDone(s.finished);
    setClosedCount((n) => n + 1);
  };
  const never = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // 저장이 막혀 있으면 이번 판만 끈다
    }
    setOff(true);
  };
  return (
    <div className="coach" key={show.key} role="status">
      <span className="coach-text">{show.text(touch())}</span>
      <span className="coach-buttons">
        {show.info && show.key !== 'ready' && (
          <button className="small" onClick={close}>
            알겠어요
          </button>
        )}
        <button className="small flat-link" onClick={never}>
          다시 보지 않기
        </button>
      </span>
    </div>
  );
}
