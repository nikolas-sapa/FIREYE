import * as Cesium from 'cesium';
import { cssToken, getDaylightBlend, getTheme } from '@ds';
import { FuelClass, type ScenarioPack } from '../contracts';
import { getProfile } from './profile';
import type { RasterSampler } from './raster';
import { createHeightmapTerrain } from './terrain';
import type { MapSettings } from './map-settings';
import { patternLod, terrainMaxLevel, CARTOGRAPHY_SOURCE, CONTEXT_CONTOURS_SOURCE } from './cartography';
import { ContextMap } from './context-map';

/** Cached local/streamed materials and a few static batches, owned by the main viewer only. */
export class OutlineMap {
  readonly terrain: Cesium.TerrainProvider;
  readonly contourM: number;
  private readonly localMaterial: Cesium.Material;
  private readonly contextMaterial: Cesium.Material;
  get material() { return this.context.active ? this.contextMaterial : this.localMaterial; }
  readonly context: ContextMap;
  private readonly roads: Cesium.GroundPolylinePrimitive[] = [];
  private readonly buildings: Cesium.Primitive[] = [];
  private buildingsBuilt = false;
  private readonly origin: Cesium.Cartesian3;
  private readonly worldToLocal: Cesium.Matrix3;
  private readonly rotation = new Cesium.Matrix3();
  private readonly originEye = new Cesium.Cartesian3();
  private readonly eyeToLocal = new Cesium.Matrix3();
  private readonly eastEye = new Cesium.Cartesian3();
  private readonly northEye = new Cesium.Cartesian3();
  private lastPalette = '';
  private readonly background = new Cesium.Color();
  private readonly base = new Cesium.Color();
  private readonly originalBackground: Cesium.Color;
  private readonly originalBase: Cesium.Color;
  private credit = new Cesium.Credit('Local DEM · local building marks approximate');
  metersPerPixel = 0;

  private constructor(private viewer: Cesium.Viewer, private pack: ScenarioPack, private s: RasterSampler) {
    this.context = new ContextMap(viewer, new Set(pack.manifest.places.map((p) => p.name.toUpperCase())),
      pack.manifest.places.filter((p) => p.kind === 'town').map((p) => p.pos));
    this.originalBackground = viewer.scene.backgroundColor.clone();
    this.originalBase = viewer.scene.globe.baseColor.clone();
    const profile = getProfile(pack);
    const b = pack.raster.bbox;
    const lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2;
    this.origin = Cesium.Cartesian3.fromDegrees(lon, lat);
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(this.origin);
    this.worldToLocal = Cesium.Matrix3.transpose(Cesium.Matrix4.getMatrix3(frame, new Cesium.Matrix3()), new Cesium.Matrix3());
    const widthM = Cesium.Cartesian3.distance(Cesium.Cartesian3.fromDegrees(b[0], lat), Cesium.Cartesian3.fromDegrees(b[2], lat));
    const heightM = Cesium.Cartesian3.distance(Cesium.Cartesian3.fromDegrees(lon, b[1]), Cesium.Cartesian3.fromDegrees(lon, b[3]));
    this.terrain = createHeightmapTerrain(s, false, {
      maximumLevel: terrainMaxLevel(pack.raster.cellM, lat), localCoverage: true,
    });
    this.contourM = profile.contourM;
    this.localMaterial = new Cesium.Material({
      fabric: {
        type: 'FCCCartographyV1',
        uniforms: {
          surfaceColor: new Cesium.Color(), detailColor: new Cesium.Color(),
          indexColor: new Cesium.Color(), contextColor: new Cesium.Color(), waterColor: new Cesium.Color(),
          originEC: this.originEye, eastEC: this.eastEye, northEC: this.northEye,
          halfExtent: new Cesium.Cartesian2(widthM / 2, heightM / 2),
          patternSpacing: 200, patternBlend: 0, contourSpacing: this.contourM, contours: 1, streamed: 0,
          lightBlend: 0, relief: Cesium.Material.DefaultImageId,
        },
        source: CARTOGRAPHY_SOURCE,
      },
      translucent: false,
    });
    // Fabric's first instance shares its uniform dictionary with Cesium's type cache.
    // Detach before installing a DOM image, otherwise a second viewer tries to clone a canvas.
    this.localMaterial.uniforms = { ...this.localMaterial.uniforms, relief: this.relief(s) };
    const contextUniforms = { ...this.localMaterial.uniforms };
    delete contextUniforms.relief;
    this.contextMaterial = new Cesium.Material({
      fabric: { type: 'FCCContextContoursV1', uniforms: contextUniforms, source: CONTEXT_CONTOURS_SOURCE },
      translucent: false,
    });
    // Keep separate batches by road class. Each has one appearance, not one entity per feature.
    for (const kind of ['highway', 'road'] as const) {
      const instances = pack.roads.filter((r) => r.kind === kind && r.coords.length > 1)
        .map((r) => this.line(r.coords, kind === 'highway' ? 1.35 : 0.8));
      if (instances.length) this.roads.push(this.batch(instances, kind === 'highway' ? 0.65 : 0.28));
    }
  }

  private ensureBuildings() {
    if (this.buildingsBuilt) return;
    this.buildingsBuilt = true;
    const b = this.pack.raster.bbox;
    const buildings = this.pack.buildings.filter(({ pos }) => pos.lon >= b[0] && pos.lon <= b[2] && pos.lat >= b[1] && pos.lat <= b[3]);
    if (!buildings.length) return;
    const positions = new Float64Array(buildings.length * 12);
    const indices = new Uint32Array(buildings.length * 8);
    const point = new Cesium.Cartesian3();
    buildings.forEach(({ pos }, i) => {
      const dx = 4.5 / (111320 * Math.cos(pos.lat * Math.PI / 180)), dy = 4.5 / 110540;
      const corners = [
        { lon: pos.lon - dx, lat: pos.lat - dy }, { lon: pos.lon + dx, lat: pos.lat - dy },
        { lon: pos.lon + dx, lat: pos.lat + dy }, { lon: pos.lon - dx, lat: pos.lat + dy },
      ];
      corners.forEach((p, k) => {
        // Source-centred stand-ins, not streamed footprints. Sample each corner once.
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, this.s.demElevation(p.lon, p.lat) + 3, undefined, point);
        const o = i * 12 + k * 3;
        positions[o] = point.x; positions[o + 1] = point.y; positions[o + 2] = point.z;
        indices[i * 8 + k * 2] = i * 4 + k;
        indices[i * 8 + k * 2 + 1] = i * 4 + (k + 1) % 4;
      });
    });
    const attributes = new Cesium.GeometryAttributes();
    attributes.position = new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions });
    const primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        id: 'local-buildings',
        geometry: new Cesium.Geometry({
          attributes,
          indices, primitiveType: Cesium.PrimitiveType.LINES, boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(cssToken('bone-dim')).withAlpha(0.4)) },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, renderState: { lineWidth: 1 } }),
      asynchronous: false, allowPicking: false, show: false,
    });
    this.viewer.scene.primitives.add(primitive);
    this.buildings.push(primitive);
  }

  static async create(viewer: Cesium.Viewer, pack: ScenarioPack, s: RasterSampler) {
    return new OutlineMap(viewer, pack, s);
  }

  /** Native-resolution, unstyled hillshade/water field, generated once. No appearance is baked in. */
  private relief(s: RasterSampler) {
    const { w, h, cellM } = this.pack.raster;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    const at = (x: number, y: number) => {
      const value = this.pack.elevation[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      return Number.isFinite(value) && value > -500 && value < 9000 ? value : s.mean;
    };
    // Cesium flips DOM images on upload: leave raster row zero at the image's north/top.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * cellM);
      const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * cellM);
      const shade = Math.max(0, (-dx * 0.45 + dy * 0.35 + 0.82) / Math.hypot(dx, dy, 1));
      const o = (y * w + x) * 4;
      image.data[o] = shade * 255;
      image.data[o + 1] = this.pack.fuel[y * w + x] === FuelClass.Water ? 255 : 0;
      image.data[o + 2] = this.pack.fuel[y * w + x] * 255 / 8;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  private line(points: { lon: number; lat: number }[], width: number) {
    return new Cesium.GeometryInstance({
      geometry: new Cesium.GroundPolylineGeometry({
        positions: points.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)), width,
      }),
    });
  }

  private batch(instances: Cesium.GeometryInstance[], opacity: number) {
    const material = Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(cssToken('bone-dim')).withAlpha(opacity) });
    const primitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineMaterialAppearance({ material }),
      classificationType: Cesium.ClassificationType.TERRAIN, show: false,
      allowPicking: false,
    });
    this.viewer.scene.groundPrimitives.add(primitive);
    return primitive;
  }

  apply(settings: MapSettings, metersPerPixel: number) {
    const on = settings.mode === 'outline';
    const scene = this.viewer.scene;
    this.context.apply(on, settings, getDaylightBlend());
    if (!on) {
      if (scene.globe.material === this.localMaterial || scene.globe.material === this.contextMaterial) {
        scene.globe.material = undefined;
        scene.backgroundColor = this.originalBackground;
        scene.globe.baseColor = this.originalBase;
      }
      for (const p of [...this.roads, ...this.buildings]) p.show = false;
      return;
    }
    scene.globe.material = this.material;
    this.viewer.creditDisplay.addCreditToNextFrame(this.credit);
    const camera = this.viewer.camera;
    Cesium.Matrix4.multiplyByPoint(camera.viewMatrix, this.origin, this.originEye);
    Cesium.Matrix4.getMatrix3(camera.inverseViewMatrix, this.rotation);
    Cesium.Matrix3.multiply(this.worldToLocal, this.rotation, this.eyeToLocal);
    this.metersPerPixel = metersPerPixel;
    const lod = patternLod(metersPerPixel || this.pack.raster.cellM, this.pack.raster.cellM);
    const uniforms = this.material.uniforms;
    uniforms.originEC = this.originEye;
    uniforms.eastEC = Cesium.Matrix3.getRow(this.eyeToLocal, 0, this.eastEye);
    uniforms.northEC = Cesium.Matrix3.getRow(this.eyeToLocal, 1, this.northEye);
    uniforms.patternSpacing = lod.spacing; uniforms.patternBlend = lod.blend;
    uniforms.streamed = this.context.active ? 1 : 0;
    uniforms.contours = settings.layers.contours ? 1 : 0;
    const blend = getDaylightBlend();
    const paletteKey = `${this.context.active}/${getTheme()}/${blend.toFixed(4)}`;
    if (paletteKey !== this.lastPalette) {
      this.lastPalette = paletteKey;
      for (const [key, token] of Object.entries({
        surfaceColor: 'ink-950', detailColor: 'ink-400', indexColor: 'bone-dim', contextColor: 'ink-950', waterColor: 'ink-900',
      })) Cesium.Color.fromCssColorString(cssToken(token), uniforms[key]);
      uniforms.lightBlend = blend;
      const ink = cssToken('bone-dim');
      for (const p of this.roads) {
        const c = (p.appearance as Cesium.PolylineMaterialAppearance).material.uniforms.color as Cesium.Color;
        const alpha = c.alpha;
        Cesium.Color.fromCssColorString(ink, c); c.alpha = alpha;
      }
      for (const p of this.buildings) {
        if (p.ready) p.getGeometryInstanceAttributes('local-buildings').color = Cesium.ColorGeometryInstanceAttribute.toValue(Cesium.Color.fromCssColorString(ink).withAlpha(0.4));
        else this.lastPalette = '';
      }
      Cesium.Color.fromCssColorString(cssToken('void'), this.background);
      Cesium.Color.fromCssColorString(cssToken('ink-900'), this.base);
    }
    scene.backgroundColor = this.background;
    scene.globe.baseColor = this.base;
    const local = !this.context.active;
    this.roads.forEach((p, i) => { p.show = local && settings.layers.roads && (i === 0 || metersPerPixel < 28); });
    if (local && settings.layers.buildings && metersPerPixel > 0 && metersPerPixel < 4 && !this.buildingsBuilt) {
      this.ensureBuildings();
      // Apply the current theme to a newly created batch on the next frame.
      this.lastPalette = '';
    }
    for (const p of this.buildings) p.show = local && settings.layers.buildings && metersPerPixel > 0 && metersPerPixel < 4;
  }

  destroy() {
    this.context.destroy();
    if (!this.viewer.isDestroyed()) {
      const scene = this.viewer.scene;
      if (scene.globe.material === this.localMaterial || scene.globe.material === this.contextMaterial) scene.globe.material = undefined;
      for (const p of this.roads) scene.groundPrimitives.remove(p);
      for (const p of this.buildings) scene.primitives.remove(p);
    }
    this.localMaterial.destroy();
    this.contextMaterial.destroy();
  }
}
