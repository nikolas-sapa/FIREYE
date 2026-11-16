import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn, getAppearance, onAppearanceChange, setAppearance } from '@ds';
import type { Geo, Ms } from '../contracts';
import { ConsoleProvider, consoleStore, useConsoleApi, useConsoleSelector } from '../store';
import { cameraOps } from '../stage3d/camera-ops';
import type { StageEngine } from '../stage3d/StageEngine';
import { enableWorld3dFeeds, world3dEligible } from '../stage3d/feeds/world3d';
import { useStageWorld } from '../stage3d/world';
import { setMapMode } from '../stage3d/map-settings';
import { packZone, registerZone } from '../ui/format';
import { contextFor } from '../world/engine';
import { Boot, type BootProbe } from './boot/Boot';
import { prepareBootGlobe } from './boot/globe';
import { sensorModel } from './data/sensors';
import { dive } from './shell/Dive';
import { FeedDeck } from './shell/FeedDeck';
import { FleetColumn } from './shell/FleetColumn';
import { LogColumn } from './shell/LogColumn';
import { StageShell } from './shell/StageShell';
import { useChronicle, useFireyeSync } from './shell/sync';
import { Timeline } from './shell/Timeline';
import { TopBar } from './shell/TopBar';
import { fireyeUi, LAYOUT_LIMITS, useFireye, type Layout } from './shell/ui';
import './fireye.css';

enableWorld3dFeeds();

function isTyping(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

/** `?t=HH:MM` (incident local time) or `?t=<ms>` picks the start time; default is the window start. */
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

/* ------------------------------------------------------------------ resizable panels */

function Resizer({ axis, value, min, max, onChange, onToggle, label, invert }: {
  axis: 'x' | 'y'; value: number; min: number; max: number; onChange: (v: number) => void; onToggle: () => void; label: string; invert?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const start = useRef({ p: 0, v: 0 });
  return (
    <div role="separator" tabIndex={0} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-label={`${label}. Arrows resize, Enter collapses`}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} data-axis={axis} data-drag={drag} data-boot-resizer
      className={cn('fireye-resize pointer-events-auto relative z-raised shrink-0 focus-visible:outline-none', axis === 'x' ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize')}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { p: axis === 'x' ? e.clientX : e.clientY, v: value }; setDrag(true); }}
      onPointerMove={(e) => {
        if (!drag) return;
        const d = (axis === 'x' ? e.clientX : e.clientY) - start.current.p;
        onChange(start.current.v + (invert ? -d : d));
      }}
      onPointerUp={() => setDrag(false)}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const grow = axis === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : (invert ? 'ArrowUp' : 'ArrowDown');
        const shrink = axis === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : (invert ? 'ArrowDown' : 'ArrowUp');
        if (e.key === grow) { e.preventDefault(); onChange(value + step); }
        else if (e.key === shrink) { e.preventDefault(); onChange(value - step); }
        else if (e.key === 'Enter') { e.preventDefault(); onToggle(); }
      }} />
  );
}

function Collapsed({ side, label, onOpen }: { side: 'left' | 'right' | 'bottom'; label: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Show ${label}`} data-boot-panel={side}
      className={cn('fireye-boot-panel pointer-events-auto relative z-raised flex shrink-0 items-center justify-center gap-2 border-line bg-ink-950 font-mono text-micro uppercase tracking-[0.18em] text-bone-mute hover:text-bone',
        side === 'bottom' ? 'h-6 w-full border-t' : 'w-6 flex-col [writing-mode:vertical-rl]', side === 'left' && 'border-r', side === 'right' && 'border-l')}>
      <Icon name={side === 'bottom' ? 'chevron-down' : side === 'left' ? 'chevron-right' : 'chevron-left'} size={10} className={side === 'bottom' ? 'rotate-180' : undefined} />
      {label}
    </button>
  );
}

function PanelHead({ title, onCollapse, side }: { title: string; onCollapse: () => void; side: 'left' | 'right' | 'bottom' }) {
  return (
    <button type="button" onClick={onCollapse} aria-label={`Collapse ${title}`} title={`Collapse ${title}`}
      className="absolute right-1 top-1 z-raised flex h-5 w-5 items-center justify-center text-bone-mute hover:text-bone">
      <Icon name={side === 'bottom' ? 'chevron-down' : side === 'left' ? 'chevron-left' : 'chevron-right'} size={10} />
    </button>
  );
}

/* ------------------------------------------------------------------ shell */

function useKeyboard(engine: StageEngine | null) {
  const api = useConsoleApi();
  const ref = useRef({ api, engine });
  ref.current = { api, engine };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { api, engine } = ref.current;
      const ui = fireyeUi.get();
      if (!ui.booted) return;
      const k = e.key;
      if (k === 'Escape') {
        if (ui.dive.phase !== 'idle') void dive.exit();
        else if (ui.panel) fireyeUi.set({ panel: null });
        else if (ui.chat) fireyeUi.set({ chat: false });
        else if (ui.selected) fireyeUi.set({ selected: null });
      } else if (k === ' ') {
        if ((e.target as HTMLElement | null)?.closest('button,[role="button"],[role="slider"],[role="separator"],a')) return;
        e.preventDefault();
        api.setPaused(!consoleStore.get().clock.paused);
      } else if (k === 't' || k === 'T') fireyeUi.set({ thermal: !ui.thermal });
      else if (k === 'l' || k === 'L') fireyeUi.set({ panel: ui.panel === 'legend' ? null : 'legend' });
      else if (k === 'v' || k === 'V') fireyeUi.set({ panel: ui.panel === 'layers' ? null : 'layers' });
      else if ((k === 'h' || k === 'H') && engine) cameraOps.home(engine);
      else if (k === 'o' || k === 'O') fireyeUi.set({ orbit: !ui.orbit });
      else if (k === '1') fireyeUi.set({ tab: 'intake' });
      else if (k === '2') fireyeUi.set({ tab: 'ops' });
      else if (k === '/') { e.preventDefault(); fireyeUi.set({ chat: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useViewportHeight() {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vh;
}

function Shell() {
  const api = useConsoleApi();
  const ready = useConsoleSelector((s) => s.ready);
  const pack = useConsoleSelector((s) => s.pack);
  const drones = useConsoleSelector((s) => s.units.filter((u) => u.kind === 'drone').length);
  const feeds = useStageWorld((s) => s.feeds.length);
  const ch = useChronicle();
  const booted = useFireye((s) => s.booted);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'right' | null>(null);
  const layout = useFireye((s) => s.layout);
  const phase = useFireye((s) => s.dive.phase);
  useEffect(() => {
    if (phase !== 'idle') setMobilePanel(null);
  }, [phase]);
  const [engine, setEngine] = useState<StageEngine | null>(null);
  const [reveal, setReveal] = useState<'loading' | 'globe' | 'panels'>('loading');
  const globeFlight = useRef<ReturnType<typeof prepareBootGlobe> | null>(null);
  const [painted, setPainted] = useState(false), [warm, setWarm] = useState(false);
  const dashboard = useRef<HTMLDivElement>(null);
  const mapArea = useRef<HTMLElement>(null), mapWindow = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const started = useRef(false);
  const vh = useViewportHeight();
  useFireyeSync();
  useKeyboard(engine);

  if (pack) { const z = packZone(pack); registerZone(z.label, z.offsetMin); }
  useEffect(() => { document.title = 'FIREYE · Mati 2018 exercise'; }, []);
  useLayoutEffect(() => { if (dashboard.current) dashboard.current.inert = !booted; }, [booted]);
  useEffect(() => () => globeFlight.current?.cancel(), []);

  // Start in the pre-ignition window, playing, with the orchestrator advising rather than moving the screen.
  useEffect(() => {
    if (!ready || !pack || !ch || started.current) return;
    started.current = true;
    const ctx = contextFor(pack);
    api.setHoldLayout(true);
    api.seek(startFrom(window.location.search, ctx.start, ctx.end, packZone(pack).offsetMin));
    api.setSpeed(60);
    api.setPaused(!booted || new URLSearchParams(window.location.search).get('paused') === '1');
    if (import.meta.env.DEV) (window as unknown as { __fireye?: unknown }).__fireye = { api, ui: fireyeUi, dive };
  }, [ready, pack, ch, api]);

  // Keep the exercise at its requested start until the presentation is completely uncovered.
  useEffect(() => {
    if (booted && ready && started.current) api.setPaused(new URLSearchParams(window.location.search).get('paused') === '1');
  }, [booted, ready, api]);

  // Pre-position the final viewport and warm actual map/camera pixels underneath the opaque boot.
  useEffect(() => {
    if (!engine || !pack) return;
    engine.homeView(0);
    setPainted(false);
    let frames = 0;
    const off = engine.viewer.scene.postRender.addEventListener(() => {
      if (++frames >= 2 && engine.viewer.scene.globe.tilesLoaded) { setPainted(true); off(); }
    });
    engine.viewer.scene.requestRender();
    return off;
  }, [engine, pack]);
  useEffect(() => {
    if (booted || warm) return;
    const check = () => {
      const state = consoleStore.get();
      const wantsWorld = world3dEligible(state.feeds.find(f => f.live), state.pack);
      const selector = wantsWorld ? '.fcc-sensor canvas[data-world="world3d"][data-ready="true"]' : '.fcc-sensor canvas[data-ready="true"]';
      if (!dashboard.current?.querySelector(selector)) return;
      setWarm(true); window.clearInterval(timer);
    };
    const timer = window.setInterval(check, 120);
    check();
    return () => window.clearInterval(timer);
  }, [booted, warm]);

  const prepareGlobe = useCallback(async (signal: AbortSignal, instant: boolean) => {
    globeFlight.current?.cancel(); globeFlight.current = null;
    setReveal('globe');
    if (!engine || !pack || signal.aborted) return;
    if (instant) { engine.homeView(0); return; }
    const flight = prepareBootGlobe(engine, pack, signal);
    globeFlight.current = flight;
    await flight.ready;
  }, [engine, pack]);
  const zoomGlobe = useCallback(async (_signal: AbortSignal, instant: boolean) => {
    if (!instant) await globeFlight.current?.run();
  }, []);

  const seek = useCallback((t: Ms) => { api.seek(t); }, [api]);
  const focus = useCallback((g: Geo, rangeM = 2400) => { engine?.flyTo(g, { rangeM, duration: 1.6 }); }, [engine]);
  const focusUnit = useCallback((id: string) => {
    fireyeUi.set({ selected: id });
    const g = engine?.geoOf(id);
    if (g) engine?.flyTo(g, { rangeM: 2600, duration: 1.6 });
  }, [engine]);
  const focusSensor = useCallback((id: string) => {
    fireyeUi.set({ selected: id });
    const s = pack && sensorModel(pack).specs.find((x) => x.id === id);
    if (s) engine?.flyTo(s.pos, { rangeM: 1800, duration: 1.6 });
  }, [engine, pack]);
  const onDive = useCallback((feedId: string) => { void dive.enter(feedId); }, []);

  const probe: BootProbe = useMemo(() => ({
    pack, ready, drones, feeds, globe: !!engine, painted, warm,
    chronicle: ch?.entries.length ?? 0, sensors: pack ? sensorModel(pack).specs.length : 0,
  }), [pack, ready, drones, feeds, engine, painted, warm, ch]);

  const set = (p: Partial<Layout>) => fireyeUi.setLayout(p);
  // Short windows keep the stage usable: the deck never takes more than about a quarter of the height.
  const deckH = Math.max(LAYOUT_LIMITS.bottom[0], Math.min(layout.bottom, Math.round(vh * 0.24)));
  const dim = phase === 'lock' || phase === 'flying';

  // Panels reserve space for HUD/feed controls, never for the underlying canvas.
  useLayoutEffect(() => {
    const area = mapArea.current, content = mapWindow.current;
    if (!area || !content) return;
    const measure = () => {
      const a = area.getBoundingClientRect(), w = content.getBoundingClientRect();
      const next = { top: w.top - a.top, right: a.right - w.right, bottom: a.bottom - w.bottom, left: w.left - a.left };
      setInsets(old => old.top === next.top && old.right === next.right && old.bottom === next.bottom && old.left === next.left ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area); observer.observe(content); measure();
    return () => observer.disconnect();
  }, [layout.left, layout.leftOpen, layout.right, layout.rightOpen, layout.bottomOpen, deckH]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950 text-bone">
      <div ref={dashboard} data-fireye-dashboard data-mobile-panel={mobilePanel ?? 'none'} data-boot-state={booted ? 'ready' : reveal}
        aria-hidden={!booted} className="relative flex h-full w-full flex-col">
      <TopBar onOrch={() => fireyeUi.set({ chat: true, tab: 'ops' })} />
      <div className="mobile-recon-toggles absolute left-3 top-16 z-hud hidden gap-2">
        {(['left', 'right'] as const).map(side => <button key={side} type="button" aria-expanded={mobilePanel === side}
          onClick={() => setMobilePanel(mobilePanel === side ? null : side)} className="min-h-11 min-w-11 border border-line bg-ink-950 px-3 text-xs text-bone">{side === 'left' ? 'Fleet' : 'Log'} {mobilePanel === side ? '−' : '+'}</button>)}
      </div>
      <main ref={mapArea} data-fireye-map aria-label="Incident map" className="absolute inset-x-0 bottom-0 top-12">
        <StageShell insets={insets} onFocus={focus} onEngine={setEngine} />
      </main>
      <div className="pointer-events-none flex min-h-0 flex-1">
          <aside data-boot-panel="left" className="fireye-boot-panel pointer-events-auto relative z-raised shrink-0 border-r border-line" style={{ width: layout.leftOpen ? layout.left : 104 }}>
            <FleetColumn compact={!layout.leftOpen} onDive={onDive} onFocusUnit={focusUnit} onFocusSensor={focusSensor} />
          </aside>
          {layout.leftOpen && <Resizer axis="x" label="Fleet width" value={layout.left} min={LAYOUT_LIMITS.left[0]} max={LAYOUT_LIMITS.left[1]} onChange={v => set({ left: v })} onToggle={() => set({ leftOpen: false })} />}
        <div ref={mapWindow} data-fireye-map-window aria-hidden className="relative min-w-0 flex-1" />
        {layout.rightOpen || mobilePanel === 'right' ? (
          <>
            <Resizer axis="x" invert label="Log width" value={layout.right} min={LAYOUT_LIMITS.right[0]} max={LAYOUT_LIMITS.right[1]} onChange={(v) => set({ right: v })} onToggle={() => set({ rightOpen: false })} />
            <aside data-boot-panel="right" className={cn('fireye-boot-panel fireye-dim pointer-events-auto relative z-raised shrink-0 border-l border-line', !layout.rightOpen && 'md:hidden')} data-dim={dim} style={{ width: layout.right }}>
              <LogColumn onFocus={(g) => focus(g)} onSeek={seek} />
            </aside>
          </>
        ) : <Collapsed side="right" label="Log" onOpen={() => set({ rightOpen: true })} />}
      </div>
      {layout.bottomOpen ? (
        <>
          <Resizer axis="y" invert label="Feed deck height" value={deckH} min={LAYOUT_LIMITS.bottom[0]} max={LAYOUT_LIMITS.bottom[1]} onChange={(v) => set({ bottom: v })} onToggle={() => set({ bottomOpen: false })} />
          <section data-boot-panel="bottom" aria-label="Feed deck" className="fireye-boot-panel relative z-raised shrink-0 border-t border-line bg-ink-950 pt-1" style={{ height: deckH }}>
            <PanelHead title="feeds" side="bottom" onCollapse={() => set({ bottomOpen: false })} />
            <FeedDeck onOpen={onDive} />
          </section>
        </>
      ) : <Collapsed side="bottom" label="Feeds" onOpen={() => set({ bottomOpen: true })} />}
      <div data-boot-panel="timeline" className="fireye-boot-panel relative z-raised shrink-0"><Timeline onSeek={seek} /></div>
      </div>
      {!booted && <Boot probe={probe} onPrepareGlobe={prepareGlobe} onGlobe={zoomGlobe}
        onReveal={() => setReveal('panels')} onDone={() => fireyeUi.set({ booted: true })} />}
    </div>
  );
}

export default function FireyeApp() {
  useLayoutEffect(() => {
    const previous = getAppearance();
    const enforceDark = () => { if (getAppearance() !== 'dark') setAppearance('dark', { persist: false, immediate: true }); };
    enforceDark();
    const off = onAppearanceChange(enforceDark);
    setMapMode('satellite');
    return () => { off(); setAppearance(previous, { persist: false }); };
  }, []);
  return (
    <ConsoleProvider profile="recon">
      <div className="fcc-console-shell h-dvh w-full overflow-hidden">
        <Shell />
      </div>
    </ConsoleProvider>
  );
}
