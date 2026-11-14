import { useMemo } from 'react';
import { Badge, Gauge, Metric, Progress, Sparkline, UnitChip, cn } from '@ds';
import type { SimSnapshot, Unit, UnitKind } from '@/sim/types';
import { UNIT_ORDER, fmtInt, unitGroupLabel } from './format';
import { DPanel, MiniBar, SCROLL, useElementWidth } from './ui';

function delta(series: number[], lookback = 12) {
  if (series.length < 2) return 0;
  const prev = series[Math.max(0, series.length - 1 - lookback)];
  return series[series.length - 1] - prev;
}

function Stat({ label, value, unit, tone, sub }: { label: string; value: string; unit?: string; tone?: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-ink-900 px-3 py-2.5">
      <span className="fcc-micro truncate">{label}</span>
      <span className={cn('font-mono text-lg leading-none fcc-num', tone ?? 'text-bone')}>
        {value}
        {unit && <span className="ml-1 text-nano text-bone-mute">{unit}</span>}
      </span>
      {sub && <span className="fcc-micro truncate text-ink-400">{sub}</span>}
    </div>
  );
}

export function SituationPanel({ state }: { state: SimSnapshot }) {
  const m = state.metrics;
  const h = state.history;
  const dAcres = delta(h.acres);
  const dRos = delta(h.ros);
  const dContain = delta(h.containment);
  const [sparkRef, sparkW] = useElementWidth<HTMLDivElement>();
  const contain = Math.max(0, Math.min(1, m.containmentPct / 100));

  return (
    <DPanel index="01" title="Situation" meta={<span className="fcc-micro fcc-num">REV {String(state.forecastRev).padStart(2, '0')}</span>} className="shrink-0">
      <div className="px-3 pb-3 pt-3">
        <Metric
          label="Fire area"
          value={fmtInt(m.acres)}
          unit="AC"
          size="lg"
          tone="signal"
          delta={dAcres > 0 ? { value: `+${fmtInt(dAcres)} AC`, trend: 'up', good: false } : undefined}
        />
        <div ref={sparkRef} className="mt-2 h-8 w-full">
          {sparkW > 0 && <Sparkline data={h.acres.length > 1 ? h.acres : [0, 0]} width={sparkW} height={32} tone="signal" fill />}
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-line px-3 py-3">
        <Gauge value={contain} size={64} valueLabel={`${Math.round(m.containmentPct)}%`} tone="nominal" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="fcc-micro">Containment</span>
            <span className="font-mono text-tiny text-phosphor fcc-num">{m.containmentPct.toFixed(1)}%</span>
          </div>
          <Progress value={contain} segments={24} tone="nominal" />
          <div className="mt-2 flex justify-between fcc-micro text-ink-400">
            <span>Δ Trend</span>
            <span className="fcc-num">
              {dContain >= 0 ? '+' : ''}
              {dContain.toFixed(1)} PT
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
        <Stat
          label="Rate of spread"
          value={m.rateOfSpreadMpm.toFixed(1)}
          unit="M/MIN"
          tone={m.rateOfSpreadMpm > 20 ? 'text-amber' : undefined}
          sub={`${dRos >= 0 ? '+' : ''}${dRos.toFixed(1)} TREND`}
        />
        <Stat label="Structures thr." value={fmtInt(m.structuresThreatened)} tone={m.structuresThreatened > 0 ? 'text-amber' : undefined} sub="WITHIN +3H BAND" />
        <Stat label="Persons at risk" value={fmtInt(m.personsAtRisk)} tone={m.personsAtRisk > 0 ? 'text-ember' : 'text-phosphor'} sub={m.personsAtRisk > 0 ? 'EVAC PENDING' : 'ALL CLEAR'} />
        <Stat label="Personnel" value={fmtInt(m.personnel)} unit={`/ ${m.activeUnits} U`} sub="ASSIGNED" />
      </div>
    </DPanel>
  );
}

function resourceOf(u: Unit): { label: string; value: number } | null {
  if (typeof u.battery === 'number') return { label: 'BAT', value: u.battery };
  if (typeof u.water === 'number') return { label: 'H2O', value: u.water };
  return null;
}

function UnitRow({ unit, selected, onSelect }: { unit: Unit; selected: boolean; onSelect(id: string | null): void }) {
  const res = resourceOf(unit);
  const low = res ? res.value < 0.25 : false;
  return (
    <li className="flex items-center gap-2 px-2 py-0.5">
      <UnitChip
        className="min-w-0 flex-1"
        callsign={unit.callsign}
        kind={unit.kind}
        status={unit.status}
        selected={selected}
        meta={unit.sensor ?? `${Math.round(((unit.heading % 360) + 360) % 360)}°`}
        onClick={() => onSelect(selected ? null : unit.id)}
      />
      <div className="flex w-[72px] shrink-0 flex-col items-end gap-1">
        {res ? (
          <>
            <span className={cn('font-mono text-micro leading-none fcc-num', low ? 'text-ember' : 'text-bone-mute')}>
              {res.label} {Math.round(res.value * 100)}
            </span>
            <MiniBar value={res.value} tone={low ? 'danger' : unit.kind === 'drone' ? 'telemetry' : 'neutral'} />
          </>
        ) : (
          <span className="font-mono text-micro leading-none text-ink-400">— N/A</span>
        )}
      </div>
    </li>
  );
}

export function ForcesPanel({ units, selectedId, onSelect }: { units: Unit[]; selectedId: string | null; onSelect(id: string | null): void }) {
  // Grouping depends only on membership; the engine may mutate the array in place, so key on length too.
  const groups = useMemo(() => {
    const by = new Map<UnitKind, Unit[]>();
    for (const u of units) {
      const list = by.get(u.kind);
      if (list) list.push(u);
      else by.set(u.kind, [u]);
    }
    return UNIT_ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, units: by.get(k)! }));
  }, [units, units.length]);

  const active = units.filter((u) => u.status === 'active' || u.status === 'enroute').length;

  return (
    <DPanel
      index="02"
      title="Forces"
      className="flex-1"
      bodyClassName={cn(SCROLL, 'py-1')}
      meta={
        <Badge tone="nominal" variant="outline">
          {active}/{units.length} Committed
        </Badge>
      }
    >
      {groups.map((g) => {
        const committed = g.units.filter((u) => u.status === 'active' || u.status === 'enroute').length;
        return (
          <div key={g.kind} className="pb-1">
            <div className="sticky top-0 z-raised flex items-center gap-2 bg-ink-900 px-3 pb-1 pt-2">
              <span className="fcc-micro text-bone-dim">{unitGroupLabel[g.kind]}</span>
              <span className="h-px flex-1 bg-line" />
              <span className="fcc-micro fcc-num">
                {committed}/{g.units.length}
              </span>
            </div>
            <ul>
              {g.units.map((u) => (
                <UnitRow key={u.id} unit={u} selected={selectedId === u.id} onSelect={onSelect} />
              ))}
            </ul>
          </div>
        );
      })}
      {units.length === 0 && <p className="px-3 py-6 fcc-micro">No units assigned</p>}
    </DPanel>
  );
}
