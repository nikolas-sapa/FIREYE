import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FIREYE_GEOMETRY, Icon, cn, getThemeSpec } from '@ds';
import { appearancePalette, rgb } from '@ds/tokens/appearance-palette';
import { BOOT_EASE, BOOT_MOTION as M, BOOT_STEPS, bootReady, handoffTransform, sourceFrames, sourceLayout, type BootProbe } from './sequence';

export { BOOT_STEPS, bootEnabled } from './sequence';
export type { BootProbe } from './sequence';

type Phase = 'outline' | 'pupil' | 'handoff' | 'waiting' | 'reveal' | 'globe' | 'panels';

/** The presentation field remains night-dark even if another console view uses Auto. */
function nightField(): CSSProperties {
  const vars: Record<string, string> = { colorScheme: 'dark' };
  for (const [k, value] of Object.entries(appearancePalette(0, getThemeSpec()))) vars[`--${k}`] = rgb(value).join(' ');
  return vars as CSSProperties;
}

const CENTER = 'translate(-50%, -50%)';
/** A compositor-only presentation over a real, already-mounted dashboard. */
export function Boot({ probe, onPrepareGlobe, onGlobe, onReveal, onDone }: {
  probe: BootProbe;
  onPrepareGlobe?: (signal: AbortSignal, instant: boolean) => Promise<void>;
  onGlobe?: (signal: AbortSignal, instant: boolean) => Promise<void>;
  onReveal?: () => void; onDone: () => void;
}) {
  const [field] = useState(nightField);
  const [phase, setPhase] = useState<Phase>('outline');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [skip, setSkip] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: innerWidth, height: innerHeight }));
  const root = useRef<HTMLDivElement>(null), mark = useRef<HTMLDivElement>(null);
  const lids = useRef<SVGGElement>(null), pupil = useRef<SVGPathElement>(null);
  const curtain = useRef<HTMLDivElement>(null), icons = useRef<(HTMLDivElement | null)[]>([]);
  const footer = useRef<HTMLDivElement>(null);
  const latest = useRef({ probe, onPrepareGlobe, onGlobe, onReveal, onDone });
  latest.current = { probe, onPrepareGlobe, onGlobe, onReveal, onDone };
  const startedAt = useRef(performance.now()), fonts = useRef(false), finished = useRef(false);

  useEffect(() => {
    let dead = false;
    void document.fonts.ready.then(() => { if (!dead) fonts.current = true; }, () => { if (!dead) fonts.current = true; });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    // Once requested, keep this particular introduction motionless.
    const change = () => { if (media.matches) setReduced(true); };
    media.addEventListener('change', change);
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSkip(true); }
    };
    document.addEventListener('keydown', key, true);
    const timer = window.setTimeout(() => setDelayed(true), M.delayed);
    root.current?.focus({ preventScroll: true });
    return () => {
      dead = true; media.removeEventListener('change', change);
      window.removeEventListener('resize', resize); document.removeEventListener('keydown', key, true);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController(), signal = abort.signal;
    const animations = new Set<Animation>();
    let flight: Animation | undefined;
    const sourceFlights = new Map<number, Animation>();
    const elapsed = () => performance.now() - startedAt.current;
    const wait = (ms: number) => new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
      const cancel = () => { window.clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
    const play = (el: Element, frames: Keyframe[], duration: number, delay = 0, easing = BOOT_EASE) => {
      const a = el.animate(frames, { duration, delay, easing, fill: 'both' });
      animations.add(a);
      void a.finished.catch(() => {}); // Cleanup can cancel a stagger before its group is awaited.
      return a;
    };
    const destination = () => {
      const target = document.querySelector('[data-fireye-logo]')?.getBoundingClientRect();
      return handoffTransform(innerWidth, innerHeight, mark.current!.offsetWidth,
        target ?? { left: (innerWidth - 96) / 2, top: 0, width: 96, height: 96 });
    };
    const flightFrames = (): Keyframe[] => [{ transform: CENTER }, { transform: destination() }];
    const resize = () => {
      if (flight?.effect instanceof KeyframeEffect) flight.effect.setKeyframes(flightFrames());
      for (const [i, a] of sourceFlights) if (a.effect instanceof KeyframeEffect) a.effect.setKeyframes(sourceFrames(innerWidth, innerHeight, i));
    };
    window.addEventListener('resize', resize);
    const waitForAssets = async () => {
      while (!bootReady(latest.current.probe, elapsed(), skip) || !(fonts.current || skip || elapsed() >= M.graphicsGrace)) await wait(80);
    };
    const finish = () => {
      if (signal.aborted || finished.current) return;
      finished.current = true;
      const restoreFocus = root.current?.contains(document.activeElement) || document.activeElement === document.body;
      latest.current.onDone();
      if (restoreFocus) queueMicrotask(() => document.querySelector<HTMLElement>('[data-fireye-logo]')?.focus({ preventScroll: true }));
    };
    const staticField = () => {
      lids.current!.style.transform = 'none';
      pupil.current!.style.transform = 'none'; pupil.current!.style.opacity = '1';
      icons.current.forEach(el => {
        if (!el) return;
        el.style.opacity = '0'; el.style.transform = CENTER;
      });
    };
    const cutToDashboard = async () => {
      await waitForAssets();
      if (signal.aborted) return;
      await latest.current.onPrepareGlobe?.(signal, true);
      await latest.current.onGlobe?.(signal, true);
      if (!signal.aborted) { latest.current.onReveal?.(); finish(); }
    };
    const run = async () => {
      if (reduced || skip || !Element.prototype.animate) {
        setPhase('waiting'); staticField();
        await cutToDashboard();
        return;
      }
      setPhase('outline');
      // Pay cold renderer/shader setup while the opening line is still deliberately at rest.
      while (!latest.current.probe.warm && elapsed() < M.preflight) await wait(60);
      await play(lids.current!, [{ transform: 'scaleY(0.006)' }, { transform: 'scaleY(1)' }], M.outline, M.lineHold).finished;
      setPhase('pupil');
      await play(pupil.current!, [
        { opacity: 0, transform: 'scaleY(0.02)' },
        { opacity: 1, transform: 'scaleY(0.02)' },
      ], M.pupilAppear).finished;
      await wait(M.pupilLine);
      await play(pupil.current!, [{ transform: 'scaleY(0.02)' }, { transform: 'scaleY(1)' }], M.pupil).finished;
      await wait(M.settle);
      if (signal.aborted) return;
      setPhase('handoff');
      flight = play(mark.current!, flightFrames(), M.flight);
      await wait(M.sourceDelay);
      // Strictly serial: finish all four left sources before the first right source appears.
      for (const [i, el] of icons.current.entries()) {
        const a = play(el!, sourceFrames(innerWidth, innerHeight, i), M.sourceAppear + M.sourceHold + M.sourceExit, 0, 'linear');
        sourceFlights.set(i, a);
        await a.finished;
      }
      await flight.finished;
      setPhase('waiting');
      await waitForAssets();
      if (signal.aborted) return;
      await latest.current.onPrepareGlobe?.(signal, false);
      if (signal.aborted) return;
      setPhase('reveal');
      sourceFlights.clear();
      const approach = latest.current.onGlobe?.(signal, false) ?? Promise.resolve();
      void approach.catch(() => {}); // Cancellation can precede the fade's completion.
      const opening = play(curtain.current!, [
        { opacity: 1 }, { opacity: 0 },
      ], M.reveal).finished;
      const landing = play(mark.current!, [{ opacity: 1 }, { opacity: 0 }], 180, M.reveal - 180).finished;
      await Promise.all([opening, landing]);
      setPhase('globe');
      await approach;
      if (signal.aborted) return;
      setPhase('panels'); latest.current.onReveal?.();
      void play(footer.current!, [{ opacity: 1 }, { opacity: 0 }], 220, 180).finished.catch(() => {});
      await wait(M.panels);
      finish();
    };
    void run().catch(async error => {
      if (signal.aborted) return;
      console.warn('[fireye] Intro motion unavailable; using static loading field', error);
      animations.forEach(a => a.cancel()); staticField(); setPhase('waiting');
      try {
        await cutToDashboard();
      } catch { /* unmounted or preference changed */ }
    });
    return () => {
      abort.abort(); animations.forEach(a => a.cancel());
      window.removeEventListener('resize', resize);
      if (lids.current) lids.current.style.transform = '';
      if (pupil.current) { pupil.current.style.transform = ''; pupil.current.style.opacity = ''; }
      icons.current.forEach(el => { if (el) { el.style.transform = ''; el.style.opacity = ''; } });
    };
  }, [reduced, skip]);

  const pending = BOOT_STEPS.filter(s => !s.done(probe)).map(s => s.label);
  const status = phase === 'outline' ? 'Opening FIREYE optics' : phase === 'pupil' ? 'Activating FIREYE'
    : phase === 'handoff' ? 'Connecting sources' : phase === 'reveal' ? 'Revealing the globe'
      : phase === 'globe' ? 'Approaching Mati' : phase === 'panels' ? 'Opening the simulation panels'
      : pending.length ? `Loading ${pending.join(', ')}` : 'Preparing the map and camera surfaces';

  return (
    <div ref={root} role="status" aria-label="Loading FIREYE" tabIndex={-1} data-boot-phase={phase}
      data-reduced-motion={reduced || skip} style={field} onClick={() => setSkip(true)}
      className="fireye-boot fixed inset-0 z-modal overflow-hidden outline-none">
      <div ref={curtain} aria-hidden className="fireye-boot-curtain absolute inset-0 bg-ink-950" />
      <div ref={mark} data-boot-mark className="fireye-boot-mark absolute left-1/2 top-1/2 text-bone">
        <svg viewBox={FIREYE_GEOMETRY.viewBox} width="100%" height="100%" fill="none" stroke="currentColor" role="img" aria-label="FIREYE">
          <g ref={lids} className="fireye-boot-optics">
            {[FIREYE_GEOMETRY.upperLid, FIREYE_GEOMETRY.lowerLid].map(d =>
              <path key={d} d={d} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />)}
          </g>
          <path ref={pupil} className="fireye-boot-iris fill-signal" d={FIREYE_GEOMETRY.pupil} stroke="none" />
        </svg>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
        {BOOT_STEPS.map((step, i) => {
          const { size } = sourceLayout(viewport.width, viewport.height, i);
          return <div key={step.id} ref={el => { icons.current[i] = el; }} data-boot-source={step.id}
            className={cn('fireye-boot-source absolute left-0 top-0 flex items-center justify-center', step.done(probe) ? 'text-bone' : 'text-bone-mute')}
            style={{ width: size, height: size }}>
            <Icon name={step.icon} size={size} strokeWidth={32 / size} />
          </div>;
        })}
      </div>
      <div ref={footer} className="absolute inset-x-0 bottom-8 flex items-center justify-center gap-3 font-mono text-micro uppercase tracking-[0.24em] text-bone-mute">
        <span>Simulation build</span>
        {delayed && !probe.ready && <button type="button" onClick={e => { e.stopPropagation(); location.reload(); }}
          className="border-b border-line-strong text-bone-dim focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal">Loading delayed · retry</button>}
      </div>
      <span className="sr-only">{status}. Press Escape to skip the introduction; required data must still load.</span>
    </div>
  );
}
