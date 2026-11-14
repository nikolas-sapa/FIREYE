import { useEffect, useRef } from 'react';
import { Brackets, Dot, ThemeToggle, toggleTheme } from '@ds';
import { ConsoleProvider, useConsoleApi, useConsoleSelector } from './store';
import { BottomStrip } from './ui/BottomStrip';
import { CommandStrip, FccMark } from './ui/CommandStrip';
import { Drawers } from './ui/Drawers';
import { LeftRail } from './ui/LeftRail';
import { LedgerSummary } from './ui/LedgerSummary';
import { OrchestratorColumn } from './ui/OrchestratorColumn';
import { StageArea } from './ui/StageArea';
import { UiProvider, useUi } from './ui/UiContext';
import type { RoleLens } from './contracts';
import { packZone, registerZone } from './ui/format';
import { scenarioEntry, scenarioName } from './ui/scenarios';

const LENS_KEYS: Record<string, RoleLens> = { '1': 'ic', '2': 'ops', '3': 'air', '4': 'ems' };

function isTyping(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable);
}

function useKeyboard() {
  const api = useConsoleApi();
  const ui = useUi();
  const paused = useConsoleSelector((s) => s.clock.paused);
  const director = useConsoleSelector((s) => s.director.enabled);
  const ref = useRef({ api, ui, paused, director });
  ref.current = { api, ui, paused, director };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { api, ui, paused, director } = ref.current;
      const k = e.key;
      if (k === ' ') {
        if ((e.target as HTMLElement | null)?.closest('button,[role="button"],[role="slider"],a')) return;
        e.preventDefault();
        api.setPaused(!paused);
      } else if (k === 'd' || k === 'D') {
        if (director) api.director.stop();
        else api.director.start();
      } else if (k === 'ArrowRight' && director) {
        e.preventDefault();
        api.director.next();
      } else if (k === 'ArrowLeft' && director) {
        e.preventDefault();
        api.director.prev();
      } else if (k === 'Escape') {
        if (ui.summary) ui.setSummary(false);
        else ui.setPanel(null);
      } else if (k === 'l' || k === 'L') {
        ui.setLegend(!ui.legend);
      } else if (k === 't' || k === 'T') {
        toggleTheme();
      } else if (LENS_KEYS[k]) {
        api.setLens(LENS_KEYS[k]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** `?beat=N` jumps the Demo Director to beat N (0-based) once the scenario is ready; `?captions=0` hides captions. */
function useQueryBeat() {
  const api = useConsoleApi();
  const ready = useConsoleSelector((s) => s.ready);
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const q = new URLSearchParams(window.location.search);
    const beat = q.get('beat');
    if (beat != null && Number.isFinite(Number(beat))) {
      api.director.start();
      api.director.goto(Math.max(0, Math.floor(Number(beat))));
    }
    if (q.get('captions') === '0') api.director.setCaptions(false);
    if (import.meta.env.DEV) (window as unknown as { __fccConsole?: unknown }).__fccConsole = api;
  }, [ready, api]);
}

function Boot() {
  const name = scenarioEntry()?.name ?? 'scenario';
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-ink-950">
      <div className="fcc-linegrid absolute inset-0 opacity-50" aria-hidden />
      <div className="relative flex w-[420px] flex-col gap-4 border border-line bg-ink-900 p-6">
        <Brackets size={8} tone="bone" />
        <div className="flex items-center gap-3">
          <FccMark size={24} />
          <span className="font-mono text-nano uppercase tracking-[0.16em] text-bone">FCC console · REV D</span>
          <ThemeToggle compact className="ml-auto" />
        </div>
        <div className="flex items-center gap-2">
          <Dot className="bg-ice" live size={6} />
          <span className="font-mono text-micro uppercase text-ice">Loading {name} scenario pack</span>
        </div>
        <div className="relative h-px overflow-hidden bg-line">
          <span className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-ice" />
        </div>
        <span className="font-mono text-micro uppercase leading-4 text-bone-mute">
          Perimeters · terrain · weather · roads · structures · imagery. Scenario built from public data; units, people and events are simulated.
        </span>
      </div>
    </div>
  );
}

/** Clocks read the pack's own zone; the tab title names the active scenario. */
function useScenarioChrome() {
  const pack = useConsoleSelector((s) => s.pack);
  if (pack) {
    const z = packZone(pack);
    registerZone(z.label, z.offsetMin);
  }
  useEffect(() => {
    document.title = `FCC Console — ${scenarioName(pack)} replay`;
  }, [pack]);
}

function Shell() {
  const ready = useConsoleSelector((s) => s.ready);
  useKeyboard();
  useQueryBeat();
  useScenarioChrome();
  if (!ready) return <Boot />;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-950 text-bone">
      <CommandStrip />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <StageArea />
          <BottomStrip />
          <Drawers />
        </main>
        <OrchestratorColumn className="w-[400px] shrink-0 max-[1700px]:w-[360px]" />
      </div>
      <LedgerSummary />
    </div>
  );
}

export default function ConsoleApp() {
  return (
    <ConsoleProvider>
      <UiProvider>
        <div className="h-screen w-screen overflow-hidden">
          <Shell />
        </div>
      </UiProvider>
    </ConsoleProvider>
  );
}
