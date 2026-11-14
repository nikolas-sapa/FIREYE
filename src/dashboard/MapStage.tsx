import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Brackets, Button, Confidence, Icon, IconButton, Legend, Progress, Segmented, Serial, cn, color, fmtLat, fmtLon, role, toneClass, type IconName, type Tone } from '@ds';
import { TacticalMap } from '@/dashboard/map';
import { CELL_M, GRID_H, GRID_W, type MapLayers, type SimSnapshot } from '@/sim/types';
import {
  cardinal,
  cellToLatLon,
  markerIcon,
  markerKindLabel,
  markerTone,
  mmss,
  pct,
  severityTone,
  tPlus,
  unitGroupLabel,
  unitIcon,
} from './format';

export type MapMode = 'ortho' | 'oblique';

const LAYER_DEFS: { key: keyof MapLayers; code: string }[] = [
  { key: 'terrain', code: 'TER' },
  { key: 'contours', code: 'CON' },
  { key: 'fuel', code: 'FUEL' },
  { key: 'fire', code: 'FIRE' },
  { key: 'forecast', code: 'FCST' },
  { key: 'units', code: 'UNIT' },
  { key: 'markers', code: 'POI' },
  { key: 'grid', code: 'GRID' },
];

const MODES = [
  { value: 'ortho', label: 'Ortho' },
  { value: 'oblique', label: 'Oblique' },
];

const LEGEND = [
  { label: 'Fire front', color: role.fireFront, shape: 'line' as const },
  { label: 'Burn scar', color: role.burnScar, shape: 'square' as const },
  { label: 'Projection', color: role.fireForecast, shape: 'dash' as const },
  { label: 'Retardant', color: color.signal.DEFAULT, shape: 'hatch' as const },
  { label: 'UAS', color: role.drone, shape: 'dot' as const },
  { label: 'Ground', color: role.crew, shape: 'dot' as const },
  { label: 'Person', color: role.detection, shape: 'dot' as const },
];

const AO_CENTER = cellToLatLon({ x: GRID_W / 2, y: GRID_H / 2 });

/** Isolated so the WebGL/canvas map never re-renders with the 4Hz snapshot. */
const MapLayer = memo(function MapLayer(props: {
  layers: MapLayers;
  selectedId: string | null;
  onSelect(id: string | null): void;
  mode: MapMode;
}) {
  return <TacticalMap className="absolute inset-0" {...props} />;
});

function ForecastChip({ rev, t }: { rev: number; t: number }) {
  const tRef = useRef(t);
  tRef.current = t;
  const [revAt, setRevAt] = useState(t);
  const [flash, setFlash] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRevAt(tRef.current);
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(id);
  }, [rev]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex h-6 items-center gap-2 border px-2 font-mono text-micro uppercase transition-colors duration-slow ease-servo fcc-num',
        flash ? 'border-signal bg-signal-wash text-signal' : 'border-line bg-ink-950/90 text-bone-dim',
      )}
    >
      <span className={cn('h-1.5 w-1.5', flash ? 'animate-blink bg-signal' : 'bg-amber')} />
      <span>
        Path projection rev {String(rev).padStart(2, '0')} · updated {mmss(t - revAt)} ago
      </span>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="fcc-micro shrink-0">{k}</span>
      <span className={cn('min-w-0 truncate text-right font-mono text-tiny fcc-num', tone ?? 'text-bone')}>{v}</span>
    </div>
  );
}

function Inspector({
  state,
  selectedId,
  onSelect,
  onShowSource,
  onShowRecs,
}: {
  state: SimSnapshot;
  selectedId: string;
  onSelect(id: string | null): void;
  onShowSource(ingestId: string): void;
  onShowRecs(): void;
}) {
  const unit = state.units.find((u) => u.id === selectedId);
  const marker = unit ? undefined : state.markers.find((m) => m.id === selectedId);
  if (!unit && !marker) return null;

  const pos = (unit ?? marker)!.pos;
  const ll = cellToLatLon(pos);

  if (unit) {
    const tasked = state.recommendations.filter((r) => r.status !== 'dismissed' && r.unitIds.includes(unit.id)).length;
    const res = typeof unit.battery === 'number' ? { k: 'Battery', v: unit.battery } : typeof unit.water === 'number' ? { k: 'Payload H2O', v: unit.water } : null;
    return (
      <Card title={unit.callsign} kicker={unitGroupLabel[unit.kind]} icon={unitIcon[unit.kind]} onClose={() => onSelect(null)}
        badge={<Badge tone={unit.status === 'active' ? 'nominal' : unit.status === 'enroute' ? 'telemetry' : unit.status === 'rtb' ? 'warning' : 'neutral'} variant="soft" dot>{unit.status}</Badge>}
      >
        <Row k="Lat" v={fmtLat(ll.lat, 5)} />
        <Row k="Lon" v={fmtLon(ll.lon, 5)} />
        <Row k="Hdg / Spd" v={`${Math.round(((unit.heading % 360) + 360) % 360)}° ${cardinal(unit.heading)} · ${(unit.speed * CELL_M).toFixed(1)} M/S`} />
        {unit.sensor && <Row k="Sensor" v={unit.sensor} tone="text-ice" />}
        {unit.target && <Row k="Tasking" v={`${fmtLat(cellToLatLon(unit.target).lat, 3)} ${fmtLon(cellToLatLon(unit.target).lon, 3)}`} />}
        {res && (
          <div className="pt-1.5">
            <Progress value={res.v} label={res.k} showValue segments={20} tone={res.v < 0.25 ? 'danger' : unit.kind === 'drone' ? 'telemetry' : 'neutral'} />
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" icon="route" onClick={onShowRecs}>
            Tasking{tasked > 0 ? ` · ${tasked}` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Release
          </Button>
        </div>
      </Card>
    );
  }

  const m = marker!;
  const source = m.sourceId ? state.ingest.find((i) => i.id === m.sourceId) : undefined;
  return (
    <Card title={m.label} kicker={markerKindLabel[m.kind]} icon={markerIcon[m.kind]} iconTone={markerTone[m.kind]} onClose={() => onSelect(null)}
      badge={<Badge tone={severityTone[m.severity]} variant={m.severity === 'critical' ? 'solid' : 'soft'}>{m.severity}</Badge>}
    >
      <p className="mb-2 text-xs text-bone-dim">{m.detail}</p>
      <Row k="Lat" v={fmtLat(ll.lat, 5)} />
      <Row k="Lon" v={fmtLon(ll.lon, 5)} />
      <Row k="Detected" v={tPlus(m.detectedAt)} />
      <Row k="Source" v={source ? source.source : m.sourceId ? m.sourceId.toUpperCase() : 'ARGUS FUSION'} tone="text-ice" />
      <div className="flex items-center justify-between gap-3 pt-1.5">
        <span className="fcc-micro">Confidence</span>
        <Confidence value={m.confidence} showValue />
      </div>
      <div className="mt-3 flex gap-2">
        {m.sourceId && (
          <Button size="sm" variant="secondary" icon="eye" onClick={() => onShowSource(m.sourceId!)}>
            View source
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
          Clear
        </Button>
      </div>
      <span className="sr-only">Confidence {pct(m.confidence)} percent</span>
    </Card>
  );
}

function Card({
  title,
  kicker,
  icon,
  iconTone,
  badge,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  icon: IconName;
  iconTone?: Tone;
  badge: ReactNode;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-auto relative w-[288px] animate-rise border border-line-strong bg-ink-950/95 shadow-lift">
      <Brackets size={6} tone="signal" />
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center border border-line bg-ink-850', iconTone ? toneClass[iconTone].text : 'text-bone')}>
          <Icon name={icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="fcc-micro truncate">{kicker}</div>
          <div className="truncate font-mono text-tiny text-bone">{title}</div>
        </div>
        {badge}
        <IconButton icon="close" label="Close inspector" size="sm" variant="ghost" onClick={onClose} />
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

export function MapStage({
  state,
  layers,
  onToggleLayer,
  mode,
  onMode,
  selectedId,
  onSelect,
  onShowSource,
  onShowRecs,
  className,
}: {
  state: SimSnapshot;
  layers: MapLayers;
  onToggleLayer(k: keyof MapLayers): void;
  mode: MapMode;
  onMode(m: MapMode): void;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onShowSource(ingestId: string): void;
  onShowRecs(): void;
  className?: string;
}) {
  const humans = state.markers.filter((m) => m.kind === 'human').length;
  const crit = state.markers.filter((m) => m.severity === 'critical').length;

  return (
    <div className={cn('relative min-h-0 min-w-0 overflow-hidden bg-void', className)}>
      <MapLayer layers={layers} selectedId={selectedId} onSelect={onSelect} mode={mode} />

      <div className="pointer-events-none absolute inset-0 z-hud">
        <Brackets size={12} tone="bone" inset={8} />

        {/* Title block + projection revision */}
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          <div className="pointer-events-auto border border-line bg-ink-950/90 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-nano text-bone">AO RIDGE · 1:24K · EO COMPOSITE</span>
              <Serial>MAP-01</Serial>
            </div>
            <div className="mt-1 flex gap-3 fcc-micro fcc-num">
              <span>
                {fmtLat(AO_CENTER.lat, 3)} {fmtLon(AO_CENTER.lon, 3)}
              </span>
              <span>WGS84</span>
              <span>{mode === 'ortho' ? 'NADIR' : 'OBL 55°'}</span>
            </div>
          </div>
          <ForecastChip rev={state.forecastRev} t={state.t} />
          {(humans > 0 || crit > 0) && (
            <div className="pointer-events-auto flex h-6 items-center gap-2 border border-ember/50 bg-ember/10 px-2 font-mono text-micro uppercase text-ember fcc-num">
              <Icon name="alert" size={12} />
              {crit} critical · {humans} person det.
            </div>
          )}
        </div>

        {/* View mode + layers */}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <div className="pointer-events-auto bg-ink-950/90">
            <Segmented size="sm" options={MODES} value={mode} onChange={(v) => onMode(v as MapMode)} />
          </div>
          <div className="pointer-events-auto w-[88px] border border-line bg-ink-950/90">
            <div className="flex h-6 items-center gap-1.5 border-b border-line px-2 text-bone-mute">
              <Icon name="layers" size={12} />
              <span className="fcc-micro">Layers</span>
            </div>
            {LAYER_DEFS.map(({ key, code }) => {
              const on = layers[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleLayer(key)}
                  className={cn(
                    'flex h-6 w-full items-center gap-2 px-2 font-mono text-micro uppercase transition-colors duration-quick ease-servo hover:bg-ink-800',
                    on ? 'text-bone' : 'text-ink-400',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 border', on ? 'border-signal bg-signal' : 'border-ink-500')} />
                  {code}
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="pointer-events-auto absolute bottom-3 left-3 max-w-[calc(100%-320px)] border border-line bg-ink-950/90 px-3 py-2">
          <Legend items={LEGEND} direction="row" />
        </div>

        {/* Inspector */}
        <div className="absolute bottom-3 right-3">
          {selectedId ? (
            <Inspector key={selectedId} state={state} selectedId={selectedId} onSelect={onSelect} onShowSource={onShowSource} onShowRecs={onShowRecs} />
          ) : (
            <div className="flex h-6 items-center gap-2 border border-line bg-ink-950/90 px-2 font-mono text-micro uppercase text-bone-mute">
              <Icon name="target" size={12} />
              Select entity to inspect
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
