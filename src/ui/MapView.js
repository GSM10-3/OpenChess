import { useEffect, useRef } from 'react';
import { MapPainter, drawScene } from './painter';

const MAX_ZOOM = 40;
const DRAG_MOUSE_PX = 5; // 이만큼 움직이면 클릭이 아니라 끌기
const DRAG_TOUCH_PX = 10; // 손가락은 더 흔들린다
const LONG_PRESS_MS = 450; // 터치: 이만큼 누르고 있으면 길게 누르기
const LONG_PRESS_PIN_MS = 2000; // 길게 누른 칸의 정보 칩을 띄워 두는 시간

// 카메라: cam.x, cam.y = 화면 왼쪽 위 모서리의 지도 좌표(칸), cam.zoom = 한 칸의 화면 픽셀
export function focusTile(cam, game, tile, zoom) {
  if (tile < 0 || !cam.viewW) return;
  if (zoom) cam.zoom = Math.max(cam.zoom, zoom);
  cam.x = (tile % game.W) + 0.5 - cam.viewW / 2 / cam.zoom;
  cam.y = ((tile / game.W) | 0) + 0.5 - cam.viewH / 2 / cam.zoom;
}

export default function MapView({ game, camRef, uiRef, onTileClick, onCancel, onLongPress }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const handlers = useRef({});
  handlers.current = { onTileClick, onCancel, onLongPress };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const painter = new MapPainter(game);
    const cam = camRef.current;
    const view = { dpr: 1, w: 0, h: 0 };
    let hover = -1;

    const keepInside = () => {
      const vw = view.w / cam.zoom;
      const vh = view.h / cam.zoom;
      cam.x = Math.min(Math.max(cam.x, -vw * 0.5), game.W - vw * 0.5);
      cam.y = Math.min(Math.max(cam.y, -vh * 0.5), game.H - vh * 0.5);
    };
    const resize = () => {
      view.dpr = window.devicePixelRatio || 1;
      view.w = wrap.clientWidth;
      view.h = wrap.clientHeight;
      canvas.width = Math.round(view.w * view.dpr);
      canvas.height = Math.round(view.h * view.dpr);
      canvas.style.width = `${view.w}px`;
      canvas.style.height = `${view.h}px`;
      cam.viewW = view.w;
      cam.viewH = view.h;
      cam.minZoom = Math.min(view.w / game.W, view.h / game.H) * 0.8;
      if (!cam.zoom) {
        cam.zoom = cam.minZoom / 0.8;
        cam.x = game.W / 2 - view.w / 2 / cam.zoom;
        cam.y = game.H / 2 - view.h / 2 / cam.zoom;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    const frame = (now) => {
      painter.update();
      if (pinUntil && now > pinUntil) {
        pinUntil = 0;
        hover = -1;
      }
      keepInside();
      drawScene(ctx, game, painter, cam, view, uiRef.current, hover, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const tileAt = (x, y) => {
      const tx = Math.floor(x / cam.zoom + cam.x);
      const ty = Math.floor(y / cam.zoom + cam.y);
      if (tx < 0 || ty < 0 || tx >= game.W || ty >= game.H) return -1;
      return ty * game.W + tx;
    };

    // 손가락 · 마우스 여러 개를 함께 본다: 둘이면 핀치 줌
    const pointers = new Map(); // pointerId → { x, y }
    let down = null; // 드래그 기준점 (한 포인터)
    let pinch = null; // 두 손가락 사이 거리 · 가운데
    let press = 0; // 길게 누르기 타이머
    let pinUntil = 0; // 길게 누른 칸의 정보 칩을 이때까지 띄운다
    const clearPress = () => {
      clearTimeout(press);
      press = 0;
    };
    const twoFingers = () => {
      const [a, b] = [...pointers.values()];
      const r = canvas.getBoundingClientRect();
      return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    };
    const onDown = (e) => {
      if (e.button === 2) {
        handlers.current.onCancel?.();
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        down = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, touch: e.pointerType === 'touch' };
        // 터치: 움직이지 않고 오래 누르면 그 칸의 정보 칩 + (남의 나라면) 외교 시트
        if (down.touch) {
          const [x, y] = local(e);
          press = setTimeout(() => {
            press = 0;
            if (!down || down.moved || pointers.size !== 1) return;
            down.moved = true; // 손을 떼도 공격하지 않는다
            down.held = true; // 이어서 끌어도 지도를 움직이지 않는다
            hover = tileAt(x, y);
            pinUntil = performance.now() + LONG_PRESS_PIN_MS;
            handlers.current.onLongPress?.(hover);
          }, LONG_PRESS_MS);
        }
      } else {
        // 두 번째 손가락: 탭 · 길게 누르기를 취소하고 핀치 시작
        clearPress();
        if (down) down.moved = true;
        pinch = twoFingers();
      }
    };
    const onMove = (e) => {
      if (e.pointerType !== 'touch') {
        hover = tileAt(...local(e));
        pinUntil = 0;
      }
      const pt = pointers.get(e.pointerId);
      if (!pt) return;
      pt.x = e.clientX;
      pt.y = e.clientY;
      if (pointers.size >= 2 && pinch) {
        const next = twoFingers();
        // 이전 가운데의 지도 좌표가 새 가운데에 오도록 (줌 + 이동)
        const wx = pinch.x / cam.zoom + cam.x;
        const wy = pinch.y / cam.zoom + cam.y;
        const zoom = Math.min(MAX_ZOOM, Math.max(cam.minZoom, cam.zoom * (next.d / pinch.d)));
        cam.zoom = zoom;
        cam.x = wx - next.x / zoom;
        cam.y = wy - next.y / zoom;
        pinch = next;
        return;
      }
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > (down.touch ? DRAG_TOUCH_PX : DRAG_MOUSE_PX)) {
        down.moved = true;
        clearPress();
      }
      if (down.moved && !press && !down.held) {
        cam.x = down.cx - dx / cam.zoom;
        cam.y = down.cy - dy / cam.zoom;
      }
    };
    const release = (e, tap) => {
      if (!pointers.delete(e.pointerId)) return;
      clearPress();
      if (pointers.size === 1) {
        // 한 손가락만 남으면 그 손가락을 새 드래그 기준점으로 (카메라가 튀지 않게)
        const [rest] = pointers.values();
        pinch = null;
        down = { x: rest.x, y: rest.y, cx: cam.x, cy: cam.y, moved: true, touch: true };
        return;
      }
      if (pointers.size > 1) {
        pinch = twoFingers();
        return;
      }
      if (tap && down && !down.moved && e.button === 0) handlers.current.onTileClick?.(tileAt(...local(e)), e.pointerType);
      down = null;
      pinch = null;
    };
    const onUp = (e) => release(e, true);
    const onCancelPointer = (e) => release(e, false);
    const onWheel = (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      const wx = x / cam.zoom + cam.x;
      const wy = y / cam.zoom + cam.y;
      const next = Math.min(MAX_ZOOM, Math.max(cam.minZoom, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
      cam.zoom = next;
      cam.x = wx - x / next;
      cam.y = wy - y / next;
    };
    const onLeave = (e) => {
      if (e.pointerType !== 'touch') hover = -1; // 터치는 손을 떼면 leave 가 온다: 길게 누른 칩은 남긴다
    };
    const noMenu = (e) => e.preventDefault();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancelPointer);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', noMenu);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancelPointer);
      canvas.removeEventListener('pointerleave', onLeave);
      clearPress();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', noMenu);
    };
  }, [game, camRef, uiRef]);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
