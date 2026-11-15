import { artFor, blinkArtFor, CHARACTERS, GRID_SIZE, runsFor } from './sprites';
import type { CharacterId, CharacterState, PixelRun } from './sprites';
import './characters.css';

export type CharacterSize = 16 | 20 | 24 | 32 | 48 | 64 | 96;

type Rendered = { base: PixelRun[]; blink: PixelRun[] };

const cache = new Map<string, Rendered>();

function renderedFor(id: CharacterId, state: CharacterState): Rendered {
  const key = `${id}|${state}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pixels = artFor(id, state);
  let blink: PixelRun[] = [];
  if (state === 'thinking') {
    const closed = blinkArtFor(id, state);
    blink = runsFor(closed, (x, y) => closed[y][x] !== pixels[y][x]);
  }
  const rendered = { base: runsFor(pixels), blink };
  cache.set(key, rendered);
  return rendered;
}

function rects(runs: PixelRun[], palette: Record<string, string>) {
  return runs.map((run) => (
    <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={palette[run.symbol]} />
  ));
}

export function Character({ id, state = 'idle', size = 24, title }: {
  id: CharacterId;
  state?: CharacterState;
  size?: CharacterSize;
  title?: string;
}) {
  const art = CHARACTERS[id];
  const { base, blink } = renderedFor(id, state);
  return (
    <svg
      key={`${id}-${state}`}
      className={`fcc-char fcc-char--${state}`}
      width={size}
      height={size}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${art.name}, ${art.role}`}
    >
      {title ? <title>{title}</title> : null}
      <g className="fcc-char__body">
        {rects(base, art.palette)}
        {blink.length ? <g className="fcc-char__blink">{rects(blink, art.palette)}</g> : null}
      </g>
    </svg>
  );
}
