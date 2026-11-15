import { Icon, cn } from '@ds';
import { fireyeUi, useFireye, VIS_GROUPS, type VisGroup, type VisPreset } from './ui';

const SECTIONS: { title: string; keys: VisGroup[] }[] = [
  { title: 'Sources', keys: ['fleet', 'groundCams', 'iot'] },
  { title: 'Sensing', keys: ['footprints', 'findings'] },
  { title: 'Incident', keys: ['fireFront', 'projections', 'risk'] },
  { title: 'Map', keys: ['roadsPlaces', 'labels'] },
];
const PRESETS: { id: VisPreset; label: string }[] = [
  { id: 'minimal', label: 'Minimal' }, { id: 'standard', label: 'Standard' }, { id: 'everything', label: 'Everything' },
];

/** Display-only layer switches. They never change incident, action or approval state. */
export function VisibilityPanel() {
  const vis = useFireye((s) => s.vis);
  const preset = useFireye((s) => s.preset);
  return (
    <section aria-label="Layers" className="fireye-pop pointer-events-auto flex max-h-full w-[300px] flex-col border border-line-strong bg-ink-950/95 shadow-panel">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <Icon name="layers" size={11} className="text-bone-mute" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Layers</span>
        <span className="font-mono text-micro uppercase text-bone-mute">{preset === 'custom' ? 'custom' : preset}</span>
        <button type="button" aria-label="Close layers" onClick={() => fireyeUi.set({ panel: null })} className="ml-auto text-bone-mute hover:text-bone"><Icon name="close" size={11} /></button>
      </header>
      <div role="radiogroup" aria-label="Visibility preset" className="grid shrink-0 grid-cols-3 gap-px border-b border-line bg-line">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => fireyeUi.preset(p.id)}
            className={cn('relative h-8 font-mono text-micro uppercase tracking-[0.14em] transition-colors duration-quick ease-servo',
              preset === p.id ? 'bg-ink-700 text-bone' : 'bg-ink-950 text-bone-mute hover:bg-ink-850 hover:text-bone-dim')}>
            {p.label}
            {preset === p.id && <span aria-hidden className="fireye-seg-mark absolute inset-x-3 bottom-0 h-px bg-bone" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-1">
        {SECTIONS.map((s) => (
          <div key={s.title} className="border-b border-line-faint py-2 last:border-0">
            <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">{s.title}</span>
            <ul className="mt-1">
              {s.keys.map((k) => (
                <li key={k}>
                  <label className="flex h-7 cursor-pointer items-center gap-2.5 text-xs text-bone-dim hover:text-bone">
                    <input type="checkbox" checked={vis[k]} onChange={(e) => fireyeUi.setVis(k, e.target.checked)} className="peer sr-only" />
                    <span aria-hidden className={cn('flex h-3 w-3 items-center justify-center border transition-colors duration-quick ease-servo peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-signal',
                      vis[k] ? 'border-bone bg-bone text-ink-950' : 'border-line-strong')}>
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
      <p className="shrink-0 border-t border-line px-3 py-2 font-mono text-micro uppercase leading-4 text-bone-mute">Display only · never changes incident or approval state</p>
    </section>
  );
}
