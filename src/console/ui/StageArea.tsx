import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CaptionBar, DirectiveToast, Icon, InterruptBanner, Legend, cn, role, type ConsoleDirectiveKind } from '@ds';
import type { Directive, Feed, GradedItem } from '../contracts';
import { useConsoleApi, useConsoleSelector } from '../store';
import { Stage } from '../stage3d';
import { useIncidentMetrics } from './derived';
import { fmtInt, minutesFrom, toOrchAudiences, zuluTime } from './format';
import { SurfaceBoundary } from './SurfaceBoundary';
import { useUi, type PanelId } from './UiContext';

/* ------------------------------- Z0 interrupt ------------------------------ */

function InterruptLayer() {
  const api = useConsoleApi();
  const items = useConsoleSelector((s) => s.items);
  const item = useMemo(() => items.find((i) => i.zone === 'Z0_INTERRUPT' && !i.dismissed), [items]);
  if (!item) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-overlay flex justify-center px-6">
      <InterruptBanner
        key={item.id}
        className="pointer-events-auto"
        cls={item.cls}
        title={item.title}
        body={
          <>
            {item.body}
            <span className="mt-1.5 block font-mono text-micro uppercase leading-4 text-bone-mute">{item.reason}</span>
          </>
        }
        score={item.score}
        time={zuluTime(item.updatedAt)}
        notify={toOrchAudiences(item.audiences)}
        onAck={() => api.acknowledge(item.id)}
        onLocate={item.pos ? () => api.focus(item.pos!, 1800) : undefined}
      />
    </div>
  );
}

/* ---------------------------- Directive toasts ----------------------------- */

const TOAST_KINDS = new Set<Directive['kind']>(['focusStage', 'promoteFeed', 'restoreStage', 'openPanel', 'requestDecision', 'notify']);
const audienceWord: Record<string, string> = { ic: 'IC', ops: 'Ops', air: 'Air', ems: 'EMS', law: 'Law', public: 'Public' };
const panelWord: Record<string, string> = { agents: 'Agent Ops', ledger: 'the Work Ledger', drafts: 'Drafts', timeline: 'the timeline', feeds: 'Feeds' };

interface Toast {
  d: Directive;
  suggestion: boolean;
  ttl: number;
}

function describe(d: Directive, feeds: Feed[], items: GradedItem[], actionTitle: (id: string) => string | undefined): string {
  const item = 'itemId' in d && d.itemId ? items.find((i) => i.id === d.itemId) : undefined;
  switch (d.kind) {
    case 'focusStage':
      return item ? `Moved the camera to ${item.title}` : 'Moved the camera';
    case 'promoteFeed': {
      const f = feeds.find((x) => x.id === d.feedId);
      return `Put ${f?.label ?? d.feedId} on the stage`;
    }
    case 'restoreStage':
      return 'Restored the globe view';
    case 'openPanel':
      return `Opened ${panelWord[d.panel] ?? d.panel}`;
    case 'requestDecision':
      return `Decision needed · ${actionTitle(d.actionId) ?? 'see queue'}`;
    case 'notify':
      return `Relayed to ${d.audiences.map((a) => audienceWord[a] ?? a).join(', ')} · ${d.message}`;
    default:
      return d.reason;
  }
}

function DirectiveToasts() {
  const api = useConsoleApi();
  const ui = useUi();
  const directives = useConsoleSelector((s) => s.directives);
  const hold = useConsoleSelector((s) => s.settings.holdLayout);
  const feeds = useConsoleSelector((s) => s.feeds);
  const items = useConsoleSelector((s) => s.items);
  const actions = useConsoleSelector((s) => s.actions);
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(directives.map((d) => d.id));
      return;
    }
    const fresh = directives.filter((d) => !seen.current!.has(d.id));
    if (fresh.length === 0) return;
    fresh.forEach((d) => seen.current!.add(d.id));
    const suggestion = holdRef.current;
    for (const d of fresh) {
      if (d.kind === 'openPanel' && !suggestion) {
        const map: Partial<Record<string, PanelId>> = { agents: 'agents', ledger: 'ledger', drafts: 'drafts' };
        const p = map[d.panel];
        if (p) uiRef.current.setPanel(p);
      }
    }
    const add = fresh.filter((d) => TOAST_KINDS.has(d.kind)).map((d) => ({ d, suggestion, ttl: suggestion ? 16000 : 6500 }));
    if (add.length) setToasts((cur) => [...add.reverse(), ...cur].slice(0, 3));
  }, [directives]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.d.id !== t.d.id)), t.ttl));
    return () => timers.forEach(window.clearTimeout);
    // Keyed on the id list so unrelated re-renders do not re-arm (and extend) the timers.
  }, [toasts.map((t) => t.d.id).join('|')]);

  const drop = (id: string) => setToasts((cur) => cur.filter((x) => x.d.id !== id));
  const actionTitle = (id: string) => actions.find((a) => a.id === id)?.title;

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-overlay flex flex-col gap-2" aria-live="polite">
      {toasts.map(({ d, suggestion, ttl }) => (
        <DirectiveToast
          key={d.id}
          className="pointer-events-auto"
          kind={d.kind as ConsoleDirectiveKind}
          title={describe(d, feeds, items, actionTitle)}
          reason={d.reason}
          time={zuluTime(d.at, false)}
          suggestion={suggestion}
          ttlMs={ttl}
          onApply={
            suggestion
              ? () => {
                  api.applyDirective(d.id);
                  if (d.kind === 'openPanel') {
                    const p = ({ agents: 'agents', ledger: 'ledger', drafts: 'drafts' } as Partial<Record<string, PanelId>>)[d.panel];
                    if (p) ui.setPanel(p);
                  }
                  drop(d.id);
                }
              : undefined
          }
          onUndo={
            !suggestion && d.kind === 'promoteFeed'
              ? () => {
                  api.promoteFeed(null);
                  drop(d.id);
                }
              : undefined
          }
          onHold={
            !suggestion && (d.kind === 'focusStage' || d.kind === 'promoteFeed')
              ? () => {
                  api.setHoldLayout(true);
                  drop(d.id);
                }
              : undefined
          }
          onDismiss={() => drop(d.id)}
        />
      ))}
    </div>
  );
}

/* ------------------------------- Metric strip ------------------------------ */

function MetricCell({ label, value, unit, tone = 'text-bone', sub }: { label: string; value: string; unit?: string; tone?: string; sub?: string }) {
  return (
    <div className="flex min-w-[92px] flex-col gap-1 bg-ink-950/85 px-3 py-2">
      <span className="whitespace-nowrap font-mono text-micro uppercase text-bone-mute">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={cn('font-mono text-lg leading-none fcc-num', tone)}>{value}</span>
        {unit && <span className="font-mono text-micro uppercase text-bone-mute">{unit}</span>}
      </span>
      {sub && <span className="whitespace-nowrap font-mono text-micro uppercase text-ink-400">{sub}</span>}
    </div>
  );
}

function MetricStrip() {
  const m = useIncidentMetrics();
  const projection = useConsoleSelector((s) => s.projection);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 60000) * 60000);
  const places = useConsoleSelector((s) => s.pack?.manifest.places);
  const eta = useMemo(() => {
    if (!projection) return null;
    const list = Object.entries(projection.etaToPlaces)
      .map(([id, at]) => ({ id, at, name: places?.find((p) => p.id === id)?.name ?? id }))
      .filter((x) => x.at > t)
      .sort((a, b) => a.at - b.at);
    return list[0] ?? null;
  }, [projection, places, t]);
  return (
    <div className="pointer-events-auto flex gap-px border border-line bg-line shadow-panel">
      <MetricCell label="Burned" value={fmtInt(m.acres)} unit="AC" tone="text-ember" sub="NIFC perimeter interp." />
      <MetricCell label="Containment" value={String(m.containment)} unit="%" sub="Simulated" />
      <MetricCell
        label="ROS · head"
        value={m.ros != null ? m.ros.toFixed(1) : '—'}
        unit="M/MIN"
        tone="text-amber"
        sub={m.headDir != null ? `Heading ${String(Math.round(m.headDir)).padStart(3, '0')}°` : undefined}
      />
      <MetricCell label="Lives at risk" value={String(m.lives).padStart(2, '0')} tone={m.lives > 0 ? 'text-violet' : 'text-bone'} sub="Simulated people" />
      <MetricCell label="Structures" value={fmtInt(m.structures)} tone="text-amber" sub="Inside +6H band" />
      {m.wx && (
        <MetricCell
          label="Wind"
          value={`${String(Math.round(m.wx.windDirDeg)).padStart(3, '0')}°`}
          unit={`${Math.round(m.wx.windKph)} KPH`}
          sub={`Gust ${Math.round(m.wx.gustKph)} · RH ${Math.round(m.wx.rh)} %`}
        />
      )}
      {eta && <MetricCell label={`Head ETA · ${eta.name}`} value={`${minutesFrom(t, eta.at)}`} unit="MIN" tone="text-amber" sub={`Proj rev ${projection?.rev ?? 0}`} />}
    </div>
  );
}

/* ---------------------------------- Legend --------------------------------- */

export const stageLegend = [
  { label: 'Active front', color: role.fireFront, shape: 'line' as const },
  { label: 'Burn scar', color: role.burnScar, shape: 'hatch' as const },
  { label: '+1H / +3H / +6H projection', color: role.fireForecast, shape: 'dash' as const },
  { label: 'Drone · aircraft', color: role.drone, shape: 'square' as const },
  { label: 'Ground unit', color: role.crew, shape: 'square' as const },
  { label: 'Person (approx. ring)', color: role.detection, shape: 'dot' as const },
  { label: 'Hazard', color: role.danger, shape: 'dot' as const },
  { label: 'Movement route', color: role.accent, shape: 'dash' as const },
];

/* --------------------------------- Captions -------------------------------- */

function Captions() {
  const api = useConsoleApi();
  const d = useConsoleSelector((s) => s.director);
  if (!d.enabled || !d.captions) return null;
  const beat = d.beats[d.beat];
  if (!beat) return null;
  const last = d.beats[d.beats.length - 1];
  const dur = Math.max(180, (last?.at ?? 160) + 20);
  return (
    <CaptionBar
      key={beat.id}
      className="pointer-events-auto animate-rise"
      beat={d.beat}
      total={d.beats.length}
      title={beat.title}
      caption={beat.caption}
      progress={d.elapsedS / dur}
      beatMarks={d.beats.map((b) => b.at / dur)}
      onPrev={() => api.director.prev()}
      onNext={() => api.director.next()}
      onClose={() => api.director.setCaptions(false)}
    />
  );
}

/* ------------------------------- Feed-mode HUD ----------------------------- */

function FeedModeBar() {
  const api = useConsoleApi();
  const stage = useConsoleSelector((s) => s.stage);
  const feeds = useConsoleSelector((s) => s.feeds);
  const directives = useConsoleSelector((s) => s.directives);
  if (stage.mode !== 'feed') return null;
  const feed = feeds.find((f) => f.id === stage.feedId);
  const why = directives.find((d) => d.kind === 'promoteFeed' && d.feedId === stage.feedId);
  return (
    <div
      title={why?.reason}
      className="pointer-events-auto flex items-center gap-3 border border-line-strong bg-ink-950/90 py-1 pl-3 pr-1 shadow-panel"
    >
      <Icon name="camera" size={12} className="text-ice" />
      <span className="font-mono text-micro uppercase text-bone">{feed?.label ?? 'Feed'}</span>
      <Button size="sm" variant="secondary" icon="map" onClick={() => api.promoteFeed(null)}>
        Back to globe
      </Button>
    </div>
  );
}

/* ---------------------------------- Stage ---------------------------------- */

export function StageArea() {
  const ui = useUi();
  const disclaimer = useConsoleSelector((s) => s.pack?.manifest.disclaimer) ?? 'Scenario built from public data; units, people and events are simulated.';
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-void">
      <SurfaceBoundary label="3D stage">
        <Stage className="absolute inset-0" />
      </SurfaceBoundary>

      <DirectiveToasts />
      <InterruptLayer />

      <div className="pointer-events-none absolute bottom-7 left-4 z-overlay">
        <MetricStrip />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[118px] z-overlay flex justify-center px-6">
        <Captions />
      </div>

      <div className="pointer-events-none absolute right-4 top-4 z-overlay">
        <FeedModeBar />
      </div>

      <div className="pointer-events-none absolute bottom-7 right-4 z-overlay flex flex-col items-end gap-2">
        {ui.legend && (
          <div className="pointer-events-auto animate-rise border border-line bg-ink-950/90 p-3 shadow-panel">
            <span className="fcc-micro mb-2 block">Stage legend</span>
            <Legend items={stageLegend} direction="column" />
          </div>
        )}
        <button
          type="button"
          aria-pressed={ui.legend}
          onClick={() => ui.setLegend(!ui.legend)}
          className={cn(
            'pointer-events-auto inline-flex h-7 items-center gap-1.5 border bg-ink-950/85 px-2 font-mono text-micro uppercase tracking-[0.12em] transition-colors duration-quick ease-servo',
            ui.legend ? 'border-line-strong text-bone' : 'border-line text-bone-mute hover:text-bone-dim',
          )}
        >
          <Icon name="layers" size={11} />
          Legend
          <span className="text-ink-500">L</span>
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-1.5 z-overlay flex justify-center font-mono text-micro uppercase text-bone-dim">{disclaimer}</div>
    </div>
  );
}
