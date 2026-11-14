import { useEffect, useRef } from 'react';
import { cn, fmtLat, fmtLon, font } from '@ds';
import { useSimEngine } from '@/sim/SimProvider';
import { gridRef, RELIEF_M } from '@/sim/terrain';
import {
  CELL_M, CellState, GRID_H, GRID_W, ORIGIN,
  type ForecastBand, type Grid, type MapLayers, type Marker, type SimSnapshot, type Unit, type Vec, type WorldMeta,
} from '@/sim/types';
import {
  C, buildContours, buildFuelCanvas, buildHatch, buildTerrainCanvas, createFireRaster, rasterFire, rgba, type RGB,
} from './layers';

export type MapMode = 'ortho' | 'oblique';

export interface TacticalMapProps {
  layers: MapLayers;
  selectedId?: string | null;
  onSelect?(id: string | null): void;
  className?: string;
  mode?: MapMode;
}

const TILT_DEG = 35;
const MIN_Z = 1;
const MAX_Z = 4;
const LAT_PER_CELL = CELL_M / 111320;
const LON_PER_CELL = CELL_M / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
const HIT_PX = 14;
const MONO = font.mono;

const cellToLatLon = (p: Vec) => ({ lat: ORIGIN.lat - p.y * LAT_PER_CELL, lon: ORIGIN.lon + p.x * LON_PER_CELL });
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface StaticLayers {
  terrain: HTMLCanvasElement;
  fuel: HTMLCanvasElement;
  contours: { minor: Path2D; major: Path2D };
  hatch: HTMLCanvasElement;
  highway: Path2D;
  roads: Path2D;
  trails: Path2D;
  river: Path2D;
}

// Built once per world grid and shared by every map instance.
const staticCache = new WeakMap<Grid, StaticLayers>();

function polyPath(pts: Vec[], into = new Path2D()) {
  pts.forEach((p, i) => (i === 0 ? into.moveTo(p.x, p.y) : into.lineTo(p.x, p.y)));
  return into;
}

function getStatic(grid: Grid, meta: WorldMeta | undefined): StaticLayers {
  let s = staticCache.get(grid);
  if (s) return s;
  const highway = new Path2D(), roads = new Path2D(), trails = new Path2D();
  for (const r of meta?.roads ?? []) polyPath(r.points, r.kind === 'highway' ? highway : r.kind === 'trail' ? trails : roads);
  s = {
    terrain: buildTerrainCanvas(grid, 5),
    fuel: buildFuelCanvas(grid),
    contours: buildContours(grid),
    hatch: buildHatch(C.amber, 0.55),
    highway, roads, trails,
    river: polyPath(meta?.river ?? []),
  };
  staticCache.set(grid, s);
  return s;
}

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = v;
}

function niceStep(target: number, steps: number[]) {
  for (const s of steps) if (s >= target) return s;
  return steps[steps.length - 1];
}

export function TacticalMap({ layers, selectedId = null, onSelect, className, mode = 'ortho' }: TacticalMapProps) {
  const engine = useSimEngine();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const gridRefEl = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const scaleLabelRef = useRef<HTMLSpanElement>(null);
  const props = useRef({ layers, selectedId, onSelect, mode });
  props.current = { layers, selectedId, onSelect, mode };
  const api = useRef<{ zoomBy(f: number): void; reset(): void; focusFire(): void; relayout(): void } | null>(null);

  useEffect(() => {
    const root = rootRef.current!, stage = stageRef.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const fr = createFireRaster(GRID_W, GRID_H);
    let st: StaticLayers | null = null;
    let lastVersion = -1;
    let lastRaster = -1;

    // Opening frame: the fire head and Pine Hollow, rather than the whole AO.
    const HOME = { z: 1.15, cx: GRID_W * 0.4, cy: GRID_H * 0.52 };
    const view = { ...HOME };
    const goal = { ...view };
    const L = { PW: 1, PH: 1, SW: 1, SH: 1, tilt: 0, P: 1000, dpr: 1 };
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;
    const onMq = () => { reduced = mq.matches; };
    mq.addEventListener?.('change', onMq);
    let visible = true;
    let hoverId: string | null = null;
    let scaleKey = '';

    // --- projection: root(screen) <-> stage(local) <-> world(cells) -------------
    const toStage = (sx: number, sy: number) => {
      const c = Math.cos(L.tilt), s = Math.sin(L.tilt);
      const dx = sx - L.PW / 2, dy = sy - L.PH / 2;
      const Y = (L.P * dy) / (L.P * c + dy * s);
      const k = L.P / (L.P - Y * s);
      return { u: dx / k + L.SW / 2, v: Y + L.SH / 2 };
    };
    const fromStage = (u: number, v: number) => {
      const c = Math.cos(L.tilt), s = Math.sin(L.tilt);
      const X = u - L.SW / 2, Y = v - L.SH / 2;
      const k = L.P / (L.P - Y * s);
      return { x: L.PW / 2 + X * k, y: L.PH / 2 + Y * c * k };
    };
    const baseScale = () => Math.max(L.SW / GRID_W, L.SH / GRID_H);
    const w2s = (x: number, y: number, v = view) => {
      const S = baseScale() * v.z;
      return { x: (x - v.cx) * S + L.SW / 2, y: (y - v.cy) * S + L.SH / 2 };
    };
    const s2w = (u: number, vv: number, v = view) => {
      const S = baseScale() * v.z;
      return { x: (u - L.SW / 2) / S + v.cx, y: (vv - L.SH / 2) / S + v.cy };
    };
    const clampView = (v: typeof view) => {
      v.z = clamp(v.z, MIN_Z, MAX_Z);
      const S = baseScale() * v.z;
      // Clamp against the visible viewport (the oblique stage overscans it) and allow a
      // margin past the AO sheet edge so fires near the boundary can still be centered.
      const vw = L.tilt ? L.PW : L.SW, vh = L.tilt ? L.PH : L.SH;
      const hw = (vw / (2 * S)) * 0.55, hh = (vh / (2 * S)) * 0.7;
      v.cx = GRID_W > hw * 2 ? clamp(v.cx, hw, GRID_W - hw) : GRID_W / 2;
      v.cy = GRID_H > hh * 2 ? clamp(v.cy, hh, GRID_H - hh) : GRID_H / 2;
    };

    function layout() {
      const r = root.getBoundingClientRect();
      L.PW = Math.max(1, r.width);
      L.PH = Math.max(1, r.height);
      const oblique = props.current.mode === 'oblique';
      L.tilt = oblique ? (TILT_DEG * Math.PI) / 180 : 0;
      L.P = Math.max(900, Math.max(L.PW, L.PH) * 1.3);
      L.SW = L.PW; L.SH = L.PH;
      if (oblique) {
        // Grow the tilted plane until it covers every viewport corner.
        let fx = 1, fy = 1;
        for (let i = 0; i < 80; i++) {
          L.SW = L.PW * fx; L.SH = L.PH * fy;
          let okX = true, okY = true;
          for (const [x, y] of [[0, 0], [L.PW, 0], [0, L.PH], [L.PW, L.PH]]) {
            const p = toStage(x, y);
            if (p.u < 0 || p.u > L.SW) okX = false;
            if (p.v < 0 || p.v > L.SH) okY = false;
          }
          if (okX && okY) break;
          if (!okX) fx += 0.04;
          if (!okY) fy += 0.04;
        }
        L.SW *= 1.02; L.SH *= 1.02;
      }
      stage.style.width = `${L.SW}px`;
      stage.style.height = `${L.SH}px`;
      stage.style.left = `${(L.PW - L.SW) / 2}px`;
      stage.style.top = `${(L.PH - L.SH) / 2}px`;
      stage.style.transform = oblique ? `rotateX(${TILT_DEG}deg)` : 'none';
      root.style.perspective = oblique ? `${L.P}px` : 'none';
      L.dpr = Math.min(window.devicePixelRatio || 1, oblique ? 1.5 : 2);
      canvas.width = Math.round(L.SW * L.dpr);
      canvas.height = Math.round(L.SH * L.dpr);
      canvas.style.width = `${L.SW}px`;
      canvas.style.height = `${L.SH}px`;
      clampView(view);
      clampView(goal);
    }

    // --- hit testing ------------------------------------------------------------
    function hit(sx: number, sy: number): string | null {
      const { u, v } = toStage(sx, sy);
      const s = engine.state;
      const ly = props.current.layers;
      let best = HIT_PX, id: string | null = null;
      if (ly.units) for (const un of s.units) {
        const p = w2s(un.pos.x, un.pos.y);
        const d = Math.hypot(p.x - u, p.y - v);
        if (d < best) { best = d; id = un.id; }
      }
      if (ly.markers) for (const m of s.markers) {
        const p = w2s(m.pos.x, m.pos.y);
        const d = Math.hypot(p.x - u, p.y - v) + 2;
        if (d < best) { best = d; id = m.id; }
      }
      return id;
    }

    // --- input --------------------------------------------------------------------
    const local = (e: { clientX: number; clientY: number }) => {
      const r = root.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let drag: { id: number; sx: number; sy: number; anchor: Vec; moved: boolean } | null = null;

    function updateReadout(sx: number, sy: number) {
      const { u, v } = toStage(sx, sy);
      const w = s2w(u, v);
      if (w.x < 0 || w.y < 0 || w.x > GRID_W || w.y > GRID_H) return;
      const ll = cellToLatLon(w);
      const g = engine.state.grid;
      const e = g.elevation[Math.floor(w.y) * g.w + Math.floor(w.x)] ?? 0;
      if (coordRef.current) coordRef.current.textContent = `${fmtLat(ll.lat, 4)} ${fmtLon(ll.lon, 4)}`;
      if (gridRefEl.current) gridRefEl.current.textContent = `GRID ${gridRef(w)} · EL ${Math.round(420 + e * RELIEF_M)} M`;
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      const { u, v } = toStage(p.x, p.y);
      drag = { id: e.pointerId, sx: p.x, sy: p.y, anchor: s2w(u, v), moved: false };
      root.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      updateReadout(p.x, p.y);
      if (drag && drag.id === e.pointerId) {
        if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) { drag.moved = true; root.style.cursor = 'grabbing'; }
        if (drag.moved) {
          const { u, v } = toStage(p.x, p.y);
          const w = s2w(u, v);
          view.cx += drag.anchor.x - w.x;
          view.cy += drag.anchor.y - w.y;
          clampView(view);
          goal.cx = view.cx; goal.cy = view.cy; goal.z = view.z;
        }
        return;
      }
      const id = hit(p.x, p.y);
      if (id !== hoverId) { hoverId = id; root.style.cursor = id ? 'pointer' : 'crosshair'; }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const p = local(e);
      if (!drag.moved) props.current.onSelect?.(hit(p.x, p.y));
      drag = null;
      root.style.cursor = hoverId ? 'pointer' : 'crosshair';
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    };
    function zoomAt(sx: number, sy: number, factor: number) {
      const { u, v } = toStage(sx, sy);
      const w = s2w(u, v, goal);
      const nz = clamp(goal.z * factor, MIN_Z, MAX_Z);
      const S = baseScale() * nz;
      goal.z = nz;
      goal.cx = w.x - (u - L.SW / 2) / S;
      goal.cy = w.y - (v - L.SH / 2) / S;
      clampView(goal);
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    const onKey = (e: KeyboardEvent) => {
      const step = 18 / (baseScale() * goal.z);
      let handled = true;
      switch (e.key) {
        case '+': case '=': zoomAt(L.PW / 2, L.PH / 2, 1.4); break;
        case '-': case '_': zoomAt(L.PW / 2, L.PH / 2, 1 / 1.4); break;
        case '0': Object.assign(goal, HOME); clampView(goal); break;
        case 'ArrowLeft': goal.cx -= step * 3; break;
        case 'ArrowRight': goal.cx += step * 3; break;
        case 'ArrowUp': goal.cy -= step * 3; break;
        case 'ArrowDown': goal.cy += step * 3; break;
        case 'Escape': props.current.onSelect?.(null); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); clampView(goal); }
    };
    const onLeave = () => { hoverId = null; };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('keydown', onKey);

    api.current = {
      zoomBy: (f) => zoomAt(L.PW / 2, L.PH / 2, f),
      reset: () => { Object.assign(goal, HOME); clampView(goal); },
      focusFire: () => {
        const s = engine.state;
        let sx = 0, sy = 0, n = 0;
        const g = s.grid;
        for (let i = 0; i < g.w * g.h; i += 1) if (g.state[i] === CellState.Burning) { sx += i % g.w; sy += (i / g.w) | 0; n++; }
        if (!n) return;
        goal.z = Math.max(goal.z, 2.2);
        goal.cx = sx / n; goal.cy = sy / n;
        clampView(goal);
      },
      relayout: layout,
    };

    const ro = new ResizeObserver(() => layout());
    ro.observe(root);
    const io = new IntersectionObserver((ents) => { visible = ents.some((x) => x.isIntersecting); }, { rootMargin: '120px' });
    io.observe(root);
    layout();
    {
      // Frame the opening view on the active fire, biased downwind (east) toward the town.
      const g = engine.state.grid;
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < g.w * g.h; i += 1) if (g.state[i] !== CellState.Unburnt) { sx += i % g.w; sy += (i / g.w) | 0; n++; }
      if (n) { HOME.cx = sx / n + 14; HOME.cy = sy / n - 4; HOME.z = 1.35; }
      Object.assign(view, HOME); clampView(view); Object.assign(goal, view);
    }

    // --- drawing helpers -----------------------------------------------------------
    const fontStr = (px: number, weight = 500) => `${weight} ${px}px ${MONO}`;

    function plateText(text: string, x: number, y: number, col: RGB, px = 9, alpha = 1, plate = true) {
      ctx.font = fontStr(px);
      setSpacing(ctx, '0.12em');
      const w = ctx.measureText(text).width;
      if (plate) {
        ctx.fillStyle = rgba(C.ink950, 0.72 * alpha);
        ctx.fillRect(x - 3, y - px + 1, w + 5, px + 4);
      }
      ctx.fillStyle = rgba(col, alpha);
      ctx.fillText(text, x, y + 1);
      return w;
    }

    function leaderLabel(p: { x: number; y: number }, lines: { text: string; col: RGB; px?: number; alpha?: number }[], col: RGB, alpha = 1) {
      const x1 = p.x + 7, y1 = p.y - 7, x2 = p.x + 15, y2 = p.y - 15;
      ctx.strokeStyle = rgba(col, 0.55 * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 + 5, y2);
      ctx.stroke();
      let y = y2 + 3;
      lines.forEach((ln, i) => {
        plateText(ln.text, x2 + 8, y, ln.col, ln.px ?? (i === 0 ? 9 : 8), (ln.alpha ?? 1) * alpha);
        y += (ln.px ?? 9) + 4;
      });
    }

    function drawGrid() {
      const S = baseScale() * view.z;
      const tl = s2w(0, 0), br = s2w(L.SW, L.SH);
      const latStep = niceStep((70 / S) * LAT_PER_CELL, [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05]);
      const lonStep = niceStep((70 / S) * LON_PER_CELL, [0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05]);
      const latTop = ORIGIN.lat - tl.y * LAT_PER_CELL, latBot = ORIGIN.lat - br.y * LAT_PER_CELL;
      const lonL = ORIGIN.lon + tl.x * LON_PER_CELL, lonR = ORIGIN.lon + br.x * LON_PER_CELL;
      const lats: { v: number; lat: number }[] = [];
      const lons: { u: number; lon: number }[] = [];
      for (let lat = Math.ceil(latBot / latStep) * latStep; lat <= latTop; lat += latStep) {
        const y = (ORIGIN.lat - lat) / LAT_PER_CELL;
        if (y < 0 || y > GRID_H) continue;
        lats.push({ v: w2s(0, y).y, lat });
      }
      for (let lon = Math.ceil(lonL / lonStep) * lonStep; lon <= lonR; lon += lonStep) {
        const x = (lon - ORIGIN.lon) / LON_PER_CELL;
        if (x < 0 || x > GRID_W) continue;
        lons.push({ u: w2s(x, 0).x, lon });
      }
      const m0 = w2s(0, 0), m1 = w2s(GRID_W, GRID_H);
      const u0 = Math.max(0, m0.x), u1 = Math.min(L.SW, m1.x), v0 = Math.max(0, m0.y), v1 = Math.min(L.SH, m1.y);
      ctx.strokeStyle = rgba(C.bone, 0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const l of lats) { ctx.moveTo(u0, Math.round(l.v) + 0.5); ctx.lineTo(u1, Math.round(l.v) + 0.5); }
      for (const l of lons) { ctx.moveTo(Math.round(l.u) + 0.5, v0); ctx.lineTo(Math.round(l.u) + 0.5, v1); }
      ctx.stroke();
      // Registration crosses at intersections.
      ctx.strokeStyle = rgba(C.bone, 0.28);
      ctx.beginPath();
      for (const a of lats) for (const b of lons) {
        const x = Math.round(b.u) + 0.5, y = Math.round(a.v) + 0.5;
        ctx.moveTo(x - 3, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 4);
      }
      ctx.stroke();
      // Edge labels along the visible viewport edges (accounts for oblique tilt).
      // Longitudes label the bottom edge, latitudes the left edge (clear of the zoom rail).
      const vBot = Math.min(v1, toStage(L.PW / 2, L.PH).v - 2);
      const uL = toStage(0, L.PH).u, uR = toStage(L.PW, L.PH).u;
      for (const l of lons) {
        if (l.u < uL + 70 || l.u > uR - 70) continue;
        ctx.fillStyle = rgba(C.bone, 0.35);
        ctx.fillRect(Math.round(l.u), vBot - 6, 1, 6);
        plateText(fmtLon(l.lon, 3), Math.round(l.u) + 4, vBot - 8, C.boneMute, 8, 0.85);
      }
      for (const l of lats) {
        const sy = fromStage(L.SW / 2, l.v).y;
        if (sy < 60 || sy > L.PH - 40) continue;
        const ul = Math.max(u0, toStage(0, sy).u + 2);
        ctx.fillStyle = rgba(C.bone, 0.35);
        ctx.fillRect(ul, Math.round(l.v), 6, 1);
        plateText(fmtLat(l.lat, 3), ul + 52, Math.round(l.v) + 3, C.boneMute, 8, 0.85);
      }
    }

    function drawForecast(bands: ForecastBand[], s: SimSnapshot) {
      if (!st) return;
      const pat = ctx.createPattern(st.hatch, 'repeat');
      const to = ((s.wind.dirDeg + 180) * Math.PI) / 180;
      const wx = Math.sin(to), wy = -Math.cos(to);
      const style: Record<number, { dash: number[]; a: number; fill: number }> = {
        60: { dash: [6, 3], a: 0.95, fill: 0.2 },
        180: { dash: [4, 4], a: 0.7, fill: 0.14 },
        360: { dash: [2, 4], a: 0.5, fill: 0.1 },
      };
      for (let k = bands.length - 1; k >= 0; k--) {
        const b = bands[k];
        const sty = style[b.horizonMin];
        ctx.beginPath();
        let best = -Infinity, lp = { x: 0, y: 0 };
        b.polygon.forEach((q, i) => {
          const p = w2s(q.x, q.y);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          const pr = q.x * wx + q.y * wy;
          if (pr > best) { best = pr; lp = p; }
        });
        ctx.closePath();
        if (pat) {
          ctx.globalAlpha = sty.fill;
          ctx.fillStyle = pat;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.setLineDash(sty.dash);
        ctx.strokeStyle = rgba(C.amber, sty.a);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        const lx = lp.x + wx * 8, ly = lp.y + wy * 8;
        ctx.fillStyle = rgba(C.amber, sty.a);
        ctx.fillRect(lp.x - 1.5, lp.y - 1.5, 3, 3);
        plateText(`+${b.horizonMin / 60}H · ${Math.round(b.confidence * 100)}%`, lx + 2, ly + 3, C.amber, 8, sty.a);
      }
    }

    function drawWorldVectors(meta: WorldMeta | undefined, g: Grid, S: number) {
      if (!st || !meta) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(C.ice, 0.22);
      ctx.lineWidth = 1.2 / S;
      ctx.stroke(st.river);
      ctx.strokeStyle = rgba(C.bone, 0.16);
      ctx.lineWidth = 3 / S;
      ctx.stroke(st.highway);
      ctx.strokeStyle = rgba(C.bone, 0.62);
      ctx.lineWidth = 1.1 / S;
      ctx.stroke(st.highway);
      ctx.strokeStyle = rgba(C.bone, 0.36);
      ctx.lineWidth = 0.9 / S;
      ctx.stroke(st.roads);
      ctx.setLineDash([3 / S, 3 / S]);
      ctx.strokeStyle = rgba(C.bone, 0.32);
      ctx.stroke(st.trails);
      ctx.setLineDash([]);
      // Buildings: tight grid blocks; burnt footprints go dark with an ember rim.
      for (const b of meta.buildings) {
        const i = Math.floor(b.y + b.h / 2) * g.w + Math.floor(b.x + b.w / 2);
        const s = g.state[i];
        if (s === CellState.Burnt || s === CellState.Burning) {
          ctx.fillStyle = rgba(C.scar, 1);
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = rgba(C.ember, 0.7);
          ctx.lineWidth = 0.8 / S;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        } else {
          ctx.fillStyle = rgba(C.bone, 0.3);
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = rgba(C.bone, 0.55);
          ctx.lineWidth = 0.6 / S;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
        }
      }
      ctx.lineCap = 'butt';
    }

    function drawLandmarks(meta: WorldMeta | undefined) {
      if (!meta) return;
      const glyph = (p: Vec, kind: 'heli' | 'air' | 'icp') => {
        const q = w2s(p.x, p.y);
        ctx.strokeStyle = rgba(C.bone, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (kind === 'heli') {
          ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
          ctx.moveTo(q.x - 2.5, q.y - 3); ctx.lineTo(q.x - 2.5, q.y + 3);
          ctx.moveTo(q.x + 2.5, q.y - 3); ctx.lineTo(q.x + 2.5, q.y + 3);
          ctx.moveTo(q.x - 2.5, q.y); ctx.lineTo(q.x + 2.5, q.y);
        } else if (kind === 'air') {
          ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 6, q.y + 5); ctx.lineTo(q.x - 6, q.y + 5); ctx.closePath();
        } else {
          ctx.rect(q.x - 4.5, q.y - 4.5, 9, 9);
          ctx.moveTo(q.x - 4.5, q.y - 4.5); ctx.lineTo(q.x + 4.5, q.y + 4.5);
        }
        ctx.stroke();
      };
      glyph(meta.helibase, 'heli');
      glyph(meta.airbase, 'air');
      glyph(meta.icp, 'icp');
      for (const lm of meta.landmarks) {
        const q = w2s(lm.pos.x, lm.pos.y);
        const town = lm.id === 'lm-town';
        ctx.font = fontStr(town ? 10 : 8, town ? 600 : 500);
        setSpacing(ctx, town ? '0.28em' : '0.16em');
        const w = ctx.measureText(lm.label).width;
        ctx.fillStyle = rgba(town ? C.bone : C.boneMute, town ? 0.92 : 0.8);
        ctx.fillText(lm.label, q.x - w / 2, q.y);
      }
    }

    function markerColor(m: Marker): RGB {
      switch (m.kind) {
        case 'human': return C.violet;
        case 'spot': return C.ember;
        case 'fuel': case 'hazard': return C.amber;
        case 'water': return C.ice;
        default: return C.bone;
      }
    }

    function drawMarker(m: Marker, t: number, selected: boolean) {
      const p = w2s(m.pos.x, m.pos.y);
      if (p.x < -40 || p.y < -40 || p.x > L.SW + 40 || p.y > L.SH + 40) return;
      const col = markerColor(m);
      const live = m.severity !== 'low';
      const a = live ? 1 : 0.55;
      ctx.lineWidth = 1;
      if (live && (m.kind === 'human' || m.kind === 'spot')) {
        const ph = reduced ? 0.4 : (t % 1.8) / 1.8;
        ctx.strokeStyle = rgba(col, (1 - ph) * 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + ph * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(col, a);
      ctx.fillStyle = rgba(col, a);
      ctx.beginPath();
      switch (m.kind) {
        case 'human':
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'spot':
          ctx.moveTo(p.x, p.y - 5.5); ctx.lineTo(p.x + 5.5, p.y); ctx.lineTo(p.x, p.y + 5.5); ctx.lineTo(p.x - 5.5, p.y); ctx.closePath(); ctx.fill();
          break;
        case 'fuel':
          ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y + 5); ctx.lineTo(p.x - 6, p.y + 5); ctx.closePath(); ctx.stroke();
          ctx.fillRect(p.x - 1, p.y + 0.5, 2, 2);
          break;
        case 'hazard':
          ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y + 5); ctx.lineTo(p.x - 6, p.y + 5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = rgba(C.ink950, 1);
          ctx.fillRect(p.x - 0.75, p.y - 2.5, 1.5, 4); ctx.fillRect(p.x - 0.75, p.y + 2.5, 1.5, 1.5);
          break;
        case 'structure':
          ctx.rect(p.x - 5, p.y - 5, 10, 10); ctx.stroke();
          ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
          break;
        case 'water':
          ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(p.x - 3.5, p.y); ctx.quadraticCurveTo(p.x - 1.75, p.y - 2, p.x, p.y); ctx.quadraticCurveTo(p.x + 1.75, p.y + 2, p.x + 3.5, p.y); ctx.stroke();
          break;
        default:
          ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x - 2, p.y); ctx.moveTo(p.x + 2, p.y); ctx.lineTo(p.x + 6, p.y);
          ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y - 2); ctx.moveTo(p.x, p.y + 2); ctx.lineTo(p.x, p.y + 6); ctx.stroke();
      }
      leaderLabel(p, [
        { text: m.label, col },
        { text: `${Math.round(m.confidence * 100)}% · ${gridRef(m.pos)}`, col: C.boneMute, px: 8 },
      ], col, selected ? 1 : a);
    }

    function unitColor(u: Unit): RGB {
      if (u.status === 'standby') return C.boneMute;
      if (u.status === 'rtb') return C.amber;
      return u.kind === 'drone' || u.kind === 'helo' || u.kind === 'tanker' ? C.ice : C.bone;
    }

    function drawUnit(u: Unit, t: number, S: number) {
      const p = w2s(u.pos.x, u.pos.y);
      if (p.x < -60 || p.y < -60 || p.x > L.SW + 60 || p.y > L.SH + 60) return;
      const col = unitColor(u);
      // Trail: fading dotted breadcrumb.
      const n = u.trail.length;
      for (let i = 0; i < n; i++) {
        const q = w2s(u.trail[i].x, u.trail[i].y);
        ctx.fillStyle = rgba(col, 0.08 + (i / n) * 0.45);
        ctx.fillRect(q.x - 0.75, q.y - 0.75, 1.5, 1.5);
      }
      if (u.target && u.status === 'enroute') {
        const q = w2s(u.target.x, u.target.y);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = rgba(col, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(q.x - 3, q.y - 3); ctx.lineTo(q.x + 3, q.y + 3); ctx.moveTo(q.x + 3, q.y - 3); ctx.lineTo(q.x - 3, q.y + 3);
        ctx.stroke();
      }
      const h = (u.heading * Math.PI) / 180;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (u.kind === 'drone' && u.status !== 'standby') {
        const len = clamp(5 * S, 28, 74), half = (21 * Math.PI) / 180;
        ctx.save();
        ctx.rotate(h);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.sin(-half) * len, -Math.cos(half) * len);
        ctx.lineTo(Math.sin(half) * len, -Math.cos(half) * len);
        ctx.closePath();
        ctx.fillStyle = rgba(C.ice, 0.07);
        ctx.fill();
        ctx.strokeStyle = rgba(C.ice, 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(Math.sin(-half) * len, -Math.cos(half) * len);
        ctx.moveTo(0, 0); ctx.lineTo(Math.sin(half) * len, -Math.cos(half) * len);
        ctx.stroke();
        if (!reduced) {
          const sw = ((t * 0.9) % 1) * len;
          ctx.strokeStyle = rgba(C.ice, 0.22);
          ctx.beginPath(); ctx.moveTo(Math.sin(-half) * sw, -Math.cos(half) * sw); ctx.lineTo(Math.sin(half) * sw, -Math.cos(half) * sw); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(col, 1);
      ctx.fillStyle = rgba(col, 1);
      switch (u.kind) {
        case 'drone':
          ctx.rotate(h);
          ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
          break;
        case 'helo':
          ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.setLineDash([2, 3]);
          ctx.lineDashOffset = reduced ? 0 : -t * 20;
          ctx.strokeStyle = rgba(col, 0.55); ctx.stroke();
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.rotate(h);
          ctx.beginPath(); ctx.moveTo(0, -5.5); ctx.lineTo(4, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
          ctx.fillRect(-0.5, 5, 1, 5);
          break;
        case 'tanker':
          ctx.rotate(h);
          ctx.beginPath();
          ctx.moveTo(0, -10); ctx.lineTo(1.8, -3); ctx.lineTo(10, 1.5); ctx.lineTo(10, 3.5); ctx.lineTo(1.8, 1.5); ctx.lineTo(1.2, 6.5);
          ctx.lineTo(4, 8.5); ctx.lineTo(-4, 8.5); ctx.lineTo(-1.2, 6.5); ctx.lineTo(-1.8, 1.5); ctx.lineTo(-10, 3.5); ctx.lineTo(-10, 1.5); ctx.lineTo(-1.8, -3);
          ctx.closePath(); ctx.fill();
          break;
        case 'engine':
          ctx.fillStyle = rgba(C.ink950, 0.9);
          ctx.fillRect(-4.5, -4.5, 9, 9);
          ctx.strokeRect(-4.5, -4.5, 9, 9);
          ctx.fillStyle = rgba(col, 1);
          ctx.fillRect(-1.5, -1.5, 3, 3);
          ctx.beginPath(); ctx.moveTo(Math.sin(h) * 5, -Math.cos(h) * 5); ctx.lineTo(Math.sin(h) * 9, -Math.cos(h) * 9); ctx.stroke();
          break;
        case 'crew':
          ctx.fillStyle = rgba(C.ink950, 0.9);
          ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-2.5, 0); ctx.lineTo(2.5, 0); ctx.moveTo(0, -2.5); ctx.lineTo(0, 2.5); ctx.stroke();
          break;
        case 'dozer':
          ctx.fillStyle = rgba(C.ink950, 0.9);
          ctx.fillRect(-5, -4, 10, 8);
          ctx.strokeRect(-5, -4, 10, 8);
          ctx.beginPath(); ctx.moveTo(-3, 4); ctx.lineTo(3, -4); ctx.moveTo(-5, 1); ctx.lineTo(-1, -4); ctx.moveTo(1, 4); ctx.lineTo(5, -1); ctx.stroke();
          break;
      }
      ctx.restore();
      const sub = typeof u.battery === 'number' ? `BAT ${Math.round(u.battery * 100)}` : typeof u.water === 'number' ? `H2O ${Math.round(u.water * 100)}` : u.kind === 'crew' ? 'HAND CREW' : 'DOZER';
      leaderLabel(p, [
        { text: u.callsign, col: u.status === 'standby' ? C.boneDim : C.bone },
        { text: `${sub} · ${u.status.toUpperCase()}`, col: C.boneMute, px: 8 },
      ], col);
    }

    function drawReticle(p: { x: number; y: number }, t: number) {
      const r = 15 + (reduced ? 0 : Math.sin(t * 4) * 1.2);
      const k = 6;
      ctx.strokeStyle = rgba(C.signal, 1);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(p.x + sx * r, p.y + sy * (r - k));
        ctx.lineTo(p.x + sx * r, p.y + sy * r);
        ctx.lineTo(p.x + sx * (r - k), p.y + sy * r);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba(C.signal, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - r - 8, p.y); ctx.lineTo(p.x - r - 3, p.y);
      ctx.moveTo(p.x + r + 3, p.y); ctx.lineTo(p.x + r + 8, p.y);
      ctx.moveTo(p.x, p.y - r - 8); ctx.lineTo(p.x, p.y - r - 3);
      ctx.moveTo(p.x, p.y + r + 3); ctx.lineTo(p.x, p.y + r + 8);
      ctx.stroke();
    }

    const head = { version: -1, ok: false, x: 0, y: 0 };
    function drawHead(s: SimSnapshot) {
      const g = s.grid;
      const to = ((s.wind.dirDeg + 180) * Math.PI) / 180;
      const wx = Math.sin(to), wy = -Math.cos(to);
      if (head.version !== g.version) {
        head.version = g.version;
        let n = 0, sx = 0, sy = 0;
        for (let i = 0; i < g.w * g.h; i++) if (g.state[i] === CellState.Burning) { sx += i % g.w; sy += (i / g.w) | 0; n++; }
        head.ok = n >= 4;
        if (head.ok) {
          const cx = sx / n, cy = sy / n;
          let best = -Infinity;
          for (let i = 0; i < g.w * g.h; i++) {
            if (g.state[i] !== CellState.Burning) continue;
            const x = i % g.w, y = (i / g.w) | 0;
            const pr = (x - cx) * wx + (y - cy) * wy;
            if (pr > best) { best = pr; head.x = x + 0.5; head.y = y + 0.5; }
          }
        }
      }
      if (!head.ok) return;
      const p = w2s(head.x, head.y);
      const q = { x: p.x + wx * 14, y: p.y + wy * 14 };
      ctx.strokeStyle = rgba(C.ember, 0.95);
      ctx.fillStyle = rgba(C.ember, 0.95);
      ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(p.x + wx * 4, p.y + wy * 4); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x + wx * 6, q.y + wy * 6);
      ctx.lineTo(q.x - wy * 3.5, q.y + wx * 3.5);
      ctx.lineTo(q.x + wy * 3.5, q.y - wx * 3.5);
      ctx.closePath(); ctx.fill();
      plateText(`HEAD · ${Math.round(s.metrics.rateOfSpreadMpm)} M/MIN`, q.x + wx * 10 + 4, q.y + wy * 10 + 3, C.ember, 8, 0.95);
    }

    // --- frame loop ------------------------------------------------------------------
    let raf = 0;
    let lastNow = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      if (!visible || document.hidden) return;
      const s = engine.state;
      const g = s.grid;
      if (!st) st = getStatic(g, s.world);
      const ly = props.current.layers;
      const t = now / 1000;

      const a = reduced ? 1 : 1 - Math.exp(-dt * 12);
      view.z += (goal.z - view.z) * a;
      view.cx += (goal.cx - view.cx) * a;
      view.cy += (goal.cy - view.cy) * a;
      clampView(view);

      if (ly.fire && (g.version !== lastVersion || (!reduced && t - lastRaster > 0.11))) {
        rasterFire(g, fr, t, !reduced, g.version !== lastVersion);
        lastVersion = g.version;
        lastRaster = t;
      }

      const S = baseScale() * view.z;
      const D = L.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(C.void, 1);
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // World space.
      ctx.setTransform(D * S, 0, 0, D * S, D * (L.SW / 2 - view.cx * S), D * (L.SH / 2 - view.cy * S));
      ctx.imageSmoothingEnabled = true;
      if (ly.terrain) ctx.drawImage(st.terrain, 0, 0, GRID_W, GRID_H);
      else { ctx.fillStyle = rgba(C.ink950, 1); ctx.fillRect(0, 0, GRID_W, GRID_H); }
      if (ly.fuel) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(st.fuel, 0, 0, GRID_W, GRID_H);
        ctx.imageSmoothingEnabled = true;
      }
      if (ly.contours) {
        ctx.strokeStyle = rgba(C.bone, ly.terrain ? 0.07 : 0.12);
        ctx.lineWidth = 0.8 / S;
        ctx.stroke(st.contours.minor);
        ctx.strokeStyle = rgba(C.bone, ly.terrain ? 0.16 : 0.24);
        ctx.lineWidth = 1 / S;
        ctx.stroke(st.contours.major);
      }
      drawWorldVectors(s.world, g, S);
      if (ly.fire) {
        ctx.drawImage(fr.canvas, 0, 0, GRID_W, GRID_H);
        ctx.strokeStyle = rgba(C.signalHot, 0.85);
        ctx.lineWidth = 1.1 / S;
        ctx.stroke(fr.front);
        ctx.globalCompositeOperation = 'lighter';
        const fl = reduced ? 0 : 0.07 * Math.sin(t * 9.3) + 0.05 * Math.sin(t * 23.1);
        ctx.globalAlpha = 0.38 + fl;
        ctx.drawImage(fr.bloomSmall, -2, -2, GRID_W + 4, GRID_H + 4);
        ctx.globalAlpha = 0.16 + fl * 0.5;
        ctx.drawImage(fr.bloom, 0, 0, GRID_W, GRID_H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = rgba(C.bone, 0.22);
      ctx.lineWidth = 1 / S;
      ctx.strokeRect(0, 0, GRID_W, GRID_H);

      // Screen space.
      ctx.setTransform(D, 0, 0, D, 0, 0);
      if (ly.forecast && s.forecast.length) drawForecast(s.forecast, s);
      if (ly.grid) drawGrid();
      drawLandmarks(s.world);
      if (ly.fire) drawHead(s);
      const sel = props.current.selectedId;
      if (ly.markers) for (const m of s.markers) drawMarker(m, t, m.id === sel);
      if (ly.units) for (const u of s.units) drawUnit(u, t, S);
      if (sel) {
        const u = s.units.find((x) => x.id === sel);
        const m = u ? undefined : s.markers.find((x) => x.id === sel);
        const pos = u?.pos ?? m?.pos;
        if (pos) drawReticle(w2s(pos.x, pos.y), t);
      }

      // HUD readouts (DOM, updated only on change).
      const mpp = CELL_M / S;
      const len = niceStep(mpp * 90, [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]);
      const key = `${len}|${Math.round(len / mpp)}|${view.z.toFixed(1)}`;
      if (key !== scaleKey) {
        scaleKey = key;
        if (scaleBarRef.current) scaleBarRef.current.style.width = `${Math.round(len / mpp)}px`;
        if (scaleLabelRef.current) scaleLabelRef.current.textContent = len >= 1000 ? `${len / 1000} KM` : `${len} M`;
        if (zoomRef.current) zoomRef.current.textContent = `${view.z.toFixed(1)}X`;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener?.('change', onMq);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('keydown', onKey);
      api.current = null;
    };
  }, [engine]);

  useEffect(() => {
    api.current?.relayout();
  }, [mode]);

  const btn =
    'grid h-7 w-7 place-items-center border border-line bg-ink-950/90 text-bone-dim transition-colors duration-quick ease-servo hover:bg-ink-800 hover:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal';

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="application"
      aria-label="Tactical map. Drag to pan, scroll to zoom, plus and minus keys to zoom, arrow keys to pan, 0 to reset."
      className={cn('relative h-full w-full touch-none select-none overflow-hidden bg-void outline-none', className)}
      style={{ cursor: 'crosshair' }}
    >
      <div ref={stageRef} className="absolute left-0 top-0 will-change-transform" style={{ transformOrigin: '50% 50%' }}>
        <canvas ref={canvasRef} className="block" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines opacity-60" />

      {/* Cursor readout + scale bar (top center) */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-raised flex -translate-x-1/2 items-center gap-3 whitespace-nowrap border border-line bg-ink-950/85 px-2.5 py-1.5 font-mono text-micro uppercase text-bone-mute fcc-num">
        <span ref={coordRef} className="text-bone-dim">{`${fmtLat(ORIGIN.lat, 4)} ${fmtLon(ORIGIN.lon, 4)}`}</span>
        <span className="h-3 w-px bg-line" />
        <span ref={gridRefEl}>GRID A-01</span>
        <span className="h-3 w-px bg-line" />
        <span className="flex items-center gap-1.5">
          <span ref={scaleBarRef} className="h-1.5 border-x border-b border-bone-dim" style={{ width: 80 }} />
          <span ref={scaleLabelRef} className="text-bone-dim">1 KM</span>
        </span>
      </div>

      {/* North arrow + zoom controls (left center) */}
      <div className="absolute left-3 top-1/2 z-raised flex -translate-y-1/2 flex-col items-center gap-px">
        <div aria-hidden className="mb-1.5 grid h-9 w-7 place-items-center border border-line bg-ink-950/90 text-bone">
          <svg width="14" height="26" viewBox="0 0 14 26" fill="none" className="text-bone">
            <path d="M7 1 L12 14 L7 11 L2 14 Z" fill="currentColor" />
            <path d="M7 11 L12 14 L7 25 L2 14 Z" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          </svg>
        </div>
        <span className="mb-1 font-mono text-micro text-bone-mute">N</span>
        <button type="button" aria-label="Zoom in" className={btn} onClick={() => api.current?.zoomBy(1.5)}>
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.25"><path d="M6 1v10M1 6h10" /></svg>
        </button>
        <button type="button" aria-label="Zoom out" className={btn} onClick={() => api.current?.zoomBy(1 / 1.5)}>
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.25"><path d="M1 6h10" /></svg>
        </button>
        <button type="button" aria-label="Focus active fire" className={btn} onClick={() => api.current?.focusFire()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
            <circle cx="7" cy="7" r="3.5" />
            <path d="M7 0.5v3M7 10.5v3M0.5 7h3M10.5 7h3" />
          </svg>
        </button>
        <button type="button" aria-label="Reset view" className={btn} onClick={() => api.current?.reset()}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25">
            <path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" />
          </svg>
        </button>
        <span ref={zoomRef} className="mt-1 font-mono text-micro text-bone-mute fcc-num">1.0X</span>
      </div>
    </div>
  );
}
