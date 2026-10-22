import { useEffect, useRef } from 'react';
import { MapPainter, drawScene } from './painter';

const MAX_ZOOM = 40;

// 카메라: cam.x, cam.y = 화면 왼쪽 위 모서리의 지도 좌표(칸), cam.zoom = 한 칸의 화면 픽셀
export function focusTile(cam, game, tile, zoom) {
  if (tile < 0 || !cam.viewW) return;
  if (zoom) cam.zoom = Math.max(cam.zoom, zoom);
  cam.x = (tile % game.W) + 0.5 - cam.viewW / 2 / cam.zoom;
  cam.y = ((tile / game.W) | 0) + 0.5 - cam.viewH / 2 / cam.zoom;
}

export default function MapView({ game, camRef, uiRef, onTileClick, onCancel }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const handlers = useRef({});
  handlers.current = { onTileClick, onCancel };

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

    let down = null;
    const onDown = (e) => {
      if (e.button === 2) {
        handlers.current.onCancel?.();
        return;
      }
      down = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      hover = tileAt(...local(e));
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 5) down.moved = true;
      if (down.moved) {
        cam.x = down.cx - dx / cam.zoom;
        cam.y = down.cy - dy / cam.zoom;
      }
    };
    const onUp = (e) => {
      if (down && !down.moved && e.button === 0) handlers.current.onTileClick?.(tileAt(...local(e)));
      down = null;
    };
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
    const onLeave = () => {
      hover = -1;
    };
    const noMenu = (e) => e.preventDefault();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', noMenu);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
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
