import { Icon, cn, color, role, type IconName, type LegendItem } from '@ds';
import { useMapSettings } from '../../stage3d/map-settings';
import { fireyeUi, useFireye, type VisGroup } from './ui';

type Row = (LegendItem & { icon?: undefined }) | { label: string; icon: IconName; tone: string; color?: undefined; shape?: undefined };
interface Group { title: string; vis?: VisGroup[]; rows: Row[] }

function Swatch({ c, shape }: { c: string; shape: NonNullable<LegendItem['shape']> }) {
  const st = { ['--c' as string]: c } as React.CSSProperties;
  if (shape === 'line') return <span aria-hidden className="h-0.5 w-4 bg-[var(--c)]" style={st} />;
  if (shape === 'dash') return <span aria-hidden className="h-0 w-4 border-t border-dashed border-[var(--c)]" style={st} />;
  if (shape === 'dot') return <span aria-hidden className="h-2 w-2 rounded-pill border border-[var(--c)]" style={st} />;
  if (shape === 'hatch') return <span aria-hidden className="fcc-hatch h-2.5 w-4 border border-[var(--c)]" style={st} />;
  return <span aria-hidden className="h-2.5 w-2.5 bg-[var(--c)]" style={st} />;
}

function groups(outline: boolean, thermal: boolean): Group[] {
  return [
    { title: 'Fleet & aircraft', vis: ['fleet'], rows: [
      { label: 'UAV · simulated (click to dive)', icon: 'drone', tone: 'text-ice' },
      { label: 'Helicopter', icon: 'helo', tone: 'text-ice' },
      { label: 'Fixed-wing tanker', icon: 'tanker', tone: 'text-ice' },
      { label: 'Altitude stem', color: role.drone, shape: 'line' },
    ] },
    { title: 'Ground', vis: ['groundUnits', 'groundCams'], rows: [
      { label: 'Engine / crew', icon: 'engine', tone: 'text-bone' },
      { label: 'Fixed ridge camera', icon: 'camera', tone: 'text-ice' },
      { label: 'Camera view cone', color: color.ice, shape: 'dash' },
    ] },
    { title: 'IoT mesh · simulated', vis: ['iot'], rows: [
      { label: 'Weather node', icon: 'wind', tone: 'text-bone-dim' },
      { label: 'Fuel moisture', icon: 'droplet', tone: 'text-bone-dim' },
      { label: 'Smoke / CO / PM2.5', icon: 'sensor', tone: 'text-bone-dim' },
      { label: 'IR flame detector', icon: 'flame', tone: 'text-bone-dim' },
      { label: 'Nominal', color: color.bone.dim, shape: 'square' },
      { label: 'Watch threshold', color: color.amber, shape: 'square' },
      { label: 'Alarm', color: color.ember, shape: 'square' },
      { label: 'Offline', color: color.ink[400], shape: 'square' },
    ] },
    { title: 'Paths & sensing', vis: ['flightPaths', 'footprints', 'findings'], rows: [
      { label: 'Flight path / trail', color: role.drone, shape: 'line' },
      { label: 'Sensor footprint', color: role.telemetry, shape: 'hatch' },
      { label: 'Proposed route', color: role.accent, shape: 'dash' },
      { label: 'Detection (approx. ring)', color: role.detection, shape: 'dot' },
    ] },
    { title: 'Fire', vis: ['fireFront', 'projections'], rows: [
      { label: 'Active front', color: role.fireFront, shape: 'line' },
      { label: 'Burn scar (reconstruction)', color: role.burnScar, shape: 'hatch' },
      { label: '+1H / +3H / +6H projection', color: role.fireForecast, shape: 'dash' },
    ] },
    { title: 'Ignition risk', vis: ['risk'], rows: [
      { label: 'Elevated sector (≥ 68)', color: color.amber, shape: 'square' },
      { label: 'High sector (≥ 72)', color: color.ember, shape: 'square' },
    ] },
    { title: outline ? 'Outline cartography' : 'Satellite basemap', vis: ['roadsPlaces'], rows: outline ? [
      { label: 'Roads', color: color.bone.mute, shape: 'line' },
      { label: 'Buildings', color: color.bone.mute, shape: 'square' },
      { label: 'Contours', color: color.ink[400], shape: 'line' },
    ] : [
      { label: 'Imagery · not incident-time', color: color.ink[400], shape: 'hatch' },
      { label: 'Roads', color: color.bone.mute, shape: 'line' },
    ] },
    ...(thermal ? [{ title: 'Thermal view', rows: [
      { label: 'Hot (fire-hued pixels)', color: color.bone.DEFAULT, shape: 'square' as const },
      { label: 'Cool background', color: color.ink[600], shape: 'square' as const },
    ] }] : []),
  ];
}

export function LegendPanel() {
  const map = useMapSettings();
  const thermal = useFireye((s) => s.thermal);
  const vis = useFireye((s) => s.vis);
  return (
    <section aria-label="Legend" className="fireye-pop pointer-events-auto flex max-h-full w-[300px] flex-col border border-line-strong bg-ink-950/95 shadow-panel">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <Icon name="grid" size={11} className="text-bone-mute" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Legend</span>
        <span className="font-mono text-micro uppercase text-bone-mute">{map.mode}{thermal ? ' · thermal' : ''}</span>
        <button type="button" aria-label="Close legend" onClick={() => fireyeUi.set({ panel: null })} className="ml-auto text-bone-mute hover:text-bone"><Icon name="close" size={11} /></button>
      </header>
      <div className="min-h-0 overflow-y-auto px-3 py-2">
        {groups(map.mode === 'outline', thermal).map((g) => {
          const shown = !g.vis || g.vis.some((k) => vis[k]);
          return (
            <div key={g.title} className={cn('border-b border-line-faint py-2 last:border-0', !shown && 'opacity-40')}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">{g.title}</span>
                {!shown && <span className="font-mono text-micro uppercase text-bone-mute">hidden</span>}
              </div>
              <ul className="grid grid-cols-1 gap-1">
                {g.rows.map((r) => (
                  <li key={r.label} className="flex items-center gap-2">
                    <span className="flex w-4 justify-center">{r.icon ? <Icon name={r.icon} size={12} className={r.tone} /> : <Swatch c={r.color!} shape={r.shape ?? 'square'} />}</span>
                    <span className="font-mono text-micro uppercase text-bone-dim">{r.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {thermal && <p className="pt-1 font-mono text-micro uppercase leading-4 text-amber">Simulated thermal · not radiometric</p>}
      </div>
    </section>
  );
}
