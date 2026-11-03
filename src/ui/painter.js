// 지도 그리기: 칸 색은 작은 오프스크린 캔버스(1칸 = 1픽셀)에 칠해 두고 확대해서 붙인다.
// 그 위에 이름 · 기물 · 배 · 핵 같은 것을 화면 좌표로 덧그린다.
// 깜빡임 규칙: 모든 맥동은 초당 3회 미만(지금 약 0.9회), OS '동작 줄이기'면 멈춘 채로 그린다.
// 색 규칙: 노랑 = 나 · 버튼, 빨강 = 위협(체크 · 적 공격), 하늘색 = 동맹. 이 셋은 나라 색(지도 칠)에 쓰지 않는다.
// 색만으로 구분하지 않는다: 배신자는 빗금, 앙파상 지역은 점무늬를 덧그린다.
import * as C from '../game/constants';
import { PIECES } from '../game/pieces';
import { fmt } from '../game/Game';

const TERRAIN_RGB = [null, [190, 199, 146], [170, 162, 118], [143, 136, 125]];
const DEEP = [20, 44, 72];
const SHALLOW = [33, 68, 104];
const FALLOUT = [150, 235, 70];
const ALLY = [86, 180, 233]; // 동맹 국경 하늘색 (#56B4E9)
const BORDER_DARK = 0.82; // 국경은 나라 색을 조금만 어둡게
const PALACE_DARK = 0.6; // 궁성 안 국경은 더 어둡게 (요새)
const LABEL_FONT = '"Noto Sans KR", system-ui, "Malgun Gothic", sans-serif';
const GLYPH_FONT = '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Apple Symbols", serif';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// OS 의 '동작 줄이기' 설정 (바뀌면 바로 따른다)
let reduceMotion = false;
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion = mq.matches;
  mq.addEventListener?.('change', (e) => {
    reduceMotion = e.matches;
  });
} catch {
  reduceMotion = false;
}

const EP_PULSE_MS = 3000; // 앙파상 지역은 3초만 깜빡이고 그 뒤로는 멈춘 강조
let epSeen = { key: null, since: 0 };

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class MapPainter {
  constructor(game) {
    this.game = game;
    const { W, H, N, nbr, terrain } = game;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(W, H);
    this.colors = game.players.map((p) => (p ? hexToRgb(p.color) : null));
    // 덧칠 층: 배신자 영토 마스크(빗금을 이 모양대로 자른다)와 마우스를 올린 나라의 국경
    this.traitorCanvas = document.createElement('canvas');
    this.hoverCanvas = document.createElement('canvas');
    for (const cv of [this.traitorCanvas, this.hoverCanvas]) {
      cv.width = W;
      cv.height = H;
    }
    this.traitorCtx = this.traitorCanvas.getContext('2d');
    this.hoverCtx = this.hoverCanvas.getContext('2d');
    this.traitorImg = this.traitorCtx.createImageData(W, H);
    this.hoverImg = this.hoverCtx.createImageData(W, H);
    this.hoverId = 0;
    this.traitors = new Set();
    this.allyKey = '';
    this.kings = game.players.map((p) => (p ? p.king : -1));
    this.labels = new Map(); // 나라 번호 → 화면에 그리는 이름 자리 (목표로 천천히 따라간다)
    this.shallow = new Uint8Array(N);
    this.shade = new Float32Array(N);
    for (let t = 0; t < N; t++) {
      this.shade[t] = 0.95 + (((t * 2654435761) >>> 0) % 1000) / 10000;
      if (terrain[t] !== C.WATER) continue;
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0 && terrain[n] !== C.WATER) this.shallow[t] = 1;
      }
    }
    game.takeDirty();
    for (let t = 0; t < N; t++) this.paint(t);
    this.flush();
  }

  flush() {
    this.ctx.putImageData(this.img, 0, 0);
    this.traitorCtx.putImageData(this.traitorImg, 0, 0);
    this.hoverCtx.putImageData(this.hoverImg, 0, 0);
  }

  // 국경 칸이면 1, 맞닿은 상대가 동맹이면 2, 아니면 0
  isBorder(t, o) {
    const g = this.game;
    const { nbr, owner, terrain } = g;
    let border = 0;
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n < 0 || terrain[n] === C.WATER || owner[n] === o) continue;
      if (owner[n] && g.allied(o, owner[n])) return 2;
      border = 1;
    }
    return border;
  }

  paint(t) {
    const g = this.game;
    const d = this.img.data;
    const i = t * 4;
    const terr = g.terrain[t];
    const o = g.owner[t];
    let c;
    let border = 0;
    if (terr === C.WATER) {
      c = this.shallow[t] ? SHALLOW : DEEP;
    } else {
      const s = this.shade[t];
      const base = TERRAIN_RGB[terr].map((v) => v * s);
      border = o ? this.isBorder(t, o) : 0;
      if (o) {
        const pc = this.colors[o];
        if (border === 2) c = mix(pc, ALLY, 0.5);
        else if (border) c = pc.map((v) => v * (g.inPalace(o, t) ? PALACE_DARK : BORDER_DARK));
        else c = mix(base, pc, 0.62);
      } else {
        c = base;
      }
      if (g.fallout[t] > g.tick) c = mix(c, FALLOUT, 0.42);
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
    this.traitorImg.data[i + 3] = o && this.traitors.has(o) ? 255 : 0;
    const hv = this.hoverImg.data;
    hv[i] = hv[i + 1] = hv[i + 2] = 255;
    hv[i + 3] = border && o === this.hoverId ? 110 : 0;
  }

  // 한 나라의 칸을 모두 다시 칠한다 (동맹 · 배신자 · 마우스 대상이 바뀌었을 때)
  repaintOwners(ids) {
    const { N, owner } = this.game;
    for (let t = 0; t < N; t++) if (ids.has(owner[t])) this.paint(t);
  }

  setHover(pid) {
    if (pid === this.hoverId) return;
    const ids = new Set([this.hoverId, pid].filter(Boolean));
    this.hoverId = pid;
    this.repaintOwners(ids);
    this.hoverCtx.putImageData(this.hoverImg, 0, 0);
  }

  update() {
    const g = this.game;
    const { nbr, W, H } = g;
    const again = new Set(); // 통째로 다시 칠할 나라
    // 동맹이 맺어지거나 끊기면 두 나라 국경 색이 바뀐다
    const allyKey = [...g.alliances.keys()].sort().join(',');
    if (allyKey !== this.allyKey) {
      const before = new Set(this.allyKey ? this.allyKey.split(',') : []);
      const after = new Set(allyKey ? allyKey.split(',') : []);
      for (const k of [...before, ...after]) {
        if (before.has(k) && after.has(k)) continue;
        for (const id of k.split('-').map(Number)) again.add(id);
      }
      this.allyKey = allyKey;
    }
    // 배신자가 되거나 풀리면 빗금 마스크를 다시 만든다
    for (const p of g.players) {
      if (!p) continue;
      const now = p.alive && g.isTraitor(p.id);
      if (now === this.traitors.has(p.id)) continue;
      if (now) this.traitors.add(p.id);
      else this.traitors.delete(p.id);
      again.add(p.id);
    }
    const dirty = g.takeDirty();
    // 킹이 옮기면(캐슬링) 궁성 안 국경도 옮겨진다
    for (const p of g.players) {
      if (!p || this.kings[p.id] === p.king) continue;
      for (const k of [this.kings[p.id], p.king]) {
        if (k < 0) continue;
        const r = C.PALACE_RADIUS + 1;
        const x0 = k % W;
        const y0 = (k / W) | 0;
        for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
          for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) dirty.push(y * W + x);
        }
      }
      this.kings[p.id] = p.king;
    }
    if (!dirty.length && !again.size) return;
    if (again.size) this.repaintOwners(again);
    for (const t of dirty) {
      this.paint(t);
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0) this.paint(n);
      }
    }
    this.flush();
  }
}

// 반복 무늬 (배신자 빗금 · 앙파상 점무늬), 처음 쓸 때 한 번 만든다
let patterns = null;
function getPatterns(ctx) {
  if (patterns) return patterns;
  const tile = (size, draw) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    return ctx.createPattern(cv, 'repeat');
  };
  patterns = {
    hatch: tile(14, (c, n) => {
      c.strokeStyle = '#0b1220';
      c.lineWidth = 3;
      c.beginPath();
      for (const o of [-n, 0, n]) {
        c.moveTo(o, n);
        c.lineTo(o + n, 0);
      }
      c.stroke();
    }),
    dots: tile(7, (c) => {
      c.fillStyle = '#fbbf24';
      c.beginPath();
      c.arc(3.5, 3.5, 1.7, 0, Math.PI * 2);
      c.fill();
    }),
  };
  return patterns;
}

// 배신자 영토에 빗금: 화면 크기 캔버스에 빗금을 깔고 배신자 마스크 모양만 남긴다
let hatchLayer = null;
function drawTraitorHatch(ctx, game, painter, cam, view) {
  if (!painter.traitors.size) return;
  const { dpr, w, h } = view;
  const cw = Math.round(w * dpr);
  const ch = Math.round(h * dpr);
  if (!hatchLayer) hatchLayer = document.createElement('canvas');
  if (hatchLayer.width !== cw || hatchLayer.height !== ch) {
    hatchLayer.width = cw;
    hatchLayer.height = ch;
  }
  const hc = hatchLayer.getContext('2d');
  hc.setTransform(1, 0, 0, 1, 0, 0);
  hc.globalCompositeOperation = 'source-over';
  hc.clearRect(0, 0, cw, ch);
  hc.fillStyle = getPatterns(hc).hatch;
  hc.fillRect(0, 0, cw, ch);
  hc.globalCompositeOperation = 'destination-in';
  hc.imageSmoothingEnabled = false;
  const z = cam.zoom * dpr;
  hc.drawImage(painter.traitorCanvas, -cam.x * z, -cam.y * z, game.W * z, game.H * z);
  hc.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.25;
  ctx.drawImage(hatchLayer, 0, 0, w, h);
  ctx.globalAlpha = 1;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function drawPiece(ctx, glyph, x, y, size, fill, ring, ringWidth = 0.09) {
  ctx.beginPath();
  ctx.arc(x, y, size * 0.56, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * ringWidth);
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(size * 0.8)}px ${GLYPH_FONT}`;
  ctx.fillText(glyph, x, y + size * 0.05);
}

function outlinedText(ctx, text, x, y, size, weight = 700, color = '#fff', stroke = 'rgba(0,0,0,0.6)') {
  ctx.font = `${weight} ${Math.round(size)}px ${LABEL_FONT}`;
  ctx.lineWidth = Math.max(2, size / 5);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function arrow(ctx, x1, y1, x2, y2, color, width) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(8, width * 3.5);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([width * 2.5, width * 1.6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(a) * head * 0.8, y2 - Math.sin(a) * head * 0.8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
  ctx.closePath();
  ctx.fill();
}

// ui: { mode, epPocket, epKey, threat, urgent, clickFx, coachRing, spawnHint, nukeAim }
export function drawScene(ctx, game, painter, cam, view, ui, hover, now) {
  const { dpr, w, h } = view;
  const z = cam.zoom;
  const W = game.W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a1726';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(painter.canvas, -cam.x * z, -cam.y * z, game.W * z, game.H * z);
  drawTraitorHatch(ctx, game, painter, cam, view);
  // 마우스를 올린 나라의 국경을 밝게
  const hoverOwner = hover >= 0 && game.phase === 'play' ? game.owner[hover] : 0;
  painter.setHover(hoverOwner);
  if (hoverOwner) ctx.drawImage(painter.hoverCanvas, -cam.x * z, -cam.y * z, game.W * z, game.H * z);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tx = (t) => t % W;
  const ty = (t) => (t / W) | 0;
  const sx = (x) => (x + 0.5 - cam.x) * z;
  const sy = (y) => (y + 0.5 - cam.y) * z;
  const S = (t) => [sx(tx(t)), sy(ty(t))];
  const pulse = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 180);
  const hid = game.humanId;

  // 앙파상으로 되찾을 수 있는 돌파 지역: 옅은 노랑 + 점무늬 (처음 3초만 점이 맥동)
  if (ui.epPocket) {
    if (epSeen.key !== ui.epKey) epSeen = { key: ui.epKey, since: now };
    const p = now - epSeen.since < EP_PULSE_MS ? pulse : 0.6;
    const cell = (t) => ctx.fillRect((tx(t) - cam.x) * z, (ty(t) - cam.y) * z, z + 0.5, z + 0.5);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
    for (const t of ui.epPocket) cell(t);
    ctx.fillStyle = getPatterns(ctx).dots;
    ctx.globalAlpha = 0.5 + 0.5 * p;
    for (const t of ui.epPocket) cell(t);
    ctx.globalAlpha = 1;
  }

  // 핵
  for (const n of game.nukes) {
    const spec = C.NUKES[n.kind];
    const [x2, y2] = S(n.to);
    const mine = n.owner === hid;
    ctx.beginPath();
    ctx.arc(x2, y2, spec.radius * z, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 68, 68, ${0.08 + 0.1 * pulse})`;
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = mine ? 'rgba(253, 224, 71, 0.9)' : 'rgba(248, 113, 113, 0.95)';
    ctx.stroke();
    ctx.setLineDash([]);
    const [x1, y1] = S(n.from);
    const p = clamp((game.tick - n.launchTick) / (n.impactTick - n.launchTick), 0, 1);
    const lift = Math.hypot(x2 - x1, y2 - y1) * 0.3;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - lift;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = (1 - p) * (1 - p) * x1 + 2 * (1 - p) * p * cx + p * p * x2;
    const my = (1 - p) * (1 - p) * y1 + 2 * (1 - p) * p * cy + p * p * y2;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    outlinedText(ctx, `☢ ${((n.impactTick - game.tick) / 10).toFixed(1)}s`, x2, y2 - spec.radius * z - 10, 13);
  }

  // 나이트 · 비숍 돌파 방향
  for (const a of game.attacks) {
    if ((a.kind !== 'knight' && a.kind !== 'diagonal') || a.lastTile < 0) continue;
    if (a.attacker !== hid && a.target !== hid) continue;
    const [x1, y1] = S(a.lastTile);
    let x2;
    let y2;
    if (a.kind === 'knight') [x2, y2] = S(a.aim);
    else [x2, y2] = [x1 + a.diag.dx * 8 * z, y1 + a.diag.dy * 8 * z];
    if (Math.hypot(x2 - x1, y2 - y1) < 6) continue;
    arrow(ctx, x1, y1, x2, y2, a.attacker === hid ? 'rgba(253, 230, 138, 0.9)' : 'rgba(248, 113, 113, 0.95)', 2.5);
  }

  // 배
  for (const b of game.boats) {
    const i0 = Math.floor(b.pos);
    const i1 = Math.min(b.path.length - 1, i0 + 1);
    const f = b.pos - i0;
    const bx = sx(tx(b.path[i0]) * (1 - f) + tx(b.path[i1]) * f);
    const by = sy(ty(b.path[i0]) * (1 - f) + ty(b.path[i1]) * f);
    const toward = game.owner[b.landing];
    if (b.owner === hid || toward === hid) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      for (let i = i1; i < b.path.length; i++) ctx.lineTo(sx(tx(b.path[i])), sy(ty(b.path[i])));
      ctx.lineTo(...S(b.landing));
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = b.owner === hid ? 'rgba(255,255,255,0.6)' : 'rgba(248,113,113,0.9)';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = clamp(z * 1.3, 6, 13);
    const owner = game.players[b.owner];
    if (b.general) {
      drawPiece(ctx, PIECES[b.general.type].glyph, bx, by, r * 2, owner.color, '#e0f2fe', 0.12);
    } else {
      ctx.beginPath();
      ctx.moveTo(bx - r, by - r * 0.3);
      ctx.lineTo(bx + r, by - r * 0.3);
      ctx.lineTo(bx + r * 0.6, by + r * 0.6);
      ctx.lineTo(bx - r * 0.6, by + r * 0.6);
      ctx.closePath();
      ctx.fillStyle = owner.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    if (z >= 3 || b.owner === hid) outlinedText(ctx, fmt(b.troops), bx, by - r - 7, 11, 600);
  }

  // 나라 이름 · 병력: 영토 안 가장 큰 직사각형에 맞춘 크기. 너무 작으면 숨기지만,
  // 지금 나와 싸우는 나라와 마우스를 올린 나라는 작게라도 보인다
  const fighting = new Set();
  for (const a of game.attacks) {
    if (a.attacker === hid) fighting.add(a.target);
    if (a.target === hid) fighting.add(a.attacker);
  }
  for (const p of game.players) {
    if (!p || !p.alive || !p.tiles || !p.labelW) {
      if (p) painter.labels.delete(p.id);
      continue;
    }
    // 이름 자리가 바뀌면 화면의 이름은 그쪽으로 미끄러진다 (멀리 튀면 바로)
    let l = painter.labels.get(p.id);
    if (!l || Math.hypot(l.x - p.labelX, l.y - p.labelY) > 40) {
      l = { x: p.labelX, y: p.labelY, w: p.labelW, h: p.labelH };
      painter.labels.set(p.id, l);
    }
    const k = reduceMotion ? 1 : 0.15;
    l.x += (p.labelX - l.x) * k;
    l.y += (p.labelY - l.y) * k;
    l.w += (p.labelW - l.w) * k;
    l.h += (p.labelH - l.h) * k;
    ctx.font = `800 100px ${LABEL_FONT}`;
    const perPx = Math.max(1, ctx.measureText(p.name).width) / 100;
    let fs = Math.min(26, (l.w * z * 0.9) / perPx, (l.h * z) / 2.2);
    if (fs < 9) {
      if (!fighting.has(p.id) && p.id !== hoverOwner) continue;
      fs = Math.max(fs, 11);
    }
    const x = sx(l.x);
    const y = sy(l.y);
    const stroke = `rgb(${painter.colors[p.id].map((v) => Math.round(v * 0.35)).join(',')})`;
    const fill = p.isHuman ? '#fff' : '#cbd5e1';
    ctx.globalAlpha = 0.9;
    outlinedText(ctx, p.name, x, y - fs * 0.4, fs, 800, fill, stroke);
    outlinedText(ctx, fmt(p.troops), x, y + fs * 0.5, fs * 0.62, 600, fill, stroke);
    ctx.globalAlpha = 1;
  }

  // 출격한 기물 크기 (기물은 성 안에서 대기하므로 지도에는 출격 중일 때만 보인다)
  const gSize = clamp(z * 2.4, 16, 30);

  // 내 궁성: 체크면 킹 칸에서 번지는 붉은 빛 하나 (마지막 3초에만 맥동)
  const me = game.human;
  const urgePulse = ui.urgent ? pulse : 0.5;
  if (me && me.alive && me.king >= 0) {
    const [x, y] = S(me.king);
    if (me.check) {
      const r = (C.PALACE_RADIUS + 0.5) * z;
      const k = 0.7 + 0.3 * urgePulse;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255, 0, 0, ${0.6 * k})`);
      grad.addColorStop(0.25, `rgba(231, 0, 0, ${0.45 * k})`);
      grad.addColorStop(0.89, 'rgba(169, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, (C.PALACE_RADIUS + 0.5) * z, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.lineWidth = me.check ? 5 : 3.5;
    ctx.stroke();
    ctx.setLineDash(me.check ? [] : [5, 4]);
    ctx.strokeStyle = me.check ? 'rgba(239, 68, 68, 0.85)' : 'rgba(250, 204, 21, 0.95)';
    ctx.lineWidth = me.check ? 3 : 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 출격 중인 기물은 그 부대의 최전선을 따라다닌다 (나와 관련된 공격만)
  for (const a of game.attacks) {
    if (!a.general || a.lastTile < 0 || (a.attacker !== hid && a.target !== hid)) continue;
    const [x, y] = S(a.lastTile);
    const owner = game.players[a.attacker];
    ctx.beginPath();
    ctx.arc(x, y, gSize * (0.75 + 0.15 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = a.attacker === hid ? 'rgba(253, 224, 71, 0.25)' : 'rgba(248, 113, 113, 0.3)';
    ctx.fill();
    drawPiece(ctx, PIECES[a.general.type].glyph, x, y, gSize, owner.color, a.attacker === hid ? '#fde047' : '#fca5a5', 0.12);
  }

  // 킹
  const kSize = clamp(z * 3.4, 22, 46);
  for (const p of game.players) {
    if (!p || !p.alive || p.king < 0) continue;
    const [x, y] = S(p.king);
    if (p.isHuman && ui.threat) {
      ctx.beginPath();
      ctx.arc(x, y, kSize * (0.8 + 0.25 * urgePulse), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.5 + 0.5 * urgePulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (p.isHuman) {
      ctx.shadowColor = 'rgba(250, 204, 21, 0.9)';
      ctx.shadowBlur = 16;
    }
    drawPiece(ctx, PIECES.king.glyph, x, y, kSize, p.color, p.isHuman ? '#facc15' : '#f8fafc', p.isHuman ? 0.14 : 0.11);
    ctx.shadowBlur = 0;
  }

  // 첫 판 안내 '넓히기': 내 영토 둘레에 노란 링이 맥동한다
  if (ui.coachRing && me?.alive && me.king >= 0) {
    const [x, y] = S(me.king);
    const r = (Math.sqrt(me.tiles / Math.PI) + 3) * z;
    ctx.beginPath();
    ctx.arc(x, y, r * (1 + 0.06 * pulse), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.35 + 0.45 * pulse})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 시작 위치 고르기: 추천 자리에 노란 원
  if (game.phase === 'spawn' && ui.spawnHint >= 0) {
    const [x, y] = S(ui.spawnHint);
    ctx.beginPath();
    ctx.arc(x, y, (C.SPAWN_RADIUS + 0.5) * z * (0.92 + 0.08 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // 방금 공격을 보낸 칸: 0.2초 동안 커지며 사라지는 노란 링
  const fx = ui.clickFx;
  if (fx && now - fx.t < 200 && !reduceMotion) {
    const f = (now - fx.t) / 200;
    const [x, y] = S(fx.tile);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(6, z) * (0.6 + 1.6 * f), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.9 * (1 - f)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // 터치로 핵 조준: 첫 탭 자리에 폭발 범위 + 확인 칩, 한 번 더 탭하면 발사
  const aim = ui.nukeAim;
  if (aim >= 0 && C.NUKES[ui.mode]) {
    const [x, y] = S(aim);
    const r = (C.NUKES[ui.mode].radius + 0.5) * z;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(239, 68, 68, ${0.15 + 0.12 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const text = '한 번 더 탭하면 발사';
    ctx.font = '700 14px "Noto Sans KR", system-ui, sans-serif';
    const cw = ctx.measureText(text).width + 28;
    const cx = Math.min(Math.max(x, cw / 2 + 8), w - cw / 2 - 8);
    const cy = Math.min(Math.max(y - r - 22, 70), h - 40);
    ctx.fillStyle = 'rgba(9, 14, 26, 0.9)';
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - 15, cw, 30, 15);
    ctx.fill();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.fillText(text, cx, cy + 1);
  }

  // 마우스 아래 (터치는 길게 누른 칸)
  if (hover >= 0) {
    const [x, y] = S(hover);
    const mode = game.phase === 'spawn' ? 'spawn' : ui.mode;
    const radius = mode === 'spawn' ? C.SPAWN_RADIUS : C.NUKES[mode]?.radius;
    if (radius) {
      ctx.beginPath();
      ctx.arc(x, y, (radius + 0.5) * z, 0, Math.PI * 2);
      ctx.fillStyle = mode === 'spawn' ? 'rgba(255,255,255,0.15)' : 'rgba(239,68,68,0.18)';
      ctx.fill();
      ctx.strokeStyle = mode === 'spawn' ? '#fff' : '#f87171';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - z / 2, y - z / 2, z, z);
    }
    if (game.phase === 'play' && game.terrain[hover] !== C.WATER) drawHoverChip(ctx, game, hover, x, y, z);
  }
}

// 마우스를 올린 칸의 정보 한 줄: 남의 나라면 이름 · 병력 · 외교 상태, 무주지면 지형과 점령 비용
function drawHoverChip(ctx, game, t, x, y, z) {
  const hid = game.humanId;
  const o = game.owner[t];
  if (o === hid) return;
  let text;
  let color = '#e8edf5';
  if (o) {
    const p = game.players[o];
    const tags = [game.allied(hid, o) ? '🤝 동맹' : '', game.isTraitor(o) ? '⚠ 배신자' : ''].filter(Boolean).join(' ');
    text = `${p.name} · 병력 ${fmt(p.troops)}${tags ? ` · ${tags}` : ''}`;
    color = p.color;
  } else {
    const terr = game.terrain[t];
    text = `무주지 · ${C.TERRAIN_NAMES[terr]}${C.TERRAIN_COST[terr] > 1 ? ` (비용 ×${C.TERRAIN_COST[terr]})` : ''}`;
  }
  if (game.fallout[t] > game.tick) text += ` · 방사능 ×${C.FALLOUT_COST_MULT}`;
  ctx.font = '600 12px "Noto Sans KR", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 22;
  // 화면 오른쪽 끝에 걸리면 칸의 왼쪽에 (좁은 폰 화면)
  const vw = ctx.canvas.width / (ctx.getTransform().a || 1);
  const bx = x + z + 10 + w > vw - 8 ? Math.max(8, x - z - 10 - w) : x + z + 10;
  const by = y - 26;
  ctx.fillStyle = 'rgba(9, 14, 26, 0.85)';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, 22, 11);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bx + 10, by + 11, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8edf5';
  ctx.textAlign = 'left';
  ctx.fillText(text, bx + 18, by + 11.5);
  ctx.textAlign = 'center';
}
