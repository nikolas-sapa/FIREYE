import { Cartesian3, HeadingPitchRange, Matrix4 } from 'cesium';
import type { ScenarioPack } from '../../contracts';
import { cameraOps } from '../../stage3d/camera-ops';
import { getProfile } from '../../stage3d/profile';
import { getSampler } from '../../stage3d/sampler';
import type { StageEngine } from '../../stage3d/StageEngine';
import { advanceGlobe, BOOT_MOTION, globePose } from './sequence';

/** One camera owner for the entire reveal. No competing Cesium flight, orbit, resize or FOV tween. */
export function prepareBootGlobe(engine: StageEngine, pack: ScenarioPack, signal: AbortSignal) {
  engine.homeView(0);
  const saved = cameraOps.save(engine), { viewer } = engine, { camera, scene } = viewer;
  const profile = getProfile(pack), { center } = profile;
  const target = Cartesian3.fromDegrees(center.lon, center.lat, getSampler(pack).elevation(center.lon, center.lat) * profile.exaggeration);
  const controller = scene.screenSpaceCameraController;
  const previous = { inputs: controller.enableInputs, collision: controller.enableCollisionDetection };
  const sources = Array.from({ length: viewer.dataSources.length }, (_, i) => {
    const source = viewer.dataSources.get(i);
    return { source, show: source.show };
  });
  const offSources = scene.preRender.addEventListener(() => { sources.forEach(({ source }) => { source.show = false; }); });
  controller.enableInputs = false; controller.enableCollisionDetection = false;
  camera.cancelFlight();
  let done = false, offReady = () => {}, offFrame = () => {}, settle = () => {};
  const draw = (progress: number) => {
    const pose = globePose(progress, profile.homeRangeM);
    camera.lookAt(target, new HeadingPitchRange(pose.headingDeg * Math.PI / 180, pose.pitchDeg * Math.PI / 180, pose.rangeM));
    camera.lookAtTransform(Matrix4.IDENTITY);
    scene.requestRender();
  };
  let readyDone = () => {};
  const ready = new Promise<void>(resolve => { readyDone = resolve; });
  const readyTimer = window.setTimeout(() => { offReady(); readyDone(); }, 1500);
  let frames = 0;
  offReady = scene.postRender.addEventListener(() => {
    if (++frames < 2 || !scene.globe.tilesLoaded) return;
    window.clearTimeout(readyTimer); offReady(); readyDone();
  });
  let watchdog = 0;
  const cancel = () => {
    if (done) return;
    done = true; offReady(); offFrame(); offSources(); window.clearTimeout(readyTimer); window.clearTimeout(watchdog);
    signal.removeEventListener('abort', cancel);
    if (!viewer.isDestroyed()) {
      sources.forEach(({ source, show }) => { source.show = show; });
      camera.lookAtTransform(Matrix4.IDENTITY);
      camera.setView({ destination: saved.position, orientation: { heading: saved.heading, pitch: saved.pitch, roll: saved.roll } });
      controller.enableInputs = previous.inputs; controller.enableCollisionDetection = previous.collision;
      scene.requestRender();
    }
    readyDone(); settle();
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel(); else draw(0);
  return {
    ready,
    cancel,
    run: () => new Promise<void>(resolve => {
      if (done || signal.aborted) { resolve(); return; }
      settle = resolve;
      let last = performance.now(), progress = 0;
      offFrame = scene.preUpdate.addEventListener(() => {
        const now = performance.now();
        progress = advanceGlobe(progress, now - last, document.hidden); last = now;
        draw(progress);
        if (progress >= 1) cancel();
      });
      // A failed render loop must not leave the dashboard inaccessible indefinitely.
      watchdog = window.setTimeout(cancel, BOOT_MOTION.zoom * 4);
      scene.requestRender();
    }),
  };
}
