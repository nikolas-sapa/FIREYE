import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../utils';
import type { Tone } from '../tokens';
import { Brackets, Dot } from '../primitives';
import { toneBorder, toneSoft, toneSolid, toneText } from './tone';

/* ---------------------------------- Badge --------------------------------- */

export interface BadgeProps {
  tone?: Tone;
  variant?: 'solid' | 'outline' | 'soft';
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', variant = 'soft', dot = false, children, className }: BadgeProps) {
  const look =
    variant === 'solid'
      ? cn(toneSolid[tone], 'border-transparent text-ink-950')
      : variant === 'outline'
        ? cn(toneBorder[tone], toneText[tone], 'bg-transparent')
        : cn(toneSoft[tone], toneText[tone], 'border-transparent');
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap border px-1.5 font-mono text-micro uppercase leading-none',
        look,
        className,
      )}
    >
      {dot && <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0', variant === 'solid' ? 'bg-ink-950' : toneSolid[tone])} />}
      {children}
    </span>
  );
}

/* ------------------------------- StatusPill ------------------------------- */

export type Status = 'nominal' | 'warning' | 'danger' | 'offline' | 'telemetry';

const statusTone: Record<Status, Tone> = {
  nominal: 'nominal', warning: 'warning', danger: 'danger', offline: 'neutral', telemetry: 'telemetry',
};
const statusLabel: Record<Status, string> = {
  nominal: 'Nominal', warning: 'Caution', danger: 'Critical', offline: 'Offline', telemetry: 'Uplink',
};

export function StatusPill({ status, live = false, children, className }: { status: Status; live?: boolean; children?: ReactNode; className?: string }) {
  const tone = statusTone[status];
  return (
    <span
      role="status"
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-2 whitespace-nowrap border bg-ink-900 pl-2 pr-2.5 font-mono text-micro uppercase leading-none',
        status === 'offline' ? 'border-line text-bone-mute' : cn(toneBorder[tone], toneText[tone]),
        className,
      )}
    >
      {status === 'offline' ? (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 border border-ink-400" />
      ) : (
        <Dot className={toneSolid[tone]} live={live} size={6} />
      )}
      {children ?? statusLabel[status]}
    </span>
  );
}

/* ---------------------------------- Panel --------------------------------- */

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  index?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  dense?: boolean;
  brackets?: boolean;
}

export function Panel({ title, index, meta, actions, children, className, bodyClassName, dense = false, brackets = false, ...rest }: PanelProps) {
  const hasHeader = title != null || index != null || meta != null || actions != null;
  return (
    <section className={cn('relative flex min-w-0 flex-col border border-line bg-ink-900', className)} {...rest}>
      {brackets && <Brackets size={7} />}
      {hasHeader && (
        <header className={cn('flex shrink-0 items-center gap-2.5 border-b border-line', dense ? 'h-8 px-2.5' : 'h-10 px-3')}>
          {index && (
            <>
              <span className="font-mono text-micro text-signal fcc-num">{index}</span>
              <span aria-hidden className="h-3 w-px bg-line-strong" />
            </>
          )}
          {title != null && (
            <h3 className="min-w-0 truncate font-mono text-nano uppercase tracking-[0.14em] text-bone">{title}</h3>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {meta != null && <span className="font-mono text-micro uppercase text-bone-mute fcc-num">{meta}</span>}
            {actions}
          </div>
        </header>
      )}
      <div className={cn('min-h-0 flex-1', dense ? 'p-2.5' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export interface CardProps {
  children: ReactNode;
  interactive?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Card({ children, interactive, selected = false, onClick, className }: CardProps) {
  const isInteractive = interactive ?? Boolean(onClick);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick && selected ? true : undefined}
      onClick={onClick}
      onKeyDown={onClick ? onKeyDown : undefined}
      className={cn(
        'relative border bg-ink-900 p-3 transition-[background-color,border-color] duration-quick ease-servo',
        selected ? 'border-signal/60 bg-signal/[0.04]' : 'border-line',
        isInteractive && 'cursor-pointer',
        isInteractive && !selected && 'hover:border-line-strong hover:bg-ink-850',
        className,
      )}
    >
      {selected && <Brackets size={6} tone="signal" />}
      {children}
    </div>
  );
}

/* ------------------------------ SectionHeader ----------------------------- */

export interface SectionHeaderProps {
  index: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function SectionHeader({ index, eyebrow, title, lede, meta, className }: SectionHeaderProps) {
  return (
    <header className={cn('relative', className)}>
      <div className="flex items-center gap-4 border-b border-line pb-3">
        <span className="font-mono text-nano text-signal fcc-num">{index}</span>
        <span aria-hidden className="h-3 w-px bg-line-strong" />
        <span className="font-mono text-nano uppercase tracking-[0.16em] text-bone">{eyebrow}</span>
        <span aria-hidden className="hidden h-px flex-1 bg-line sm:block" />
        {meta != null && <div className="ml-auto font-mono text-micro uppercase text-bone-mute sm:ml-0">{meta}</div>}
      </div>
      <div className="grid grid-cols-12 gap-x-6 gap-y-6 pt-10 lg:pt-14">
        <div className="col-span-12 lg:col-span-3">
          <span aria-hidden className="block font-mono text-5xl font-light leading-none text-ink-600 fcc-num">{index}</span>
        </div>
        <div className="col-span-12 lg:col-span-9">
          <h2 className="max-w-5xl text-balance text-3xl font-medium text-bone md:text-4xl lg:text-5xl">{title}</h2>
          {lede != null && <p className="mt-6 max-w-2xl text-lg text-bone-dim">{lede}</p>}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------- Tooltip -------------------------------- */

const tipSide: Record<'top' | 'bottom' | 'left' | 'right', string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2 translate-y-1 group-hover/tip:translate-y-0 group-focus-within/tip:translate-y-0',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2 -translate-y-1 group-hover/tip:translate-y-0 group-focus-within/tip:translate-y-0',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2 translate-x-1 group-hover/tip:translate-x-0 group-focus-within/tip:translate-x-0',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2 -translate-x-1 group-hover/tip:translate-x-0 group-focus-within/tip:translate-x-0',
};

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-hud whitespace-nowrap border border-line-strong bg-ink-850 px-2 py-1 font-mono text-micro uppercase text-bone shadow-lift',
          'opacity-0 transition-[opacity,transform] duration-quick ease-servo group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          tipSide[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
