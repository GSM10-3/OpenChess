// 지도 그리기: 칸 색은 작은 오프스크린 캔버스(1칸 = 1픽셀)에 칠해 두고 확대해서 붙인다.
// 그 위에 이름 · 기물 · 배 · 핵 같은 것을 화면 좌표로 덧그린다.
import * as C from '../game/constants';
import { PIECES } from '../game/pieces';
import { fmt } from '../game/Game';

const TERRAIN_RGB = [null, [190, 199, 146], [170, 162, 118], [143, 136, 125]];
const DEEP = [20, 44, 72];
const SHALLOW = [33, 68, 104];
const FALLOUT = [150, 235, 70];
const BOT_PIECE_ZOOM = 8; // 이보다 멀리서 볼 때는 봇의 장군을 그리지 않는다
const GLYPH_FONT ='"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Apple Symbols", serif';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
    this.ctx.putImageData(this.img, 0, 0);
  }

  isBorder(t, o) {
    const { nbr, owner, terrain } = this.game;
    for (let k = 0; k < 4; k++) {
      const n = nbr[t * 4 + k];
      if (n >= 0 && terrain[n] !== C.WATER && owner[n] !== o) return true;
    }
    return false;
  }

  paint(t) {
    const g = this.game;
    const d = this.img.data;
    const i = t * 4;
    const terr = g.terrain[t];
    let c;
    if (terr === C.WATER) {
      c = this.shallow[t] ? SHALLOW : DEEP;
    } else {
      const s = this.shade[t];
      const base = TERRAIN_RGB[terr].map((v) => v * s);
      const o = g.owner[t];
      if (o) {
        const pc = this.colors[o];
        c = this.isBorder(t, o) ? pc.map((v) => v * 0.6) : mix(base, pc, 0.62);
      } else {
        c = base;
      }
      if (g.fallout[t] > g.tick) c = mix(c, FALLOUT, 0.42);
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }

  update() {
    const dirty = this.game.takeDirty();
    if (!dirty.length) return;
    const { nbr } = this.game;
    for (const t of dirty) {
      this.paint(t);
      for (let k = 0; k < 4; k++) {
        const n = nbr[t * 4 + k];
        if (n >= 0) this.paint(n);
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
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

function outlinedText(ctx, text, x, y, size, weight = 700, color = '#fff') {
  ctx.font = `${weight} ${Math.round(size)}px system-ui, "Malgun Gothic", sans-serif`;
  ctx.lineWidth = Math.max(2, size / 5);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
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

// ui: { mode, generalId, epPocket, threat }
export function drawScene(ctx, game, painter, cam, view, ui, hover, now) {
  const { dpr, w, h } = view;
  const z = cam.zoom;
  const W = game.W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a1726';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(painter.canvas, -cam.x * z, -cam.y * z, game.W * z, game.H * z);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tx = (t) => t % W;
  const ty = (t) => (t / W) | 0;
  const sx = (x) => (x + 0.5 - cam.x) * z;
  const sy = (y) => (y + 0.5 - cam.y) * z;
  const S = (t) => [sx(tx(t)), sy(ty(t))];
  const pulse = 0.5 + 0.5 * Math.sin(now / 180);
  const hid = game.humanId;

  // 앙파상으로 되찾을 수 있는 돌파 지역
  if (ui.epPocket) {
    ctx.fillStyle = `rgba(251, 191, 36, ${0.35 + 0.35 * pulse})`;
    for (const t of ui.epPocket) ctx.fillRect((tx(t) - cam.x) * z, (ty(t) - cam.y) * z, z + 0.5, z + 0.5);
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

  // 나이트 돌파 방향
  for (const a of game.attacks) {
    if (a.kind !== 'knight' || a.lastTile < 0) continue;
    if (a.attacker !== hid && a.target !== hid) continue;
    const [x1, y1] = S(a.lastTile);
    const [x2, y2] = S(a.aim);
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

  // 나라 이름 · 병력
  for (const p of game.players) {
    if (!p || !p.alive || p.tiles < 20) continue;
    const fs = Math.min(40, Math.sqrt(p.tiles) * z * 0.2);
    if (fs < 9) continue;
    const x = sx(p.sumX / p.tiles);
    const y = sy(p.sumY / p.tiles);
    outlinedText(ctx, p.name, x, y - fs * 0.45, fs, 800);
    outlinedText(ctx, fmt(p.troops), x, y + fs * 0.45, fs * 0.72, 600, '#e2e8f0');
  }

  // 대기 중인 장군
  // 화면에서 서로 겹치는 같은 나라 기물은 하나로 묶어 가장 높은 기물 + 개수로 그린다
  const gSize = clamp(z * 2.1, 13, 26);
  const clusters = [];
  for (const [tile, set] of game.stationed) {
    for (const g of set) {
      const owner = game.players[g.owner];
      if (!owner.isHuman && z < BOT_PIECE_ZOOM) continue;
      let [x, y] = S(tile);
      if (tile === owner.king) {
        x += gSize * 0.7;
        y += gSize * 0.5;
      }
      let c = clusters.find((k) => k.owner === owner && Math.abs(k.x - x) < gSize * 0.9 && Math.abs(k.y - y) < gSize * 0.9);
      if (!c) clusters.push((c = { owner, x, y, top: g, count: 0, selected: false }));
      c.count++;
      if (g.id === ui.generalId) {
        c.selected = true;
        c.top = g;
      } else if (!c.selected && PIECES[g.type].value > PIECES[c.top.type].value) {
        c.top = g;
      }
    }
  }
  for (const c of clusters) {
    if (c.selected) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, gSize * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(253, 224, 71, ${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    drawPiece(ctx, PIECES[c.top.type].glyph, c.x, c.y, gSize, c.owner.color, c.owner.isHuman ? '#f8fafc' : 'rgba(15,23,42,0.85)');
    if (c.count > 1) {
      ctx.beginPath();
      ctx.arc(c.x + gSize * 0.5, c.y - gSize * 0.45, gSize * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      outlinedText(ctx, String(c.count), c.x + gSize * 0.5, c.y - gSize * 0.45, gSize * 0.4, 700);
    }
  }

  // 재배치 중인 장군
  for (const p of game.players) {
    if (!p || !p.alive || (!p.isHuman && z < BOT_PIECE_ZOOM)) continue;
    for (const g of p.generals) {
      if (g.status !== 'moving') continue;
      const m = g.move;
      const f = clamp((game.tick - m.start) / (m.end - m.start), 0, 1);
      const x = sx(tx(m.from) * (1 - f) + tx(m.to) * f);
      const y = sy(ty(m.from) * (1 - f) + ty(m.to) * f);
      ctx.globalAlpha = 0.75;
      drawPiece(ctx, PIECES[g.type].glyph, x, y, gSize, p.color, '#bae6fd');
      ctx.globalAlpha = 1;
    }
  }

  // 내 궁성: 체크면 빨갛게 깜빡인다
  const me = game.human;
  if (me && me.alive && me.king >= 0) {
    const [x, y] = S(me.king);
    ctx.beginPath();
    ctx.arc(x, y, (C.PALACE_RADIUS + 0.5) * z, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.lineWidth = me.check ? 5 : 3.5;
    ctx.stroke();
    ctx.setLineDash(me.check ? [] : [5, 4]);
    ctx.strokeStyle = me.check ? `rgba(239, 68, 68, ${0.6 + 0.4 * pulse})` : 'rgba(250, 204, 21, 0.95)';
    ctx.lineWidth = me.check ? 3 : 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 킹
  const kSize = clamp(z * 3, 18, 40);
  for (const p of game.players) {
    if (!p || !p.alive || p.king < 0) continue;
    const [x, y] = S(p.king);
    if (p.isHuman && ui.threat) {
      ctx.beginPath();
      ctx.arc(x, y, kSize * (0.8 + 0.25 * pulse), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    drawPiece(ctx, PIECES.king.glyph, x, y, kSize, p.color, p.isHuman ? '#facc15' : '#f8fafc', 0.11);
  }

  // 마우스 아래
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
      const ok = mode !== 'move' || game.owner[hover] === hid;
      ctx.strokeStyle = ok ? 'rgba(255,255,255,0.9)' : 'rgba(248,113,113,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - z / 2, y - z / 2, z, z);
    }
  }
}
