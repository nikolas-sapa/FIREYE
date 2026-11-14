import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn, toneClass, type Tone } from '@ds';

/**
 * Dashboard panel shell. Borderless by design: the dashboard grid draws the
 * hairlines between panels (gap-px over bg-line), so panels only own their header rule.
 */
export function DPanel({
  index,
  title,
  meta,
  children,
  className,
  bodyClassName,
}: {
  index: string;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('relative flex min-h-0 min-w-0 flex-col bg-ink-900', className)}>
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-micro text-signal fcc-num">{index}</span>
        <span aria-hidden className="h-2.5 w-px bg-line-strong" />
        <h3 className="min-w-0 truncate font-mono text-nano uppercase text-bone">{title}</h3>
        {meta && <div className="ml-auto flex shrink-0 items-center gap-2">{meta}</div>}
      </header>
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

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

/** Tracks an element's content width (for fixed-width SVG charts). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Hairline vertical divider for toolbars. */
export const VRule = ({ className }: { className?: string }) => <span aria-hidden className={cn('w-px self-stretch bg-line', className)} />;

export const SCROLL = 'overflow-y-auto overflow-x-hidden overscroll-contain';
