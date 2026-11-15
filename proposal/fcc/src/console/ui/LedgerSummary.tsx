import { useEffect, useState } from 'react';
import { Brackets, Button, Icon, LedgerCounter, ProvenanceTag, RegMark, Serial, cn } from '@ds';
import { useConsoleApi, useConsoleSelector } from '../store';
import { FccMark } from './CommandStrip';
import { fmtDuration } from './format';
import { meanAbsError, usePredictions } from './Prediction';
import { scenarioName } from './scenarios';
import { useUi } from './UiContext';

/** Full-screen end card for the Demo Director: the useful work the agents did. */
export function LedgerSummary() {
  const ui = useUi();
  const api = useConsoleApi();
  const enabled = useConsoleSelector((s) => s.director.enabled);
  const beat = useConsoleSelector((s) => s.director.beat);
  const total = useConsoleSelector((s) => s.director.beats.length);
  const l = useConsoleSelector((s) => s.ledger);
  const actions = useConsoleSelector((s) => s.actions);
  const pack = useConsoleSelector((s) => s.pack);
  const { latest } = usePredictions();
  const disclaimer = useConsoleSelector((s) => s.pack?.manifest.disclaimer) ?? 'Scenario built from public data; units, people and events are simulated.';
  const endBeat = enabled && total > 0 && beat === total - 1;
  const [closedAt, setClosedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!endBeat) setClosedAt(null);
  }, [endBeat]);
  const open = ui.summary || (endBeat && closedAt === null);
  if (!open) return null;
  const close = () => {
    ui.setSummary(false);
    if (endBeat) setClosedAt(beat);
  };
  const hours = l.analystMinutesSaved / 60;
  const facts = pack?.facts ?? [];
  const approved = actions.filter((a) => a.requiresApproval && (a.status === 'approved' || a.status === 'executing' || a.status === 'done')).length;
  const cells = [
    { label: 'Footage', value: l.footageReviewedS, format: fmtDuration },
    { label: 'Images analyzed', value: l.imagesAnalyzed },
    { label: 'Articles read', value: l.articlesRead },
    { label: 'Posts screened', value: l.postsScreened },
    { label: 'Satellite passes', value: l.satellitePasses },
    { label: 'Radio minutes', value: l.radioMinutesTranscribed },
    { label: 'Projections run', value: l.projectionsRun },
    { label: 'Drone tasks', value: l.droneTasksIssued },
    { label: 'Drafts written', value: l.draftsWritten },
    { label: 'Relayed', value: l.notificationsRelayed },
  ];
  // Agents repeat the same task many times; group identical work so the list shows its range.
  const work = new Map<string, { id: string; agent: string; text: string; minutes: number; n: number }>();
  for (const e of l.entries) {
    const k = e.agent + '|' + e.text;
    const w = work.get(k);
    if (w) {
      w.minutes += e.minutesSaved;
      w.n += 1;
    } else work.set(k, { id: e.id, agent: e.agent, text: e.text, minutes: e.minutesSaved, n: 1 });
  }
  const selected = [...work.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 12);
  return (
    <div role="dialog" aria-modal="true" aria-label="Agent work summary" className="fixed inset-0 z-modal flex items-center justify-center bg-ink-950/90 p-10">
      <div className="fcc-linegrid absolute inset-0 opacity-40" aria-hidden />
      <RegMark className="absolute left-6 top-6" />
      <RegMark className="absolute right-6 top-6" />
      <RegMark className="absolute bottom-6 left-6" />
      <RegMark className="absolute bottom-6 right-6" />
      <div className="relative w-full max-w-[1180px] animate-rise border border-line-strong bg-ink-900 shadow-lift">
        <Brackets size={12} tone="bone" inset={-6} />
        <header className="flex h-12 items-center gap-3 border-b border-line px-5">
          <FccMark size={20} />
          <span className="font-mono text-nano uppercase tracking-[0.16em] text-bone">Agent Work Ledger</span>
          <span className="font-mono text-micro uppercase text-bone-mute">{scenarioName(pack)} replay · end of demo</span>
          <Serial className="ml-auto">FCC-LGR / REV D</Serial>
          <Button size="sm" variant="ghost" icon="close" onClick={close}>
            Close
          </Button>
        </header>
        <div className="grid grid-cols-[1.1fr_1.9fr]">
          <div className="flex flex-col justify-between gap-8 border-r border-line p-8">
            <div className="flex flex-col gap-4">
              <span className="fcc-label">Illustrative analyst-time estimate</span>
              <span className="flex items-baseline gap-3">
                <span className="font-mono text-6xl font-light leading-none text-bone fcc-num">{hours.toFixed(1)}</span>
                <span className="font-mono text-nano uppercase text-bone-mute">Hours</span>
              </span>
              <p className="max-w-sm text-lg leading-7 text-bone-dim">
                Simulated agents reviewed feeds and drafted work. You approved {approved} high-risk {approved === 1 ? 'draft' : 'drafts'}.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {latest?.iou != null && (
                <span className="font-mono text-micro uppercase text-bone-dim fcc-num">
                  Last check vs replay · {Math.round(latest.iou * 100)} % area overlap
                  {meanAbsError(latest) != null ? ` · mean timing error ${Math.round(meanAbsError(latest)!)} min` : ''}
                </span>
              )}
              <span className="fcc-micro">Estimate: human-equivalent minutes per task minus agent time</span>
              <span className="font-mono text-micro uppercase text-amber">{disclaimer}</span>
            </div>
          </div>
          <div className="flex flex-col">
            <div className="grid grid-cols-5 gap-px border-b border-line bg-line">
              {cells.map((c) => (
                <LedgerCounter key={c.label} size="md" label={c.label} value={c.value} format={c.format} className="bg-ink-900 p-4" />
              ))}
            </div>
            <div className={cn('flex flex-col overflow-y-auto p-5', facts.length ? 'max-h-[200px]' : 'max-h-[300px]')}>
              <span className="fcc-micro mb-2">Selected work</span>
              {selected.map((e) => (
                <div key={e.id} className="grid grid-cols-[96px_1fr_auto_auto] items-baseline gap-3 border-b border-line-faint py-1.5">
                  <span className="truncate font-mono text-micro uppercase text-ice">{e.agent}</span>
                  <span className="truncate text-sm leading-5 text-bone-dim">{e.text}</span>
                  <span className="font-mono text-micro text-bone-mute fcc-num">{e.n > 1 ? `×${e.n}` : ''}</span>
                  <span className="font-mono text-micro text-phosphor fcc-num">+{e.minutes.toFixed(0)} min</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {facts.length > 0 && (
          <section aria-label="The real fire" className="border-t border-line">
            <div className="flex h-9 items-center gap-3 px-5">
              <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">The real fire</span>
              <ProvenanceTag kind="real" label="Real · sourced" />
              <span className="font-mono text-micro uppercase text-bone-mute">The people and units in this replay are fictional.</span>
            </div>
            <div className={cn('grid gap-px border-t border-line bg-line', facts.length >= 4 ? 'grid-cols-4' : facts.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
              {facts.slice(0, 8).map((fct) => (
                <a
                  key={fct.id}
                  href={fct.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex flex-col gap-1 bg-ink-900 px-5 py-3 transition-colors duration-quick ease-servo hover:bg-ink-850 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
                >
                  <span className="font-mono text-micro uppercase text-bone-mute">{fct.label}</span>
                  <span className="text-base leading-6 text-bone">{fct.value}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-micro uppercase text-ink-400 group-hover:text-bone-dim">
                    {fct.source}
                    <Icon name="arrow-up-right" size={9} />
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}
        <footer className="flex h-11 items-center justify-between border-t border-line px-5">
          <span className="font-mono text-micro uppercase text-bone-mute">FCC // Fire Command Center // incident watch officer made of agents</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => api.director.prev()}>
              Previous beat
            </Button>
            <Button size="sm" variant="primary" onClick={() => (close(), api.director.stop())}>
              Explore freely
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
