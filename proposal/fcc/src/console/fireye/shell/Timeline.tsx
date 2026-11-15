import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from '@ds';
import type { Ms } from '../../contracts';
import { useConsoleApi, useConsoleSelector } from '../../store';
import { localHour, localTime, packZone } from '../../ui/format';
import { RISK_ALERT, RISK_WATCH, riskBand } from '../data/risk';
import { useChronicle } from './sync';

const SPEEDS = [1, 10, 60, 180, 600] as const;
const H = 74;

export function Timeline({ onSeek }: { onSeek: (t: Ms) => void }) {
  const ch = useChronicle();
  const api = useConsoleApi();
  const t = useConsoleSelector((s) => s.clock.t);
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const pack = useConsoleSelector((s) => s.pack);
  const tz = packZone(pack).label;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<Ms | null>(null);
  const [drag, setDrag] = useState<Ms | null>(null);
  const lastSeek = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const start = ch?.start ?? 0, end = ch?.end ?? 1;
  const x = (tt: Ms) => ((tt - start) / (end - start)) * w;
  const tAt = (px: number) => Math.max(start, Math.min(end, start + (px / Math.max(1, w)) * (end - start)));

  const riskPath = useMemo(() => {
    if (!ch) return { line: '', area: '' };
    const top = 18, hh = 30;
    const pts = ch.risk.map((r) => `${x(r.t).toFixed(1)},${(top + hh - (r.value / 100) * hh).toFixed(1)}`);
    return { line: `M${pts.join('L')}`, area: `M${x(start)},${top + hh}L${pts.join('L')}L${x(end)},${top + hh}Z` };
  }, [ch, w]);

  const ticks = useMemo(() => {
    const out: { t: Ms; label: string }[] = [];
    if (!ch) return out;
    const first = Math.ceil(start / 3600000) * 3600000;
    for (let tt = first; tt <= end; tt += 3600000) out.push({ t: tt, label: `${String(localHour(tt, tz)).padStart(2, '0')}:00` });
    return out;
  }, [ch, tz, start, end]);

  const density = useMemo(() => {
    if (!ch) return [];
    const bins = new Map<number, { i: number; o: number; crit: boolean }>();
    for (const e of ch.entries) {
      const b = Math.floor(x(e.t) / 3);
      const v = bins.get(b) ?? { i: 0, o: 0, crit: false };
      if (e.tab === 'intake') v.i++; else v.o++;
      if (e.severity === 'critical') v.crit = true;
      bins.set(b, v);
    }
    return [...bins.entries()];
  }, [ch, w]);

  // Chapters cluster around ignition; push labels right so they never overlap.
  const chapterLabels = useMemo(() => {
    let end = -Infinity;
    return (ch?.chapters ?? []).slice().sort((a, b) => a.t - b.t).map((c) => {
      const lx = Math.max(x(c.t) + 5, end + 6);
      end = lx + c.short.length * 6.4;
      return { c, lx };
    });
  }, [ch, w]);

  const seekThrottled = (tt: Ms, final = false) => {
    const now = performance.now();
    if (!final && now - lastSeek.current < 140) return;
    lastSeek.current = now;
    onSeek(tt);
  };
  const shown = drag ?? t;
  const risk = ch?.risk.reduce((best, r) => (Math.abs(r.t - (hover ?? shown)) < Math.abs(best.t - (hover ?? shown)) ? r : best), ch.risk[0]);
  const keyStep = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 30 * 60000 : 5 * 60000;
    if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(end, t + step)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(start, t - step)); }
    if (e.key === 'Home') { e.preventDefault(); onSeek(start); }
    if (e.key === 'End') { e.preventDefault(); onSeek(end); }
  };

  return (
    <div className="fireye-enter flex h-[86px] shrink-0 items-stretch border-t border-line bg-ink-950" style={{ ['--i' as string]: 4 }}>
      <div className="flex w-[232px] shrink-0 flex-col justify-center gap-2 border-r border-line px-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => api.setPaused(!paused)} aria-label={paused ? 'Play' : 'Pause'}
            className="flex h-7 w-7 items-center justify-center border border-line-strong bg-ink-900 text-bone hover:bg-ink-800">
            <Icon name={paused ? 'play' : 'pause'} size={12} />
          </button>
          <div className="flex flex-col leading-none">
            <span className="fcc-num font-mono text-sm text-bone">{localTime(shown, tz, true)}</span>
            <span className="mt-0.5 font-mono text-micro uppercase text-bone-mute">{tz} · {drag != null ? 'Scrubbing' : paused ? 'Paused' : 'Replay'}</span>
          </div>
        </div>
        <div role="group" aria-label="Replay speed" className="flex h-6 items-stretch border border-line-strong">
          {SPEEDS.map((s, i) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => api.setSpeed(s)}
              className={cn('flex-1 font-mono text-micro uppercase', i > 0 && 'border-l border-line', speed === s ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-w-0 flex-1 px-4">
        <div
          ref={ref}
          role="slider"
          tabIndex={0}
          aria-label="Incident timeline"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={t}
          aria-valuetext={`${localTime(t, tz)} ${tz}`}
          onKeyDown={keyStep}
          className="relative h-full cursor-ew-resize touch-none select-none outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const tt = tAt(e.clientX - r.left);
            setHover(tt);
            if (drag != null) { setDrag(tt); seekThrottled(tt); }
          }}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = e.currentTarget.getBoundingClientRect();
            const tt = tAt(e.clientX - r.left);
            setDrag(tt);
            seekThrottled(tt, true);
          }}
          onPointerUp={(e) => {
            if (drag == null) return;
            const r = e.currentTarget.getBoundingClientRect();
            seekThrottled(tAt(e.clientX - r.left), true);
            setDrag(null);
          }}
        >
          <svg width={w} height={H} className="absolute left-0 top-1.5 overflow-visible" aria-hidden>
            {/* day / twilight / night band */}
            {ch?.light.map((l, i) => {
              const next = ch.light[i + 1];
              if (!next) return null;
              const dark = 1 - l.daylight;
              return dark > 0.02 ? <rect key={l.t} x={x(l.t)} y={52} width={Math.max(0.5, x(next.t) - x(l.t)) + 0.5} height={5} className="fill-ink-500" opacity={dark * 0.9} /> : null;
            })}
            <rect x={0} y={52} width={w} height={5} className="fill-none stroke-line" strokeWidth={1} />
            {/* risk thresholds */}
            {[RISK_WATCH, RISK_ALERT].map((v) => <line key={v} x1={0} x2={w} y1={48 - (v / 100) * 30} y2={48 - (v / 100) * 30} className="stroke-line" strokeDasharray="2 4" />)}
            <path d={riskPath.area} className="fill-amber/10" />
            <path d={riskPath.line} className="fill-none stroke-amber" strokeWidth={1.25} />
            {/* past shade */}
            <rect x={0} y={16} width={Math.max(0, x(shown))} height={34} className="fill-bone/[0.03]" />
            {/* event density */}
            {density.map(([b, v]) => (
              <g key={b}>
                {v.i > 0 && <rect x={b * 3} y={60} width={2} height={Math.min(6, 1 + v.i)} className={v.crit ? 'fill-ember' : 'fill-bone-mute'} />}
                {v.o > 0 && <rect x={b * 3} y={67} width={2} height={Math.min(6, 1 + v.o)} className="fill-ice/70" />}
              </g>
            ))}
            {/* hours */}
            {ticks.map((k) => (
              <g key={k.t}>
                <line x1={x(k.t)} x2={x(k.t)} y1={14} y2={50} className="stroke-line-faint" />
                <text x={x(k.t) + 3} y={47} className="fill-bone-mute font-mono text-micro">{k.label}</text>
              </g>
            ))}
            {/* chapters */}
            {chapterLabels.map(({ c, lx }) => (
              <g key={c.id}>
                <line x1={x(c.t)} x2={x(c.t)} y1={8} y2={57} className={c.id === 'ignition' ? 'stroke-ember' : 'stroke-bone-mute'} strokeWidth={c.id === 'ignition' ? 1.25 : 1} strokeDasharray={c.id === 'ignition' ? undefined : '1 2'} />
                <rect x={x(c.t) - 2} y={4} width={4} height={4} className={c.id === 'ignition' ? 'fill-ember' : 'fill-bone-dim'} />
                {lx > x(c.t) + 6 && <line x1={x(c.t) + 2} x2={lx - 2} y1={6} y2={6} className="stroke-line-strong" />}
                <text x={lx} y={10} className={cn('font-mono text-micro uppercase', c.id === 'ignition' ? 'fill-ember' : 'fill-bone-dim')}>
                  <title>{c.label}</title>{c.short}
                </text>
              </g>
            ))}
            {/* hover ghost */}
            {hover != null && drag == null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={72} className="stroke-bone-mute" strokeDasharray="2 2" />}
            {/* playhead */}
            <g style={{ transform: `translateX(${x(shown)}px)` }}>
              <line x1={0} x2={0} y1={-2} y2={73} className="stroke-signal" strokeWidth={1.5} />
              <path d="M-4,-4 L4,-4 L0,1 Z" className="fill-signal" />
            </g>
          </svg>
          {(hover != null || drag != null) && (
            <div className="pointer-events-none absolute -top-7 z-hud -translate-x-1/2 border border-line-strong bg-ink-900 px-1.5 py-0.5 font-mono text-micro uppercase text-bone shadow-panel"
              style={{ left: x(drag ?? hover!) }}>
              <span className="fcc-num">{localTime(drag ?? hover!, tz)}</span>
              {risk && <span className="ml-2 text-amber">Risk {Math.round(risk.value)} · {riskBand(risk.value)}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-[150px] shrink-0 flex-col justify-center gap-1 border-l border-line px-3 font-mono text-micro uppercase text-bone-mute">
        <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-amber" />Ignition risk · sim</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 bg-ink-500" />Night</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-0.5 bg-bone-mute" /><span className="h-1.5 w-0.5 bg-ice/70" />Intake · Ops</span>
      </div>
    </div>
  );
}
