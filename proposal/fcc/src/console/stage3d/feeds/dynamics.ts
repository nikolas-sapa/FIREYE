import { angleDelta } from '../motion';

export const FULL_FEED_INTERVAL_MS = 1000 / 30;

/** Keep image and normalized detection coordinates in the same uncropped 16:9 viewport. */
export function fitFeedFrame(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / 16, height / 9));
  const w = scale * 16, h = scale * 9;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

/** Phase-locked deadlines, not now+interval (which aliases 24 Hz down to 20 Hz on a 60 Hz display). */
export class FeedCadence {
  private next = 0;
  reset() { this.next = 0; }
  due(now: number) {
    if (now + 0.75 < this.next) return false;
    this.next = Math.max(this.next + FULL_FEED_INTERVAL_MS, now + FULL_FEED_INTERVAL_MS - 0.75);
    return true;
  }
  slack(now: number) { return this.next - now; }
}

interface Lens { heading: number; pitch: number; roll: number; fovDeg: number }
/** Independent gimbal state per feed: switching thumbnails must not blend unrelated cameras. */
export class CameraFilter {
  private last = NaN;
  private lens: Lens | null = null;
  update<T extends Lens>(pose: T, now: number): T {
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    if (!this.lens || !Number.isFinite(this.last) || now - this.last > 1500) {
      this.lens = { heading: pose.heading, pitch: pose.pitch, roll: pose.roll, fovDeg: pose.fovDeg };
    } else {
      const k = 1 - Math.exp(-dt / 0.16), deg = Math.PI / 180;
      for (const key of ['heading', 'pitch', 'roll', 'fovDeg'] as const) {
        const delta = key === 'heading' || key === 'roll'
          ? angleDelta(this.lens[key] / deg, pose[key] / deg) * deg : pose[key] - this.lens[key];
        const limit = (key === 'heading' ? 120 * deg : key === 'fovDeg' ? 35 : 60 * deg) * dt;
        this.lens[key] += Math.max(-limit, Math.min(limit, delta * k));
      }
    }
    this.last = now;
    return { ...pose, ...this.lens };
  }
}
