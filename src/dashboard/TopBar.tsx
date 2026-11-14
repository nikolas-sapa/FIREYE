import { Badge, Button, Compass, Icon, IconButton, Segmented, Serial, StatusPill, cn, zulu } from '@ds';
import type { useSim } from '@/sim';
import type { SimSnapshot } from '@/sim/types';
import { cardinal, tPlus } from './format';
import { VRule } from './ui';

export type Sim = ReturnType<typeof useSim>;

const SPEEDS = [
  { value: '1', label: '1×' },
  { value: '4', label: '4×' },
  { value: '16', label: '16×' },
];

function Readout({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="flex flex-col justify-center gap-0.5">
      <span className="fcc-micro leading-none">{label}</span>
      <span className={cn('font-mono text-tiny leading-none fcc-num', tone ?? 'text-bone')}>
        {value}
        {unit && <span className="ml-0.5 text-bone-mute">{unit}</span>}
      </span>
    </div>
  );
}

export function TopBar({ sim }: { sim: Sim }) {
  const { paused, speed } = sim;
  const state: SimSnapshot = sim.state;
  const { wind, weather } = state;
  const analyzing = state.ingest.some((i) => i.status === 'analyzing');

  return (
    <header className="flex h-12 shrink-0 items-stretch overflow-hidden border-b border-line bg-ink-900">
      <div className="flex shrink-0 items-center gap-2.5 px-4">
        <span className="grid h-6 w-6 place-items-center bg-signal text-ink-950">
          <Icon name="flame" size={14} strokeWidth={1.5} />
        </span>
        <span className="font-mono text-nano font-medium text-bone">FCC</span>
        <Serial className="hidden xl:inline-flex">OPS 2.4</Serial>
      </div>
      <VRule />

      <div className="flex min-w-0 shrink items-center gap-3 px-4">
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="fcc-micro leading-none">Incident</span>
          <span className="truncate font-mono text-tiny leading-none text-bone">
            CA-ENF-024417 <span className="text-bone-mute">·</span> RIDGE FIRE
          </span>
        </div>
      </div>
      <VRule />

      <div className="flex shrink-0 items-center gap-4 px-4">
        <div className="flex flex-col justify-center gap-0.5">
          <span className="fcc-micro leading-none">Zulu</span>
          <span className="font-mono text-sm leading-none text-bone fcc-num">{zulu(state.clock)}</span>
        </div>
        <Readout label="Elapsed" value={tPlus(state.t)} tone="text-bone-dim" />
      </div>
      <VRule />

      <div className="flex shrink-0 items-center gap-2 px-3">
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={paused ? 'Resume simulation' : 'Pause simulation'}
          size="sm"
          variant="secondary"
          active={!paused}
          onClick={() => sim.setPaused(!paused)}
        />
        <Segmented size="sm" options={SPEEDS} value={String(speed)} onChange={(v) => sim.setSpeed(Number(v))} />
        <Button size="sm" variant="ghost" onClick={() => sim.reset()}>
          Reset
        </Button>
      </div>

      <div className="ml-auto flex min-w-0 items-stretch">
        {weather.redFlag && (
          <>
            <VRule />
            <div className="flex shrink-0 items-center px-3">
              <Badge tone="danger" variant="solid" dot>
                Red flag
              </Badge>
            </div>
          </>
        )}
        <VRule />
        <div className="hidden shrink-0 items-center gap-4 px-4 xl:flex">
          <Readout label="Temp" value={weather.tempC.toFixed(0)} unit="°C" />
          <Readout label="RH" value={weather.humidityPct.toFixed(0)} unit="%" tone={weather.humidityPct < 15 ? 'text-amber' : undefined} />
          <Readout label="FM-10" value={weather.fuelMoisturePct.toFixed(1)} unit="%" tone={weather.fuelMoisturePct < 6 ? 'text-amber' : undefined} />
        </div>
        <VRule className="hidden xl:block" />
        <div className="flex shrink-0 items-center gap-2.5 px-4">
          <Compass heading={wind.dirDeg} size={32} />
          <Readout
            label={`Wind ${cardinal(wind.dirDeg)}`}
            value={`${wind.speedKph.toFixed(0)}`}
            unit={` KPH · G${wind.gustKph.toFixed(0)}`}
          />
        </div>
        <VRule />
        <div className="hidden shrink-0 items-center gap-1.5 px-3 2xl:flex">
          <StatusPill status="nominal" live>
            SAT LINK
          </StatusPill>
          <StatusPill status="telemetry">MESH</StatusPill>
          <StatusPill status={analyzing ? 'warning' : 'nominal'} live={analyzing}>
            AI CORE
          </StatusPill>
        </div>
        <div className="flex shrink-0 items-center px-3 2xl:hidden">
          <StatusPill status="nominal" live>
            LINKS 3/3
          </StatusPill>
        </div>
      </div>
    </header>
  );
}
