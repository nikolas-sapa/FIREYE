import * as Cesium from 'cesium';
import type { Feed, ScenarioPack } from '../contracts';
import { CameraFilter } from '../stage3d/feeds/dynamics';
import { feedPose } from '../stage3d/feeds/poses';
import { destination, RasterSampler, DEG2RAD } from '../stage3d/raster';
import type { StageSnapshot } from '../stage3d/types';

export interface DemoFeed extends Feed {
  mountM?: number;
  description: string;
}
const feed = (id: string, label: string, kind: Feed['kind'], pose: Feed['pose'], description: string, mountM?: number): DemoFeed =>
  ({ id, label, kind, pose, description, mountM, fx: 'eo', live: false, relevance: 0, findingIds: [] });

/** Fictional camera placements, all inside the measured Mati terrain. Never third-party webcam locations. */
export const DEMO_FEEDS: DemoFeed[] = [
  feed('demo-uav-01', 'UAV-01 · Coastal patrol', 'uav-nadir',
    { mode: 'orbit', target: { lon: 23.985, lat: 38.043 }, fovDeg: 56 }, 'North-up gimbal · continuous patrol'),
  feed('demo-uav-02', 'UAV-02 · Ridge survey', 'uav-oblique',
    { mode: 'orbit', target: { lon: 23.957, lat: 38.043 }, rangeM: 2400, headingDeg: 65, pitchDeg: -32, fovDeg: 50 }, 'Stabilized oblique orbit'),
  feed('demo-uav-03', 'UAV-03 · Harbour approach', 'uav-chase',
    { mode: 'orbit', target: { lon: 23.987, lat: 38.019 }, pitchDeg: -24, fovDeg: 64 }, 'Forward-looking patrol'),
  feed('demo-ridge', 'CAM-01 · Ridge PTZ', 'ridge-cam',
    { mode: 'fixed', pos: { lon: 23.932, lat: 38.051 }, headingDeg: 105, pitchDeg: -8, fovDeg: 52 }, 'Bounded 90-second PTZ survey', 18),
  feed('demo-trail', 'CAM-02 · Forest trail', 'ridge-cam',
    { mode: 'fixed', pos: { lon: 23.955, lat: 38.047 }, headingDeg: 125, pitchDeg: -6, fovDeg: 70 }, 'Fixed trail camera · no handheld shake', 3),
  feed('demo-road', 'CAM-03 · Roadside', 'dash-cam',
    { mode: 'fixed', pos: { lon: 23.976, lat: 38.036 }, headingDeg: 100, pitchDeg: -4, fovDeg: 74 }, 'Fixed roadside camera · stable mount', 3),
];

/** Phase-locked cadence. Dropped deadlines are skipped, never replayed in a catch-up burst. */
export class PresentationCadence {
  private next = NaN;
  private interval = 0;
  reset() { this.next = NaN; }
  due(now: number, fps: number) {
    const interval = 1000 / fps;
    if (interval !== this.interval) { this.interval = interval; this.next = NaN; }
    if (!Number.isFinite(this.next)) this.next = now;
    if (now + 0.75 < this.next) return false;
    this.next += Math.max(1, Math.floor((now + 0.75 - this.next) / interval) + 1) * interval;
    return true;
  }
}

/** Hysteresis prevents a busy wall from oscillating between frame rates on every camera render. */
export class PresentationBudget {
  private fps = 30;
  private count = 0;
  private direction = 0;
  private since = NaN;
  rate(now: number, perFeedMs: number, count: number) {
    if (count !== this.count) { this.count = count; this.fps = 30; this.since = NaN; this.direction = 0; }
    const cost = perFeedMs * count;
    const direction = (this.fps === 30 && cost > 25) || (this.fps === 20 && cost > 38) ? -1
      : (this.fps === 20 && cost < 18) || (this.fps === 15 && cost < 28) ? 1 : 0;
    if (!direction) { this.since = NaN; this.direction = 0; }
    else if (direction !== this.direction || !Number.isFinite(this.since)) { this.since = now; this.direction = direction; }
    else if (now - this.since >= (direction < 0 ? 600 : 2500)) {
      this.fps = direction < 0 ? this.fps === 30 ? 20 : 15 : this.fps === 15 ? 20 : 30;
      this.since = NaN; this.direction = 0;
    }
    return this.fps;
  }
}

/** Per-feed time, independent of observation dates, replay speed and React update cadence. */
export class PresentationClock {
  seconds = 0;
  private last = NaN;
  suspend(now: number) { this.last = now; }
  tick(now: number, moving: boolean) {
    if (Number.isFinite(this.last) && moving) this.seconds += Math.max(0, Math.min(100, now - this.last)) / 1000;
    this.last = now;
    return this.seconds;
  }
}

export function sensorWorld(pack: ScenarioPack): StageSnapshot {
  return { dataMode: 'monitoring', pack, t: pack.manifest.start, paused: true, speed: 0,
    units: [], findings: [], feeds: [], projection: null, items: [], actions: [], coverage: [],
    stage: { mode: 'globe', dimmed: false, highlight: [] }, directives: [], fireRev: 0 };
}

/** Reuse legacy gimbal/orbit geometry, but never streamed-LOD heights or the old incident runtime. */
export function demoPose(feed: DemoFeed, world: StageSnapshot, sampler: RasterSampler, seconds: number, filter?: CameraFilter) {
  let current: Feed = feed;
  if (feed.kind === 'uav-nadir' || feed.kind === 'uav-chase') {
    const heading = seconds * 0.6 + (feed.kind === 'uav-chase' ? 155 : 20);
    const pos = destination(feed.pose.target!, heading, feed.kind === 'uav-chase' ? 500 : 260);
    pos.alt = feed.kind === 'uav-chase' ? 700 : 950;
    current = { ...feed, pose: { ...feed.pose, pos, headingDeg: heading + 90 } };
  } else if (feed.kind === 'uav-oblique') {
    current = { ...feed, pose: { ...feed.pose, headingDeg: (feed.pose.headingDeg ?? 0) + seconds * 0.5 } };
  }
  let pose = feedPose(current, world, sampler, 1, seconds, undefined, seconds * 1000);
  if (feed.mountM !== undefined) {
    pose.altAglM = feed.mountM;
    pose.position = Cesium.Cartesian3.fromDegrees(pose.geo.lon, pose.geo.lat, sampler.elevation(pose.geo.lon, pose.geo.lat) + feed.mountM);
    // Fixed trail/road mounts do not inherit handheld vibration or dash-cam engine bob.
    if (feed.id !== 'demo-ridge') {
      pose.heading = (feed.pose.headingDeg ?? 0) * DEG2RAD;
      pose.pitch = (feed.pose.pitchDeg ?? -4) * DEG2RAD;
      pose.roll = 0;
    }
  }
  if (filter) pose = filter.update(pose, seconds * 1000);
  pose.headingDeg = ((pose.heading / DEG2RAD) % 360 + 360) % 360;
  return pose;
}
