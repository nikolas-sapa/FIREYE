import { useMemo } from 'react';
import type { Geo } from '../contracts';
import { useConsoleSelector } from '../store';
import type { EscapeRoute } from './geo/evac';

const S = 1000;

/** Flat resident map for devices without WebGL: pack imagery, fire perimeter, projection bands, home and route. */
export function ResidentMap2D({ home, route }: { home: Geo | null; route: EscapeRoute | null }) {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 60000) * 60000);
  const proj = useConsoleSelector((s) => s.projection);
  const perimeter = useMemo(() => pack?.perimeters.filter((p) => p.t <= t).at(-1) ?? null, [pack, t]);
  const bands = useMemo(() => (proj && proj.issuedAt <= t ? [...proj.bands].filter((b) => b.horizonMin <= 180 && b.polygon.length > 2).sort((a, b) => b.horizonMin - a.horizonMin) : []), [proj, t]);
  if (!pack) return null;
  const [bw, bs, be, bn] = pack.manifest.bbox;
  const k = Math.cos((((bs + bn) / 2) * Math.PI) / 180);
  const x = (g: Geo) => (g.lon - bw) * k * S;
  const y = (g: Geo) => (bn - g.lat) * S;
  const pts = (list: Geo[]) => list.map((g) => `${x(g).toFixed(2)},${y(g).toFixed(2)}`).join(' ');
  const focus: Geo[] = [...(home ? [home] : []), ...(perimeter?.polygon.flat() ?? []), ...(bands.find((b) => b.horizonMin === 60)?.polygon ?? []), ...(route?.path ?? [])];
  const view = focus.length ? focus : [{ lon: bw, lat: bs }, { lon: be, lat: bn }];
  const xs = view.map(x), ys = view.map(y);
  const pad = Math.max(4, (Math.max(...xs) - Math.min(...xs)) * 0.2, (Math.max(...ys) - Math.min(...ys)) * 0.2);
  const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];
  const im = pack.imagery;
  const unit = vb[2]! / 300;
  return (
    <div className="absolute inset-0 z-[2] bg-ink-950" data-resident-map-2d>
      <svg viewBox={vb.map((v) => v.toFixed(2)).join(' ')} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img"
        aria-label="2D fire map: simulated perimeter, projection, your location and route">
        {im && <image href={im.url} x={(im.bbox[0] - bw) * k * S} y={(bn - im.bbox[3]) * S}
          width={(im.bbox[2] - im.bbox[0]) * k * S} height={(im.bbox[3] - im.bbox[1]) * S} preserveAspectRatio="none" />}
        {bands.map((b) => (
          <polygon key={b.horizonMin} points={pts(b.polygon)} style={{ fill: `rgb(var(--ember) / ${b.horizonMin === 60 ? 0.28 : 0.16})`, stroke: 'rgb(var(--ember))', strokeWidth: unit * (b.horizonMin === 60 ? 1.4 : 0.8), strokeDasharray: b.horizonMin === 60 ? undefined : `${unit * 4} ${unit * 3}` }} />
        ))}
        {perimeter?.polygon.map((ring, i) => (
          <polygon key={i} points={pts(ring)} style={{ fill: 'rgb(var(--ember) / 0.6)', stroke: 'rgb(var(--ember))', strokeWidth: unit * 1.2 }} />
        ))}
        {route && <polyline points={pts(route.path)} style={{ fill: 'none', stroke: 'rgb(var(--signal))', strokeWidth: unit * 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />}
        {home && <circle cx={x(home)} cy={y(home)} r={unit * 3} style={{ fill: 'rgb(var(--signal))', stroke: 'rgb(var(--ink-950))', strokeWidth: unit }} />}
      </svg>
      <span className="pointer-events-none absolute bottom-[104px] left-3 border border-line bg-ink-950 px-2 py-1 font-mono text-micro uppercase tracking-[0.12em] text-bone-mute sm:bottom-3">
        2D map · WebGL unavailable · simulation
      </span>
    </div>
  );
}
