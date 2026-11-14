import { useEffect, useRef, useState } from 'react';
import { Brackets, Button, Confidence, FeedTile, Freshness, Icon, IconButton, cn, fmtLat, fmtLon, toneClass } from '@ds';
import { CameraView } from '@/dashboard/map';
import type { CameraFeed, Observation, SimSnapshotB } from '@/sim/types';
import { ageLabel, cellToLatLon, fmtInt, mmss, obsIcon, obsKindLabel, obsTone, sourceCode, sourceIcon } from './format';
import { KV } from './ui';

export function TitleBlock() {
  return (
    <div className="flex h-6 items-center gap-2 border border-line bg-ink-950/90 px-2 font-mono text-micro uppercase text-bone-dim">
      <span className="text-bone">AO Ridge</span>
      <span className="text-ink-500">·</span>
      <span>EO composite</span>
      <span className="text-ink-500">·</span>
      <span>Rev B</span>
    </div>
  );
}

/** Forecast revision chip; flashes briefly whenever the projection agent re-projects. */
export function PathChip({ rev, t }: { rev: number; t: number }) {
  const tRef = useRef(t);
  tRef.current = t;
  const [revAt, setRevAt] = useState(t);
  const [flash, setFlash] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRevAt(tRef.current);
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(id);
  }, [rev]);

  return (
    <div
      className={cn(
        'flex h-6 items-center gap-2 border px-2 font-mono text-micro uppercase transition-colors duration-slow ease-servo fcc-num',
        flash ? 'border-amber/60 bg-amber/10 text-amber' : 'border-line bg-ink-950/90 text-bone-dim',
      )}
    >
      <span aria-hidden className="h-0 w-3 border-t border-dashed border-amber" />
      <span>
        Path rev {String(rev).padStart(2, '0')} · {mmss(t - revAt)} ago
      </span>
    </div>
  );
}

export function MetricStrip({ state }: { state: SimSnapshotB }) {
  const m = state.metrics;
  const animals = state.observations.filter((o) => o.kind === 'animal' && o.freshness > 0.05).length;
  const lives = m.personsAtRisk;
  const cells = [
    { k: 'Acres', v: fmtInt(m.acres), tone: 'text-bone' },
    { k: 'Contained', v: `${Math.round(m.containmentPct)}`, u: '%', tone: 'text-phosphor' },
    { k: 'ROS', v: m.rateOfSpreadMpm.toFixed(1), u: 'M/MIN', tone: m.rateOfSpreadMpm > 20 ? 'text-amber' : 'text-bone' },
    { k: 'Lives at risk', v: fmtInt(lives), u: animals > 0 ? `+${animals} ANML` : undefined, tone: lives > 0 ? 'text-ember' : 'text-phosphor' },
  ];
  return (
    <dl className="flex gap-px border border-line bg-line">
      {cells.map((c) => (
        <div key={c.k} className="min-w-[76px] bg-ink-950/90 px-2.5 py-1.5">
          <dt className="fcc-micro whitespace-nowrap">{c.k}</dt>
          <dd className={cn('mt-0.5 whitespace-nowrap font-mono text-sm leading-tight fcc-num', c.tone)}>
            {c.v}
            {c.u && <span className="ml-1 text-micro text-bone-mute">{c.u}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PipCamera({
  feed,
  feeds,
  caption,
  onSwap,
  onClose,
}: {
  feed: CameraFeed;
  feeds: CameraFeed[];
  caption?: string;
  onSwap(id: string): void;
  onClose(): void;
}) {
  const i = feeds.findIndex((f) => f.id === feed.id);
  const step = (d: number) => {
    if (feeds.length < 2) return;
    onSwap(feeds[(i + d + feeds.length) % feeds.length].id);
  };
  return (
    <div className="pointer-events-auto relative w-[320px] animate-rise border border-line-strong bg-ink-950 shadow-lift">
      <div className="flex h-7 items-center gap-1 border-b border-line pl-2.5 pr-0.5">
        <Icon name="camera" size={12} className="shrink-0 text-bone-mute" />
        <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase text-bone-dim">
          {caption ? (
            <>
              <span className="text-bone-mute">Source for </span>
              <span className="text-bone">{caption}</span>
            </>
          ) : (
            'Camera'
          )}
        </span>
        <IconButton icon="chevron-left" label="Previous feed" size="sm" variant="ghost" onClick={() => step(-1)} disabled={feeds.length < 2} />
        <IconButton icon="chevron-right" label="Next feed" size="sm" variant="ghost" onClick={() => step(1)} disabled={feeds.length < 2} />
        <IconButton icon="close" label="Close camera" size="sm" variant="ghost" onClick={onClose} />
      </div>
      <FeedTile
        label={feed.label}
        live={feed.live}
        meta={feed.detections > 0 ? <span className="text-violet fcc-num">{feed.detections} DET</span> : undefined}
        className="border-0"
      >
        <CameraView key={feed.id} feedId={feed.id} variant="full" />
      </FeedTile>
    </div>
  );
}

export function ObservationCard({ obs, t, onClose }: { obs: Observation; t: number; onClose(): void }) {
  const [tasked, setTasked] = useState(false);
  const ll = cellToLatLon(obs.pos);
  const tone = toneClass[obsTone[obs.kind]];
  return (
    <div className="pointer-events-auto relative w-[320px] animate-rise border border-line-strong bg-ink-950/95 shadow-lift">
      <Brackets size={6} tone="bone" />
      <div className="flex items-center gap-2.5 border-b border-line py-2 pl-3 pr-1">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center border border-line', tone.text)}>
          <Icon name={obsIcon[obs.kind]} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="fcc-micro truncate">{obsKindLabel[obs.kind]}</div>
          <div className="truncate font-mono text-tiny uppercase text-bone">{obs.label}</div>
        </div>
        <Freshness freshness={obs.freshness} live={obs.live} age={ageLabel(t - obs.observedAt)} />
        <IconButton icon="close" label="Close inspector" size="sm" variant="ghost" onClick={onClose} />
      </div>
      <div className="px-3 py-2">
        <KV
          k="Source"
          v={
            <span className="inline-flex items-center gap-1.5">
              <Icon name={sourceIcon[obs.source]} size={10} className="text-bone-mute" />
              {sourceCode[obs.source]} · {obs.sourceLabel}
            </span>
          }
        />
        {obs.count != null && obs.count > 0 && <KV k="Count" v={obs.count} tone="text-violet" />}
        {obs.sources != null && obs.sources > 1 && <KV k="Reports" v={`${obs.sources} independent`} />}
        <KV k="Location" v={`${fmtLat(ll.lat)} ${fmtLon(ll.lon)}`} />
        <KV k="Accuracy" v={obs.live || obs.confirmed ? 'LIVE FIX' : `± ${fmtInt(obs.uncertaintyM)} M · APPROX`} tone={obs.live || obs.confirmed ? 'text-phosphor' : 'text-amber'} />
        <div className="flex items-center justify-between gap-3 py-0.5">
          <span className="fcc-micro">Confidence</span>
          <Confidence value={obs.confidence} showValue />
        </div>
        {!obs.live && !obs.confirmed && (
          <Button size="sm" variant="secondary" icon={tasked ? 'check' : 'drone'} className="mt-2 w-full" onClick={() => setTasked(true)} disabled={tasked}>
            {tasked ? 'Drone tasked · confirming' : 'Confirm with drone'}
          </Button>
        )}
      </div>
    </div>
  );
}
