import { useState } from 'react';
import type { Geo, ScenarioPack } from '../contracts';
import { tokenOverride } from '../stage3d/capabilities';
import { getOsm, type EscapeRoute } from './alerts';
import { googleMapsDirectionsUrl, googleMapsEmbedUrl, steeringWaypoints } from './geo/evac';
import { inScenario, parseLocation } from './geo/saferoute';

const buttonClass = 'border border-line-strong bg-ink-900 px-2 py-1.5 font-mono text-micro uppercase text-bone-dim hover:text-bone focus-visible:outline focus-visible:outline-1';
export interface ResidentLocationProps {
  picking: boolean;
  onPick: () => void;
  locationMessage: string;
  onLocationMessage: (message: string) => void;
}

export function ResidentLocationControls({ pack, picking, onPick, locationMessage, onLocationMessage, onSetHome }: ResidentLocationProps & { pack: ScenarioPack | null; onSetHome: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const applyLocation = (pos: Geo) => {
    if (!pack || !inScenario(pos, pack.raster.bbox)) { onLocationMessage('Outside the exercise area. Current location kept.'); return; }
    onSetHome(`custom:${pos.lat},${pos.lon}`);
    onLocationMessage('Custom location set · simulated resident');
  };
  const locate = () => {
    if (!navigator.geolocation) { onLocationMessage('Location is unavailable. Enter a place or coordinates.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => { setLocating(false); applyLocation({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { setLocating(false); onLocationMessage('Unable to get location. Enter a place or coordinates.'); }, { timeout: 10000, maximumAge: 0 });
  };
  return <>
    <form className="mt-1.5 flex gap-1" onSubmit={(e) => {
      e.preventDefault();
      if (!pack) return;
      const result = parseLocation(query, pack.manifest.places, getOsm()?.roads ?? [], pack.raster.bbox);
      if ('error' in result) onLocationMessage(result.error); else applyLocation(result.pos);
    }}>
      <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Place, road or lat, lon" placeholder="Place, road or lat, lon"
        className="min-w-0 flex-1 border border-line-strong bg-ink-900 px-2 py-1.5 text-xs text-bone focus-visible:outline focus-visible:outline-1" />
      <button type="submit" className={buttonClass}>Set</button>
    </form>
    <div className="mt-1.5 flex gap-1">
      <button type="button" className={buttonClass} onClick={locate} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button>
      <button type="button" className={buttonClass} aria-pressed={picking} onClick={onPick}>{picking ? 'Cancel map pick' : 'Pick on map'}</button>
    </div>
    <p role="status" className="mt-1 font-mono text-micro text-bone-mute">{picking ? 'Click the map to set your location.' : locationMessage}</p>
  </>;
}

export function ResidentDirections({ origin, route }: { origin: Geo; route: EscapeRoute }) {
  const directions = { origin, destination: route.exit.pos, waypoints: steeringWaypoints(route.path) };
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return <>
    <a className={`${buttonClass} mt-2 inline-block`} href={googleMapsDirectionsUrl(directions)} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
    {mapsKey && tokenOverride() === 'all' && <iframe title="Exercise route in Google Maps" className="mt-2 h-44 w-full border border-line" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={googleMapsEmbedUrl(directions, mapsKey)} />}
    <p className="mt-1 font-mono text-micro text-bone-mute">Google may recalculate this prototype route and does not know the simulated fire.</p>
  </>;
}

export function ResidentDisclaimer() {
  return <p className="shrink-0 border-b border-line px-4 py-2 font-mono text-micro text-bone-mute">Exercise · simulation based on the 2018 Mati reconstruction. Not official evacuation advice — follow civil protection / 112 instructions.</p>;
}
