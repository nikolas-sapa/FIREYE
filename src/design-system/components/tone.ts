import type { Tone } from '../tokens';

/* Static class maps so Tailwind's scanner sees every tone class literally. */
export const toneText: Record<Tone, string> = {
  neutral: 'text-bone-dim', signal: 'text-signal', danger: 'text-ember', warning: 'text-amber',
  nominal: 'text-phosphor', telemetry: 'text-ice', detection: 'text-violet',
};
export const toneSolid: Record<Tone, string> = {
  neutral: 'bg-ink-300', signal: 'bg-signal', danger: 'bg-ember', warning: 'bg-amber',
  nominal: 'bg-phosphor', telemetry: 'bg-ice', detection: 'bg-violet',
};
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-ink-800', signal: 'bg-signal/10', danger: 'bg-ember/10', warning: 'bg-amber/10',
  nominal: 'bg-phosphor/10', telemetry: 'bg-ice/10', detection: 'bg-violet/10',
};
export const toneBorder: Record<Tone, string> = {
  neutral: 'border-line-strong', signal: 'border-signal/60', danger: 'border-ember/60', warning: 'border-amber/60',
  nominal: 'border-phosphor/50', telemetry: 'border-ice/50', detection: 'border-violet/50',
};
export const toneBorderL: Record<Tone, string> = {
  neutral: 'border-l-ink-300', signal: 'border-l-signal', danger: 'border-l-ember', warning: 'border-l-amber',
  nominal: 'border-l-phosphor', telemetry: 'border-l-ice', detection: 'border-l-violet',
};

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Polar point, angle in degrees clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
