import { cn } from '../utils';

/** Mark geometry on a 32-unit grid: two lid curves meeting at the canthi, and a diamond pupil. */
export const FIREYE_GEOMETRY = {
  viewBox: '0 0 32 32',
  upperLid: 'M2.5 16C7.5 9.5 11.5 7.5 16 7.5S24.5 9.5 29.5 16',
  lowerLid: 'M2.5 16C7.5 22.5 11.5 24.5 16 24.5S24.5 22.5 29.5 16',
  pupil: 'M16 12 20 16 16 20 12 16Z',
} as const;

export type OrchestratorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'alert';

export interface FireyeMarkProps {
  size?: number;
  className?: string;
  /** Strokes the lids in on mount (CSS; respects reduced motion). */
  draw?: boolean;
  /** Rendered lid stroke in CSS pixels, independent of size. */
  weight?: number;
  title?: string;
  /** Avatar behaviour; omit for the static logo. */
  state?: OrchestratorState;
  /** Directional attention without changing the canonical lid or pupil geometry. */
  look?: 'center' | 'down-left' | 'down-right';
}

/**
 * FIREYE mark: an open eye drawn with two hairline lids around a diamond pupil in the signal
 * accent. The same drawing is the Orchestrator's avatar; `state` animates the lids and pupil.
 */
export function FireyeMark({ size = 24, className, draw = false, weight, title = 'FIREYE', state, look = 'center' }: FireyeMarkProps) {
  const px = weight ?? (size >= 64 ? 1.25 : 1.5);
  const sw = (px * 32) / size;
  return (
    <svg
      viewBox={FIREYE_GEOMETRY.viewBox}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      data-state={state}
      data-look={look}
      className={cn('shrink-0 overflow-visible', draw && 'fireye-draw', state && 'fireye-avatar', className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="butt"
    >
      <g className="fireye-lids">
        <path pathLength={1} className="fireye-lid" strokeWidth={sw} d={FIREYE_GEOMETRY.upperLid} />
        <path pathLength={1} className="fireye-lid" strokeWidth={sw} d={FIREYE_GEOMETRY.lowerLid} />
      </g>
      {state === 'alert' && <circle className="fireye-ring stroke-signal" cx={16} cy={16} r={6.25} strokeWidth={sw * 0.75} />}
      <g className="fireye-gaze" transform={look === 'down-left' ? 'translate(-3 2)' : look === 'down-right' ? 'translate(3 2)' : undefined}>
        <path className="fireye-pupil fill-signal" stroke="none" d={FIREYE_GEOMETRY.pupil} />
      </g>
    </svg>
  );
}

export interface OrchestratorAvatarProps {
  state?: OrchestratorState;
  size?: number;
  /** Square hairline tile behind the mark, for message rows and headers. */
  framed?: boolean;
  className?: string;
  title?: string;
}

const STATE_LABEL: Record<OrchestratorState, string> = {
  idle: 'Orchestrator, monitoring',
  listening: 'Orchestrator, listening',
  thinking: 'Orchestrator, working',
  speaking: 'Orchestrator, replying',
  alert: 'Orchestrator, needs a decision',
};

/** The Orchestrator's avatar: the FIREYE mark with live state. */
export function OrchestratorAvatar({ state = 'idle', size = 20, framed = false, className, title }: OrchestratorAvatarProps) {
  const mark = <FireyeMark size={framed ? Math.round(size * 0.72) : size} state={state} title={title ?? STATE_LABEL[state]} className={framed ? undefined : className} />;
  if (!framed) return mark;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center border border-line-strong bg-ink-900 text-bone', state === 'alert' && 'border-signal/60', className)}
      style={{ width: size, height: size }}>
      {mark}
    </span>
  );
}

export interface FireyeWordmarkProps {
  size?: number;
  className?: string;
  /** Mono sub-line after the name, e.g. "INCIDENT CONSOLE". */
  sub?: string;
}

/** Mark plus the FIREYE name in tracked mono. */
export function FireyeWordmark({ size = 20, className, sub }: FireyeWordmarkProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-bone', className)}>
      <FireyeMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="font-mono text-tiny font-normal uppercase tracking-[0.34em] text-bone">FIREYE</span>
        {sub && <span className="mt-1 font-mono text-micro font-light uppercase text-bone-mute">{sub}</span>}
      </span>
    </span>
  );
}
