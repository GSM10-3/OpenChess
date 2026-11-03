// 기기 판별: 손가락으로 조작하는 화면인지 (OpenFront Platform 처럼 pointer: coarse 로 본다)
export const isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

// 단축키 표기: 터치 기기에서는 키보드가 없으니 숨긴다
export const keyHint = (k) => (isTouch ? '' : ` (${k})`);

// 짧은 진동 (지원하는 기기만)
export const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // 진동을 막은 브라우저는 조용히 넘어간다
  }
};
