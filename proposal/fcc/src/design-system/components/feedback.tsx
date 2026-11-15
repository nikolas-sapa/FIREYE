import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils';
import type { Tone } from '../tokens';
import { Brackets } from '../primitives';
import { Icon, type IconName } from '../icons';
import { IconButton } from './Button';
import { clamp01, toneBorderL, toneSolid, toneText } from './tone';

/* ---------------------------------- Alert --------------------------------- */

const toneIcon: Record<Tone, IconName> = {
  neutral: 'radio', signal: 'zap', danger: 'flame', warning: 'hazard', nominal: 'check', telemetry: 'ai', detection: 'human',
};

export interface AlertProps {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  timestamp?: string;
  onClose?: () => void;
  className?: string;
}

export function Alert({ tone = 'neutral', title, children, icon, timestamp, onClose, className }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('relative flex gap-3 border border-l-2 border-line bg-ink-900 py-3 pl-3 pr-2', toneBorderL[tone], className)}
    >
      <span className={cn('mt-px flex h-6 w-6 shrink-0 items-center justify-center border border-line', toneText[tone])}>
        <Icon name={icon ?? toneIcon[tone]} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className={cn('min-w-0 font-mono text-nano uppercase tracking-[0.12em]', toneText[tone])}>{title}</span>
          {timestamp && <span className="ml-auto shrink-0 font-mono text-micro text-bone-mute fcc-num">{timestamp}</span>}
        </div>
        {children != null && <div className="mt-1 text-sm text-bone-dim">{children}</div>}
      </div>
      {onClose && <IconButton icon="close" label="Dismiss" variant="ghost" size="sm" onClick={onClose} className="-my-1 shrink-0" />}
    </div>
  );
}

/* --------------------------------- Progress ------------------------------- */

export interface ProgressProps {
  value: number;
  tone?: Tone;
  segments?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function Progress({ value, tone = 'signal', segments, label, showValue = false, className }: ProgressProps) {
  const v = clamp01(value);
  const pct = Math.round(v * 100);
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <span className="fcc-micro">{label}</span>}
          {showValue && <span className="ml-auto font-mono text-tiny text-bone fcc-num">{String(pct).padStart(2, '0')}%</span>}
        </div>
      )}
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        {segments && segments > 0 ? (
          <div className="flex h-2.5 gap-px">
            {Array.from({ length: segments }).map((_, i) => (
              <span
                key={i}
                className={cn('flex-1 transition-colors duration-base ease-servo', i < Math.round(v * segments) ? toneSolid[tone] : 'bg-ink-700')}
              />
            ))}
          </div>
        ) : (
          <div className="relative h-1 bg-ink-800">
            <span className={cn('absolute inset-y-0 left-0 transition-[width] duration-slow ease-settle', toneSolid[tone])} style={{ width: `${pct}%` }} />
            <span aria-hidden className="absolute inset-0 flex justify-between">
              {Array.from({ length: 11 }).map((_, i) => (
                <span key={i} className="h-full w-px bg-ink-950/80" />
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Timeline ------------------------------- */

export interface TimelineItem {
  id: string;
  time: string;
  title: ReactNode;
  body?: ReactNode;
  tone?: Tone;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative flex flex-col', className)}>
      {items.map((item, i) => {
        const tone = item.tone ?? 'neutral';
        const last = i === items.length - 1;
        return (
          <li key={item.id} className="grid grid-cols-[64px_16px_1fr] gap-x-2">
            <span className="pt-0.5 text-right font-mono text-micro text-bone-mute fcc-num">{item.time}</span>
            <span aria-hidden className="relative flex justify-center">
              {!last && <span className="absolute bottom-0 top-3 w-px bg-line" />}
              <span className={cn('relative mt-1 h-[7px] w-[7px] border', tone === 'neutral' ? 'border-ink-300 bg-ink-950' : cn(toneSolid[tone], 'border-transparent'))} />
            </span>
            <div className={cn('min-w-0', last ? 'pb-0' : 'pb-5')}>
              <div className={cn('text-sm', tone === 'neutral' ? 'text-bone' : toneText[tone])}>{item.title}</div>
              {item.body != null && <div className="mt-0.5 text-xs text-bone-dim">{item.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------- LogLine -------------------------------- */

export function LogLine({ time, source, tone = 'neutral', children, className }: { time: string; source: string; tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline gap-3 border-b border-line-faint py-1 font-mono text-tiny leading-5', className)}>
      <span className="shrink-0 text-bone-mute fcc-num">{time}</span>
      <span className={cn('w-[72px] shrink-0 truncate uppercase text-micro', toneText[tone])}>[{source}]</span>
      <span className="min-w-0 flex-1 text-bone-dim">{children}</span>
    </div>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-void/80 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative w-full max-w-lg animate-rise border border-line-strong bg-ink-900 shadow-lift outline-none', className)}
      >
        <Brackets size={10} tone="signal" inset={-4} />
        <header className="flex h-11 items-center gap-3 border-b border-line pl-4 pr-2">
          <span aria-hidden className="h-1.5 w-1.5 bg-signal" />
          <h2 id={titleId} className="min-w-0 truncate font-mono text-nano uppercase tracking-[0.14em] text-bone">
            {title}
          </h2>
          <span className="ml-auto hidden font-mono text-micro text-bone-mute sm:inline">ESC</span>
          <IconButton icon="close" label="Close dialog" variant="ghost" size="sm" onClick={onClose} />
        </header>
        <div className="max-h-[70vh] overflow-auto p-4 text-sm text-bone-dim">{children}</div>
        {footer != null && <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
