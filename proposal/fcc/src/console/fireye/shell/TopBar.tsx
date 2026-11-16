import { useEffect, useState } from 'react';
import { FIREYE_GEOMETRY, FireyeMark, Icon, cn } from '@ds';
import { useConsoleSelector } from '../../store';
import { localDay, localTime, packZone, zuluTime } from '../../ui/format';
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
  const t = useConsoleSelector(s => s.clock.t), pack = useConsoleSelector(s => s.pack);
  const z = packZone(pack);
  return (
    <div className="flex flex-col items-start gap-0.5 font-mono uppercase">
      <span className="text-micro text-bone-mute">{localDay(t, z.label)} {new Date(t).getUTCFullYear()}<span className="ml-2 hidden xl:inline">{zuluTime(t)}</span></span>
      <span className="fcc-num whitespace-nowrap text-xs leading-none text-bone">{localTime(t, z.label, true)} <span className="text-micro text-bone-mute">{z.label}</span></span>
    </div>
  );
}

function HeaderAgent({ onOpen }: { onOpen: () => void }) {
  const booted = useFireye(s => s.booted);
  const command = useConsoleSelector(s => s.recon?.events.filter(e => e.tasking && e.t <= s.clock.t && s.clock.t - e.t < 4 * 60000).at(-1));
  const center = useConsoleSelector(s => s.pack?.manifest.center);
  const thinking = useConsoleSelector(s => !s.clock.paused && s.jobs.some(j => j.status === 'running'));
  const [attending, setAttending] = useState(false);
  useEffect(() => {
    if (!booted) return;
    setAttending(!!command);
    if (!command) return;
    const timer = window.setTimeout(() => setAttending(false), 4500);
    return () => window.clearTimeout(timer);
  }, [command?.id, booted]);
  const look = attending && command?.pos ? (command.pos.lon < (center?.lon ?? command.pos.lon) ? 'down-left' : 'down-right') : 'center';
  return (
    <button type="button" onClick={onOpen} aria-label="Open FIREYE Orchestrator" data-fireye-logo data-agent-command={attending ? command?.id : undefined}
      className="fireye-header-agent absolute left-1/2 top-0 flex h-24 w-24 -translate-x-1/2 items-center justify-center text-bone outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal"
      title={attending ? command?.title : thinking ? 'FIREYE is analysing source observations' : 'FIREYE is monitoring. Open Orchestrator.'}>
      <svg data-agent-backing aria-hidden="true" focusable="false" width={144} height={108} viewBox="-8 0 48 36"
        className="pointer-events-none absolute -left-6 top-0 overflow-visible fill-ink-950 stroke-ink-950">
        {/* The canonical lower lid plus 12 px padding joins the header without a seam. */}
        <path d={`${FIREYE_GEOMETRY.lowerLid}V0H2.5Z`} strokeWidth={8} strokeLinejoin="round" />
      </svg>
      <FireyeMark size={96} weight={1.75} className="relative" state={attending ? 'speaking' : thinking ? 'thinking' : 'idle'} look={look} title="FIREYE reconnaissance agent" />
      <span className="sr-only" aria-live="polite">{attending ? command?.title : ''}</span>
    </button>
  );
}

export function TopBar({ onOrch }: { onOrch: () => void }) {
  const thermal = useFireye(s => s.thermal), panel = useFireye(s => s.panel);
  return (
    <header className="fireye-header relative z-hud grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-center gap-2 bg-ink-950 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <Clock />
        <span className="flex shrink-0 items-center gap-1.5 border border-amber/50 px-2 py-1 font-mono text-micro uppercase tracking-[0.1em] text-amber">
          <span className="h-1 w-1 bg-amber" aria-hidden /><span className="hidden sm:inline">Exercise · </span>Sim
        </span>
      </div>
      <div aria-hidden />
      <div className="flex min-w-0 items-center justify-end gap-3">
        <div className="hidden min-w-0 flex-col leading-none lg:flex">
          <span className="truncate font-mono text-tiny uppercase tracking-[0.16em] text-bone">Mati · East Attica</span>
          <span className="mt-1 font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">Fireye · incident console</span>
        </div>
        <Seg label="Sensor view" value={thermal ? 'thermal' : 'normal'} onChange={v => fireyeUi.set({ thermal: v === 'thermal' })}
          options={[{ value: 'normal', label: 'EO' }, { value: 'thermal', label: 'THRM', title: 'Simulated thermal, not radiometric (T)' }]} />
        <div className="flex h-7 shrink-0 items-stretch border border-line-strong bg-ink-900">
          <button type="button" aria-label="Legend" title="Legend (L)" aria-pressed={panel === 'legend'} onClick={() => fireyeUi.set({ panel: panel === 'legend' ? null : 'legend' })}
            className={cn('flex items-center gap-1.5 px-2 font-mono text-micro uppercase', panel === 'legend' ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone')}>
            <Icon name="grid" size={12} /><span className="hidden xl:inline">Legend</span>
          </button>
          <button type="button" aria-label="Layers" title="Layers (V)" aria-pressed={panel === 'layers'} onClick={() => fireyeUi.set({ panel: panel === 'layers' ? null : 'layers' })}
            className={cn('flex items-center gap-1.5 border-l border-line px-2 font-mono text-micro uppercase', panel === 'layers' ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone')}>
            <Icon name="layers" size={12} /><span className="hidden xl:inline">Layers</span>
          </button>
        </div>
      </div>
      <HeaderAgent onOpen={onOrch} />
    </header>
  );
}
