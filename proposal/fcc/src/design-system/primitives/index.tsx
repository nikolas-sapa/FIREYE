import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils';

/* ---------------------------------------------------------------------------
 * MICROGRAPHIC PRIMITIVES
 * Small, composable, decorative-but-meaningful building blocks.
 * Every component in the system is built from these + Tailwind tokens.
 * ------------------------------------------------------------------------- */

/** Corner brackets drawn at the four corners of the parent (parent must be `relative`). */
export function Brackets({
  size = 8,
  className,
  tone = 'line',
  inset = 0,
}: { size?: number; className?: string; tone?: 'line' | 'signal' | 'bone'; inset?: number }) {
  const c = tone === 'signal' ? 'border-signal' : tone === 'bone' ? 'border-bone' : 'border-line-strong';
  const s: CSSProperties = { width: size, height: size };
  const o = -1 + inset;
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      <span className={cn('absolute border-l border-t', c)} style={{ ...s, left: o, top: o }} />
      <span className={cn('absolute border-r border-t', c)} style={{ ...s, right: o, top: o }} />
      <span className={cn('absolute border-l border-b', c)} style={{ ...s, left: o, bottom: o }} />
      <span className={cn('absolute border-r border-b', c)} style={{ ...s, right: o, bottom: o }} />
    </span>
  );
}

/** Hairline-bordered container with optional corner brackets. The base surface of FCC. */
export function Frame({
  children,
  className,
  brackets = true,
  bracketTone = 'line',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { brackets?: boolean; bracketTone?: 'line' | 'signal' | 'bone' }) {
  return (
    <div className={cn('relative border border-line bg-ink-900', className)} {...rest}>
      {brackets && <Brackets tone={bracketTone} />}
      {children}
    </div>
  );
}

/** Mono uppercase micro-label. `index` renders a leading code like "01". */
export function Label({
  children,
  index,
  className,
  tone = 'mute',
}: { children: ReactNode; index?: string; className?: string; tone?: 'mute' | 'bone' | 'signal' }) {
  const t = tone === 'signal' ? 'text-signal' : tone === 'bone' ? 'text-bone' : 'text-bone-mute';
  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-nano uppercase', t, className)}>
      {index && <span className="text-signal">{index}</span>}
      {children}
    </span>
  );
}

/** Serial/part-number tag, e.g. <Serial>FCC-01 / REV A</Serial>. */
export function Serial({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center border border-line px-1.5 py-px font-mono text-micro uppercase text-bone-mute', className)}>
      {children}
    </span>
  );
}

/** Tick ruler. Horizontal by default. Major tick every `major` ticks, optional labels. */
export function Ruler({
  ticks = 40,
  major = 5,
  orientation = 'horizontal',
  labels = false,
  className,
  start = 0,
  step = 1,
}: {
  ticks?: number; major?: number; orientation?: 'horizontal' | 'vertical'; labels?: boolean;
  className?: string; start?: number; step?: number;
}) {
  const horizontal = orientation === 'horizontal';
  return (
    <div
      aria-hidden
      className={cn('relative flex justify-between text-ink-500', horizontal ? 'h-3 w-full items-end' : 'h-full w-3 flex-col items-end', className)}
    >
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const isMajor = i % major === 0;
        return (
          <span key={i} className="relative">
            <span
              className={cn('block bg-current', isMajor && 'bg-ink-300')}
              style={horizontal ? { width: 1, height: isMajor ? 8 : 4 } : { height: 1, width: isMajor ? 8 : 4 }}
            />
            {labels && isMajor && (
              <span
                className={cn('absolute font-mono text-micro text-bone-mute', horizontal ? '-top-3 left-1/2 -translate-x-1/2' : 'right-3 top-1/2 -translate-y-1/2')}
              >
                {start + i * step}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Crosshair / reticle mark. */
export function Crosshair({ size = 16, className, gap = 3 }: { size?: number; className?: string; gap?: number }) {
  const h = size / 2;
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('text-bone-mute', className)}>
      <g stroke="currentColor" strokeWidth="1" shapeRendering="crispEdges">
        <line x1={h} y1={0} x2={h} y2={h - gap} />
        <line x1={h} y1={h + gap} x2={h} y2={size} />
        <line x1={0} y1={h} x2={h - gap} y2={h} />
        <line x1={h + gap} y1={h} x2={size} y2={h} />
      </g>
    </svg>
  );
}

/** Registration mark (circle + cross) used at sheet/section corners. */
export function RegMark({ size = 14, className }: { size?: number; className?: string }) {
  const h = size / 2;
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('text-ink-500', className)}>
      <circle cx={h} cy={h} r={h / 2} fill="none" stroke="currentColor" />
      <line x1={h} y1={0} x2={h} y2={size} stroke="currentColor" />
      <line x1={0} y1={h} x2={size} y2={h} stroke="currentColor" />
    </svg>
  );
}

/** Diagonal hatch fill block. */
export function Hatch({ className, tone = 'neutral' }: { className?: string; tone?: 'neutral' | 'signal' }) {
  return <div aria-hidden className={cn(tone === 'signal' ? 'fcc-hatch-signal' : 'fcc-hatch', className)} />;
}

/** Background grid overlays. */
export function GridBg({ variant = 'dots', className }: { variant?: 'dots' | 'lines'; className?: string }) {
  return <div aria-hidden className={cn('pointer-events-none absolute inset-0', variant === 'dots' ? 'fcc-dotgrid' : 'fcc-linegrid', className)} />;
}

/** Thin divider with optional centered/left micro title. */
export function Rule({ title, className, align = 'left' }: { title?: string; className?: string; align?: 'left' | 'center' }) {
  if (!title) return <div className={cn('h-px w-full bg-line', className)} />;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {align === 'center' && <div className="h-px flex-1 bg-line" />}
      <span className="fcc-micro whitespace-nowrap">{title}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Small square status indicator; `live` adds a pulsing ring. */
export function Dot({ className = 'bg-phosphor', live = false, size = 6 }: { className?: string; live?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {live && <span className={cn('absolute inset-0 animate-pulse-ring rounded-pill', className)} />}
      <span className={cn('relative inline-block h-full w-full', className)} />
    </span>
  );
}

/** Label/value pair in micrographic style. */
export function Datum({ label, value, unit, className, tone }: { label: string; value: ReactNode; unit?: string; className?: string; tone?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className="fcc-micro">{label}</span>
      <span className={cn('font-mono text-tiny fcc-num', tone ?? 'text-bone')}>
        {value}
        {unit && <span className="ml-0.5 text-bone-mute">{unit}</span>}
      </span>
    </div>
  );
}
