import { useMemo, useSyncExternalStore } from 'react';
import { cn } from '@ds';
import type { Geo } from '../contracts';
import { useConsoleSelector } from '../store';
import { localTime, packZone } from '../ui/format';
import {
  STAGE_RANK, alertFeed, counters, leaveBy, placeAlerts, routeRoads, useAlertVersion, useRoutes,
} from './alerts';
import type { AlertStage } from './geo/evac';

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
      <div className="fcc-num text-2xl font-semibold text-bone">{v.toLocaleString('en-US')}</div>
      <div className="mt-0.5 font-mono text-micro uppercase tracking-[0.12em] text-bone-mute">{k}</div>
    </div>
  );
}

export function CivilianPanel({ home }: { home: { id: string; name: string; pos: Geo } | null }) {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => s.clock.t);
  const proj = useConsoleSelector((s) => s.projection);
  const v = useAlertVersion();
  const routes = useRoutes(home?.pos ?? null, proj?.rev ?? -1);
  const homeAlert = useMemo(() => {
    if (!pack || !home) return null;
    return placeAlerts(pack, t).find((p) => p.id === home.id) ?? null;
  }, [pack, t, home, v]);
  const feed = useMemo(() => alertFeed(pack, t).slice(-30).reverse(), [pack, t, v]);
  const counts = useMemo(() => counters(pack, t), [pack, t, v]);
  const tz = packZone(pack).label;
  const stage = homeAlert?.stage ?? 'monitor';
  const copy = STAGE_COPY[stage];
  const leaveAt = homeAlert?.eta != null ? leaveBy(homeAlert.eta, 45) : null;
  const placeOptions = useMemo(() => (pack?.manifest.places ?? []).filter((p) => (HOME_OPTIONS as readonly string[]).includes(p.id)), [pack]);
  const best = routes.best;

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-ink-950" aria-label="Civilian panel">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <label className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">Your location · simulated resident</label>
        <select value={home?.id ?? ''} onChange={(e) => setHome(e.target.value)} aria-label="Your location"
          className="mt-1.5 w-full border border-line-strong bg-ink-900 px-2 py-1.5 text-sm text-bone focus:outline-none">
          {placeOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className={cn('shrink-0 border-b-2 px-4 py-4', STAGE_RANK[stage] >= 2 ? 'border-ember' : stage === 'prepare' ? 'border-amber' : 'border-line')}>
        <div className={cn('font-sans text-3xl font-bold tracking-tight', copy.cls)}>{copy.title}</div>
        <p className="mt-2 text-sm leading-5 text-bone-dim">{copy.body}</p>
        <div className="mt-3 flex gap-6 font-mono">
          <div>
            <div className="text-micro uppercase text-bone-mute">Fire ETA</div>
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
            <p className="mt-2 border border-ember/50 bg-ember/10 px-2 py-1.5 text-xs leading-4 text-bone-dim">
              Do NOT go toward Mati coast — no road exit there.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-bone-mute">Computing route…</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2" aria-label="Official alerts">
        <div className="font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">Official alerts · simulated</div>
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
    </aside>
  );
}
