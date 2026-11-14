import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brackets, Drawer, IconRail, InterruptBanner, cn } from '@ds';
import { TacticalMap } from '@/dashboard/map';
import { useSim } from '@/sim';
import { DEFAULT_LAYERS, type MapLayers, type OrchAlert, type SimSnapshotB, type Vec } from '@/sim/types';
import { CommandBar } from './CommandBar';
import { AgentsDrawer, FeedsDrawer, ForcesDrawer, LayersDrawer, LogDrawer } from './drawers';
import { dist, zuluAt } from './format';
import { MetricStrip, ObservationCard, PathChip, PipCamera, TitleBlock } from './MapOverlays';
import { OrchestratorDock } from './OrchestratorDock';
import type { ConsoleActions, DrawerId, MapMode, ViewMode } from './types';
import { SCROLL } from './ui';

const DRAWERS: Record<DrawerId, { index: string; title: string }> = {
  forces: { index: '01', title: 'Forces' },
  feeds: { index: '02', title: 'Camera feeds' },
  agents: { index: '03', title: 'Agent pipeline' },
  layers: { index: '04', title: 'Map layers' },
  log: { index: '05', title: 'Alert log' },
};

type Focus = { pos: Vec; zoom?: number; key: string } | null;

/** Isolated so the canvas map never re-renders with the 4 Hz snapshot. */
const MapLayer = memo(function MapLayer(props: {
  layers: MapLayers;
  selectedId: string | null;
  onSelect(id: string | null): void;
  mode: MapMode;
  focus: Focus;
  highlightId: string | null;
}) {
  return <TacticalMap className="absolute inset-0" {...props} />;
});

/** Mount-then-show so an element can transition in from an offset state. */
function useEntered(key: string | undefined) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(false);
    if (!key) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(id);
  }, [key]);
  return on;
}

/** Best camera to show as the source for an alert: the feed watching it, a feed it cites, or the nearest live feed. */
function sourceFeedFor(state: SimSnapshotB, a: OrchAlert) {
  const byObs = a.observationId ? state.feeds.find((f) => f.focusObservationId === a.observationId) : undefined;
  if (byObs) return byObs;
  const cited = state.feeds.find((f) => a.sourceIds.includes(f.id) || (f.unitId != null && a.sourceIds.includes(f.unitId)));
  if (cited) return cited;
  if (!a.pos) return undefined;
  let best: (typeof state.feeds)[number] | undefined;
  let bd = 30;
  for (const f of state.feeds) {
    if (!f.live) continue;
    const d = dist(f.pos, a.pos);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/**
 * FCC REV B console: command bar, icon rail with drawers, map, Orchestrator dock.
 * Must be rendered inside <SimProvider>. Fills its parent; on lg+ the parent should have a fixed height.
 */
export default function Dashboard({ className }: { className?: string }) {
  const sim = useSim();
  const state = sim.state;

  const [view, setView] = useState<ViewMode>('calm');
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [lastDrawer, setLastDrawer] = useState<DrawerId | null>(null);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<MapMode>('oblique');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightAlert, setHighlightAlert] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [pip, setPip] = useState<{ feedId: string; caption?: string } | null>(null);
  const [logSeenAt, setLogSeenAt] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const simRef = useRef(sim);
  simRef.current = sim;
  const focusSeq = useRef(0);

  const flyTo = useCallback((pos: Vec, zoom?: number) => {
    focusSeq.current += 1;
    setFocus({ pos: { x: pos.x, y: pos.y }, zoom, key: `f${focusSeq.current}` });
  }, []);

  const openFeed = useCallback((feedId: string, caption?: string) => setPip({ feedId, caption }), []);

  const openDrawer = useCallback((id: DrawerId | null) => {
    setDrawer((cur) => (cur === id ? null : id));
    if (id) setLastDrawer(id);
  }, []);

  const focusAlert = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const a = s.alerts.find((x) => x.id === id);
      if (!a) return;
      setHighlightAlert(a.id);
      setSelectedId(a.observationId ?? a.movementId ?? null);
      if (a.pos) flyTo(a.pos, 2.4);
      const feed = sourceFeedFor(s, a);
      if (feed) setPip({ feedId: feed.id, caption: a.title });
    },
    [flyTo],
  );

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) setHighlightAlert(null);
  }, []);

  const onMapSelect = useCallback(
    (id: string | null) => {
      if (!id) {
        select(null);
        return;
      }
      const s = stateRef.current;
      if (s.alerts.some((a) => a.id === id)) {
        focusAlert(id);
        return;
      }
      const feed = s.feeds.find((f) => f.id === id || f.unitId === id);
      if (feed) setPip({ feedId: feed.id });
      setHighlightAlert(null);
      setSelectedId(id);
    },
    [focusAlert, select],
  );

  const actions: ConsoleActions = useMemo(
    () => ({ flyTo, select, openFeed, focusAlert, openDrawer }),
    [flyTo, select, openFeed, focusAlert, openDrawer],
  );

  // Keep drawer content mounted through the exit slide, then release it (feeds drawer runs live cameras).
  useEffect(() => {
    if (drawer) return;
    const id = window.setTimeout(() => setLastDrawer(null), 480);
    return () => window.clearTimeout(id);
  }, [drawer]);

  useEffect(() => {
    if (!drawer && !pip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawer) setDrawer(null);
      else setPip(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, pip]);

  useEffect(() => {
    if (drawer === 'log') setLogSeenAt(state.t);
  }, [drawer, state.t]);

  // Engine holds further interrupts as `queued` behind the one on screen; prefer the unqueued one.
  const interrupts = useMemo(
    () => state.alerts.filter((a) => a.tier === 0 && !a.ack && !a.resolved).sort((a, b) => Number(!!a.queued) - Number(!!b.queued) || b.score - a.score),
    [state.alerts],
  );
  const interrupt = interrupts[0];
  const bannerIn = useEntered(interrupt?.id);

  const unread = state.alerts.filter((a) => a.at > logSeenAt);
  const unreadUrgent = unread.some((a) => a.tier <= 1);
  const liveFeeds = state.feeds.filter((f) => f.live).length;

  const railItems = [
    { id: 'forces', icon: 'engine' as const, label: 'Forces' },
    { id: 'feeds', icon: 'camera' as const, label: 'Feeds', badge: liveFeeds || undefined, tone: 'telemetry' as const },
    { id: 'agents', icon: 'agents' as const, label: 'Agents' },
    { id: 'layers', icon: 'layers' as const, label: 'Layers' },
    {
      id: 'log',
      icon: 'log' as const,
      label: 'Log',
      badge: drawer !== 'log' && unread.length > 0 ? unread.length : undefined,
      tone: unreadUrgent ? ('danger' as const) : ('neutral' as const),
    },
  ];

  const pipFeed = pip ? state.feeds.find((f) => f.id === pip.feedId) : undefined;
  const selectedObs = selectedId ? state.observations.find((o) => o.id === selectedId) : undefined;
  const highlightA = highlightAlert ? state.alerts.find((a) => a.id === highlightAlert) : undefined;
  const mapHighlight = highlightA ? highlightA.observationId ?? highlightA.movementId ?? highlightA.id : null;
  const shownDrawer = drawer ?? lastDrawer;
  const drawerWidth = shownDrawer === 'agents' || shownDrawer === 'log' || view === 'detail' ? 420 : 360;

  return (
    <div className={cn('flex min-h-0 flex-col bg-ink-950 text-bone lg:h-full', className)}>
      <CommandBar sim={sim} view={view} onView={setView} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <IconRail
          className="max-lg:w-full max-lg:flex-row max-lg:border-b max-lg:border-r-0"
          items={railItems}
          value={drawer}
          onChange={(id) => openDrawer(id as DrawerId | null)}
        />

        <div className="relative h-[620px] min-w-0 shrink-0 overflow-hidden bg-void lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
          <MapLayer layers={layers} selectedId={selectedId} onSelect={onMapSelect} mode={mode} focus={focus} highlightId={mapHighlight} />

          <div className="pointer-events-none absolute inset-0 z-overlay">
            <Brackets size={10} tone="line" inset={6} />

            <div className="absolute left-3 top-3 flex flex-col items-start gap-1">
              <TitleBlock />
              <PathChip rev={state.forecastRev} t={state.t} />
            </div>

            <div className="pointer-events-auto absolute bottom-10 left-3">
              <MetricStrip state={state} />
            </div>

            <div className="absolute bottom-3 right-14 flex flex-col items-end gap-2">
              {selectedObs && <ObservationCard key={selectedObs.id} obs={selectedObs} t={state.t} onClose={() => select(null)} />}
              {pipFeed && (
                <PipCamera
                  feed={pipFeed}
                  feeds={state.feeds}
                  caption={pip?.caption}
                  onSwap={(id) => setPip({ feedId: id })}
                  onClose={() => setPip(null)}
                />
              )}
            </div>
          </div>

          {interrupt && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-0 z-overlay border border-ember/60">
                <div className="absolute inset-[3px] border border-ember/15" />
              </div>
              {/* Centered over the visible map: shifts right of an open drawer. */}
              <div
                className="pointer-events-none absolute right-0 top-3 z-toast flex justify-center px-3 transition-[left] duration-slow ease-settle"
                style={{ left: drawer ? drawerWidth : 0 }}
              >
                <div
                  className={cn(
                    'pointer-events-auto w-full max-w-[520px] transition-[transform,opacity] duration-slow ease-settle',
                    bannerIn ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0',
                  )}
                >
                  <InterruptBanner
                    cls={interrupt.cls}
                    title={interrupt.title}
                    body={interrupt.body}
                    score={interrupt.score}
                    time={zuluAt(state.clock, state.t, interrupt.at)}
                    notify={interrupt.notify}
                    onAck={() => simRef.current.ackAlert(interrupt.id)}
                    onLocate={interrupt.pos ? () => focusAlert(interrupt.id) : undefined}
                  />
                </div>
              </div>
            </>
          )}

          <Drawer
            open={drawer != null}
            onClose={() => setDrawer(null)}
            side="left"
            width={drawerWidth}
            index={shownDrawer ? DRAWERS[shownDrawer].index : undefined}
            title={shownDrawer ? DRAWERS[shownDrawer].title : ''}
          >
            <div className={cn(SCROLL, 'h-full')}>
              {shownDrawer === 'forces' && <ForcesDrawer state={state} selectedId={selectedId} actions={actions} />}
              {shownDrawer === 'feeds' && <FeedsDrawer state={state} activeFeedId={pip?.feedId ?? null} actions={actions} />}
              {shownDrawer === 'agents' && <AgentsDrawer state={state} />}
              {shownDrawer === 'layers' && <LayersDrawer layers={layers} onLayers={setLayers} mode={mode} onMode={setMode} />}
              {shownDrawer === 'log' && <LogDrawer state={state} highlightId={highlightAlert} actions={actions} />}
            </div>
          </Drawer>
        </div>

        <OrchestratorDock
          className="h-[760px] border-t border-line lg:h-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-t-0"
          sim={sim}
          view={view}
          highlightId={highlightAlert}
          actions={actions}
        />
      </div>
    </div>
  );
}

export { Dashboard };
