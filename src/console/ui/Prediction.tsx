import { useMemo } from 'react';
import { PredictionCheckCard, ProvenanceTag, cn, type PredictionCheckCardProps } from '@ds';
import type { Ms, PredictionCheck, ScenarioPack } from '../contracts';
import { useConsoleSelector } from '../store';
import { areaUnit, localDay, localTime, packTz } from './format';
import { useUi } from './UiContext';

const EMPTY: PredictionCheck[] = [];

export function usePredictions() {
  const list = useConsoleSelector((s) => s.predictions ?? EMPTY);
  return useMemo(() => {
    const scored = list.filter((p) => p.status === 'scored');
    const pending = list.filter((p) => p.status === 'pending').sort((a, b) => a.targetT - b.targetT);
    return { all: list, latest: scored[0] ?? null, scored, pending };
  }, [list]);
}

export function countdown(now: Ms, target: Ms) {
  const m = Math.max(0, Math.round((target - now) / 60000));
  return m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m} min`;
}

/** Mean absolute checkpoint error in minutes, over checkpoints that have one. */
export function meanAbsError(p: PredictionCheck) {
  const e = p.checkpoints.map((c) => c.errorMin).filter((v): v is number => v != null);
  return e.length ? e.reduce((s, v) => s + Math.abs(v), 0) / e.length : null;
}

export function cardProps(p: PredictionCheck, pack: ScenarioPack | null, now: Ms): PredictionCheckCardProps {
  const tz = packTz(pack);
  const area = areaUnit(pack);
  const fromHa = (ha: number) => (area.unit === 'HA' ? ha : ha / 0.40468564);
  const when = (t: Ms) => `${localDay(t, tz)} ${localTime(t, tz)}`;
  return {
    status: p.status,
    horizonMin: p.horizonMin,
    issued: `${localTime(p.issuedAt, tz)} ${tz}`,
    target: `${localTime(p.targetT, tz)} ${tz}`,
    countdown: p.status === 'pending' ? countdown(now, p.targetT) : undefined,
    iou: p.iou,
    areaPred: fromHa(p.areaPredHa),
    areaActual: p.areaActualHa != null ? fromHa(p.areaActualHa) : undefined,
    areaUnit: area.unit,
    method: p.method,
    checkpoints: p.checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      documented: when(c.documentedT),
      predicted: c.predictedT != null ? when(c.predictedT) : undefined,
      errorMin: c.errorMin,
      uncertaintyMin: pack?.checkpoints?.find((k) => k.id === c.id)?.uncertaintyMin,
    })),
  };
}

/** Small cell for the stage metric strip; opens the Prediction drawer. */
export function PredictionMetric() {
  const ui = useUi();
  const now = useConsoleSelector((s) => Math.floor(s.clock.t / 60000) * 60000);
  const { latest, pending } = usePredictions();
  const next = pending[0];
  if (!latest && !next) return null;
  const err = latest ? meanAbsError(latest) : null;
  return (
    <button
      type="button"
      onClick={() => ui.togglePanel('checks')}
      title="Prediction vs replay · open the check"
      className="flex min-w-[112px] flex-col gap-1 bg-ink-950/85 px-3 py-2 text-left transition-colors duration-quick ease-servo hover:bg-ink-900 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
    >
      <span className="whitespace-nowrap font-mono text-micro uppercase text-bone-mute">Prediction check</span>
      {latest && latest.iou != null ? (
        <span className="flex items-baseline gap-1">
          <span className={cn('font-mono text-lg leading-none fcc-num', latest.iou >= 0.6 ? 'text-phosphor' : latest.iou >= 0.35 ? 'text-amber' : 'text-ember')}>
            {Math.round(latest.iou * 100)}
          </span>
          <span className="font-mono text-micro uppercase text-bone-mute">% IoU</span>
        </span>
      ) : (
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-lg leading-none text-ice fcc-num">{next ? countdown(now, next.targetT) : '—'}</span>
        </span>
      )}
      <span className="whitespace-nowrap font-mono text-micro uppercase text-ink-400">
        {latest ? (err != null ? `Mean error ${Math.round(err)} min` : `+${latest.horizonMin} min run`) : 'Until first score'}
      </span>
    </button>
  );
}

/** Drawer body: latest scored check, pending countdowns, history. */
export function PredictionPanel() {
  const pack = useConsoleSelector((s) => s.pack);
  const now = useConsoleSelector((s) => Math.floor(s.clock.t / 30000) * 30000);
  const { latest, pending, scored } = usePredictions();
  const tz = packTz(pack);
  const checkpoints = pack?.checkpoints ?? [];
  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-xs leading-5 text-bone-dim">
        The model starts from the reconstructed fire at issue time and uses archived future hourly weather as a perfect-forecast assumption.
        It does not use future fire arrivals. Area overlap (IoU) compares the prediction with the replay reconstruction, not an independently
        observed fire front. Checkpoint timing errors compare model arrivals within 200 m with sourced historical moments.
        These checks do not evaluate the final observed perimeter. This is not an operational forecast.
      </p>
      {latest ? (
        <PredictionCheckCard {...cardProps(latest, pack, now)} />
      ) : (
        <div className="border border-dashed border-line-strong px-3 py-4 font-mono text-micro uppercase leading-4 text-bone-mute">
          No projection has reached its scoring time yet.
        </div>
      )}
      {pending.length > 0 && (
        <div className="flex flex-col">
          <span className="fcc-micro mb-1.5">Pending · scores when the clock reaches the horizon</span>
          {pending.slice(0, 6).map((p) => (
            <div key={p.id} className="flex h-8 items-center gap-3 border-b border-line-faint">
              <span className="h-1.5 w-1.5 bg-ice" aria-hidden />
              <span className="font-mono text-micro uppercase text-bone fcc-num">+{p.horizonMin} min run</span>
              <span className="font-mono text-micro uppercase text-bone-mute fcc-num">
                Issued {localTime(p.issuedAt, tz)} · scores {localTime(p.targetT, tz)} {tz}
              </span>
              <span className="ml-auto font-mono text-micro uppercase text-ice fcc-num">{countdown(now, p.targetT)}</span>
            </div>
          ))}
        </div>
      )}
      {scored.length > 1 && (
        <div className="flex flex-col">
          <span className="fcc-micro mb-1.5">Earlier checks</span>
          {scored.slice(1, 12).map((p) => {
            const e = meanAbsError(p);
            return (
              <div key={p.id} className="flex h-8 items-center gap-3 border-b border-line-faint font-mono text-micro uppercase fcc-num">
                <span className="w-24 text-bone-mute">
                  {localTime(p.issuedAt, tz)} +{p.horizonMin}M
                </span>
                <span className="text-bone">{p.iou != null ? `${Math.round(p.iou * 100)} % IoU` : '—'}</span>
                <span className="ml-auto text-bone-mute">{e != null ? `Mean error ${Math.round(e)} min` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      {checkpoints.length > 0 && (
        <div className="flex flex-col">
          <span className="mb-1.5 flex items-center gap-2">
            <span className="fcc-micro">Documented moments</span>
            <ProvenanceTag kind="real" label="Real · sourced" />
          </span>
          {checkpoints.map((c) => (
            <a
              key={c.id}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className={cn('group flex flex-col gap-0.5 border-b border-line-faint py-1.5 transition-colors duration-quick ease-servo hover:bg-ink-850', c.t > now && 'opacity-70')}
            >
              <span className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 font-mono text-micro uppercase text-bone fcc-num">
                  {localTime(c.t, tz)} {tz}
                  {c.uncertaintyMin ? ` ±${c.uncertaintyMin}` : ''}
                </span>
                <span className="min-w-0 flex-1 text-xs text-bone">{c.label}</span>
              </span>
              <span className="pl-[104px] font-mono text-micro uppercase text-bone-mute group-hover:text-bone-dim">{c.source}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
