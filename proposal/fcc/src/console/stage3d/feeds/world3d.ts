import type { Feed, ScenarioPack } from '../../contracts';
import { clc2018 } from '../../scenario/load';
import type { EnvInput } from '../../world3d/env';
import type { WorldRenderer } from '../../world3d/render/WorldRenderer';
import type { DemoFeed } from '../../monitoring/feed-motion';
import { modelFor } from '../fx';
import { weatherAt, DEG2RAD } from '../raster';
import { getSampler } from '../sampler';
import { stageWorld } from '../world';
import type { CameraFilter } from './dynamics';
import { feedPose, type FeedPose } from './poses';

/**
 * FIREYE feeds render the procedural World3D scene (three.js, loaded on demand) with the reconstructed fire
 * at stage time. Satellite feeds, packs without land cover, `?feeds=cesium` and WebGL failures use the Cesium FeedRenderer.
 */
let current: { pack: ScenarioPack; promise: Promise<WorldRenderer | null> } | null = null;
let failed = false;
let enabled = false;

/** Opt-in per app: legacy replay keeps the Cesium feeds. */
export function enableWorld3dFeeds() { enabled = true; }

export function world3dEligible(feed: Feed | undefined, pack: ScenarioPack | null | undefined): boolean {
  if (!enabled || !feed || !pack || failed || feed.kind === 'satellite') return false;
  if (new URLSearchParams(location.search).get('feeds') === 'cesium') return false;
  return !!clc2018(pack) && !!pack.arrival?.length;
}

export function markWorld3dFailed() { failed = true; }

function envFor(pack: ScenarioPack, t: number): EnvInput {
  const w = weatherAt(pack, t);
  return { view: 'fireye', timeMs: t, live: false, lat: pack.manifest.center.lat, lon: pack.manifest.center.lon,
    weather: { tempC: w.tempC, rh: w.rh, windKph: w.windKph, windFromDeg: w.windDirDeg, gustKph: w.gustKph, precipMm: null, source: 'Scenario pack weather (reanalysis)' } };
}

export function getWorld3D(pack: ScenarioPack): Promise<WorldRenderer | null> {
  if (failed) return Promise.resolve(null);
  if (current?.pack === pack) return current.promise;
  const old = current;
  void old?.promise.then(w => w?.destroy());
  const promise = import('../../world3d/render/WorldRenderer').then(({ WorldRenderer }) => {
    const start = pack.manifest.start;
    let t = stageWorld.get().t, envT = t;
    const w = new WorldRenderer(pack, clc2018(pack), envFor(pack, t), { fire: true });
    w.setFireTime(t - start);
    const unsub = stageWorld.subscribe(() => {
      const s = stageWorld.get();
      if (s.pack !== pack || s.t === t) return;
      t = s.t;
      w.setFireTime(t - start);
      // Env follows the stage clock in coarse steps; between steps it advances in real time.
      if (Math.abs(t - envT) > 120_000) { envT = t; w.setEnv(envFor(pack, t)); }
    });
    const destroy = w.destroy.bind(w);
    w.destroy = () => { unsub(); destroy(); };
    if (import.meta.env.DEV) (window as unknown as { __fccWorld?: WorldRenderer }).__fccWorld = w;
    return w;
  }).catch((e) => { console.warn('[stage3d] World3D feeds unavailable; using Cesium feeds', e); failed = true; return null; });
  current = { pack, promise };
  return promise;
}

/** Camera pose of a FIREYE feed at presentation time `seconds`, following its carrying unit in stage time. */
export function fireyePose(feedId: string, fallback: Feed, pack: ScenarioPack) {
  return (seconds: number, filter: CameraFilter): FeedPose => {
    const w = stageWorld.get();
    const feed = w.feeds.find(f => f.id === feedId) ?? fallback;
    const now = performance.now();
    const pose = filter.update(feedPose(feed, w, getSampler(pack), 1, seconds, undefined, now), now);
    pose.headingDeg = (pose.heading / DEG2RAD % 360 + 360) % 360;
    return pose;
  };
}

export function thermalOf(feed: Feed): 'white' | 'iron' | undefined {
  const m = modelFor(feed);
  return m === 'ir-white' ? 'white' : m === 'ir-iron' ? 'iron' : undefined;
}

export const asDemoFeed = (feed: Feed): DemoFeed => ({ ...feed, description: feed.label });
