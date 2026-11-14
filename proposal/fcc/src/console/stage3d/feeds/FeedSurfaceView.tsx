import { useEffect, useRef, useState } from 'react';
import { cn, fmtLat, fmtLon, pad, zulu } from '@ds';
import type { Feed } from '../../contracts';
import { MODEL_LABEL } from '../fx';
import { useStageWorld } from '../world';
import { FeedRenderer, FULL_H, FULL_W, THUMB_H, THUMB_W, type Detection, type FeedFrame } from './FeedRenderer';
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
  const [frame, setFrame] = useState<FeedFrame | null>(null);
  const [failed, setFailed] = useState(false);
  const feed = useStageWorld((s) => s.feeds.find((f) => f.id === feedId));
  const t = useStageWorld((s) => s.t);
  const hasFeed = !!feed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasFeed) return;
    const r = FeedRenderer.get();
    if (!r) {
      setFailed(true);
      return;
    }
    setFrame(null);
    return r.register({ feedId, variant, canvas, onFrame: setFrame });
  }, [feedId, variant, hasFeed]);

  const full = variant === 'full';
  const showHud = hud !== 'none';

  return (
    <div className={cn('fcc-sensor relative h-full w-full overflow-hidden bg-void', className)}>
      <canvas
        ref={canvasRef}
        width={full ? FULL_W : THUMB_W}
        height={full ? FULL_H : THUMB_H}
        className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-base ease-servo', frame ? 'opacity-100' : 'opacity-0')}
        aria-label={feed ? `Simulated camera feed ${feed.label}` : 'Camera feed'}
        role="img"
      />
      {!frame && <Acquiring failed={failed || !feed} full={full} label={feed?.label} />}
      {frame && showHud && feed && (full ? <FullHud feed={feed} frame={frame} t={t} /> : <ThumbHud feed={feed} frame={frame} />)}
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
        <span className="text-bone-mute">{feed.label}</span>
      </div>
      <div className={cn('fcc-num absolute right-6 top-5 flex items-center gap-3 text-bone-dim', micro)}>
        {frame.nuc && <span className="bg-bone px-1 text-void">NUC</span>}
        <span className="text-bone">{frame.sat?.real ? frame.sat.sensor : MODEL_LABEL[m]}</span>
        {!frame.sat?.real && <span>FOV {Math.round(p.fovDeg)}°</span>}
        <span>{feed.kind.replace('-', ' ')}</span>
      </div>

      {sat.badge && (
        <div className={cn('absolute left-1/2 top-5 -translate-x-1/2 px-1.5', micro, sat.real ? 'bg-void/70 text-bone' : 'bg-amber text-void')}>{sat.badge}{frame.detections.length > 0 ? ' · simulated annotations' : ''}</div>
      )}

      {uav && (
        <div className={cn('fcc-num absolute bottom-5 left-6 flex items-center gap-4 text-bone-dim', micro)}>
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
        <div className={cn('fcc-num absolute bottom-5 left-6 flex items-center gap-4 text-bone-dim', micro)}>
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
        <div className="fcc-num absolute bottom-4 left-5 bg-void/40 px-1 font-mono text-micro tabular-nums text-bone">
          {date} {stamp} &nbsp; {callsign} &nbsp; {pad(kmh, 3)} KM/H &nbsp; {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}
        </div>
      )}
      {phone && (
        <div className="absolute inset-y-0 left-1/2 w-[31.64%] -translate-x-1/2">
          <span className="absolute inset-y-0 left-0 w-px bg-line" />
          <span className="absolute inset-y-0 right-0 w-px bg-line" />
          <div className={cn('absolute bottom-5 left-3 right-3 flex flex-col gap-0.5 text-bone-dim', micro)}>
            <span className="text-amber">Fictional clip · simulated</span>
            <span className="fcc-num">Location approx · {fmtLat(p.geo.lat)} {fmtLon(p.geo.lon)}</span>
          </div>
        </div>
      )}
      <div className={cn('fcc-num absolute bottom-5 right-6 flex items-center gap-3 text-bone-dim', micro)}>
        <span className="text-bone">{stamp}</span>
        <span>F {pad(frame.frame % 100000, 5)}</span>
      </div>
    </div>
  );
}
