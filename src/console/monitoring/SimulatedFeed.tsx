import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, cn } from '@ds';
import type { ScenarioPack } from '../contracts';
import { ArchiveCamera, type ArchiveImage } from '../stage3d/feeds/ArchiveCamera';
import type { FeedPose } from '../stage3d/feeds/poses';
import { fitFeedFrame } from '../stage3d/feeds/dynamics';
import type { EnvInput, EnvOverrides, WorldEnv } from '../world3d/env';
import type { WorldRenderer, WorldStats } from '../world3d/render/WorldRenderer';
import { MonitoringFeedRenderer } from './MonitoringFeedRenderer';
import { DEMO_FEEDS, type DemoFeed } from './feed-motion';

type FeedRenderer = Pick<MonitoringFeedRenderer, 'register' | 'destroy'>;
interface FeedState { renderer: FeedRenderer | null; world: WorldRenderer | null; unavailable: boolean; stats: boolean }
const FeedContext = createContext<FeedState>({ renderer: null, world: null, unavailable: false, stats: false });

function worldFlags() {
  const q = new URLSearchParams(location.search);
  const world = (q.get('world') ?? '').split(',');
  return { legacy: q.get('feeds') === 'legacy', debug: world.includes('debug'), stats: world.includes('stats') || world.includes('debug') };
}

/**
 * Monitoring feeds render the procedural World3D scene by default (three.js, loaded on demand).
 * `?feeds=legacy` restores the Cesium monitoring renderer; a WebGL failure shows the labelled archive fallback.
 */
export function SimulatedFeedsProvider({ pack, clc, env, children }: { pack: ScenarioPack; clc?: Uint16Array | null; env: EnvInput; children: ReactNode }) {
  const [renderer, setRenderer] = useState<FeedRenderer | null>(null);
  const [world, setWorld] = useState<WorldRenderer | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const flags = useMemo(worldFlags, []);
  const envRef = useRef(env);
  envRef.current = env;
  useEffect(() => {
    let current: FeedRenderer | null = null, dead = false;
    setUnavailable(false); setRenderer(null); setWorld(null);
    if (flags.legacy) {
      try { current = new MonitoringFeedRenderer(pack); setRenderer(current); } catch { setUnavailable(true); }
    } else {
      void import('../world3d/render/WorldRenderer').then(({ WorldRenderer }) => {
        if (dead) return;
        const w = new WorldRenderer(pack, clc ?? null, envRef.current);
        current = w; setRenderer(w); setWorld(w);
        if (flags.stats) (window as unknown as { __fccWorld?: WorldRenderer }).__fccWorld = w;
      }).catch(() => { if (!dead) setUnavailable(true); });
    }
    return () => { dead = true; current?.destroy(); };
  }, [pack, clc, flags]);
  useEffect(() => { world?.setEnv(env); }, [world, env]);
  const value = useMemo(() => ({ renderer, world, unavailable, stats: flags.stats }), [renderer, world, unavailable, flags]);
  return <FeedContext.Provider value={value}>{children}{flags.debug && world && <WorldDebugPanel world={world} />}</FeedContext.Provider>;
}

export function SimulatedFeed({ feed, image, full = false, active = true }: {
  feed: DemoFeed; image: ArchiveImage; full?: boolean; active?: boolean;
}) {
  const { renderer, world, unavailable, stats } = useContext(FeedContext);
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), telemetry = useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [visible, setVisible] = useState(full);
  const [viewport, setViewport] = useState<ReturnType<typeof fitFeedFrame> | null>(null);
  const [paused, setPaused] = useState(false), [explicitPlay, setExplicitPlay] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const handle = useRef<ReturnType<FeedRenderer['register']> | null>(null);
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
  const kind = world ? '3D world' : '3D';
  return <div ref={host} className="fcc-sensor relative flex h-full w-full items-center justify-center overflow-hidden bg-void" data-simulated-feed={feed.id}>
    <div className="absolute" style={viewport ?? { inset: 0 }}>
      {status !== 'ready' && <div className="absolute inset-0"><ArchiveCamera image={image} label="Archive fallback" playing={false} /></div>}
      <canvas ref={canvas} width={full ? 960 : 384} height={full ? 540 : 216}
        className={cn('absolute inset-0 h-full w-full object-contain', status === 'ready' ? 'opacity-100' : 'opacity-0')}
        role="img" aria-label={`Simulated ${kind} ${feed.label}, not live footage`} />
      <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-between gap-2 font-mono text-micro uppercase">
        <span className="border border-amber/50 bg-ink-950/95 px-1.5 py-1 text-amber">Simulated · {status === 'ready' ? kind : 'archive'}</span>
        <span className="bg-ink-950/95 px-1.5 py-1 text-bone">{feed.label}</span>
      </div>
      {full && <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 border border-bone/60" />}
      {full && stats && world && <StatsOverlay world={world} />}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink-950/95 px-2 py-1.5">
        <div><p className="font-mono text-micro uppercase text-bone-dim">{failed ? '3D unavailable · archive fallback' : status === 'ready' ? feed.description : 'Preparing 3D world · archive fallback'}</p>
          {full && <p ref={telemetry} className="mt-1 font-mono text-micro uppercase text-bone-mute">Simulated camera telemetry</p>}</div>
        {full && <Button size="sm" variant="ghost" className="hover:bg-ink-900 active:bg-ink-950" disabled={failed} aria-label={moving ? 'Pause simulated feed' : 'Play simulated feed'}
          onClick={() => { if (reduced && !explicitPlay) { setExplicitPlay(true); setPaused(false); } else setPaused(p => !p); }}>{moving ? 'Pause' : 'Play'}</Button>}
      </div>
    </div>
  </div>;
}

function useWorldStats(world: WorldRenderer) {
  const [stats, setStats] = useState<WorldStats | null>(null);
  useEffect(() => { const t = window.setInterval(() => setStats(world.stats()), 500); return () => clearInterval(t); }, [world]);
  return stats;
}

function StatsOverlay({ world }: { world: WorldRenderer }) {
  const s = useWorldStats(world);
  if (!s) return null;
  const rows: [string, string][] = [['FPS', s.fps.toFixed(1)], ['Frame', `${s.frameMs.toFixed(1)} ms`], ['Draws', String(s.draws)], ['Tris', `${(s.tris / 1000).toFixed(0)}k`],
    ['Tiles', `${s.tiles} · ${s.pending} pending`], ['Gen', `${s.genMsAvg.toFixed(1)} / ${s.genMsMax.toFixed(1)} ms`], ['Objects', String(s.objects)], ['Agents', String(s.agents)],
    ['Cache', `${s.cacheMB.toFixed(0)} MB`], ['GPU', `${s.geometries} geo · ${s.textures} tex`], ['Long tasks', String(s.longTasks)]];
  return <dl className="pointer-events-none absolute right-2 top-10 grid grid-cols-[auto_auto] gap-x-3 border border-line bg-ink-950/90 px-2 py-1 font-mono text-micro uppercase text-bone-dim" data-world-stats>
    {rows.map(([k, val]) => <div key={k} className="contents"><dt className="text-bone-mute">{k}</dt><dd className="fcc-num text-right text-bone">{val}</dd></div>)}
  </dl>;
}

const field = 'border border-line-strong bg-ink-900 px-1 py-0.5 font-mono text-micro text-bone';
function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number | undefined; min: number; max: number; step: number; onChange: (v: number | undefined) => void; format: (v: number) => string }) {
  return <label className="grid grid-cols-[72px_1fr_64px_auto] items-center gap-2 font-mono text-micro uppercase text-bone-dim">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value ?? min} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
    <span className="fcc-num text-right text-bone">{value === undefined ? 'source' : format(value)}</span>
    <button type="button" className="text-bone-mute underline focus-visible:outline-signal" onClick={() => onChange(undefined)} aria-label={`Reset ${label}`}>Reset</button>
  </label>;
}

/** `?world=debug`: time, season and weather overrides plus ground-truth capture. Display only. */
function WorldDebugPanel({ world }: { world: WorldRenderer }) {
  const [o, setO] = useState<EnvOverrides>(world.envOverrides);
  const [env, setEnv] = useState<WorldEnv>(world.env);
  const [overlay, setOverlay] = useState(false);
  const [feedId, setFeedId] = useState(DEMO_FEEDS[3].id);
  const [summary, setSummary] = useState('');
  useEffect(() => { world.onEnv = setEnv; return () => { world.onEnv = null; }; }, [world]);
  useEffect(() => { world.setOverrides(o); }, [world, o]);
  useEffect(() => { world.truthOverlay = overlay; }, [world, overlay]);
  const set = (k: keyof EnvOverrides) => (v: number | undefined) => setO(prev => { const n = { ...prev }; if (v === undefined) delete n[k]; else n[k] = v; return n; });
  async function capture() {
    const t = await world.captureTruth(feedId);
    if (!t) { setSummary('Feed not rendered yet. Open or scroll to it first.'); return; }
    const top = Object.entries(t.classPixels).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 6).map(([k, n]) => `${k} ${((n ?? 0) / (t.width * t.height) * 100).toFixed(0)}%`).join(' · ');
    const hazards = t.objects.filter(x => x.flammability === 'extreme').length;
    setSummary(`${t.objects.length} objects · ${hazards} extreme · ${top}`);
    (window as unknown as { __fccTruth?: unknown }).__fccTruth = t;
  }
  const hh = (v: number) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
  return <aside className="fixed bottom-14 right-4 z-modal w-[360px] space-y-2 border border-line bg-ink-950/95 p-3" aria-label="World debug controls" data-world-debug>
    <p className="font-mono text-micro uppercase tracking-[0.14em] text-bone">World debug · display only</p>
    <p className="font-mono text-micro text-bone-mute">{env.season} · day {env.dayOfYear} · {hh(env.localHour)} local · sun {env.sunEl.toFixed(1)}° · {env.weatherSource}{env.assumed.length ? ` · assumed ${env.assumed.join(', ')}` : ''}</p>
    <p className="font-mono text-micro text-bone-mute fcc-num">curing {env.curing.toFixed(2)} · dryness {env.dryness.toFixed(2)} · wind {env.windKph.toFixed(0)} km/h from {env.windFromDeg.toFixed(0)}° · rain {env.rain.toFixed(2)} · vis {env.visibilityKm.toFixed(0)} km</p>
    <Slider label="Hour" value={o.hour} min={0} max={23.75} step={0.25} onChange={set('hour')} format={hh} />
    <Slider label="Day" value={o.dayOfYear} min={1} max={365} step={1} onChange={set('dayOfYear')} format={v => String(v)} />
    <Slider label="Rain" value={o.precipMm} min={0} max={8} step={0.1} onChange={set('precipMm')} format={v => `${v.toFixed(1)} mm`} />
    <Slider label="Cloud" value={o.cloud} min={0} max={1} step={0.05} onChange={set('cloud')} format={v => v.toFixed(2)} />
    <Slider label="Wind" value={o.windKph} min={0} max={90} step={1} onChange={set('windKph')} format={v => `${v} km/h`} />
    <Slider label="From" value={o.windFromDeg} min={0} max={359} step={1} onChange={set('windFromDeg')} format={v => `${v}°`} />
    <Slider label="Humidity" value={o.rh} min={5} max={100} step={1} onChange={set('rh')} format={v => `${v}%`} />
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 font-mono text-micro uppercase text-bone-dim"><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} />Truth overlay (fullscreen)</label>
      <select aria-label="Feed for truth capture" className={field} value={feedId} onChange={e => setFeedId(e.target.value)}>{DEMO_FEEDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
      <Button size="sm" variant="ghost" onClick={() => void capture()}>Capture truth</Button>
    </div>
    {summary && <p role="status" className="font-mono text-micro text-bone-dim">{summary}</p>}
  </aside>;
}
