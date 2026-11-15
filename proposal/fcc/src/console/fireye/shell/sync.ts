import { useLayoutEffect, useMemo } from 'react';
import type { Feed } from '../../contracts';
import { useConsoleSelector } from '../../store';
import { stageWorld } from '../../stage3d/world';
import { contextFor } from '../../world/engine';
import { buildChronicle, type Chronicle } from '../data/chronicle';
import { useFireye } from './ui';

const UAV = new Set<Feed['kind']>(['uav-nadir', 'uav-oblique', 'uav-chase']);
export const isUav = (f: Feed) => UAV.has(f.kind);
export const isReconFeed = (f: Feed) => isUav(f) || f.kind === 'ridge-cam';

/** Display palette only. Source modality comes from Feed.modality, never this helper. */
export const sensorOf = (f: Feed): 'eo' | 'thermal' => (f.fx.startsWith('ir') ? 'thermal' : 'eo');

/** Applies display-only palettes without changing source channel identity or its label. */
export function withFx(feeds: Feed[], fx: Record<string, 'eo' | 'thermal'>): Feed[] {
  if (!Object.keys(fx).length) return feeds;
  return feeds.map((f) => {
    const want = fx[f.id];
    if (!want || !isUav(f) || sensorOf(f) === want) return f;
    const next: Feed['fx'] = want === 'thermal' ? 'ir-whitehot' : 'eo';
    return { ...f, fx: next };
  });
}

/** FIREYE's mirror of the store into the stage world (replaces `useStageSync`, adds feed fx overrides). */
export function useFireyeSync() {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => s.clock.t);
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const units = useConsoleSelector((s) => s.units);
  const findings = useConsoleSelector((s) => s.findings);
  const rawFeeds = useConsoleSelector((s) => s.feeds);
  const projection = useConsoleSelector((s) => s.projection);
  const items = useConsoleSelector((s) => s.items);
  const actions = useConsoleSelector((s) => s.actions);
  const coverage = useConsoleSelector((s) => s.coverage);
  const stage = useConsoleSelector((s) => s.stage);
  const directives = useConsoleSelector((s) => s.directives);
  const fireRev = useConsoleSelector((s) => s.fireRev);
  const recon = useConsoleSelector(s => !!s.recon);
  const fx = useFireye((s) => s.fx);
  const feeds = useMemo(() => withFx(recon ? rawFeeds.filter(isReconFeed) : rawFeeds, fx), [rawFeeds, fx, recon]);
  const drones = useMemo(() => recon ? units.filter(u => u.kind === 'drone').map(u => ({ ...u, trail: [], route: undefined })) : units, [units, recon]);
  useLayoutEffect(() => {
    stageWorld.set({ dataMode: 'replay', pack, t, paused, speed, units: drones, findings, feeds, projection, items, actions, coverage, stage, directives, fireRev });
  }, [pack, t, paused, speed, drones, findings, feeds, projection, items, actions, coverage, stage, directives, fireRev]);
}

const windows = { recon: new WeakMap<object, Chronicle>(), legacy: new WeakMap<object, Chronicle>() };
/** The deterministic chronicle for the loaded pack (FIREYE window: scenario start to manifest end). */
export function useChronicle(): Chronicle | null {
  const pack = useConsoleSelector((s) => s.pack);
  const recon = useConsoleSelector(s => !!s.recon);
  return useMemo(() => {
    if (!pack) return null;
    const cache = windows[recon ? 'recon' : 'legacy'];
    const hit = cache.get(pack);
    if (hit) return hit;
    const ctx = contextFor(pack);
    const ch = buildChronicle(pack, { start: ctx.start, end: ctx.end }, recon ? 'recon' : 'legacy');
    cache.set(pack, ch);
    return ch;
  }, [pack, recon]);
}
