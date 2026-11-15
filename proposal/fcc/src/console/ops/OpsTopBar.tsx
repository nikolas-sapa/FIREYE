import { Icon, OrchestratorAvatar, cn } from '@ds';
import { useConsoleApi, useConsoleSelector } from '../store';
import { localDay, localTime, packZone, zuluTime } from '../ui/format';
import { useDecisions } from '../fireye/shell/OrchestratorCallout';
import { Seg } from '../fireye/shell/TopBar';

const SPEEDS = [1, 10, 60, 180, 600] as const;

function Clock() {
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const z = packZone(pack);
  return (
    <div className="flex items-baseline gap-3 font-mono uppercase">
      <span className="text-micro text-bone-mute">{localDay(t, z.label)}</span>
      <span className="fcc-num text-sm leading-none text-bone">{localTime(t, z.label, true)} {z.label}</span>
      <span className="fcc-num text-tiny text-bone-dim">{zuluTime(t)}</span>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number | string; tone?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 font-mono uppercase">
      <span className={cn('fcc-num text-tiny', tone ? 'text-signal' : 'text-bone')}>{value}</span>
      <span className="text-micro text-bone-mute">{label}</span>
    </span>
  );
}

export function OpsTopBar() {
  const api = useConsoleApi();
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const agents = useConsoleSelector((s) => s.pools.reduce((n, p) => n + p.workers, 0));
  const jobsPerMin = useConsoleSelector((s) => Math.round(s.pools.reduce((n, p) => n + p.throughputPerMin, 0)));
  const findings = useConsoleSelector((s) => s.findings.length);
  const thinking = useConsoleSelector((s) => s.messages.some((m) => m.thinking));
  const { open } = useDecisions();
  return (
    <header className="relative z-hud flex h-11 shrink-0 items-center gap-4 border-b border-line bg-ink-950 px-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.22em] text-bone">OPS</span>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">Mati 2018</span>
      </div>
      <span className="h-5 w-px bg-line" aria-hidden />
      <span className="inline-flex h-5 shrink-0 items-center gap-1.5 border border-amber/50 px-1.5 font-mono text-micro uppercase tracking-[0.16em] text-amber">
        <span className="h-1 w-1 bg-amber" aria-hidden />Sim exercise
      </span>
      <Clock />
      <div className="ml-auto flex items-center gap-4">
        <Count label="agents" value={agents} tone={agents > 0} />
        <Count label="jobs/min" value={jobsPerMin} />
        <Count label="findings" value={findings} />
        <button type="button" title="Pending approvals" className="flex items-center gap-1.5 font-mono uppercase" onClick={() => document.dispatchEvent(new CustomEvent('ops:tab', { detail: 'inspect' } satisfies { detail: string }))}>
          <OrchestratorAvatar size={14} state={open.length ? 'alert' : thinking ? 'thinking' : 'idle'} className="text-bone" />
          <span className={cn('fcc-num text-tiny', open.length ? 'text-signal' : 'text-bone-mute')}>{open.length}</span>
          <span className="text-micro text-bone-mute">approvals</span>
        </button>
        <div className="flex h-7 items-stretch border border-line-strong bg-ink-900">
          <button type="button" title={paused ? 'Play (space)' : 'Pause (space)'} aria-label={paused ? 'Play' : 'Pause'} onClick={() => api.setPaused(!paused)}
            className="flex w-8 items-center justify-center text-bone-dim hover:text-bone">
            <Icon name={paused ? 'play' : 'pause'} size={11} />
          </button>
          <Seg label="Speed" className="border-0 border-l border-line" value={String(speed)}
            options={SPEEDS.map((x) => ({ value: String(x), label: `${x}x` }))}
            onChange={(v) => api.setSpeed(Number(v))} />
        </div>
      </div>
    </header>
  );
}
