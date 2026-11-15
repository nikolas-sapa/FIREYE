import { useEffect, useRef, useState } from 'react';
import { cn, fmtLat, fmtLon, pad } from '@ds';
import type { Geo } from '../contracts';
import { hasWebGL } from './capabilities';
import { prefersReducedMotion } from './easing';
import { FeedSurfaceView } from './feeds/FeedSurfaceView';
import { StageEngine, type StageStatus } from './StageEngine';
import { useStageWorld } from './world';
import './stage.css';
import { MapControls } from './MapControls';
import { useMapSettings } from './map-settings';
import { getProfile } from './profile';
import { formatMeters, scaleDistance } from './cartography';

export type StageSelectKind = 'unit' | 'finding' | 'place' | 'action';

export interface StageProps {
  /** Extension layers may attach to this engine without starting the replay runtime. */
  onEngineReady?: (engine: StageEngine | null) => void;
  className?: string;
  /**
   * Called when the user clicks a unit / finding / place / action route on the globe (null = empty ground).
   * The stage always flies to the clicked object and calls `api.focus`; use this to also open details.
   */
  onSelect?: (id: string | null, kind: StageSelectKind | null) => void;
  /** Controlled selection (signal brackets). When omitted the stage tracks its own last click. */
  selectedId?: string | null;
  /** Camera readout + basemap tag, bottom-right. Default true. */
  hud?: boolean;
  /** Extra classes for the credits container (bottom-left by default). */
  creditsClassName?: string;
  /** Built-in Outline/Satellite and layer controls, top-right. Default true. */
  mapControls?: boolean;
}


const BASEMAP_SHORT: Record<string, string> = {
  'google-3d': 'Google 3D',
  'ion-world': 'Cesium ion',
  offline: 'Offline DEM',
};

const FADE_MS = 420;

/** Store-agnostic stage (reads the stage mirror). `Stage` wraps this with the console store. */
export function StageView({
  className, onSelect, selectedId, hud = true, creditsClassName, onFocusRequest, onEngineReady, mapControls = true,
}: StageProps & { onFocusRequest?: (g: Geo, rangeM?: number) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StageEngine | null>(null);
  const [status, setStatus] = useState<StageStatus>({ phase: 'boot' });
  const [localSel, setLocalSel] = useState<string | null>(null);
  const cbRef = useRef({ onSelect, onFocusRequest });
  cbRef.current = { onSelect, onFocusRequest };
  const sel = selectedId !== undefined ? selectedId : localSel;
  const webgl = hasWebGL();
  const pack = useStageWorld((s) => s.pack);

  useEffect(() => {
    if (status.phase === 'ready') onEngineReady?.(engineRef.current);
    return () => { onEngineReady?.(null); };
  }, [status.phase, onEngineReady]);

  useEffect(() => {
    if (!hostRef.current || !webgl) return;
    let engine: StageEngine;
    try {
      engine = new StageEngine({
        container: hostRef.current,
        creditContainer: creditRef.current ?? undefined,
        onStatus: setStatus,
        onSelect: (id, kind) => {
          setLocalSel(id);
          if (id) {
            const g = engine.geoOf(id);
            if (g) {
              const range = kind === 'place' ? 5000 : 2200;
              engine.flyTo(g, { rangeM: range, duration: 1.6 });
              cbRef.current.onFocusRequest?.(g, range);
            }
          }
          cbRef.current.onSelect?.(id, kind);
        },
      });
    } catch (err) {
      setStatus({ phase: 'error', error: String(err) });
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [webgl]);

  useEffect(() => {
    engineRef.current?.setSelected(sel ?? null);
  }, [sel, status.phase]);

  /* feed mode crossfade */
  const mode = useStageWorld((s) => s.stage.mode);
  const stageFeedId = useStageWorld((s) => s.stage.feedId);
  const feedOn = mode === 'feed' && !!stageFeedId;
  const [feedMounted, setFeedMounted] = useState<string | null>(feedOn ? stageFeedId! : null);
  const [feedVisible, setFeedVisible] = useState(false);
  useEffect(() => {
    const reduced = prefersReducedMotion();
    if (feedOn) {
      setFeedMounted(stageFeedId!);
      const r = requestAnimationFrame(() => setFeedVisible(true));
      const tm = window.setTimeout(() => engineRef.current?.setActive(false), reduced ? 0 : FADE_MS + 60);
      return () => {
        cancelAnimationFrame(r);
        window.clearTimeout(tm);
      };
    }
    engineRef.current?.setActive(true);
    setFeedVisible(false);
    const tm = window.setTimeout(() => setFeedMounted(null), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(tm);
  }, [feedOn, stageFeedId]);

  return (
    <div className={cn('fcc-stage relative h-full w-full overflow-hidden bg-void', className)}>
      <div ref={hostRef} className="absolute inset-0" />
      {status.phase === 'ready' && <StageOverlay engineRef={engineRef} />}
      {status.phase === 'ready' && !feedOn && mapControls && <MapControls contourM={pack ? getProfile(pack).contourM : 40} />}
      {!webgl || status.phase === 'error' ? (
        <StageFallback reason={!webgl ? 'WebGL unavailable' : status.error ?? 'Renderer error'} />
      ) : (
        status.phase !== 'ready' && <StageLoading phase={status.phase} />
      )}
      {hud && status.phase === 'ready' && <CameraHud engineRef={engineRef} basemap={status.basemap} />}
      <div
        ref={creditRef}
        className={cn('fcc-stage-credits absolute bottom-1.5 left-4 z-[1] whitespace-nowrap', creditsClassName)}
      />
      {feedMounted && (
        <div
          className={cn(
            'absolute inset-0 z-[2] transition-opacity duration-slow ease-servo',
            feedVisible && feedOn ? 'opacity-100' : 'opacity-0',
          )}
        >
          <FeedSurfaceView feedId={feedMounted} variant="full" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ DOM overlay: highlights + dim spotlight */

function StageOverlay({ engineRef }: { engineRef: React.MutableRefObject<StageEngine | null> }) {
  const highlight = useStageWorld((s) => s.stage.highlight);
  const dimmed = useStageWorld((s) => s.stage.dimmed);
  const directives = useStageWorld((s) => s.directives);
  const dimRef = useRef<HTMLDivElement>(null);
  const ringRefs = useRef(new Map<string, HTMLDivElement>());

  let spotId: string | null = null;
  if (dimmed) {
    const d = directives.find((x) => x.kind === 'dimOthers');
    spotId = d && d.kind === 'dimOthers' && d.on ? d.itemId : highlight[0] ?? null;
  }

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    return engine.onFrame(() => {
      for (const [id, el] of ringRefs.current) {
        const p = engine.screenOf(id);
        if (!p) {
          el.style.opacity = '0';
          continue;
        }
        const size = Math.min(220, Math.max(44, p.radiusPx * 2 + 24));
        el.style.opacity = '1';
        el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
        el.style.width = el.style.height = `${size}px`;
      }
      const dim = dimRef.current;
      if (dim) {
        const p = spotId ? engine.screenOf(spotId) : null;
        if (p) {
          const r = Math.min(260, Math.max(90, p.radiusPx + 70));
          dim.style.background = `radial-gradient(circle at ${p.x}px ${p.y}px, transparent ${r}px, rgb(var(--void) / 0.74) ${r + 140}px)`;
        } else {
          dim.style.background = 'rgb(var(--void) / 0.6)';
        }
      }
    });
  }, [engineRef, spotId]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      <div
        ref={dimRef}
        className={cn('absolute inset-0 transition-opacity duration-slow ease-servo', dimmed ? 'opacity-100' : 'opacity-0')}
      />
      {highlight.map((id) => (
        <div
          key={id}
          ref={(el) => {
            if (el) ringRefs.current.set(id, el);
            else ringRefs.current.delete(id);
          }}
          className="absolute left-0 top-0 opacity-0"
        >
          <span className="absolute inset-[18%] rounded-pill border border-signal/80" />
          <span className="fcc-stage-pulse h-full w-full" />
          <span className="fcc-stage-pulse delay h-full w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ HUD + states */

function CameraHud({ engineRef, basemap }: { engineRef: React.MutableRefObject<StageEngine | null>; basemap?: string }) {
  const settings = useMapSettings();
  const ref = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const scaleBarRef = useRef<HTMLSpanElement>(null);
  const scaleLabelRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let n = 0;
    return engine.onFrame(() => {
      if (n++ % 8 || !ref.current) return;
      const c = engine.cameraInfo();
      const alt = c.altM >= 10000 ? `${(c.altM / 1000).toFixed(1)} KM` : `${Math.round(c.altM)} M`;
      const pos = c.center ? `${fmtLat(c.center.lat, 3)} ${fmtLon(c.center.lon, 3)}` : '—';
      ref.current.textContent = `HDG ${pad(Math.round(c.headingDeg) % 360, 3)}° · PITCH ${Math.round(c.pitchDeg)}° · ALT ${alt} · ${pos}`;
      const mpp = c.metersPerPixel ?? 0;
      const distance = scaleDistance(mpp);
      if (scaleRef.current) scaleRef.current.hidden = !distance;
      if (scaleBarRef.current && distance) scaleBarRef.current.style.width = `${distance / mpp}px`;
      if (scaleLabelRef.current) scaleLabelRef.current.textContent = formatMeters(distance);
      if (detailRef.current) detailRef.current.textContent = settings.mode === 'outline'
        ? `${c.streamedContext ? 'STREAMED' : 'LOCAL FALLBACK'} · ${c.localTerrain ? `DEM ~${formatMeters(c.demSpacingM ?? 0)}` : 'OUTSIDE LOCAL DEM'}`
        : '';
    });
  }, [engineRef, settings.mode]);
  return (
    <div className="pointer-events-none absolute bottom-1.5 right-4 z-[1] flex flex-col items-end gap-1 font-mono text-micro uppercase text-bone-mute">
      <div ref={scaleRef} className="flex items-end gap-2 bg-ink-950/90 px-2 py-1" hidden>
        <span ref={detailRef} className="fcc-num mr-2" />
        <span ref={scaleBarRef} className="mb-0.5 inline-block h-1.5 border-x border-b border-bone-dim" />
        <span ref={scaleLabelRef} className="fcc-num text-bone-dim" />
      </div>
      <div className="flex items-center gap-3 bg-ink-950/85 px-1">
        <span ref={ref} className="fcc-num" />
        {basemap && <span className="text-bone-dim">{settings.mode === 'outline' ? 'Outline · Cartography' : BASEMAP_SHORT[basemap] ?? basemap}</span>}
      </div>
    </div>
  );
}

function StageLoading({ phase }: { phase: StageStatus['phase'] }) {
  const hasPack = useStageWorld((s) => !!s.pack);
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <span className="h-px w-24 overflow-hidden bg-line">
          <span className="block h-px w-8 animate-pulse bg-bone-mute" />
        </span>
        <span className="font-mono text-nano uppercase text-bone-mute">
          {!hasPack ? 'Stage · awaiting scenario pack' : phase === 'loading' ? 'Stage · preparing terrain and cartography' : 'Stage · initialising'}
        </span>
      </div>
    </div>
  );
}

function StageFallback({ reason }: { reason: string }) {
  return (
    <div className="absolute inset-0 z-[1] flex items-center justify-center bg-ink-950">
      <div className="flex flex-col items-center gap-1 border border-line px-6 py-4">
        <span className="font-mono text-nano uppercase text-amber">3D stage unavailable</span>
        <span className="max-w-md text-center font-mono text-micro uppercase text-bone-mute">{reason}</span>
      </div>
    </div>
  );
}
