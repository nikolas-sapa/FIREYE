import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { DroneStation, Feed, Ms, ReconDrone, ScenarioPack } from '../contracts';
import type { SensorModel } from '../fireye/data/sensors';
import { sectorRisk } from '../fireye/data/risk';
import type { SensorStatus } from '../fireye/data/types';
import { GLYPH_SCALE, glyph, loadIcons } from './glyphs';
import { destination } from './raster';
import { getSampler } from './sampler';

export function sensorColor(status: SensorStatus): string {
  return status === 'alarm' ? ds.ember : status === 'watch' ? ds.amber : status === 'offline' ? ds.ink[400] : ds.bone.dim;
}

export interface OverlayVisibility { iot: boolean; cams: boolean; risk: boolean; labels: boolean; footprints?: boolean }

/**
 * FIREYE additions to the main globe: simulated IoT nodes, fixed ground cameras with view cones and
 * the sector ignition-risk wash. Entity ids use the stage's `p:` prefix so picking reports them
 * as places (`iot-…`, `cam-…`, `risk-…`) without changing the engine.
 */
export class FireyeOverlay {
  readonly ds = new Cesium.CustomDataSource('fireye-overlay');
  private sensors = new Map<string, { e: Cesium.Entity; status: SensorStatus | null }>();
  private risk = new Map<string, { e: Cesium.Entity; value: number }>();
  private cams = new Map<string, Cesium.Entity>();
  private stations = new Map<string, Cesium.Entity>();
  private bucket = NaN;
  private riskBucket = NaN;
  private selected: string | null = null;
  private vis: OverlayVisibility = { iot: true, cams: true, risk: false, labels: true };
  private ready: Promise<void>;
  private destroyed = false;

  constructor(private viewer: Cesium.Viewer, private pack: ScenarioPack, private model: SensorModel) {
    this.ready = loadIcons(['camera', 'battery']).then(() => {
      if (this.destroyed) return;
      void viewer.dataSources.add(this.ds);
      this.build();
    });
  }

  private h(lon: number, lat: number) {
    return getSampler(this.pack).elevation(lon, lat);
  }

  private label(text: string, far: number): Cesium.LabelGraphics.ConstructorOptions {
    return {
      text, font: '500 10px "JetBrains Mono Variable", monospace', fillColor: Cesium.Color.fromCssColorString(ds.bone.dim),
      outlineColor: Cesium.Color.fromCssColorString(ds.ink[950]), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, 15), verticalOrigin: Cesium.VerticalOrigin.TOP, scale: 1,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, far), disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
  }

  private build() {
    for (const s of this.model.specs) {
      const e = this.ds.entities.add({
        id: `p:${s.id}`, name: `${s.code} · simulated IoT node`,
        position: Cesium.Cartesian3.fromDegrees(s.pos.lon, s.pos.lat, this.h(s.pos.lon, s.pos.lat) + 4),
        point: { pixelSize: 5, color: Cesium.Color.fromCssColorString(ds.bone.dim), outlineColor: Cesium.Color.fromCssColorString(ds.ink[950]), outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: this.label(s.code, 9000),
      });
      this.sensors.set(s.id, { e, status: null });
    }
    const sectors = new Map<string, { lon: number; lat: number; n: number }>();
    for (const s of this.model.specs) {
      const c = sectors.get(s.sector) ?? { lon: 0, lat: 0, n: 0 };
      c.lon += s.pos.lon; c.lat += s.pos.lat; c.n++;
      sectors.set(s.sector, c);
    }
    for (const [sector, c] of sectors) {
      const lon = c.lon / c.n, lat = c.lat / c.n;
      const e = this.ds.entities.add({
        id: `p:risk-${sector}`, name: `${sector} · ignition-risk index (simulated)`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: { semiMajorAxis: 1100, semiMinorAxis: 1100, material: Cesium.Color.fromCssColorString(ds.amber).withAlpha(0.12), classificationType: Cesium.ClassificationType.TERRAIN },
        label: { ...this.label(sector.toUpperCase(), 40000), pixelOffset: new Cesium.Cartesian2(0, 0) },
        show: false,
      });
      this.risk.set(sector, { e, value: -1 });
    }
    this.apply();
  }

  setCams(feeds: Feed[]) {
    void this.ready.then(() => {
      if (this.destroyed) return;
      const want = feeds.filter((f) => f.kind === 'ridge-cam' && f.pose.pos);
      for (const f of want) {
        if (this.cams.has(f.id)) continue;
        const p = f.pose.pos!;
        const z = this.h(p.lon, p.lat);
        const hdg = f.pose.headingDeg ?? 0, half = (f.pose.fovDeg ?? 50) / 2;
        const a = destination(p, hdg - half, 900), b = destination(p, hdg + half, 900);
        const cone = [a, p, b].map((g) => Cesium.Cartesian3.fromDegrees(g.lon, g.lat, this.h(g.lon, g.lat) + 6));
        const e = this.ds.entities.add({
          id: `p:cam-${f.id}`, name: `${f.label} · fixed camera`,
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, z + 18),
          billboard: { image: glyph({ icon: 'camera', color: ds.ice, style: 'bracket', size: 20 }), scale: GLYPH_SCALE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: this.label(f.label.toUpperCase(), 16000),
          polyline: { positions: cone, width: 1, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString(ds.ice).withAlpha(0.7), dashLength: 10 }) },
        });
        this.cams.set(f.id, e);
      }
      this.apply();
    });
  }

  setStations(stations: DroneStation[], drones: ReconDrone[] = []) {
    void this.ready.then(() => {
      if (this.destroyed) return;
      for (const s of stations) {
        let e = this.stations.get(s.id);
        if (!e) {
          e = this.ds.entities.add({
            id: `p:${s.id}`, name: `${s.name} · simulated drone station`,
            position: Cesium.Cartesian3.fromDegrees(s.pos.lon, s.pos.lat, this.h(s.pos.lon, s.pos.lat) + 8),
            billboard: { image: glyph({ icon: 'battery', color: ds.ice, style: 'bracket', size: 30 }), scale: GLYPH_SCALE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: { ...this.label('', 80000), pixelOffset: new Cesium.Cartesian2(0, 23) },
          });
          this.stations.set(s.id, e);
        }
        const onPad = drones.filter(d => d.stationId === s.id && (d.phase === 'docked' || d.phase === 'charging')).length;
        e.label!.text = new Cesium.ConstantProperty(`${s.id.includes('north') ? 'NORTH' : 'SOUTH'} STATION · ${onPad}/3 ON PAD`);
      }
      this.apply();
    });
  }

  setTime(t: Ms) {
    const k = Math.floor(t / 30000);
    if (k === this.bucket || !this.sensors.size) return;
    this.bucket = k;
    const readings = this.model.all(t);
    for (const r of readings) {
      const s = this.sensors.get(r.id);
      if (!s || s.status === r.status) continue;
      s.status = r.status;
      this.paintSensor(r.id);
    }
    const rk = Math.floor(t / 300000);
    if (rk !== this.riskBucket) {
      this.riskBucket = rk;
      for (const sr of sectorRisk(this.model, t)) {
        const r = this.risk.get(sr.sector);
        if (!r || Math.round(sr.value) === r.value) continue;
        r.value = Math.round(sr.value);
        const v = Math.max(0, Math.min(1, (sr.value - 40) / 55));
        const col = sr.value >= 72 ? ds.ember : ds.amber;
        r.e.ellipse!.material = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(col).withAlpha(0.06 + v * 0.26));
        r.e.label!.text = new Cesium.ConstantProperty(`${sr.sector.toUpperCase()} · RISK ${r.value}`);
      }
    }
    this.viewer.scene.requestRender();
  }

  private paintSensor(id: string) {
    const s = this.sensors.get(id);
    if (!s) return;
    const sel = this.selected === id;
    s.e.point!.color = new Cesium.ConstantProperty(Cesium.Color.fromCssColorString(sensorColor(s.status ?? 'nominal')));
    s.e.point!.pixelSize = new Cesium.ConstantProperty(sel ? 9 : s.status === 'alarm' ? 7 : 5);
    if (s.e.label) s.e.label.show = new Cesium.ConstantProperty(sel);
  }

  setSelected(id: string | null) {
    const prev = this.selected;
    this.selected = id;
    if (prev) this.paintSensor(prev);
    if (id) this.paintSensor(id);
    this.viewer.scene.requestRender();
  }

  setVisible(v: Partial<OverlayVisibility>) {
    this.vis = { ...this.vis, ...v };
    this.apply();
  }

  private apply() {
    for (const s of this.sensors.values()) {
      s.e.show = this.vis.iot;
      if (s.e.label) s.e.label.show = new Cesium.ConstantProperty(s.e.id === `p:${this.selected}`);
    }
    for (const e of this.cams.values()) {
      e.show = this.vis.cams;
      if (e.label) e.label.show = new Cesium.ConstantProperty(this.vis.labels);
      if (e.polyline) e.polyline.show = new Cesium.ConstantProperty(this.vis.footprints ?? false);
    }
    for (const r of this.risk.values()) r.e.show = this.vis.risk;
    for (const e of this.stations.values()) if (e.label) e.label.show = new Cesium.ConstantProperty(this.vis.labels);
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  /** Repaint glyph colours after a theme or appearance change. */
  repaint() {
    for (const id of this.sensors.keys()) this.paintSensor(id);
  }

  destroy() {
    this.destroyed = true;
    if (!this.viewer.isDestroyed()) this.viewer.dataSources.remove(this.ds, true);
  }
}
