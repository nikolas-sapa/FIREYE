import { useEffect, useRef, useState } from 'react';
import { AppearanceToggle, FireyeWordmark, Icon, cn } from '@ds';
import { useConsoleSelector } from '../../store';
import { setMapMode, useMapSettings } from '../../stage3d/map-settings';
import { localDay, localTime, packZone, zuluTime } from '../../ui/format';
import { TamagotchiSprite } from '../../ui/TamagotchiSprite';
import { fireyeUi, useFireye } from './ui';

export function Seg<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('relative inline-flex h-7 shrink-0 items-stretch border border-line-strong bg-ink-900', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative px-2.5 font-mono text-micro uppercase tracking-[0.14em] transition-colors duration-quick ease-servo',
            i > 0 && 'border-l border-line',
            value === o.value ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
          )}
        >
          {o.label}
          {value === o.value && <span aria-hidden className="fireye-seg-mark absolute inset-x-1 bottom-0 h-px bg-bone" />}
        </button>
      ))}
    </div>
  );
}

function Clock() {
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const z = packZone(pack);
  return (
    <div className="flex items-center gap-4 font-mono uppercase">
      <div className="flex items-baseline gap-1.5">
        <span className="text-micro text-bone-mute">{localDay(t, z.label)}</span>
        <span className="fcc-num text-sm leading-none text-bone">{localTime(t, z.label, true)}</span>
        <span className="text-micro text-bone-mute">{z.label}</span>
      </div>
      <span className="fcc-num text-tiny text-bone-dim">{zuluTime(t)}</span>
    </div>
  );
}

function OrchStatus({ pending, onOpen }: { pending: number; onOpen: () => void }) {
  const status = useConsoleSelector((s) => s.brief.headline);
  const thinking = useConsoleSelector((s) => s.messages.some((m) => m.thinking));
  const paused = useConsoleSelector((s) => s.clock.paused);
  const chat = useFireye((s) => s.chat);
  return (
    <button type="button" onClick={onOpen} title={status}
      className="flex h-7 shrink-0 items-center gap-2 border border-line-strong bg-ink-900 px-2.5 font-mono text-micro uppercase tracking-[0.14em] text-bone-dim hover:text-bone">
      <TamagotchiSprite size={16} state={pending ? 'alert' : thinking ? 'thinking' : chat ? 'working' : 'idle'} paused={paused} />
      Chief
      <span className={cn('fcc-num', pending ? 'text-signal' : 'text-bone-mute')}>{pending ? `${pending} DECISION${pending > 1 ? 'S' : ''}` : 'MONITORING'}</span>
    </button>
  );
}

export function TopBar({ pending, onOrch }: { pending: number; onOrch: () => void }) {
  const map = useMapSettings();
  const thermal = useFireye((s) => s.thermal);
  const panel = useFireye((s) => s.panel);
  const pack = useConsoleSelector((s) => s.pack);
  const ref = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 1500));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={ref} className={cn('fireye-enter relative z-hud flex h-11 shrink-0 items-center border-b', narrow ? 'gap-2.5' : 'gap-4', ' border-line bg-ink-950 px-3')} style={{ ['--i' as string]: 0 }}>
      <span data-fireye-logo className="flex items-center">
        <FireyeWordmark size={22} sub={narrow ? undefined : 'Incident console'} />
      </span>
      <span className="h-5 w-px bg-line" aria-hidden />
      <div className="flex min-w-0 flex-col leading-none">
        <span className="truncate font-mono text-tiny uppercase tracking-[0.14em] text-bone">Mati · East Attica</span>
        <span className="mt-0.5 truncate font-mono text-micro uppercase text-bone-mute">{pack ? '23 Jul 2018 · reconstruction' : 'Loading'}</span>
      </div>
      <span className="inline-flex h-5 shrink-0 items-center gap-1.5 border border-amber/50 px-1.5 font-mono text-micro uppercase tracking-[0.16em] text-amber">
        <span className="h-1 w-1 bg-amber" aria-hidden />Exercise · simulated
      </span>
      <div className="mx-auto flex shrink-0 items-center"><Clock /></div>
      <OrchStatus pending={pending} onOpen={onOrch} />
      <Seg label="Globe style" value={map.mode} onChange={(m) => setMapMode(m)}
        options={[{ value: 'outline', label: 'Outline' }, { value: 'satellite', label: 'Satellite' }]} />
      <Seg label="Sensor view" value={thermal ? 'thermal' : 'normal'} onChange={(v) => fireyeUi.set({ thermal: v === 'thermal' })}
        options={[{ value: 'normal', label: 'Normal' }, { value: 'thermal', label: 'Thermal', title: 'Simulated white-hot thermal, not radiometric (T)' }]} />
      <div className="flex h-7 shrink-0 items-stretch border border-line-strong bg-ink-900">
        <button type="button" title="Legend (L)" aria-pressed={panel === 'legend'} onClick={() => fireyeUi.set({ panel: panel === 'legend' ? null : 'legend' })}
          className={cn('flex items-center gap-1.5 px-2.5 font-mono text-micro uppercase tracking-[0.14em]', panel === 'legend' ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
          <Icon name="grid" size={11} />{narrow ? <span className="sr-only">Legend</span> : 'Legend'}
        </button>
        <button type="button" title="Layers (V)" aria-pressed={panel === 'layers'} onClick={() => fireyeUi.set({ panel: panel === 'layers' ? null : 'layers' })}
          className={cn('flex items-center gap-1.5 border-l border-line px-2.5 font-mono text-micro uppercase tracking-[0.14em]', panel === 'layers' ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
          <Icon name="layers" size={11} />{narrow ? <span className="sr-only">Layers</span> : 'Layers'}
        </button>
      </div>
      <AppearanceToggle />
    </header>
  );
}
