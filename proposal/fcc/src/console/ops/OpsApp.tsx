import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn, setAppearance, setTheme } from '@ds';
import type { Geo, Ms } from '../contracts';
import { ConsoleProvider, consoleStore, useConsoleApi, useConsoleSelector } from '../store';
import type { StageEngine } from '../stage3d/StageEngine';
import { enableWorld3dFeeds } from '../stage3d/feeds/world3d';
import { useStageWorld } from '../stage3d/world';
import { DaylightSync } from '../ui/DaylightSync';
import { packZone, registerZone } from '../ui/format';
import { contextFor } from '../world/engine';
import { setResidentContext, type ResidentRoute } from '../orchestrator/conversation';
import { distanceM } from '../world/geo';
import { localTime } from '../ui/format';
import { Boot, type BootProbe } from '../fireye/boot/Boot';
import { sensorModel } from '../fireye/data/sensors';
import { journal } from '../fireye/data/journal';
import { dive } from '../fireye/shell/Dive';
import { FeedDeck } from '../fireye/shell/FeedDeck';
import { StageShell } from '../fireye/shell/StageShell';
import { useChronicle, useFireyeSync } from '../fireye/shell/sync';
import { Timeline } from '../fireye/shell/Timeline';
import { fireyeUi, useFireye } from '../fireye/shell/ui';
import '../fireye/fireye.css';
import { OpsTopBar } from './OpsTopBar';
import { OpsRail } from './OpsRail';
import { OpsInspect } from './OpsInspect';
import { OpsComms } from './OpsComms';
import { OpsPalette } from './OpsPalette';
import { postSystem, wireComms } from './opsStore';
import { alertFeed, counters, ensureOsm, hazardNow, leaveBy, placeAlerts, routeRoads, routesNow, useAlertVersion, useRoutes, wireAlerts, type EscapeRoute } from './alerts';
import { CivilianPanel, useHome } from './CivilianPanel';
import { OpsOverlay } from './OpsOverlay';
import { PresenterCaption, PresenterHud, noteRoute, presenter, startPresenter, stopPresenter, usePresenter } from './Presenter';
import { opsView, useOpsView, useOverlayOpts } from './view';
import { useHideCallout } from './useHideCallout';
import './ops.css';
import './characters/characters.css';
import { OpsBackendControl, opsBackend } from './OpsBackend';

enableWorld3dFeeds();

function isTyping(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

function startFrom(search: string, start: Ms, end: Ms, offsetMin: number): Ms {
  const q = new URLSearchParams(search).get('t');
  if (!q) return start;
  const m = /^(\d{1,2}):(\d{2})$/.exec(q);
  let t: number;
  if (m) {
    const day = new Date(start + offsetMin * 60000);
    t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(m[1]), Number(m[2])) - offsetMin * 60000;
  } else t = Number(q);
  return Number.isFinite(t) ? Math.max(start, Math.min(end, t)) : start;
}

function useJournalReapply() {
  const api = useConsoleApi();
  useEffect(() => {
    let last: unknown = null;
    let queued = false;
    return consoleStore.subscribe(() => {
      const s = consoleStore.get();
      if (s.actions === last || queued) return;
      last = s.actions;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        journal.reapply(consoleStore.get().actions, consoleStore.get().clock.t, api,
          opsBackend.get().configured ? ['retask-drone'] : []);
      });
    });
  }, [api]);
}

type RightTab = 'inspect' | 'comms';

function useKeyboard(engine: StageEngine | null, composer: React.RefObject<HTMLInputElement | null>, openComms: () => void, openPalette: () => void) {
  const api = useConsoleApi();
  const ref = useRef({ api, engine, composer, openComms, openPalette });
  ref.current = { api, engine, composer, openComms, openPalette };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); ref.current.openPalette(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { api, engine, composer, openComms } = ref.current;
      const ui = fireyeUi.get();
      const k = e.key;
      if (k === 'Escape') {
        if (ui.dive.phase !== 'idle') void dive.exit();
        else if (ui.selected) fireyeUi.set({ selected: null });
      } else if (k === ' ') {
        if ((e.target as HTMLElement | null)?.closest('button,[role="button"],a')) return;
        e.preventDefault();
        api.setPaused(!consoleStore.get().clock.paused);
      } else if (k === '/') {
        e.preventDefault();
        openComms();
        window.setTimeout(() => composer.current?.focus(), 0);
      } else if ((k === 'h' || k === 'H') && engine) engine.homeView(1.6);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Shell() {
  const api = useConsoleApi();
  const ready = useConsoleSelector((s) => s.ready);
  const pack = useConsoleSelector((s) => s.pack);
  const drones = useConsoleSelector((s) => s.units.filter((u) => u.kind === 'drone').length);
  const feeds = useStageWorld((s) => s.feeds.length);
  const ch = useChronicle();
  const booted = useFireye((s) => s.booted);
  const selected = useFireye((s) => s.selected);
  const [engine, setEngine] = useState<StageEngine | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('inspect');
  const [thread, setThread] = useState<string | null>(null);
  const [feedsOpen, setFeedsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const composer = useRef<HTMLInputElement | null>(null);
  const started = useRef(false);
  useFireyeSync();
  useJournalReapply();
  useHideCallout();
  useKeyboard(engine, composer, useCallback(() => setRightTab('comms'), []), useCallback(() => setPaletteOpen(true), []));

  if (pack) { const z = packZone(pack); registerZone(z.label, z.offsetMin); }
  useEffect(() => {
    document.title = 'OPS · Mati 2018 exercise';
    setTheme('team', { persist: false });
    wireComms();
    wireAlerts();
    ensureOsm();
    if (import.meta.env.DEV) void import('./dev-autoconnect').then(module => module.autoConnectOps());
    const heartbeat = window.setInterval(() => {
      const s = consoleStore.get();
      void opsBackend.poll(s.actions, Math.floor(s.clock.t / 1000));
    }, 2000);
    if (import.meta.env.DEV) (window as unknown as { __opsAlerts?: unknown }).__opsAlerts = { opsView, hazardNow, routesNow, counters, placeAlerts, alertFeed };
    return () => { window.clearInterval(heartbeat); setTheme('fcc', { persist: false }); setAppearance('auto', { persist: false }); stopPresenter(); };
  }, []);

  useEffect(() => {
    if (!ready || !pack || !ch || started.current) return;
    started.current = true;
    const ctx = contextFor(pack);
    api.setHoldLayout(true);
    // Default to 8 scenario-minutes before ignition so the demo opens on live activity; ?t= keeps FIREYE semantics.
    const manifest = pack.manifest as { ignition?: { t?: number } };
    const ignition = typeof manifest.ignition?.t === 'number' ? manifest.ignition.t : ctx.start + 21 * 60000;
    const demoStart = Math.max(ctx.start, Math.min(ctx.end, ignition - 8 * 60000));
    api.seek(new URLSearchParams(window.location.search).get('t')
      ? startFrom(window.location.search, ctx.start, ctx.end, packZone(pack).offsetMin)
      : demoStart);
    api.setSpeed(60);
    api.setPaused(new URLSearchParams(window.location.search).get('paused') === '1');
    if (import.meta.env.DEV) (window as unknown as { __ops?: unknown }).__ops = { api, ui: fireyeUi, journal, dive, store: consoleStore };
  }, [ready, pack, ch, api]);

  // Jump to comms when the top bar asks for it.
  useEffect(() => {
    const on = (e: Event) => setRightTab((e as CustomEvent).detail === 'comms' ? 'comms' : 'inspect');
    document.addEventListener('ops:tab', on as EventListener);
    return () => document.removeEventListener('ops:tab', on as EventListener);
  }, []);

  // Per-view appearance + hide the built-in (amber) projection layer; our red overlay replaces it.
  const view = useOpsView();
  const { on: presenting } = usePresenter();
  useEffect(() => { setAppearance(view === 'civilian' ? 'light' : 'dark', { persist: false }); }, [view]);
  useEffect(() => {
    fireyeUi.setVis('projections', false);
    return () => fireyeUi.setVis('projections', true);
  }, []);

  const home = useHome();
  useEffect(() => {
    if (view !== 'civilian') return;
    setResidentContext(() => {
      const s = consoleStore.get();
      const alerts = placeAlerts(s.pack, s.clock.t);
      const alert = alerts.find(p => p.id === home?.id);
      const r = routesNow(home?.pos ?? null);
      const route = (v: EscapeRoute | null): ResidentRoute | null => v && ({ exit: v.exit.label, lengthM: v.lengthM, roads: routeRoads(v), cautionM: v.cautionM });
      return {
        home, stage: alert?.stage ?? 'monitor', eta: alert?.eta ?? null,
        etaMin: alert?.etaMin ?? null, inBlocked: alert?.inBlocked ?? false,
        leaveBy: alert?.eta != null ? `${localTime(leaveBy(alert.eta, 45), packZone(s.pack).label)} ${packZone(s.pack).label}` : null,
        best: route(r.best), second: route(r.second),
        threatened: alerts.filter(p => p.stage !== 'monitor' || p.inBlocked)
          .sort((a, b) => home ? distanceM(home.pos, a.pos) - distanceM(home.pos, b.pos) : 0)
          .slice(0, 3).map(p => `${p.name} (${p.stage})`),
      };
    });
    return () => setResidentContext(null);
  }, [view, home]);
  const overlayOpts = useOverlayOpts();
  const proj = useConsoleSelector((s) => s.projection);
  const routes = useRoutes(home?.pos ?? null, proj?.rev ?? -1);
  useEffect(() => { noteRoute(routes.best); }, [routes.best]);

  // Simulated alerts from stage transitions land in the SYSTEM comm lane too.
  const t = useConsoleSelector((s) => s.clock.t);
  const alertV = useAlertVersion();
  const seenAlerts = useRef(new Set<string>());
  useEffect(() => {
    for (const r of alertFeed(pack, t)) {
      const key = `${r.t}:${r.place}:${r.stage}`;
      if (seenAlerts.current.has(key)) continue;
      seenAlerts.current.add(key);
      postSystem('ALERTS', r.text);
    }
  }, [pack, t, alertV]);

  const togglePresent = useCallback(() => {
    if (presenterOn.current) { stopPresenter(); return; }
    startPresenter({ api, switchView: new URLSearchParams(window.location.search).get('switch') === 'civilian' });
  }, [api]);
  const presenterOn = useRef(false);
  presenterOn.current = presenting;
  // ?present=1 auto-starts once booted; Esc exits presenter.
  useEffect(() => {
    if (booted && new URLSearchParams(window.location.search).get('present') === '1' && !presenting) {
      startPresenter({ api, switchView: new URLSearchParams(window.location.search).get('switch') === 'civilian' });
    }
  }, [booted, api, presenting]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && presenter.get().on) stopPresenter(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const descended = useRef(false);
  useEffect(() => {
    if (!engine || descended.current) return;
    if (!booted) {
      const center = pack?.manifest.center;
      if (center) engine.flyTo(center, { rangeM: 420000, pitchDeg: -89, headingDeg: 0, duration: 0 });
      return;
    }
    descended.current = true;
    engine.homeView(2.6);
  }, [engine, booted, pack]);

  // Civilian view frames the selected home (~6 km range) on switch and on home change.
  const lastHomeFly = useRef<string | null>(null);
  useEffect(() => {
    if (view !== 'civilian' || !engine || !booted || !home) return;
    const key = home.id;
    if (lastHomeFly.current === key) return;
    lastHomeFly.current = key;
    engine.flyTo(home.pos, { rangeM: 6000, duration: 1.6 });
  }, [view, engine, booted, home]);

  const seek = useCallback((t: Ms) => { api.seek(t); }, [api]);
  const focus = useCallback((g: Geo, rangeM = 2400) => { engine?.flyTo(g, { rangeM, duration: 1.6 }); }, [engine]);
  const openThread = useCallback((agent: string) => { setThread(agent); setRightTab('comms'); }, []);

  const probe: BootProbe = useMemo(() => ({
    pack, ready, drones, feeds, globe: !!engine, chronicle: ch?.entries.length ?? 0, sensors: pack ? sensorModel(pack).specs.length : 0,
  }), [pack, ready, drones, feeds, engine, ch]);

  const civilian = view === 'civilian';
  return (
    <div className="ops-root flex h-full w-full flex-col overflow-hidden bg-ink-950 text-bone" data-view={view}>
      {booted ? <OpsTopBar presenting={presenting} onPresent={togglePresent} /> : <div className="h-10 shrink-0 border-b border-line bg-ink-950" />}
      <div className="flex min-h-0 flex-1">
        {booted && !civilian && <OpsRail engine={engine} onOpenThread={openThread} thread={thread} />}
        <main className="relative min-w-0 flex-1">
          <StageShell onFocus={focus} onEngine={setEngine} />
          {booted && <div className="absolute left-3 top-16 z-hud border border-line bg-ink-950 px-2 py-1"><OpsBackendControl /></div>}
          {booted && (
            <OpsOverlay engine={engine} routes={routes} home={home?.pos ?? null}
              showRoutes={civilian || overlayOpts.routes} showZones={civilian || overlayOpts.zones} />
          )}
          {booted && presenting && <PresenterCaption />}
          {booted && <PresenterHud pack={pack} t={t} selected={selected} />}
        </main>
        {booted && (civilian ? <CivilianPanel home={home} /> : (
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-ink-950">
            <div role="tablist" aria-label="Panel" className="flex shrink-0 border-b border-line">
              {(['inspect', 'comms'] as RightTab[]).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={rightTab === id} onClick={() => setRightTab(id)}
                  className={cn('h-8 flex-1 border-t-2 font-mono text-micro uppercase tracking-[0.14em]', rightTab === id ? 'border-t-signal bg-ink-900 text-bone' : 'border-t-transparent bg-ink-950 text-bone-mute hover:text-bone-dim')}>
                  {id}
                </button>
              ))}
            </div>
            {rightTab === 'inspect' ? <OpsInspect engine={engine} /> : <OpsComms agent={thread} onClearAgent={() => setThread(null)} composerRef={composer} />}
          </aside>
        ))}
      </div>
      {booted && !civilian && !presenting && (feedsOpen ? (
        <section aria-label="Feed deck" className="h-[180px] shrink-0 border-t border-line bg-ink-950">
          <div className="flex h-6 items-center border-b border-line px-2 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">
            Feeds · {feeds}
            <button type="button" aria-label="Collapse feeds" onClick={() => setFeedsOpen(false)}
              className="ml-auto flex h-5 w-5 items-center justify-center hover:text-bone">
              <Icon name="chevron-down" size={10} />
            </button>
          </div>
          <div className="h-[152px]"><FeedDeck onOpen={(id) => void dive.enter(id)} /></div>
        </section>
      ) : (
        <button type="button" onClick={() => setFeedsOpen(true)}
          className="flex h-7 w-full shrink-0 items-center justify-center gap-2 border-t border-line bg-ink-950 font-mono text-micro uppercase tracking-[0.18em] text-bone-mute hover:text-bone">
          <Icon name="chevron-down" size={10} className="rotate-180" />Feeds · {feeds}
        </button>
      ))}
      {booted && <Timeline onSeek={seek} />}
      {booted && !civilian && paletteOpen && <OpsPalette engine={engine} onOpenThread={openThread} onClose={() => setPaletteOpen(false)} />}
      {!booted && <Boot probe={probe} onDone={() => fireyeUi.set({ booted: true })} />}
    </div>
  );
}

export default function OpsApp() {
  return (
    <ConsoleProvider>
      <DaylightSync />
      <div className="fcc-console-shell h-dvh w-full overflow-hidden">
        <Shell />
      </div>
    </ConsoleProvider>
  );
}
