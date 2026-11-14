import { Button, Icon, IconButton, Segmented, StatusPill, cn, zulu } from '@ds';
import { cardinal, tPlus } from './format';
import type { Sim, ViewMode } from './types';
import { VRule } from './ui';

const SPEEDS = [
  { value: '1', label: '1×' },
  { value: '4', label: '4×' },
  { value: '16', label: '16×' },
];

const VIEWS = [
  { value: 'calm', label: 'Calm' },
  { value: 'detail', label: 'Detail' },
];

/** Wind direction is "from"; the arrow points where the fire is pushed. */
function WindGlyph({ fromDeg }: { fromDeg: number }) {
  return (
    <span aria-hidden className="relative grid h-6 w-6 shrink-0 place-items-center border border-line-strong">
      <svg width={14} height={14} viewBox="0 0 14 14" className="transition-transform duration-slow ease-settle" style={{ transform: `rotate(${fromDeg + 180}deg)` }}>
        <path d="M7 1.5 L7 12.5 M3.5 5 L7 1.5 L10.5 5" fill="none" stroke="currentColor" strokeWidth={1.25} className="text-amber" strokeLinecap="square" />
      </svg>
      <span className="absolute -top-px left-1/2 h-0.5 w-px -translate-x-1/2 bg-bone-mute" />
    </span>
  );
}

export function CommandBar({ sim, view, onView }: { sim: Sim; view: ViewMode; onView(v: ViewMode): void }) {
  const { state, paused, speed } = sim;
  const { wind } = state;
  const pools = state.pools ?? [];
  const agents = pools.reduce((n, p) => n + p.workers, 0);
  const saturated = pools.some((p) => p.workers >= p.maxWorkers && p.queue > p.maxWorkers);

  return (
    <header className="flex h-11 shrink-0 items-stretch overflow-hidden border-b border-line bg-ink-900">
      <div className="flex shrink-0 items-center gap-2 px-3">
        <span className="grid h-5 w-5 place-items-center bg-signal text-ink-950">
          <Icon name="flame" size={12} strokeWidth={1.5} />
        </span>
        <span className="font-mono text-nano font-medium text-bone">FCC</span>
      </div>
      <VRule />

      <div className="flex min-w-0 shrink items-center px-3">
        <span className="truncate font-mono text-tiny text-bone">
          RIDGE FIRE <span className="text-ink-500">·</span> <span className="text-bone-mute">CA-ENF-024417</span>
        </span>
      </div>
      <VRule />

      <div className="flex shrink-0 items-center gap-3 px-3 font-mono fcc-num">
        <span className="text-tiny text-bone">{zulu(state.clock)}</span>
        <span className="hidden text-micro text-bone-mute lg:inline">{tPlus(state.t)}</span>
      </div>
      <VRule />

      <div className="flex shrink-0 items-center gap-1.5 px-2">
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={paused ? 'Resume simulation' : 'Pause simulation'}
          size="sm"
          variant="ghost"
          onClick={() => sim.setPaused(!paused)}
        />
        <Segmented size="sm" aria-label="Simulation speed" options={SPEEDS} value={String(speed)} onChange={(v) => sim.setSpeed(Number(v))} />
        <Button size="sm" variant="ghost" onClick={() => sim.reset()} className="hidden lg:inline-flex">
          Reset
        </Button>
      </div>

      <div className="ml-auto flex min-w-0 items-stretch">
        <VRule />
        <div className="flex shrink-0 items-center gap-2 px-3" title={`Wind from ${Math.round(wind.dirDeg)}°, gusts ${wind.gustKph.toFixed(0)} KPH`}>
          <WindGlyph fromDeg={wind.dirDeg} />
          <span className="font-mono text-tiny text-bone fcc-num">
            {cardinal(wind.dirDeg)} {wind.speedKph.toFixed(0)}
            <span className="ml-1 text-micro text-bone-mute">KPH</span>
          </span>
        </div>
        <VRule />
        <div className="hidden shrink-0 items-center px-3 xl:flex">
          <StatusPill status={saturated ? 'warning' : 'nominal'} live={!saturated}>
            <span className="fcc-num">{agents}</span> agents · {saturated ? 'saturated' : 'nominal'}
          </StatusPill>
        </div>
        <VRule className="hidden xl:block" />
        <div className={cn('flex shrink-0 items-center px-2')}>
          <Segmented size="sm" aria-label="Console density" options={VIEWS} value={view} onChange={(v) => onView(v as ViewMode)} />
        </div>
      </div>
    </header>
  );
}
