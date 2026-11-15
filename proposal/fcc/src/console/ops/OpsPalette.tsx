import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, cn } from '@ds';
import { useConsoleSelector } from '../store';
import { ago } from '../ui/format';
import type { StageEngine } from '../stage3d/StageEngine';
import { VIS_GROUPS, fireyeUi, useFireye, type VisGroup } from '../fireye/shell/ui';

interface Item { id: string; kind: string; label: string; sub: string; run: () => void }

export function OpsPalette({ engine, onOpenThread, onClose }: {
  engine: StageEngine | null;
  onOpenThread: (agent: string) => void;
  onClose: () => void;
}) {
  const units = useConsoleSelector((s) => s.units);
  const findings = useConsoleSelector((s) => s.findings);
  const places = useConsoleSelector((s) => s.pack?.manifest.places ?? NO_PLACES);
  const pools = useConsoleSelector((s) => s.pools);
  const actions = useConsoleSelector((s) => s.actions);
  const jobs = useConsoleSelector((s) => s.jobs);
  const vis = useFireye((s) => s.vis);
  const t = useConsoleSelector((s) => s.clock.t);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    const qq = q.trim().toLowerCase();
    const match = (...s: string[]) => !qq || s.join(' ').toLowerCase().includes(qq);
    for (const u of units) if (match(u.callsign, u.kind, u.status)) out.push({
      id: `u:${u.id}`, kind: 'UNIT', label: u.callsign, sub: `${u.kind} · ${u.status}`,
      run: () => { fireyeUi.set({ selected: u.id }); const g = engine?.geoOf(u.id) ?? u.pos; if (g) engine?.flyTo(g, { rangeM: 2600, duration: 1.4 }); },
    });
    for (const f of findings) if (match(f.label, f.kind)) out.push({
      id: `f:${f.id}`, kind: 'FINDING', label: f.label, sub: `${f.kind} · unverified · ${ago(t, f.observedAt)}`,
      run: () => { fireyeUi.set({ selected: f.id }); if (f.pos) engine?.flyTo(f.pos, { rangeM: 2600, duration: 1.4 }); },
    });
    for (const p of places) if (match(p.name)) out.push({
      id: `p:${p.id}`, kind: 'PLACE', label: p.name, sub: 'place',
      run: () => engine?.flyTo(p.pos, { rangeM: 4000, duration: 1.4 }),
    });
    for (const p of pools) {
      const prefix = jobs.find((j) => j.poolId === p.id)?.agent.replace(/-\d+$/, '') ?? (p.id.replace(/^pool-/, '') || p.label.split(' ')[0]!).toUpperCase();
      if (match(prefix, p.label)) out.push({
        id: `a:${p.id}`, kind: 'AGENT', label: prefix, sub: `${p.label} · ${p.workers}/${p.maxWorkers} workers`,
        run: () => onOpenThread(prefix),
      });
    }
    for (const a of actions) if (match(a.title, a.status)) out.push({
      id: `x:${a.id}`, kind: 'ACTION', label: a.title, sub: `${a.status} · ${a.risk ?? ''}`,
      run: () => { const u = a.unitIds?.[0]; if (u) { fireyeUi.set({ selected: u }); const g = engine?.geoOf(u); if (g) engine?.flyTo(g, { rangeM: 2600, duration: 1.4 }); } document.dispatchEvent(new CustomEvent('ops:tab', { detail: 'inspect' })); },
    });
    for (const k of Object.keys(VIS_GROUPS) as VisGroup[]) if (match(VIS_GROUPS[k], 'layer')) out.push({
      id: `l:${k}`, kind: 'LAYER', label: VIS_GROUPS[k], sub: vis[k] ? 'layer · on' : 'layer · off',
      run: () => fireyeUi.setVis(k, !vis[k]),
    });
    return out.slice(0, 12);
  }, [q, units, findings, places, pools, actions, jobs, vis, t, engine, onOpenThread]);

  useEffect(() => setIdx(0), [items.length]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[idx]?.run(); onClose(); }
  };

  return (
    <div className="absolute inset-0 z-modal flex items-start justify-center bg-ink-950/60 pt-[12vh]" role="dialog" aria-label="Command palette" onClick={onClose}>
      <div className="w-[560px] border border-line-strong bg-ink-950 shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-9 items-center gap-2 border-b border-line px-3">
          <Icon name="search" size={12} className="text-bone-mute" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Units, findings, places, agents, actions, layers" aria-label="Command palette search"
            className="min-w-0 flex-1 bg-transparent text-sm text-bone placeholder:text-bone-mute focus:outline-none" />
          <kbd className="border border-line px-1 font-mono text-micro text-bone-mute">esc</kbd>
        </div>
        <ul className="max-h-[340px] overflow-y-auto" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === idx}>
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => { it.run(); onClose(); }}
                className={cn('flex h-8 w-full items-center gap-2 border-b border-line-faint px-3 text-left', i === idx ? 'bg-ink-800' : '')}>
                <span className="w-16 shrink-0 font-mono text-micro uppercase tracking-[0.12em] text-bone-mute">{it.kind}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-bone">{it.label}</span>
                <span className="truncate font-mono text-micro uppercase text-bone-mute">{it.sub}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-5 text-center font-mono text-micro uppercase text-bone-mute">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
const NO_PLACES: { id: string; name: string; pos: { lon: number; lat: number } }[] = [];
