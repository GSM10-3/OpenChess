// 효과음: 파일 없이 Web Audio 로 짧은 음을 합성한다. 소리 설정(전부 · 경보만 · 끔)은 브라우저에 기억한다.
const KEY = 'openchess.sound';
export const SOUND_MODES = ['all', 'alerts', 'off'];
const THROTTLE_MS = 120; // 같은 소리는 이 간격 안에 두 번 울리지 않는다
const MAX_VOICES = 4; // 동시에 울리는 소리 상한
const PRIORITY_MS = 150; // 사건 하나에 소리 하나: 더 중요한 소리 직후의 덜 중요한 소리는 버린다

let ctx = null;
let master = null;
let voices = 0;
const last = {};
let lastPri = { pri: 0, at: -Infinity };

let mode = 'all';
try {
  const saved = window.localStorage.getItem(KEY);
  if (SOUND_MODES.includes(saved)) mode = saved;
  else if (window.localStorage.getItem('openchess.muted') === '1') mode = 'off'; // 예전 음소거 설정
} catch {
  mode = 'all';
}

export const soundMode = () => mode;

// 전부 → 경보만 → 끔 → 전부
export function cycleSoundMode() {
  mode = SOUND_MODES[(SOUND_MODES.indexOf(mode) + 1) % SOUND_MODES.length];
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // 저장이 막혀 있어도 이번 판에서는 적용된다
  }
  return mode;
}

// AudioContext 는 사용자 제스처 안에서 만들어야 막히지 않는다: 플레이 버튼 · 첫 클릭에서 부른다
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
      // 마스터 볼륨 → 리미터: 여러 소리가 겹쳐도 찢어지지 않게
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(limiter).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

// [주파수, 시작(초), 길이(초)] 목록과 음색. alert 는 '경보만'·다른 탭에서도 울린다. pri 는 겹칠 때 우선순위
const WIN = { wave: 'triangle', gain: 0.17, pri: 4, notes: [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1047, 0.45, 0.4]] };
const SOUNDS = {
  check: { wave: 'square', gain: 0.05, pri: 3, alert: true, notes: [[880, 0, 0.08], [660, 0.09, 0.1]] }, // 체크 당함
  checkGive: { wave: 'triangle', gain: 0.13, pri: 3, notes: [[660, 0, 0.08], [880, 0.08, 0.12]] }, // 체크 걺
  castle: { wave: 'triangle', gain: 0.16, notes: [[392, 0, 0.12], [523, 0.12, 0.12], [659, 0.24, 0.2]] },
  promotion: { wave: 'triangle', gain: 0.15, notes: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.25]] },
  enpassant: { wave: 'triangle', gain: 0.15, notes: [[740, 0, 0.08], [740, 0.1, 0.08], [988, 0.2, 0.22]] },
  capture: { wave: 'triangle', gain: 0.13, pri: 2, notes: [[587, 0, 0.04], [440, 0.045, 0.045]] },
  launch: { wave: 'sine', gain: 0.05, pri: 1, notes: [[180, 0, 0.04]] },
  tick: { wave: 'square', gain: 0.04, notes: [[1000, 0, 0.03]] },
  peaceEnd: { wave: 'sine', gain: 0.12, notes: [[440, 0, 0.18], [330, 0.2, 0.3]] },
  win: WIN,
  victory: WIN,
  defeat: { wave: 'sine', gain: 0.13, pri: 4, alert: true, notes: [[392, 0, 0.25], [262, 0.25, 0.25], [196, 0.5, 0.5]] },
  mate: { wave: 'sine', gain: 0.1, notes: [[330, 0, 0.12], [247, 0.12, 0.2]] },
  alliance: { wave: 'sine', gain: 0.14, notes: [[523, 0, 0.3], [659, 0.05, 0.3], [784, 0.1, 0.35]] },
  betray: { wave: 'sawtooth', gain: 0.07, alert: true, notes: [[220, 0, 0.18], [165, 0.18, 0.3]] },
  nuke: { wave: 'sawtooth', gain: 0.06, alert: true, sweep: [900, 120, 0.9] },
};

export function play(name) {
  const s = SOUNDS[name];
  if (!s || mode === 'off') return;
  if (!s.alert && (mode === 'alerts' || document.hidden)) return; // 다른 탭에서는 경보만
  const nowMs = performance.now();
  if (nowMs - (last[name] ?? -Infinity) < THROTTLE_MS) return;
  if (voices >= MAX_VOICES) return;
  const pri = s.pri || 0;
  if (pri && pri < lastPri.pri && nowMs - lastPri.at < PRIORITY_MS) return;
  try {
    if (!ctx) unlock();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    last[name] = nowMs;
    if (pri) lastPri = { pri, at: nowMs };
    const t0 = ctx.currentTime;
    let end = null;
    let endAt = -1;
    const tone = (freq, start, len, endFreq) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = s.wave;
      osc.frequency.setValueAtTime(freq, t0 + start);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + start + len);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(s.gain, t0 + start + Math.min(0.015, len / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
      osc.connect(g).connect(master);
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.02);
      if (start + len > endAt) {
        endAt = start + len;
        end = osc;
      }
    };
    if (s.sweep) tone(s.sweep[0], 0, s.sweep[2], s.sweep[1]);
    else for (const [f, st, len] of s.notes) tone(f, st, len);
    // 소리 하나 = 목소리 하나: 가장 늦게 끝나는 음이 끝나면 돌려준다
    voices++;
    end.onended = () => {
      voices = Math.max(0, voices - 1);
    };
  } catch {
    // 소리를 낼 수 없는 환경이면 조용히 넘어간다
  }
}
