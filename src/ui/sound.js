// 효과음: 파일 없이 Web Audio 로 짧은 음을 합성한다. 음소거 여부는 브라우저에 기억한다.
const KEY = 'openchess.muted';
let ctx = null;
let muted = false;
try {
  muted = window.localStorage.getItem(KEY) === '1';
} catch {
  muted = false;
}

export const isMuted = () => muted;

export function setMuted(v) {
  muted = v;
  try {
    window.localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // 저장이 막혀 있어도 이번 판에서는 적용된다
  }
}

// [주파수, 시작(초), 길이(초)] 목록과 음색
const SOUNDS = {
  check: { wave: 'square', gain: 0.07, notes: [[880, 0, 0.12], [660, 0.14, 0.18]] },
  castle: { wave: 'triangle', gain: 0.16, notes: [[392, 0, 0.12], [523, 0.12, 0.12], [659, 0.24, 0.2]] },
  promotion: { wave: 'triangle', gain: 0.15, notes: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.25]] },
  enpassant: { wave: 'triangle', gain: 0.15, notes: [[740, 0, 0.08], [740, 0.1, 0.08], [988, 0.2, 0.22]] },
  win: { wave: 'triangle', gain: 0.17, notes: [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15], [1047, 0.45, 0.4]] },
  mate: { wave: 'sine', gain: 0.1, notes: [[330, 0, 0.12], [247, 0.12, 0.2]] },
  alliance: { wave: 'sine', gain: 0.14, notes: [[523, 0, 0.3], [659, 0.05, 0.3], [784, 0.1, 0.35]] },
  betray: { wave: 'sawtooth', gain: 0.07, notes: [[220, 0, 0.18], [165, 0.18, 0.3]] },
  nuke: { wave: 'sawtooth', gain: 0.06, sweep: [900, 120, 0.9] },
};

export function play(name) {
  const s = SOUNDS[name];
  if (muted || !s) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const tone = (freq, start, len, endFreq) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = s.wave;
      osc.frequency.setValueAtTime(freq, t0 + start);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + start + len);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(s.gain, t0 + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.02);
    };
    if (s.sweep) tone(s.sweep[0], 0, s.sweep[2], s.sweep[1]);
    else for (const [f, st, len] of s.notes) tone(f, st, len);
  } catch {
    // 소리를 낼 수 없는 환경이면 조용히 넘어간다
  }
}
