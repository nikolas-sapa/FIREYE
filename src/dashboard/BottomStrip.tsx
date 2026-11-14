import { useMemo, type ReactNode } from 'react';
import { Confidence, Sparkline, Table, cn, toneClass, type Tone } from '@ds';
import type { SimSnapshot } from '@/sim/types';
import { fmtInt, insightTone, markerKindLabel, polygonAcres, severityTone, tPlus } from './format';
import { useElementWidth } from './ui';

type Event = { id: string; at: number; tone: Tone; source: string; text: string; critical: boolean };

function Cell({ index, title, meta, children, className }: { index: string; title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col bg-ink-900', className)}>
      <div className="flex h-6 shrink-0 items-center gap-2 border-b border-line-faint px-3">
        <span className="font-mono text-micro text-signal">{index}</span>
        <span className="fcc-micro text-bone-dim">{title}</span>
        {meta && <span className="ml-auto fcc-micro">{meta}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function EventTicker({ state }: { state: SimSnapshot }) {
  const events: Event[] = [];
  for (const i of state.insights.slice(0, 8)) {
    events.push({ id: i.id, at: i.at, tone: insightTone[i.kind], source: i.kind === 'alert' ? 'ALERT' : 'ARGUS', text: i.title, critical: i.kind === 'alert' });
  }
  for (const m of state.markers) {
    if (m.severity !== 'critical' && m.severity !== 'high') continue;
    events.push({ id: m.id, at: m.detectedAt, tone: severityTone[m.severity], source: markerKindLabel[m.kind], text: m.label, critical: m.severity === 'critical' });
  }
  events.sort((a, b) => b.at - a.at);
  const shown = events.slice(0, 4);

  return (
    <ul className="py-0.5">
      {shown.map((e) => (
        <li key={e.id} className={cn('flex h-[22px] animate-rise items-center gap-2 px-3', e.critical && 'bg-ember/10')}>
          <span className={cn('h-1.5 w-1.5 shrink-0', toneClass[e.tone].dot)} />
          <span className="w-[68px] shrink-0 font-mono text-micro text-bone-mute fcc-num">{tPlus(e.at)}</span>
          <span className={cn('w-[84px] shrink-0 truncate font-mono text-micro uppercase', toneClass[e.tone].text)}>{e.source}</span>
          <span className={cn('min-w-0 truncate text-xs', e.critical ? 'text-ember' : 'text-bone-dim')}>{e.text}</span>
        </li>
      ))}
      {shown.length === 0 && <li className="px-3 py-2 fcc-micro">No events</li>}
    </ul>
  );
}

function Series({ label, data, value, tone }: { label: string; data: number[]; value: string; tone: Tone }) {
  const [ref, w] = useElementWidth<HTMLDivElement>();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="w-[72px] shrink-0">
        <div className="fcc-micro leading-none">{label}</div>
        <div className={cn('mt-1 font-mono text-tiny leading-none fcc-num', toneClass[tone].text)}>{value}</div>
      </div>
      <div ref={ref} className="h-6 min-w-0 flex-1">
        {w > 0 && <Sparkline data={data.length > 1 ? data : [0, 0]} width={w} height={24} tone={tone} />}
      </div>
    </div>
  );
}

type HorizonRow = { id: string; horizon: string; acres: number; growth: number; confidence: number };

const HORIZON_COLUMNS = [
  { key: 'h', header: 'Horizon', width: 64, render: (r: HorizonRow) => <span className="text-amber">{r.horizon}</span> },
  { key: 'a', header: 'Area', align: 'right' as const, render: (r: HorizonRow) => `${fmtInt(r.acres)} AC` },
  {
    key: 'g',
    header: 'Δ Now',
    align: 'right' as const,
    render: (r: HorizonRow) => <span className={r.growth > 0.5 ? 'text-ember' : 'text-bone-dim'}>+{Math.round(r.growth * 100)}%</span>,
  },
  { key: 'c', header: 'Conf', align: 'right' as const, width: 96, render: (r: HorizonRow) => <Confidence value={r.confidence} segments={5} showValue /> },
];

export function BottomStrip({ state, className }: { state: SimSnapshot; className?: string }) {
  const { history, metrics } = state;
  const acresNow = Math.max(1, metrics.acres);
  const rev = state.forecastRev;
  const rows = useMemo<HorizonRow[]>(
    () =>
      [...state.forecast]
        .sort((a, b) => a.horizonMin - b.horizonMin)
        .map((b) => {
          const acres = polygonAcres(b.polygon);
          return { id: String(b.horizonMin), horizon: `+${b.horizonMin / 60}H`, acres, growth: Math.max(0, acres / acresNow - 1), confidence: b.confidence };
        }),
    // Forecast polygons only change when forecastRev increments (the array may be mutated in place).
    [rev, state.forecast.length, Math.round(acresNow)],
  );

  return (
    <div className={cn('grid gap-px bg-line lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]', className)}>
      <Cell index="05" title="Event log" meta={<span className="fcc-num">{state.insights.length} EVT</span>}>
        <EventTicker state={state} />
      </Cell>
      <Cell index="06" title="History" meta="60 SMP">
        <div className="flex flex-col justify-center gap-2 px-3 py-2">
          <Series label="Acres" data={history.acres} value={fmtInt(metrics.acres)} tone="signal" />
          <Series label="Contain" data={history.containment} value={`${metrics.containmentPct.toFixed(0)}%`} tone="nominal" />
          <Series label="ROS M/MIN" data={history.ros} value={metrics.rateOfSpreadMpm.toFixed(1)} tone="warning" />
        </div>
      </Cell>
      <Cell index="07" title="Forecast horizon" meta={<span className="fcc-num">REV {String(rev).padStart(2, '0')}</span>}>
        {rows.length > 0 ? (
          <Table columns={HORIZON_COLUMNS} rows={rows} rowKey={(r) => r.id} dense />
        ) : (
          <div className="px-3 py-3 fcc-micro">Projection pending</div>
        )}
      </Cell>
    </div>
  );
}
