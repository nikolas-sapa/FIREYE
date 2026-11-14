import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { cn } from '../utils';
import type { Tone } from '../tokens';
import { Brackets, Dot } from '../primitives';
import { Icon, type IconName } from '../icons';
import { Button, IconButton } from './Button';
import { clamp01, toneBorder, toneBorderL, toneSolid, toneText } from './tone';

/* ---------------------------------------------------------------------------
 * CONSOLE PATTERNS (REV C)
 * Vocabulary for the full-screen Orchestrator console: the decision queue,
 * score explanations, autonomy and role lenses, the scenario timeline, the
 * agent work ledger, drafted documents, layout directives and the demo
 * director caption. Types are local to the design system and structurally
 * identical to src/console/contracts.ts, so console values pass straight in.
 * ------------------------------------------------------------------------- */

export type ConsoleZone = 'Z0_INTERRUPT' | 'Z1_STAGE' | 'Z2_DECISION' | 'Z3_FOCUS' | 'Z4_AMBIENT' | 'Z5_LEDGER';
export type ConsoleAudience = 'ic' | 'ops' | 'air' | 'ems' | 'law' | 'public';
export type ConsoleAutonomy = 'advise' | 'assist' | 'act';
export type ConsoleLens = 'ic' | 'ops' | 'air' | 'ems';
export type ConsoleActionKind = 'retask-drone' | 'move-group' | 'evac-notice' | 'radio-script' | 'sitrep' | 'resource-order' | 'rescue' | 'reproject';
export type ConsoleActionStatus = 'proposed' | 'approved' | 'executing' | 'done' | 'rejected' | 'undone';
export type ConsoleDraftFormat = 'evac-notice' | 'radio' | 'ics209' | 'order' | 'rescue';
export type ConsoleDirectiveKind = 'focusStage' | 'promoteFeed' | 'restoreStage' | 'openPanel' | 'highlight' | 'dimOthers' | 'requestDecision' | 'notify';
export interface ConsoleScoreFactors {
  severity: number; exposure: number; confidence: number; freshness: number;
  corroboration: number; actionability: number; novelty: number; fatigue: number; lens: number;
}

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal';
const prefersReduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/* --------------------------------- ZoneTag -------------------------------- */

export const zoneMeta: Record<ConsoleZone, { code: string; name: string; tone: Tone; where: string; capacity: string }> = {
  Z0_INTERRUPT: { code: 'Z0', name: 'Interrupt', tone: 'danger', where: 'Banner over the stage, must be acknowledged', capacity: '1' },
  Z1_STAGE: { code: 'Z1', name: 'Stage', tone: 'nominal', where: 'The 3D stage: camera, promoted feed, highlight', capacity: '1' },
  Z2_DECISION: { code: 'Z2', name: 'Decision', tone: 'warning', where: 'Decision queue, needs approval', capacity: '3' },
  Z3_FOCUS: { code: 'Z3', name: 'Focus', tone: 'telemetry', where: 'Focus stack, labelled on the stage', capacity: '3' },
  Z4_AMBIENT: { code: 'Z4', name: 'Ambient', tone: 'neutral', where: 'Glyph on the stage, count in the column', capacity: '40' },
  Z5_LEDGER: { code: 'Z5', name: 'Ledger', tone: 'neutral', where: 'Log and ledger only, recorded for audit', capacity: '∞' },
};

export function ZoneTag({ zone, showName = true, className }: { zone: ConsoleZone; showName?: boolean; className?: string }) {
  const m = zoneMeta[zone];
  const faint = zone === 'Z5_LEDGER' || zone === 'Z4_AMBIENT';
  return (
    <span
      title={`${m.code} ${m.name}: ${m.where}`}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap border px-1.5 font-mono text-micro uppercase leading-none',
        faint ? 'border-line text-bone-mute' : cn(toneBorder[m.tone], toneText[m.tone]),
        className,
      )}
    >
      <span className={cn('h-1 w-1', faint ? 'bg-ink-500' : toneSolid[m.tone])} aria-hidden />
      <span className="fcc-num">{m.code}</span>
      {showName && (
        <>
          <span aria-hidden className="h-2.5 w-px bg-current opacity-40" />
          {m.name}
        </>
      )}
    </span>
  );
}

/* ------------------------------- WhyPopover ------------------------------- */

export interface WhyPopoverProps {
  score: number;
  factors: ConsoleScoreFactors;
  reason: string;
  zone: ConsoleZone;
  /** "Placed in Z3 because …". Defaults to a sentence built from the zone and score. */
  placement?: ReactNode;
  title?: ReactNode;
  className?: string;
}

function FactorBar({ label, value, max = 1, text, tone = 'telemetry', negative = false }: { label: string; value: number; max?: number; text: string; tone?: Tone; negative?: boolean }) {
  const f = clamp01(value / max);
  const cells = 16;
  const on = Math.round(f * cells);
  return (
    <div className="grid grid-cols-[92px_1fr_44px] items-center gap-2">
      <span className="truncate font-mono text-micro uppercase text-bone-mute">{label}</span>
      <span aria-hidden className="flex h-1.5 gap-px">
        {Array.from({ length: cells }).map((_, i) => (
          <span key={i} className={cn('flex-1', i < on ? (negative ? 'bg-ember/80' : toneSolid[tone]) : 'bg-ink-700')} />
        ))}
      </span>
      <span className={cn('text-right font-mono text-micro fcc-num', negative && value > 0 ? 'text-ember' : 'text-bone')}>{text}</span>
    </div>
  );
}

export function WhyPopover({ score, factors: f, reason, zone, placement, title, className }: WhyPopoverProps) {
  const base = 100 * f.severity * f.exposure * f.confidence * f.freshness * f.lens;
  const final = Math.round(Math.max(0, Math.min(100, score)));
  const m = zoneMeta[zone];
  return (
    <div role="dialog" aria-label="Why am I seeing this" className={cn('relative w-[340px] border border-line-strong bg-ink-850 shadow-lift', className)}>
      <Brackets size={6} inset={-3} />
      <div className="flex h-8 items-center gap-2 border-b border-line px-3">
        <Icon name="sparkle" size={11} className="text-ice" />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">Why am I seeing this</span>
        <ZoneTag zone={zone} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-3 p-3">
        {title != null && <div className="text-sm font-medium leading-5 text-bone">{title}</div>}
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="fcc-micro">Orchestrator score</span>
            <span className="font-mono text-micro text-bone-mute fcc-num">
              100 × S × E × C × F × L = {base.toFixed(1)}
            </span>
          </div>
          <span className="font-mono text-2xl font-light leading-none text-bone fcc-num">{String(final).padStart(2, '0')}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="fcc-micro text-ink-400">Multipliers</span>
          <FactorBar label="Severity" value={f.severity} text={f.severity.toFixed(2)} tone="danger" />
          <FactorBar label="Exposure" value={f.exposure} text={f.exposure.toFixed(2)} tone="warning" />
          <FactorBar label="Confidence" value={f.confidence} text={f.confidence.toFixed(2)} />
          <FactorBar label="Freshness" value={f.freshness} text={f.freshness.toFixed(2)} />
          <FactorBar label="Role lens" value={f.lens - 0.5} max={0.8} text={`×${f.lens.toFixed(2)}`} tone="neutral" />
        </div>
        <div className="flex flex-col gap-1.5 border-t border-line-faint pt-2.5">
          <span className="fcc-micro text-ink-400">Points</span>
          <FactorBar label="Corroboration" value={f.corroboration} max={10} text={`+${f.corroboration.toFixed(1)}`} tone="nominal" />
          <FactorBar label="Actionable" value={f.actionability} max={10} text={`+${f.actionability.toFixed(1)}`} tone="nominal" />
          <FactorBar label="Novelty" value={f.novelty} max={8} text={`+${f.novelty.toFixed(1)}`} tone="nominal" />
          <FactorBar label="Fatigue" value={f.fatigue} max={15} text={`−${f.fatigue.toFixed(1)}`} negative />
        </div>
        <p className="border-t border-line-faint pt-2.5 font-mono text-micro uppercase leading-4 text-bone-dim">{reason}</p>
        <p className="text-xs leading-5 text-bone-dim">
          {placement ?? (
            <>
              Placed in <span className={toneText[m.tone]}>{m.code} {m.name}</span> because the score is {final}. {m.where}.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ AutonomyDial ------------------------------ */

const autonomyOpts: { value: ConsoleAutonomy; label: string; short: string; angle: number; desc: string }[] = [
  { value: 'advise', label: 'Advise', short: 'ADV', angle: -50, desc: 'Explains and recommends. Never acts.' },
  { value: 'assist', label: 'Assist', short: 'AST', angle: 0, desc: 'Prepares drafts and tasks. One click to approve.' },
  { value: 'act', label: 'Act', short: 'ACT', angle: 50, desc: 'Runs low-risk tasks itself and logs them with Undo. High-risk work still needs you.' },
];

function Knob({ angle, size }: { angle: number; size: number }) {
  const c = size / 2;
  const r = c - 2;
  const ticks = [-50, 0, 50];
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 overflow-visible">
      {ticks.map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1={c + Math.sin(rad) * (r + 1)}
            y1={c - Math.cos(rad) * (r + 1)}
            x2={c + Math.sin(rad) * (r + 3.5)}
            y2={c - Math.cos(rad) * (r + 3.5)}
            className={a === angle ? 'stroke-signal' : 'stroke-ink-400'}
            strokeWidth={1}
          />
        );
      })}
      <circle cx={c} cy={c} r={r - 1} className="fill-ink-800 stroke-line-strong" strokeWidth={1} />
      <circle cx={c} cy={c} r={r - 4} className="fill-ink-850 stroke-line" strokeWidth={1} />
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${c}px ${c}px` }} className="transition-transform duration-base ease-servo">
        <line x1={c} y1={c - 1} x2={c} y2={3.5} className="stroke-bone" strokeWidth={1.5} strokeLinecap="square" />
      </g>
      <rect x={c - 1} y={c - 1} width={2} height={2} className="fill-ink-500" />
    </svg>
  );
}

export interface AutonomyDialProps {
  value: ConsoleAutonomy;
  onChange: (v: ConsoleAutonomy) => void;
  compact?: boolean;
  className?: string;
}

export function AutonomyDial({ value, onChange, compact = false, className }: AutonomyDialProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, autonomyOpts.findIndex((o) => o.value === value));
  const cur = autonomyOpts[idx] ?? autonomyOpts[1]!;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = Math.min(autonomyOpts.length - 1, idx + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = Math.max(0, idx - 1);
    if (n < 0) return;
    e.preventDefault();
    const o = autonomyOpts[n];
    if (o) onChange(o.value);
    refs.current[n]?.focus();
  };
  const seg = (
    <div role="radiogroup" aria-label="Orchestrator autonomy" className="flex gap-px border border-line-strong bg-line-strong">
      {autonomyOpts.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={`${o.label}: ${o.desc}`}
            onClick={() => onChange(o.value)}
            onKeyDown={onKey}
            className={cn(
              'relative inline-flex items-center justify-center font-mono uppercase tracking-[0.12em] transition-[background-color,color] duration-quick ease-servo',
              compact ? 'h-6 px-1.5 text-micro' : 'h-7 flex-1 px-3 text-nano',
              on ? 'bg-ink-700 text-bone' : 'bg-ink-900 text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
              focusRing,
            )}
          >
            {on && <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-px bg-bone" />}
            {compact ? o.short : o.label}
          </button>
        );
      })}
    </div>
  );
  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-2', className)}>
        <Knob angle={cur.angle} size={22} />
        {seg}
      </div>
    );
  }
  return (
    <div className={cn('relative flex flex-col gap-3 border border-line bg-ink-900 p-3', className)}>
      <div className="flex items-center gap-4">
        <Knob angle={cur.angle} size={52} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="fcc-micro">Autonomy</span>
          <span className="font-mono text-tiny uppercase text-bone">{cur.label}</span>
          <span className="text-xs leading-4 text-bone-dim">{cur.desc}</span>
        </div>
      </div>
      {seg}
    </div>
  );
}

/* ------------------------------- LensSelect ------------------------------- */

const lensOpts: { value: ConsoleLens; label: string; title: string }[] = [
  { value: 'ic', label: 'IC', title: 'Incident commander: balanced' },
  { value: 'ops', label: 'OPS', title: 'Operations: hazards and movements weighted up' },
  { value: 'air', label: 'AIR', title: 'Air ops: drones, aircraft and spot fires weighted up' },
  { value: 'ems', label: 'EMS', title: 'EMS: life weighted up, fuel down' },
];

export interface LensSelectProps {
  value: ConsoleLens;
  onChange: (v: ConsoleLens) => void;
  showKeys?: boolean;
  className?: string;
}

export function LensSelect({ value, onChange, showKeys = true, className }: LensSelectProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, lensOpts.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (idx + 1) % lensOpts.length;
    else if (e.key === 'ArrowLeft') n = (idx - 1 + lensOpts.length) % lensOpts.length;
    if (n < 0) return;
    e.preventDefault();
    const o = lensOpts[n];
    if (o) onChange(o.value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Role lens" className={cn('inline-flex items-center', className)}>
      <Icon name="eye" size={12} className="mr-2 text-bone-mute" />
      <div className="flex gap-px border border-line-strong bg-line-strong">
        {lensOpts.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={o.title}
              onClick={() => onChange(o.value)}
              onKeyDown={onKey}
              className={cn(
                'relative inline-flex h-6 items-center gap-1 px-2 font-mono text-micro uppercase tracking-[0.12em] transition-[background-color,color] duration-quick ease-servo',
                on ? 'bg-ink-700 text-bone' : 'bg-ink-900 text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
                focusRing,
              )}
            >
              {on && <span aria-hidden className="absolute inset-x-1.5 bottom-0 h-px bg-bone" />}
              {o.label}
              {showKeys && <span className="text-ink-500 fcc-num">{i + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------- TimelineScrubber ---------------------------- */

export interface TimelineMark {
  t: number;
  kind: 'ghost' | 'beat' | 'event' | 'perimeter';
  label?: string;
}

export interface TimelineScrubberProps {
  start: number;
  end: number;
  t: number;
  onSeek?: (t: number) => void;
  /** Axis ticks (e.g. local midnights and 6 h steps). */
  ticks?: { t: number; label?: string; major?: boolean }[];
  /** Fire acres (or any metric) over time, drawn as a stepped area. */
  series?: { t: number; v: number }[];
  marks?: TimelineMark[];
  /** End of the projection window; drawn as an amber hatched range from the playhead. */
  projectionUntil?: number;
  format?: (t: number) => string;
  compact?: boolean;
  label?: string;
  className?: string;
}

export function TimelineScrubber({ start, end, t, onSeek, ticks = [], series = [], marks = [], projectionUntil, format, compact = false, label = 'Scenario time', className }: TimelineScrubberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, end - start);
  const x = (v: number) => clamp01((v - start) / span);
  const p = x(t);
  const h = compact ? 22 : 56;
  const fmt = format ?? ((v: number) => new Date(v).toISOString().slice(11, 16) + 'Z');

  const area = useMemo(() => {
    if (series.length < 2) return null;
    const max = Math.max(...series.map((s) => s.v)) || 1;
    const pts = series.map((s) => [x(s.t) * 1000, h - (s.v / max) * (h - 3)] as const);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    let d = `M${first[0].toFixed(1)} ${h} L${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L${pts[i]![0].toFixed(1)} ${pts[i]![1].toFixed(1)}`;
    const line = d.replace(/^M[^L]+L/, 'M');
    return { fill: `${d} L${last[0].toFixed(1)} ${h} Z`, line };
  }, [series, start, end, h]);

  const seekAt = (clientX: number) => {
    const el = ref.current;
    if (!el || !onSeek) return;
    const r = el.getBoundingClientRect();
    onSeek(start + clamp01((clientX - r.left) / r.width) * span);
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    seekAt(e.clientX);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setHover(start + clamp01((e.clientX - r.left) / r.width) * span);
    }
    if (drag) seekAt(e.clientX);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const step = span * (e.shiftKey ? 0.1 : 0.01);
    if (e.key === 'ArrowRight') onSeek(Math.min(end, t + step));
    else if (e.key === 'ArrowLeft') onSeek(Math.max(start, t - step));
    else if (e.key === 'Home') onSeek(start);
    else if (e.key === 'End') onSeek(end);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={cn('flex min-w-0 flex-col', compact ? 'gap-0.5' : 'gap-1', className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={onSeek ? 0 : -1}
        aria-label={label}
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={Math.round(t)}
        aria-valuetext={fmt(t)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        className={cn('relative w-full touch-none select-none border-b border-line-strong', onSeek && 'cursor-ew-resize', focusRing)}
        style={{ height: h }}
      >
        {projectionUntil != null && projectionUntil > t && (
          <div
            aria-hidden
            className="absolute inset-y-0 border-l border-amber/50 bg-amber/[0.06]"
            style={{ left: `${p * 100}%`, width: `${(x(projectionUntil) - p) * 100}%` }}
          />
        )}
        {area && (
          <svg aria-hidden viewBox={`0 0 1000 ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <path d={area.fill} className="fill-ember/10" />
            <path d={area.line} className="stroke-ember/70" fill="none" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {/* elapsed overlay dims the future */}
        <div aria-hidden className="absolute inset-y-0 right-0 bg-ink-950/45" style={{ left: `${p * 100}%` }} />
        {ticks.map((k) => (
          <span
            key={k.t}
            aria-hidden
            className={cn('absolute bottom-0 w-px', k.major ? 'h-full bg-line-strong' : compact ? 'h-1.5 bg-ink-600' : 'h-2 bg-ink-600')}
            style={{ left: `${x(k.t) * 100}%` }}
          />
        ))}
        {marks.map((m, i) => (
          <span
            key={`${m.kind}-${m.t}-${i}`}
            title={m.label}
            className={cn(
              'absolute',
              m.kind === 'ghost' && 'bottom-0 h-2 w-[5px] -translate-x-1/2 border border-dashed border-amber/80',
              m.kind === 'beat' && 'top-0 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border border-bone-dim bg-ink-950',
              m.kind === 'event' && 'top-0 h-full w-px bg-violet/60',
              m.kind === 'perimeter' && 'bottom-0 h-1 w-1 -translate-x-1/2 bg-ember',
            )}
            style={{ left: `${x(m.t) * 100}%` }}
          />
        ))}
        {hover != null && !drag && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-bone/30" style={{ left: `${x(hover) * 100}%` }} />
        )}
        <span aria-hidden className="pointer-events-none absolute -bottom-px -top-px w-px bg-signal" style={{ left: `${p * 100}%` }}>
          <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] bg-signal" />
        </span>
        {hover != null && (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-5 z-raised -translate-x-1/2 whitespace-nowrap border border-line-strong bg-ink-850 px-1 font-mono text-micro text-bone fcc-num"
            style={{ left: `${x(hover) * 100}%` }}
          >
            {fmt(hover)}
          </span>
        )}
      </div>
      {!compact && (
        <div className="relative h-3">
          {ticks
            .filter((k) => k.label)
            .map((k) => {
              const px = x(k.t);
              return (
                <span
                  key={k.t}
                  className={cn(
                    'absolute whitespace-nowrap font-mono text-micro uppercase text-bone-mute fcc-num',
                    px < 0.05 ? 'translate-x-0' : px > 0.95 ? '-translate-x-full' : '-translate-x-1/2',
                  )}
                  style={{ left: `${px * 100}%` }}
                >
                  {k.label}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ LedgerCounter ----------------------------- */

export interface LedgerCounterProps {
  label: string;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  size?: 'sm' | 'md' | 'lg';
  tone?: Tone;
  sub?: ReactNode;
  className?: string;
}

export function LedgerCounter({ label, value, unit, format, size = 'md', tone = 'neutral', sub, className }: LedgerCounterProps) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<{ v: number; k: number } | null>(null);
  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (d <= 0) return;
    setDelta((x) => ({ v: d, k: (x?.k ?? 0) + 1 }));
    const id = window.setTimeout(() => setDelta(null), 1800);
    return () => window.clearTimeout(id);
  }, [value]);
  const f = format ?? ((v: number) => Math.round(v).toLocaleString('en-US'));
  const deltaText = delta ? f(delta.v) : '';
  const deltaEl =
    delta && /[1-9]/.test(deltaText) ? (
      <span key={delta.k} aria-hidden className="ml-auto shrink-0 animate-rise whitespace-nowrap font-mono text-micro text-phosphor fcc-num">
        +{deltaText}
      </span>
    ) : null;
  const num = size === 'lg' ? 'text-5xl font-light' : size === 'md' ? 'text-2xl font-light' : 'text-base';
  return (
    <div className={cn('flex min-w-0 flex-col', size === 'sm' ? 'gap-0' : 'gap-1', className)}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn('min-w-0 truncate font-mono uppercase text-bone-mute', size === 'lg' ? 'text-nano' : 'text-micro')}>{label}</span>
        {size !== 'sm' && deltaEl}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn('whitespace-nowrap font-mono leading-none fcc-num', num, tone === 'neutral' ? 'text-bone' : toneText[tone])}>{f(value)}</span>
        {unit && <span className="font-mono text-micro uppercase text-bone-mute">{unit}</span>}
        {size === 'sm' && deltaEl}
      </span>
      {sub != null && <span className="font-mono text-micro uppercase text-bone-mute">{sub}</span>}
    </div>
  );
}

/* ------------------------------ DraftDocument ----------------------------- */

const draftCode: Record<ConsoleDraftFormat, string> = {
  'evac-notice': 'EVAC NOTICE', radio: 'RADIO SCRIPT', ics209: 'ICS-209 SITREP', order: 'RESOURCE ORDER', rescue: 'RESCUE TASKING',
};
const draftIcon: Record<ConsoleDraftFormat, IconName> = {
  'evac-notice': 'shield', radio: 'radio', ics209: 'log', order: 'engine', rescue: 'human',
};

export interface DraftDocumentProps {
  format: ConsoleDraftFormat;
  title: ReactNode;
  fields: { label: string; value: string }[];
  body: string;
  editable?: boolean;
  onChange?: (body: string) => void;
  serial?: string;
  status?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function DraftDocument({ format, title, fields, body, editable = false, onChange, serial, status, meta, className }: DraftDocumentProps) {
  const id = useId();
  return (
    <article className={cn('relative overflow-hidden border border-line-strong bg-ink-850', className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="-rotate-[24deg] select-none whitespace-nowrap border-2 border-ink-700 px-4 py-1 font-mono text-4xl uppercase tracking-[0.3em] text-ink-700/70">
          Simulated
        </span>
      </div>
      <header className="relative flex h-8 items-center gap-2 border-b border-line-strong bg-ink-900 px-3">
        <Icon name={draftIcon[format]} size={12} className="text-bone-dim" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">{draftCode[format]}</span>
        <span aria-hidden className="h-3 w-px bg-line-strong" />
        <span className="font-mono text-micro uppercase text-amber">Draft</span>
        {serial && <span className="ml-auto font-mono text-micro uppercase text-bone-mute fcc-num">{serial}</span>}
      </header>
      <div className="relative flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <h4 className="min-w-0 flex-1 text-base font-medium leading-6 text-bone">{title}</h4>
          {status}
        </div>
        {fields.length > 0 && (
          <dl className="grid grid-cols-[minmax(84px,auto)_1fr] border-t border-line">
            {fields.map((f) => (
              <div key={f.label} className="contents">
                <dt className="border-b border-line-faint py-1.5 pr-3 font-mono text-micro uppercase text-bone-mute">{f.label}</dt>
                <dd className="border-b border-line-faint py-1.5 font-mono text-tiny text-bone fcc-num">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {editable ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={id} className="fcc-micro">
              Body · editable
            </label>
            <textarea
              id={id}
              value={body}
              onChange={(e) => onChange?.(e.target.value)}
              spellCheck={false}
              rows={Math.min(16, Math.max(6, body.split('\n').length + 1))}
              className={cn(
                'w-full resize-y border border-line-strong bg-ink-950/80 p-2.5 font-mono text-tiny leading-5 text-bone outline-none transition-colors duration-quick ease-servo',
                'hover:border-ink-400 focus:border-bone-mute',
              )}
            />
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-tiny leading-5 text-bone-dim">{body}</pre>
        )}
        {meta != null && <div className="border-t border-line-faint pt-2 font-mono text-micro uppercase text-bone-mute">{meta}</div>}
      </div>
    </article>
  );
}

/* ----------------------------- DirectiveToast ----------------------------- */

const directiveIcon: Record<ConsoleDirectiveKind, IconName> = {
  focusStage: 'locate', promoteFeed: 'camera', restoreStage: 'map', openPanel: 'expand', highlight: 'target',
  dimOthers: 'eye', requestDecision: 'check', notify: 'send',
};

export interface DirectiveToastProps {
  kind: ConsoleDirectiveKind;
  title: ReactNode;
  reason?: ReactNode;
  time?: string;
  /** Hold-layout mode: the Orchestrator only suggests; the user applies. */
  suggestion?: boolean;
  onUndo?: () => void;
  onHold?: () => void;
  onApply?: () => void;
  onDismiss?: () => void;
  /** Auto-fade countdown in ms (drawn as a hairline). 0 disables it. */
  ttlMs?: number;
  className?: string;
}

export function DirectiveToast({ kind, title, reason, time, suggestion = false, onUndo, onHold, onApply, onDismiss, ttlMs = 0, className }: DirectiveToastProps) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!ttlMs) return;
    const id = requestAnimationFrame(() => setGo(true));
    return () => cancelAnimationFrame(id);
  }, [ttlMs]);
  return (
    <div
      role="status"
      className={cn(
        'relative w-[340px] animate-rise border border-l-2 bg-ink-900/95 shadow-panel',
        suggestion ? 'border-line-strong border-l-amber' : 'border-line border-l-ice',
        className,
      )}
    >
      <div className="flex items-start gap-2.5 p-2.5 pr-1.5">
        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-line', suggestion ? 'text-amber' : 'text-ice')}>
          <Icon name={directiveIcon[kind]} size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
            <Icon name="orchestrator" size={10} className="text-ice" />
            <span>{suggestion ? 'Orchestrator suggests' : 'Orchestrator'}</span>
            {time && <span className="ml-auto fcc-num">{time}</span>}
          </div>
          <div className="mt-0.5 text-sm leading-5 text-bone">{title}</div>
          {reason != null && <div className="mt-0.5 text-xs leading-4 text-bone-dim">{reason}</div>}
          {(onUndo || onHold || onApply) && (
            <div className="mt-2 flex items-center gap-1">
              {onApply && (
                <Button size="sm" variant="secondary" icon="check" onClick={onApply}>
                  Apply
                </Button>
              )}
              {onUndo && (
                <Button size="sm" variant="ghost" onClick={onUndo}>
                  Undo
                </Button>
              )}
              {onHold && (
                <Button size="sm" variant="ghost" onClick={onHold}>
                  Hold layout
                </Button>
              )}
            </div>
          )}
        </div>
        {onDismiss && <IconButton icon="close" label="Dismiss" variant="ghost" size="sm" onClick={onDismiss} />}
      </div>
      {ttlMs > 0 && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span
            className={cn('block h-full origin-left', suggestion ? 'bg-amber/60' : 'bg-ice/60')}
            style={{ transform: `scaleX(${go ? 0 : 1})`, transition: prefersReduced() ? undefined : `transform ${ttlMs}ms linear` }}
          />
        </span>
      )}
    </div>
  );
}

/* -------------------------------- CaptionBar ------------------------------ */

export interface CaptionBarProps {
  beat: number;
  total: number;
  title: ReactNode;
  caption: ReactNode;
  /** 0..1 progress through the whole demo. */
  progress?: number;
  /** Beat start positions 0..1, drawn as ticks on the progress rule. */
  beatMarks?: number[];
  onPrev?: () => void;
  onNext?: () => void;
  onClose?: () => void;
  className?: string;
}

export function CaptionBar({ beat, total, title, caption, progress, beatMarks = [], onPrev, onNext, onClose, className }: CaptionBarProps) {
  return (
    <div aria-live="polite" className={cn('relative w-full max-w-[920px] border border-line-strong bg-ink-950/90 shadow-lift', className)}>
      <Brackets size={6} tone="bone" inset={-3} />
      <div className="flex items-stretch">
        <div className="flex w-[124px] shrink-0 flex-col justify-center gap-1 border-r border-line px-3 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-micro uppercase text-bone-mute">
            <Dot className="bg-ember" live size={5} />
            Director
          </span>
          <span className="font-mono text-tiny uppercase text-bone fcc-num">
            Beat {String(beat + 1).padStart(2, '0')}
            <span className="text-bone-mute">/{String(total).padStart(2, '0')}</span>
          </span>
        </div>
        <div className="min-w-0 flex-1 px-4 py-2.5">
          <div className="font-mono text-nano uppercase tracking-[0.14em] text-bone">{title}</div>
          <div className="mt-0.5 text-base leading-6 text-bone-dim">{caption}</div>
        </div>
        {(onPrev || onNext || onClose) && (
          <div className="flex shrink-0 items-center gap-0.5 border-l border-line px-1.5">
            {onPrev && <IconButton icon="chevron-left" label="Previous beat" variant="ghost" size="sm" onClick={onPrev} />}
            {onNext && <IconButton icon="chevron-right" label="Next beat" variant="ghost" size="sm" onClick={onNext} />}
            {onClose && <IconButton icon="close" label="Hide captions" variant="ghost" size="sm" onClick={onClose} />}
          </div>
        )}
      </div>
      {progress != null && (
        <div aria-hidden className="relative h-px bg-line">
          <span className="absolute inset-y-0 left-0 bg-bone-dim transition-[width] duration-slow ease-servo" style={{ width: `${clamp01(progress) * 100}%` }} />
          {beatMarks.map((m) => (
            <span key={m} className="absolute -top-[2px] h-[5px] w-px bg-bone-mute" style={{ left: `${clamp01(m) * 100}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- DecisionCard ----------------------------- */

export const actionKindIcon: Record<ConsoleActionKind, IconName> = {
  'retask-drone': 'drone', 'move-group': 'route', 'evac-notice': 'shield', 'radio-script': 'radio', sitrep: 'log',
  'resource-order': 'engine', rescue: 'human', reproject: 'flame',
};
export const actionKindLabel: Record<ConsoleActionKind, string> = {
  'retask-drone': 'Retask drone', 'move-group': 'Move group', 'evac-notice': 'Evacuation notice', 'radio-script': 'Radio script',
  sitrep: 'Sitrep · ICS-209', 'resource-order': 'Resource order', rescue: 'Rescue', reproject: 'Re-projection',
};
export const consoleAudienceLabel: Record<ConsoleAudience, string> = { ic: 'IC', ops: 'Ops', air: 'Air', ems: 'EMS', law: 'Law', public: 'Public' };
const allAudiences: ConsoleAudience[] = ['ic', 'ops', 'air', 'ems', 'law', 'public'];
const statusTone: Record<ConsoleActionStatus, Tone> = {
  proposed: 'warning', approved: 'nominal', executing: 'telemetry', done: 'nominal', rejected: 'neutral', undone: 'neutral',
};

export function AudienceRow({ audiences, className }: { audiences: ConsoleAudience[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-px', className)} aria-label={`Relay to ${audiences.map((a) => consoleAudienceLabel[a]).join(', ') || 'nobody'}`}>
      {allAudiences.map((a) => {
        const on = audiences.includes(a);
        return (
          <span
            key={a}
            aria-hidden
            className={cn('inline-flex h-4 items-center gap-1 px-1 font-mono text-micro uppercase leading-none', on ? 'bg-ink-700 text-bone' : 'text-ink-500')}
          >
            {on && <span className="h-1 w-1 bg-phosphor" />}
            {consoleAudienceLabel[a]}
          </span>
        );
      })}
    </span>
  );
}

export interface DecisionCardProps {
  kind: ConsoleActionKind;
  title: ReactNode;
  summary?: ReactNode;
  risk: 'low' | 'high';
  status: ConsoleActionStatus;
  audiences?: ConsoleAudience[];
  windowLabel?: string;
  trigger?: ReactNode;
  units?: string[];
  /** "Orchestrator drafted · 12 s ago". */
  drafted?: string;
  score?: number;
  compact?: boolean;
  /** Render Approve as the one primary (signal) action on screen. */
  primary?: boolean;
  onApprove?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
  onLocate?: () => void;
  onExpand?: () => void;
  className?: string;
}

export function DecisionCard({
  kind, title, summary, risk, status, audiences = [], windowLabel, trigger, units = [], drafted, compact = false, primary = false,
  onApprove, onEdit, onReject, onUndo, onLocate, onExpand, className,
}: DecisionCardProps) {
  const proposed = status === 'proposed';
  const st = statusTone[status];
  const riskBadge = (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 border px-1.5 font-mono text-micro uppercase leading-none',
        risk === 'high' ? 'border-ember/50 text-ember' : 'border-phosphor/40 text-phosphor',
      )}
    >
      {risk === 'high' ? 'High risk' : 'Low risk'}
    </span>
  );
  const rule = proposed ? (primary ? toneBorderL.signal : toneBorderL.warning) : 'border-l-ink-500';

  if (compact) {
    return (
      <div
        role={onExpand ? 'button' : undefined}
        tabIndex={onExpand ? 0 : undefined}
        onClick={onExpand}
        onKeyDown={(e) => {
          if (onExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onExpand();
          }
        }}
        className={cn(
          'relative flex h-10 min-w-0 items-center gap-2.5 border border-l-2 border-line bg-ink-900 pl-2.5 pr-2 transition-colors duration-quick ease-servo',
          rule,
          onExpand && cn('cursor-pointer hover:bg-ink-850', focusRing),
          !proposed && 'opacity-70',
          className,
        )}
      >
        <Icon name={actionKindIcon[kind]} size={14} className={proposed ? 'text-amber' : 'text-bone-mute'} />
        <span className="min-w-0 flex-1 truncate text-sm text-bone">{title}</span>
        {risk === 'high' && <span className="h-1.5 w-1.5 shrink-0 bg-ember" title="High risk" />}
        <span className={cn('shrink-0 font-mono text-micro uppercase', toneText[st])}>{status}</span>
        {onExpand && <Icon name="chevron-down" size={12} className="text-bone-mute" />}
      </div>
    );
  }

  return (
    <div className={cn('relative flex min-w-0 flex-col border border-l-2 border-line bg-ink-900', rule, status === 'rejected' && 'opacity-60', className)}>
      {primary && proposed && <Brackets size={6} tone="signal" inset={-3} />}
      <div className="flex h-8 items-center gap-2 border-b border-line-faint pl-3 pr-2">
        <Icon name={actionKindIcon[kind]} size={12} className={proposed ? 'text-amber' : 'text-bone-mute'} />
        <span className="truncate font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">{actionKindLabel[kind]}</span>
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-micro uppercase', toneText[st])}>
          {status === 'executing' ? <Dot className={toneSolid[st]} live size={5} /> : <span aria-hidden className={cn('h-1 w-1', toneSolid[st])} />}
          {status}
        </span>
        <span className="ml-auto" />
        {riskBadge}
        {onLocate && <IconButton icon="locate" label="Show on stage" variant="ghost" size="sm" onClick={onLocate} />}
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-5 text-bone">{title}</div>
          {summary != null && <div className="mt-1 text-xs leading-5 text-bone-dim">{summary}</div>}
        </div>
        {(windowLabel || trigger || units.length > 0 || audiences.length > 0) && (
          <dl className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-1">
            {windowLabel && (
              <>
                <dt className="fcc-micro pt-px">Window</dt>
                <dd className="font-mono text-tiny text-bone fcc-num">{windowLabel}</dd>
              </>
            )}
            {trigger != null && (
              <>
                <dt className="fcc-micro pt-px">Trigger</dt>
                <dd className="font-mono text-tiny text-amber">{trigger}</dd>
              </>
            )}
            {units.length > 0 && (
              <>
                <dt className="fcc-micro pt-px">Units</dt>
                <dd className="font-mono text-tiny uppercase text-bone">{units.join(' · ')}</dd>
              </>
            )}
            {audiences.length > 0 && (
              <>
                <dt className="fcc-micro pt-1">Relay</dt>
                <dd>
                  <AudienceRow audiences={audiences} />
                </dd>
              </>
            )}
          </dl>
        )}
        <div className="flex items-center gap-1.5 border-t border-line-faint pt-2.5">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-micro uppercase text-bone-mute">
            <Icon name="orchestrator" size={10} className="shrink-0 text-ice" />
            <span className="truncate fcc-num">{drafted ?? 'Orchestrator drafted'}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {proposed ? (
              <>
                {onReject && (
                  <Button size="sm" variant="ghost" onClick={onReject}>
                    Reject
                  </Button>
                )}
                {onEdit && (
                  <Button size="sm" variant="secondary" onClick={onEdit}>
                    Edit
                  </Button>
                )}
                {onApprove && (
                  <Button size="sm" variant={primary ? 'primary' : 'secondary'} icon={primary ? undefined : 'check'} onClick={onApprove}>
                    Approve
                  </Button>
                )}
              </>
            ) : (
              <>
                {onEdit && (
                  <Button size="sm" variant="ghost" onClick={onEdit}>
                    View
                  </Button>
                )}
                {onUndo && (status === 'approved' || status === 'executing' || status === 'done') && (
                  <Button size="sm" variant="ghost" onClick={onUndo}>
                    Undo
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
