import { useMemo } from 'react';
import { Dot, Icon, cn } from '@ds';
import type { Feed } from '../../contracts';
import { FeedSurfaceView } from '../../stage3d/feeds/FeedSurfaceView';
import { useStageWorld } from '../../stage3d/world';
import { SurfaceBoundary } from '../../ui/SurfaceBoundary';
import { isUav, sensorOf } from './sync';
import { fireyeUi, useFireye } from './ui';

const KIND: Record<Feed['kind'], string> = {
  'uav-nadir': 'UAV nadir', 'uav-oblique': 'UAV oblique', 'uav-chase': 'UAV chase', 'dash-cam': 'Dash cam', 'helmet-cam': 'Helmet cam',
  'ridge-cam': 'Ridge cam', satellite: 'Satellite', social: 'Social',
};

function SensorToggle({ feed, compact }: { feed: Feed; compact?: boolean }) {
  const s = sensorOf(feed);
  return (
    <div role="group" aria-label={`${feed.label} sensor`} className="flex border border-line-strong bg-ink-950/90" onClick={(e) => e.stopPropagation()}>
      {(['eo', 'thermal'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={s === m} title={m === 'thermal' ? 'Simulated thermal, not radiometric' : 'Electro-optical'}
          onClick={(e) => { e.stopPropagation(); if (s !== m) fireyeUi.toggleFx(feed.id, s); }}
          className={cn('font-mono uppercase leading-none tracking-[0.1em] transition-colors duration-quick ease-servo',
            compact ? 'px-1 py-0.5 text-micro' : 'px-1.5 py-1 text-micro', m === 'thermal' && 'border-l border-line',
            s === m ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
          {m === 'eo' ? 'EO' : 'THRM'}
        </button>
      ))}
    </div>
  );
}

function Rel({ v }: { v: number }) {
  return (
    <span className="pointer-events-none inline-flex items-center gap-1 bg-ink-950/80 px-1 py-px font-mono text-micro text-bone-dim fcc-num">
      <span aria-hidden className="flex h-1 w-6 gap-px">
        {[0, 1, 2, 3].map((i) => <span key={i} className={cn('flex-1', v >= 25 * (i + 1) - 12 ? 'bg-ice' : 'bg-ink-600')} />)}
      </span>
      {String(Math.round(v)).padStart(2, '0')}
    </span>
  );
}

function Tile({ feed, lead, active, onOpen }: { feed: Feed; lead?: boolean; active: boolean; onOpen: (id: string) => void }) {
  const name = feed.label.split(' · ')[0] ?? feed.label;
  const uav = isUav(feed);
  return (
    <div className={cn('group/tile relative shrink-0 overflow-hidden border bg-void transition-[border-color] duration-quick ease-servo',
      lead ? 'h-full aspect-video' : 'aspect-video h-[calc(50%-3px)]',
      active ? 'border-signal/60' : 'border-line hover:border-line-strong')}>
      <button type="button" onClick={() => onOpen(feed.id)} aria-label={`${feed.label}. ${uav ? 'Dive into feed' : 'Open feed'}`}
        className="absolute inset-0 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-signal">
        <SurfaceBoundary label="Feed" className="absolute inset-0">
          <FeedSurfaceView feedId={feed.id} variant="thumb" hud={lead ? 'auto' : 'none'} className="absolute inset-0 h-full w-full" />
        </SurfaceBoundary>
        <span aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines" />
      </button>
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-ink-950/75 px-1.5 py-0.5">
        {feed.live ? <Dot className="bg-ember" live={lead} size={4} /> : <span className="h-1 w-1 border border-ink-400" />}
        <span className={cn('truncate font-mono uppercase leading-3 tracking-[0.08em] text-bone', lead ? 'text-micro' : 'text-micro')}>{lead ? feed.label : name}</span>
        {lead && <span className="ml-auto shrink-0 font-mono text-micro uppercase text-bone-mute">{KIND[feed.kind]}</span>}
      </span>
      <span className="absolute bottom-1 left-1 flex items-center gap-1">
        {lead && <Rel v={feed.relevance} />}
        {feed.findingIds.length > 0 && <span className="pointer-events-none bg-ink-950/80 px-1 py-px font-mono text-micro leading-3 text-violet fcc-num">{feed.findingIds.length} DET</span>}
      </span>
      {uav && <span className="absolute bottom-1 right-1"><SensorToggle feed={feed} compact={!lead} /></span>}
      {lead && uav && (
        <span className="pointer-events-none absolute right-1.5 top-6 flex items-center gap-1 bg-ink-950/80 px-1.5 py-0.5 font-mono text-micro uppercase text-bone-dim opacity-0 transition-opacity duration-quick ease-servo group-hover/tile:opacity-100">
          <Icon name="expand" size={9} />Dive
        </span>
      )}
    </div>
  );
}

/** Relevance-ordered feed wall: an enlarged lead tile and a two-row grid of thumbnails. */
export function FeedDeck({ onOpen }: { onOpen: (feedId: string) => void }) {
  const feeds = useStageWorld((s) => s.feeds);
  const active = useFireye((s) => (s.dive.phase !== 'idle' ? s.dive.feedId : undefined));
  // Bucket relevance so near-ties do not reshuffle the wall every tick.
  const ordered = useMemo(() => [...feeds].filter((f) => f.kind !== 'social')
    .sort((a, b) => Math.round(b.relevance / 8) - Math.round(a.relevance / 8) || Number(isUav(b)) - Number(isUav(a)) || (a.id < b.id ? -1 : 1)), [feeds]);
  const [lead, ...rest] = ordered;
  const live = feeds.filter((f) => f.live).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 px-3">
        <Icon name="camera" size={11} className="text-bone-mute" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Feeds</span>
        <span className="fcc-num font-mono text-micro uppercase text-bone-mute">{String(live).padStart(2, '0')} live · ordered by orchestrator relevance · click a drone to dive</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto overflow-y-hidden px-3 pb-2">
        {!lead && <div className="fcc-hatch flex h-full w-full items-center justify-center font-mono text-micro uppercase text-bone-mute">No feeds yet</div>}
        {lead && <Tile key={lead.id} feed={lead} lead active={active === lead.id} onOpen={onOpen} />}
        <div className="flex h-full flex-col flex-wrap content-start gap-1.5">
          {rest.map((f) => <Tile key={f.id} feed={f} active={active === f.id} onOpen={onOpen} />)}
        </div>
      </div>
    </div>
  );
}
