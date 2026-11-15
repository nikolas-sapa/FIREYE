import type { ReactNode } from 'react';
import { Brackets, cn } from '@ds';

/** Numbered sub-section of the design system spec. Left rail is sticky on large screens. */
export function SubSection({
  id,
  index,
  kicker,
  title,
  lede,
  aside,
  children,
}: {
  id: string;
  index: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line py-20 lg:py-24">
      <div className="grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 lg:col-span-3">
          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <div className="flex items-center gap-3">
              <span className="font-mono text-nano text-signal fcc-num">{index}</span>
              <span aria-hidden className="h-px w-6 bg-line-strong" />
              <span className="font-mono text-nano uppercase tracking-[0.16em] text-bone">{kicker}</span>
            </div>
            <h3 id={`${id}-title`} className="text-2xl font-medium text-bone">
              {title}
            </h3>
            {lede != null && <p className="max-w-xs text-sm text-bone-dim">{lede}</p>}
            {aside}
          </div>
        </div>
        <div className="col-span-12 min-w-0 lg:col-span-9">{children}</div>
      </div>
    </section>
  );
}

/** Bracketed specimen cell with a mono code caption. */
export function Spec({
  code,
  tag,
  children,
  className,
  bodyClassName,
}: {
  code: string;
  tag?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <figure className={cn('relative flex min-w-0 flex-col border border-line bg-ink-900', className)}>
      <Brackets size={6} />
      <div className={cn('flex min-h-[120px] flex-1 flex-wrap items-center justify-center gap-3 p-6', bodyClassName)}>{children}</div>
      <figcaption className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-line px-3">
        <code className="min-w-0 truncate font-mono text-micro text-bone-dim">{code}</code>
        {tag && <span className="fcc-micro shrink-0">{tag}</span>}
      </figcaption>
    </figure>
  );
}

/** Group heading inside a sub-section. */
export function GroupTitle({ code, children, className }: { code?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex items-center gap-3', className)}>
      {code && <span className="font-mono text-micro text-signal fcc-num">{code}</span>}
      <span className="whitespace-nowrap font-mono text-micro uppercase tracking-[0.16em] text-bone-dim">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}
