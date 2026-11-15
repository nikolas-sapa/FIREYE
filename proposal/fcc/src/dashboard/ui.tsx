import type { ReactNode } from 'react';
import { cn, toneClass, type Tone } from '@ds';

/** Thin segmented resource bar (battery / water). */
export function MiniBar({ value, tone = 'neutral', segments = 10, className }: { value: number; tone?: Tone; segments?: number; className?: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <span aria-hidden className={cn('inline-flex h-1.5 gap-px', className)}>
      {Array.from({ length: segments }).map((_, i) => (
        <span key={i} className={cn('h-full w-1', i < lit ? toneClass[tone].dot : 'bg-ink-700')} />
      ))}
    </span>
  );
}

/** Indeterminate progress hairline used for "analyzing" states. */
export function SweepBar({ className, tone = 'telemetry' }: { className?: string; tone?: Tone }) {
  return (
    <div aria-hidden className={cn('relative h-px w-full overflow-hidden bg-line', className)}>
      <div className="absolute inset-0 animate-sweep">
        <div className={cn('h-full w-1/3', toneClass[tone].dot)} />
      </div>
    </div>
  );
}

/** Hairline vertical divider for toolbars. */
export const VRule = ({ className }: { className?: string }) => <span aria-hidden className={cn('w-px self-stretch bg-line', className)} />;

/** Mono micro section heading with a trailing hairline and optional right meta. */
export function SectionLabel({ children, meta, className }: { children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="fcc-micro shrink-0 text-bone-dim">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {meta != null && <span className="fcc-micro shrink-0 fcc-num">{meta}</span>}
    </div>
  );
}

/** Label / value row for inspectors. */
export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="fcc-micro shrink-0">{k}</span>
      <span className={cn('min-w-0 truncate text-right font-mono text-tiny fcc-num', tone ?? 'text-bone')}>{v}</span>
    </div>
  );
}

export const SCROLL = 'overflow-y-auto overflow-x-hidden overscroll-contain';
