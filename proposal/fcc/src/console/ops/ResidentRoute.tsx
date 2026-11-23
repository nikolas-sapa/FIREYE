import { useState } from 'react';
import type { Geo, ScenarioPack } from '../contracts';
import { tokenOverride } from '../stage3d/capabilities';
import { getOsm, getRouteChoice, routesNow, setRouteChoice, useAlertVersion, type EscapeRoute } from './alerts';
import { googleMapsDirectionsUrl, googleMapsEmbedUrl, mapsWaypointLimit, ROUTE_KINDS, ROUTE_LABEL, steeringWaypoints, ETA_SAFETY_MARGIN_MIN, type RouteOption } from './geo/evac';
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

const isOption = (r: EscapeRoute): r is RouteOption => 'kind' in r && 'timeMin' in r;
const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** Chosen route's Google Maps hand-off: origin = resident, densified on-path waypoints up to the URL limit. */
export function routeDirections(origin: Geo, route: EscapeRoute, mobile: boolean) {
  return { origin, destination: route.exit.pos, waypoints: steeringWaypoints(route.path, mapsWaypointLimit(mobile)), travelmode: 'driving' as const };
}

export function ResidentRouteChoice({ origin, route }: { origin: Geo; route: RouteOption }) {
  useAlertVersion();
  const options = routesNow(origin).options;
  const choice = getRouteChoice();
  return <div className="mt-2">
    <div className="flex flex-wrap gap-1" role="group" aria-label="Route option">
      {ROUTE_KINDS.map((kind) => <button key={kind} type="button" aria-pressed={choice === kind} onClick={() => setRouteChoice(kind)}
        className={`${buttonClass} ${choice === kind ? 'border-bone-dim text-bone' : ''}`}>{ROUTE_LABEL[kind]}{kind === 'balanced' ? ' · recommended' : ''}</button>)}
    </div>
    <p className="fcc-num mt-1.5 font-mono text-micro uppercase text-bone-dim">
      {ROUTE_LABEL[route.kind]}{route.sameAs.length ? ` = ${route.sameAs.map((k) => ROUTE_LABEL[k]).join(' = ')}` : ''} · ~{Math.max(1, Math.round(route.timeMin))} min · {fmtKm(route.lengthM)} · {route.extraMin ? `+${route.extraMin} min vs fastest` : 'fastest time'}
      {route.minFireM !== null && ` · fire ≥ ${fmtKm(route.minFireM)}`} · caution {Math.round(route.cautionM)} m
    </p>
    <p className="mt-1 text-xs leading-4 text-bone-dim">{route.why}</p>
    {options && options.marginMin < ETA_SAFETY_MARGIN_MIN && <p className="mt-0.5 font-mono text-micro uppercase text-amber">Less than {ETA_SAFETY_MARGIN_MIN} min ahead of modeled fire arrival on this road</p>}
    {route.kind !== 'balanced' && options && <p className="mt-0.5 font-mono text-micro text-bone-mute">Recommended: {ROUTE_LABEL.balanced} · {options.balanced.exit.label} · ~{Math.max(1, Math.round(options.balanced.timeMin))} min</p>}
    <p className="mt-0.5 font-mono text-micro text-bone-mute">Simulation-derived · nominal speeds · not validated evacuation guidance</p>
  </div>;
}

export function ResidentDirections({ origin, route }: { origin: Geo; route: EscapeRoute }) {
  const mobile = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;
  const directions = routeDirections(origin, route, !!mobile);
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return <>
    {isOption(route) && <ResidentRouteChoice origin={origin} route={route} />}
    <a className={`${buttonClass} mt-2 inline-block`} href={googleMapsDirectionsUrl(directions)} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
    {mapsKey && tokenOverride() === 'all' && <iframe title="Exercise route in Google Maps" className="mt-2 h-44 w-full border border-line" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={googleMapsEmbedUrl(directions, mapsKey)} />}
    <p className="mt-1 font-mono text-micro text-bone-mute">Google may recalculate this prototype route and does not know the simulated fire.</p>
  </>;
}

export function ResidentDisclaimer() {
  return <p className="shrink-0 border-b border-line px-4 py-2 font-mono text-micro text-bone-mute">Exercise · simulation based on the 2018 Mati reconstruction. Not official evacuation advice — follow civil protection / 112 instructions.</p>;
}
