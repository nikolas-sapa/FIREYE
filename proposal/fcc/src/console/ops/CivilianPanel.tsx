import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { cn } from '@ds';
import type { Geo } from '../contracts';
import { useConsoleSelector } from '../store';
import { localTime, packZone } from '../ui/format';
import {
  STAGE_RANK, alertFeed, fireUpdates, counters, hazardAt, leaveBy, placeAlerts, pointInPolygon, residentAlertAt, routeRoads, useAlertVersion, useRoutes,
} from './alerts';
import type { AlertStage } from './geo/evac';
import { Character } from './characters/Character';
import { useStageAnnouncements } from './announce';
import { parseLocation } from './geo/saferoute';
import { ResidentDirections, ResidentDisclaimer, ResidentLocationControls, type ResidentLocationProps } from './ResidentRoute';
import { useFireye } from '../fireye/shell/ui';

export const HOME_OPTIONS = ['neos-voutzas', 'mati', 'kokkino-limanaki', 'argyra-akti', 'nea-makri'] as const;
const STAGE_COPY: Record<AlertStage, { title: string; body: string; cls: string }> = {
  monitor: { title: 'MONITOR', body: 'No evacuation alert for your area yet. Stay aware.', cls: 'text-bone' },
  prepare: { title: 'PREPARE TO LEAVE', body: 'Fire is expected in your area within hours. Pack essentials, check on neighbours.', cls: 'text-amber' },
  leave: { title: 'LEAVE NOW', body: 'Fire is approaching your area. Leave immediately on the route shown.', cls: 'text-ember' },
  shelter: { title: 'SHELTER IN PLACE', body: 'Leaving is no longer safe. Stay indoors, close windows, move to the side away from the fire.', cls: 'text-ember' },
};

const homeListeners = new Set<() => void>();
export function useHome(): { id: string; name: string; pos: Geo } | null {
  const pack = useConsoleSelector((s) => s.pack);
  const id = useSyncExternalStore((fn) => { homeListeners.add(fn); return () => { homeListeners.delete(fn); }; },
    () => localStorage.getItem('ops.home') ?? 'neos-voutzas', () => 'neos-voutzas');
  return useMemo(() => {
    if (pack && id.startsWith('custom:')) {
      const result = parseLocation(id.slice(7), [], [], pack.raster.bbox);
      if ('pos' in result) return { id, name: 'Custom location', pos: result.pos };
    }
    const p = pack?.manifest.places.find((x) => x.id === id) ?? pack?.manifest.places.find((x) => x.id === 'neos-voutzas');
    return p ? { id: p.id, name: p.name, pos: p.pos } : null;
  }, [pack, id]);
}
export function setHome(id: string) {
  try { localStorage.setItem('ops.home', id); } catch { /* optional */ }
  homeListeners.forEach((f) => f());
}

function BigCounter({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex-1 border-l border-line px-3 py-2 first:border-l-0">
      <div className="fcc-num text-[32px] font-semibold text-bone">{v.toLocaleString('en-US')}</div>
      <div className="mt-0.5 font-mono text-micro uppercase tracking-[0.12em] text-bone-mute">{k}</div>
    </div>
  );
}

export function CivilianPanel({ home, ...locationProps }: ResidentLocationProps & { home: { id: string; name: string; pos: Geo } | null }) {
  const [expanded, setExpanded] = useState(false);
  const chat = useFireye((s) => s.chat);
  useEffect(() => {
    if (chat && window.matchMedia('(max-width: 767px)').matches) setExpanded(false);
  }, [chat]);
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => s.clock.t);
  const proj = useConsoleSelector((s) => s.projection);
  const v = useAlertVersion();
  const routes = useRoutes(home?.pos ?? null, proj?.rev ?? -1);
  const homeAlert = useMemo(() => {
    if (!pack || !home) return null;
    if (home.id.startsWith('custom:')) return residentAlertAt(pack, t, home.pos);
    return placeAlerts(pack, t).find((p) => p.id === home.id) ?? null;
  }, [pack, t, home, v]);
  const feed = useMemo(() => [...alertFeed(pack, t), ...fireUpdates(pack, t, home?.pos ?? null)].sort((a, b) => a.t - b.t).slice(-30).reverse(), [pack, t, v, home]);
  const counts = useMemo(() => counters(pack, t), [pack, t, v]);
  const tz = packZone(pack).label;
  const blocked = !!home && hazardAt(pack, t).blocked.some((p) => pointInPolygon(home.pos, p));
  const stage = blocked ? 'shelter' : homeAlert?.stage ?? 'monitor';
  const announcements = useStageAnnouncements(home?.id ?? null, stage, home?.name ?? 'Your area');
  const copy = STAGE_COPY[stage];
  const leaveAt = homeAlert?.eta != null ? leaveBy(homeAlert.eta, 45) : null;
  const placeOptions = useMemo(() => (pack?.manifest.places ?? []).filter((p) => (HOME_OPTIONS as readonly string[]).includes(p.id)), [pack]);
  const best = routes.best;

  return (
    <aside className="civilian-sheet flex min-h-0 w-full flex-1 flex-col overflow-y-auto border-l border-line bg-ink-950 sm:w-[400px] sm:flex-none sm:overflow-visible" aria-label="Civilian panel">
      <button type="button" aria-expanded={expanded} aria-controls="resident-details" onClick={() => setExpanded(!expanded)}
        className="resident-summary hidden shrink-0 border-b border-line px-4 py-2 text-left">
        <span className="flex items-center justify-between gap-2"><span className={cn('font-semibold', copy.cls)}>{copy.title}</span><span className="text-xs text-bone-dim">{expanded ? 'Less' : 'Details'} {expanded ? '−' : '+'}</span></span>
        <span className="mt-1 flex flex-wrap gap-x-6 text-xs text-bone-dim">
          <span>Fire ETA <span className="fcc-num text-bone">{homeAlert?.eta != null ? `${localTime(homeAlert.eta, tz)} ${tz}` : '—'}</span></span>
          <span>Leave by <span className="fcc-num text-ember">{leaveAt != null ? `${localTime(leaveAt, tz)} ${tz}` : '—'}</span></span>
        </span>
        <span className="mt-1 block text-micro text-bone-mute">Simulation · follow 112 / civil protection</span>
      </button>
      <div id="resident-details" className="resident-details contents" data-expanded={expanded}>
      <div className="shrink-0 border-b border-line px-4 py-3">
        <label className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">Your location · simulated resident</label>
        <select value={home?.id ?? ''} onChange={(e) => setHome(e.target.value)} aria-label="Your location"
          className="mt-1.5 w-full border border-line-strong bg-ink-900 px-2 py-1.5 text-sm text-bone focus:outline-none">
          {placeOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {home?.id.startsWith('custom:') && <option value={home.id}>{home.name} · {home.pos.lat.toFixed(5)}, {home.pos.lon.toFixed(5)}</option>}
        </select>
        <ResidentLocationControls pack={pack} onSetHome={setHome} {...locationProps} />
      </div>
      <div className={cn('shrink-0 border-b-2 px-4 py-4', STAGE_RANK[stage] >= 2 ? 'border-ember' : stage === 'prepare' ? 'border-amber' : 'border-line')}>
        <div className="flex items-start gap-3">
          <Character id="rescue" state={STAGE_RANK[stage] >= 2 ? 'alert' : 'idle'} size={64} title="Rescue" />
          <div className="relative mt-1 border border-line bg-ink-900 px-3 py-2">
            <span aria-hidden className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-b border-l border-line bg-ink-900" />
            <p className="text-sm leading-5 text-bone">
              {STAGE_RANK[stage] >= 2 && best ? `Leave now. Take the route to ${best.exit.label}.` : copy.body}
            </p>
          </div>
        </div>
        <div className={cn('mt-3 font-sans text-[40px] font-bold leading-none tracking-tight', copy.cls)}>{copy.title}</div>
        <p className="mt-2 text-sm leading-5 text-bone-dim">{copy.body}</p>
        <div className="mt-3 flex gap-6 font-mono">
          <div>
            <div className="text-micro uppercase text-bone-mute">Fire ETA{home?.id.startsWith('custom:') ? ' · band estimate' : ''}</div>
            <div className="fcc-num mt-0.5 text-lg text-bone">{homeAlert?.eta != null ? `${localTime(homeAlert.eta, tz)} ${tz}` : '—'}</div>
          </div>
          {leaveAt != null && (
            <div>
              <div className="text-micro uppercase text-bone-mute">Leave by</div>
              <div className="fcc-num mt-0.5 text-lg text-ember">{localTime(leaveAt, tz)} {tz}</div>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">Your route out</div>
        {best ? (
          <div className="mt-2">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-medium text-bone">{best.exit.label}</span>
              <span className="fcc-num font-mono text-sm text-bone-dim">{(best.lengthM / 1000).toFixed(1)} km</span>
            </div>
            <ol className="mt-1.5 text-xs leading-5 text-bone-dim">
              {routeRoads(best).map((r, i) => <li key={i}>{i + 1}. {r}</li>)}
            </ol>
            {best.cautionM > 0 && <p className="mt-1 font-mono text-micro uppercase text-amber">{(best.cautionM / 1000).toFixed(1)} km through caution zone</p>}
            {home && <ResidentDirections origin={home.pos} route={best} />}
            <p className="mt-2 border border-ember/50 bg-ember/10 px-2 py-1.5 text-xs leading-4 text-bone-dim">
              Do NOT go toward Mati coast — no road exit there.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-bone-mute">{routes.status === 'loading' ? 'Loading road graph / current projection…' : blocked ? 'No safe road route: your location is in the fire / predicted area. See the shelter guidance above.' : 'No safe road route available. Follow civil protection / 112 instructions.'}</p>
        )}
      </div>
      <ResidentDisclaimer />
      <div className="shrink-0 px-4 py-2 sm:min-h-0 sm:flex-1 sm:shrink sm:overflow-y-auto" aria-label="Official alerts">
        <div className="flex items-center justify-between gap-2 font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">
          <span>Official alerts · simulated</span>
          {announcements.supported && <div className="flex gap-1">
            <button className="border border-line px-2 py-1 uppercase" onClick={() => void announcements.enable()} disabled={announcements.permission === 'granted'}>{announcements.permission === 'granted' ? 'Alerts on' : 'Enable alerts'}</button>
            {announcements.permission === 'granted' && <button className="border border-line px-2 py-1 uppercase" aria-pressed={announcements.voice} onClick={announcements.toggleVoice}>Voice {announcements.voice ? 'on' : 'off'}</button>}
          </div>}
        </div>
        <ul className="mt-1.5">
          {feed.map((r, i) => (
            <li key={`${r.t}-${i}`} className="border-b border-line-faint py-1.5 last:border-0">
              <span className="fcc-num font-mono text-micro text-bone-mute">{localTime(r.t, tz)}</span>
              <p className={cn('mt-0.5 text-xs leading-4', STAGE_RANK[r.stage] >= 2 ? 'text-ember' : r.stage === 'prepare' ? 'text-amber' : 'text-bone-dim')}>{r.text}</p>
            </li>
          ))}
          {feed.length === 0 && <li className="py-2 text-xs text-bone-mute">No alerts issued yet.</li>}
        </ul>
      </div>
      <div className="flex shrink-0 border-t border-line" aria-label="Counters · simulated">
        <BigCounter k="In alert zones" v={counts.alertZones} />
        <BigCounter k="Warned" v={counts.warned} />
        <BigCounter k="Moved out" v={counts.moved} />
      </div>
      <p className="shrink-0 border-t border-line-faint px-4 py-1.5 font-mono text-micro uppercase text-bone-mute">Prototype spread model · not a validated forecast · simulated</p>
      </div>
    </aside>
  );
}
