import { useCallback, useRef, useState } from 'react';
import { cn } from '@ds';
import { useSim } from '@/sim';
import { DEFAULT_LAYERS, type MapLayers } from '@/sim/types';
import { AgentPanel, type AgentTab } from './AgentPanel';
import { BottomStrip } from './BottomStrip';
import { ForcesPanel, SituationPanel } from './LeftRail';
import { MapStage, type MapMode } from './MapStage';
import { TopBar } from './TopBar';

/**
 * FCC live command surface. Must be rendered inside <SimProvider>.
 * Fills its parent; on lg+ the parent should have a fixed height.
 */
export default function Dashboard({ className }: { className?: string }) {
  const sim = useSim();
  const { state } = sim;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [mode, setMode] = useState<MapMode>('oblique');
  const [tab, setTab] = useState<AgentTab>('recs');
  const [focusIngestId, setFocusIngestId] = useState<string | null>(null);

  // useSim() may hand back fresh closures each render; keep callbacks stable so memoized lists can skip.
  const simRef = useRef(sim);
  simRef.current = sim;
  const accept = useCallback((id: string) => simRef.current.accept(id), []);
  const dismiss = useCallback((id: string) => simRef.current.dismiss(id), []);

  const toggleLayer = useCallback((k: keyof MapLayers) => setLayers((l) => ({ ...l, [k]: !l[k] })), []);
  const showSource = useCallback((id: string) => {
    setTab('intel');
    setFocusIngestId(id);
  }, []);
  const showRecs = useCallback(() => setTab('recs'), []);
  const changeTab = useCallback((t: AgentTab) => {
    setTab(t);
    if (t !== 'intel') setFocusIngestId(null);
  }, []);

  return (
    <div className={cn('flex min-h-0 flex-col bg-ink-950 text-bone lg:h-full', className)}>
      <TopBar sim={sim} />
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-px bg-line',
          'grid-cols-1',
          'lg:grid-cols-[272px_minmax(0,1fr)_352px] lg:grid-rows-[minmax(0,1fr)_136px]',
          'xl:grid-cols-[300px_minmax(0,1fr)_380px]',
        )}
      >
        <aside className="order-2 flex min-h-0 min-w-0 flex-col gap-px bg-line lg:order-none lg:max-h-none max-lg:max-h-[760px]">
          <SituationPanel state={state} />
          <ForcesPanel units={state.units} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <MapStage
          className="order-1 h-[560px] lg:order-none lg:h-auto"
          state={state}
          layers={layers}
          onToggleLayer={toggleLayer}
          mode={mode}
          onMode={setMode}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onShowSource={showSource}
          onShowRecs={showRecs}
        />

        <AgentPanel
          className="order-3 h-[640px] lg:order-none lg:h-auto"
          ingest={state.ingest}
          insights={state.insights}
          recommendations={state.recommendations}
          units={state.units}
          tab={tab}
          onTab={changeTab}
          focusIngestId={focusIngestId}
          onAccept={accept}
          onDismiss={dismiss}
          onSelect={setSelectedId}
        />

        <BottomStrip className="order-4 lg:order-none lg:col-span-3" state={state} />
      </div>
    </div>
  );
}

export { Dashboard };
