import { DARK_SURFACES, LIGHT_SURFACES, mix } from '../../design-system/tokens/appearance-palette';
import type { MapSettings } from './map-settings';
import type { TileLayer, TileFeature } from './vector-tile';

export interface TilePaintJob {
  url: string;
  light: boolean;
  labelsOnly: boolean;
  settings: MapSettings;
  z: number;
  ox: number;
  oy: number;
  over: number;
  mono: string;
  localNames: string[];
  localPoints: number[][];
}

export function drawTile(layers: TileLayer[], light: boolean, labelsOnly: boolean, settings: MapSettings, z: number, ox: number, oy: number, over: number, mono: string, localNames: Set<string>, localPoints: number[][]) {
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(512, 512) : document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.scale(2, 2);
  const p = light ? LIGHT_SURFACES : DARK_SURFACES;
  const base = p['ink-950'], detail = p['bone-dim'];
  const water = mix(base, p['ink-500'], light ? 0.12 : 0.09);
  const land = mix(base, detail, 0.035);
  const pattern = (woods: boolean) => {
    const tile = typeof document === 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas'); tile.width = tile.height = 16;
    const c = tile.getContext('2d')! as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    c.fillStyle = woods ? land : water; c.fillRect(0, 0, tile.width, tile.height);
    c.strokeStyle = c.fillStyle = mix(woods ? land : water, detail, woods ? 0.12 : 0.10);
    c.lineWidth = 0.6;
    if (woods) { c.fillRect(4, 5, 1, 1); c.fillRect(12, 13, 1, 1); }
    else { c.beginPath(); c.moveTo(-1, 1); c.lineTo(17, 19); c.moveTo(-1, -15); c.lineTo(17, 3); c.stroke(); }
    return ctx.createPattern(tile, 'repeat')!;
  };
  const seaPattern = pattern(false), woodsPattern = pattern(true);
  const paths = (f: TileFeature, extent: number) => {
    const scale = 256 * over / extent;
    ctx.beginPath();
    for (const ring of f.paths) ring.forEach(([x, y], i) => {
      const px = x * scale - ox * 256, py = y * scale - oy * 256;
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
  };
  const draw = (name: string, paint: (f: TileFeature, extent: number) => void) => {
    for (const l of layers) if (l.name === name) for (const f of l.features) paint(f, l.extent);
  };
  if (!labelsOnly) {
    // Earth geometry includes the accurate coast; ocean background is otherwise ambiguous.
    ctx.fillStyle = seaPattern; ctx.fillRect(0, 0, 256, 256);
    draw('earth', (f, e) => { if (f.type === 3) { paths(f, e); ctx.fillStyle = base; ctx.fill('evenodd'); } });
    for (const name of ['landcover', 'landuse']) draw(name, (f, e) => {
      if (f.type !== 3) return;
      const kind = String(f.properties.kind);
      if (!/forest|wood|grass|scrub|park|meadow|farmland|residential|industrial/.test(kind)) return;
      paths(f, e); ctx.fillStyle = /forest|wood|park/.test(kind) ? woodsPattern : land; ctx.fill('evenodd');
    });
    draw('water', (f, e) => {
      paths(f, e);
      if (f.type === 3) { ctx.fillStyle = seaPattern; ctx.fill('evenodd'); }
      else { ctx.strokeStyle = mix(base, detail, 0.16); ctx.lineWidth = 0.6; ctx.stroke(); }
    });
    if (settings.layers.buildings && z >= 14) draw('buildings', (f, e) => {
      if (f.type !== 3) return;
      paths(f, e); ctx.fillStyle = mix(base, detail, 0.17); ctx.fill('evenodd');
      ctx.strokeStyle = mix(base, detail, 0.30); ctx.lineWidth = 0.45; ctx.stroke();
    });
    if (settings.layers.roads) draw('roads', (f, e) => {
      if (f.type !== 2) return;
      const kind = String(f.properties.kind), major = kind === 'highway' || kind === 'major_road';
      if (!major && z < 12 || /path|rail|aerialway/.test(kind) && z < 15) return;
      paths(f, e); ctx.lineWidth = major ? 1.15 : 0.65;
      ctx.strokeStyle = mix(base, detail, major ? 0.55 : 0.25);
      ctx.lineJoin = 'round'; ctx.stroke();
    });
    return canvas;
  }
  const occupied: number[][] = [];
  const label = (text: string, x: number, y: number, size: number, major: boolean) => {
    if (x < 0 || x > 256 || y < 0 || y > 256 || !text) return;
    ctx.font = `500 ${size}px ${mono}`;
    const w = ctx.measureText(text).width, h = size + 8;
    // Do not cut labels at imagery-tile edges or overlap higher-ranked labels.
    if (x - w / 2 < 3 || x + w / 2 > 253 || y - h / 2 < 3 || y + h / 2 > 253) return;
    const box = [x - w / 2 - 5, y - h / 2, x + w / 2 + 5, y + h / 2];
    if (occupied.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    occupied.push(box);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.strokeStyle = base; ctx.lineWidth = 3; ctx.strokeText(text, x, y);
    ctx.fillStyle = major ? p.bone : detail; ctx.fillText(text, x, y);
  };
  if (settings.layers.places) {
    const places = layers.filter((l) => l.name === 'places').flatMap((l) => l.features.map((f) => ({ f, e: l.extent })))
      .sort((a, b) => Number(a.f.properties.min_zoom ?? 20) - Number(b.f.properties.min_zoom ?? 20));
    for (const { f, e } of places) {
      if (Number(f.properties.min_zoom ?? 0) > z || f.type !== 1) continue;
      const major = /city|town/.test(String(f.properties.kind_detail));
      const name = String(f.properties['name:en'] ?? f.properties.name ?? '').toUpperCase();
      if (localNames.has(name)) continue;
      for (const [[x, y]] of f.paths) {
        const px = x / e * 256 * over - ox * 256, py = y / e * 256 * over - oy * 256;
        // Local selectable town anchors win, including differently spelled/translated names.
        if (!localPoints.some(([x, y]) => Math.hypot(px - x, py - y) < 24)) label(name, px, py, major ? 12 : 10, major);
      }
    }
  }
  if (settings.layers.roads && z >= 13) draw('roads', (f, e) => {
    if (f.type !== 2 || !/highway|major_road/.test(String(f.properties.kind))) return;
    const ring = f.paths[0]; if (!ring || ring.length < 2) return;
    const a = ring[0], b = ring[ring.length - 1], s = 256 * over / e;
    const name = String(f.properties.ref ?? f.properties['name:en'] ?? f.properties.name ?? '').toUpperCase();
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) * s < name.length * 6 + 20) return;
    label(name, (a[0] + b[0]) * s / 2 - ox * 256, (a[1] + b[1]) * s / 2 - oy * 256, 9, false);
  });
  return canvas;
}
