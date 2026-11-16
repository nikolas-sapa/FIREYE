import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Brackets, Button, Datum, Dot, GridBg, Icon, Label, RegMark, Ruler, cn, fmtLat, fmtLon, pad } from '@ds';
import { ORIGIN } from '@/sim/types';

/* ---------------------------------------------------------------------------
 * Geometry. World space is a unit square x,z in [-1, 1] (z = -1 is far),
 * height h in ~[0, 0.9]. Everything is projected into a 1000x720 viewBox.
 * ------------------------------------------------------------------------- */

const VW = 1000;
const VH = 720;
type P = [number, number];

function height(x: number, z: number) {
  const g = (cx: number, cz: number, s: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / s);
  return (
    0.58 * g(0.28, -0.42, 0.16) +
    0.36 * g(-0.58, -0.05, 0.11) +
    0.22 * g(0.75, 0.35, 0.08) +
    0.07 * Math.sin(3.1 * x + 1.3) * Math.cos(2.7 * z) +
    0.035 * Math.sin(7.3 * x + 4.1 * z) +
    0.1
  );
}

function project(x: number, z: number, h: number): P {
  const k = 1 / (1.75 - z * 0.55);
  return [VW / 2 + x * 640 * k, 360 + z * 260 * k * 1.4 - h * 280 * k];
}

const ground = (x: number, z: number, lift = 0): P => project(x, z, height(x, z) + lift);
const n1 = (v: number) => v.toFixed(1);
function toPath(pts: P[], close = false) {
  let d = '';
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${n1(pts[i][0])} ${n1(pts[i][1])}`;
  return close ? `${d}Z` : d;
}

/* Marching-squares edge table: 0 top, 1 right, 2 bottom, 3 left. */
const MS: Record<number, [number, number][]> = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]], 6: [[0, 2]], 7: [[3, 0]],
  8: [[3, 0]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
};

function buildTerrain() {
  const X0 = -1.2;
  const X1 = 1.2;
  const rows: { d: string; o: number }[] = [];
  const NR = 34;
  const NS = 80;
  for (let i = 0; i <= NR; i++) {
    const z = -1 + (2 * i) / NR;
    const pts: P[] = [];
    for (let j = 0; j <= NS; j++) {
      const x = X0 + ((X1 - X0) * j) / NS;
      pts.push(ground(x, z));
    }
    rows.push({ d: toPath(pts), o: 0.18 + 0.42 * (i / NR) });
  }
  const cols: { d: string; o: number }[] = [];
  const NC = 24;
  for (let j = 0; j <= NC; j++) {
    const x = X0 + ((X1 - X0) * j) / NC;
    const pts: P[] = [];
    for (let i = 0; i <= 48; i++) pts.push(ground(x, -1 + (2 * i) / 48));
    cols.push({ d: toPath(pts), o: 0.22 });
  }

  const GX = 96;
  const GZ = 64;
  const vals: number[] = [];
  const at = (i: number, j: number) => vals[j * (GX + 1) + i];
  const wx = (i: number) => X0 + ((X1 - X0) * i) / GX;
  const wz = (j: number) => -1 + (2 * j) / GZ;
  for (let j = 0; j <= GZ; j++) for (let i = 0; i <= GX; i++) vals.push(height(wx(i), wz(j)));

  const contours: { d: string; major: boolean }[] = [];
  const levels = [0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64];
  levels.forEach((lv, li) => {
    let d = '';
    for (let j = 0; j < GZ; j++) {
      for (let i = 0; i < GX; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const e = at(i, j + 1);
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (e > lv ? 1 : 0);
        const segs = MS[idx];
        if (!segs) continue;
        const edge = (k: number): P => {
          const x0 = wx(i);
          const x1 = wx(i + 1);
          const z0 = wz(j);
          const z1 = wz(j + 1);
          if (k === 0) return project(x0 + ((lv - a) / (b - a)) * (x1 - x0), z0, lv);
          if (k === 1) return project(x1, z0 + ((lv - b) / (c - b)) * (z1 - z0), lv);
          if (k === 2) return project(x0 + ((lv - e) / (c - e)) * (x1 - x0), z1, lv);
          return project(x0, z0 + ((lv - a) / (e - a)) * (z1 - z0), lv);
        };
        for (const [s, t] of segs) {
          const p = edge(s);
          const q = edge(t);
          d += `M${n1(p[0])} ${n1(p[1])}L${n1(q[0])} ${n1(q[1])}`;
        }
      }
    }
    contours.push({ d, major: li % 3 === 1 });
  });

  const road: P[] = [];
  for (let j = 0; j <= 80; j++) {
    const x = X0 + ((X1 - X0) * j) / 80;
    road.push(ground(x, 0.62 + 0.12 * Math.sin(2.6 * x + 0.4) - 0.1 * x, 0.004));
  }
  const creek: P[] = [];
  for (let j = 0; j <= 60; j++) {
    const z = -1 + (1.9 * j) / 60;
    creek.push(ground(-0.18 + 0.09 * Math.sin(4 * z + 1), z, 0.002));
  }

  return { rows, cols, contours, road: toPath(road), creek: toPath(creek), roadLabel: ground(-0.85, 0.62 + 0.12 * Math.sin(-1.81) + 0.085) };
}

/* Fire perimeter in world space. Wind pushes it up-slope toward the NE ridge. */
const FIRE = { x: 0.02, z: 0.2 };
const WIND = -0.95;
function perimeter(r0: number, skew: number, t: number, noise: number, n = 120): P[] {
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const head = Math.max(0, Math.cos(th - WIND)) ** 1.6;
    const jitter = 1 + noise * (0.09 * Math.sin(5 * th + t * 0.5) + 0.05 * Math.sin(11 * th - t * 0.8) + 0.03 * Math.sin(17 * th + 2));
    const r = r0 * (1 + skew * head) * jitter;
    pts.push([FIRE.x + r * Math.cos(th), FIRE.z + r * Math.sin(th) * 0.82]);
  }
  return pts;
}
const drape = (pts: P[], lift = 0.004) => pts.map(([x, z]) => ground(x, z, lift));

const STRUCTURES: P[] = [
  [0.6, -0.12], [0.64, -0.08], [0.58, -0.04], [0.68, -0.15], [0.71, -0.06], [0.63, -0.19],
];
const HUMAN: P = [0.4, 0.04];

/* ---------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------- */

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Seconds since mount, throttled to `fps`, paused while off-screen or under reduced motion. */
function useSceneTime(target: RefObject<Element>, fps = 30, frozenAt = 16) {
  const reduced = useReducedMotion();
  const [t, setT] = useState(frozenAt);
  useEffect(() => {
    if (reduced) {
      setT(frozenAt);
      return;
    }
    let visible = true;
    const io =
      typeof IntersectionObserver !== 'undefined' && target.current
        ? new IntersectionObserver(([e]) => (visible = e.isIntersecting))
        : null;
    if (io && target.current) io.observe(target.current);
    let raf = 0;
    let last = 0;
    let acc = frozenAt;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      if (visible) acc += dt;
      if (visible && now - last > 1000 / fps) {
        last = now;
        setT(acc);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [reduced, fps, frozenAt, target]);
  return { t, reduced };
}

/* ---------------------------------------------------------------------------
 * SVG layers
 * ------------------------------------------------------------------------- */

const TerrainLayer = memo(function TerrainLayer() {
  const g = useMemo(buildTerrain, []);
  return (
    <g>
      <g fill="none" className="stroke-ink-600" strokeWidth={0.6}>
        {g.cols.map((c, i) => (
          <path key={`c${i}`} d={c.d} strokeOpacity={c.o} />
        ))}
        {g.rows.map((r, i) => (
          <path key={`r${i}`} d={r.d} strokeOpacity={r.o} />
        ))}
      </g>
      <g fill="none">
        {g.contours.map((c, i) => (
          <path
            key={i}
            d={c.d}
            className={c.major ? 'stroke-ink-300' : 'stroke-ink-500'}
            strokeOpacity={c.major ? 0.55 : 0.45}
            strokeWidth={c.major ? 0.8 : 0.5}
          />
        ))}
      </g>
      <path d={g.creek} fill="none" className="stroke-ice" strokeOpacity={0.45} strokeWidth={1} />
      <path d={g.road} fill="none" className="stroke-bone-mute" strokeWidth={1} strokeDasharray="6 3 1 3" />
      <text
        x={g.roadLabel[0]}
        y={g.roadLabel[1]}
        className="fill-bone-mute font-mono"
        fontSize={9}
        letterSpacing="0.14em"
      >
        RIDGE RD
      </text>
    </g>
  );
});

type CalloutTone = 'ice' | 'violet' | 'amber' | 'ember' | 'bone';
const CALLOUT_TONE: Record<CalloutTone, { stroke: string; fill: string }> = {
  ice: { stroke: 'stroke-ice', fill: 'fill-ice' },
  violet: { stroke: 'stroke-violet', fill: 'fill-violet' },
  amber: { stroke: 'stroke-amber', fill: 'fill-amber' },
  ember: { stroke: 'stroke-ember', fill: 'fill-ember' },
  bone: { stroke: 'stroke-bone-mute', fill: 'fill-bone-dim' },
};

function Callout({ at, dx, dy, label, sub, tone }: { at: P; dx: number; dy: number; label: string; sub?: string; tone: CalloutTone }) {
  const c = CALLOUT_TONE[tone];
  const dir = dx >= 0 ? 1 : -1;
  const elbow: P = [at[0] + dx, at[1] + dy];
  const end: P = [elbow[0] + dir * 18, elbow[1]];
  const tx = end[0] + dir * 6;
  const anchor = dir > 0 ? 'start' : 'end';
  return (
    <g>
      <rect x={at[0] - 1.5} y={at[1] - 1.5} width={3} height={3} className={c.fill} />
      <polyline
        points={`${n1(at[0])},${n1(at[1])} ${n1(elbow[0])},${n1(elbow[1])} ${n1(end[0])},${n1(end[1])}`}
        fill="none"
        className={c.stroke}
        strokeWidth={0.75}
        strokeOpacity={0.85}
      />
      <text x={tx} y={end[1] + 3.5} textAnchor={anchor} className={cn('font-mono', c.fill)} fontSize={10} letterSpacing="0.12em">
        {label}
      </text>
      {sub && (
        <text x={tx} y={end[1] + 17} textAnchor={anchor} className="fill-bone-mute font-mono" fontSize={9} letterSpacing="0.14em">
          {sub}
        </text>
      )}
    </g>
  );
}

function Drone({ t, cx, cz, rx, rz, alt, speed, phase, label, sub, dx, dy }: {
  t: number; cx: number; cz: number; rx: number; rz: number; alt: number; speed: number; phase: number;
  label: string; sub: string; dx: number; dy: number;
}) {
  const orbit = useMemo(() => {
    const pts: P[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(project(cx + rx * Math.cos(a), cz + rz * Math.sin(a), alt));
    }
    return toPath(pts, true);
  }, [cx, cz, rx, rz, alt]);

  const a = phase + t * speed;
  const wx = cx + rx * Math.cos(a);
  const wz = cz + rz * Math.sin(a);
  const p = project(wx, wz, alt);
  const q = project(cx + rx * Math.cos(a + 0.05 * Math.sign(speed)), cz + rz * Math.sin(a + 0.05 * Math.sign(speed)), alt);
  const heading = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI + 90;
  const g = ground(wx, wz);
  const foot: P[] = [];
  for (let i = 0; i < 28; i++) {
    const b = (i / 28) * Math.PI * 2;
    foot.push(ground(wx + 0.055 * Math.cos(b), wz + 0.045 * Math.sin(b), 0.003));
  }

  return (
    <g>
      <path d={orbit} fill="none" className="stroke-ice" strokeOpacity={0.4} strokeWidth={0.75} strokeDasharray="2 4" />
      <path d={toPath(foot, true)} className="fill-ice/5 stroke-ice" strokeOpacity={0.5} strokeWidth={0.6} />
      <line x1={p[0]} y1={p[1]} x2={g[0]} y2={g[1]} className="stroke-ice" strokeOpacity={0.35} strokeWidth={0.6} strokeDasharray="1 3" />
      <g transform={`translate(${n1(p[0])} ${n1(p[1])}) rotate(${heading.toFixed(1)})`}>
        <path d="M0 -6L4.5 4.5L0 2L-4.5 4.5Z" className="fill-ice" />
      </g>
      <Callout at={p} dx={dx} dy={dy} label={label} sub={sub} tone="ice" />
    </g>
  );
}

function FireLayer({ t, reduced }: { t: number; reduced: boolean }) {
  const CYCLE = 34;
  const p = (t % CYCLE) / CYCLE;
  const grow = 1 - (1 - p) ** 2;
  const alpha = p > 0.93 ? (1 - p) / 0.07 : p < 0.03 ? p / 0.03 : 1;
  const r0 = 0.05 + 0.15 * grow;

  const front = drape(perimeter(r0, 0.85, t, 1));
  const scar = drape(perimeter(r0 * 0.62, 0.7, t * 0.6, 0.6));
  const bands = [
    { h: 1, pts: drape(perimeter(r0 + 0.06, 1.05, 0, 0.3, 80)), dash: '5 3', o: 0.9, label: '+1H' },
    { h: 3, pts: drape(perimeter(r0 + 0.13, 1.25, 0, 0.2, 80)), dash: '3 4', o: 0.65, label: '+3H PROJECTION' },
    { h: 6, pts: drape(perimeter(r0 + 0.22, 1.45, 0, 0.1, 80)), dash: '1 4', o: 0.45, label: '+6H' },
  ];
  // Head of the fire = the perimeter point furthest along the wind vector.
  const headOf = (pts: P[]) => pts.reduce((best, q) => (q[1] < best[1] ? q : best), pts[0]);
  const frontHead = headOf(front);
  const band3Head = headOf(bands[1].pts);
  const band6Head = headOf(bands[2].pts);

  return (
    <g opacity={alpha}>
      {bands.map((b) => (
        <path
          key={b.h}
          d={toPath(b.pts, true)}
          className="fill-amber/[0.03] stroke-amber"
          strokeOpacity={b.o}
          strokeWidth={0.9}
          strokeDasharray={b.dash}
        />
      ))}
      <path d={toPath(scar, true)} fill="url(#fcc-hero-hatch)" className="stroke-signal-deep" strokeOpacity={0.6} strokeWidth={0.6} />
      <path d={toPath(front, true)} fill="none" className="stroke-ember" strokeOpacity={0.18} strokeWidth={5} />
      <path d={toPath(front, true)} className="fill-ember/10 stroke-ember" strokeWidth={1.25} />
      {!reduced &&
        front
          .filter((_, i) => i % 9 === 0)
          .map((q, i) => (
            <rect
              key={i}
              x={q[0] - 1}
              y={q[1] - 1}
              width={2}
              height={2}
              className="fill-signal-hot"
              opacity={0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i * 1.7))}
            />
          ))}
      <Callout at={frontHead} dx={-70} dy={-46} label="ACTIVE FRONT" sub={`ROS ${(18 + 9 * grow).toFixed(1)} M/MIN`} tone="ember" />
      <Callout at={band3Head} dx={-40} dy={-34} label={bands[1].label} sub="CONF 0.78" tone="amber" />
      <text x={band6Head[0] + 6} y={band6Head[1] - 4} className="fill-amber font-mono" fontSize={9} letterSpacing="0.14em" opacity={0.8}>
        +6H
      </text>
    </g>
  );
}

function PoiLayer({ reduced }: { reduced: boolean }) {
  const human = ground(HUMAN[0], HUMAN[1], 0.004);
  const structures = STRUCTURES.map(([x, z]) => ground(x, z, 0.004));
  const sc = structures[0];
  return (
    <g>
      {structures.map((s, i) => (
        <rect key={i} x={s[0] - 3} y={s[1] - 2.5} width={6} height={5} className="fill-ink-950 stroke-bone-dim" strokeWidth={0.75} />
      ))}
      <Callout at={sc} dx={52} dy={-58} label="HAZARD · T1 · 78" sub="PINE HOLLOW · PROPANE ×3 · +2H" tone="bone" />

      <g transform={`translate(${n1(human[0])} ${n1(human[1])})`}>
        {!reduced && (
          <circle r={6} fill="none" className="stroke-violet" strokeWidth={0.75}>
            <animate attributeName="r" values="5;18" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0" dur="1.8s" repeatCount="indefinite" />
          </circle>
        )}
        <circle r={15} className="fill-violet/5 stroke-violet" strokeOpacity={0.7} strokeWidth={0.75} strokeDasharray="2 2" />
        <rect x={-6} y={-6} width={12} height={12} fill="none" className="stroke-violet" strokeWidth={0.9} />
        <rect x={-1.5} y={-1.5} width={3} height={3} className="fill-violet" />
      </g>
      <Callout at={[human[0] + 6, human[1] + 6]} dx={46} dy={40} label="LIFE · T0 INTERRUPT · 93" sub="2 HIKERS · SOCIAL 14 MIN · ±150 M" tone="violet" />
    </g>
  );
}

function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const { t, reduced } = useSceneTime(ref);
  const elapsed = 2 * 3600 + 14 * 60 + Math.floor(t);
  const tplus = `T+${pad(elapsed / 3600)}:${pad((elapsed % 3600) / 60)}:${pad(elapsed % 60)}`;

  return (
    <div ref={ref} className="relative">
      <div className="mb-3 flex items-end justify-between gap-4">
        <span className="fcc-micro">View 01 · Oblique 52° · Synthetic terrain</span>
        <span className="fcc-micro hidden sm:inline">AO Sierra-7 · Sim</span>
      </div>
      <Ruler ticks={60} major={10} className="mb-2" />
      <div className="relative aspect-[1000/720] w-full">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          className="absolute inset-0 h-full w-full overflow-hidden"
          role="img"
          aria-label="Simulated oblique terrain view: active fire perimeter with 1, 3 and 6 hour forecast bands, two drones in orbit, a human detection and threatened structures."
        >
          <defs>
            <pattern id="fcc-hero-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={5} height={5} className="fill-ink-950" fillOpacity={0.7} />
              <line x1={0} y1={0} x2={0} y2={5} className="stroke-signal" strokeOpacity={0.4} strokeWidth={1} />
            </pattern>
            <clipPath id="fcc-hero-clip">
              <rect x={0} y={0} width={VW} height={VH} />
            </clipPath>
          </defs>
          <g clipPath="url(#fcc-hero-clip)">
            <TerrainLayer />
            <FireLayer t={t} reduced={reduced} />
            <PoiLayer reduced={reduced} />
            <Drone t={t} cx={FIRE.x + 0.05} cz={FIRE.z - 0.04} rx={0.36} rz={0.28} alt={0.78} speed={0.22} phase={0.6} label="HAWK-2 · EO/IR" sub="BAT 72% · 120 M AGL" dx={34} dy={-30} />
            <Drone t={t} cx={-0.6} cz={-0.34} rx={0.16} rz={0.12} alt={0.86} speed={-0.38} phase={2} label="HAWK-4 · LWIR" sub="SCAN · NW FLANK" dx={-30} dy={-26} />
          </g>
          <g className="stroke-bone-mute" strokeWidth={0.75}>
            <line x1={VW / 2 - 10} y1={VH / 2} x2={VW / 2 - 3} y2={VH / 2} />
            <line x1={VW / 2 + 3} y1={VH / 2} x2={VW / 2 + 10} y2={VH / 2} />
            <line x1={VW / 2} y1={VH / 2 - 10} x2={VW / 2} y2={VH / 2 - 3} />
            <line x1={VW / 2} y1={VH / 2 + 3} x2={VW / 2} y2={VH / 2 + 10} />
          </g>
        </svg>
        <Brackets size={14} tone="bone" />
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <Dot className="bg-ember" live={!reduced} size={5} />
          <span className="font-mono text-micro uppercase text-bone">Live · Sim</span>
          <span className="font-mono text-micro text-bone-mute fcc-num">{tplus}</span>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 hidden items-center gap-2 border border-line-strong bg-ink-950/80 px-2 py-1 sm:flex">
          <Icon name="orchestrator" size={11} className="text-ice" />
          <span className="font-mono text-micro uppercase text-bone">Orchestrator</span>
          <span className="font-mono text-micro uppercase text-ember fcc-num">1 interrupt</span>
          <span className="font-mono text-micro uppercase text-amber fcc-num">2 focus</span>
          <span className="font-mono text-micro uppercase text-bone-mute fcc-num">6 ambient</span>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 hidden gap-5 sm:flex">
          <Datum label="Ctr" value={`${fmtLat(ORIGIN.lat - 0.0117)} ${fmtLon(ORIGIN.lon + 0.0321)}`} />
          <Datum label="Wind" value="247° / 28" unit="KPH" tone="text-amber" />
          <Datum label="RH" value="11" unit="%" />
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1">
          <span className="font-mono text-micro text-bone-mute">0 — 1 KM</span>
          <span className="flex h-1.5 w-24 border-x border-b border-bone-mute" aria-hidden>
            <span className="h-full w-1/2 border-r border-bone-mute" />
          </span>
        </div>
      </div>
      <Ruler ticks={60} major={10} labels start={0} step={100} className="mt-5" />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section
 * ------------------------------------------------------------------------- */

const STATS = [
  { k: 'S-01', pre: '', value: '07', unit: '', label: 'Input sources analysed' },
  { k: 'S-02', pre: '', value: '04', unit: '', label: 'Alert tiers, graded 0–100' },
  { k: 'S-03', pre: '', value: '360', unit: 'MIN', label: 'Fire path projection horizon' },
  { k: 'S-04', pre: '', value: '01', unit: '', label: 'Interrupt at a time, acknowledged' },
];

const scrollTo = (id: string) => () => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else window.location.hash = `#${id}`;
};

export default function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden border-b border-line">
      <GridBg variant="lines" className="opacity-60" />
      <div className="relative mx-auto flex min-h-[calc(100svh-3rem)] max-w-[1440px] flex-col px-6 lg:px-10">
        <RegMark className="absolute left-2 top-2 hidden lg:block" />
        <RegMark className="absolute right-2 top-2 hidden lg:block" />

        <div className="flex h-10 items-center justify-between gap-4 border-b border-line">
          <span className="truncate font-mono text-micro uppercase text-bone-mute">
            FCC <span className="text-ink-500">//</span> Proposal <span className="text-ink-500">//</span>{' '}
            <span className="text-bone-dim">Unclassified</span> <span className="text-ink-500">//</span> Rev D · 2026-11-14
          </span>
          <span className="hidden font-mono text-micro uppercase text-bone-mute fcc-num md:inline">
            {fmtLat(ORIGIN.lat)} {fmtLon(ORIGIN.lon)} · Sheet 01/05
          </span>
        </div>

        <div className="grid flex-1 grid-cols-1 items-center gap-12 py-12 lg:grid-cols-12 lg:gap-8 lg:py-16">
          <div className="relative z-raised lg:col-span-5">
            <Label index="01">Overview · Orchestrator-first fire command</Label>
            <h1 className="mt-8 font-sans text-4xl font-medium text-bone sm:text-5xl xl:text-6xl">
              <span className="block">Command</span>
              <span className="block whitespace-nowrap">
                the <span className="text-signal">fire.</span>
              </span>
            </h1>
            <p className="mt-6 font-sans text-2xl text-bone-mute xl:text-3xl">See it before it moves.</p>
            <p className="mt-8 max-w-md text-lg text-bone-dim">
              FCC is a calm, unified picture of a moving fire. Analysis agents read local news, satellite passes, vehicle
              and drone cameras, social video, weather and terrain. A projection agent re-draws the fire path as evidence
              arrives. The Orchestrator works beside the commander: it grades every finding, shows only what matters, relays
              it to fire, EMS, law and the public, and proposes where each group should move.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" iconRight="arrow-right" onClick={scrollTo('dashboard')}>
                Enter live ops
              </Button>
              <Button variant="secondary" size="lg" iconRight="arrow-up-right" onClick={() => window.location.assign(`${import.meta.env?.BASE_URL ?? '/'}console.html`)}>
                Open live console
              </Button>
              <Button variant="ghost" size="lg" onClick={scrollTo('architecture')}>
                How it works
              </Button>
            </div>
            <div className="mt-12 flex gap-8 border-t border-line pt-4">
              <Datum label="Core" value="Orchestrator" />
              <Datum label="Mode" value="Human-in-loop" />
              <Datum label="Data" value="Simulated" tone="text-amber" />
            </div>
          </div>
          <div className="relative lg:col-span-7">
            <HeroVisual />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.k} className="flex flex-col gap-3 bg-ink-950 py-6 pr-6 md:[&:not(:first-child)]:pl-6">
              <dt className="flex items-center justify-between">
                <span className="fcc-micro">{s.label}</span>
                <span className="font-mono text-micro text-ink-500">{s.k}</span>
              </dt>
              <dd className="flex items-baseline gap-1 font-mono text-3xl text-bone fcc-num">
                {s.pre && <span className="text-xl text-bone-mute">{s.pre}</span>}
                {s.value}
                {s.unit && <span className="ml-1 text-nano uppercase text-bone-mute">{s.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
