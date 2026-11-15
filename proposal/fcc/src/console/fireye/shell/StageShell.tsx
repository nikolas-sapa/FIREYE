import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PerspectiveFrustum } from 'cesium';
import { Icon, Sparkline, cn } from '@ds';
import type { Geo } from '../../contracts';
import { useConsoleSelector } from '../../store';
import { StageView, type StageSelectKind } from '../../stage3d/StageView';
import { FireyeOverlay } from '../../stage3d/sensors-layer';
import type { StageEngine } from '../../stage3d/StageEngine';
import { ThermalPass } from '../../stage3d/thermal';
import { stageWorld, useStageWorld } from '../../stage3d/world';
import { setMapLayers } from '../../stage3d/map-settings';
import { localTime, packZone } from '../../ui/format';
import { SENSOR_KIND_LABEL, sensorModel } from '../data/sensors';
import { CameraControls } from './CameraControls';
import { dive, DiveLayer } from './Dive';
import { LegendPanel } from './Legend';
import { OrchestratorCallout, OrchestratorChat } from './OrchestratorCallout';
import { isUav } from './sync';
import { mapFraming, type MapInsets } from './map-framing';
import { fireyeUi, mapPatch, useFireye } from './ui';
import { VisibilityPanel } from './Visibility';

const ZERO_INSETS: MapInsets = { left: 0, right: 0, top: 0, bottom: 0 };

const STATUS_TEXT = { nominal: 'text-bone-dim', watch: 'text-amber', alarm: 'text-ember', offline: 'text-bone-mute' } as const;

function SensorCard({ id }: { id: string }) {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 30000) * 30000);
  const model = useMemo(() => (pack ? sensorModel(pack) : null), [pack]);
  const spec = model?.specs.find((s) => s.id === id);
  const series = useMemo(() => {
    if (!model || !spec) return null;
    const pts = Array.from({ length: 25 }, (_, i) => model.readingAt(id, t - (24 - i) * 5 * 60000));
    return pts;
  }, [model, spec, id, t]);
  if (!model || !spec || !series) return null;
  const r = series[series.length - 1]!;
  const tz = packZone(pack).label;
  const rows: { k: string; v: string; data: number[]; tone?: 'danger' | 'warning' }[] = [
    { k: 'Temp', v: `${r.tempC.toFixed(1)} °C`, data: series.map((x) => x.tempC) },
    { k: 'RH', v: `${Math.round(r.rh)} %`, data: series.map((x) => x.rh) },
    { k: 'Wind', v: `${Math.round(r.windKph)} / G${Math.round(r.gustKph)} km/h`, data: series.map((x) => x.gustKph) },
    ...(spec.kind === 'fuel' || spec.kind === 'wx' ? [{ k: 'Fuel moist.', v: `${r.fmc.toFixed(1)} %`, data: series.map((x) => x.fmc), tone: r.fmc <= 5.5 ? 'warning' as const : undefined }] : []),
    ...(spec.kind === 'air' ? [{ k: 'PM2.5', v: `${Math.round(r.pm25)} µg/m³`, data: series.map((x) => x.pm25), tone: r.pm25 > 150 ? 'danger' as const : undefined }, { k: 'CO', v: `${r.co.toFixed(1)} ppm`, data: series.map((x) => x.co) }] : []),
    ...(spec.kind === 'flame' ? [{ k: 'IR resp.', v: r.ir.toFixed(2), data: series.map((x) => x.ir), tone: r.ir > 0.5 ? 'danger' as const : undefined }] : []),
    { k: 'FFWI', v: `${Math.round(r.ffwi)}`, data: series.map((x) => x.ffwi) },
  ];
  return (
    <section aria-label={`${spec.code} sensor`} className="fireye-pop pointer-events-auto w-[280px] border border-line-strong bg-ink-950/95 shadow-panel">
      <header className="flex h-8 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">{spec.code}</span>
        <span className="font-mono text-micro uppercase text-bone-mute">{SENSOR_KIND_LABEL[spec.kind]}</span>
        <span className={cn('ml-auto font-mono text-micro uppercase', STATUS_TEXT[r.status])}>{r.status}</span>
        <button type="button" aria-label="Close sensor" onClick={() => fireyeUi.set({ selected: null })} className="text-bone-mute hover:text-bone"><Icon name="close" size={11} /></button>
      </header>
      <div className="px-3 py-2">
        <p className="mb-1.5 font-mono text-micro uppercase text-bone-mute">{spec.name} · {spec.sector} · {Math.round(spec.elevM)} m · {r.fireDistM != null ? `fire ${(r.fireDistM / 1000).toFixed(1)} km` : 'no fire within 3 km'}</p>
        {rows.map((x) => (
          <div key={x.k} className="flex h-6 items-center gap-2 border-b border-line-faint last:border-0">
            <span className="w-16 font-mono text-micro uppercase text-bone-mute">{x.k}</span>
            <Sparkline data={x.data} width={96} height={16} tone={x.tone ?? 'neutral'} />
            <span className={cn('fcc-num ml-auto font-mono text-micro', x.tone === 'danger' ? 'text-ember' : x.tone === 'warning' ? 'text-amber' : 'text-bone')}>{x.v}</span>
          </div>
        ))}
        <p className="mt-1.5 font-mono text-micro uppercase leading-4 text-bone-mute">Simulated node · 2 h trend · {localTime(t, tz)} {tz} · batt {Math.round(r.battery * 100)}%</p>
      </div>
    </section>
  );
}

/** The main globe plus every FIREYE overlay: thermal pass, IoT/camera glyphs, camera cluster, panels, callout, chat, dive. */
export function StageShell({ onFocus, onEngine, insets = ZERO_INSETS }: {
  onFocus: (g: Geo, rangeM?: number) => void;
  onEngine?: (e: StageEngine | null) => void;
  insets?: MapInsets;
}) {
  const [engine, setEngine] = useState<StageEngine | null>(null);
  useEffect(() => { onEngine?.(engine); }, [engine, onEngine]);
  const pack = useStageWorld((s) => s.pack);
  const recon = useConsoleSelector(s => !!s.recon);
  const stations = useConsoleSelector(s => s.recon?.stations);
  const drones = useConsoleSelector(s => s.recon?.drones);
  const selected = useFireye((s) => s.selected);
  const booted = useFireye((s) => s.booted);
  const thermal = useFireye((s) => s.thermal);
  const vis = useFireye((s) => s.vis);
  const panel = useFireye((s) => s.panel);
  const phase = useFireye((s) => s.dive.phase);
  const nativeFrustum = useRef<{ engine: StageEngine; fov: number } | null>(null);
  useLayoutEffect(() => {
    if (!engine || phase !== 'idle') return;
    const { camera, scene } = engine.viewer, frustum = camera.frustum as PerspectiveFrustum;
    const fov = frustum.fov;
    if (fov === undefined) return;
    const original = nativeFrustum.current?.engine === engine ? nativeFrustum.current : { engine, fov };
    nativeFrustum.current = original;
    const baseFov = original.fov;
    const frame = () => {
      const framing = mapFraming(scene.canvas.clientWidth, scene.canvas.clientHeight, insets, baseFov, frustum.near);
      if (framing) { Object.assign(frustum, framing); scene.requestRender(); }
    };
    const observer = new ResizeObserver(frame);
    observer.observe(scene.canvas); frame();
    return () => observer.disconnect();
  }, [engine, insets, phase]);
  const overlay = useRef<FireyeOverlay | null>(null);
  const pass = useRef<ThermalPass | null>(null);
  useEffect(() => { fireyeUi.set({ reconProfile: recon }); setMapLayers(mapPatch(vis, recon)); }, [vis, recon]);

  useEffect(() => {
    if (!engine || !pack) return;
    dive.attach(engine);
    const o = new FireyeOverlay(engine.viewer, pack, sensorModel(pack));
    const p = new ThermalPass(engine.viewer.scene);
    overlay.current = o; pass.current = p;
    if (import.meta.env.DEV) (window as unknown as { __fireyeStage?: unknown }).__fireyeStage = { engine, overlay: o, thermal: p };
    const w = stageWorld.get();
    o.setTime(w.t); o.setCams(w.feeds);
    const off = stageWorld.subscribe((changed) => {
      const s = stageWorld.get();
      if (changed.has('t')) o.setTime(s.t);
      if (changed.has('feeds')) o.setCams(s.feeds);
    });
    const ui = fireyeUi.get();
    o.setVisible({ iot: ui.vis.iot, cams: ui.vis.groundCams, risk: ui.vis.risk, labels: ui.vis.labels, footprints: ui.vis.footprints });
    p.set(ui.thermal);
    return () => { off(); o.destroy(); p.destroy(); overlay.current = null; pass.current = null; dive.attach(null); };
  }, [engine, pack]);

  useEffect(() => { pass.current?.set(thermal); }, [thermal, engine]);
  useEffect(() => { overlay.current?.setVisible({ iot: vis.iot, cams: vis.groundCams, risk: vis.risk, labels: vis.labels, footprints: vis.footprints }); }, [vis, engine]);
  useEffect(() => { overlay.current?.setSelected(selected?.startsWith('iot-') ? selected : null); }, [selected, engine]);
  useEffect(() => { overlay.current?.setStations(stations ?? [], drones ?? []); }, [stations, drones, engine]);

  // The globe-wide Normal/Thermal switch also sets every drone sensor; per-drone choices can differ afterwards.
  const firstThermal = useRef(true);
  useEffect(() => {
    if (firstThermal.current) { firstThermal.current = false; return; }
    const uavs = stageWorld.get().feeds.filter(isUav);
    fireyeUi.set((s) => ({ fx: { ...s.fx, ...Object.fromEntries(uavs.map((f) => [f.id, thermal ? 'thermal' as const : 'eo' as const])) } }));
  }, [thermal]);

  const onSelect = useCallback((id: string | null, kind: StageSelectKind | null) => {
    if (!id) { fireyeUi.set({ selected: null }); return; }
    if (kind === 'unit') {
      const feed = stageWorld.get().feeds.find((f) => f.unitId === id && isUav(f));
      if (feed) { void dive.enter(feed.id); return; }
    }
    if (kind === 'place' && id.startsWith('cam-')) { void dive.enter(id.slice(4)); return; }
    if (kind === 'place' && id.startsWith('iot-')) {
      const s = pack && sensorModel(pack).specs.find((x) => x.id === id);
      if (s) onFocus(s.pos, 1800);
    }
    fireyeUi.set({ selected: id });
  }, [pack, onFocus]);

  const orbitTarget = useCallback(() => {
    const id = fireyeUi.get().selected;
    if (!id || !engine) return null;
    if (id.startsWith('iot-') && pack) return sensorModel(pack).specs.find((x) => x.id === id)?.pos ?? null;
    return engine.geoOf(id) ?? null;
  }, [engine, pack]);

  const inFeed = phase !== 'idle';
  return (
    <div className="fireye-map-stage relative h-full w-full overflow-hidden" style={{
      '--fireye-map-left': `${insets.left}px`, '--fireye-map-right': `${insets.right}px`, '--fireye-map-bottom': `${insets.bottom}px`,
    } as CSSProperties}>
      <StageView mapControls={false} hud={booted} selectedId={selected?.startsWith('iot-') ? null : selected} onSelect={onSelect} onEngineReady={setEngine} />
      {engine && (
        <div style={insets} className={cn('fireye-boot-hud pointer-events-none absolute z-[2] transition-opacity duration-base ease-servo', inFeed && 'opacity-0')} aria-hidden={inFeed}>
          {thermal && (
            <span className="fireye-fade absolute bottom-[5.75rem] left-3 border border-amber/50 bg-ink-950/85 px-2 py-1 font-mono text-micro uppercase tracking-[0.16em] text-amber">
              Simulated thermal · not radiometric
            </span>
          )}
          <OrchestratorCallout onFocus={(g) => onFocus(g, 2400)} />
          {selected?.startsWith('iot-') && <div className="absolute bottom-[7.5rem] left-3"><SensorCard id={selected} /></div>}
          <div className="absolute bottom-0 right-3 top-4 flex flex-row-reverse items-start gap-2 pb-16">
            <div className={cn('pointer-events-auto', inFeed && 'pointer-events-none')}><CameraControls engine={engine} orbitTarget={orbitTarget} /></div>
            {panel === 'legend' && <LegendPanel />}
            {panel === 'layers' && <VisibilityPanel />}
          </div>
          <div className="absolute bottom-12 left-3"><OrchestratorChat /></div>
        </div>
      )}
      <DiveLayer engine={engine} contentInsets={insets} />
    </div>
  );
}
