import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../utils';
import type { Tone } from '../tokens';
import { Icon } from '../icons';
import { arcPath, clamp01, polar, toneSolid, toneText } from './tone';

/* ---------------------------------- Table --------------------------------- */

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  render?: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  dense?: boolean;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  className?: string;
}

const alignCls = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function Table<T>({ columns, rows, rowKey, dense = false, onRowClick, selectedKey, className }: TableProps<T>) {
  const cellPad = dense ? 'h-7 px-2.5' : 'h-9 px-3';
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-strong">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: c.width }}
                className={cn('whitespace-nowrap font-mono text-micro font-normal uppercase tracking-[0.14em] text-bone-mute', cellPad, alignCls[c.align ?? 'left'])}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
              if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onRowClick(row);
              }
            };
            return (
              <tr
                key={key}
                aria-selected={onRowClick ? selected : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? onKeyDown : undefined}
                className={cn(
                  'border-b border-line-faint transition-colors duration-quick ease-servo',
                  onRowClick && 'cursor-pointer hover:bg-ink-850 focus-visible:bg-ink-850 focus-visible:outline-none',
                  selected && 'bg-signal/[0.06] shadow-[inset_2px_0_0_rgb(var(--signal))] hover:bg-signal/[0.08]',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('whitespace-nowrap font-mono text-tiny text-bone-dim fcc-num', cellPad, alignCls[c.align ?? 'left'], selected && 'text-bone')}
                  >
                    {c.render ? c.render(row) : ((row as unknown as Record<string, ReactNode>)[c.key] ?? null)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- Sparkline ------------------------------- */

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  fill?: boolean;
  className?: string;
}

export function Sparkline({ data, width = 120, height = 28, tone = 'neutral', fill = false, className }: SparklineProps) {
  const inset = 2;
  const last = data[data.length - 1];
  if (data.length < 2 || last === undefined) {
    return <svg aria-hidden width={width} height={height} className={className} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((d, i): [number, number] => [
    inset + (i / (data.length - 1)) * (width - inset * 2),
    inset + (1 - (d - min) / span) * (height - inset * 2),
  ]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1] ?? [0, 0];
  const [fx] = pts[0] ?? [0, 0];
  return (
    <svg
      role="img"
      aria-label={`Trend, ${data.length} samples, latest ${last}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', toneText[tone], className)}
    >
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="currentColor" strokeOpacity={0.18} shapeRendering="crispEdges" />
      {fill && <polygon points={`${fx.toFixed(1)},${height} ${line} ${lx.toFixed(1)},${height}`} fill="currentColor" fillOpacity={0.1} />}
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="miter" strokeLinecap="square" />
      <rect x={lx - 1.5} y={ly - 1.5} width={3} height={3} fill="currentColor" />
    </svg>
  );
}

/* --------------------------------- Metric --------------------------------- */

export interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: { value: string; trend: 'up' | 'down'; good?: boolean };
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  sub?: ReactNode;
  spark?: number[];
  className?: string;
}

const metricSize = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' } as const;

export function Metric({ label, value, unit, delta, tone = 'neutral', size = 'md', sub, spark, className }: MetricProps) {
  const deltaTone = delta?.good === undefined ? 'text-bone-dim' : delta.good ? 'text-phosphor' : 'text-ember';
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="fcc-micro truncate">{label}</span>
        {delta && (
          <span className={cn('inline-flex items-center gap-0.5 font-mono text-micro fcc-num', deltaTone)}>
            <Icon name="arrow-up-right" size={10} strokeWidth={1.5} className={delta.trend === 'down' ? 'rotate-90' : undefined} />
            {delta.value}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('font-mono font-light leading-none tracking-tight fcc-num', metricSize[size], tone === 'neutral' ? 'text-bone' : toneText[tone])}>
          {value}
        </span>
        {unit && <span className="font-mono text-nano uppercase text-bone-mute">{unit}</span>}
      </div>
      {spark && spark.length > 1 && <Sparkline data={spark} tone={tone} width={size === 'lg' ? 160 : 120} height={size === 'sm' ? 18 : 24} fill />}
      {sub != null && <span className="font-mono text-micro uppercase text-bone-mute">{sub}</span>}
    </div>
  );
}

/* ---------------------------------- Gauge --------------------------------- */

export interface GaugeProps {
  value: number;
  label?: string;
  valueLabel?: ReactNode;
  size?: number;
  tone?: Tone;
  className?: string;
}

export function Gauge({ value, label, valueLabel, size = 120, tone = 'signal', className }: GaugeProps) {
  const v = clamp01(value);
  const c = size / 2;
  const r = c - 6;
  const a0 = -135;
  const a1 = 135;
  const av = a0 + (a1 - a0) * v;
  const tickCount = 27;
  const [nx0, ny0] = polar(c, c, r - 14, av);
  const [nx1, ny1] = polar(c, c, r + 3, av);
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <path d={arcPath(c, c, r, a0, a1)} fill="none" stroke="currentColor" strokeWidth={1} className="text-line-strong" />
        {v > 0.001 && (
          <path d={arcPath(c, c, r, a0, av)} fill="none" stroke="currentColor" strokeWidth={2} className={cn('transition-all duration-slow ease-settle', toneText[tone])} />
        )}
        {Array.from({ length: tickCount + 1 }).map((_, i) => {
          const a = a0 + (i * (a1 - a0)) / tickCount;
          const major = i % 9 === 0;
          const [x0, y0] = polar(c, c, r - 4, a);
          const [x1, y1] = polar(c, c, r - (major ? 10 : 7), a);
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke="currentColor"
              strokeWidth={1}
              className={a <= av ? 'text-bone-dim' : 'text-ink-600'}
            />
          );
        })}
        <line x1={nx0} y1={ny0} x2={nx1} y2={ny1} stroke="currentColor" strokeWidth={1.5} className={toneText[tone]} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="font-mono font-light leading-none text-bone fcc-num" style={{ fontSize: Math.max(14, size * 0.2) }}>
          {valueLabel ?? `${Math.round(v * 100)}`}
        </span>
        {label && <span className="fcc-micro max-w-[70%] truncate text-center">{label}</span>}
      </div>
      <div aria-hidden className="absolute inset-x-0 bottom-1 flex justify-between font-mono text-micro text-ink-400" style={{ paddingInline: size * 0.12 }}>
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  );
}

/* ------------------------------- Confidence ------------------------------- */

export interface ConfidenceProps {
  value: number;
  segments?: number;
  showValue?: boolean;
  className?: string;
}

export function Confidence({ value, segments = 10, showValue = true, className }: ConfidenceProps) {
  const v = clamp01(value);
  const filled = Math.round(v * segments);
  const tone: Tone = v >= 0.75 ? 'telemetry' : v >= 0.5 ? 'warning' : 'danger';
  return (
    <span
      role="meter"
      aria-label="Confidence"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cn('inline-flex items-end gap-2', className)}
    >
      <span aria-hidden className="flex h-3 items-end gap-[2px]">
        {Array.from({ length: segments }).map((_, i) => (
          <span key={i} className={cn('w-[3px]', i < filled ? toneSolid[tone] : 'bg-ink-700')} style={{ height: `${40 + (60 * (i + 1)) / segments}%` }} />
        ))}
      </span>
      {showValue && <span className={cn('font-mono text-micro leading-none fcc-num', toneText[tone])}>{v.toFixed(2)}</span>}
    </span>
  );
}
