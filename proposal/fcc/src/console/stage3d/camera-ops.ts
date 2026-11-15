import * as Cesium from 'cesium';
import type { Feed, Geo } from '../contracts';
import { easeServo, prefersReducedMotion } from './easing';
import { feedPose } from './feeds/poses';
import { DEG2RAD } from './raster';
import { getSampler } from './sampler';
import type { StageEngine } from './StageEngine';
import { stageWorld } from './world';

export interface SavedView { position: Cesium.Cartesian3; heading: number; pitch: number; roll: number; fovy: number }

function centerTarget(engine: StageEngine): Cesium.Cartesian3 | null {
  const scene = engine.viewer.scene;
  // The optical axis stays in the clear map window when panels cover an asymmetric frustum.
  const ray = new Cesium.Ray(scene.camera.positionWC, scene.camera.directionWC);
  return scene.globe.pick(ray, scene) ?? null;
}

function orbitAround(engine: StageEngine, target: Cesium.Cartesian3, headingRad: number, pitchRad: number, range: number, duration = 0) {
  const cam = engine.viewer.camera;
  cam.cancelFlight();
  if (duration > 0 && !prefersReducedMotion()) {
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(headingRad, pitchRad, range), duration, easingFunction: easeServo,
    });
  } else {
    cam.lookAt(target, new Cesium.HeadingPitchRange(headingRad, pitchRad, range));
    cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
  engine.viewer.scene.requestRender();
}

/** Camera operations for the FIREYE camera cluster. All of them pivot around the view centre on the ground. */
export const cameraOps = {
  zoom(engine: StageEngine, dir: 1 | -1) {
    const cam = engine.viewer.camera;
    const target = centerTarget(engine);
    const range = target ? Cesium.Cartesian3.distance(cam.positionWC, target) : cam.positionCartographic.height;
    const next = Math.max(120, range * (dir > 0 ? 0.62 : 1.6));
    if (!target) { if (dir > 0) cam.zoomIn(range - next); else cam.zoomOut(next - range); return; }
    orbitAround(engine, target, cam.heading, cam.pitch, next, 0.45);
  },
  /** Tilt in degrees from straight down: 0 = top-down, 80 = near horizon. */
  setTilt(engine: StageEngine, tiltDeg: number, duration = 0) {
    const cam = engine.viewer.camera;
    const target = centerTarget(engine);
    if (!target) return;
    const range = Cesium.Cartesian3.distance(cam.positionWC, target);
    orbitAround(engine, target, cam.heading, (-90 + Math.max(0, Math.min(80, tiltDeg))) * DEG2RAD, range, duration);
  },
  setHeading(engine: StageEngine, headingDeg: number, duration = 0) {
    const cam = engine.viewer.camera;
    const target = centerTarget(engine);
    if (!target) { cam.setView({ orientation: { heading: headingDeg * DEG2RAD, pitch: cam.pitch, roll: 0 } }); return; }
    const range = Cesium.Cartesian3.distance(cam.positionWC, target);
    orbitAround(engine, target, headingDeg * DEG2RAD, cam.pitch, range, duration);
  },
  northUp(engine: StageEngine) { cameraOps.setHeading(engine, 0, 0.6); },
  home(engine: StageEngine) { engine.homeView(1.6); },
  /** Toggles a top-down 2D-style view and back to the default oblique. */
  toggle2D(engine: StageEngine): boolean {
    const top = engine.viewer.camera.pitch < -80 * DEG2RAD;
    cameraOps.setTilt(engine, top ? 50 : 0, 0.8);
    return !top;
  },
  tiltDeg(engine: StageEngine) { return 90 + engine.viewer.camera.pitch / DEG2RAD; },
  headingDeg(engine: StageEngine) { return ((engine.viewer.camera.heading / DEG2RAD) % 360 + 360) % 360; },

  /** Slow orbit around a geo point (or the view centre). Returns a stop function; any drag stops it too. */
  orbit(engine: StageEngine, around?: Geo | null): () => void {
    const cam = engine.viewer.camera;
    const scene = engine.viewer.scene;
    let target = centerTarget(engine);
    if (around) target = Cesium.Cartesian3.fromDegrees(around.lon, around.lat, getSampler(stageWorld.get().pack!).elevation(around.lon, around.lat));
    if (!target) return () => undefined;
    const t = target;
    const range = Cesium.Cartesian3.distance(cam.positionWC, t);
    let heading = cam.heading;
    const pitch = Math.min(-15 * DEG2RAD, cam.pitch);
    let stopped = false;
    const reduced = prefersReducedMotion();
    const off = engine.onFrame(() => {
      if (stopped) return;
      heading += (reduced ? 0 : 0.0016);
      cam.lookAt(t, new Cesium.HeadingPitchRange(heading, pitch, range));
      scene.requestRender();
    });
    const canvas = scene.canvas;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      off();
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      canvas.removeEventListener('pointerdown', stop);
      canvas.removeEventListener('wheel', stop);
    };
    canvas.addEventListener('pointerdown', stop);
    canvas.addEventListener('wheel', stop, { passive: true });
    return stop;
  },

  save(engine: StageEngine): SavedView {
    const cam = engine.viewer.camera;
    const f = cam.frustum as Cesium.PerspectiveFrustum;
    return { position: Cesium.Cartesian3.clone(cam.positionWC), heading: cam.heading, pitch: cam.pitch, roll: cam.roll, fovy: f.fov ?? 1 };
  },

  /**
   * Flies the main camera from its current view to the feed's sensor pose (position, heading, pitch
   * and field of view) on an eased curve. Resolves when the camera arrives.
   */
  diveTo(engine: StageEngine, feed: Feed, durationS = 1.8): Promise<void> {
    const w = stageWorld.get();
    if (!w.pack) return Promise.resolve();
    const lead = prefersReducedMotion() ? 0 : durationS;
    // Aim where the aircraft will be on arrival, not where it is now.
    const pose = feedPose(feed, w, getSampler(w.pack), 1, performance.now() / 1000, undefined, performance.now() + lead * 1000);
    return cameraOps.flyToPose(engine, pose.position, pose.heading, pose.pitch, pose.fovDeg * DEG2RAD, lead);
  },

  restore(engine: StageEngine, v: SavedView, durationS = 1.4): Promise<void> {
    return cameraOps.flyToPose(engine, v.position, v.heading, v.pitch, v.fovy, prefersReducedMotion() ? 0 : durationS);
  },

  flyToPose(engine: StageEngine, position: Cesium.Cartesian3, heading: number, pitch: number, fovRad: number, durationS: number): Promise<void> {
    const cam = engine.viewer.camera;
    const frustum = cam.frustum as Cesium.PerspectiveFrustum;
    const fromFov = frustum.fov ?? fovRad;
    cam.cancelFlight();
    return new Promise((resolve) => {
      if (durationS <= 0) {
        cam.setView({ destination: position, orientation: { heading, pitch, roll: 0 } });
        frustum.fov = fovRad;
        engine.viewer.scene.requestRender();
        resolve();
        return;
      }
      const t0 = performance.now();
      const off = engine.onFrame(() => {
        const k = Math.min(1, (performance.now() - t0) / (durationS * 1000));
        frustum.fov = fromFov + (fovRad - fromFov) * easeServo(k);
      });
      cam.flyTo({
        destination: position, orientation: { heading, pitch, roll: 0 }, duration: durationS, easingFunction: easeServo,
        // A dive descends; never arc above the starting altitude.
        maximumHeight: Math.max(cam.positionCartographic.height, Cesium.Cartographic.fromCartesian(position).height),
        complete: () => { off(); frustum.fov = fovRad; resolve(); },
        cancel: () => { off(); resolve(); },
      });
    });
  },
};
