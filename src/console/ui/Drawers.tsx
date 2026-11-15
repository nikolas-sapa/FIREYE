import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button, DraftDocument, Drawer, Icon, LedgerCounter, Legend, LogLine, PoolBar, ProvenanceTag, Segmented, Tabs, ZoneTag, actionKindIcon, alertClassIcon,
  alertTone, cn, toneClass, zoneMeta, type Tone,
} from '@ds';
import type { Action, AgentPool, BusEvent, GradedItem, Zone } from '../contracts';
import { bus, useConsoleApi, useConsoleSelector } from '../store';
import { poolIcon } from './LeftRail';
import { stageLegend } from './StageArea';
import { ago, fmtDuration, fmtInt, localDay, localTime, packTz, tierOfZone, zuluTime } from './format';
import { PredictionPanel, usePredictions } from './Prediction';
import { useUi } from './UiContext';

/* -------------------------------- Agent Ops -------------------------------- */

function Packet({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="relative h-px w-full overflow-hidden bg-line-strong">
      {active && (
        <span className="absolute inset-0 animate-sweep">
          <span className="absolute left-1/2 top-0 h-px w-1.5 bg-ice" />
        </span>
      )}
    </span>
  );
}

function StageBox({ title, children, tone = 'neutral' }: { title: string; children: ReactNode; tone?: Tone }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 border bg-ink-950 p-2', tone === 'neutral' ? 'border-line' : toneClass[tone].border)}>
      <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">{title}</span>
      {children}
    </div>
  );
}

function Pipeline({ pools }: { pools: AgentPool[] }) {
  const items = useConsoleSelector((s) => s.items);
  const projection = useConsoleSelector((s) => s.projection);
  const directives = useConsoleSelector((s) => s.directives.length);
  const analysis = pools.filter((p) => p.role === 'analysis' || p.role === 'ingest');
  const proj = pools.filter((p) => p.role === 'projection');
  const orch = pools.filter((p) => p.role === 'orchestrator');
  const sources = useMemo(() => {
    const m = new Map<string, { icon: ReturnType<typeof poolIcon>; providers: Set<string>; busy: boolean }>();
    for (const p of analysis) {
      const k = p.source ?? p.role;
      const e = m.get(k) ?? { icon: poolIcon(p), providers: new Set<string>(), busy: false };
      e.providers.add(p.provider);
      e.busy ||= p.workers > 0;
      m.set(k, e);
    }
    return [...m.entries()];
  }, [analysis]);
  const zc = (z: Zone) => items.filter((i) => i.zone === z && !i.dismissed).length;
  const busy = (ps: AgentPool[]) => ps.some((p) => p.workers > 0);
  return (
    <div className="grid grid-cols-[1fr_14px_1.25fr_14px_0.9fr_14px_1fr] items-center">
      <StageBox title="Sources">
        {sources.map(([k, s]) => (
          <span key={k} className="flex items-center gap-1.5 font-mono text-micro uppercase text-bone-dim">
            <Icon name={s.icon} size={11} className={s.busy ? 'text-ice' : 'text-ink-500'} />
            <span className="truncate">{k}</span>
          </span>
        ))}
      </StageBox>
      <Packet active={busy(analysis)} />
      <StageBox title="Analysis" tone="telemetry">
        {analysis.slice(0, 7).map((p) => (
          <span key={p.id} className="flex items-center justify-between gap-2 font-mono text-micro uppercase text-bone-dim">
            <span className="truncate">{p.label}</span>
            <span className="shrink-0 text-ice fcc-num">{String(p.workers).padStart(2, '0')}</span>
          </span>
        ))}
      </StageBox>
      <Packet active={busy(proj)} />
      <StageBox title="Projection" tone="warning">
        <span className="font-mono text-tiny text-amber fcc-num">REV {projection?.rev ?? 0}</span>
        <span className="font-mono text-micro uppercase text-bone-mute fcc-num">ROS {projection ? projection.rosMpm.toFixed(1) : '—'} M/MIN</span>
        <span className="truncate font-mono text-micro uppercase text-bone-mute">{proj[0]?.model ?? 'treq · reasoning'}</span>
      </StageBox>
      <Packet active={busy(orch) || items.length > 0} />
      <StageBox title="Orchestrator">
        <span className="font-mono text-tiny text-bone fcc-num">{items.length} graded</span>
        <span className="flex flex-wrap gap-x-2 font-mono text-micro uppercase text-bone-mute fcc-num">
          <span>Z0 {zc('Z0_INTERRUPT')}</span>
          <span>Z2 {zc('Z2_DECISION')}</span>
          <span>Z3 {zc('Z3_FOCUS')}</span>
          <span>Z4 {zc('Z4_AMBIENT')}</span>
        </span>
        <span className="font-mono text-micro uppercase text-bone-mute fcc-num">{directives} directives</span>
      </StageBox>
    </div>
  );
}

function AgentOps() {
  const pools = useConsoleSelector((s) => s.pools);
  const jobs = useConsoleSelector((s) => s.jobs);
  const workers = pools.reduce((n, p) => n + p.workers, 0);
  const max = pools.reduce((n, p) => n + p.maxWorkers, 0);
  const queue = pools.reduce((n, p) => n + p.queue, 0);
  const thr = pools.reduce((n, p) => n + p.throughputPerMin, 0);
  const p50 = pools.length ? pools.reduce((n, p) => n + p.p50LatencyS, 0) / pools.length : 0;
  const groups: { role: AgentPool['role']; label: string }[] = [
    { role: 'ingest', label: 'Ingest' },
    { role: 'analysis', label: 'Analysis' },
    { role: 'projection', label: 'Projection' },
    { role: 'orchestrator', label: 'Orchestrator' },
  ];
  return (
    <div className="flex flex-col gap-5 p-3">
      <div className="grid grid-cols-4 gap-px border border-line bg-line">
        <LedgerCounter label="Workers" value={workers} sub={`of ${max} slots`} className="bg-ink-900 p-2.5" />
        <LedgerCounter label="Queue" value={queue} tone={queue > 0 ? 'warning' : 'neutral'} className="bg-ink-900 p-2.5" />
        <LedgerCounter label="Throughput" value={thr} unit="/MIN" className="bg-ink-900 p-2.5" />
        <LedgerCounter label="p50 latency" value={p50} format={(v) => v.toFixed(1)} unit="S" className="bg-ink-900 p-2.5" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="fcc-micro">Pipeline · sources → analysis → projection → orchestrator</span>
        <Pipeline pools={pools} />
      </div>
      {groups.map((g) => {
        const ps = pools.filter((p) => p.role === g.role);
        if (ps.length === 0) return null;
        return (
          <div key={g.role} className="flex flex-col gap-3">
            <span className="fcc-micro">{g.label} pools · boxd sandboxes</span>
            {ps.map((p) => (
              <PoolBar
                key={p.id}
                label={p.label}
                provider={p.provider}
                workers={p.workers}
                maxWorkers={p.maxWorkers}
                queue={p.queue}
                meta={`${p.model} · ${Math.round(p.throughputPerMin)}/min · p50 ${p.p50LatencyS.toFixed(1)} s`}
              />
            ))}
          </div>
        );
      })}
      <div className="flex flex-col">
        <span className="fcc-micro mb-2">Job stream · newest first</span>
        <div className="flex flex-col border-t border-line">
          {jobs.slice(0, 40).map((j) => {
            const lat = j.finishedAt && j.startedAt ? (j.finishedAt - j.startedAt) / 1000 : null;
            return (
              <div key={j.id} className="grid grid-cols-[10px_64px_1fr_auto] items-center gap-2 border-b border-line-faint py-1.5">
                <span
                  aria-label={j.status}
                  className={cn('h-1.5 w-1.5', j.status === 'running' ? 'animate-blink bg-ice' : j.status === 'done' ? 'bg-phosphor' : 'bg-ink-500')}
                />
                <span className="truncate font-mono text-micro uppercase text-bone">{j.agent}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs text-bone-dim">{j.input}</span>
                  <span className="truncate font-mono text-micro text-bone-mute">
                    {j.model} · {j.provider}
                  </span>
                </span>
                <span className="text-right font-mono text-micro uppercase text-bone-mute fcc-num">
                  {j.status === 'done' ? `${lat != null ? lat.toFixed(1) + ' s' : 'done'}${j.findingIds.length ? ` · ${j.findingIds.length} F` : ''}` : j.status}
                </span>
              </div>
            );
          })}
          {jobs.length === 0 && <span className="py-3 font-mono text-micro uppercase text-bone-mute">No jobs yet</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Drafts --------------------------------- */

function DraftEditor({ a }: { a: Action }) {
  const api = useConsoleApi();
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 5000) * 5000);
  const units = useConsoleSelector((s) => s.units);
  const [body, setBody] = useState(a.draft?.body ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setBody(a.draft?.body ?? '');
  }, [a.draft?.body, dirty]);
  if (!a.draft) return null;
  const commit = () => {
    if (dirty) api.editDraft(a.id, body);
    setDirty(false);
  };
  const proposed = a.status === 'proposed';
  return (
    <div className="flex flex-col gap-2">
      <DraftDocument
        format={a.draft.format}
        title={a.draft.title}
        fields={[
          ...a.draft.fields,
          ...(a.unitIds.length ? [{ label: 'Units', value: a.unitIds.map((id) => units.find((u) => u.id === id)?.callsign ?? id).join(' · ') }] : []),
        ]}
        body={body}
        editable={proposed}
        onChange={(v) => {
          setBody(v);
          setDirty(true);
        }}
        serial={a.id.toUpperCase()}
        status={<span className={cn('font-mono text-micro uppercase', proposed ? 'text-amber' : 'text-phosphor')}>{a.status}</span>}
        meta={`Orchestrator drafted · ${ago(t, a.proposedAt)} · ${a.risk} risk${dirty ? ' · unsaved edits' : ''}`}
      />
      {proposed && (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => api.reject(a.id)}>
            Reject
          </Button>
          <Button size="sm" variant="secondary" disabled={!dirty} onClick={commit}>
            Save edits
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="check"
            className="ml-auto"
            onClick={() => {
              commit();
              api.approve(a.id);
            }}
          >
            Approve and send
          </Button>
        </div>
      )}
    </div>
  );
}

function Drafts() {
  const ui = useUi();
  const actions = useConsoleSelector((s) => s.actions);
  const drafts = useMemo(() => actions.filter((a) => a.draft), [actions]);
  const sel = drafts.find((a) => a.id === ui.draftId) ?? drafts.find((a) => a.status === 'proposed') ?? drafts[0];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col border-t border-line">
        {drafts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => ui.openDraft(a.id)}
            className={cn(
              'relative flex h-9 items-center gap-2 border-b border-line-faint px-2 text-left transition-colors duration-quick ease-servo hover:bg-ink-850',
              sel?.id === a.id && 'bg-ink-850',
            )}
          >
            {sel?.id === a.id && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-bone" />}
            <Icon name={actionKindIcon[a.kind]} size={13} className={a.status === 'proposed' ? 'text-amber' : 'text-bone-mute'} />
            <span className="min-w-0 flex-1 truncate text-sm text-bone">{a.draft?.title ?? a.title}</span>
            <span className={cn('font-mono text-micro uppercase', a.status === 'proposed' ? 'text-amber' : 'text-bone-mute')}>{a.status}</span>
          </button>
        ))}
        {drafts.length === 0 && <span className="py-3 font-mono text-micro uppercase text-bone-mute">The Orchestrator has not drafted anything yet.</span>}
      </div>
      {sel && <DraftEditor key={sel.id} a={sel} />}
    </div>
  );
}

/* ---------------------------------- Ledger --------------------------------- */

function LedgerList() {
  const l = useConsoleSelector((s) => s.ledger);
  const cells: { label: string; value: number; format?: (v: number) => string; unit?: string; tone?: Tone }[] = [
    { label: 'Footage reviewed', value: l.footageReviewedS, format: fmtDuration },
    { label: 'Images analyzed', value: l.imagesAnalyzed },
    { label: 'Articles read', value: l.articlesRead },
    { label: 'Posts screened', value: l.postsScreened },
    { label: 'Satellite passes', value: l.satellitePasses },
    { label: 'Radio transcribed', value: l.radioMinutesTranscribed, unit: 'MIN' },
    { label: 'Projections run', value: l.projectionsRun },
    { label: 'Drone tasks', value: l.droneTasksIssued },
    { label: 'Drafts written', value: l.draftsWritten },
    { label: 'Notifications', value: l.notificationsRelayed },
  ];
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-end justify-between border border-line bg-ink-950 p-3">
        <LedgerCounter size="lg" label="Analyst hours saved" value={l.analystMinutesSaved / 60} format={(v) => v.toFixed(1)} tone="nominal" />
        <span className="max-w-[160px] text-right font-mono text-micro uppercase leading-4 text-bone-mute">Human-equivalent minutes minus agent time</span>
      </div>
      <div className="grid grid-cols-2 gap-px border border-line bg-line">
        {cells.map((c) => (
          <LedgerCounter key={c.label} label={c.label} value={c.value} format={c.format} unit={c.unit} className="bg-ink-900 p-2.5" />
        ))}
      </div>
      <div className="flex flex-col">
        <span className="fcc-micro mb-2">Useful work · newest first</span>
        {l.entries.slice(0, 60).map((e) => (
          <div key={e.id} className="grid grid-cols-[52px_72px_1fr_auto] items-start gap-2 border-b border-line-faint py-1.5">
            <span className="font-mono text-micro text-bone-mute fcc-num">{zuluTime(e.at, false)}</span>
            <span className="truncate font-mono text-micro uppercase text-ice">{e.agent}</span>
            <span className="text-xs leading-4 text-bone-dim">{e.text}</span>
            <span className="font-mono text-micro text-phosphor fcc-num">+{e.minutesSaved.toFixed(0)}m</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------ Log ---------------------------------- */

const zoneOpts = [{ value: 'all', label: 'All' }, ...(['Z0_INTERRUPT', 'Z2_DECISION', 'Z3_FOCUS', 'Z4_AMBIENT', 'Z5_LEDGER'] as Zone[]).map((z) => ({ value: z, label: zoneMeta[z].code }))];
const clsOpts = [{ value: 'all', label: 'All' }, ...(['life', 'hazard', 'fuel', 'movement', 'projection', 'status'] as const).map((c) => ({ value: c, label: c.slice(0, 4) }))];

const busTone: Record<BusEvent['type'], Tone> = {
  'prediction.scored': 'telemetry', 'sensor.reading': 'telemetry', 'sensor.triggered': 'warning',
  'source.ingested': 'neutral', 'analysis.job': 'telemetry', 'analysis.finding': 'detection', 'projection.updated': 'warning', 'orchestrator.graded': 'neutral',
  'ui.directive': 'telemetry', 'action.proposed': 'warning', 'action.decided': 'nominal', 'brief.updated': 'neutral', message: 'telemetry', 'ledger.entry': 'nominal',
};

function busText(e: BusEvent): string {
  switch (e.type) {
    case 'source.ingested':
      return `${e.source.kind} · ${e.source.title}`;
    case 'analysis.job':
      return `${e.job.agent} ${e.job.status} · ${e.job.input}`;
    case 'analysis.finding':
      return `${e.finding.label} · conf ${e.finding.confidence.toFixed(2)}`;
    case 'projection.updated':
      return `Rev ${e.projection.rev} · head ${Math.round(e.projection.headDirDeg)}° · ${e.projection.rosMpm.toFixed(1)} m/min`;
    case 'orchestrator.graded':
      return `${e.item.zone.slice(0, 2)} ${Math.round(e.item.score)} · ${e.item.title}`;
    case 'ui.directive':
      return `${e.directive.kind} · ${e.directive.reason}`;
    case 'action.proposed':
      return e.action.title;
    case 'action.decided':
      return `${e.actionId} → ${e.status} by ${e.by}`;
    case 'brief.updated':
      return e.brief.headline;
    case 'message':
      return `${e.message.role}: ${e.message.text}`;
    case 'ledger.entry':
      return `${e.entry.agent} · ${e.entry.text}`;
    case 'prediction.scored':
      return `${e.check.horizonMin} min projection · IoU ${e.check.iou == null ? 'unavailable' : `${Math.round(e.check.iou * 100)}%`}`;
    case 'sensor.reading':
      return `${e.reading.id} · ${e.reading.status}`;
    case 'sensor.triggered':
      return `${e.reading.id} · ${e.threshold}`;
  }
}

function LogItemRow({ it }: { it: GradedItem }) {
  const api = useConsoleApi();
  const tone = alertTone(it.cls, tierOfZone(it));
  return (
    <button
      type="button"
      onClick={() => {
        api.markSeen(it.id);
        if (it.pos) api.focus(it.pos, 2200);
      }}
      className={cn('flex w-full flex-col gap-1 border-b border-line-faint px-1 py-2 text-left transition-colors duration-quick ease-servo hover:bg-ink-850', it.dismissed && 'opacity-50')}
    >
      <span className="flex w-full items-center gap-2">
        <ZoneTag zone={it.zone} showName={false} />
        <Icon name={alertClassIcon[it.cls]} size={12} className={toneClass[tone].text} />
        <span className="min-w-0 flex-1 truncate text-sm text-bone">{it.title}</span>
        <span className="font-mono text-micro text-bone-dim fcc-num">{String(Math.round(it.score)).padStart(2, '0')}</span>
        <span className="font-mono text-micro text-bone-mute fcc-num">{zuluTime(it.updatedAt, false)}</span>
      </span>
      <span className="truncate pl-[46px] font-mono text-micro uppercase text-bone-mute">{it.reason}</span>
    </button>
  );
}

const reportKind: Record<string, string> = { news: 'News', official: 'Official alert', agency: 'Agency', social: 'Social post' };

function RealReports() {
  const pack = useConsoleSelector((s) => s.pack);
  const now = useConsoleSelector((s) => Math.floor(s.clock.t / 30000) * 30000);
  const tz = packTz(pack);
  const all = pack?.reports ?? [];
  const shown = useMemo(() => all.filter((r) => r.t <= now).sort((a, b) => b.t - a.t), [all, now]);
  const later = all.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 border border-line bg-ink-950 p-2">
        <ProvenanceTag kind="real" />
        <span className="font-mono text-micro uppercase leading-4 text-bone-mute">
          Published reports about the real fire, paraphrased with attribution, shown at their publication time. Everything else in the console is
          simulated.
        </span>
      </div>
      {all.length === 0 && <span className="py-3 font-mono text-micro uppercase text-bone-mute">This scenario pack has no real reports</span>}
      {all.length > 0 && shown.length === 0 && <span className="py-3 font-mono text-micro uppercase text-bone-mute">No reports published yet at this replay time</span>}
      <div className="flex flex-col border-t border-line">
        {shown.map((r) => (
          <article key={r.id} className="flex flex-col gap-1 border-b border-line-faint py-2">
            <span className="flex items-center gap-2">
              <span className="font-mono text-micro uppercase text-bone fcc-num">
                {localDay(r.t, tz)} {localTime(r.t, tz)} {tz}
              </span>
              <span className="font-mono text-micro uppercase text-bone-mute">{reportKind[r.kind] ?? r.kind}</span>
              <span className="min-w-0 flex-1 truncate text-right font-mono text-micro uppercase text-bone-dim">{r.publisher}</span>
            </span>
            <p className="text-xs leading-5 text-bone" lang={r.lang}>
              {r.summary}
            </p>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex w-fit items-center gap-1 font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Source
              <Icon name="arrow-up-right" size={10} />
            </a>
          </article>
        ))}
      </div>
      {later > 0 && <span className="font-mono text-micro uppercase text-bone-mute">{later} more later in the replay</span>}
    </div>
  );
}

function LogPanel() {
  const items = useConsoleSelector((s) => s.items);
  const reports = useConsoleSelector((s) => s.pack?.reports?.length ?? 0);
  useConsoleSelector((s) => Math.floor(s.clock.t / 20000));
  const [tab, setTab] = useState('items');
  const [zone, setZone] = useState('all');
  const [cls, setCls] = useState('all');
  const shown = useMemo(
    () => items.filter((i) => (zone === 'all' || i.zone === zone) && (cls === 'all' || i.cls === cls)).slice(0, 120),
    [items, zone, cls],
  );
  const events = tab === 'bus' ? bus.history().slice(-120).reverse() : [];
  return (
    <div className="flex flex-col gap-3 p-3">
      <Tabs
        size="sm"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'items', label: 'Graded items', count: items.length },
          { id: 'reports', label: 'Real reports', count: reports },
          { id: 'bus', label: 'Bus events' },
        ]}
      />
      {tab === 'reports' ? (
        <RealReports />
      ) : tab === 'items' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Segmented size="sm" aria-label="Filter by zone" options={zoneOpts} value={zone} onChange={setZone} />
            <Segmented size="sm" aria-label="Filter by class" options={clsOpts} value={cls} onChange={setCls} />
          </div>
          <div className="flex flex-col border-t border-line">
            {shown.map((it) => (
              <LogItemRow key={it.id} it={it} />
            ))}
            {shown.length === 0 && <span className="py-3 font-mono text-micro uppercase text-bone-mute">No items match</span>}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="fcc-micro">The same events a backend would publish · see docs/BACKEND_CONTRACT.md</span>
          {events.map((e, i) => (
            <LogLine key={`${e.type}-${e.at}-${i}`} time={zuluTime(e.at)} source={e.type} tone={busTone[e.type]}>
              {busText(e)}
            </LogLine>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Layers --------------------------------- */

function Layers() {
  const ui = useUi();
  const tokens = useConsoleSelector((s) => s.settings.tokens);
  const manifest = useConsoleSelector((s) => s.pack?.manifest);
  const rows = [
    { label: 'Google Photorealistic 3D Tiles', on: tokens.google, off: 'No VITE_GOOGLE_MAPS_KEY' },
    { label: 'Cesium World Terrain + ion imagery', on: tokens.cesium, off: 'No VITE_CESIUM_ION_TOKEN' },
    { label: 'Offline heightmap + imagery mosaic', on: !tokens.google && !tokens.cesium, off: 'Standby' },
  ];
  return (
    <div className="flex flex-col gap-5 p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="fcc-micro">Stage legend</span>
          <Button size="sm" variant="ghost" onClick={() => ui.setLegend(!ui.legend)}>
            {ui.legend ? 'Hide on stage' : 'Show on stage'}
          </Button>
        </div>
        <Legend items={stageLegend} direction="column" />
      </div>
      <div className="flex flex-col">
        <span className="fcc-micro mb-2">Stage engine</span>
        {rows.map((r) => (
          <div key={r.label} className="flex h-8 items-center gap-2 border-b border-line-faint">
            <span className={cn('h-1.5 w-1.5', r.on ? 'bg-phosphor' : 'bg-ink-600')} />
            <span className="flex-1 text-xs text-bone-dim">{r.label}</span>
            <span className={cn('font-mono text-micro uppercase', r.on ? 'text-phosphor' : 'text-bone-mute')}>{r.on ? 'Active' : r.off}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col">
        <span className="mb-2 flex items-center gap-2">
          <span className="fcc-micro">Public data sources</span>
          <ProvenanceTag kind="real" label="Real" />
        </span>
        {(manifest?.sources ?? []).map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="group flex flex-col gap-0.5 border-b border-line-faint py-2 transition-colors duration-quick ease-servo hover:bg-ink-850"
          >
            <span className="flex items-center gap-2">
              <span className="text-xs text-bone">{s.name}</span>
              <Icon name="arrow-up-right" size={10} className="text-bone-mute group-hover:text-bone" />
            </span>
            <span className="font-mono text-micro uppercase text-bone-mute">
              {s.license} · fetched {s.fetchedAt.slice(0, 10)}
            </span>
            {s.note && <span className="text-xs leading-4 text-bone-dim">{s.note}</span>}
          </a>
        ))}
      </div>
      <p className="border-t border-line pt-3 font-mono text-micro uppercase leading-4 text-amber">
        {manifest?.disclaimer ?? 'Scenario built from public data; units, people and events are simulated.'}
      </p>
    </div>
  );
}

/* --------------------------------- Drawers --------------------------------- */

export function Drawers() {
  const ui = useUi();
  const close = () => ui.setPanel(null);
  const workers = useConsoleSelector((s) => s.pools.reduce((n, p) => n + p.workers, 0));
  const pending = useConsoleSelector((s) => s.actions.filter((a) => a.draft && a.status === 'proposed').length);
  const minutes = useConsoleSelector((s) => Math.round(s.ledger.analystMinutesSaved));
  const log = useConsoleSelector((s) => s.items.length);
  const checks = usePredictions();
  const checkTitle =
    checks.latest?.iou != null ? `Prediction vs replay · ${Math.round(checks.latest.iou * 100)} % IoU` : `Prediction vs replay · ${checks.pending.length} pending`;
  return (
    <>
      <Drawer open={ui.panel === 'agents'} onClose={close} title={`Agent Ops · ${workers} working`} index="A1" width={600}>
        {ui.panel === 'agents' && <AgentOps />}
      </Drawer>
      <Drawer open={ui.panel === 'drafts'} onClose={close} title={`Drafts · ${pending} awaiting approval`} index="A2" width={520}>
        {ui.panel === 'drafts' && <Drafts />}
      </Drawer>
      <Drawer
        open={ui.panel === 'ledger'}
        onClose={close}
        title={`Agent Work Ledger · ${fmtInt(minutes)} min saved`}
        index="A3"
        width={460}
        actions={
          <Button size="sm" variant="ghost" icon="expand" onClick={() => ui.setSummary(true)}>
            Summary
          </Button>
        }
      >
        {ui.panel === 'ledger' && <LedgerList />}
      </Drawer>
      <Drawer open={ui.panel === 'log'} onClose={close} title={`Log · ${log} graded`} index="A4" width={500}>
        {ui.panel === 'log' && <LogPanel />}
      </Drawer>
      <Drawer open={ui.panel === 'checks'} onClose={close} title={checkTitle} index="A5" width={480}>
        {ui.panel === 'checks' && <PredictionPanel />}
      </Drawer>
      <Drawer open={ui.panel === 'layers'} onClose={close} title="Layers & sources" index="A6" width={380}>
        {ui.panel === 'layers' && <Layers />}
      </Drawer>
    </>
  );
}
