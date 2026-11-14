import * as Cesium from 'cesium';
import type { Feed, Geo, Unit } from '../../contracts';
import { RasterSampler, bearingDeg, destination, DEG2RAD } from '../raster';
import type { StageSnapshot } from '../types';
import { unitHeading, unitPos } from '../world';

export interface FeedPose {
  position: Cesium.Cartesian3;
  heading: number; // rad
  pitch: number; // rad
  roll: number; // rad
  fovDeg: number;
  /** HUD telemetry. */
  geo: Geo;
  altAglM: number;
  headingDeg: number;
  unit?: Unit;
}

const n1 = (t: number, f: number, p = 0) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.31 + p * 1.7) * 0.4;

/** Camera pose for a feed at wall-clock `nowS` (seconds) — pan/orbit/shake run in real time. */
export function feedPose(feed: Feed, w: Readonly<StageSnapshot>, s: RasterSampler, exag: number, nowS: number, groundAt?: (g: Geo) => number | undefined): FeedPose {
  const unit = feed.unitId ? w.units.find((u) => u.id === feed.unitId) : undefined;
  const pose = feed.pose ?? { mode: 'fixed' };
  const ground = (g: Geo) => {
    const a = s.elevation(g.lon, g.lat) * exag;
    const b = groundAt?.(g);
    return b !== undefined && Number.isFinite(b) ? Math.max(a, b) : a;
  };
  const b = s.bbox;
  const centre: Geo = w.pack?.manifest.center ?? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
  const base: Geo = unit ? unitPos(unit) : pose.pos ?? pose.target ?? centre;
  const hdgU = unit ? unitHeading(unit) : pose.headingDeg ?? 0;
  const firstFinding = feed.findingIds.length ? w.findings.find((f) => f.id === feed.findingIds[0]) : undefined;
  const fov = pose.fovDeg;

  const at = (g: Geo, agl: number, hdgDeg: number, pitchDeg: number, rollDeg: number, fovDeg: number): FeedPose => {
    const gh = ground(g);
    return {
      position: Cesium.Cartesian3.fromDegrees(g.lon, g.lat, gh + agl),
      heading: hdgDeg * DEG2RAD,
      pitch: pitchDeg * DEG2RAD,
      roll: rollDeg * DEG2RAD,
      fovDeg,
      geo: g,
      altAglM: agl,
      headingDeg: ((hdgDeg % 360) + 360) % 360,
      unit,
    };
  };

  /** Camera on a sphere around `target` looking at it. */
  const orbit = (target: Geo, rangeM: number, hdgDeg: number, pitchDeg: number, fovDeg: number): FeedPose => {
    const horiz = rangeM * Math.cos(pitchDeg * DEG2RAD);
    const up = -rangeM * Math.sin(pitchDeg * DEG2RAD);
    const camGeo = destination(target, hdgDeg + 180, horiz);
    const tH = ground(target);
    const cH = Math.max(tH + up, ground(camGeo) + 30);
    const pitch = -Math.atan2(cH - tH, horiz) / DEG2RAD;
    return {
      position: Cesium.Cartesian3.fromDegrees(camGeo.lon, camGeo.lat, cH),
      heading: hdgDeg * DEG2RAD,
      pitch: pitch * DEG2RAD,
      roll: 0,
      fovDeg,
      geo: camGeo,
      altAglM: cH - ground(camGeo),
      headingDeg: ((hdgDeg % 360) + 360) % 360,
      unit,
    };
  };

  switch (feed.kind) {
    case 'uav-nadir': {
      const alt = Math.min(400, Math.max(150, base.alt ?? 220));
      // Stabilised gimbal: no vibration, only a slow residual drift of a few tenths of a degree.
      return at(base, alt, hdgU + n1(nowS, 0.05) * 0.8, -89.6 + n1(nowS, 0.07, 1) * 0.3, n1(nowS, 0.06, 2) * 0.2, fov ?? 42);
    }
    case 'uav-oblique': {
      const target = pose.target ?? firstFinding?.pos ?? (unit ? destination(base, hdgU, 450) : base);
      const range = pose.rangeM ?? 650;
      const h = (pose.headingDeg ?? (unit ? bearingDeg(base, target) : 0)) + nowS * 4;
      const o = orbit(target, range, h, pose.pitchDeg ?? -38, fov ?? 34);
      o.heading += n1(nowS, 0.06) * 0.35 * DEG2RAD;
      o.pitch += n1(nowS, 0.08, 1) * 0.25 * DEG2RAD;
      return o;
    }
    case 'uav-chase': {
      const back = destination(base, hdgU + 180, 140);
      const alt = Math.max(50, (base.alt ?? 120) + 45);
      return at(back, alt, hdgU + n1(nowS, 0.3) * 2, -16 + n1(nowS, 0.4, 1) * 1.2, n1(nowS, 0.5, 2) * 2, fov ?? 60);
    }
    case 'dash-cam': {
      const vib = n1(nowS, 13, 0) * 0.12;
      return at(base, 2.2, hdgU + n1(nowS, 0.7) * 0.6, -3 + vib, vib * 0.6, fov ?? 74);
    }
    case 'helmet-cam': {
      const sway = n1(nowS, 1.1) * 4;
      const bob = n1(nowS, 2.3, 1) * 1.6;
      return at(base, 1.7, hdgU + sway, -9 + bob, n1(nowS, 1.7, 2) * 2.5, fov ?? 82);
    }
    case 'ridge-cam': {
      // Full 360° pan every 4 min that dwells (zero angular speed) on the configured heading.
      const p = pose.pos ?? base;
      const ph = (nowS / 240) % 1;
      const pan = (pose.headingDeg ?? 0) + 360 * (ph - Math.sin(2 * Math.PI * ph) / (2 * Math.PI));
      return at(p, 18, pan, pose.pitchDeg ?? -4, 0, fov ?? 52);
    }
    case 'satellite': {
      const c = pose.target ?? pose.pos ?? centre;
      const f = fov ?? 38;
      const footprint = pose.rangeM ?? 36000;
      const alt = footprint / 2 / Math.tan((f / 2) * DEG2RAD);
      return at({ lon: c.lon, lat: c.lat }, alt, 0, -89.9, 0, f);
    }
    case 'social':
    default: {
      const p = pose.pos ?? firstFinding?.pos ?? base;
      let hdg = pose.headingDeg;
      if (hdg === undefined) {
        const hot = w.findings.find((f) => f.kind === 'spot' || f.kind === 'smoke');
        hdg = hot ? bearingDeg(p, hot.pos) : 45;
      }
      // Handheld: slow sway from the arms plus faster tremor; portrait phones are held slightly tilted.
      const shake = n1(nowS, 0.6) * 2.2 + n1(nowS, 7.3, 1) * 0.35;
      const tilt = n1(nowS, 0.45, 2) * 2.5 + n1(nowS, 6.1, 3) * 0.4;
      return at(p, 1.6, hdg + shake, 4 + n1(nowS, 0.8, 1) * 1.6 + n1(nowS, 8.7, 4) * 0.3, tilt, fov ?? 64);
    }
  }
}
