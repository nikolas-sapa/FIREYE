import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, ScoreMeter, cn } from '@ds';
import type { Finding, Unit } from '../contracts';
import { useConsoleApi, useConsoleSelector } from '../store';
import { ago, localTime, packZone } from '../ui/format';
import type { StageEngine } from '../stage3d/StageEngine';
import { dive } from '../fireye/shell/Dive';
import { useDecisions } from '../fireye/shell/OrchestratorCallout';
import { journal } from '../fireye/data/journal';
import { useFireye } from '../fireye/shell/ui';
import { WEIGHT_KEYS, loadWeights, postSystem, saveWeights, type Weights } from './opsStore';
import { STAGE_RANK, placeAlerts, useAlertVersion } from './alerts';

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 font-mono text-micro uppercase text-bone-mute">{label}</span>
      <span className="h-1 flex-1 bg-ink-800"><span className="block h-full bg-signal" style={{ width: `${Math.round(v * 100)}%` }} /></span>
      <span className="fcc-num w-8 text-right font-mono text-micro text-bone-dim">{Math.round(v * 100)}%</span>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-line-faint px-2 py-1.5">
      <div className="font-mono text-micro uppercase text-bone-mute">{k}</div>
      <div className="fcc-num mt-0.5 font-mono text-sm text-bone">{v}</div>
    </div>
  );
}

function useTick(ms = 1000) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

function UnitCard({ unit, engine }: { unit: Unit; engine: StageEngine | null }) {
  useTick();
  const t = useConsoleSelector((s) => s.clock.t);
  const action = useConsoleSelector((s) => s.actions.find((a) => a.id === unit.taskId));
  const feed = useConsoleSelector((s) => s.feeds.find((f) => f.unitId === unit.id));
  return (
    <section aria-label="Unit inspector" className="fireye-pop border-b border-line">
      <header className="flex h-9 items-center gap-2 border-b border-line px-3">
        <span aria-hidden className="h-2.5 w-3.5 border border-signal bg-signal/30" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">{unit.callsign}</span>
        <span className="font-mono text-micro uppercase text-bone-mute">{unit.kind}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-micro uppercase text-phosphor">
          <span className="h-1 w-1 bg-phosphor" aria-hidden />Updated {ago(t, t)}
        </span>
      </header>
      <div className="grid grid-cols-3 gap-px bg-line-faint">
        <Cell k="Altitude" v={unit.pos.alt != null ? `${Math.round(unit.pos.alt)} m` : '—'} />
        <Cell k="Speed" v={`${Math.round(unit.speedMps * 3.6)} km/h`} />
        <Cell k="Heading" v={`${Math.round(unit.heading)}°`} />
      </div>
      {(unit.battery != null || unit.water != null) && (
        <div className="flex flex-col gap-1.5 px-3 py-2">
          {unit.battery != null && <Bar label="Battery" v={unit.battery} />}
          {unit.water != null && <Bar label="Water" v={unit.water} />}
        </div>
      )}
      <div className="border-t border-line-faint px-3 py-2">
        <p className="font-mono text-micro uppercase text-bone-mute">
          Status <span className="text-bone-dim">{unit.status}</span>
          {unit.division && <> · Div <span className="text-bone-dim">{unit.division}</span></>}
        </p>
        {action && <p className="mt-1 truncate text-xs text-bone-dim" title={action.title}>Task · {action.title}</p>}
      </div>
      <div className="flex gap-2 border-t border-line px-3 py-2">
        {feed && <Button variant="secondary" size="sm" icon="video" onClick={() => void dive.enter(feed.id)}>Open feed</Button>}
        <Button variant="ghost" size="sm" icon="locate" onClick={() => { const g = engine?.geoOf(unit.id) ?? unit.pos; engine?.flyTo(g, { rangeM: 2600, duration: 1.4 }); }}>Locate</Button>
      </div>
    </section>
  );
}

function FindingCard({ f }: { f: Finding }) {
  useTick();
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const tz = packZone(pack).label;
  return (
    <section aria-label="Finding inspector" className="fireye-pop border-b border-line">
      <header className="flex h-9 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">{f.label}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 border border-amber/50 px-1.5 font-mono text-micro uppercase tracking-[0.12em] text-amber">Unverified</span>
      </header>
      <div className="px-3 py-2">
        <p className="text-xs leading-4 text-bone-dim">{f.detail}</p>
        <div className="mt-2 grid grid-cols-3 gap-px bg-line-faint">
          <Cell k="Conf" v={f.confidence.toFixed(2)} />
          <Cell k="± m" v={String(Math.round(f.uncertaintyM))} />
          <Cell k="Sources" v={String(f.sourceIds.length)} />
        </div>
        <p className="mt-2 font-mono text-micro uppercase text-bone-mute">
          {f.kind} · observed {localTime(f.observedAt, tz, true)} {tz} · {ago(t, f.observedAt)} ago · freshness {(f.freshness * 100).toFixed(0)}%
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ top match + weights */

function TopMatch({ engine }: { engine: StageEngine | null }) {
  const api = useConsoleApi();
  const t = useConsoleSelector((s) => s.clock.t);
  const items = useConsoleSelector((s) => s.items);
  const { top } = useDecisions();
  const [w, setW] = useState<Weights>(loadWeights);
  const [weightsOpen, setWeightsOpen] = useState(false);
  useEffect(() => saveWeights(w), [w]);

  const ranked = useMemo(() => {
    const score = (i: (typeof items)[number]) =>
      i.factors.severity * w.severity + i.factors.exposure * w.exposure + i.factors.confidence * w.confidence +
      i.factors.freshness * w.freshness + (i.factors.corroboration / 10) * w.corroboration;
    const live = items.filter((i) => !i.dismissed);
    const order = [...live].sort((a, b) => score(b) - score(a)).slice(0, 5);
    return order.map((i) => ({ item: i, delta: live.indexOf(i) - order.indexOf(i) }));
  }, [items, w]);
  const priority = items.find((i) => !i.dismissed) ?? null;
  const topFactors = useMemo(() => {
    if (!priority) return [];
    return (WEIGHT_KEYS.map((k) => ({ k, v: k === 'corroboration' ? priority.factors[k] / 10 : priority.factors[k] }))
      .sort((a, b) => b.v - a.v).slice(0, 3));
  }, [priority]);

  const decide = (decision: 'approved' | 'rejected') => {
    if (!top) return;
    journal.record({ key: top.key, t, decision, title: top.title, actionKind: top.action?.kind });
    if (top.action) (decision === 'approved' ? api.approve : api.reject)(top.action.id);
    else if (top.item) api.acknowledge(top.item.id);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <AlertZones />
      <section aria-label="Top match" className="border-b border-line">
        <p className="flex h-7 items-center bg-ink-900 px-3 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">{top ? 'Top match · needs approval' : 'Top priority'}</p>
        <div className="px-3 py-3">
        {top ? (
          <div className="mt-2 border border-line-strong border-t-signal bg-ink-900">
            <div className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-bone">{top.title}</p>
                {top.body && <p className="mt-1 text-xs leading-4 text-bone-dim">{top.body}</p>}
                <p className="mt-1.5 font-mono text-micro uppercase text-bone-mute">
                  {top.action ? `risk ${top.action.risk}` : top.origin} · {top.action?.unitIds.length ?? 0} units
                </p>
              </div>
              <div className="shrink-0"><ScoreMeter score={top.score} size="sm" /></div>
            </div>
            <div className="flex gap-2 border-t border-line px-3 py-2">
              <Button variant="primary" size="sm" icon="check" onClick={() => decide('approved')}>{top.action || top.origin === 'chronicle' ? 'Approve' : 'Acknowledge'}</Button>
              <Button variant="secondary" size="sm" icon="close" onClick={() => decide('rejected')}>Reject</Button>
            </div>
          </div>
        ) : priority ? (
          <div className="mt-2 border border-line-strong bg-ink-900">
            <div className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5 text-bone">{priority.title}</p>
                <p className="mt-1 text-xs leading-4 text-bone-dim">{priority.body}</p>
                <p className="mt-1.5 font-mono text-micro uppercase text-bone-mute">{priority.cls} · {priority.reason}</p>
              </div>
              <div className="shrink-0"><ScoreMeter score={priority.score} size="sm" /></div>
            </div>
            <div className="flex flex-col gap-1 border-t border-line-faint px-3 py-2">
              {topFactors.map((f) => <Bar key={f.k} label={f.k.slice(0, 4)} v={f.v} />)}
            </div>
            <div className="flex gap-2 border-t border-line px-3 py-2">
              {priority.pos && <Button variant="secondary" size="sm" icon="locate" onClick={() => engine?.flyTo(priority.pos!, { rangeM: 2600, duration: 1.4 })}>Focus</Button>}
              <span className="ml-auto self-center font-mono text-micro uppercase text-bone-mute">No open decisions</span>
            </div>
          </div>
        ) : (
          <p className="mt-2 border border-line-faint px-3 py-3 text-center font-mono text-micro uppercase text-bone-mute">No graded items yet</p>
        )}
        </div>
      </section>
      <section aria-label="Priority weights">
        <button type="button" onClick={() => setWeightsOpen((o) => !o)} aria-expanded={weightsOpen}
          className="flex h-7 w-full items-center gap-2 bg-ink-900 px-3 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute hover:text-bone-dim">
          <Icon name={weightsOpen ? 'chevron-down' : 'chevron-right'} size={10} />Adjust priorities
        </button>
        {weightsOpen && (
        <div className="mt-1 flex flex-col gap-1 px-3">
          {WEIGHT_KEYS.map((k) => (
            <div key={k} className="flex h-8 items-center gap-2 border-b border-line-faint last:border-0">
              <span className="w-24 shrink-0 font-mono text-micro uppercase text-bone-dim">{k}</span>
              <button type="button" aria-label={`Decrease ${k}`} onClick={() => setW((x) => ({ ...x, [k]: Math.max(0, x[k] - 10) }))}
                className="flex h-5 w-5 items-center justify-center border border-line text-bone-mute hover:text-bone"><Icon name="minus" size={9} /></button>
              <span className="h-px w-16 bg-ink-700"><span className="block h-px bg-signal" style={{ width: `${w[k]}%` }} /></span>
              <button type="button" aria-label={`Increase ${k}`} onClick={() => setW((x) => ({ ...x, [k]: Math.min(100, x[k] + 10) }))}
                className="flex h-5 w-5 items-center justify-center border border-line text-bone-mute hover:text-bone"><Icon name="plus" size={9} /></button>
              <span className="fcc-num ml-auto font-mono text-micro text-bone">{w[k]}</span>
            </div>
          ))}
        </div>
        )}
        <p className="mt-3 px-3 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">Local re-rank · display only</p>
        <ul className="mt-1 px-3 pb-3" aria-label="Re-ranked items">
          {ranked.map(({ item: i, delta }) => (
            <li key={i.id} className="flex h-7 items-center gap-2 border-b border-line-faint last:border-0">
              <span className="fcc-num w-8 shrink-0 font-mono text-micro text-signal">{Math.round(i.score)}</span>
              <span className={cn('w-7 shrink-0 font-mono text-micro', delta > 0 ? 'text-phosphor' : delta < 0 ? 'text-ember' : 'text-bone-mute')}>
                {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '·'}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-bone-dim">{i.title}</span>
              <span className="shrink-0 font-mono text-micro uppercase text-bone-mute">{i.cls}</span>
            </li>
          ))}
          {ranked.length === 0 && <li className="py-2 font-mono text-micro uppercase text-bone-mute">No graded items yet</li>}
        </ul>
      </section>
    </div>
  );
}

const STAGE_TXT: Record<string, string> = { leave: 'LEAVE NOW', shelter: 'SHELTER', prepare: 'PREPARE', monitor: 'MONITOR' };

function AlertZones() {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => s.clock.t);
  const v = useAlertVersion();
  const [all, setAll] = useState(false);
  const alerts = useMemo(() => placeAlerts(pack, t).filter((p) => p.eta != null || STAGE_RANK[p.stage] >= 1)
    .sort((a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage] || (a.eta ?? 0) - (b.eta ?? 0)), [pack, t, v]);
  const tz = packZone(pack).label;
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, 5);
  return (
    <section aria-label="Alert zones" className="border-b border-line">
      <p className="flex h-7 items-center bg-ink-900 px-3 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">Alert zones · simulated</p>
      <ul aria-label="Places in the fire path">
        {shown.map((p) => (
          <li key={p.id} className="flex h-10 items-center gap-2 border-b border-line-faint px-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-tiny text-bone">{p.name}</span>
                <span className={cn('shrink-0 font-mono text-micro uppercase', STAGE_RANK[p.stage] >= 2 ? 'text-ember' : p.stage === 'prepare' ? 'text-amber' : 'text-bone-mute')}>{STAGE_TXT[p.stage]}</span>
              </div>
              <div className="truncate font-mono text-micro text-bone-mute">ETA {p.eta != null ? localTime(p.eta, tz) : '—'} · ~{p.residents} residents · SIM</div>
            </div>
            <button type="button" onClick={() => postSystem('ALERTS', `MANUAL ALERT · ${p.name} · ${STAGE_TXT[p.stage]} · SMS to ~${p.residents} residents · SIMULATED`)}
              className="h-5 shrink-0 border border-line-strong px-1.5 font-mono text-micro uppercase text-bone-dim hover:border-bone hover:text-bone">
              Send alert
            </button>
          </li>
        ))}
        {!all && alerts.length > 5 && (
          <li><button type="button" onClick={() => setAll(true)} className="h-7 w-full font-mono text-micro uppercase tracking-[0.14em] text-bone-mute hover:text-bone">Show all +{alerts.length - 5}</button></li>
        )}
      </ul>
    </section>
  );
}

export function OpsInspect({ engine }: { engine: StageEngine | null }) {
  const sel = useFireye((s) => s.selected);
  const unit = useConsoleSelector((s) => (sel ? s.units.find((u) => u.id === sel) : undefined));
  const finding = useConsoleSelector((s) => (sel ? s.findings.find((f) => f.id === sel) : undefined));
  if (unit) return <UnitCard unit={unit} engine={engine} />;
  if (finding) return <FindingCard f={finding} />;
  return <TopMatch engine={engine} />;
}
