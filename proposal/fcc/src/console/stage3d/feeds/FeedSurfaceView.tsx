import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, cn, fmtLat, fmtLon, pad, zulu } from '@ds';
import type { Feed } from '../../contracts';
import { MODEL_LABEL, modelFor } from '../fx';
import { stageWorld, useStageWorld } from '../world';
import { asDemoFeed, fireyePose, getWorld3D, markWorld3dFailed, thermalOf, world3dEligible } from './world3d';
import { FeedRenderer, FULL_H, FULL_W, THUMB_H, THUMB_W, type Detection, type FeedFrame } from './FeedRenderer';
import { fitFeedFrame } from './dynamics';
import { ArchiveCamera } from './ArchiveCamera';
import { captureFrame, frameStatus, renderedFrame, type FrameMetadata } from '../../world/frame-capture';
import '../stage.css';

export interface FeedSurfaceProps {
  feedId: string;
  variant: 'thumb' | 'full';
  className?: string;
  /** 'auto' = minimal HUD on thumbs, full HUD on 'full'. 'none' = pixels only. */
  hud?: 'auto' | 'none';
}


const UAV = new Set<Feed['kind']>(['uav-nadir', 'uav-oblique', 'uav-chase']);

/** Store-agnostic surface (reads the stage mirror). Used by Stage feed mode and the dev harness. */
export function FeedSurfaceView({ feedId, variant, className, hud = 'auto' }: FeedSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReturnType<typeof fitFeedFrame> | null>(null);
  const [frame, setFrame] = useState<FeedFrame | null>(null);
  const [failed, setFailed] = useState(false);
  const metadata = useRef<FrameMetadata | null>(null);
  const [, setNow] = useState(0);
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const feed = useStageWorld((s) => s.feeds.find((f) => f.id === feedId));
  const t = useStageWorld((s) => s.t);
  const pack = useStageWorld((s) => s.pack);
  const paused = useStageWorld((s) => s.paused);
  const hasFeed = !!feed;
  useEffect(() => {
    if (hud === 'none') return;
    const timer = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(timer);
  }, [hud]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => setViewport(fitFeedFrame(host.clientWidth, host.clientHeight));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const worldHandle = useRef<{ update: (p: { visible?: boolean; thermal?: 'white' | 'iron'; lead?: boolean }) => void } | null>(null);
  const lead = variant === 'full' || hud !== 'none';
  const thermal = feed ? thermalOf(feed) : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasFeed) return;
    let dead = false, dispose: (() => void) | undefined;
    setFrame(null);
    metadata.current = null;
    setCaptureError('');
    setFailed(false);
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    const cesium = () => {
      const r = FeedRenderer.get();
      if (!r) { setFailed(true); return; }
      dispose = r.register({ feedId, variant, canvas, onFrame: (f) => { metadata.current = f.capture ?? null; setFrame(f); setFailed(false); },
        onError: () => { metadata.current = null; setFrame(null); setFailed(true); } });
    };
    const s0 = stageWorld.get(), f0 = s0.feeds.find((f) => f.id === feedId), pack0 = s0.pack;
    if (f0 && pack0 && world3dEligible(f0, pack0)) {
      void getWorld3D(pack0).then((w) => {
        if (dead) return;
        if (!w) { cesium(); return; }
        let failedOnce = false;
        const reg = w.register({ feed: asDemoFeed(f0), canvas, full: variant === 'full', active: true, visible: true, moving: true, frozen: false,
          lead, thermal: thermalOf(f0), pose: fireyePose(feedId, f0, pack0),
          onReady: () => {},
          onPixels: (renderedThermal) => {
            const s = stageWorld.get(), f = s.feeds.find(f => f.id === feedId);
            metadata.current = f && thermalOf(f) === renderedThermal ? renderedFrame(f, canvas, s.t, performance.now()) ?? null : null;
          },
          onError: () => {
            if (failedOnce || dead) return;
            failedOnce = true;
            metadata.current = null;
            markWorld3dFailed();
            queueMicrotask(() => { if (dead) return; dispose?.(); worldHandle.current = null; setFrame(null); cesium(); });
          },
          onTelemetry: (pose) => {
            const s = stageWorld.get(), feedNow = s.feeds.find((f) => f.id === feedId) ?? f0;
            const unit = feedNow.unitId ? s.units.find((u) => u.id === feedNow.unitId) : undefined;
            setFrame({ feedId, pose, detections: [], frame: Number(canvas.dataset.frame ?? 0), renderedAt: performance.now(),
              model: modelFor(feedNow), speedMps: unit?.speedMps, replayRate: s.speed ?? 1 });
            setFailed(false);
          } });
        dispose = () => reg.dispose();
        worldHandle.current = reg;
      });
    } else cesium();
    return () => { dead = true; dispose?.(); worldHandle.current = null; };
  }, [feedId, variant, hasFeed]);

  useEffect(() => { worldHandle.current?.update({ thermal, lead }); }, [thermal, lead]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver((entries) => worldHandle.current?.update({ visible: entries[0].isIntersecting }), { threshold: 0.05 });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const full = variant === 'full';
  const showHud = hud !== 'none';
  const currentFrame = hasFeed && frame?.feedId === feedId ? frame : null;
  const eligible = canvasRef.current?.dataset.truthOverlay !== 'true' && metadata.current?.display_transform === feed?.fx;
  const status = frameStatus(metadata.current, { simTime: t, nowMs: performance.now(), connected: !!feed?.live && !failed && eligible });
  const transformed = !!feed?.modality && (feed.modality === 'thermal') !== !!feed?.fx.startsWith('ir');
  const save = async () => {
    const canvas = canvasRef.current, meta = metadata.current;
    const state = stageWorld.get(), source = state.feeds.find(f => f.id === feedId);
    if (!canvas || !meta || !source || saving || meta.feed_id !== feedId || canvas.dataset.truthOverlay === 'true'
      || meta.display_transform !== source.fx || frameStatus(meta, { simTime: state.t, nowMs: performance.now(), connected: source.live }) !== 'available') return;
    setSaving(true); setCaptureError('');
    try {
      const capture = await captureFrame(canvas, meta);
      const bytes = new Uint8Array(await capture.pixels.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const url = URL.createObjectURL(new Blob([JSON.stringify({
        metadata: capture.metadata, content_hash: capture.content_hash, mime_type: capture.pixels.type,
        byte_length: capture.pixels.size, pixels_base64: btoa(binary),
        note: 'Local simulated rendered pixels, not shared evidence, measured temperature, or backend receipt.',
      })], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'fcc-simulated-frame.json'; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setCaptureError('Frame capture unavailable'); }
    finally { setSaving(false); }
  };

  return (
    <div ref={hostRef} className={cn('fcc-sensor relative h-full w-full overflow-hidden bg-void', className)}>
      <div className="absolute" style={viewport ?? { inset: 0 }}>
      <canvas
        ref={canvasRef}
        width={full ? FULL_W : THUMB_W}
        height={full ? FULL_H : THUMB_H}
        className={cn('absolute inset-0 h-full w-full object-contain transition-opacity duration-base ease-servo', currentFrame ? 'opacity-100' : 'opacity-0')}
        aria-label={feed ? `Simulated camera feed ${feed.label}` : 'Camera feed'}
        role="img"
      />
      {!currentFrame && (pack?.imagery && feed
        ? <ArchiveCamera image={pack.imagery} label={`${feed.label} · archive fallback`} target={feed.pose?.target ?? feed.pose?.pos}
            seed={feed.id.split('').reduce((n, c) => n + c.charCodeAt(0), 0) % 7} variant={variant} playing={!paused} />
        : <Acquiring failed={failed || !feed} full={full} label={feed?.label} />)}
      {currentFrame && showHud && feed && (full ? <FullHud feed={feed} frame={currentFrame} t={t} /> : <ThumbHud feed={feed} frame={currentFrame} />)}
      {showHud && feed?.modality && <div className={cn('absolute left-2 flex max-w-[90%] flex-wrap items-center gap-2 bg-void/80 px-2 py-1 font-mono text-micro uppercase text-bone-dim', full ? 'top-20' : 'top-6')} role="status">
        <span>{feed.modality} source · simulated · non-radiometric · {status}</span>
        {transformed && <span>Display transform only</span>}
        {full && <><span>Receipt unknown</span><Button size="sm" variant="ghost" disabled={saving || status !== 'available'} onClick={() => { void save(); }}>{saving ? 'Encoding' : 'Save local frame'}</Button></>}
        {captureError && <span className="text-amber">{captureError}</span>}
      </div>}
      </div>
    </div>
  );
}

function Acquiring({ failed, full, label }: { failed: boolean; full: boolean; label?: string }) {
  return (
    <div className="fcc-feed-scan absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink-950">
      <span className={cn('font-mono uppercase text-bone-mute', full ? 'text-nano' : 'text-micro')}>
        {failed ? 'No signal · static' : 'Acquiring'}
      </span>
      {full && label && <span className="font-mono text-micro uppercase text-ink-400">{label}</span>}
    </div>
  );
}

function DetBox({ d, labels }: { d: Detection; labels: boolean }) {
  const c = d.color;
  const corner = 'absolute h-2 w-2';
  return (
    <div
      className="absolute"
      style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` }}
    >
      <span className={cn(corner, 'left-0 top-0 border-l border-t')} style={{ borderColor: c }} />
      <span className={cn(corner, 'right-0 top-0 border-r border-t')} style={{ borderColor: c }} />
      <span className={cn(corner, 'bottom-0 left-0 border-b border-l')} style={{ borderColor: c }} />
      <span className={cn(corner, 'bottom-0 right-0 border-b border-r')} style={{ borderColor: c }} />
      <span className="absolute inset-0 border border-dashed opacity-40" style={{ borderColor: c }} />
      {labels && (
        <span
          className="fcc-num absolute -top-4 left-0 whitespace-nowrap bg-void/80 px-1 font-mono text-micro uppercase"
          style={{ color: c }}
        >
          {d.label} · {d.confidence.toFixed(2)}
        </span>
      )}
    </div>
  );
}

function satCaption(sat: FeedFrame['sat']): { badge: string; real: boolean; line?: string; source?: string } {
  if (!sat) return { badge: '', real: false };
  if (!sat.real) return { badge: 'Synthetic render · not imagery', real: false };
  const pass = sat.passT ? `PASS ${zulu(new Date(sat.passT)).slice(0, 5)}Z${sat.nominal ? ' (NOMINAL)' : ''}` : '';
  return {
    badge: sat.base ? 'Archived imagery · pre-fire base' : 'Archived imagery',
    real: true,
    line: [sat.sensor, sat.date, pass].filter(Boolean).join(' · '),
    source: sat.source,
  };
}

function ThumbHud({ feed, frame }: { feed: Feed; frame: FeedFrame }) {
  const sat = frame.sat;
  const tag = sat ? (sat.real ? `SAT · ${sat.date.slice(5)}` : 'SAT · SYNTH') : MODEL_LABEL[frame.model].split(' · ')[0];
  return (
    <div className="pointer-events-none absolute inset-0">
      {frame.detections.map((d) => (
        <DetBox key={d.id} d={d} labels={false} />
      ))}
      <div className="absolute right-1 top-1 flex items-center gap-1 bg-void/70 px-1 font-mono text-micro uppercase text-bone-dim">
        {feed.live ? <span className="fcc-rec-dot h-1 w-1 bg-ember" /> : <span className="h-1 w-1 bg-ink-400" />}
        {tag}
        {frame.nuc && <span className="text-bone">NUC</span>}
      </div>
    </div>
  );
}

function FullHud({ feed, frame, t }: { feed: Feed; frame: FeedFrame; t: number }) {
  const p = frame.pose;
  const callsign = p.unit?.callsign ?? feed.label.split(' · ')[0];
  const micro = 'font-mono text-nano uppercase tracking-[0.12em]';
  const m = frame.model;
  const uav = UAV.has(feed.kind);
  const reticle = uav || feed.kind === 'ridge-cam';
  const dash = m === 'dash' || m === 'helmet';
  const phone = !!frame.portrait;
  const sat = satCaption(frame.sat);
  const stamp = t ? zulu(new Date(t)) : '--:--:--Z';
  const date = t ? new Date(t).toISOString().slice(0, 10) : '----------';
  const kmh = Math.round((frame.speedMps ?? 0) * 3.6);
  return (
    <div className="pointer-events-none absolute inset-0 text-bone">
      {!dash && !phone &&
        ['left-3 top-3 border-l border-t', 'right-3 top-3 border-r border-t', 'left-3 bottom-3 border-l border-b', 'right-3 bottom-3 border-r border-b'].map((k) => (
          <span key={k} className={cn('absolute h-6 w-6 border-bone/60', k)} />
        ))}
      {reticle && (
        <svg className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 text-bone/70" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
          <path d="M32 6v16M32 42v16M6 32h16M42 32h16" />
          <path d="M28 32h8M32 28v8" strokeOpacity="0.6" />
        </svg>
      )}
      {frame.detections.map((d) => (
        <DetBox key={d.id} d={d} labels />
      ))}
      <div className={cn('absolute left-6 top-5 flex items-center gap-3', micro)}>
        {feed.live ? (
          <span className="flex items-center gap-1.5 text-ember">
            <span className="fcc-rec-dot h-1.5 w-1.5 bg-ember" /> SIMULATED SENSOR
          </span>
        ) : (
          <span className="text-amber">{feed.kind === 'satellite' ? 'Not live · archived imagery' : 'Simulated clip'}</span>
        )}
        <span className="text-bone">{callsign}</span>
      </div>
      <div className={cn('fcc-feed-hud-model fcc-num absolute right-6 top-5 flex items-center gap-3 text-bone-dim', micro)}>
        {frame.nuc && <span className="bg-bone px-1 text-void">NUC</span>}
        <span className="text-bone">{frame.sat?.real ? frame.sat.sensor : MODEL_LABEL[m]}</span>
        {!frame.sat?.real && <span>FOV {Math.round(p.fovDeg)}°</span>}
        <span>{feed.kind.replace('-', ' ')}</span>
      </div>

      {sat.badge && (
        <div className={cn('absolute left-1/2 top-5 -translate-x-1/2 px-1.5', micro, sat.real ? 'bg-void/70 text-bone' : 'bg-amber text-void')}>{sat.badge}{frame.detections.length > 0 ? ' · simulated annotations' : ''}</div>
      )}

      {uav && (
        <div className={cn('fcc-feed-hud-bottom fcc-num absolute bottom-5 left-6 flex max-w-[60%] flex-wrap items-center gap-x-4 gap-y-1 text-bone-dim', micro)}>
          <span>
            {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}
          </span>
          <span>ALT {Math.round(p.altAglM)} M AGL</span>
          <span>HDG {pad(Math.round(p.headingDeg) % 360, 3)}°</span>
          <span>GMB {Math.round(p.pitch / (Math.PI / 180))}°</span>
          <span>GS {Math.round(frame.speedMps ?? 0)} M/S</span>
          {frame.detections.length > 0 && <span className="text-violet">{frame.detections.length} DET</span>}
        </div>
      )}
      {!uav && !dash && !phone && !frame.sat?.real && (
        <div className={cn('fcc-feed-hud-bottom fcc-num absolute bottom-5 left-6 flex items-center gap-4 text-bone-dim', micro)}>
          <span>
            {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}
          </span>
          <span>HDG {pad(Math.round(p.headingDeg) % 360, 3)}°</span>
          {frame.detections.length > 0 && <span className="text-violet">{frame.detections.length} DET</span>}
        </div>
      )}
      {frame.sat?.real && sat.line && (
        <div className={cn('fcc-num absolute right-6 top-14 flex max-w-[65%] flex-col gap-0.5 bg-void/70 px-2 py-1 text-right text-bone-dim', micro)}>
          <span className="text-bone">{sat.line}</span>
          <span className="normal-case tracking-normal text-bone-mute">{sat.source}</span>
        </div>
      )}
      {dash && (
        // Camera on-screen display, burnt into the recording (UTC clock).
        <div className="fcc-feed-hud-bottom fcc-num absolute bottom-4 left-5 bg-void/40 px-1 font-mono text-micro tabular-nums text-bone">
          {date} {stamp} &nbsp; {callsign} &nbsp; {pad(kmh, 3)} KM/H &nbsp; {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}
        </div>
      )}
      {phone && (
        <div className="absolute inset-y-0 left-1/2 w-[31.64%] -translate-x-1/2">
          <span className="absolute inset-y-0 left-0 w-px bg-line" />
          <span className="absolute inset-y-0 right-0 w-px bg-line" />
          <div className={cn('fcc-feed-hud-bottom absolute bottom-5 left-3 right-3 flex flex-col gap-0.5 text-bone-dim', micro)}>
            <span className="text-amber">Fictional clip · simulated</span>
            <span className="fcc-num">Location approx · {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}</span>
          </div>
        </div>
      )}
      <div className={cn('fcc-feed-hud-bottom fcc-num absolute bottom-5 right-6 flex max-w-[35%] flex-wrap justify-end gap-x-3 gap-y-1 text-bone-dim', micro)}>
        <span className="text-bone">{stamp}</span>
        <span>F {pad(frame.frame % 100000, 5)}</span>
        {(frame.replayRate ?? 1) > 1 && <span>REPLAY {frame.replayRate}×</span>}
      </div>
    </div>
  );
}
