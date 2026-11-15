import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn, type IconName } from '@ds';
import type { Geo, Ms } from '../../contracts';
import { useConsoleSelector } from '../../store';
import { localTime, packZone } from '../../ui/format';
import { visibleAt } from '../data/chronicle';
import type { ChronicleEntry, ChronicleKind } from '../data/types';
import { useChronicle } from './sync';
import { fireyeUi, useFireye } from './ui';

export const KIND_ICON: Record<ChronicleKind, IconName> = {
  radio: 'radio', iot: 'sensor', web: 'web', report: 'news', satellite: 'satellite', social: 'social', weather: 'wind',
  analysis: 'ai', orchestrator: 'orchestrator', fleet: 'drone', command: 'check', projection: 'route', detection: 'target',
};
const KIND_LABEL: Record<ChronicleKind, string> = {
  radio: 'Radio', iot: 'IoT', web: 'Web', report: 'Reports', satellite: 'Satellite', social: 'Social', weather: 'Weather',
  analysis: 'Analysis', orchestrator: 'Orchestrator', fleet: 'Fleet', command: 'Decisions', projection: 'Projection', detection: 'Detection',
};
const SEV_BAR = { info: 'bg-ink-600', watch: 'bg-amber', alert: 'bg-ember/70', critical: 'bg-ember' } as const;
const PROV = { simulated: 'SIM', historical: 'HIST', derived: 'DERIVED' } as const;

function Row({ e, fresh, tz, onFocus, onSeek }: { e: ChronicleEntry; fresh: boolean; tz: string; onFocus: (g: Geo) => void; onSeek: (t: Ms) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn('group relative border-b border-line-faint', fresh && 'fireye-row-in')}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-0.5', SEV_BAR[e.severity])} />
      <button type="button" onClick={() => { setOpen(!open); if (e.pos) onFocus(e.pos); }} aria-expanded={open}
        className="flex w-full items-start gap-2.5 py-2 pl-3.5 pr-3 text-left hover:bg-ink-900">
        <span className="mt-0.5 flex w-9 shrink-0 flex-col items-start gap-1">
          <span className="fcc-num font-mono text-micro text-bone-dim">{localTime(e.t, tz)}</span>
          <Icon name={KIND_ICON[e.kind]} size={11} className={e.severity === 'critical' ? 'text-ember' : 'text-bone-mute'} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.12em]">
            <span className="truncate text-bone-dim">{e.source}</span>
            {e.channel && <span className="shrink-0 text-bone-mute">· {e.channel}</span>}
            <span className={cn('ml-auto shrink-0 border px-1 leading-3', e.provenance === 'historical' ? 'border-ice/40 text-ice' : 'border-line text-bone-mute')}>{PROV[e.provenance]}</span>
          </span>
          <span className={cn('mt-0.5 block text-xs leading-[17px]', e.severity === 'critical' ? 'text-bone' : 'text-bone-dim', !open && 'line-clamp-2')}>{e.title}</span>
          {open && e.body && <span className="mt-1 block text-xs leading-4 text-bone-mute">{e.body}</span>}
          {open && (
            <span className="mt-1.5 flex gap-3 font-mono text-micro uppercase text-bone-mute">
              <span role="button" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); onSeek(e.t); }} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); onSeek(e.t); } }} className="underline hover:text-bone">Seek here</span>
              {e.url && <a href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="underline hover:text-bone">Source</a>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function LogColumn({ onFocus, onSeek }: { onFocus: (g: Geo) => void; onSeek: (t: Ms) => void }) {
  const ch = useChronicle();
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const tab = useFireye((s) => s.tab);
  const [filter, setFilter] = useState<ChronicleKind | 'all'>('all');
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);
  const seen = useRef<Ms>(t);
  const tz = packZone(pack).label;
  const tSec = Math.floor(t / 1000) * 1000;
  const events = useConsoleSelector(s => s.recon?.events);
  const visible = useMemo(() => (ch ? visibleAt(ch, tSec) : []), [ch, tSec]);
  const all = useMemo(() => [...visible, ...(events ?? []).filter(e => e.t <= tSec)].sort((a, b) => b.t - a.t || (a.id < b.id ? 1 : -1)), [visible, events, tSec]);
  const counts = { intake: all.filter((e) => e.tab === 'intake').length, ops: all.filter((e) => e.tab === 'ops').length };
  const inTab = all.filter((e) => e.tab === tab);
  const kinds = [...new Set(inTab.map((e) => e.kind))];
  const rows = (filter === 'all' ? inTab : inTab.filter((e) => e.kind === filter)).slice(0, 220);
  const freshFrom = seen.current;
  useEffect(() => { seen.current = tSec; });
  useEffect(() => { setFilter('all'); }, [tab]);
  useEffect(() => { if (follow && listRef.current) listRef.current.scrollTop = 0; }, [rows.length, follow, tab]);
  // A backward scrub should not animate the rows that reappear.
  const jumpBack = tSec < freshFrom;

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950">
      <div role="tablist" aria-label="Log" className="fireye-enter relative flex h-9 shrink-0 items-stretch border-b border-line" style={{ ['--i' as string]: 1 }}>
        {(['intake', 'ops'] as const).map((id) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => fireyeUi.set({ tab: id })}
            className={cn('flex flex-1 items-center justify-center gap-2 font-mono text-nano uppercase tracking-[0.2em] transition-colors duration-quick ease-servo',
              tab === id ? 'text-bone' : 'text-bone-mute hover:text-bone-dim')}>
            {id === 'intake' ? 'Intake' : 'Ops'}
            <span className="fcc-num text-micro text-bone-mute">{counts[id]}</span>
          </button>
        ))}
        <span aria-hidden className="absolute bottom-[-1px] h-px w-1/2 bg-bone transition-transform duration-base ease-servo" style={{ transform: `translateX(${tab === 'ops' ? 100 : 0}%)` }} />
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {(['all', ...kinds] as const).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
            className={cn('shrink-0 border px-1.5 font-mono text-micro uppercase leading-5', filter === k ? 'border-bone-dim text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
            {k === 'all' ? 'All' : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <ul ref={listRef} className="h-full overflow-y-auto" onScroll={(e) => setFollow(e.currentTarget.scrollTop < 24)} aria-live="polite">
          {rows.length === 0 && <li className="px-3 py-6 text-center font-mono text-micro uppercase text-bone-mute">Nothing received yet at this time</li>}
          {rows.map((e) => <Row key={e.id} e={e} tz={tz} fresh={!jumpBack && e.t > freshFrom} onFocus={onFocus} onSeek={onSeek} />)}
        </ul>
        {!follow && (
          <button type="button" onClick={() => { setFollow(true); if (listRef.current) listRef.current.scrollTop = 0; }}
            className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 border border-line-strong bg-ink-900 px-2 py-1 font-mono text-micro uppercase text-bone shadow-panel">
            <Icon name="arrow-up-right" size={10} />Jump to now
          </button>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3 py-1.5 font-mono text-micro uppercase leading-4 text-bone-mute">
        {tab === 'intake' ? 'Outside sources. Radio and web items are simulated; reports are historical and untrusted.' : 'Our analysis, orchestration and fleet work. Simulated exercise.'}
      </div>
    </div>
  );
}
