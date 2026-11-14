import type { CSSProperties, ReactNode } from 'react';
import { cn, pad } from '../utils';
import type { Tone } from '../tokens';
import { Icon } from '../icons';
import { polar, toneSolid, toneText } from './tone';

/* -------------------------------- UnitChip -------------------------------- */

export type UnitKind = 'drone' | 'engine' | 'crew' | 'helo' | 'tanker' | 'dozer';
export type UnitStatus = 'active' | 'enroute' | 'standby' | 'rtb';

const unitTone: Record<UnitStatus, Tone> = { active: 'nominal', enroute: 'telemetry', standby: 'neutral', rtb: 'warning' };
const unitStatusLabel: Record<UnitStatus, string> = { active: 'Active', enroute: 'En route', standby: 'Standby', rtb: 'RTB' };

export interface UnitChipProps {
  callsign: string;
  kind: UnitKind;
  status: UnitStatus;
  meta?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function UnitChip({ callsign, kind, status, meta, selected = false, onClick, className }: UnitChipProps) {
  const tone = unitTone[status];
  const cls = cn(
    'group/unit relative flex h-10 w-full min-w-0 items-center gap-2.5 border bg-ink-900 pl-1 pr-2.5 text-left transition-[background-color,border-color] duration-quick ease-servo',
    selected ? 'border-signal/60 bg-signal/[0.05]' : 'border-line',
    onClick && !selected && 'hover:border-line-strong hover:bg-ink-850',
    onClick && 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal',
    className,
  );
  const body = (
    <>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-signal" />}
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center border',
          selected ? 'border-signal/40 text-signal' : kind === 'drone' ? 'border-line text-ice' : 'border-line text-bone-dim',
        )}
      >
        <Icon name={kind} size={16} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-tiny uppercase leading-none tracking-[0.08em] text-bone">{callsign}</span>
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-micro uppercase leading-none', toneText[tone])}>
          <span aria-hidden className={cn('h-1 w-1', toneSolid[tone])} />
          {unitStatusLabel[status]}
          <span className="text-ink-400">/ {kind}</span>
        </span>
      </span>
      {meta != null && <span className="ml-auto min-w-0 truncate pl-1 font-mono text-micro uppercase text-bone-mute fcc-num">{meta}</span>}
    </>
  );
  return onClick ? (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* --------------------------------- Legend --------------------------------- */

export interface LegendItem {
  label: string;
  color: string;
  shape?: 'square' | 'line' | 'dot' | 'hatch' | 'dash';
}

function Swatch({ color, shape = 'square' }: { color: string; shape?: LegendItem['shape'] }) {
  let style: CSSProperties;
  switch (shape) {
    case 'line':
      style = { width: 16, height: 2, background: color };
      break;
    case 'dot':
      style = { width: 7, height: 7, background: color, borderRadius: 999 };
      break;
    case 'hatch':
      style = {
        width: 12,
        height: 10,
        boxShadow: `inset 0 0 0 1px ${color}`,
        backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0 1px, transparent 1px 4px)`,
      };
      break;
    case 'dash':
      style = { width: 16, height: 0, borderTop: `1.5px dashed ${color}` };
      break;
    default:
      style = { width: 10, height: 10, background: color };
  }
  return (
    <span aria-hidden className="inline-flex w-4 shrink-0 items-center justify-center">
      <span style={style} />
    </span>
  );
}

export function Legend({ items, direction = 'row', className }: { items: LegendItem[]; direction?: 'row' | 'column'; className?: string }) {
  return (
    <ul className={cn('flex', direction === 'row' ? 'flex-wrap items-center gap-x-5 gap-y-2' : 'flex-col gap-2', className)}>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-2">
          <Swatch color={it.color} shape={it.shape} />
          <span className="font-mono text-micro uppercase text-bone-dim">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- Compass -------------------------------- */

export function Compass({ heading, size = 96, label, className }: { heading: number; size?: number; label?: string; className?: string }) {
  const c = size / 2;
  const r = c - 1;
  const norm = ((Math.round(heading) % 360) + 360) % 360;
  const cardinals: Array<[string, number]> = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  return (
    <div className={cn('inline-flex flex-col items-center gap-2', className)}>
      <svg
        role="img"
        aria-label={`Heading ${norm} degrees`}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible"
      >
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" className="text-line-strong" />
        <circle cx={c} cy={c} r={r * 0.42} fill="none" stroke="currentColor" className="text-line" />
        <g
          className="transition-transform duration-slow ease-settle"
          style={{ transform: `rotate(${-heading}deg)`, transformOrigin: `${c}px ${c}px` }}
        >
          {Array.from({ length: 72 }).map((_, i) => {
            const a = i * 5;
            const len = a % 30 === 0 ? 6 : a % 10 === 0 ? 4 : 2;
            const [x0, y0] = polar(c, c, r - 1, a);
            const [x1, y1] = polar(c, c, r - 1 - len, a);
            return (
              <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" className={a % 30 === 0 ? 'text-bone-dim' : 'text-ink-500'} />
            );
          })}
          {cardinals.map(([t, a]) => {
            const [x, y] = polar(c, c, r - 14, a);
            return (
              <text
                key={t}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(7, size * 0.09)}
                className={cn('fill-current font-mono', t === 'N' ? 'text-signal' : 'text-bone-mute')}
              >
                {t}
              </text>
            );
          })}
        </g>
        <path d={`M${c - 3.5} 0 L${c + 3.5} 0 L${c} 6 Z`} className="fill-signal" />
        <g stroke="currentColor" className="text-bone-dim" shapeRendering="crispEdges">
          <line x1={c - 5} y1={c} x2={c - 2} y2={c} />
          <line x1={c + 2} y1={c} x2={c + 5} y2={c} />
          <line x1={c} y1={c - 5} x2={c} y2={c - 2} />
          <line x1={c} y1={c + 2} x2={c} y2={c + 5} />
        </g>
      </svg>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-tiny text-bone fcc-num">{pad(norm, 3)}°</span>
        {label && <span className="fcc-micro">{label}</span>}
      </div>
    </div>
  );
}
