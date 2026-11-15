import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { claimSolarDaylight, color, getTheme, onThemeChange, type SolarClaim } from '@ds';
import type { BBox, Geo, ScenarioPack } from '../contracts';
import { StageView } from '../stage3d/StageView';
import type { StageEngine } from '../stage3d/StageEngine';
import { stageWorld } from '../stage3d/world';
import { daylight, sunPosition } from '../stage3d/sun';
import type { Camera, Detection, GeometryCollection, ViewId } from './model';
import { VIEWS } from './model';

export interface Focus { pos: Geo; rangeM?: number; key: number }
interface Props {
  pack: ScenarioPack; view: ViewId; time: number; detections: Detection[]; cameras: Camera[];
  geometry?: GeometryCollection; imagery?: string; danger?: string;
  imageryBounds?: BBox;
  imageryLabel?: string;
  focus: Focus | null; onPick: (id: string) => void; showCameras: boolean;
  onStatus: (message: string) => void;
  active: boolean;
}
export function MonitoringGlobe({ pack, view, time, detections, cameras, geometry, imagery, imageryBounds, imageryLabel, danger, focus, onPick, showCameras, onStatus, active }: Props) {
  const [engine, setEngine] = useState<StageEngine | null>(null);
  const [theme, setTheme] = useState(getTheme());
  const ready = useCallback((e: StageEngine | null) => setEngine(e), []);
  const solar = useRef<SolarClaim | null>(null);
  // Claim and release in the same (layout) phase so a keyed remount cannot clear the new view's value.
  useLayoutEffect(() => {
    const claim = claimSolarDaylight();
    solar.current = claim;
    return () => { claim.release(); if (solar.current === claim) solar.current = null; };
  }, []);
  useEffect(() => onThemeChange(() => setTheme(getTheme())), []);
  useEffect(() => {
    if (!engine) return;
    const scene = engine.viewer.scene;
    // Monitoring has no continuously animated incident. Do not redraw an unchanged globe at 60 Hz.
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Infinity;
    const off = stageWorld.subscribe(() => scene.requestRender());
    scene.requestRender();
    return off;
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const update = () => {
      engine.setActive(active && !document.hidden);
      if (active && !document.hidden) engine.viewer.scene.requestRender();
    };
    update(); document.addEventListener('visibilitychange', update);
    return () => { document.removeEventListener('visibilitychange', update); engine.setActive(true); };
  }, [engine, active]);
  useLayoutEffect(() => {
    stageWorld.set({ dataMode: 'monitoring', pack, t: time, paused: true, speed: 0, units: [], feeds: [],
      findings: [], projection: null, items: [], actions: [], coverage: [], directives: [], fireRev: 0,
      stage: { mode: 'globe', dimmed: false, highlight: [] } });
    solar.current?.set(daylight(sunPosition(time, VIEWS[view].center.lat, VIEWS[view].center.lon).elDeg));
  }, [pack, view]);
  useLayoutEffect(() => {
    stageWorld.set({ t: time });
    solar.current?.set(daylight(sunPosition(time, VIEWS[view].center.lat, VIEWS[view].center.lon).elDeg));
  }, [time, view]);

  useEffect(() => {
    if (!engine || !focus) return;
    engine.flyTo(focus.pos, { rangeM: focus.rangeM ?? 6500, pitchDeg: -48 });
  }, [engine, focus]);
  useEffect(() => {
    if (!engine) return;
    engine.viewer.scene.screenSpaceCameraController.maximumZoomDistance = 2000000;
    engine.flyTo(VIEWS[view].center, { rangeM: view === 'mati' ? 18000 : 48000, pitchDeg: -55, duration: 0 });
  }, [engine, view]);

  useEffect(() => {
    if (!engine) return;
    const source = new Cesium.CustomDataSource('monitoring-observations');
    const obsColor = Cesium.Color.fromCssColorString(color.ember);
    const camColor = Cesium.Color.fromCssColorString(color.ice);
    for (const d of detections) {
      source.entities.add({ id: `f:real-${d.id}`, name: `${d.satellite} thermal anomaly · ${d.observedAt}`,
        position: Cesium.Cartesian3.fromDegrees(d.lon, d.lat),
        point: { pixelSize: 8, color: obsColor, outlineColor: Cesium.Color.fromCssColorString(color.ink[950]), outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
    if (showCameras) for (const c of cameras) {
      if (!c.pos) continue;
      source.entities.add({ id: `p:camera-${c.id}`, name: c.name, position: Cesium.Cartesian3.fromDegrees(c.pos.lon, c.pos.lat),
        point: { pixelSize: 7, color: camColor, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    }
    void engine.viewer.dataSources.add(source).then(() => { if (!engine.viewer.isDestroyed()) engine.viewer.scene.requestRender(); });
    return () => { if (!engine.viewer.isDestroyed()) { engine.viewer.dataSources.remove(source, true); engine.viewer.scene.requestRender(); } };
  }, [engine, detections, cameras, showCameras, theme]);
  useEffect(() => {
    if (!engine || !geometry) return;
    let cancelled = false; let layer: Cesium.GeoJsonDataSource | undefined;
    void Cesium.GeoJsonDataSource.load(geometry, { stroke: Cesium.Color.fromCssColorString(color.amber),
      fill: Cesium.Color.fromCssColorString(color.amber).withAlpha(0.23), strokeWidth: 0, clampToGround: true })
      .then(async (source) => {
        if (cancelled || engine.viewer.isDestroyed()) return;
        for (const entity of source.entities.values) if (entity.polygon) entity.polygon.outline = new Cesium.ConstantProperty(false);
        // Polygon outlines are unsupported on terrain; use actual clamped ring polylines.
        for (const feature of geometry.features) {
          const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
          for (const rings of polygons) for (const ring of rings) source.entities.add({
            polyline: { positions: Cesium.Cartesian3.fromDegreesArray(ring.flatMap(p => [p[0], p[1]])),
              width: 1.5, material: Cesium.Color.fromCssColorString(color.amber), clampToGround: true },
          });
        }
        layer = source; await engine.viewer.dataSources.add(source);
        if (!engine.viewer.isDestroyed()) engine.viewer.scene.requestRender();
      }).catch(() => { if (!cancelled) onStatus('Mapped geometry could not be rendered. Original source data remain available in Sources.'); });
    return () => { cancelled = true; if (layer && !engine.viewer.isDestroyed()) engine.viewer.dataSources.remove(layer, true); };
  }, [engine, geometry, theme, onStatus]);
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    // Ground rectangles bypass the Outline globe material, keeping dated imagery in its real colors.
    const source = new Cesium.CustomDataSource('monitoring-raster-surfaces');
    const images: HTMLImageElement[] = [];
    void engine.viewer.dataSources.add(source);
    for (const [url, opacity, name] of [[imagery, 1, imageryLabel ?? 'NASA GIBS · dated imagery'], [danger, 0.55, 'EFFIS / GWIS · forecast danger']] as const) {
      if (!url) continue;
      const image = new Image(); images.push(image);
      image.src = url;
      void image.decode().then(() => {
        if (cancelled || engine.viewer.isDestroyed()) return;
        source.entities.add({ name, rectangle: { coordinates: Cesium.Rectangle.fromDegrees(...(url === imagery && imageryBounds ? imageryBounds : VIEWS[view].bbox)),
          material: new Cesium.ImageMaterialProperty({ image, transparent: true, color: Cesium.Color.WHITE.withAlpha(opacity) }),
          classificationType: Cesium.ClassificationType.TERRAIN, zIndex: url === danger ? 1 : 0 } });
        engine.viewer.scene.requestRender();
      }).catch(() => { if (!cancelled) onStatus(`${name} unavailable for the selected date. No substitute image is displayed.`); });
    }
    return () => { cancelled = true; for (const image of images) image.src = ''; if (!engine.viewer.isDestroyed()) engine.viewer.dataSources.remove(source, true); };
  }, [engine, imagery, imageryBounds, imageryLabel, danger, view, onStatus]);
  return <StageView onEngineReady={ready} onSelect={(id) => { if (id) onPick(id); }} className="h-full w-full" />;
}
