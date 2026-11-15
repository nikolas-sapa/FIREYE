import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { color } from '../src/design-system/tokens';
import { FuelClass, type ScenarioPack } from '../src/console/contracts';
import { RasterSampler } from '../src/console/stage3d/raster';
import { createDetailLayer } from '../src/console/stage3d/terrain';
import { DEMO_FEEDS, demoPose, PresentationBudget, PresentationCadence, PresentationClock, sensorWorld } from '../src/console/monitoring/feed-motion';
import { detailPixels } from '../src/console/monitoring/feed-detail-worker';

export async function checkMonitoringFeeds(pack: ScenarioPack) {
  for (const fps of [15, 20, 30]) for (const refresh of [60, 90, 120, 144]) {
    const cadence = new PresentationCadence();
    let frames = 0;
    for (let i = 0; i < refresh * 60; i++) if (cadence.due(i * 1000 / refresh, fps)) frames++;
    assert.ok(Math.abs(frames - fps * 60) <= 1, `No display-rate aliasing: ${refresh} Hz / ${fps} fps = ${frames}`);
  }
  const cadence = new PresentationCadence();
  assert.equal(cadence.due(0, 30), true); assert.equal(cadence.due(0, 30), false);
  assert.equal(cadence.due(90000, 30), true); assert.equal(cadence.due(90000, 30), false, 'no catch-up burst after a hidden tab');
  const budget = new PresentationBudget();
  assert.equal(budget.rate(0, 5, 6), 30);
  assert.equal(budget.rate(600, 5, 6), 20, 'sustained overload lowers the wall cadence once');
  for (let t = 700; t < 5000; t += 100) assert.equal(budget.rate(t, t % 200 ? 4 : 3.4, 6), 20, 'load near the threshold cannot oscillate FPS');
  assert.equal(budget.rate(5000, 2, 6), 20);
  assert.equal(budget.rate(7500, 2, 6), 30, 'sustained headroom restores full cadence');
  assert.equal(budget.rate(8000, 2, 3), 30, 'a smaller visible set gets its own frame budget');
  const clock = new PresentationClock();
  assert.equal(clock.tick(100, true), 0);
  assert.equal(clock.tick(200, true), 0.1);
  assert.equal(clock.tick(300, false), 0.1);
  assert.equal(clock.tick(400, true), 0.2);
  clock.suspend(90000);
  assert.equal(clock.tick(90000, true), 0.2, 'no camera teleport after backgrounding');
  assert.ok(Math.abs(clock.tick(90016, true) - 0.216) < 1e-9);
  assert.ok(Math.abs(clock.tick(95000, true) - 0.316) < 1e-9, 'bounded motion after a long blocked frame');

  const sampler = new RasterSampler(pack), world = sensorWorld(pack);
  assert.equal(world.dataMode, 'monitoring'); assert.equal(world.units.length, 0); assert.equal(world.findings.length, 0);
  assert.equal(DEMO_FEEDS.length, 6);
  for (const feed of DEMO_FEEDS) {
    assert.equal(feed.live, false); assert.deepEqual(feed.findingIds, []);
    let previous = demoPose(feed, world, sampler, 0);
    for (let i = 1; i <= 900; i++) {
      const pose = demoPose(feed, world, sampler, i / 30);
      assert.ok(sampler.inside(pose.geo.lon, pose.geo.lat), `${feed.id} stays within real DEM coverage`);
      assert.ok(Cesium.Cartesian3.distance(previous.position, pose.position) < 1, `${feed.id}: no metre-scale frame jumps at 30 fps`);
      assert.ok(Number.isFinite(pose.pitch) && Number.isFinite(pose.heading));
      if (feed.id === 'demo-trail' || feed.id === 'demo-road') {
        assert.deepEqual(pose.position, previous.position); assert.equal(pose.heading, previous.heading);
        assert.equal(pose.pitch, previous.pitch); assert.equal(pose.roll, 0);
      }
      if (feed.id === 'demo-ridge') {
        assert.ok(pose.headingDeg >= 93 && pose.headingDeg <= 117);
        assert.ok(Math.abs(pose.headingDeg - previous.headingDeg) < 0.029);
      }
      previous = pose;
    }
  }

  // Compare directly with the untouched legacy pixel generator, not another implementation of our assumptions.
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const canvas = { width: 0, height: 0, pixels: new Uint8ClampedArray(256 * 256 * 4),
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray<ArrayBuffer> }) => { canvas.pixels = image.data; } }) };
    return canvas;
  } } });
  try {
    const scheme = new Cesium.GeographicTilingScheme(), level = 15, deg = Math.PI / 180;
    const tile = scheme.positionToTileXY(Cesium.Cartographic.fromDegrees(pack.manifest.center.lon, pack.manifest.center.lat), level)!;
    const rectangle = scheme.tileXYToRectangle(tile.x, tile.y, level);
    const bbox = [rectangle.west / deg, rectangle.south / deg, rectangle.east / deg, rectangle.north / deg] as const;
    const rgb = (hex: string) => { const c = Cesium.Color.fromCssColorString(hex); return [c.red * 255, c.green * 255, c.blue * 255]; };
    for (const fuel of Object.values(FuelClass).filter((f): f is number => typeof f === 'number')) {
      const fixture = { ...pack, fuel: new Uint8Array(pack.fuel.length).fill(fuel) };
      const layer = createDetailLayer(fixture, new RasterSampler(fixture));
      const old = await layer.imageryProvider.requestImage(tile.x, tile.y, level) as unknown as { pixels: Uint8ClampedArray };
      const current = detailPixels({ fuel: fixture.fuel, width: pack.raster.w, height: pack.raster.h,
        bbox: pack.raster.bbox, ink: rgb(color.void), bone: rgb(color.bone.DEFAULT) },
      { id: 'fixture', bbox: [...bbox], level });
      const mismatch = current.findIndex((value, i) => value !== old.pixels[i]);
      assert.equal(mismatch, -1, `Worker must preserve exact legacy detail pixels, fuel ${fuel}, first mismatch ${mismatch}`);
      layer.destroy();
    }
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
  console.log('Monitoring feeds: phase-locked cadence, pause/background clocks, six bounded camera paths, stable ground mounts and pixel-identical worker detail PASS');
}
