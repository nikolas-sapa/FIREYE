import { useEffect, useMemo, useRef, useState } from 'react';
import { AppearanceToggle, AutonomyDial, IconButton, Icon, InstallAppButton, LensSelect, TimelineScrubber, Tooltip, cn, type TimelineMark } from '@ds';
import { useConsoleApi, useConsoleSelector } from '../store';
import { acresSeries } from './derived';
import { incidentNumber, localDay, localHour, localTime, packTz, zuluTime } from './format';
import { SCENARIOS, currentScenarioId, scenarioName, switchScenario } from './scenarios';

const SPEEDS = [1, 10, 30, 60, 120, 300, 600, 1200];

export function FccMark({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 32 32" className="shrink-0">
      <rect width="32" height="32" className="fill-ink-950" />
      <path d="M8 24V8h16" className="stroke-signal" strokeWidth="2.5" fill="none" />
      <rect x="14" y="14" width="6" height="6" className="fill-bone" />
    </svg>
  );
}

function Sep() {
  return <span aria-hidden className="h-6 w-px shrink-0 bg-line" />;
}

export function useTimelineTicks(start: number, end: number, tz: string) {
  return useMemo(() => {
    const out: { t: number; label?: string; major?: boolean }[] = [];
    if (!(end > start)) return out;
    const step = 3600_000;
    let t = Math.ceil(start / step) * step;
    for (; t <= end; t += step) {
      const h = localHour(t, tz);
      if (h === 0) out.push({ t, label: localDay(t, tz), major: true });
      else if (h % 6 === 0) out.push({ t, label: `${String(h).padStart(2, '0')}:00` });
    }
    return out;
  }, [start, end, tz]);
}

function Clock() {
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 1000) * 1000);
  const tz = useConsoleSelector((s) => packTz(s.pack));
  return (
    <div className="flex shrink-0 flex-col justify-center leading-none" aria-label="Scenario clock">
      <span className="flex items-baseline gap-1.5 font-mono text-tiny text-bone fcc-num">
        <span className="text-bone-mute">{localDay(t, tz)}</span>
        {localTime(t, tz, true)}
        <span className="text-micro text-bone-mute">{tz}</span>
      </span>
      <span className="mt-1 font-mono text-micro text-bone-mute fcc-num">{zuluTime(t)}</span>
    </div>
  );
}

function Transport() {
  const api = useConsoleApi();
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const idx = SPEEDS.reduce((best, v, i) => (Math.abs(v - speed) < Math.abs((SPEEDS[best] ?? 1) - speed) ? i : best), 0);
  const step = (d: number) => api.setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, idx + d))] ?? speed);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Play (Space)' : 'Pause (Space)'} size="sm" onClick={() => api.setPaused(!paused)} />
      <div className="flex h-7 items-center border border-line-strong bg-ink-900">
        <button type="button" aria-label="Slower" onClick={() => step(-1)} className="flex h-full w-5 items-center justify-center text-bone-mute hover:bg-ink-800 hover:text-bone">
          <Icon name="minus" size={10} />
        </button>
        <span className="w-11 text-center font-mono text-micro text-bone fcc-num" aria-label={`Speed ${speed} times`}>
          {speed >= 60 ? `${Math.round(speed / 60)}M/S` : `${speed}×`}
        </span>
        <button type="button" aria-label="Faster" onClick={() => step(1)} className="flex h-full w-5 items-center justify-center text-bone-mute hover:bg-ink-800 hover:text-bone">
          <Icon name="plus" size={10} />
        </button>
      </div>
    </div>
  );
}

function Scrubber() {
  const api = useConsoleApi();
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 30000) * 30000);
  const projection = useConsoleSelector((s) => s.projection);
  const start = pack?.manifest.start ?? 0;
  const end = pack?.manifest.end ?? 1;
  const tz = packTz(pack);
  const ticks = useTimelineTicks(start, end, tz);
  const series = useMemo(() => acresSeries(pack), [pack]);
  const marks = useMemo<TimelineMark[]>(
    () => [
      ...(pack?.perimeters ?? []).filter((p) => p.t >= start && p.t <= end).map((p) => ({ t: p.t, kind: 'perimeter' as const, label: `Perimeter · ${Math.round(p.acres).toLocaleString('en-US')} AC` })),
      ...(pack?.checkpoints ?? []).filter((c) => c.t >= start && c.t <= end).map((c) => ({ t: c.t, kind: 'checkpoint' as const, label: `Documented · ${c.label}` })),
    ],
    [pack, start, end],
  );
  const horizon = projection ? Math.max(...projection.bands.map((b) => b.horizonMin), 0) : 0;
  return (
    <div className="flex min-w-[160px] flex-1 items-center gap-2">
      <span className="hidden shrink-0 font-mono text-micro uppercase text-bone-mute min-[1700px]:inline">{localDay(start, tz)}</span>
      <TimelineScrubber
        compact
        start={start}
        end={end}
        t={t}
        onSeek={(v) => api.seek(v)}
        ticks={ticks}
        series={series}
        marks={marks}
        projectionUntil={horizon ? t + horizon * 60000 : undefined}
        format={(v) => `${localDay(v, tz)} ${localTime(v, tz)} ${tz}`}
        className="min-w-0 flex-1"
      />
      <span className="hidden shrink-0 font-mono text-micro uppercase text-bone-mute min-[1700px]:inline">{localDay(end, tz)}</span>
    </div>
  );
}

function OrchestratorStatus() {
  const thinking = useConsoleSelector((s) => s.messages.some((m) => m.thinking));
  const interrupt = useConsoleSelector((s) => s.items.some((i) => i.zone === 'Z0_INTERRUPT' && !i.dismissed));
  const pending = useConsoleSelector((s) => s.actions.filter((a) => a.status === 'proposed' && a.requiresApproval).length);
  const workers = useConsoleSelector((s) => s.pools.reduce((n, p) => n + p.workers, 0));
  const [label, tone] = interrupt
    ? (['Interrupt', 'text-ember'] as const)
    : thinking
      ? (['Reasoning', 'text-ice'] as const)
      : pending
        ? ([`${pending} for you`, 'text-amber'] as const)
        : (['Watching', 'text-phosphor'] as const);
  const dot = interrupt ? 'bg-ember' : thinking ? 'bg-ice' : pending ? 'bg-amber' : 'bg-phosphor';
  return (
    <Tooltip content={`Orchestrator · ${workers} agents working`} side="bottom">
      <span className="inline-flex h-7 shrink-0 items-center gap-2 border border-line-strong bg-ink-900 px-2">
        <Icon name="orchestrator" size={12} className="text-ice" />
        <span className="relative flex h-1.5 w-1.5">
          <span className={cn('absolute inset-0', dot, (interrupt || thinking) && 'animate-pulse-ring rounded-pill')} />
          <span className={cn('relative h-1.5 w-1.5', dot)} />
        </span>
        <span className={cn('font-mono text-micro uppercase', tone)}>{label}</span>
        <span className="font-mono text-micro text-bone-mute fcc-num">{String(workers).padStart(2, '0')}</span>
      </span>
    </Tooltip>
  );
}

function DirectorControls() {
  const api = useConsoleApi();
  const enabled = useConsoleSelector((s) => s.director.enabled);
  const beat = useConsoleSelector((s) => s.director.beat);
  const total = useConsoleSelector((s) => s.director.beats.length);
  const captions = useConsoleSelector((s) => s.director.captions);
  const elapsed = useConsoleSelector((s) => Math.floor(s.director.elapsedS));
  const beats = useConsoleSelector((s) => s.director.beats);
  const last = beats[beats.length - 1];
  const dur = Math.max(180, (last?.at ?? 160) + 20);
  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => api.director.start()}
        className="group inline-flex h-7 shrink-0 items-center gap-2 border border-line-strong bg-ink-800 pl-2 pr-1.5 font-mono text-micro uppercase tracking-[0.12em] text-bone transition-colors duration-quick ease-servo hover:border-ink-400 hover:bg-ink-700"
      >
        <Icon name="play" size={11} />
        Start demo
        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center border border-line-strong px-1 text-bone-mute">D</span>
      </button>
    );
  }
  return (
    <div className="flex h-7 shrink-0 items-center border border-line-strong bg-ink-900">
      <span className="flex items-center gap-1.5 px-2 font-mono text-micro uppercase text-bone">
        <span className="h-1.5 w-1.5 animate-blink bg-ember" aria-hidden />
        Demo
      </span>
      <span aria-hidden className="h-full w-px bg-line" />
      <button type="button" aria-label="Previous beat" onClick={() => api.director.prev()} className="flex h-full w-6 items-center justify-center text-bone-mute hover:bg-ink-800 hover:text-bone">
        <Icon name="chevron-left" size={12} />
      </button>
      <span className="flex flex-col items-center px-1 leading-none">
        <span className="font-mono text-micro text-bone fcc-num">
          {String(beat + 1).padStart(2, '0')}
          <span className="text-bone-mute">/{String(total).padStart(2, '0')}</span>
        </span>
        <span aria-hidden className="relative mt-1 h-px w-12 bg-line-strong">
          <span className="absolute inset-y-0 left-0 bg-bone-dim" style={{ width: `${Math.min(100, (elapsed / dur) * 100)}%` }} />
          {beats.map((b) => (
            <span key={b.id} className="absolute -top-px h-[3px] w-px bg-bone-mute" style={{ left: `${(b.at / dur) * 100}%` }} />
          ))}
        </span>
      </span>
      <button type="button" aria-label="Next beat" onClick={() => api.director.next()} className="flex h-full w-6 items-center justify-center text-bone-mute hover:bg-ink-800 hover:text-bone">
        <Icon name="chevron-right" size={12} />
      </button>
      <span aria-hidden className="h-full w-px bg-line" />
      <button
        type="button"
        aria-pressed={captions}
        aria-label="Captions"
        onClick={() => api.director.setCaptions(!captions)}
        className={cn('h-full px-1.5 font-mono text-micro uppercase', captions ? 'text-bone' : 'text-ink-500 line-through')}
      >
        CC
      </button>
      <span aria-hidden className="h-full w-px bg-line" />
      <button type="button" aria-label="Stop demo" onClick={() => api.director.stop()} className="flex h-full w-6 items-center justify-center text-bone-mute hover:bg-ink-800 hover:text-bone">
        <span className="h-2 w-2 border border-current" />
      </button>
    </div>
  );
}

function ScenarioSelect() {
  const pack = useConsoleSelector((s) => s.pack);
  const active = pack?.manifest.id ?? currentScenarioId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative flex flex-col leading-none">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex items-center gap-1.5 font-mono text-nano uppercase tracking-[0.16em] text-bone hover:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        {scenarioName(pack)} <span className="text-ink-500">·</span> Replay
        <Icon name="chevron-down" size={10} className="text-bone-mute group-hover:text-bone" />
      </button>
      <span className="mt-1 font-mono text-micro uppercase text-bone-mute fcc-num">
        {incidentNumber(pack)} <span className="text-ink-500">//</span> FCC REV D
      </span>
      {open && (
        <ul role="listbox" aria-label="Scenario" className="absolute left-0 top-full z-modal mt-2 w-[280px] animate-rise border border-line-strong bg-ink-900 shadow-lift">
          <li className="border-b border-line px-3 py-2 font-mono text-micro uppercase text-bone-mute">Replay scenario · reloads the console</li>
          {SCENARIOS.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => (on ? setOpen(false) : switchScenario(s.id))}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-line-faint px-3 py-2 text-left transition-colors duration-quick ease-servo',
                    on ? 'bg-ink-800' : 'hover:bg-ink-800',
                  )}
                >
                  <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0', on ? 'bg-signal' : 'bg-ink-600')} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm text-bone">{s.name}</span>
                    <span className="font-mono text-micro uppercase text-bone-mute">
                      {s.short} · {s.tz} (UTC{s.utcOffsetMin >= 0 ? '+' : '−'}{Math.abs(s.utcOffsetMin / 60)})
                    </span>
                  </span>
                  {on && <span className="font-mono text-micro uppercase text-bone-dim">Active</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HoldToggle() {
  const api = useConsoleApi();
  const hold = useConsoleSelector((s) => s.settings.holdLayout);
  return (
    <Tooltip content={hold ? 'Layout held · directives become suggestions' : 'Orchestrator may rearrange the screen'} side="bottom">
      <button
        type="button"
        aria-pressed={hold}
        onClick={() => api.setHoldLayout(!hold)}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 font-mono text-micro uppercase tracking-[0.12em] transition-colors duration-quick ease-servo',
          hold ? 'border-amber/50 bg-amber/10 text-amber' : 'border-line-strong bg-ink-900 text-bone-mute hover:bg-ink-800 hover:text-bone-dim',
        )}
      >
        <span aria-hidden className={cn('flex h-3 w-3 items-center justify-center border', hold ? 'border-amber' : 'border-ink-400')}>
          {hold && <span className="h-1.5 w-1.5 bg-amber" />}
        </span>
        Hold layout
      </button>
    </Tooltip>
  );
}

export function CommandStrip() {
  const api = useConsoleApi();
  const pack = useConsoleSelector((s) => s.pack);
  const lens = useConsoleSelector((s) => s.settings.lens);
  const autonomy = useConsoleSelector((s) => s.settings.autonomy);
  const disclaimer = pack?.manifest.disclaimer ?? 'Scenario built from public data; units, people and events are simulated.';
  return (
    <header className="relative z-hud flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-ink-950 px-3 py-1">
      <div className="flex shrink-0 items-center gap-2.5">
        <FccMark size={22} />
        <ScenarioSelect />
      </div>
      <Sep />
      <Clock />
      <Transport />
      <Scrubber />
      <Sep />
      <LensSelect showKeys={false} value={lens} onChange={(l) => api.setLens(l)} />
      <AutonomyDial compact value={autonomy} onChange={(a) => api.setAutonomy(a)} />
      <HoldToggle />
      <Sep />
      <OrchestratorStatus />
      <DirectorControls />
      <AppearanceToggle />
      <InstallAppButton />
      <Tooltip content={disclaimer} side="bottom" className="shrink-0">
        <span className="inline-flex h-7 items-center gap-1.5 border border-amber/40 px-2 font-mono text-micro uppercase text-amber">
          <span aria-hidden className="h-1 w-1 bg-amber" />
          Simulated
        </span>
      </Tooltip>
    </header>
  );
}
