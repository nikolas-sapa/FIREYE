import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, color as ds, type IconName } from '@ds';
import type { FindingKind, UnitKind } from '../contracts';

const DPR = 2;
const icons = new Map<IconName, HTMLImageElement>();

export const UNIT_ICON: Record<UnitKind, IconName> = {
  drone: 'drone', engine: 'engine', crew: 'crew', dozer: 'dozer', helo: 'helo', tanker: 'tanker', ems: 'plus', law: 'shield',
};

export const FINDING_ICON: Record<FindingKind, IconName> = {
  human: 'human', animal: 'animal', structure: 'structure', combustible: 'combustible', fuel: 'tree', spot: 'flame',
  water: 'droplet', 'road-block': 'hazard', smoke: 'wind', vehicle: 'target',
};

function svgFor(name: IconName, stroke = 1.6): string {
  const markup = renderToStaticMarkup(createElement(Icon, { name, size: 48, strokeWidth: stroke }));
  // React omits xmlns, which standalone SVG images require.
  return markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, ds.bone.DEFAULT);
}

/** Loads (once) the design-system icons as images so tinted canvases can be produced synchronously. */
export async function loadIcons(names: IconName[] = [...Object.values(UNIT_ICON), ...Object.values(FINDING_ICON)]): Promise<void> {
  await Promise.all(
    [...new Set(names)].filter((n) => !icons.has(n)).map(
      (n) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.onload = () => {
            icons.set(n, img);
            res();
          };
          img.onerror = () => res();
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(n))}`;
        }),
    ),
  );
}

function tinted(name: IconName, px: number, col: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const img = icons.get(name);
  if (img) g.drawImage(img, 0, 0, px, px);
  else g.fillRect(px * 0.3, px * 0.3, px * 0.4, px * 0.4);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col;
  g.fillRect(0, 0, px, px);
  return c;
}

export type GlyphStyle = 'chip' | 'bracket' | 'solid' | 'bare';
export interface GlyphSpec {
  icon: IconName;
  /** Token hex. */
  color: string;
  style: GlyphStyle;
  selected?: boolean;
  /** CSS px (drawn at 2x). */
  size?: number;
}

const cache = new Map<string, HTMLCanvasElement>();

function rgbaOf(hexStr: string, a: number) {
  const h = hexStr.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function brackets(g: CanvasRenderingContext2D, x: number, y: number, s: number, len: number) {
  g.beginPath();
  g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y);
  g.moveTo(x + s - len, y); g.lineTo(x + s, y); g.lineTo(x + s, y + len);
  g.moveTo(x + s, y + s - len); g.lineTo(x + s, y + s); g.lineTo(x + s - len, y + s);
  g.moveTo(x + len, y + s); g.lineTo(x, y + s); g.lineTo(x, y + s - len);
  g.stroke();
}

/** Billboard image (2x canvas; use billboard scale 0.5). Cached per spec. */
export function glyph(spec: GlyphSpec): HTMLCanvasElement {
  const size = spec.size ?? (spec.style === 'bare' ? 22 : 28);
  const key = `${spec.icon}|${spec.color}|${spec.style}|${spec.selected ? 1 : 0}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = spec.selected ? 8 : 2;
  const S = (size + pad * 2) * DPR;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const o = pad * DPR, s = size * DPR;
  g.lineWidth = DPR;
  if (spec.style === 'chip') {
    g.fillStyle = rgbaOf(ds.ink[950], 0.9);
    g.fillRect(o, o, s, s);
    g.strokeStyle = rgbaOf(spec.color, 0.95);
    g.strokeRect(o + DPR / 2, o + DPR / 2, s - DPR, s - DPR);
  } else if (spec.style === 'bracket') {
    g.fillStyle = rgbaOf(ds.ink[950], 0.55);
    g.fillRect(o, o, s, s);
    g.strokeStyle = rgbaOf(spec.color, 1);
    g.lineWidth = DPR * 1.25;
    brackets(g, o + DPR, o + DPR, s - 2 * DPR, s * 0.28);
  } else if (spec.style === 'solid') {
    g.fillStyle = rgbaOf(spec.color, 0.24);
    g.fillRect(o, o, s, s);
    g.strokeStyle = rgbaOf(spec.color, 1);
    g.lineWidth = DPR * 1.25;
    g.strokeRect(o + DPR / 2, o + DPR / 2, s - DPR, s - DPR);
  } else {
    g.fillStyle = rgbaOf(ds.ink[950], 0.6);
    g.beginPath();
    g.arc(o + s / 2, o + s / 2, s * 0.48, 0, Math.PI * 2);
    g.fill();
  }
  const ip = Math.round(s * (spec.style === 'bare' ? 0.72 : 0.64));
  g.drawImage(tinted(spec.icon, ip, spec.color), o + (s - ip) / 2, o + (s - ip) / 2);
  if (spec.selected) {
    g.strokeStyle = ds.signal.DEFAULT;
    g.lineWidth = DPR * 1.5;
    brackets(g, DPR, DPR, S - 2 * DPR, S * 0.22);
  }
  cache.set(key, c);
  return c;
}

/** Small heading chevron (white, tint via billboard color). */
let chevron: HTMLCanvasElement | null = null;
export function headingChevron(): HTMLCanvasElement {
  if (chevron) return chevron;
  // Tip sits at the top edge of a 46 px square so rotating it orbits the 28 px chip.
  const S = 46 * DPR;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = ds.bone.DEFAULT;
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2 + 4 * DPR, 6 * DPR);
  g.lineTo(S / 2, 4.5 * DPR);
  g.lineTo(S / 2 - 4 * DPR, 6 * DPR);
  g.closePath();
  g.fill();
  chevron = c;
  return c;
}

/** Tiny square tick used for place markers. */
let tick: HTMLCanvasElement | null = null;
export function placeTick(): HTMLCanvasElement {
  if (tick) return tick;
  const S = 10 * DPR;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = ds.bone.DEFAULT;
  g.lineWidth = DPR;
  g.strokeRect(2 * DPR + 0.5, 2 * DPR + 0.5, 6 * DPR - 1, 6 * DPR - 1);
  g.fillStyle = ds.bone.DEFAULT;
  g.fillRect(4 * DPR, 4 * DPR, 2 * DPR, 2 * DPR);
  tick = c;
  return c;
}

export const GLYPH_SCALE = 1 / DPR;
