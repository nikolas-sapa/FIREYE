import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from '@ds';
import { useConsoleApi, useConsoleSelector } from '../store';
import { localTime, packZone } from '../ui/format';
import { jobStatusOf, replyFromAgent, sendLocal, useCommRows, type CommLane } from './opsStore';

type LaneFilter = 'all' | CommLane;
const LANES: { id: LaneFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'operator', label: 'Operator' }, { id: 'agent', label: 'Agent↔Agent' }, { id: 'system', label: 'System' },
];
const DOT = { queued: 'bg-bone-mute', running: 'animate-pulse bg-signal', done: 'bg-phosphor' } as const;

export function OpsComms({ agent, onClearAgent, composerRef }: {
  agent: string | null;
  onClearAgent: () => void;
  composerRef: React.Ref<HTMLInputElement>;
}) {
  const api = useConsoleApi();
  const pack = useConsoleSelector((s) => s.pack);
  const agents = useConsoleSelector((s) => [...new Set(s.jobs.map((j) => j.agent).filter((a) => a !== 'ORCH'))].sort());
  const tz = packZone(pack).label;
  const [lane, setLane] = useState<LaneFilter>('all');
  const [acks, setAcks] = useState(false);
  const [text, setText] = useState('');
  const [target, setTarget] = useState('ORCH');
  const rows = useCommRows(lane, { agent, showAcks: acks });
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => { if (agent) setTarget(agent); }, [agent]);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, lane, agent]);

  const targets = useMemo(() => ['ORCH', ...agents], [agents]);
  const targetW = `${Math.max(4, ...targets.map((x) => x.length)) + 3}ch`;

  const send = (q: string) => {
    const v = q.trim();
    if (!v) return;
    if (target === 'ORCH') {
      api.ask(v); // the user message lands in state.messages and is ingested into this feed
    } else {
      sendLocal(target, v);
      const agentName = target;
      window.setTimeout(() => replyFromAgent(agentName), 800);
    }
    setText('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {LANES.map((l) => (
          <button key={l.id} type="button" aria-pressed={lane === l.id} onClick={() => setLane(l.id)}
            className={cn('h-5 border px-1.5 font-mono text-micro uppercase tracking-[0.1em]', lane === l.id ? 'border-signal bg-signal/15 text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
            {l.label}
          </button>
        ))}
        <button type="button" aria-pressed={acks} onClick={() => setAcks((x) => !x)} title="Show ACK rows"
          className={cn('h-5 border px-1.5 font-mono text-micro uppercase tracking-[0.1em]', acks ? 'border-signal bg-signal/15 text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
          Acks
        </button>
        {agent && (
          <button type="button" onClick={onClearAgent} title="Clear thread filter"
            className="ml-auto flex h-5 items-center gap-1 border border-signal bg-signal/15 px-1.5 font-mono text-micro uppercase text-bone">
            {agent}<Icon name="close" size={9} />
          </button>
        )}
      </div>
      <div ref={list} aria-live="polite" onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {rows.map((r) => {
          const status = r.jobId ? jobStatusOf(r.jobId) : undefined;
          return (
            <div key={r.id} data-t={r.t} data-verb={r.verb ?? ''} title={`${r.from}${r.to ? ` → ${r.to}` : ''}${r.verb ? ` · ${r.verb}` : ''}\n${r.text}${r.meta ? `\n${r.meta}` : ''}`}
              className={cn('fireye-tick grid grid-cols-[44px_40px_minmax(0,1fr)] items-baseline gap-x-2 border-b border-l-2 border-line-faint py-1 font-mono text-micro leading-4 last:border-0',
                r.lane === 'operator' ? 'border-l-signal' : r.lane === 'agent' ? 'border-l-ice' : 'border-l-line')}>
              <span className="fcc-num pl-1.5 text-bone-mute">{localTime(r.t, tz)}</span>
              <span className="flex items-center gap-1">
                {status && <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0', DOT[status])} title={`job ${status}`} />}
                {r.verb && <span className="border border-line px-1 uppercase text-bone-mute">{r.verb}</span>}
                {r.sim && <span className="border border-line px-1 uppercase text-bone-mute">SIM</span>}
              </span>
              <span className="min-w-0">
                <span className="uppercase">
                  <span className={r.lane === 'operator' ? 'text-bone' : 'text-ice'}>{r.from}</span>
                  {r.to && <span className="text-bone-mute"> → <span className="text-ice">{r.to}</span></span>}
                </span>
                <span className={cn('break-words', r.lane === 'system' ? 'text-bone-mute' : 'text-bone-dim')}> {r.text}</span>
                {r.meta && <span className="block truncate text-bone-mute">{r.meta}</span>}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 py-6 text-bone-mute">
            <Icon name="send" size={14} />
            <span className="font-mono text-micro uppercase">No traffic yet</span>
            <span className="font-mono text-micro">Press / to message ORCH</span>
          </div>
        )}
      </div>
      <form className="flex shrink-0 items-stretch border-t border-line" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <select aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: targetW }}
          className="shrink-0 border-r border-line bg-ink-950 px-1.5 font-mono text-micro uppercase text-bone-dim focus:outline-none">
          {targets.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <input ref={composerRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${target}`} aria-label="Message"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-bone placeholder:text-bone-mute focus:outline-none" />
        <button type="submit" aria-label="Send" className="px-3 text-bone-dim hover:text-bone"><Icon name="send" size={12} /></button>
      </form>
    </div>
  );
}
