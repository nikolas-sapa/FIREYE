import { Icon, OrchestratorAvatar, cn, getAppearance, setAppearance, useAppearance } from '@ds';
import { useConsoleApi, useConsoleSelector } from '../store';
import { localTime, packZone, zuluTime } from '../ui/format';
import { useDecisions } from '../fireye/shell/OrchestratorCallout';
import { Seg } from '../fireye/shell/TopBar';
import { opsView, useOpsView } from './view';
import { OpsBackendControl } from './OpsBackend';

const SPEEDS = [1, 10, 60, 180, 600] as const;

function Clock() {
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const z = packZone(pack);
  return (
    <div className="flex items-center gap-2 whitespace-nowrap font-mono leading-none">
      <span className="fcc-num text-[13px] text-bone">{zuluTime(t)}</span>
      <span className="text-[11px] text-bone-mute">{localTime(t, z.label)} {z.label}</span>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="flex items-baseline gap-1.5 px-2.5 font-mono uppercase">
      <span className="fcc-num text-tiny text-bone">{value}</span>
      <span className="text-micro text-bone-mute">{label}</span>
    </span>
  );
}

export function OpsTopBar({ presenting, onPresent }: { presenting: boolean; onPresent: () => void }) {
  const api = useConsoleApi();
  const view = useOpsView();
  const appearance = useAppearance();
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const agents = useConsoleSelector((s) => s.pools.reduce((n, p) => n + p.workers, 0));
  const jobsPerMin = useConsoleSelector((s) => Math.round(s.pools.reduce((n, p) => n + p.throughputPerMin, 0)));
  const findings = useConsoleSelector((s) => s.findings.length);
  const thinking = useConsoleSelector((s) => s.messages.some((m) => m.thinking));
  const { open } = useDecisions();
  return (
    <header className="relative z-hud flex min-h-10 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-ink-900 px-3 py-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold uppercase tracking-[0.22em] text-bone">OPS</span>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone-mute">Mati 2018</span>
      </div>
      <span className="h-5 w-px bg-line" aria-hidden />
      <span className="inline-flex h-5 shrink-0 items-center gap-1.5 border border-line-strong px-1.5 font-mono text-micro uppercase tracking-[0.2em] text-bone-dim">
        <span className="h-1 w-1 bg-signal" aria-hidden />Sim exercise
      </span>
      <Seg label="View" value={view} onChange={(v) => opsView.set(v)}
        options={[{ value: 'responder', label: 'Responder' }, { value: 'civilian', label: 'Civilian' }]} />
      <Clock />
      <OpsBackendControl />
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center divide-x divide-line border border-line-strong font-mono uppercase">
          <Count label="agents" value={agents} />
          <Count label="jobs/min" value={jobsPerMin} />
          <Count label="findings" value={findings} />
          <button type="button" title="Pending approvals" className="flex items-center gap-1.5 px-2.5" onClick={() => document.dispatchEvent(new CustomEvent('ops:tab', { detail: 'inspect' } satisfies { detail: string }))}>
            <OrchestratorAvatar size={14} state={open.length ? 'alert' : thinking ? 'thinking' : 'idle'} className="text-bone" />
            <span className="fcc-num text-tiny text-bone">{open.length}</span>
            <span className="text-micro text-bone-mute">approvals</span>
          </button>
        </span>
        <div className="flex h-7 items-stretch border border-line-strong bg-ink-900">
          <button type="button" title={paused ? 'Play (space)' : 'Pause (space)'} aria-label={paused ? 'Play' : 'Pause'} onClick={() => api.setPaused(!paused)}
            className="flex w-8 items-center justify-center text-bone-dim hover:text-bone">
            <Icon name={paused ? 'play' : 'pause'} size={11} />
          </button>
          <Seg label="Speed" className="border-0 border-l border-line" value={String(speed)}
            options={SPEEDS.map((x) => ({ value: String(x), label: `${x}x` }))}
            onChange={(v) => api.setSpeed(Number(v))} />
        </div>
        <button type="button" title="Toggle light/dark" aria-label="Toggle light and dark" onClick={() => setAppearance(getAppearance() === 'dark' ? 'light' : 'dark', { persist: false })}
          className={cn('flex h-7 w-8 items-center justify-center border border-line-strong bg-ink-900', appearance === 'dark' ? 'text-bone' : 'text-bone-mute hover:text-bone-dim')}>
          <Icon name={appearance === 'dark' ? 'eye' : 'signal'} size={11} />
        </button>
        <button type="button" onClick={onPresent} aria-pressed={presenting}
          className={cn('flex h-7 items-center gap-1.5 border px-2.5 font-mono text-micro uppercase tracking-[0.14em]', presenting ? 'border-signal bg-signal/15 text-bone' : 'border-line-strong bg-ink-900 text-bone-dim hover:text-bone')}>
          <Icon name="play" size={10} />{presenting ? 'Presenting' : 'Present'}
        </button>
      </div>
    </header>
  );
}
