import type { IconName } from '@ds';
import type { ConsoleState } from '../../contracts';

export interface BootProbe {
  pack: ConsoleState['pack'];
  ready: boolean;
  drones: number;
  sensors: number;
  chronicle: number;
  feeds: number;
  globe: boolean;
  painted?: boolean;
  warm?: boolean;
}

interface Step { id: string; icon: IconName; label: string; done: (p: BootProbe) => boolean }

/** Environment on the left, collection/analysis sources on the right. No fictional progress. */
export const BOOT_STEPS: Step[] = [
  { id: 'terrain', icon: 'map', label: 'Terrain', done: p => !!p.pack?.elevation.length },
  { id: 'fuel', icon: 'tree', label: 'Fuel model', done: p => !!p.pack?.fuel.length },
  { id: 'osm', icon: 'route', label: 'Roads and buildings', done: p => !!p.pack?.roads },
  { id: 'weather', icon: 'wind', label: 'Weather', done: p => !!p.pack?.weather.length },
  { id: 'fleet', icon: 'drone', label: 'Drone fleet', done: p => p.drones > 0 },
  { id: 'iot', icon: 'sensor', label: 'Ground sensors', done: p => p.sensors > 0 },
  { id: 'comms', icon: 'radio', label: 'Source intake', done: p => p.chronicle > 0 },
  { id: 'camera', icon: 'camera', label: 'Camera feeds', done: p => p.feeds > 0 },
];

export const BOOT_MOTION = {
  preflight: 1800,
  lineHold: 260, outline: 1400, pupilAppear: 140, pupilLine: 220, pupil: 820, settle: 200,
  flight: 1100, sourceAppear: 100, sourceHold: 100, sourceExit: 260, sourceDelay: 160,
  reveal: 700, zoom: 1800, panels: 1000, graphicsGrace: 9000, delayed: 20000,
} as const;
export const BOOT_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function bootEnabled(search: string) {
  return new URLSearchParams(search).get('boot') !== '0';
}

export function bootReady(p: BootProbe, elapsed: number, skipGraphics = false): boolean {
  if (!p.ready || !p.pack?.arrival.length || !BOOT_STEPS.every(s => s.done(p))) return false;
  return skipGraphics || elapsed >= BOOT_MOTION.graphicsGrace
    || (p.globe && (p.painted ?? p.globe) && (p.warm ?? p.globe));
}

export function sourceLayout(width: number, height: number, index: number) {
  const side = index < 4 ? -1 : 1, row = index % 4;
  return {
    x: side * Math.min(460, width * 0.29),
    y: (row - 1.5) * Math.max(0, Math.min(128, (height - 144) / 4)),
    size: Math.max(72, Math.min(96, width * 0.14, height * 0.14)),
    delay: BOOT_MOTION.sourceDelay + index * (BOOT_MOTION.sourceAppear + BOOT_MOTION.sourceHold + BOOT_MOTION.sourceExit),
  };
}

/** One linear timeline makes the stationary hold exact, without JS timer/frame scheduling gaps. */
export function sourceFrames(width: number, height: number, index: number): Keyframe[] {
  const { x, y } = sourceLayout(width, height, index), center = 'translate(-50%, -50%)';
  const duration = BOOT_MOTION.sourceAppear + BOOT_MOTION.sourceHold + BOOT_MOTION.sourceExit;
  return [
    { offset: 0, opacity: 0, transform: `${center} scale(0.88)`, easing: BOOT_EASE },
    { offset: BOOT_MOTION.sourceAppear / duration, opacity: 1, transform: `${center} scale(1)`, easing: 'linear' },
    { offset: (BOOT_MOTION.sourceAppear + BOOT_MOTION.sourceHold) / duration, opacity: 1, transform: `${center} scale(1)`, easing: BOOT_EASE },
    { offset: 1, opacity: 0, transform: `${center} translate(${x}px, ${y}px)` },
  ];
}

export const BOOT_RANGE_FACTOR = 1.35;

/** A fixed target, no yaw/orbit, and zero velocity/acceleration at both ends. */
export function globePose(progress: number, homeRangeM: number) {
  const t = Math.max(0, Math.min(1, progress)), k = t * t * t * (10 + t * (-15 + 6 * t));
  return {
    rangeM: t === 1 ? homeRangeM : homeRangeM * Math.exp(Math.log(BOOT_RANGE_FACTOR) * (1 - k)),
    headingDeg: 18,
    pitchDeg: -40,
  };
}

/** A delayed frame or background tab must not teleport the camera forward. */
export function advanceGlobe(progress: number, deltaMs: number, hidden: boolean) {
  return Math.min(1, progress + (hidden ? 0 : Math.max(0, Math.min(40, deltaMs))) / BOOT_MOTION.zoom);
}

/** Measured destination, not a guessed header offset. The hero is anchored at viewport center. */
export function handoffTransform(width: number, height: number, heroSize: number,
  target: { left: number; top: number; width: number; height: number }) {
  return `translate(-50%, -50%) translate(${target.left + target.width / 2 - width / 2}px, ${target.top + target.height / 2 - height / 2}px) scale(${target.width / heroSize})`;
}
