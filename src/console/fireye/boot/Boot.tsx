import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FireyeMark, Icon, cn, getThemeSpec, type IconName } from '@ds';
import { appearancePalette, rgb } from '@ds/tokens/appearance-palette';
import type { ConsoleState } from '../../contracts';
import { prefersReducedMotion } from '../../stage3d/easing';

export interface BootProbe {
  pack: ConsoleState['pack'];
  ready: boolean;
  drones: number;
  sensors: number;
  chronicle: number;
  feeds: number;
  globe: boolean;
}

/** The boot field is always the night palette, whatever the replay appearance is underneath. */
function nightField(): CSSProperties {
  const vars: Record<string, string> = { colorScheme: 'dark' };
  for (const [k, hex] of Object.entries(appearancePalette(0, getThemeSpec()))) vars[`--${k}`] = rgb(hex).join(' ');
  return vars as CSSProperties;
}

interface Step { id: string; icon: IconName; label: string; done: (p: BootProbe) => boolean }

/** Each step completes only when its real dependency is loaded; the hold just keeps it readable. */
export const BOOT_STEPS: Step[] = [
  { id: 'terrain', icon: 'map', label: 'Terrain · DEM', done: (p) => !!p.pack?.elevation },
  { id: 'fuel', icon: 'tree', label: 'Fuel model', done: (p) => !!p.pack?.fuel },
  { id: 'osm', icon: 'route', label: 'OSM roads & buildings', done: (p) => !!p.pack?.roads },
  { id: 'weather', icon: 'wind', label: 'ERA5 weather', done: (p) => !!p.pack?.weather?.length },
  { id: 'fire', icon: 'flame', label: 'Fire arrival raster', done: (p) => !!p.pack?.arrival },
  { id: 'fleet', icon: 'drone', label: 'UAV fleet', done: (p) => p.drones > 0 },
  { id: 'iot', icon: 'sensor', label: 'IoT mesh', done: (p) => p.sensors > 0 },
  { id: 'comms', icon: 'radio', label: 'Comms & intake', done: (p) => p.chronicle > 0 },
  { id: 'orch', icon: 'orchestrator', label: 'Orchestrator', done: (p) => p.ready },
  { id: 'sensor', icon: 'camera', label: 'Sensor renderer', done: (p) => p.feeds > 0 },
  { id: 'globe', icon: 'satellite', label: 'Globe', done: (p) => p.globe },
];

const HOLD_MS = 200;
const MARK_MS = 1100;
const OUT_MS = 620;
/** A missing globe (no WebGL, renderer error) must not trap the console behind the boot screen. */
const GLOBE_GRACE_MS = 9000;

export function bootEnabled(search: string) {
  return new URLSearchParams(search).get('boot') !== '0';
}

/**
 * Full-screen boot: the mark strokes in, then one large icon per real load step, then the mark flies to
 * the top-left logo position. Esc or a click skips the animation (it still waits for the data).
 * Reduced motion shows a static checklist.
 */
export function Boot({ probe, onDone }: { probe: BootProbe; onDone: () => void }) {
  const reduced = prefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'mark' | 'steps' | 'out'>(reduced ? 'steps' : 'mark');
  const [skip, setSkip] = useState(false);
  const shownAt = useRef(performance.now());
  const t0 = useRef(performance.now());
  const markRef = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const graced = { ...probe, globe: probe.globe || performance.now() - t0.current > GLOBE_GRACE_MS };

  useEffect(() => {
    if (phase !== 'mark') return;
    const tm = window.setTimeout(() => setPhase('steps'), MARK_MS);
    return () => window.clearTimeout(tm);
  }, [phase]);

  // Step sequencer: polls so the grace timer and holds advance without new props.
  useEffect(() => {
    if (phase !== 'steps') return;
    const id = window.setInterval(() => {
      setIdx((i) => {
        if (i >= BOOT_STEPS.length) return i;
        const step = BOOT_STEPS[i]!;
        const hold = skip || reduced ? 0 : HOLD_MS;
        if (!step.done({ ...probe, globe: probe.globe || performance.now() - t0.current > GLOBE_GRACE_MS || (skip && step.id === 'globe') })) return i;
        if (performance.now() - shownAt.current < hold) return i;
        shownAt.current = performance.now();
        return i + 1;
      });
    }, 30);
    return () => window.clearInterval(id);
  }, [phase, probe, skip, reduced]);

  useEffect(() => {
    if (phase !== 'steps' || idx < BOOT_STEPS.length) return;
    if (skip || reduced) { doneRef.current(); return; }
    const el = markRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // Top-bar logo: 12px padding, 22px mark, vertically centred in the 44px bar.
      setFly(`translate(${23 - cx}px, ${22 - cy}px) scale(${22 / r.width})`);
    }
    setPhase('out');
  }, [idx, phase, skip, reduced]);

  useEffect(() => {
    if (phase !== 'out') return;
    const tm = window.setTimeout(() => doneRef.current(), OUT_MS);
    return () => window.clearTimeout(tm);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSkip(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [field] = useState(nightField);
  const step = BOOT_STEPS[Math.min(idx, BOOT_STEPS.length - 1)]!;
  const doneCount = Math.min(idx, BOOT_STEPS.length);

  if (reduced) {
    return (
      <div role="status" aria-label="Loading FIREYE" style={field} className="fixed inset-0 z-modal flex items-center justify-center bg-void">
        <div className="flex w-[340px] flex-col gap-6">
          <div className="flex items-center gap-4 text-bone"><FireyeMark size={40} weight={1} /><span className="font-mono text-sm font-light uppercase tracking-[0.5em]">FIREYE</span></div>
          <ul className="flex flex-col gap-2.5">
            {BOOT_STEPS.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 font-mono text-tiny font-light uppercase tracking-[0.16em]">
                <Icon name={s.icon} size={20} strokeWidth={24 / 20} className={i < doneCount ? 'text-bone' : 'text-bone-mute'} />
                <span className={i < doneCount ? 'text-bone-dim' : 'text-bone-mute'}>{s.label}</span>
                <span className={cn('ml-auto text-micro', i < doneCount ? 'text-bone-dim' : 'text-bone-mute')}>{i < doneCount ? 'Ready' : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const ready = idx >= BOOT_STEPS.length || step.done(graced);
  return (
    <div role="status" aria-label={`Loading FIREYE · ${step.label}`} style={field} onClick={() => setSkip(true)}
      className={cn('fixed inset-0 z-modal flex cursor-default items-center justify-center overflow-hidden bg-void', phase === 'out' && 'fireye-boot-out')}>
      <div className="flex flex-col items-center">
        <div ref={markRef} className="text-bone transition-transform ease-servo" style={{ transform: fly ?? undefined, transitionDuration: `${OUT_MS}ms` }}>
          <FireyeMark size={88} weight={1} draw />
        </div>
        <div className={cn('flex flex-col items-center transition-opacity duration-base ease-servo', phase === 'out' && 'opacity-0')}>
          <span className="mt-6 pl-[0.6em] font-mono text-sm font-light uppercase tracking-[0.6em] text-bone">FIREYE</span>
          <div className="mt-16 flex h-36 w-72 flex-col items-center">
            {phase !== 'mark' && (
              <div key={step.id} className="fireye-boot-icon flex flex-col items-center">
                <Icon name={step.icon} size={56} strokeWidth={24 / 56} className="text-bone" />
                <span className="mt-5 font-mono text-tiny font-light uppercase tracking-[0.24em] text-bone-dim">{step.label}</span>
                <span className="mt-1 font-mono text-micro font-light uppercase tracking-[0.24em] text-bone-mute">{ready ? 'Ready' : 'Loading'}</span>
              </div>
            )}
          </div>
          <div aria-hidden className="mt-2 h-px w-48 bg-line">
            <div className="h-px bg-bone transition-[width] duration-base ease-servo" style={{ width: `${(doneCount / BOOT_STEPS.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className={cn('absolute inset-x-0 bottom-8 flex justify-center gap-8 font-mono text-micro font-light uppercase tracking-[0.2em] text-bone-mute transition-opacity duration-base', phase === 'out' && 'opacity-0')}>
        <span className="text-amber">Exercise · simulated</span>
        <span>Esc to skip</span>
      </div>
    </div>
  );
}
