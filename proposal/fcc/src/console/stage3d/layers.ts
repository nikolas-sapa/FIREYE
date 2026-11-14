import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type {
  Action, ConsoleState, Finding, Geo, GradedItem, Projection, ScenarioPack, Unit, Zone,
} from '../contracts';
import { FINDING_ICON, GLYPH_SCALE, UNIT_ICON, glyph, headingChevron, placeTick } from './glyphs';
import { pal } from './palette';
import { RasterSampler, centroid, circle, destination } from './raster';
import { unitHeading, unitPos } from './world';

const FONT = '500 10px "JetBrains Mono Variable", ui-monospace, monospace';
const FONT_SM = '500 9px "JetBrains Mono Variable", ui-monospace, monospace';
const NEAR_FAR_LABEL = new Cesium.NearFarScalar(2000, 1.0, 90000, 0.75);

const AIR: Unit['kind'][] = ['drone', 'helo', 'tanker'];

export function unitColor(u: Unit): string {
  switch (u.kind) {
    case 'drone': case 'helo': case 'tanker': return ds.ice;
    case 'ems': return ds.phosphor;
    case 'law': return ds.bone.dim;
    default: return ds.bone.DEFAULT;
  }
}

export function findingColor(f: Finding, zone?: Zone): string {
  switch (f.kind) {
    case 'human': case 'animal': return zone === 'Z0_INTERRUPT' || zone === 'Z1_STAGE' ? ds.ember : ds.violet;
    case 'combustible': case 'spot': return ds.ember;
    case 'fuel': case 'road-block': return ds.amber;
    case 'water': return ds.ice;
    case 'smoke': return ds.bone.dim;
    default: return ds.bone.DEFAULT;
  }
}

const ccache = new Map<string, Cesium.Color>();
const col = (hex: string, a = 1) => {
  const k = `${hex}|${a.toFixed(3)}`;
  let c = ccache.get(k);
  if (!c) { c = Cesium.Color.fromCssColorString(hex).withAlpha(a); ccache.set(k, c); }
  return c;
};

function labelOpts(text: string, o: Partial<Cesium.LabelGraphics.ConstructorOptions> = {}): Cesium.LabelGraphics.ConstructorOptions {
  return {
    text: text.toUpperCase(),
    font: FONT,
    fillColor: pal.bone,
    showBackground: true,
    backgroundColor: pal.ink950.withAlpha(0.82),
    backgroundPadding: new Cesium.Cartesian2(5, 3),
    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    pixelOffset: new Cesium.Cartesian2(18, 0),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scaleByDistance: NEAR_FAR_LABEL,
    ...o,
  };
}

const q = (v: number, steps = 8) => Math.round(v * steps) / steps;

interface FindingRec { sig: string; alphaStep: number; labelOn: boolean; entities: Cesium.Entity[]; dot: Cesium.Entity; ring?: Cesium.Entity; fill?: Cesium.Entity }
interface UnitRec { sig: string; entities: Cesium.Entity[]; main: Cesium.Entity; trail: Cesium.Entity; unit: Unit }
interface SimpleRec { sig: string; entities: Cesium.Entity[] }

export interface LayerOptions {
  exaggeration: number;
  /** Draw labels for places. */
  places?: boolean;
}

/**
 * Entity-based overlays for the main stage: places, observed perimeter, projection bands, findings,
 * units (+ drone sensor frusta), coverage cells and action routes. Each sync is diffed by a signature
 * so 5 Hz store updates only touch what changed.
 */
export class StageLayers {
  readonly ds = {
    base: new Cesium.CustomDataSource('fcc-base'),
    projection: new Cesium.CustomDataSource('fcc-projection'),
    coverage: new Cesium.CustomDataSource('fcc-coverage'),
    actions: new Cesium.CustomDataSource('fcc-actions'),
    findings: new Cesium.CustomDataSource('fcc-findings'),
    units: new Cesium.CustomDataSource('fcc-units'),
  };
  private findings = new Map<string, FindingRec>();
  private units = new Map<string, UnitRec>();
  private coverage = new Map<string, SimpleRec>();
  private actions = new Map<string, SimpleRec>();
  private projSig = '';
  private perimSig = '';
  private perimEntities: Cesium.Entity[] = [];
  private findingById = new Map<string, Finding>();
  private placeById = new Map<string, Geo>();
  private actionTargets = new Map<string, Geo>();
  private itemPos = new Map<string, Geo>();
  selectedId: string | null = null;

  constructor(private viewer: Cesium.Viewer, private s: RasterSampler, private opts: LayerOptions) {
    for (const d of Object.values(this.ds)) viewer.dataSources.add(d);
  }

  /** Absolute height (m) of terrain + offset, honouring vertical exaggeration. */
  h(lon: number, lat: number, offset = 0) {
    return this.s.elevation(lon, lat) * this.opts.exaggeration + offset;
  }
  cart(g: Geo, offset = 0, result?: Cesium.Cartesian3) {
    return Cesium.Cartesian3.fromDegrees(g.lon, g.lat, this.h(g.lon, g.lat, offset), undefined, result);
  }
  private ring(c: Geo, r: number, n = 56): Cesium.Cartesian3[] {
    return circle(c, r, n).map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  }
  private line(pts: Geo[]): Cesium.Cartesian3[] {
    return pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  }

  /* -------------------------------------------------------------- places */

  syncPlaces(pack: ScenarioPack) {
    const e = this.ds.base.entities;
    for (const p of pack.manifest.places) {
      this.placeById.set(p.id, p.pos);
      const major = p.kind === 'town';
      e.add({
        id: `p:${p.id}`,
        position: this.cart(p.pos, 2),
        billboard: { image: placeTick(), scale: GLYPH_SCALE, color: major ? pal.bone : pal.boneDim, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: labelOpts(p.name, {
          font: major ? FONT : FONT_SM,
          fillColor: major ? pal.bone : pal.boneDim,
          showBackground: false,
          pixelOffset: new Cesium.Cartesian2(10, 0),
          outlineColor: pal.void.withAlpha(0.9),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, major ? 160000 : 45000),
        }),
      });
    }
  }

  /* -------------------------------------------------------------- observed perimeter */

  syncPerimeter(pack: ScenarioPack, t: number) {
    let p: ScenarioPack['perimeters'][number] | undefined;
    for (const x of pack.perimeters) if (x.t <= t && (!p || x.t > p.t)) p = x;
    const sig = p ? String(p.t) : '';
    if (sig === this.perimSig) return;
    this.perimSig = sig;
    for (const en of this.perimEntities) this.ds.base.entities.remove(en);
    this.perimEntities = [];
    if (!p) return;
    let top: Geo | null = null;
    p.polygon.forEach((ring, i) => {
      if (ring.length < 3) return;
      for (const g of ring) if (!top || g.lat > top.lat) top = g;
      this.perimEntities.push(
        this.ds.base.entities.add({
          id: `perim:${i}`,
          polyline: {
            positions: this.line([...ring, ring[0]]),
            clampToGround: true,
            width: 2,
            material: new Cesium.PolylineDashMaterialProperty({ color: pal.bone.withAlpha(0.55), dashLength: 10, gapColor: Cesium.Color.TRANSPARENT }),
          },
        }),
      );
    });
    if (top) {
      const d = new Date(p.t);
      const stamp = `${d.toISOString().slice(5, 10).replace('-', '/')} ${d.toISOString().slice(11, 16)}Z`;
      this.perimEntities.push(
        this.ds.base.entities.add({
          id: 'perim:label',
          position: this.cart(top, 10),
          label: labelOpts(`IR perimeter ${stamp} · ${Math.round(p.acres).toLocaleString('en-US')} ac`, {
            font: FONT_SM, fillColor: pal.boneDim, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, pixelOffset: new Cesium.Cartesian2(0, -6),
          }),
        }),
      );
    }
  }

  /* -------------------------------------------------------------- projection */

  syncProjection(proj: Projection | null) {
    const sig = proj ? `${proj.rev}|${proj.issuedAt}|${proj.bands.length}|${proj.previous?.length ?? 0}` : '';
    if (sig === this.projSig) return;
    this.projSig = sig;
    const e = this.ds.projection.entities;
    e.removeAll();
    if (!proj) return;
    const style: Record<number, { fill: number; line: number; w: number; dash: number }> = {
      60: { fill: 0.075, line: 0.95, w: 2, dash: 14 },
      180: { fill: 0.045, line: 0.7, w: 1.5, dash: 10 },
      360: { fill: 0.025, line: 0.5, w: 1.25, dash: 8 },
    };
    const head = proj.headDirDeg;
    for (const b of proj.previous ?? []) {
      if (b.polygon.length < 3) continue;
      e.add({
        polyline: {
          positions: this.line([...b.polygon, b.polygon[0]]),
          clampToGround: true,
          width: 1,
          material: new Cesium.PolylineDashMaterialProperty({ color: pal.boneMute.withAlpha(0.6), dashLength: 6, gapColor: Cesium.Color.TRANSPARENT }),
        },
      });
    }
    const bands = [...proj.bands].sort((a, b) => b.horizonMin - a.horizonMin);
    for (const b of bands) {
      if (b.polygon.length < 3) continue;
      const st = style[b.horizonMin] ?? style[360];
      e.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(this.line(b.polygon)),
          material: pal.amber.withAlpha(st.fill),
          classificationType: Cesium.ClassificationType.BOTH,
        },
      });
      e.add({
        polyline: {
          positions: this.line([...b.polygon, b.polygon[0]]),
          clampToGround: true,
          width: st.w,
          material: new Cesium.PolylineDashMaterialProperty({ color: pal.amber.withAlpha(st.line), dashLength: st.dash, gapColor: Cesium.Color.TRANSPARENT }),
        },
      });
      // Label at the band's leading point along the head direction.
      const c = centroid(b.polygon);
      const hr = (head * Math.PI) / 180;
      let best = b.polygon[0], bestD = -Infinity;
      for (const p of b.polygon) {
        const d = (p.lon - c.lon) * Math.sin(hr) * Math.cos((c.lat * Math.PI) / 180) + (p.lat - c.lat) * Math.cos(hr);
        if (d > bestD) { bestD = d; best = p; }
      }
      e.add({
        position: this.cart(best, 20),
        label: labelOpts(`+${b.horizonMin / 60}H · ${Math.round(b.confidence * 100)}%`, {
          font: FONT_SM,
          fillColor: pal.amber,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -4),
        }),
      });
    }
  }

  /* -------------------------------------------------------------- findings */

  syncFindings(findings: Finding[], items: GradedItem[]) {
    const zones = new Map<string, Zone>();
    this.itemPos.clear();
    for (const it of items) {
      zones.set(it.id, it.zone);
      zones.set(it.refId, it.zone);
      for (const m of it.bundleOf ?? []) if (!zones.has(m)) zones.set(m, it.zone);
      if (it.pos) this.itemPos.set(it.id, it.pos);
    }
    const e = this.ds.findings.entities;
    const seen = new Set<string>();
    this.findingById.clear();
    for (const f of findings) {
      seen.add(f.id);
      this.findingById.set(f.id, f);
      const zone = zones.get(f.id);
      const color = findingColor(f, zone);
      const selected = this.selectedId === f.id;
      const labelOn = selected || zone === 'Z0_INTERRUPT' || zone === 'Z1_STAGE' || zone === 'Z2_DECISION' || zone === 'Z3_FOCUS';
      const sig = `${f.pos.lon.toFixed(5)}|${f.pos.lat.toFixed(5)}|${Math.round(f.uncertaintyM)}|${f.kind}|${f.live ? 1 : 0}|${color}|${selected ? 1 : 0}|${f.label}`;
      const alpha = f.live ? 1 : Math.max(0.18, q(f.freshness));
      const rec = this.findings.get(f.id);
      if (rec && rec.sig === sig) {
        if (rec.alphaStep !== alpha) {
          rec.alphaStep = alpha;
          rec.dot.billboard!.color = new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(alpha));
          if (rec.fill) rec.fill.ellipse!.material = new Cesium.ColorMaterialProperty(col(color, 0.07 * alpha));
        }
        if (rec.labelOn !== labelOn) {
          rec.labelOn = labelOn;
          rec.dot.label!.show = new Cesium.ConstantProperty(labelOn);
        }
        continue;
      }
      if (rec) for (const en of rec.entities) e.remove(en);
      const ents: Cesium.Entity[] = [];
      const dot = e.add({
        id: `f:${f.id}`,
        position: this.cart(f.pos, 3),
        billboard: {
          image: glyph({ icon: FINDING_ICON[f.kind], color, style: f.live ? 'solid' : 'bare', selected }),
          scale: GLYPH_SCALE,
          color: Cesium.Color.WHITE.withAlpha(alpha),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: labelOpts(f.count && f.count > 1 && !/^\d/.test(f.label) ? `${f.count} · ${f.label}` : f.label, {
          show: labelOn,
          fillColor: Cesium.Color.fromCssColorString(color === ds.bone.DEFAULT ? ds.bone.DEFAULT : color),
          pixelOffset: new Cesium.Cartesian2(20, 0),
        }),
      });
      ents.push(dot);
      let ring: Cesium.Entity | undefined, fill: Cesium.Entity | undefined;
      if (!f.live && f.uncertaintyM > 30) {
        ring = e.add({
          id: `f:${f.id}:ring`,
          polyline: {
            positions: this.ring(f.pos, f.uncertaintyM),
            clampToGround: true,
            width: 1.5,
            material: new Cesium.PolylineDashMaterialProperty({ color: col(color, 0.85), dashLength: 9, gapColor: Cesium.Color.TRANSPARENT }),
          },
        });
        fill = e.add({
          id: `f:${f.id}:fill`,
          position: Cesium.Cartesian3.fromDegrees(f.pos.lon, f.pos.lat),
          ellipse: {
            semiMajorAxis: f.uncertaintyM,
            semiMinorAxis: f.uncertaintyM,
            material: col(color, 0.07 * alpha),
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
        ents.push(ring, fill);
      }
      this.findings.set(f.id, { sig, alphaStep: alpha, labelOn, entities: ents, dot, ring, fill });
    }
    for (const [id, rec] of this.findings) {
      if (seen.has(id)) continue;
      for (const en of rec.entities) e.remove(en);
      this.findings.delete(id);
    }
  }

  /* -------------------------------------------------------------- units */

  syncUnits(units: Unit[], camera: Cesium.Camera) {
    const e = this.ds.units.entities;
    const seen = new Set<string>();
    for (const u of units) {
      seen.add(u.id);
      const air = AIR.includes(u.kind);
      const selected = this.selectedId === u.id;
      const color = unitColor(u);
      const sig = `${u.kind}|${selected ? 1 : 0}|${u.callsign}|${u.status}`;
      let rec = this.units.get(u.id);
      if (rec) {
        rec.unit = u;
        rec.trail.polyline!.positions = new Cesium.ConstantProperty(this.trailPositions(u, air));
        if (rec.sig === sig) continue;
        for (const en of rec.entities) e.remove(en);
      } else {
        rec = { sig: '', entities: [], unit: u, main: null as unknown as Cesium.Entity, trail: null as unknown as Cesium.Entity };
        this.units.set(u.id, rec);
      }
      const holder = rec;
      const g: Geo = { lon: 0, lat: 0, alt: 0 };
      const posProp = new Cesium.CallbackPositionProperty((_t, result) => {
        const p = unitPos(holder.unit, performance.now(), g);
        const off = air ? Math.max(40, p.alt ?? 120) : 3;
        return this.cart(p, off, result);
      }, false);
      const ents: Cesium.Entity[] = [];
      const main = e.add({
        id: `u:${u.id}`,
        position: posProp,
        billboard: {
          image: glyph({ icon: UNIT_ICON[u.kind], color, style: air ? 'bracket' : 'chip', selected }),
          scale: GLYPH_SCALE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          color: u.status === 'standby' ? Cesium.Color.WHITE.withAlpha(0.6) : Cesium.Color.WHITE,
        },
        label: labelOpts(u.callsign, {
          font: FONT_SM,
          fillColor: Cesium.Color.fromCssColorString(color),
          pixelOffset: new Cesium.Cartesian2(19, 0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 70000),
        }),
      });
      ents.push(main);
      ents.push(
        e.add({
          id: `u:${u.id}:hdg`,
          position: posProp,
          billboard: {
            image: headingChevron(),
            scale: GLYPH_SCALE,
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
            rotation: new Cesium.CallbackProperty(() => camera.heading - (unitHeading(holder.unit) * Math.PI) / 180, false),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: u.speedMps > 0.3 || air,
          },
        }),
      );
      const trail = e.add({
        id: `u:${u.id}:trail`,
        polyline: {
          positions: this.trailPositions(u, air),
          width: 1.25,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString(color).withAlpha(0.45), dashLength: 6, gapColor: Cesium.Color.TRANSPARENT }),
        },
      });
      ents.push(trail);
      if (air) {
        const gg: Geo = { lon: 0, lat: 0 };
        ents.push(
          e.add({
            id: `u:${u.id}:stem`,
            polyline: {
              positions: new Cesium.CallbackProperty(() => {
                const p = unitPos(holder.unit, performance.now(), gg);
                const off = Math.max(40, p.alt ?? 120);
                return [this.cart(p, 0), this.cart(p, off)];
              }, false),
              width: 1,
              material: Cesium.Color.fromCssColorString(color).withAlpha(0.45),
            },
          }),
        );
      }
      if (u.kind === 'drone') {
        const gp: Geo = { lon: 0, lat: 0 };
        ents.push(
          e.add({
            id: `u:${u.id}:fov`,
            polyline: {
              positions: new Cesium.CallbackProperty(() => this.frustum(holder.unit, gp), false),
              width: 1,
              material: pal.ice.withAlpha(0.32),
            },
          }),
        );
      }
      holder.sig = sig;
      holder.entities = ents;
      holder.main = main;
      holder.trail = trail;
    }
    for (const [id, rec] of this.units) {
      if (seen.has(id)) continue;
      for (const en of rec.entities) e.remove(en);
      this.units.delete(id);
    }
  }

  private trailPositions(u: Unit, air: boolean): Cesium.Cartesian3[] {
    const pts = u.trail.slice(-40);
    return pts.map((p) => this.cart(p, air ? Math.max(40, p.alt ?? u.pos.alt ?? 120) : 4));
  }

  /** Drone sensor footprint: four ground corners joined, plus rays to the drone. */
  private frustum(u: Unit, g: Geo): Cesium.Cartesian3[] {
    const p = unitPos(u, performance.now(), g);
    const alt = Math.max(60, p.alt ?? 150);
    const hdg = unitHeading(u);
    const half = alt * Math.tan((32 * Math.PI) / 180);
    const halfH = half * 0.5625;
    const corners = [
      [-half, halfH], [half, halfH], [half, -halfH], [-half, -halfH],
    ].map(([x, y]) => {
      const r = Math.hypot(x, y);
      const b = hdg + (Math.atan2(x, y) * 180) / Math.PI;
      const d = destination(p, b, r);
      return this.cart(d, 2);
    });
    const top = this.cart(p, alt);
    return [corners[0], corners[1], corners[2], corners[3], corners[0], top, corners[1], top, corners[2], top, corners[3]];
  }

  /* -------------------------------------------------------------- coverage */

  syncCoverage(cells: ConsoleState['coverage']) {
    const e = this.ds.coverage.entities;
    const seen = new Set<string>();
    for (const c of cells) {
      seen.add(c.id);
      if (c.polygon.length < 3) continue;
      const sig = `${c.unitId ?? ''}|${q(c.interest, 4)}|${c.polygon.length}|${c.polygon[0].lon.toFixed(5)}|${c.polygon[0].lat.toFixed(5)}`;
      const rec = this.coverage.get(c.id);
      if (rec?.sig === sig) continue;
      if (rec) for (const en of rec.entities) e.remove(en);
      const ents: Cesium.Entity[] = [];
      if (c.unitId) {
        // Ice corner brackets on assigned cells.
        const n = c.polygon.length;
        for (let i = 0; i < n; i++) {
          const a = c.polygon[i], prev = c.polygon[(i - 1 + n) % n], next = c.polygon[(i + 1) % n];
          const k = 0.22;
          const p1 = { lon: a.lon + (prev.lon - a.lon) * k, lat: a.lat + (prev.lat - a.lat) * k };
          const p2 = { lon: a.lon + (next.lon - a.lon) * k, lat: a.lat + (next.lat - a.lat) * k };
          ents.push(e.add({ polyline: { positions: this.line([p1, a, p2]), clampToGround: true, width: 1.75, material: pal.ice.withAlpha(0.8) } }));
        }
        ents.push(e.add({ polyline: { positions: this.line([...c.polygon, c.polygon[0]]), clampToGround: true, width: 1, material: pal.ice.withAlpha(0.14) } }));
      } else {
        ents.push(
          e.add({
            polyline: { positions: this.line([...c.polygon, c.polygon[0]]), clampToGround: true, width: 1, material: pal.bone.withAlpha(0.05 + 0.12 * Math.min(1, c.interest)) },
          }),
        );
      }
      this.coverage.set(c.id, { sig, entities: ents });
    }
    for (const [id, rec] of this.coverage) {
      if (seen.has(id)) continue;
      for (const en of rec.entities) e.remove(en);
      this.coverage.delete(id);
    }
  }

  /* -------------------------------------------------------------- actions */

  syncActions(actions: Action[]) {
    const e = this.ds.actions.entities;
    const seen = new Set<string>();
    this.actionTargets.clear();
    for (const a of actions) {
      const live = a.status === 'proposed' || a.status === 'approved' || a.status === 'executing';
      if (!live) continue;
      const hasGeo = (a.route && a.route.length > 1) || a.safetyZone || a.target;
      if (!hasGeo) continue;
      seen.add(a.id);
      if (a.target) this.actionTargets.set(a.id, a.target);
      else if (a.safetyZone) this.actionTargets.set(a.id, a.safetyZone.center);
      const sig = `${a.status}|${a.route?.length ?? 0}|${a.route?.[a.route.length - 1]?.lon ?? ''}|${a.safetyZone?.radiusM ?? ''}|${a.target?.lon ?? ''}`;
      const rec = this.actions.get(a.id);
      if (rec?.sig === sig) continue;
      if (rec) for (const en of rec.entities) e.remove(en);
      const ents: Cesium.Entity[] = [];
      const proposed = a.status === 'proposed';
      const routeColor = a.kind === 'move-group' || a.kind === 'rescue' || a.kind === 'evac-notice' ? pal.signal : pal.ice;
      if (a.route && a.route.length > 1) {
        ents.push(
          e.add({
            id: `a:${a.id}:route`,
            polyline: {
              positions: this.line(a.route),
              clampToGround: true,
              width: proposed ? 3 : 2.25,
              material: new Cesium.PolylineDashMaterialProperty({ color: routeColor.withAlpha(proposed ? 0.95 : 0.7), dashLength: 14, gapColor: Cesium.Color.TRANSPARENT }),
            },
          }),
        );
      }
      if (a.safetyZone) {
        const z = a.safetyZone;
        ents.push(
          e.add({
            id: `a:${a.id}:sz`,
            polyline: {
              positions: this.ring(z.center, z.radiusM),
              clampToGround: true,
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({ color: pal.phosphor.withAlpha(0.9), dashLength: 10, gapColor: Cesium.Color.TRANSPARENT }),
            },
          }),
          e.add({
            id: `a:${a.id}:szl`,
            position: this.cart(z.center, 10),
            label: labelOpts(z.label || 'Safety zone', { font: FONT_SM, fillColor: pal.phosphor, horizontalOrigin: Cesium.HorizontalOrigin.CENTER, pixelOffset: new Cesium.Cartesian2(0, 0) }),
          }),
        );
      }
      this.actions.set(a.id, { sig, entities: ents });
    }
    for (const [id, rec] of this.actions) {
      if (seen.has(id)) continue;
      for (const en of rec.entities) e.remove(en);
      this.actions.delete(id);
    }
  }

  /* -------------------------------------------------------------- lookup */

  /** World position for any stage id (finding, unit, place, action, graded item). */
  resolve(id: string, result?: Cesium.Cartesian3): Cesium.Cartesian3 | undefined {
    const f = this.findingById.get(id);
    if (f) return this.cart(f.pos, 3, result);
    const u = this.units.get(id);
    if (u) {
      const p = unitPos(u.unit);
      const air = AIR.includes(u.unit.kind);
      return this.cart(p, air ? Math.max(40, p.alt ?? 120) : 3, result);
    }
    const pl = this.placeById.get(id) ?? this.actionTargets.get(id) ?? this.itemPos.get(id);
    if (pl) return this.cart(pl, 3, result);
    return undefined;
  }

  geoOf(id: string): Geo | undefined {
    const f = this.findingById.get(id);
    if (f) return f.pos;
    const u = this.units.get(id);
    if (u) return unitPos(u.unit);
    return this.placeById.get(id) ?? this.actionTargets.get(id) ?? this.itemPos.get(id);
  }

  findingRadius(id: string): number {
    return this.findingById.get(id)?.uncertaintyM ?? 0;
  }

  /** Force a rebuild of selection-dependent glyphs. */
  invalidateSelection() {
    for (const r of this.findings.values()) r.sig = '';
    for (const r of this.units.values()) r.sig = '';
  }

  destroy() {
    if (this.viewer.isDestroyed()) return;
    for (const d of Object.values(this.ds)) this.viewer.dataSources.remove(d, true);
  }
}
