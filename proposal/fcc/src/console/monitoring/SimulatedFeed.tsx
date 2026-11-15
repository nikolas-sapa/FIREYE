import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, cn } from '@ds';
import type { ScenarioPack } from '../contracts';
import { ArchiveCamera, type ArchiveImage } from '../stage3d/feeds/ArchiveCamera';
import type { FeedPose } from '../stage3d/feeds/poses';
import { fitFeedFrame } from '../stage3d/feeds/dynamics';
import { MonitoringFeedRenderer } from './MonitoringFeedRenderer';
import type { DemoFeed } from './feed-motion';

const FeedContext = createContext<{ renderer: MonitoringFeedRenderer | null; unavailable: boolean }>({ renderer: null, unavailable: false });
export function SimulatedFeedsProvider({ pack, children }: { pack: ScenarioPack; children: ReactNode }) {
  const [renderer, setRenderer] = useState<MonitoringFeedRenderer | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let current: MonitoringFeedRenderer;
    try { current = new MonitoringFeedRenderer(pack); setRenderer(current); }
    catch { setUnavailable(true); return; }
    return () => current.destroy();
  }, [pack]);
  const value = useMemo(() => ({ renderer, unavailable }), [renderer, unavailable]);
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function SimulatedFeed({ feed, image, full = false, active = true }: {
  feed: DemoFeed; image: ArchiveImage; full?: boolean; active?: boolean;
}) {
  const { renderer, unavailable } = useContext(FeedContext);
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), telemetry = useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [visible, setVisible] = useState(full);
  const [viewport, setViewport] = useState<ReturnType<typeof fitFeedFrame> | null>(null);
  const [paused, setPaused] = useState(false), [explicitPlay, setExplicitPlay] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const handle = useRef<ReturnType<MonitoringFeedRenderer['register']> | null>(null);
  const moving = !paused && (!reduced || explicitPlay);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = () => setViewport(fitFeedFrame(element.clientWidth, element.clientHeight));
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { threshold: 0.05 });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!renderer || !canvas.current) return;
    setStatus('loading');
    delete canvas.current.dataset.ready;
    const registration = renderer.register({ feed, canvas: canvas.current, full, visible, active, moving, frozen: paused,
      onReady: () => setStatus('ready'), onError: () => setStatus('error'),
      onTelemetry: (pose: FeedPose, seconds: number) => {
        if (telemetry.current) telemetry.current.textContent =
          `${pose.geo.lat.toFixed(4)}N ${pose.geo.lon.toFixed(4)}E · ${pose.altAglM.toFixed(0)} m AGL · ${pose.headingDeg.toFixed(0)}° · DEMO +${seconds.toFixed(1)}s`;
      } });
    handle.current = registration;
    return () => { registration.dispose(); handle.current = null; };
    // State updates go through update(), never tear down the renderer on pause/visibility changes.
  }, [renderer, feed, full]);
  useEffect(() => handle.current?.update({ active, visible, moving, frozen: paused }), [active, visible, moving, paused, renderer]);
  const failed = unavailable || status === 'error';
  return <div ref={host} className="fcc-sensor relative flex h-full w-full items-center justify-center overflow-hidden bg-void" data-simulated-feed={feed.id}>
    <div className="absolute" style={viewport ?? { inset: 0 }}>
      {status !== 'ready' && <div className="absolute inset-0"><ArchiveCamera image={image} label="Archive fallback" playing={false} /></div>}
      <canvas ref={canvas} width={full ? 960 : 384} height={full ? 540 : 216}
        className={cn('absolute inset-0 h-full w-full object-contain', status === 'ready' ? 'opacity-100' : 'opacity-0')}
        role="img" aria-label={`Simulated 3D ${feed.label}, not live footage`} />
      <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-between gap-2 font-mono text-micro uppercase">
        <span className="border border-amber/50 bg-ink-950/95 px-1.5 py-1 text-amber">Simulated · {status === 'ready' ? '3D' : 'archive'}</span>
        <span className="bg-ink-950/95 px-1.5 py-1 text-bone">{feed.label}</span>
      </div>
      {full && <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 border border-bone/60" />}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink-950/95 px-2 py-1.5">
        <div><p className="font-mono text-micro uppercase text-bone-dim">{failed ? '3D unavailable · archive fallback' : status === 'ready' ? feed.description : 'Preparing 3D terrain · archive fallback'}</p>
          {full && <p ref={telemetry} className="mt-1 font-mono text-micro uppercase text-bone-mute">Simulated camera telemetry</p>}</div>
        {full && <Button size="sm" variant="ghost" className="hover:bg-ink-900 active:bg-ink-950" disabled={failed} aria-label={moving ? 'Pause simulated feed' : 'Play simulated feed'}
          onClick={() => { if (reduced && !explicitPlay) { setExplicitPlay(true); setPaused(false); } else setPaused(p => !p); }}>{moving ? 'Pause' : 'Play'}</Button>}
      </div>
    </div>
  </div>;
}
