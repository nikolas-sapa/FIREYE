import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from '@ds';
import type { Unit } from '../contracts';
import { useConsoleSelector } from '../store';
import { ago } from '../ui/format';
import type { StageEngine } from '../stage3d/StageEngine';
import { fireyeUi, useFireye, VIS_GROUPS, type VisGroup, type VisPreset } from '../fireye/shell/ui';

export type RailTab = 'layers' | 'objects' | 'agents';

const SECTIONS: { title: string; keys: VisGroup[] }[] = [
  { title: 'Assets', keys: ['fleet', 'groundUnits', 'groundCams', 'iot'] },
  { title: 'Sensing', keys: ['flightPaths', 'footprints', 'findings'] },
  { title: 'Incident', keys: ['fireFront', 'projections', 'risk'] },
  { title: 'Map', keys: ['roadsPlaces', 'labels'] },
];

function LayersTab() {
  const vis = useFireye((s) => s.vis);
  const preset = useFireye((s) => s.preset);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="radiogroup" aria-label="Visibility preset" className="grid shrink-0 grid-cols-3 gap-px border-b border-line bg-line">
        {(['minimal', 'standard', 'everything'] as VisPreset[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={preset === p} onClick={() => fireyeUi.preset(p)}
            className={cn('h-7 font-mono text-micro uppercase tracking-[0.14em]', preset === p ? 'bg-ink-700 text-bone' : 'bg-ink-950 text-bone-mute hover:text-bone-dim')}>
            {p}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {SECTIONS.map((s) => (
          <div key={s.title} className="border-b border-line-faint py-2 last:border-0">
            <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">{s.title}</span>
            <ul className="mt-1">
              {s.keys.map((k) => (
                <li key={k}>
                  <label className="flex h-7 cursor-pointer items-center gap-2.5 text-xs text-bone-dim hover:text-bone">
                    <input type="checkbox" checked={vis[k]} onChange={(e) => fireyeUi.setVis(k, e.target.checked)} className="peer sr-only" />
                    <span aria-hidden className={cn('flex h-3 w-3 items-center justify-center border', vis[k] ? 'border-bone bg-bone text-ink-950' : 'border-line-strong')}>
                      {vis[k] && <Icon name="check" size={9} />}
                    </span>
                    {VIS_GROUPS[k]}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ objects */

type FilterId = 'air' | 'ground' | 'ems' | 'detections' | 'stale';
const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'air', label: 'Air/UAV' }, { id: 'ground', label: 'Ground' }, { id: 'ems', label: 'EMS' },
  { id: 'detections', label: 'Detections' }, { id: 'stale', label: 'Stale' },
];
const AIR = new Set<Unit['kind']>(['drone', 'helo', 'tanker']);
const GROUND = new Set<Unit['kind']>(['engine', 'crew', 'dozer', 'law']);

function Glyph({ kind }: { kind: 'unit' | 'hazard' | 'detect' }) {
  if (kind === 'unit') return <span aria-hidden className="h-2.5 w-3.5 shrink-0 border border-signal bg-signal/30" />;
  if (kind === 'hazard') return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rotate-45 border border-ember bg-ember/30" />;
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-amber">
      <path d="M6 1.5a4.5 4.5 0 1 1-.01 9.01A4.5 4.5 0 0 1 6 1.5zM6 4v4M4 6h4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ObjectsTab({ engine }: { engine: StageEngine | null }) {
  const units = useConsoleSelector((s) => s.units);
  const findings = useConsoleSelector((s) => s.findings);
  const t = useConsoleSelector((s) => s.clock.t);
  const selected = useFireye((s) => s.selected);
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<Set<FilterId>>(new Set());
  const toggle = (id: FilterId) => setChips((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const rows = useMemo(() => {
    type Row = { id: string; glyph: 'unit' | 'hazard' | 'detect'; label: string; sub: string; ageMs: number };
    const out: Row[] = [];
    const qq = q.trim().toLowerCase();
    const match = (s: string) => !qq || s.toLowerCase().includes(qq);
    for (const u of units) {
      if (!match(`${u.callsign} ${u.kind} ${u.status}`)) continue;
      let ok = true;
      if (chips.has('air') || chips.has('ground') || chips.has('ems')) {
        ok = (chips.has('air') && AIR.has(u.kind)) || (chips.has('ground') && GROUND.has(u.kind)) || (chips.has('ems') && u.kind === 'ems');
      }
      if (ok) out.push({ id: u.id, glyph: 'unit', label: u.callsign, sub: `${u.kind} · ${u.status}`, ageMs: 0 });
    }
    for (const f of findings) {
      if (!match(`${f.label} ${f.kind}`)) continue;
      const stale = f.freshness < 0.35 || !f.live;
      if (chips.has('stale') && !stale) continue;
      if ((chips.has('air') || chips.has('ground') || chips.has('ems')) && !chips.has('detections')) continue;
      const hazard = f.kind === 'spot' || f.kind === 'combustible' || f.kind === 'fuel';
      out.push({ id: f.id, glyph: hazard ? 'hazard' : 'detect', label: f.label, sub: `${f.kind} · conf ${f.confidence.toFixed(2)}`, ageMs: t - f.observedAt });
    }
    return out;
  }, [units, findings, q, chips, t]);

  const pick = (id: string) => {
    fireyeUi.set({ selected: id });
    const f = findings.find((x) => x.id === id);
    const g = engine?.geoOf(id) ?? f?.pos;
    if (g) engine?.flyTo(g, { rangeM: 2600, duration: 1.4 });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <div className="flex h-7 items-center gap-2 border border-line-strong bg-ink-900 px-2">
          <Icon name="search" size={11} className="text-bone-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search objects" aria-label="Search objects"
            className="min-w-0 flex-1 bg-transparent text-xs text-bone placeholder:text-bone-mute focus:outline-none" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={chips.has(f.id)} onClick={() => toggle(f.id)}
              className={cn('h-5 border px-1.5 font-mono text-micro uppercase tracking-[0.1em]', chips.has(f.id) ? 'border-signal bg-signal/15 text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Objects">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => pick(r.id)}
              className={cn('flex h-8 w-full items-center gap-2 border-b border-line-faint px-3 text-left', selected === r.id ? 'bg-ink-800' : 'hover:bg-ink-900')}>
              <Glyph kind={r.glyph} />
              <span className="min-w-0 flex-1 truncate text-xs text-bone">{r.label}</span>
              <span className="truncate font-mono text-micro uppercase text-bone-mute">{r.sub}</span>
              {r.ageMs > 0 && <span className="fcc-num shrink-0 font-mono text-micro text-bone-mute">{ago(t, t - r.ageMs)}</span>}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-4 text-center font-mono text-micro uppercase text-bone-mute">No objects match</li>}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ agents */

const AGENT_TONES = ['text-bone', 'text-ice', 'text-phosphor', 'text-violet', 'text-bone-dim', 'text-amber'] as const;
export function agentTone(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AGENT_TONES[Math.abs(h) % AGENT_TONES.length]!;
}

function AgentsTab({ onOpenThread }: { onOpenThread: (agent: string) => void }) {
  const pools = useConsoleSelector((s) => s.pools);
  const jobs = useConsoleSelector((s) => s.jobs);
  const [flash, setFlash] = useState<string | null>(null);
  const seenDone = useRef<Set<string> | null>(null);
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const done = jobs.filter((j) => j.status === 'done');
    if (!seenDone.current) { seenDone.current = new Set(done.map((j) => j.id)); return; }
    const news = done.filter((j) => !seenDone.current!.has(j.id));
    news.forEach((j) => seenDone.current!.add(j.id));
    if (news.length && !reduced.current) {
      setFlash(news[news.length - 1]!.poolId);
      const id = window.setTimeout(() => setFlash(null), 600);
      return () => window.clearTimeout(id);
    }
  }, [jobs]);
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Agent pools">
      {pools.map((p, i) => {
        const fromJob = jobs.find((j) => j.poolId === p.id)?.agent.replace(/-\d+$/, '');
        const prefix = fromJob ?? (p.id.replace(/^pool-/, '') || p.label.split(' ')[0]!).toUpperCase();
        const live = p.workers > 0;
        return (
          <li key={p.id}>
            <button type="button" onClick={() => onOpenThread(prefix)} title={`Open ${prefix} thread in comms`}
              className={cn('flex w-full flex-col gap-1 border-b border-l-2 border-line-faint border-l-transparent px-3 py-2 text-left transition-colors duration-base hover:bg-ink-900', flash === p.id && 'border-l-signal bg-ink-900')}>
              <span className="flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 shrink-0', live ? 'animate-pulse bg-signal' : 'bg-line-strong')} aria-hidden />
                <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">{prefix}-{String(i + 1).padStart(2, '0')}</span>
                <span className="truncate text-xs text-bone-dim">{p.label}</span>
                <span className="fcc-num ml-auto font-mono text-micro text-bone-mute">{p.workers}/{p.maxWorkers}</span>
              </span>
              <span className="flex items-center gap-2 pl-3.5">
                <span className="h-1 flex-1 bg-ink-800"><span className="block h-full bg-signal" style={{ width: `${p.maxWorkers ? (p.workers / p.maxWorkers) * 100 : 0}%` }} /></span>
                <span className="shrink-0 font-mono text-micro uppercase text-bone-mute">q{p.queue} · {Math.round(p.throughputPerMin)}/min · p50 {p.p50LatencyS.toFixed(1)}s</span>
              </span>
              <span className="truncate pl-3.5 font-mono text-micro uppercase text-bone-mute">{p.provider} · {p.model}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ rail */

export function OpsRail({ engine, onOpenThread }: { engine: StageEngine | null; onOpenThread: (agent: string) => void }) {
  const [tab, setTab] = useState<RailTab>('objects');
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-ink-950">
      <div role="tablist" aria-label="Rail" className="grid shrink-0 grid-cols-3 gap-px border-b border-line bg-line">
        {(['layers', 'objects', 'agents'] as RailTab[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('h-8 font-mono text-micro uppercase tracking-[0.14em]', tab === id ? 'bg-ink-700 text-bone' : 'bg-ink-950 text-bone-mute hover:text-bone-dim')}>
            {id}
          </button>
        ))}
      </div>
      {tab === 'layers' && <LayersTab />}
      {tab === 'objects' && <ObjectsTab engine={engine} />}
      {tab === 'agents' && <AgentsTab onOpenThread={onOpenThread} />}
    </aside>
  );
}
