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
import { wireComms } from './opsStore';

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
      queueMicrotask(() => { queued = false; journal.reapply(consoleStore.get().actions, consoleStore.get().clock.t, api); });
    });
  }, [api]);
}

type RightTab = 'inspect' | 'comms';

function useKeyboard(engine: StageEngine | null, composer: React.RefObject<HTMLInputElement | null>, openComms: () => void) {
  const api = useConsoleApi();
  const ref = useRef({ api, engine, composer, openComms });
  ref.current = { api, engine, composer, openComms };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  const composer = useRef<HTMLInputElement | null>(null);
  const started = useRef(false);
  useFireyeSync();
  useJournalReapply();
  useKeyboard(engine, composer, useCallback(() => setRightTab('comms'), []));

  if (pack) { const z = packZone(pack); registerZone(z.label, z.offsetMin); }
  useEffect(() => {
    document.title = 'OPS · Mati 2018 exercise';
    setTheme('team', { persist: false });
    setAppearance('dark', { persist: false }); // always-dark ops console, regardless of scenario daylight
    wireComms();
    return () => { setTheme('fcc', { persist: false }); setAppearance('auto', { persist: false }); };
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
  const openThread = useCallback((agent: string) => { setThread(agent); setRightTab('comms'); }, []);

  const probe: BootProbe = useMemo(() => ({
    pack, ready, drones, feeds, globe: !!engine, chronicle: ch?.entries.length ?? 0, sensors: pack ? sensorModel(pack).specs.length : 0,
  }), [pack, ready, drones, feeds, engine, ch]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-950 text-bone">
      {booted ? <OpsTopBar /> : <div className="h-11 shrink-0 border-b border-line bg-ink-950" />}
      <div className="flex min-h-0 flex-1">
        {booted && <OpsRail engine={engine} onOpenThread={openThread} />}
        <main className="relative min-w-0 flex-1">
          <StageShell onFocus={focus} onEngine={setEngine} />
          {booted && (
            <div className="pointer-events-none absolute left-3 top-3 z-[3]">
              <span className="border border-line-strong bg-ink-950/90 px-2 py-1 font-mono text-micro uppercase tracking-[0.16em] text-bone-dim">
                Map · Mati{selected ? <> · <span className="text-bone">{selected}</span></> : ''}
              </span>
            </div>
          )}
        </main>
        {booted && (
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-ink-950">
            <div role="tablist" aria-label="Panel" className="grid shrink-0 grid-cols-2 gap-px border-b border-line bg-line">
              {(['inspect', 'comms'] as RightTab[]).map((id) => (
                <button key={id} type="button" role="tab" aria-selected={rightTab === id} onClick={() => setRightTab(id)}
                  className={cn('h-8 font-mono text-micro uppercase tracking-[0.14em]', rightTab === id ? 'bg-ink-700 text-bone' : 'bg-ink-950 text-bone-mute hover:text-bone-dim')}>
                  {id}
                </button>
              ))}
            </div>
            {rightTab === 'inspect' ? <OpsInspect engine={engine} /> : <OpsComms agent={thread} onClearAgent={() => setThread(null)} composerRef={composer} />}
          </aside>
        )}
      </div>
      {booted && (feedsOpen ? (
        <section aria-label="Feed deck" className="relative h-[180px] shrink-0 border-t border-line bg-ink-950 pt-1">
          <button type="button" aria-label="Collapse feeds" onClick={() => setFeedsOpen(false)}
            className="absolute right-1 top-1 z-raised flex h-5 w-5 items-center justify-center text-bone-mute hover:text-bone">
            <Icon name="chevron-down" size={10} />
          </button>
          <FeedDeck onOpen={(id) => void dive.enter(id)} />
        </section>
      ) : (
        <button type="button" onClick={() => setFeedsOpen(true)}
          className="flex h-6 w-full shrink-0 items-center justify-center gap-2 border-t border-line bg-ink-950 font-mono text-micro uppercase tracking-[0.18em] text-bone-mute hover:text-bone">
          <Icon name="chevron-down" size={10} className="rotate-180" />Feeds
        </button>
      ))}
      {booted && <Timeline onSeek={seek} />}
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
