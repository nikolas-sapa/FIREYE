/** Fixed, north-up 2×2 layout. Coordinates are public landscape locations, not incident data. */
export const GRID_SIDE = 2;
export const GRID_COUNT = 4;
/** Automatic regenerations per cell after the palette gate rejects its output. The server enforces the maximum. */
export const GRID_MAX_RETRIES = 3;
export const GRID_DEFAULT_RETRIES = 0;
export const GRID_TILE_PX = 512;
export const GRID_IMAGE_PX = GRID_SIDE * GRID_TILE_PX;
export const GRID_REGIONS = [
  { name: 'Pindus foothills', lat: 39.85, lon: 21.15, jitter: 0.08 },
  { name: 'Arcadia', lat: 37.65, lon: 22.15, jitter: 0.08 },
  { name: 'Parnassus', lat: 38.52, lon: 22.50, jitter: 0.04 },
  { name: 'Taygetos', lat: 37.02, lon: 22.30, jitter: 0.04 },
  { name: 'Southern Rhodope', lat: 41.12, lon: 24.50, jitter: 0.04 },
  { name: 'Central Crete', lat: 35.15, lon: 24.90, jitter: 0.025 },
  { name: 'Olympus foothills', lat: 40.05, lon: 22.25, jitter: 0.04 },
  { name: 'Inland Aetolia', lat: 38.75, lon: 21.50, jitter: 0.06 },
] as const;

export const GRID_SOURCE = {
  name: 'EOX Sentinel-2 cloudless 2020',
  layer: 's2cloudless-2020_3857',
  year: '2020 annual mosaic, not a dated acquisition or live imagery',
  nativeResolution: 'approximately 10 m; not suitable for identifying individual bushes or small objects',
  attribution: 'Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)',
  website: 'https://maps.eox.at/',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  termsUrl: 'https://eox.at/2021/03/sentinel-2-cloudless-2020/#license',
} as const;

export type Bounds = [west: number, south: number, east: number, north: number];
export interface GridCell {
  index: number;
  label: string;
  row: number;
  col: number;
  crop: [x: number, y: number, width: number, height: number];
  bounds: Bounds;
}
export interface GridScene {
  id: string;
  region: string;
  center: { lat: number; lon: number };
  crs: 'EPSG:3857';
  bounds: Bounds;
  tiles: GridCell[];
  source: typeof GRID_SOURCE;
  createdAt: string;
}

const R = 6378137;
export function toMercator(lon: number, lat: number): [number, number] {
  return [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}

export function gridCells([w, s, e, n]: Bounds): GridCell[] {
  const dx = (e - w) / GRID_SIDE;
  const dy = (n - s) / GRID_SIDE;
  return ['NW', 'NE', 'SW', 'SE'].map((label, index) => {
    const row = Math.floor(index / GRID_SIDE);
    const col = index % GRID_SIDE;
    return { index, label, row, col, crop: [col * GRID_TILE_PX, row * GRID_TILE_PX, GRID_TILE_PX, GRID_TILE_PX],
      bounds: [w + col * dx, n - (row + 1) * dy, w + (col + 1) * dx, n - row * dy] };
  });
}

/** Random within eight deliberately inland Greek windows, not uniformly across the country. */
export function randomGridScene(id: string, random = Math.random): GridScene {
  const unit = () => Math.max(0, Math.min(1 - Number.EPSILON, random()));
  const region = GRID_REGIONS[Math.floor(unit() * GRID_REGIONS.length)];
  const lat = region.lat + (unit() * 2 - 1) * region.jitter;
  const lon = region.lon + (unit() * 2 - 1) * region.jitter;
  const [x, y] = toMercator(lon, lat);
  const half = 5120 / Math.cos(lat * Math.PI / 180);
  const bounds: Bounds = [x - half, y - half, x + half, y + half];
  return { id, region: region.name, center: { lat, lon }, crs: 'EPSG:3857', bounds,
    tiles: gridCells(bounds), source: GRID_SOURCE, createdAt: new Date().toISOString() };
}

export function imageryUrl(scene: GridScene): string {
  const query = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: GRID_SOURCE.layer,
    STYLES: '', SRS: scene.crs, BBOX: scene.bounds.join(','), WIDTH: String(GRID_IMAGE_PX),
    HEIGHT: String(GRID_IMAGE_PX), FORMAT: 'image/jpeg',
  });
  return `https://tiles.maps.eox.at/wms?${query}`;
}

export function gridTilePrompt(prompt: string, cell: GridCell): string {
  return `${prompt.trim()}\n\nTILE CONTEXT: ${cell.label} (${cell.row + 1},${cell.col + 1}) of exactly 2 by 2, north up. Input is one 512 by 512 pixel satellite crop. Return one square image of this crop only. Do not draw neighboring cells or a 2 by 2 collage. No inset, legend, caption, labels, border, margin, or invented detail. Classification must use the fixed palette consistently; do not adjust thresholds to make this crop look more or less hazardous.`;
}
