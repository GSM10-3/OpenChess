import { useRef } from 'react';

const SHOW_MS = 3200; // 1.6초 깜빡임 두 번
const COOLDOWN_TICKS = 150; // 침공 경보는 15초에 한 번
const REVENGE_TICKS = 150; // 최근 15초 안에 내가 친 나라의 반격은 알리지 않는다

// 화면 테두리 경보: 체크 · 배신은 빨강, 큰 침공은 주황. 정보 없이 '지금 위험하다'만 알린다
export default function AlertFrame({ game }) {
  const hid = game.humanId;
  const seen = useRef(game.nextId);
  const handled = useRef(new Set()); // 이미 살펴본 공격 id
  const hitAt = useRef({}); // 내가 공격한 나라 → 마지막 틱
  const lastOrange = useRef(-Infinity);
  const current = useRef(null);
  const me = game.human;

  let fire = null;
  for (const e of game.events) {
    if (e.id < seen.current) continue;
    seen.current = e.id + 1;
    if ((e.tag === 'betray' && e.involved[1] === hid) || (e.tag === 'check' && e.involved[0] === hid)) fire = 'red';
  }
  if (me?.alive && game.phase === 'play') {
    for (const a of game.attacks) {
      if (a.attacker === hid && a.target) hitAt.current[a.target] = game.tick;
      if (a.target !== hid || handled.current.has(a.id)) continue;
      handled.current.add(a.id);
      const revenge = game.tick - (hitAt.current[a.attacker] ?? -Infinity) < REVENGE_TICKS;
      if (!fire && !revenge && a.troops >= me.troops / 5 && game.tick - lastOrange.current >= COOLDOWN_TICKS) {
        fire = 'orange';
        lastOrange.current = game.tick;
      }
    }
  }

  const now = Date.now();
  // 빨강은 주황을 덮어쓴다
  if (fire && !(fire === 'orange' && current.current?.color === 'red' && now - current.current.start < SHOW_MS)) {
    current.current = { color: fire, start: now, key: now };
  }
  const cur = current.current;
  if (!cur || now - cur.start >= SHOW_MS) return null;
  return <div key={cur.key} className={`alert-frame ${cur.color}`} aria-hidden="true" />;
}
