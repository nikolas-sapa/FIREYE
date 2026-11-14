import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../utils';
import type { Tone } from '../tokens';
import { Brackets, Dot } from '../primitives';
import { Icon, type IconName } from '../icons';
import { Button, IconButton } from './Button';
import { Tooltip } from './display';
import { clamp01, toneBorder, toneBorderL, toneSoft, toneSolid, toneText } from './tone';

/* ---------------------------------------------------------------------------
 * ORCHESTRATOR PATTERNS (REV B)
 * The Orchestrator grades every piece of information 0-100 and the score
 * decides where it renders. These components are the visual vocabulary for
 * that grading: tiers, alert cards, the interrupt banner, freshness decay,
 * the conversation thread, drawers, the icon rail, camera tiles, agent pools
 * and movement proposals.
 * ------------------------------------------------------------------------- */

export type OrchTier = 0 | 1 | 2 | 3;
export type OrchAlertClass = 'life' | 'hazard' | 'fuel' | 'movement' | 'projection' | 'status';
export type OrchAudience = 'fire' | 'ems' | 'law' | 'public';
export type MovementStatus = 'proposed' | 'approved' | 'rejected' | 'executing' | 'done';

/** Score bands, low edge inclusive. */
export const TIER_BANDS: ReadonlyArray<{ tier: OrchTier; min: number; max: number; name: string; placement: string }> = [
  { tier: 0, min: 85, max: 100, name: 'Interrupt', placement: 'Banner over map, must be acknowledged' },
  { tier: 1, min: 60, max: 84, name: 'Focus', placement: 'Orchestrator dock, needs attention (max 3)' },
  { tier: 2, min: 35, max: 59, name: 'Ambient', placement: 'Map glyph and dock count' },
  { tier: 3, min: 0, max: 34, name: 'Log', placement: 'Log drawer only' },
];

export function tierOf(score: number): OrchTier {
  if (score >= 85) return 0;
  if (score >= 60) return 1;
  if (score >= 35) return 2;
  return 3;
}

export const tierTone: Record<OrchTier, Tone> = { 0: 'danger', 1: 'warning', 2: 'telemetry', 3: 'neutral' };
const tierName: Record<OrchTier, string> = { 0: 'Interrupt', 1: 'Focus', 2: 'Ambient', 3: 'Log' };

/** Alert class tone for map glyphs. Life switches to `danger` on cards at tier 0/1. */
export const alertClassTone: Record<OrchAlertClass, Tone> = {
  life: 'detection', hazard: 'danger', fuel: 'warning', movement: 'signal', projection: 'warning', status: 'neutral',
};
export const alertClassIcon: Record<OrchAlertClass, IconName> = {
  life: 'human', hazard: 'combustible', fuel: 'tree', movement: 'route', projection: 'flame', status: 'radio',
};
export const alertClassLabel: Record<OrchAlertClass, string> = {
  life: 'Life safety', hazard: 'Hazard', fuel: 'Fuel', movement: 'Movement', projection: 'Projection', status: 'Status',
};
export const audienceLabel: Record<OrchAudience, string> = { fire: 'Fire', ems: 'EMS', law: 'Law', public: 'Public' };
const audiences: OrchAudience[] = ['fire', 'ems', 'law', 'public'];

/** Tone an alert card should use, given class and tier. */
export function alertTone(cls: OrchAlertClass, tier: OrchTier): Tone {
  if (cls === 'life' && tier <= 1) return 'danger';
  return alertClassTone[cls];
}

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal';

function onActivate(fn?: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (!fn) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

/* ------------------------------- ScoreMeter ------------------------------- */

export interface ScoreMeterProps {
  score: number;
  size?: 'sm' | 'md';
  showValue?: boolean;
  className?: string;
}

const SEGMENTS = 20;
const TICKS = [35, 60, 85];

export function ScoreMeter({ score, size = 'md', showValue = true, className }: ScoreMeterProps) {
  const s = Math.round(clamp01(score / 100) * 100);
  const tier = tierOf(s);
  const tone = tierTone[tier];
  const filled = Math.round((s / 100) * SEGMENTS);
  const sized = /(^|\s)w-/.test(className ?? '');
  return (
    <span
      role="meter"
      aria-label={`Score ${s}, tier ${tier} ${tierName[tier]}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={s}
      className={cn('inline-flex min-w-0 items-center gap-2', !sized && (size === 'sm' ? 'w-28' : 'w-44'), className)}
    >
      <span aria-hidden className={cn('relative flex min-w-0 flex-1 gap-px', size === 'sm' ? 'h-1.5' : 'h-2.5')}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className={cn('flex-1 transition-colors duration-base ease-servo', i < filled ? toneSolid[tone] : 'bg-ink-700')}
          />
        ))}
        {TICKS.map((t) => (
          <span
            key={t}
            className={cn('absolute top-full w-px bg-ink-400', size === 'sm' ? 'h-[3px]' : 'h-1')}
            style={{ left: `calc(${t}% - 0.5px)` }}
          />
        ))}
      </span>
      {showValue && (
        <span className={cn('w-6 shrink-0 text-right font-mono leading-none fcc-num', size === 'sm' ? 'text-micro' : 'text-tiny', toneText[tone])}>
          {String(s).padStart(2, '0')}
        </span>
      )}
    </span>
  );
}

/* -------------------------------- TierBadge ------------------------------- */

export function TierBadge({ tier, className }: { tier: OrchTier; className?: string }) {
  const tone = tierTone[tier];
  const look =
    tier === 0
      ? cn(toneSolid[tone], 'border-transparent text-ink-950')
      : tier === 1
        ? cn(toneBorder[tone], toneText[tone], 'bg-transparent')
        : tier === 2
          ? cn(toneSoft[tone], toneText[tone], 'border-transparent')
          : 'border-line text-bone-mute';
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap border px-1.5 font-mono text-micro uppercase leading-none',
        look,
        className,
      )}
    >
      <span className="fcc-num">T{tier}</span>
      <span aria-hidden className={cn('h-2.5 w-px', tier === 0 ? 'bg-ink-950/40' : 'bg-current opacity-40')} />
      {tierName[tier]}
    </span>
  );
}

/* ------------------------------ Audience row ------------------------------ */

function NotifyRow({ notify, className }: { notify: OrchAudience[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} aria-label={`Relayed to ${notify.map((a) => audienceLabel[a]).join(', ') || 'nobody'}`}>
      <Icon name="send" size={10} className="text-bone-mute" />
      <span className="flex items-center gap-px" aria-hidden>
        {audiences.map((a) => {
          const on = notify.includes(a);
          return (
            <span
              key={a}
              className={cn(
                'inline-flex h-4 items-center gap-1 px-1 font-mono text-micro uppercase leading-none',
                on ? 'bg-ink-700 text-bone' : 'text-ink-500 line-through decoration-ink-600',
              )}
            >
              {on && <span className="h-1 w-1 bg-phosphor" />}
              {audienceLabel[a]}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* -------------------------------- AlertCard ------------------------------- */

export interface AlertCardProps {
  cls: OrchAlertClass;
  tier: OrchTier;
  score: number;
  title: ReactNode;
  body?: ReactNode;
  why?: ReactNode;
  time?: string;
  notify?: OrchAudience[];
  actions?: ReactNode;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}

export function AlertCard({ cls, tier, score, title, body, why, time, notify, actions, compact = false, onClick, selected = false, className }: AlertCardProps) {
  const tone = alertTone(cls, tier);
  const interactive = Boolean(onClick);
  const shell = cn(
    'group/alert relative min-w-0 border border-l-2 bg-ink-900 text-left transition-[background-color,border-color] duration-quick ease-servo',
    selected ? 'border-signal/60 bg-signal/[0.04]' : 'border-line',
    toneBorderL[tone],
    interactive && 'cursor-pointer',
    interactive && !selected && 'hover:border-line-strong hover:bg-ink-850',
    interactive && focusRing,
    className,
  );
  const a11y = interactive
    ? { role: 'button' as const, tabIndex: 0, 'aria-pressed': selected || undefined, onClick, onKeyDown: onActivate(onClick) }
    : { role: tier === 0 ? ('alert' as const) : undefined };

  if (compact) {
    return (
      <div {...a11y} className={cn(shell, 'flex h-9 items-center gap-2.5 pl-2 pr-2.5')}>
        {selected && <Brackets size={5} tone="signal" />}
        <Icon name={alertClassIcon[cls]} size={14} className={toneText[tone]} />
        <span className="min-w-0 flex-1 truncate text-sm text-bone">{title}</span>
        <span className={cn('shrink-0 font-mono text-micro fcc-num', toneText[tierTone[tierOf(score)]])}>{String(Math.round(score)).padStart(2, '0')}</span>
        {time && <span className="shrink-0 font-mono text-micro text-bone-mute fcc-num">{time}</span>}
      </div>
    );
  }

  return (
    <div {...a11y} className={cn(shell, 'flex flex-col gap-2.5 p-3')}>
      {selected && <Brackets size={6} tone="signal" />}
      <div className="flex items-center gap-2">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center border border-line', toneText[tone])}>
          <Icon name={alertClassIcon[cls]} size={14} />
        </span>
        <span className={cn('font-mono text-micro uppercase tracking-[0.14em]', toneText[tone])}>{alertClassLabel[cls]}</span>
        <TierBadge tier={tier} className="ml-1" />
        {time && <span className="ml-auto shrink-0 font-mono text-micro text-bone-mute fcc-num">{time}</span>}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-bone">{title}</div>
        {body != null && <div className="mt-1 text-xs leading-5 text-bone-dim">{body}</div>}
      </div>
      {why != null && (
        <div className="flex items-start gap-1.5 font-mono text-micro uppercase leading-4 text-bone-mute">
          <Icon name="sparkle" size={10} className="mt-[3px] text-ice" />
          <span className="min-w-0">{why}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-faint pt-2.5">
        <ScoreMeter score={score} size="sm" />
        {notify && <NotifyRow notify={notify} />}
        {actions != null && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}

/* ----------------------------- InterruptBanner ---------------------------- */

export interface InterruptBannerProps {
  cls: OrchAlertClass;
  title: ReactNode;
  body?: ReactNode;
  score: number;
  time?: string;
  notify?: OrchAudience[];
  onAck: () => void;
  onLocate?: () => void;
  className?: string;
}

export function InterruptBanner({ cls, title, body, score, time, notify, onAck, onLocate, className }: InterruptBannerProps) {
  const tone = alertTone(cls, 0);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn('relative w-full max-w-[640px] animate-rise border border-t-2 border-ember/60 border-t-ember bg-ink-900 shadow-lift', className)}
    >
      <Brackets size={8} inset={-4} />
      <div className="flex h-8 items-center gap-2.5 border-b border-line pl-3 pr-3">
        <Dot className="bg-ember" live size={6} />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-ember">T0 Interrupt</span>
        <span aria-hidden className="h-3 w-px bg-line-strong" />
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-micro uppercase', toneText[tone])}>
          <Icon name={alertClassIcon[cls]} size={12} />
          {alertClassLabel[cls]}
        </span>
        <div aria-hidden className="fcc-hatch mx-2 h-3 min-w-6 flex-1 opacity-60" />
        {time && <span className="font-mono text-micro text-bone-mute fcc-num">{time}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-medium text-bone">{title}</div>
            {body != null && <div className="mt-1 text-sm text-bone-dim">{body}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="fcc-micro">Score</span>
            <span className="font-mono text-2xl font-light leading-none text-ember fcc-num">{Math.round(score)}</span>
          </div>
        </div>
        <ScoreMeter score={score} size="sm" showValue={false} className="w-full" />
        <div className="flex flex-wrap items-center gap-3 border-t border-line-faint pt-3">
          {notify ? (
            <span className="flex items-center gap-2">
              <span className="fcc-micro">Relayed to</span>
              <NotifyRow notify={notify} />
            </span>
          ) : (
            <span className="fcc-micro">Not yet relayed</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {onLocate && (
              <Button size="sm" variant="secondary" icon="locate" onClick={onLocate}>
                Locate
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={onAck}>
              Acknowledge
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Freshness ------------------------------- */

export interface FreshnessProps {
  freshness: number;
  live?: boolean;
  age?: string;
  className?: string;
}

export function Freshness({ freshness, live = false, age, className }: FreshnessProps) {
  const f = live ? 1 : clamp01(freshness);
  const expired = !live && f < 0.1;
  const style: CSSProperties | undefined = live ? undefined : { opacity: 0.35 + 0.65 * f, filter: `grayscale(${(1 - f).toFixed(2)})` };
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-micro uppercase leading-none fcc-num', className)}
      aria-label={live ? 'Live' : `${expired ? 'Expired' : 'Freshness ' + Math.round(f * 100) + '%'}${age ? ', ' + age : ''}`}
    >
      {live ? (
        <>
          <Dot className="bg-phosphor" live size={6} />
          <span className="text-phosphor">Live</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5" style={style}>
          {expired ? (
            <span aria-hidden className="h-1.5 w-1.5 border border-dashed border-ink-400" />
          ) : (
            <span aria-hidden className="h-1.5 w-1.5 bg-ice" />
          )}
          <span className={expired ? 'text-ink-400 line-through' : 'text-ice'}>{age ?? `${Math.round(f * 100)}%`}</span>
        </span>
      )}
    </span>
  );
}

/* -------------------------------- OrchBubble ------------------------------ */

export interface OrchBubbleProps {
  role: 'orchestrator' | 'user';
  time?: string;
  children?: ReactNode;
  thinking?: boolean;
  className?: string;
}

export function OrchBubble({ role, time, children, thinking = false, className }: OrchBubbleProps) {
  const orch = role === 'orchestrator';
  return (
    <div className={cn('flex w-full flex-col gap-1', orch ? 'items-start' : 'items-end', className)}>
      <div className={cn('flex items-center gap-2 font-mono text-micro uppercase', orch ? 'text-ice' : 'text-bone-mute')}>
        {orch && <Icon name="orchestrator" size={11} />}
        <span>{orch ? 'Orchestrator' : 'You'}</span>
        {time && <span className="text-bone-mute fcc-num">{time}</span>}
      </div>
      <div
        className={cn(
          'max-w-[92%] border px-3 py-2 text-sm leading-5',
          orch ? 'border-line border-l-2 border-l-ice bg-ink-900 text-bone' : 'border-line-strong bg-ink-800 text-bone-dim',
        )}
      >
        {thinking ? (
          <span role="status" aria-label="Orchestrator is thinking" className="flex h-5 items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-blink bg-ice" style={{ animationDelay: `${i * 180}ms` }} />
            ))}
          </span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/* -------------------------------- PromptChip ------------------------------ */

export function PromptChip({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/chip inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 border border-line-strong bg-ink-900 px-2.5 text-xs text-bone-dim',
        'transition-[background-color,border-color,color] duration-quick ease-servo hover:border-ink-400 hover:bg-ink-800 hover:text-bone active:translate-y-px',
        focusRing,
        className,
      )}
    >
      <Icon name="sparkle" size={11} className="text-ice" />
      <span className="truncate">{children}</span>
      <Icon name="arrow-right" size={11} className="-ml-0.5 text-bone-mute transition-transform duration-quick ease-servo group-hover/chip:translate-x-0.5" />
    </button>
  );
}

/* ---------------------------------- Drawer -------------------------------- */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  index?: string;
  side?: 'left' | 'right';
  width?: number;
  /** Distance from the anchoring edge in px, e.g. the width of an icon rail. */
  offset?: number;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, index, side = 'left', width = 360, offset = 0, children, actions, className }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = ref.current;
      // Only the drawer that holds focus (or any open drawer if focus is on body) closes.
      if (el && (el.contains(document.activeElement) || document.activeElement === document.body)) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const left = side === 'left';
  return (
    <aside
      ref={ref}
      aria-hidden={!open}
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'absolute inset-y-0 z-overlay flex max-w-full flex-col border-line bg-ink-900 shadow-lift',
        'transition-[transform,opacity,visibility] duration-slow ease-settle',
        left ? 'border-r' : 'border-l',
        open ? 'visible translate-x-0 opacity-100' : cn('invisible opacity-0', left ? '-translate-x-4' : 'translate-x-4'),
        className,
      )}
      style={{ width, [left ? 'left' : 'right']: offset }}
    >
      <header className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line pl-3 pr-1.5">
        {index && (
          <>
            <span className="font-mono text-micro text-signal fcc-num">{index}</span>
            <span aria-hidden className="h-3 w-px bg-line-strong" />
          </>
        )}
        <h3 className="min-w-0 truncate font-mono text-nano uppercase tracking-[0.14em] text-bone">{title}</h3>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          <IconButton icon="close" label="Close panel" variant="ghost" size="sm" onClick={onClose} tabIndex={open ? 0 : -1} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </aside>
  );
}

/* --------------------------------- IconRail ------------------------------- */

export interface IconRailItem {
  id: string;
  icon: IconName;
  label: string;
  badge?: number | string;
  tone?: Tone;
}

export interface IconRailProps {
  items: IconRailItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}

export function IconRail({ items, value, onChange, className }: IconRailProps) {
  return (
    <nav aria-label="Panels" className={cn('flex w-12 shrink-0 flex-col border-r border-line bg-ink-900', className)}>
      {items.map((it) => {
        const active = it.id === value;
        const tone = it.tone ?? 'neutral';
        const showBadge = it.badge !== undefined && it.badge !== 0 && it.badge !== '';
        return (
          <Tooltip key={it.id} content={it.label} side="right" className="flex">
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={active}
              onClick={() => onChange(active ? null : it.id)}
              className={cn(
                'relative flex h-12 w-12 items-center justify-center border-b border-line-faint transition-[background-color,color] duration-quick ease-servo',
                focusRing,
                'focus-visible:outline-offset-[-3px]',
                active ? 'bg-signal/10 text-signal' : 'text-bone-dim hover:bg-ink-800 hover:text-bone',
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-signal" />}
              <Icon name={it.icon} size={18} />
              {showBadge && (
                <span
                  className={cn(
                    'absolute right-1 top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center px-0.5 font-mono text-micro leading-none tracking-normal fcc-num',
                    tone === 'neutral' ? 'bg-ink-600 text-bone' : cn(toneSolid[tone], 'text-ink-950'),
                  )}
                >
                  {it.badge}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

/* --------------------------------- FeedTile ------------------------------- */

export interface FeedTileProps {
  label: string;
  live?: boolean;
  meta?: ReactNode;
  children?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function FeedTile({ label, live = false, meta, children, selected = false, onClick, className }: FeedTileProps) {
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={interactive ? label : undefined}
      onClick={onClick}
      onKeyDown={interactive ? onActivate(onClick) : undefined}
      className={cn(
        'group/feed relative flex min-w-0 flex-col border bg-ink-950 transition-[border-color] duration-quick ease-servo',
        selected ? 'border-signal/60' : 'border-line',
        interactive && 'cursor-pointer',
        interactive && !selected && 'hover:border-line-strong',
        interactive && focusRing,
        className,
      )}
    >
      {selected && <Brackets size={7} tone="signal" inset={-3} />}
      <div className="relative aspect-video w-full overflow-hidden bg-void">
        <div className="absolute inset-0">{children}</div>
        <div aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-1.5">
          <span className="max-w-[70%] truncate bg-ink-950/80 px-1.5 py-0.5 font-mono text-micro uppercase text-bone">{label}</span>
          {live ? (
            <span className="inline-flex items-center gap-1 bg-ink-950/80 px-1.5 py-0.5 font-mono text-micro uppercase text-bone">
              <Dot className="bg-ember" live size={5} />
              Live
            </span>
          ) : (
            <span className="bg-ink-950/80 px-1.5 py-0.5 font-mono text-micro uppercase text-bone-mute">Clip</span>
          )}
        </div>
      </div>
      {meta != null && (
        <div className="flex h-6 min-w-0 items-center gap-2 border-t border-line px-2 font-mono text-micro uppercase text-bone-mute fcc-num">{meta}</div>
      )}
    </div>
  );
}

/* ---------------------------------- PoolBar ------------------------------- */

export interface PoolBarProps {
  label: string;
  provider: string;
  workers: number;
  maxWorkers: number;
  queue: number;
  meta?: ReactNode;
  className?: string;
}

export function PoolBar({ label, provider, workers, maxWorkers, queue, meta, className }: PoolBarProps) {
  const max = Math.max(1, Math.round(maxWorkers));
  const w = Math.max(0, Math.min(max, Math.round(workers)));
  const q = Math.max(0, Math.round(queue));
  const saturated = w >= max && q > 0;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-mono text-nano uppercase tracking-[0.12em] text-bone">{label}</span>
        <span className="shrink-0 border border-line px-1 font-mono text-micro uppercase leading-4 text-bone-mute">{provider}</span>
        <span className="ml-auto shrink-0 font-mono text-micro uppercase text-bone-mute fcc-num">
          <span className="text-ice">{String(w).padStart(2, '0')}</span>/{String(max).padStart(2, '0')}
        </span>
        <span className={cn('w-10 shrink-0 text-right font-mono text-micro uppercase fcc-num', q > 0 ? (saturated ? 'text-amber' : 'text-bone-dim') : 'text-ink-500')}>
          Q{String(q).padStart(2, '0')}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label}: ${w} of ${max} workers, ${q} queued`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={w}
        className="flex h-3 gap-px"
      >
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={cn('min-w-[2px] flex-1 transition-colors duration-base ease-servo', i < w ? (saturated ? 'bg-amber' : 'bg-ice') : 'bg-ink-800 shadow-inset')}
          />
        ))}
      </div>
      {meta != null && <div className="font-mono text-micro uppercase text-bone-mute fcc-num">{meta}</div>}
    </div>
  );
}

/* ------------------------------- MovementCard ----------------------------- */

const movementStatusTone: Record<MovementStatus, Tone> = {
  proposed: 'warning', approved: 'nominal', rejected: 'neutral', executing: 'telemetry', done: 'nominal',
};

export interface MovementCardProps {
  title: ReactNode;
  group: ReactNode;
  windowLabel: string;
  trigger: ReactNode;
  reason?: ReactNode;
  score: number;
  status: MovementStatus;
  onApprove?: () => void;
  onReject?: () => void;
  onLocate?: () => void;
  /** Render Approve as the primary (signal) action. Set false when another primary action is on screen. */
  primary?: boolean;
  className?: string;
}

export function MovementCard({ title, group, windowLabel, trigger, reason, score, status, onApprove, onReject, onLocate, primary = true, className }: MovementCardProps) {
  const st = movementStatusTone[status];
  const proposed = status === 'proposed';
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col border border-l-2 bg-ink-900',
        proposed ? 'border-line border-l-signal' : 'border-line border-l-ink-500',
        status === 'rejected' && 'opacity-60',
        className,
      )}
    >
      <div className="flex h-8 items-center gap-2 border-b border-line-faint px-3">
        <Icon name="route" size={12} className={proposed ? 'text-signal' : 'text-bone-mute'} />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">Movement</span>
        <span className={cn('inline-flex items-center gap-1.5 font-mono text-micro uppercase', toneText[st])}>
          {status === 'executing' ? <Dot className={toneSolid[st]} live size={5} /> : <span aria-hidden className={cn('h-1 w-1', toneSolid[st])} />}
          {status}
        </span>
        <ScoreMeter score={score} size="sm" className="ml-auto w-24" />
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div>
          <div className="text-sm font-medium text-bone">{title}</div>
          <div className="mt-0.5 font-mono text-micro uppercase text-bone-mute">{group}</div>
        </div>
        <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5">
          <dt className="fcc-micro pt-px">Window</dt>
          <dd className="font-mono text-tiny text-bone fcc-num">{windowLabel}</dd>
          <dt className="fcc-micro pt-px">Trigger</dt>
          <dd className="font-mono text-tiny text-amber">{trigger}</dd>
          {reason != null && (
            <>
              <dt className="fcc-micro pt-px">Reason</dt>
              <dd className="text-xs leading-5 text-bone-dim">{reason}</dd>
            </>
          )}
        </dl>
        {(onApprove || onReject || onLocate) && (
          <div className="flex items-center gap-1.5 border-t border-line-faint pt-3">
            {onLocate && <IconButton icon="locate" label="Show route on map" size="sm" onClick={onLocate} />}
            <div className="ml-auto flex items-center gap-1.5">
              {proposed && onReject && (
                <Button size="sm" variant="ghost" onClick={onReject}>
                  Reject
                </Button>
              )}
              {proposed && onApprove && (
                <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={onApprove}>
                  Approve
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
