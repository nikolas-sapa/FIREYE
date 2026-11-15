import { useEffect, useRef } from 'react';
import { Icon, cn } from '@ds';
import { cameraOps, type SavedView } from '../../stage3d/camera-ops';
import { prefersReducedMotion } from '../../stage3d/easing';
import { FeedSurfaceView } from '../../stage3d/feeds/FeedSurfaceView';
import type { StageEngine } from '../../stage3d/StageEngine';
import { stageWorld, useStageWorld } from '../../stage3d/world';
import { isUav, sensorOf } from './sync';
import { fireyeUi, useFireye } from './ui';

const LOCK_MS = 200;
const FLY_S = 1.8;
const WIPE_MS = 350;
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, prefersReducedMotion() ? 0 : ms));

let engine: StageEngine | null = null;
let saved: SavedView | null = null;
let token = 0;

/**
 * The dive: lock brackets on the target, fly the main camera to the drone's sensor pose, then a
 * scanline wipe hands off to the full feed and the globe stops rendering. `exit` reverses it.
 */
export const dive = {
  attach(e: StageEngine | null) { engine = e; },
  async enter(feedId: string) {
    const ui = fireyeUi.get();
    const feed = stageWorld.get().feeds.find((f) => f.id === feedId);
    if (!feed || !engine) return;
    if (ui.dive.phase === 'feed') {
      // Already in a feed: switch directly.
      fireyeUi.set({ dive: { phase: 'feed', feedId, unitId: feed.unitId } });
      return;
    }
    if (ui.dive.phase !== 'idle') return;
    const my = ++token;
    fireyeUi.set({ orbit: false, panel: null });
    saved = cameraOps.save(engine);
    if (isUav(feed) && feed.unitId) {
      fireyeUi.set({ selected: feed.unitId, dive: { phase: 'lock', feedId, unitId: feed.unitId } });
      await wait(LOCK_MS);
      if (my !== token || !engine) return;
      fireyeUi.set({ dive: { phase: 'flying', feedId, unitId: feed.unitId } });
      await cameraOps.diveTo(engine, feed, FLY_S);
      if (my !== token || !engine) return;
    }
    fireyeUi.set({ dive: { phase: 'wipe', feedId, unitId: feed.unitId } });
    await wait(WIPE_MS);
    if (my !== token || !engine) return;
    engine.setActive(false);
    fireyeUi.set({ dive: { phase: 'feed', feedId, unitId: feed.unitId } });
  },
  async exit() {
    const ui = fireyeUi.get();
    if (ui.dive.phase === 'idle' || ui.dive.phase === 'exiting') return;
    const my = ++token;
    const e = engine;
    e?.viewer.camera.cancelFlight();
    e?.setActive(true);
    const wasFeed = ui.dive.phase === 'feed' || ui.dive.phase === 'wipe';
    fireyeUi.set({ dive: { ...ui.dive, phase: 'exiting' } });
    if (wasFeed) await wait(WIPE_MS);
    if (my !== token) return;
    fireyeUi.set({ dive: { phase: 'idle' } });
    if (e && saved) await cameraOps.restore(e, saved, 1.4);
    saved = null;
  },
};

function Corners({ className }: { className?: string }) {
  const c = 'absolute h-4 w-4 border-bone';
  return (
    <div aria-hidden className={cn('fireye-brackets pointer-events-none absolute inset-0', className)}>
      <span className={cn(c, 'left-0 top-0 border-l border-t')} />
      <span className={cn(c, 'right-0 top-0 border-r border-t')} />
      <span className={cn(c, 'bottom-0 right-0 border-b border-r')} />
      <span className={cn(c, 'bottom-0 left-0 border-b border-l')} />
    </div>
  );
}

/** Lock brackets that follow the target on screen while locking and flying. */
function TargetLock({ engine, unitId, label }: { engine: StageEngine; unitId: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => engine.onFrame(() => {
    const el = ref.current;
    const p = engine.screenOf(unitId);
    if (!el) return;
    if (!p) { el.style.opacity = '0'; return; }
    el.style.opacity = '1';
    el.style.transform = `translate(${p.x - 32}px, ${p.y - 32}px)`;
  }), [engine, unitId]);
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 h-16 w-16">
      <div className="fireye-lock absolute inset-0">
        <span className="absolute inset-0 shadow-signal" />
        <Corners />
        <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 bg-signal" />
      </div>
      <span className="absolute left-full top-0 ml-2 whitespace-nowrap bg-ink-950/90 px-1.5 py-0.5 font-mono text-micro uppercase tracking-[0.14em] text-bone">
        Lock · {label}
      </span>
    </div>
  );
}

/** Everything the dive draws above the globe: target lock, hand-off wipe and the full-feed HUD. */
export function DiveLayer({ engine }: { engine: StageEngine | null }) {
  const d = useFireye((s) => s.dive);
  const feed = useStageWorld((s) => (d.feedId ? s.feeds.find((f) => f.id === d.feedId) : undefined));
  const unit = useStageWorld((s) => (d.unitId ? s.units.find((u) => u.id === d.unitId) : undefined));
  if (d.phase === 'idle' || !feed) return null;
  const showFeed = d.phase === 'wipe' || d.phase === 'feed' || d.phase === 'exiting';
  const name = unit?.callsign ?? feed.label.split(' · ')[0] ?? feed.label;
  const uav = isUav(feed);
  return (
    <div className="absolute inset-0 z-[3]">
      {(d.phase === 'lock' || d.phase === 'flying') && engine && d.unitId && <TargetLock engine={engine} unitId={d.unitId} label={name} />}
      {d.phase === 'flying' && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <span className="fireye-fade bg-ink-950/90 px-2 py-1 font-mono text-micro uppercase tracking-[0.16em] text-bone-dim">Transferring to {name} · {feed.modality ?? 'unknown'} source</span>
        </div>
      )}
      {showFeed && (
        <div key={`${feed.id}-${d.phase === 'exiting' ? 'out' : 'in'}`}
          className={cn('fireye-wipe-host absolute inset-0 bg-void', d.phase === 'exiting' ? 'fireye-unwipe' : 'fireye-reveal')}>
          <FeedSurfaceView feedId={feed.id} variant="full" className="absolute inset-0 h-full w-full" />
        </div>
      )}
      {(d.phase === 'wipe' || d.phase === 'exiting') && <span key={d.phase} aria-hidden className={cn('fireye-scan', d.phase === 'exiting' && '[animation-direction:reverse]')} />}
      {d.phase === 'feed' && (
        <>
          <Corners className="fireye-fade m-6" />
          <div className="absolute left-6 top-6 flex items-center gap-2">
            <button type="button" onClick={() => void dive.exit()} autoFocus
              className="flex h-8 items-center gap-2 border border-line-strong bg-ink-950/90 px-3 font-mono text-micro uppercase tracking-[0.14em] text-bone hover:bg-ink-800 focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal">
              <Icon name="chevron-left" size={11} />Back to globe<span className="text-bone-mute">Esc</span>
            </button>
            <span className="flex h-8 items-center gap-2 border border-line bg-ink-950/90 px-3 font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">
              {feed.label}
            </span>
            {uav && (
              <div role="group" aria-label="Display palette, not source modality" className="flex h-8 border border-line-strong bg-ink-950/90">
                {(['eo', 'thermal'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={sensorOf(feed) === m} onClick={() => sensorOf(feed) !== m && fireyeUi.toggleFx(feed.id, sensorOf(feed))}
                    className={cn('px-3 font-mono text-micro uppercase tracking-[0.14em]', m === 'thermal' && 'border-l border-line', sensorOf(feed) === m ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
                    {m === 'eo' ? 'EO FX' : 'IR FX'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
