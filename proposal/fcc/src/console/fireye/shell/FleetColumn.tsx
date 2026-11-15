import { useMemo } from 'react';
import { Icon, cn } from '@ds';
import { useConsoleSelector } from '../../store';
import { useStageWorld } from '../../stage3d/world';
import { COMMAND_FLOW, simFleet, type CommandStatus, type FleetAsset } from '../data/fleet';
import { SENSOR_KIND_LABEL } from '../data/sensors';
import type { SensorStatus } from '../data/types';
import { localTime, packZone } from '../../ui/format';
import { isUav, sensorOf, useChronicle } from './sync';
import { fireyeUi, useFireye } from './ui';

function Section({ title, meta, children, i }: { title: string; meta?: React.ReactNode; children: React.ReactNode; i: number }) {
  return (
    <section className="fireye-enter border-b border-line" style={{ ['--i' as string]: i }}>
      <header className="flex h-8 items-center gap-2 px-3">
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-bone-dim">{title}</span>
        <span className="ml-auto font-mono text-micro uppercase text-bone-mute">{meta}</span>
      </header>
      {children}
    </section>
  );
}

const STATUS_TONE: Record<CommandStatus, string> = {
  enqueued: 'text-bone-dim', sent: 'text-bone-dim', delivered: 'text-ice', accepted: 'text-ice', running: 'text-phosphor',
  completed: 'text-bone-mute', failed: 'text-ember', cancelled: 'text-bone-mute', rejected: 'text-ember',
};

function Pipeline({ status }: { status: CommandStatus }) {
  const idx = COMMAND_FLOW.indexOf(status);
  const bad = status === 'failed' || status === 'rejected' || status === 'cancelled';
  return (
    <span className="flex items-center gap-0.5" aria-label={`Command ${status}`}>
      {COMMAND_FLOW.map((s, i) => (
        <span key={s} title={s} className={cn('h-1 w-3 transition-colors duration-base ease-servo',
          bad ? (i === 0 ? 'bg-ember' : 'bg-ink-700') : i < idx ? 'bg-bone-mute' : i === idx ? (s === 'running' ? 'bg-phosphor' : 'bg-bone') : 'bg-ink-700')} />
      ))}
    </span>
  );
}

function Battery({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="font-mono text-micro text-bone-mute">BAT —</span>;
  return (
    <span className="flex items-center gap-1 font-mono text-micro text-bone-dim">
      <span className="relative h-1.5 w-6 border border-line-strong">
        <span className={cn('absolute inset-y-0 left-0', pct < 25 ? 'bg-ember' : pct < 45 ? 'bg-amber' : 'bg-bone-dim')} style={{ width: `${pct}%` }} />
      </span>
      <span className="fcc-num">{pct}%</span>
    </span>
  );
}

function AssetRow({ a, onSelect, onDive, selected }: { a: FleetAsset; onSelect: () => void; onDive: () => void; selected: boolean }) {
  const feeds = useStageWorld((s) => s.feeds);
  const feed = a.feedId ? feeds.find((f) => f.id === a.feedId) : undefined;
  const sensor = feed && isUav(feed) ? sensorOf(feed) : null;
  return (
    <div className={cn('group relative border-t border-line-faint px-3 py-2 transition-colors duration-quick ease-servo', selected ? 'bg-ink-800' : 'hover:bg-ink-900')}>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-signal" />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-2 text-left" aria-label={`Select ${a.callsign}`}>
          <Icon name="drone" size={13} className="text-ice" />
          <span className="font-mono text-tiny uppercase tracking-[0.1em] text-bone">{a.callsign}</span>
          <span className="font-mono text-micro uppercase text-bone-mute">{a.asset_id}</span>
        </button>
        <span className="ml-auto flex items-center gap-1">
          {a.capabilities.map((c) => (
            <button key={c} type="button" disabled={!feed}
              aria-pressed={sensor === c}
              onClick={() => feed && sensor !== c && fireyeUi.toggleFx(feed.id, sensor ?? 'eo')}
              title={`Display palette only; source channel remains ${feed?.modality ?? 'unknown'}. Not radiometric.`}
              className={cn('border px-1 font-mono text-micro uppercase leading-4 transition-colors duration-quick ease-servo',
                sensor === c ? 'border-bone-dim text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
              {c === 'thermal' ? 'IR FX' : 'EO FX'}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
        <span className={cn(a.feed_status === 'available' ? 'text-phosphor' : a.feed_status === 'unavailable' ? 'text-ember' : 'text-amber')}>{a.feed_status}</span>
        <Battery pct={a.battery_percent} />
        <span className="fcc-num">{a.altM != null ? `${Math.round(a.altM)} M AGL` : 'Position unmapped'}</span>
        {a.feedId && (
          <button type="button" onClick={onDive} className="ml-auto flex items-center gap-1 text-bone-dim opacity-0 transition-opacity duration-quick ease-servo hover:text-bone focus-visible:opacity-100 group-hover:opacity-100">
            <Icon name="video" size={10} />Dive
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-bone-dim">{a.task}</span>
        {a.command && <Pipeline status={a.command.status} />}
      </div>
      <div className="mt-0.5 flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
        <span className="truncate">{a.mission_id ?? 'No mission'}{a.mission_version != null ? ` · v${a.mission_version}` : ''}</span>
        {a.command && <span className={cn('ml-auto', STATUS_TONE[a.command.status])}>{a.command.status}</span>}
      </div>
    </div>
  );
}

const SENSOR_DOT: Record<SensorStatus, string> = { nominal: 'bg-bone-mute', watch: 'bg-amber', alarm: 'bg-ember', offline: 'bg-ink-500' };

export function FleetColumn({ onDive, onFocusUnit, onFocusSensor }: { onDive: (feedId: string) => void; onFocusUnit: (unitId: string) => void; onFocusSensor: (id: string) => void }) {
  const ch = useChronicle();
  const t = useConsoleSelector((s) => s.clock.t);
  const units = useConsoleSelector((s) => s.units);
  const projection = useConsoleSelector((s) => s.projection);
  const predictions = useConsoleSelector((s) => s.predictions);
  const actions = useConsoleSelector((s) => s.actions);
  const pack = useConsoleSelector((s) => s.pack);
  const feeds = useStageWorld((s) => s.feeds);
  const selected = useFireye((s) => s.selected);
  const fleetLog = useMemo(() => ch?.entries.filter((e) => e.command) ?? [], [ch]);
  const tick = Math.floor(t / 5000);
  const sim = useMemo(() => simFleet({ clock: { t, speed: 0, paused: false }, units, feeds, projection, predictions, actions }, fleetLog), [tick, units, feeds, projection, predictions, actions, fleetLog]);
  const snap = sim;
  const readings = ch ? ch.sensors.all(t) : [];
  const counts = readings.reduce<Record<SensorStatus, number>>((m, r) => { m[r.status]++; return m; }, { nominal: 0, watch: 0, alarm: 0, offline: 0 });
  const tripped = readings.filter((r) => r.status === 'alarm' || r.status === 'offline');
  const cams = feeds.filter((f) => f.kind === 'ridge-cam');
  const z = packZone(pack);
  const live = snap.assets.filter((a) => a.feed_status === 'available').length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950">
      <div className="fireye-enter flex h-9 shrink-0 items-center gap-2 border-b border-line px-3" style={{ ['--i' as string]: 1 }}>
        <span className="font-mono text-nano uppercase tracking-[0.2em] text-bone">Fleet</span>
        <span className="font-mono text-micro uppercase text-bone-mute">{snap.mode}</span>
        <div className="ml-auto flex h-6 items-stretch border border-line-strong">
          <span className="bg-ink-700 px-2 font-mono text-micro uppercase leading-6 text-bone">Sim</span>
          <a href="/console.html?mode=crew" className="border-l border-line px-2 font-mono text-micro uppercase leading-6 text-bone-mute hover:text-bone-dim">Crew reader</a>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section i={2} title="UAV assets" meta={<span className="fcc-num">{live}/{snap.assets.length} live</span>}>
          {snap.assets.length === 0 && <p className="px-3 pb-3 font-mono text-micro uppercase text-bone-mute">No assets received</p>}
          {snap.assets.map((a) => (
            <AssetRow key={a.asset_id} a={a} selected={!!a.unitId && selected === a.unitId}
              onSelect={() => { if (a.unitId) { fireyeUi.set({ selected: a.unitId }); onFocusUnit(a.unitId); } }}
              onDive={() => a.feedId && onDive(a.feedId)} />
          ))}
        </Section>
        <Section i={3} title="Ground cameras" meta={`${cams.length} fixed`}>
          {cams.map((c) => (
            <button key={c.id} type="button" onClick={() => onDive(c.id)} className="flex w-full items-center gap-2 border-t border-line-faint px-3 py-1.5 text-left hover:bg-ink-900">
              <Icon name="camera" size={12} className="text-ice" />
              <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase text-bone-dim">{c.label}</span>
              <span className="font-mono text-micro uppercase text-phosphor">{c.live ? 'available' : 'stale'}</span>
            </button>
          ))}
        </Section>
        <Section i={4} title="IoT mesh" meta="Simulated">
          <div className="grid grid-cols-4 gap-px border-t border-line-faint bg-line-faint">
            {(['nominal', 'watch', 'alarm', 'offline'] as SensorStatus[]).map((s) => (
              <div key={s} className="flex flex-col items-start gap-0.5 bg-ink-950 px-3 py-1.5">
                <span className="flex items-center gap-1 font-mono text-micro uppercase text-bone-mute"><span className={cn('h-1.5 w-1.5', SENSOR_DOT[s])} />{s}</span>
                <span className={cn('fcc-num font-mono text-sm leading-none', s === 'alarm' && counts[s] ? 'text-ember' : 'text-bone')}>{counts[s]}</span>
              </div>
            ))}
          </div>
          {tripped.slice(0, 6).map((r) => {
            const s = ch!.sensors.specs.find((x) => x.id === r.id)!;
            return (
              <button key={r.id} type="button" onClick={() => onFocusSensor(r.id)} className="flex w-full items-center gap-2 border-t border-line-faint px-3 py-1.5 text-left hover:bg-ink-900">
                <span className={cn('h-1.5 w-1.5', SENSOR_DOT[r.status])} />
                <span className="font-mono text-micro uppercase text-bone">{s.code}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase text-bone-mute">{SENSOR_KIND_LABEL[s.kind]} · {s.sector}</span>
                <span className={cn('font-mono text-micro uppercase', r.status === 'alarm' ? 'text-ember' : 'text-bone-mute')}>{r.status}</span>
              </button>
            );
          })}
        </Section>
        <Section i={5} title="Analysis" meta="Toy estimates">
          {snap.assessments.length === 0 && <p className="px-3 pb-2 font-mono text-micro uppercase text-bone-mute">No assessments yet</p>}
          {snap.assessments.map((a) => (
            <div key={a.id} className="border-t border-line-faint px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-bone-dim">{a.label}</span>
                <span className={cn('font-mono text-micro uppercase', a.status === 'proposed' ? 'text-signal' : a.status === 'assessing' ? 'text-ice' : 'text-bone-mute')}>{a.status.replace('_', ' ')}</span>
              </div>
              <div className="mt-0.5 flex gap-2 font-mono text-micro uppercase text-bone-mute">
                <span>{a.ranking_source}</span><span className="truncate">{a.note}</span>
              </div>
            </div>
          ))}
        </Section>
        <Section i={6} title="Providers" meta={snap.source === 'sim' ? `Sim · ${localTime(t, z.label)}` : 'Bridge'}>
          {snap.providers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 border-t border-line-faint px-3 py-1.5 font-mono text-micro uppercase">
              <span className="text-bone-dim">{p.label}</span>
              <span className={cn('ml-auto', p.status === 'connected' ? 'text-phosphor' : 'text-bone-mute')}>{p.status}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
