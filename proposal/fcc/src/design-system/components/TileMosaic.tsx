import { useEffect, useState } from 'react';

export interface MosaicTile {
  src?: string;
  label: string;
  status?: string;
}
export interface TileMosaicProps {
  tiles: MosaicTile[];
  label: string;
  seams?: boolean;
}

/** Exactly four independently contained, uncropped cells. Never fills failed cells with source pixels. */
export function TileMosaic({ tiles, label, seams = true }: TileMosaicProps) {
  const [failed, setFailed] = useState<string[]>([]);
  const sources = tiles.map(tile => tile.src).join('|');
  useEffect(() => setFailed([]), [sources]);
  return (
    <figure className="min-w-0 border border-line bg-ink-900">
      <figcaption className="border-b border-line px-3 py-2 font-mono text-nano uppercase text-bone-dim">{label}</figcaption>
      <div className="fcc-sensor relative grid aspect-square grid-cols-2 grid-rows-2 bg-void text-bone" role="group" aria-label={`${label}, 2 by 2 grid`}>
        {Array.from({ length: 4 }, (_, index) => {
          const tile = tiles[index];
          const src = tile?.src;
          return (
            <div key={index} className="relative min-h-0 min-w-0 overflow-hidden">
              {src && !failed.includes(src) ?
                <img src={src} alt={`${label}: ${tile.label}`} referrerPolicy="no-referrer" className="h-full w-full object-contain"
                  onError={() => setFailed(values => [...values, src])} /> :
                <div className="fcc-hatch flex h-full items-center justify-center p-2 text-center font-mono text-nano uppercase text-bone-dim">
                  {src ? 'Image load failed' : tile?.status || 'Not analyzed'}
                </div>}
              {seams && <span className="absolute left-1 top-1 bg-ink-950 px-1 py-0.5 font-mono text-nano text-bone">{tile?.label ?? index + 1}</span>}
            </div>
          );
        })}
        {seams && <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-bone" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-bone" />
        </>}
      </div>
    </figure>
  );
}
