import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Modal, cn, type IconName } from '@ds';
import { useConsoleSelector } from '../../store';
import { useStageWorld } from '../../stage3d/world';
import { sensorModel } from '../data/sensors';
import { dispatchCheck } from '../data/fleet';
import { SOURCE_LABELS } from '../data/source-flow';
import { SourceFlow } from './SourceFlow';
import { fireyeUi } from './ui';

function SourceTile({ icon, code, title, detail, compact, tone = 'text-bone-dim', onClick, children }: {
  icon: IconName; code: string; title: string; detail: string; compact: boolean; tone?: string; onClick: () => void; children?: ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const show = () => { if (compact) setRect(ref.current?.getBoundingClientRect() ?? null); };
  return (
    <div className={cn('min-w-0', !compact && 'flex items-center gap-2')}>
      <button ref={ref} type="button" aria-label={title} onClick={onClick} onMouseEnter={show} onMouseLeave={() => setRect(null)}
        onFocus={show} onBlur={() => setRect(null)} aria-describedby={rect ? `hover-${code}` : undefined}
        className={cn('flex shrink-0 flex-col items-center justify-center gap-1 border border-line bg-ink-950 outline-none transition-colors duration-quick hover:border-line-strong hover:bg-ink-800 focus-visible:border-signal', compact ? 'h-11 w-11' : 'h-10 w-10', tone)}>
        <Icon name={icon} size={17} />
        <span className="fcc-num font-mono text-micro uppercase leading-none">{code}</span>
      </button>
      {!compact && <div className="min-w-0 flex-1"><button type="button" onClick={onClick} className="block w-full truncate text-left font-mono text-micro uppercase text-bone">{title}</button><p className="mt-1 truncate text-xs text-bone-mute">{detail}</p>{children}</div>}
      {rect && createPortal(
        <div role="tooltip" id={`hover-${code}`} className="fireye-hover-card pointer-events-none fixed z-modal w-[280px] border border-line-strong bg-ink-950 p-3 shadow-panel"
          style={{ left: Math.min(rect.right + 6, window.innerWidth - 288), top: Math.max(8, Math.min(rect.top, window.innerHeight - 170)) }}>
          <p className={cn('flex items-center gap-2 font-mono text-micro uppercase', tone)}><Icon name={icon} size={15} />{title}</p>
          <p className="mt-2 whitespace-pre-line text-xs leading-5 text-bone-dim">{detail}</p>
          <p className="mt-2 font-mono text-micro uppercase text-bone-mute">Click to open</p>
        </div>, document.body)}
    </div>
  );
}

/** A persistent two-column icon rail; details expand over the map rather than moving it. */
export function FleetColumn({ compact = false, onDive, onFocusUnit, onFocusSensor }: {
  compact?: boolean; onDive: (feedId: string) => void; onFocusUnit: (unitId: string) => void; onFocusSensor: (id: string) => void;
}) {
  const state = useConsoleSelector(s => s), feeds = useStageWorld(s => s.feeds);
  const [flowId, setFlowId] = useState<string | null>(null);
  const sensors = useMemo(() => state.pack ? sensorModel(state.pack) : null, [state.pack]);
  const dispatch = useMemo(() => dispatchCheck(state), [state.pack, state.recon?.stations, Math.floor(state.clock.t / 60000)]);
  const cams = feeds.filter(f => f.kind === 'ridge-cam');
  const grid = compact ? 'grid grid-cols-2 gap-1 px-1.5' : 'flex flex-col gap-2 px-3';
  const heading = (text: string) => <h3 className="px-2 pb-1 pt-3 font-mono text-micro uppercase tracking-[0.1em] text-bone-mute">{text}</h3>;
  const groups: [string, IconName, string][] = [['vision', 'camera', 'AI'], ['iot', 'sensor', 'IOT'], ['weather', 'wind', 'WX'], ['radio', 'radio', 'RAD'], ['terrain', 'layers', 'DEM'], ['connection', 'sensor', 'LINK']];
  return (
    <section aria-label="Fleet and sources" className="flex h-full min-h-0 flex-col bg-ink-950">
      <button type="button" onClick={() => fireyeUi.setLayout({ leftOpen: compact })} aria-label={compact ? 'Expand fleet panel' : 'Collapse fleet panel'}
        className="flex h-9 shrink-0 items-center justify-between border-b border-line px-2 font-mono text-micro uppercase text-bone-dim">
        Fleet <Icon name={compact ? 'chevron-right' : 'chevron-left'} size={12} />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3">
        {heading('Drones')}
        <div className={grid}>
          {state.units.map(u => {
            const drone = state.recon?.drones?.find(d => d.unitId === u.id);
            const task = state.recon?.tasks.find(t => t.id === u.taskId), feed = feeds.find(f => f.unitId === u.id);
            const station = state.recon?.stations?.find(s => s.id === drone?.stationId);
            const battery = Math.round((u.battery ?? 0) * 100);
            return <SourceTile key={u.id} icon="drone" code={`A${u.id.split('-')[1]} ${battery}`} title={`Open ${u.callsign} feed`} compact={compact}
              tone={drone?.phase === 'charging' ? 'text-amber' : feed?.live ? 'text-ice' : 'text-bone-mute'}
              detail={`${u.callsign} · ${battery}% · ${drone?.phase ?? u.status}\n${task ? `${task.pattern} pattern · ${task.label}` : 'Station reserve'}\n${station?.name ?? ''}\n${feed?.offlineReason ?? 'Live simulated camera'}`}
              onClick={() => feed && onDive(feed.id)}>
              <div className="mt-1 flex gap-3 font-mono text-micro uppercase"><button type="button" onClick={() => feed && setFlowId(feed.id)} className="text-ice">Flow</button><button type="button" onClick={() => onFocusUnit(u.id)} className="text-bone-mute">Locate</button></div>
            </SourceTile>;
          })}
        </div>
        {heading('Stations')}
        <div className={grid}>{state.recon?.stations?.map((s, i) => <SourceTile key={s.id} compact={compact} icon="battery" code={i ? 'SOUTH' : 'NORTH'} title={s.name}
          detail={`${state.recon?.drones?.filter(d => d.stationId === s.id && (d.phase === 'docked' || d.phase === 'charging')).length} on pad · 3 allocated\n18-minute full recharge · simulated`} onClick={() => setFlowId(s.id)} />)}</div>
        {!compact && dispatch && <div className="px-3 pt-2">
          <p className="font-mono text-micro uppercase text-bone-mute">Dispatch check · simulated</p>
          <p className="text-xs text-bone-dim">{dispatch.result.status === 'served' && dispatch.stationName && dispatch.result.responseS != null
            ? `${dispatch.stationName} · arrival ${(dispatch.result.responseS / 60).toFixed(1)} min · ${dispatch.result.within15min ? 'within 15 min' : 'over 15 min'} · wind ${dispatch.windKph} km/h`
            : `No eligible station · ${dispatch.result.status.replace(/_/g, ' ')}`}</p>
          <p className="text-micro text-bone-mute">wildfire-sweep model · not flight authorization</p>
        </div>}
        {heading(`Cameras ${cams.length}`)}
        <div className={grid}>{cams.map((c, i) => <SourceTile key={c.id} compact={compact} icon="camera" code={`C${i + 1}`} title={`Open ${c.label.split(' · ')[0]} feed`}
          tone={c.live ? 'text-phosphor' : 'text-bone-mute'} detail={`${c.label}\n${c.live ? 'Live simulated fixed camera' : 'Offline'} · ${c.findingIds.length} findings\nFixed mount · terrain coverage`}
          onClick={() => onDive(c.id)}><button type="button" onClick={() => setFlowId(c.id)} className="font-mono text-micro uppercase text-ice">Analysis flow</button></SourceTile>)}</div>
        {heading('Sources')}
        <div className={grid}>{groups.map(([id, icon, code]) => <SourceTile key={id} compact={compact} icon={icon} code={code} title={SOURCE_LABELS[id]}
          detail={id === 'iot' ? `${sensors?.specs.length ?? 0} simulated nodes\nCurrent readings → risk analysis → Orchestrator tasking` : id === 'connection' ? 'Isolated read-only Crew entry\nNo mapped positions or simulated fallback' : `${SOURCE_LABELS[id]}\nInspect current and past analysis, evidence links and Orchestrator decisions`}
          onClick={() => setFlowId(id)} />)}</div>
        {!compact && <details className="px-3 pt-3"><summary className="cursor-pointer font-mono text-micro uppercase text-bone-mute">Ground sensors</summary>
          {sensors?.specs.map(s => <button key={s.id} type="button" onClick={() => onFocusSensor(s.id)} className="mt-2 block text-xs text-bone-dim">{s.code} · {s.sector}</button>)}
        </details>}
      </div>
      <p className="border-t border-line p-2 text-center font-mono text-micro uppercase text-bone-mute">Simulated</p>
      {flowId && flowId !== 'connection' && <SourceFlow id={flowId} onClose={() => setFlowId(null)} onOpenFeed={onDive} />}
      <Modal open={flowId === 'connection'} onClose={() => setFlowId(null)} title="Read-only source connection">
        <p>FIREYE uses the local reconnaissance simulation. Received backend state is available in the isolated Crew reader.</p>
        <a href={`${import.meta.env?.BASE_URL ?? '/'}console.html?mode=crew`} className="mt-3 inline-block border border-line px-3 py-2 font-mono text-micro uppercase text-bone">Open Crew reader</a>
        <p className="mt-3 text-xs text-bone-mute">GET-only. Reader capabilities stay in memory. No simulator fallback, mapped positions or verified media are implied.</p>
      </Modal>
    </section>
  );
}
