import { useEffect, useRef, useState } from 'react';
import { cn } from '@ds';
import { MAP_LAYERS, resetMapSettings, setMapLayer, setMapMode, useMapSettings, type MapLayer } from './map-settings';

export function MapControls({ contourM }: { contourM: number }) {
  const settings = useMapSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hidden = Object.values(settings.layers).filter((v) => !v).length;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={ref} className="absolute right-4 top-4 z-[3] flex flex-col items-end gap-1">
      <div className="flex h-7 items-stretch border border-line-strong bg-ink-950 shadow-panel">
        <div className="flex" role="group" aria-label="Globe map style">
          {(['outline', 'satellite'] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => setMapMode(mode)}
              className={cn('border-r border-line px-2 font-mono text-micro uppercase', settings.mode === mode ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:bg-ink-800')}>
              {mode === 'outline' ? 'Outline' : 'Satellite'}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Globe layers" aria-expanded={open} aria-controls="globe-layers" onClick={() => setOpen(!open)}
          className="px-2 font-mono text-micro uppercase text-bone-dim hover:bg-ink-800">
          Layers · {hidden} hidden
        </button>
      </div>
      {settings.mode === 'outline' && <span className="bg-ink-950/90 px-2 py-1 font-mono text-micro uppercase text-bone-mute">DEM relief · {contourM} m contours</span>}
      {open && (
        <div id="globe-layers" className="max-h-[65vh] w-64 overflow-y-auto border border-line-strong bg-ink-900 p-3 shadow-panel">
          <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
            <span className="fcc-micro">Globe layers</span>
            <button type="button" onClick={resetMapSettings} className="font-mono text-micro uppercase text-bone-dim underline">Reset</button>
          </div>
          {(Object.entries(MAP_LAYERS) as [MapLayer, string][]).map(([key, label]) => {
            const outlineOnly = key === 'contours' || key === 'roads' || key === 'buildings';
            const disabled = outlineOnly ? settings.mode !== 'outline' : key === 'atmosphere' && settings.mode === 'outline';
            return (
              <label key={key} className={cn('flex cursor-pointer items-center gap-2 border-b border-line-faint py-2 text-xs text-bone-dim', disabled && 'cursor-not-allowed opacity-50')}>
                <input type="checkbox" checked={settings.layers[key]} disabled={disabled}
                  onChange={(e) => setMapLayer(key, e.target.checked)} className="h-3 w-3 accent-signal" />
                {label}{outlineOnly && <span className="ml-auto font-mono text-micro text-bone-mute">Outline</span>}
              </label>
            );
          })}
          <p className="mt-3 font-mono text-micro uppercase leading-4 text-bone-mute">Visibility only. Hidden findings and fire remain in the decision queue. Building marks are approximate, not surveyed footprints.</p>
        </div>
      )}
    </div>
  );
}
