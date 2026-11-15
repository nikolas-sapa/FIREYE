import { useMemo, useState } from 'react';
import {
  FeedTile, Icon, Legend, PoolBar, ScoreMeter, Segmented, Select, TierBadge, Toggle, UnitChip, alertClassIcon, alertClassLabel, alertTone, cn, color, role, toneClass,
} from '@ds';
import { CameraView } from '@/dashboard/map';
import type { AlertClass, AnalysisJob, CameraFeed, MapLayers, SimSnapshotB, Unit, UnitKind } from '@/sim/types';
import {
  UNIT_ORDER, ageLabel, sourceIcon, unitGroupLabel, zuluAt,
} from './format';
import type { ConsoleActions, MapMode } from './types';
import { MiniBar, SectionLabel, SweepBar } from './ui';

/* --------------------------------- Forces --------------------------------- */

function resourceOf(u: Unit): { label: string; value: number } | null {
  if (typeof u.battery === 'number') return { label: 'BAT', value: u.battery };
  if (typeof u.water === 'number') return { label: 'H2O', value: u.water };
  return null;
}

export function ForcesDrawer({ state, selectedId, actions }: { state: SimSnapshotB; selectedId: string | null; actions: ConsoleActions }) {
  const units = state.units;
  const groups = useMemo(() => {
    const by = new Map<UnitKind, Unit[]>();
    for (const u of units) {
      const list = by.get(u.kind);
      if (list) list.push(u);
      else by.set(u.kind, [u]);
    }
    return UNIT_ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, units: by.get(k)! }));
    // The engine mutates units in place; membership only changes with length.
  }, [units, units.length]);
  const feedByUnit = useMemo(() => new Map(state.feeds.filter((f) => f.unitId).map((f) => [f.unitId!, f])), [state.feeds]);

  return (
    <div className="flex flex-col gap-4 p-3">
      {groups.map((g) => {
        const committed = g.units.filter((u) => u.status === 'active' || u.status === 'enroute').length;
        return (
          <div key={g.kind}>
            <SectionLabel meta={`${committed}/${g.units.length}`}>{unitGroupLabel[g.kind]}</SectionLabel>
            <ul className="mt-2 flex flex-col gap-1">
              {g.units.map((u) => {
                const res = resourceOf(u);
                const low = res ? res.value < 0.25 : false;
                const feed = feedByUnit.get(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-2">
                    <UnitChip
                      className="min-w-0 flex-1"
                      callsign={u.callsign}
                      kind={u.kind}
                      status={u.status}
                      selected={selectedId === u.id}
                      meta={feed ? <Icon name="camera" size={12} className="text-bone-mute" /> : undefined}
                      onClick={() => {
                        actions.select(u.id);
                        actions.flyTo(u.pos, 2.4);
                        if (feed) actions.openFeed(feed.id);
                      }}
                    />
                    <div className="flex w-14 shrink-0 flex-col items-end gap-1">
                      {res ? (
                        <>
                          <span className={cn('font-mono text-micro leading-none fcc-num', low ? 'text-ember' : 'text-bone-mute')}>
                            {res.label} {Math.round(res.value * 100)}
                          </span>
                          <MiniBar value={res.value} segments={8} tone={low ? 'danger' : u.kind === 'drone' ? 'telemetry' : 'neutral'} />
                        </>
                      ) : (
                        <span className="font-mono text-micro leading-none text-ink-500">N/A</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- Feeds --------------------------------- */

function FeedGrid({ feeds, activeId, onOpen }: { feeds: CameraFeed[]; activeId: string | null; onOpen(f: CameraFeed): void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {feeds.map((f) => (
        <FeedTile
          key={f.id}
          label={f.label}
          live={f.live}
          selected={activeId === f.id}
          meta={f.detections > 0 ? <span className="text-violet fcc-num">{f.detections} DET</span> : undefined}
          onClick={() => onOpen(f)}
        >
          <CameraView feedId={f.id} variant="thumb" />
        </FeedTile>
      ))}
    </div>
  );
}

export function FeedsDrawer({ state, activeFeedId, actions }: { state: SimSnapshotB; activeFeedId: string | null; actions: ConsoleActions }) {
  const live = state.feeds.filter((f) => f.live);
  const approx = state.feeds.filter((f) => !f.live);
  const open = (f: CameraFeed) => {
    actions.openFeed(f.id);
    actions.flyTo(f.pos, 2.2);
  };
  return (
    <div className="flex flex-col gap-5 p-3">
      <div>
        <SectionLabel meta={String(live.length).padStart(2, '0')}>Live · vehicle and drone</SectionLabel>
        <FeedGrid feeds={live} activeId={activeFeedId} onOpen={open} />
      </div>
      {approx.length > 0 && (
        <div>
          <SectionLabel meta={String(approx.length).padStart(2, '0')}>Approximate · social and satellite</SectionLabel>
          <p className="mt-1.5 text-xs text-bone-mute">Location is inferred and decays with age. Confirm with a live asset before acting.</p>
          <FeedGrid feeds={approx} activeId={activeFeedId} onOpen={open} />
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Agents --------------------------------- */

const JOB_STATUS: Record<AnalysisJob['status'], string> = { queued: 'Queued', running: 'Running', done: 'Done' };

function FlowHeader({ state }: { state: SimSnapshotB }) {
  const analysis = state.pools.filter((p) => p.role === 'analysis');
  const orch = state.pools.filter((p) => p.role === 'orchestrator');
  const sources = new Set(analysis.map((p) => p.source).filter(Boolean)).size;
  const sum = (ps: typeof analysis) => ps.reduce((n, p) => n + p.workers, 0);
  const steps = [
    { k: 'Input', v: `${sources} SRC` },
    { k: 'Analysis', v: `${sum(analysis)} W` },
    { k: 'Projection', v: `REV ${String(state.forecastRev).padStart(2, '0')}` },
    { k: 'Orchestrator', v: `${sum(orch) || 1} W` },
  ];
  return (
    <ol className="grid grid-cols-4 gap-px border border-line bg-line">
      {steps.map((s, i) => (
        <li key={s.k} className="relative bg-ink-900 px-2 py-2">
          <div className="flex items-center gap-1 fcc-micro">
            <span className="truncate">{s.k}</span>
          </div>
          <div className="mt-1 font-mono text-tiny text-bone fcc-num">{s.v}</div>
          {i < steps.length - 1 && (
            <Icon name="chevron-right" size={10} className="absolute -right-[6px] top-1/2 z-raised -translate-y-1/2 bg-ink-900 text-bone-mute" />
          )}
        </li>
      ))}
    </ol>
  );
}

function JobRow({ job, t }: { job: AnalysisJob; t: number }) {
  const running = job.status === 'running';
  const queued = job.status === 'queued';
  const elapsed = running && job.startedAt != null ? t - job.startedAt : job.durationS;
  return (
    <li className={cn('relative flex items-start gap-2.5 py-2', queued && 'opacity-60')}>
      <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center border border-line', running ? 'text-ice' : 'text-bone-mute')}>
        <Icon name={sourceIcon[job.source]} size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-bone">{job.input}</div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-micro uppercase text-bone-mute">
          <span className="shrink-0 text-bone-dim">{job.agent}</span>
          <span className="text-ink-500">·</span>
          <span className="truncate">{running && job.stage ? job.stage : job.model}</span>
        </div>
      </div>
      <div className="flex w-16 shrink-0 flex-col items-end gap-0.5 font-mono text-micro uppercase fcc-num">
        <span className={cn(running ? 'text-ice' : queued ? 'text-ink-400' : job.findings > 0 ? 'text-phosphor' : 'text-bone-mute')}>
          {job.status === 'done' && job.findings > 0 ? `${job.findings} FIND` : JOB_STATUS[job.status]}
        </span>
        <span className="text-ink-400">{queued ? `${ageLabel(t - job.queuedAt)}` : `${elapsed.toFixed(1)}S`}</span>
      </div>
      {running &&
        (job.progress != null ? (
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line">
            <span className="block h-full bg-ice transition-[width] duration-base ease-servo" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </span>
        ) : (
          <SweepBar className="absolute inset-x-0 bottom-0" />
        ))}
    </li>
  );
}

export function AgentsDrawer({ state }: { state: SimSnapshotB }) {
  const pools = state.pools;
  const workers = pools.reduce((n, p) => n + p.workers, 0);
  const max = pools.reduce((n, p) => n + p.maxWorkers, 0);
  const perMin = pools.reduce((n, p) => n + p.throughputPerMin, 0);
  const lat = [...pools.map((p) => p.p50LatencyS)].sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const queue = pools.reduce((n, p) => n + p.queue, 0);
  const jobs = state.jobs.slice(0, 16);

  return (
    <div className="flex flex-col gap-4 p-3">
      <FlowHeader state={state} />
      <dl className="grid grid-cols-4 gap-px border border-line bg-line">
        {[
          { k: 'Sandboxes', v: `${workers}`, u: `/${max}` },
          { k: 'Jobs/min', v: perMin.toFixed(0) },
          { k: 'P50', v: p50.toFixed(1), u: 'S' },
          { k: 'Queue', v: `${queue}` },
        ].map((d) => (
          <div key={d.k} className="bg-ink-900 px-2 py-2">
            <dt className="fcc-micro truncate">{d.k}</dt>
            <dd className="mt-1 font-mono text-sm text-bone fcc-num">
              {d.v}
              {d.u && <span className="ml-0.5 text-micro text-bone-mute">{d.u}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <SectionLabel meta="boxd · autoscale">Pools</SectionLabel>
        <div className="mt-2 flex flex-col gap-1.5">
          {pools.map((p) => (
            <PoolBar
              key={p.id}
              label={p.label}
              provider={p.provider}
              workers={p.workers}
              maxWorkers={p.maxWorkers}
              queue={p.queue}
              meta={
                <span className="flex items-center gap-2 fcc-num">
                  <span className="min-w-0 truncate">{p.model}</span>
                  <span className="ml-auto shrink-0">{p.throughputPerMin.toFixed(0)}/MIN · P50 {p.p50LatencyS.toFixed(1)}S</span>
                  {p.booting ? <span className="shrink-0 text-ice">+{p.booting} booting</span> : null}
                  {p.scaling && p.scaling !== 'steady' && <span className={cn('shrink-0', p.scaling === 'up' ? 'text-ice' : 'text-bone-mute')}>Scale {p.scaling}</span>}
                </span>
              }
            />
          ))}
        </div>
      </div>
      <div>
        <SectionLabel meta={`${state.jobs.filter((j) => j.status === 'running').length} running`}>Job stream</SectionLabel>
        <ul className="mt-1 divide-y divide-line" aria-live="off">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} t={state.t} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/* --------------------------------- Layers --------------------------------- */

type LayerKey = keyof MapLayers;
const LAYER_DEFS: { key: LayerKey; label: string; group: 'Fire' | 'Intel' | 'Base' }[] = [
  { key: 'fire', label: 'Fire front', group: 'Fire' },
  { key: 'forecast', label: 'Projected path', group: 'Fire' },
  { key: 'movements', label: 'Movement routes', group: 'Fire' },
  { key: 'observations', label: 'Observations', group: 'Intel' },
  { key: 'markers', label: 'Points of interest', group: 'Intel' },
  { key: 'units', label: 'Forces', group: 'Intel' },
  { key: 'coverage', label: 'Drone coverage grid', group: 'Intel' },
  { key: 'terrain', label: 'Terrain', group: 'Base' },
  { key: 'contours', label: 'Contours', group: 'Base' },
  { key: 'fuel', label: 'Fuel model', group: 'Base' },
  { key: 'grid', label: 'Reference grid', group: 'Base' },
];

const LEGEND = [
  { label: 'Fire front', color: role.fireFront, shape: 'line' as const },
  { label: 'Projection', color: role.fireForecast, shape: 'dash' as const },
  { label: 'Burn scar', color: role.burnScar, shape: 'square' as const },
  { label: 'UAS', color: role.drone, shape: 'dot' as const },
  { label: 'Ground', color: role.crew, shape: 'dot' as const },
  { label: 'Life', color: role.detection, shape: 'dot' as const },
  { label: 'Combustible', color: role.danger, shape: 'square' as const },
  { label: 'Movement', color: color.signal.DEFAULT, shape: 'dash' as const },
];

export function LayersDrawer({
  layers,
  onLayers,
  mode,
  onMode,
}: {
  layers: MapLayers;
  onLayers(l: MapLayers): void;
  mode: MapMode;
  onMode(m: MapMode): void;
}) {
  const groups = ['Fire', 'Intel', 'Base'] as const;
  return (
    <div className="flex flex-col gap-5 p-3">
      <div>
        <SectionLabel>Projection</SectionLabel>
        <Segmented
          className="mt-2"
          size="sm"
          aria-label="Map projection"
          options={[
            { value: 'ortho', label: 'Ortho' },
            { value: 'oblique', label: 'Oblique' },
          ]}
          value={mode}
          onChange={(v) => onMode(v as MapMode)}
        />
      </div>
      {groups.map((g) => (
        <div key={g}>
          <SectionLabel>{g}</SectionLabel>
          <ul className="mt-2 flex flex-col">
            {LAYER_DEFS.filter((d) => d.group === g).map((d) => (
              <li key={d.key} className="flex h-8 items-center">
                <Toggle size="sm" checked={layers[d.key] !== false} onChange={(v) => onLayers({ ...layers, [d.key]: v })} label={d.label} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div>
        <SectionLabel>Legend</SectionLabel>
        <Legend className="mt-2.5" direction="column" items={LEGEND} />
        <p className="mt-3 text-xs text-bone-mute">
          Rings show approximate location. They fade as the source ages; solid glyphs are confirmed by a live feed.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------- Log ---------------------------------- */

const TIER_OPTS = [
  { value: 'all', label: 'All' },
  { value: '0', label: 'T0' },
  { value: '1', label: 'T1' },
  { value: '2', label: 'T2' },
  { value: '3', label: 'T3' },
];
const CLASS_OPTS = [{ value: 'all', label: 'All classes' }, ...(Object.keys(alertClassLabel) as AlertClass[]).map((c) => ({ value: c, label: alertClassLabel[c] }))];

export function LogDrawer({ state, highlightId, actions }: { state: SimSnapshotB; highlightId: string | null; actions: ConsoleActions }) {
  const [tier, setTier] = useState('all');
  const [cls, setCls] = useState('all');
  const rows = state.alerts.filter((a) => (tier === 'all' || String(a.tier) === tier) && (cls === 'all' || a.cls === cls));
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-raised flex items-end gap-2 border-b border-line bg-ink-900 p-3">
        <Segmented size="sm" aria-label="Filter by tier" options={TIER_OPTS} value={tier} onChange={setTier} />
        <Select className="min-w-0 flex-1 [&_select]:h-7" options={CLASS_OPTS} value={cls} onChange={setCls} />
      </div>
      {rows.length === 0 && <p className="px-3 py-6 fcc-micro">No entries match</p>}
      <ul className="divide-y divide-line">
        {rows.map((a) => {
          const tone = alertTone(a.cls, a.tier);
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => actions.focusAlert(a.id)}
                className={cn(
                  'relative flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors duration-quick ease-servo hover:bg-ink-850',
                  highlightId === a.id && 'bg-ink-850',
                  a.ack && 'opacity-60',
                )}
              >
                {highlightId === a.id && <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-signal" />}
                <div className="flex items-center gap-2">
                  <TierBadge tier={a.tier} />
                  <Icon name={alertClassIcon[a.cls]} size={12} className={toneClass[tone].text} />
                  <span className="ml-auto font-mono text-micro text-bone-mute fcc-num">{zuluAt(state.clock, state.t, a.at)}</span>
                </div>
                <div className="truncate text-sm text-bone">{a.title}</div>
                <div className="flex items-center gap-3">
                  <ScoreMeter score={a.score} size="sm" showValue className="w-28" />
                  <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase text-bone-mute">{a.why}</span>
                  {a.ack ? (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-micro uppercase text-phosphor">
                      <Icon name="check" size={10} />
                      Ack
                    </span>
                  ) : (
                    a.notify.length > 0 && (
                      <span className="shrink-0 font-mono text-micro uppercase text-ink-400">{a.notify.join(' · ')}</span>
                    )
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
