import { FireyeMark, Icon, Modal, cn } from '@ds';
import { useConsoleSelector } from '../../store';
import { localTime, packZone } from '../../ui/format';
import { SOURCE_LABELS, sourceFlow } from '../data/source-flow';
import { useChronicle } from './sync';
import { useEffect, useRef } from 'react';

const STAGES = [
  ['ingest', 'Source intake', 'Observations received'],
  ['analysis', 'Analysis agents', 'Findings and running jobs'],
  ['orchestrator', 'Orchestrator', 'Recorded tasking decisions'],
  ['execution', 'Drone execution', 'Observation and station events'],
] as const;

export function SourceFlow({ id, onClose, onOpenFeed }: { id: string; onClose: () => void; onOpenFeed: (id: string) => void }) {
  const state = useConsoleSelector(s => s), ch = useChronicle();
  const feed = state.feeds.find(f => f.id === id);
  const station = state.recon?.stations?.find(s => s.id === id);
  const steps = sourceFlow(state, ch, id);
  const title = feed?.label ?? station?.name ?? SOURCE_LABELS[id] ?? id;
  const linked = steps.some(s => s.stage === 'orchestrator');
  const tz = packZone(state.pack).label;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = body.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button,select,input,a[href],[tabindex="0"]')).filter(n => n.offsetParent !== null);
      const first = nodes[0], last = nodes[nodes.length - 1];
      const atDialog = document.activeElement === dialog || !dialog.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || atDialog)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || atDialog)) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, []);
  return (
    <Modal open onClose={onClose} title={`${title} · analysis & decision flow`} className="max-w-4xl">
      <div ref={body}>
        <div className="mb-4 flex items-start gap-4 border-b border-line pb-4">
          <FireyeMark size={42} state={steps.some(s => s.status === 'running') ? 'thinking' : 'idle'} />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg text-bone">Source → analysis → Orchestrator → reconnaissance</h3>
            <p className="mt-1 text-xs leading-5 text-bone-mute">Recorded exercise observations, analysis jobs and tasking at {localTime(state.clock.t, tz)} {tz}. No hidden reasoning or human approval queue.</p>
            <p className="mt-1 text-xs text-bone-dim">{linked ? 'Linked commands below include this source in their recorded evidence references.' : 'No source-linked drone command is recorded in the retained history. Context is not proof of a tasking decision.'}</p>
          </div>
          {feed && <button type="button" onClick={() => { onClose(); onOpenFeed(feed.id); }} className="flex shrink-0 items-center gap-2 border border-line px-3 py-2 font-mono text-micro uppercase text-bone hover:bg-ink-800"><Icon name="camera" size={13} />{feed.offlineReason ? 'View offline feed' : 'Open live feed'}</button>}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
          {STAGES.map(([key, label, hint]) => {
            const records = steps.filter(s => s.stage === key), running = records.filter(s => s.status !== 'done').length;
            return <div key={key} className="bg-ink-950 p-3">
              <p className="font-mono text-micro uppercase text-bone">{label}</p>
              <p className={cn('mt-2 font-mono text-xs', running ? 'text-ice' : 'text-bone-dim')}>{running ? `${running} in progress` : `${records.length} recorded`}</p>
              <p className="mt-1 text-xs text-bone-mute">{hint}</p>
            </div>;
          })}
        </div>
        {station && <div className="mb-4 grid grid-cols-3 gap-px bg-line">
          {state.recon?.drones?.filter(d => d.stationId === station.id).map(d => {
            const unit = state.units.find(u => u.id === d.unitId)!;
            return <div key={d.unitId} className="bg-ink-950 p-3 font-mono text-micro uppercase"><p>{unit.callsign}</p><p className="mt-1 text-bone-mute">{d.phase} · {Math.round((unit.battery ?? 0) * 100)}%</p></div>;
          })}
        </div>}
        <ol className="space-y-0 divide-y divide-line">
          {[...steps].reverse().map(s => <li key={`${s.stage}-${s.id}`} className="flex gap-3 py-3">
            <time className="fcc-num w-12 shrink-0 font-mono text-micro text-bone-mute">{localTime(s.t, tz)}</time>
            <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-pill', s.status === 'running' ? 'animate-pulse bg-ice' : s.stage === 'orchestrator' ? 'bg-ice' : 'bg-bone-mute')} />
            <div className="min-w-0 flex-1"><p className="font-mono text-micro uppercase text-bone-mute">{s.stage} · {s.status}</p><p className="mt-1 text-sm text-bone">{s.title}</p>{s.body && <p className="mt-1 text-xs leading-5 text-bone-dim">{s.body}</p>}</div>
          </li>)}
        </ol>
        {!steps.length && <p className="border border-line p-6 text-center text-bone-mute">No recorded activity for this source at this point in the exercise.</p>}
        <p className="mt-4 font-mono text-micro uppercase text-bone-mute">Simulated · current playhead only · latest 120 linked records · not an audit archive</p>
      </div>
    </Modal>
  );
}
