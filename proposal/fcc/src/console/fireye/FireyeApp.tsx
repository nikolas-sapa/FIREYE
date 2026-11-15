import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from '@ds';
import type { Geo, Ms } from '../contracts';
import { ConsoleProvider, consoleStore, useConsoleApi, useConsoleSelector } from '../store';
import { cameraOps } from '../stage3d/camera-ops';
import type { StageEngine } from '../stage3d/StageEngine';
import { enableWorld3dFeeds } from '../stage3d/feeds/world3d';
import { useStageWorld } from '../stage3d/world';
import { DaylightSync } from '../ui/DaylightSync';
import { packZone, registerZone } from '../ui/format';
import { contextFor } from '../world/engine';
import { Boot, type BootProbe } from './boot/Boot';
import { sensorModel } from './data/sensors';
import { journal } from './data/journal';
import { dive } from './shell/Dive';
import { FeedDeck } from './shell/FeedDeck';
import { FleetColumn } from './shell/FleetColumn';
import { LogColumn } from './shell/LogColumn';
import { useDecisions } from './shell/OrchestratorCallout';
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
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} data-axis={axis} data-drag={drag}
      className={cn('fireye-resize relative z-raised shrink-0 focus-visible:outline-none', axis === 'x' ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize')}
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
    <button type="button" onClick={onOpen} aria-label={`Show ${label}`}
      className={cn('flex shrink-0 items-center justify-center gap-2 border-line bg-ink-950 font-mono text-micro uppercase tracking-[0.18em] text-bone-mute hover:text-bone',
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
      // Re-entrant approve() calls during a store emit would publish mid-notification.
      queueMicrotask(() => { queued = false; journal.reapply(consoleStore.get().actions, consoleStore.get().clock.t, api); });
    });
  }, [api]);
}

function useKeyboard(engine: StageEngine | null) {
  const api = useConsoleApi();
  const ref = useRef({ api, engine });
  ref.current = { api, engine };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { api, engine } = ref.current;
      const ui = fireyeUi.get();
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
  const layout = useFireye((s) => s.layout);
  const phase = useFireye((s) => s.dive.phase);
  const [engine, setEngine] = useState<StageEngine | null>(null);
  const started = useRef(false);
  const vh = useViewportHeight();
  const { open } = useDecisions();
  useFireyeSync();
  useJournalReapply();
  useKeyboard(engine);

  if (pack) { const z = packZone(pack); registerZone(z.label, z.offsetMin); }
  useEffect(() => { document.title = 'FIREYE · Mati 2018 exercise'; }, []);

  // Start in the pre-ignition window, playing, with the orchestrator advising rather than moving the screen.
  useEffect(() => {
    if (!ready || !pack || !ch || started.current) return;
    started.current = true;
    const ctx = contextFor(pack);
    api.setHoldLayout(true);
    api.seek(startFrom(window.location.search, ctx.start, ctx.end, packZone(pack).offsetMin));
    api.setSpeed(60);
    api.setPaused(new URLSearchParams(window.location.search).get('paused') === '1');
    if (import.meta.env.DEV) (window as unknown as { __fireye?: unknown }).__fireye = { api, ui: fireyeUi, journal, dive };
  }, [ready, pack, ch, api]);

  // Camera descends from orbit to Mati as the boot hands over.
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
    pack, ready, drones, feeds, globe: !!engine, chronicle: ch?.entries.length ?? 0, sensors: pack ? sensorModel(pack).specs.length : 0,
  }), [pack, ready, drones, feeds, engine, ch]);

  const set = (p: Partial<Layout>) => fireyeUi.setLayout(p);
  // Short windows keep the stage usable: the deck never takes more than about a quarter of the height.
  const deckH = Math.max(LAYOUT_LIMITS.bottom[0], Math.min(layout.bottom, Math.round(vh * 0.24)));
  const dim = phase === 'lock' || phase === 'flying';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-950 text-bone">
      {booted ? <TopBar pending={open.length} onOrch={() => fireyeUi.set({ snoozed: [], tab: 'ops' })} /> : <div className="h-11 shrink-0 border-b border-line bg-ink-950" />}
      <div className="flex min-h-0 flex-1">
        {booted && (layout.leftOpen ? (
          <>
            <aside className="fireye-enter-left fireye-dim relative shrink-0 border-r border-line" data-dim={dim} style={{ width: layout.left, ['--i' as string]: 1 }}>
              <PanelHead title="fleet" side="left" onCollapse={() => set({ leftOpen: false })} />
              <FleetColumn onDive={onDive} onFocusUnit={focusUnit} onFocusSensor={focusSensor} />
            </aside>
            <Resizer axis="x" label="Fleet width" value={layout.left} min={LAYOUT_LIMITS.left[0]} max={LAYOUT_LIMITS.left[1]} onChange={(v) => set({ left: v })} onToggle={() => set({ leftOpen: false })} />
          </>
        ) : <Collapsed side="left" label="Fleet" onOpen={() => set({ leftOpen: true })} />)}
        <main className="relative min-w-0 flex-1">
          <StageShell onFocus={focus} onEngine={setEngine} />
        </main>
        {booted && (layout.rightOpen ? (
          <>
            <Resizer axis="x" invert label="Log width" value={layout.right} min={LAYOUT_LIMITS.right[0]} max={LAYOUT_LIMITS.right[1]} onChange={(v) => set({ right: v })} onToggle={() => set({ rightOpen: false })} />
            <aside className="fireye-enter-right fireye-dim relative shrink-0 border-l border-line" data-dim={dim} style={{ width: layout.right, ['--i' as string]: 2 }}>
              <LogColumn onFocus={(g) => focus(g)} onSeek={seek} />
            </aside>
          </>
        ) : <Collapsed side="right" label="Log" onOpen={() => set({ rightOpen: true })} />)}
      </div>
      {booted && (layout.bottomOpen ? (
        <>
          <Resizer axis="y" invert label="Feed deck height" value={deckH} min={LAYOUT_LIMITS.bottom[0]} max={LAYOUT_LIMITS.bottom[1]} onChange={(v) => set({ bottom: v })} onToggle={() => set({ bottomOpen: false })} />
          <section aria-label="Feed deck" className="fireye-enter-up relative shrink-0 border-t border-line bg-ink-950 pt-1" style={{ height: deckH, ['--i' as string]: 3 }}>
            <PanelHead title="feeds" side="bottom" onCollapse={() => set({ bottomOpen: false })} />
            <FeedDeck onOpen={onDive} />
          </section>
        </>
      ) : <Collapsed side="bottom" label="Feeds" onOpen={() => set({ bottomOpen: true })} />)}
      {booted && <div className="fireye-enter-up" style={{ ['--i' as string]: 4 }}><Timeline onSeek={seek} /></div>}
      {!booted && <Boot probe={probe} onDone={() => fireyeUi.set({ booted: true })} />}
    </div>
  );
}

export default function FireyeApp() {
  return (
    <ConsoleProvider>
      <DaylightSync />
      <div className="fcc-console-shell h-dvh w-full overflow-hidden">
        <Shell />
      </div>
    </ConsoleProvider>
  );
}
