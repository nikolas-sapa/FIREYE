import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dot, Icon, cn } from '@ds';
import type { Feed } from '../../contracts';
import { FeedSurfaceView } from '../../stage3d/feeds/FeedSurfaceView';
import { useConsoleSelector } from '../../store';
import { useStageWorld } from '../../stage3d/world';
import { SurfaceBoundary } from '../../ui/SurfaceBoundary';
import { orderFeedsByRelevance } from '../data/feed-order';
import { isReconFeed, isUav, sensorOf } from './sync';
import { fireyeUi, useFireye } from './ui';

const KIND: Record<Feed['kind'], string> = {
  'uav-nadir': 'UAV nadir', 'uav-oblique': 'UAV oblique', 'uav-chase': 'UAV chase', 'dash-cam': 'Dash cam', 'helmet-cam': 'Helmet cam',
  'ridge-cam': 'Ridge cam', satellite: 'Satellite', social: 'Social',
};

function SensorToggle({ feed, compact }: { feed: Feed; compact?: boolean }) {
  const s = sensorOf(feed);
  return (
    <div role="group" aria-label={`${feed.label} display palette, not source modality`} className="flex border border-line-strong bg-ink-950/90" onClick={(e) => e.stopPropagation()}>
      {(['eo', 'thermal'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={s === m} title={`Display palette only; source channel remains ${feed.modality ?? 'unknown'}`}
          onClick={(e) => { e.stopPropagation(); if (s !== m) fireyeUi.toggleFx(feed.id, s); }}
          className={cn('font-mono uppercase leading-none tracking-[0.1em] transition-colors duration-quick ease-servo',
            compact ? 'px-1 py-0.5 text-micro' : 'px-1.5 py-1 text-micro', m === 'thermal' && 'border-l border-line',
            s === m ? 'bg-ink-700 text-bone' : 'text-bone-mute hover:text-bone-dim')}>
          {m === 'eo' ? 'EO FX' : 'IR FX'}
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
    <div role="listitem" data-feed-id={feed.id} data-relevance={feed.relevance} className={cn('group/tile relative h-full aspect-video shrink-0 overflow-hidden border bg-void transition-[border-color] duration-quick ease-servo',
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
        <Rel v={feed.relevance} />
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

/** One continuous, relevance-ordered row. Offscreen views remain scrollable, not duplicated. */
export function FeedDeck({ onOpen }: { onOpen: (feedId: string) => void }) {
  const feeds = useStageWorld((s) => s.feeds);
  const active = useFireye((s) => (s.dive.phase !== 'idle' ? s.dive.feedId : undefined));
  const recon = useConsoleSelector(s => !!s.recon);
  const ordered = useMemo(() => orderFeedsByRelevance(recon ? feeds.filter(isReconFeed) : feeds), [feeds, recon]);
  const live = ordered.filter((f) => f.live).length;
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges(old => old.left === left && old.right === right ? old : { left, right });
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateEdges]);
  useEffect(updateEdges, [ordered, updateEdges]);
  const scroll = (direction: number) => {
    const el = row.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'auto' });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 pl-3 pr-9">
        <Icon name="camera" size={11} className="text-bone-mute" />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Feeds</span>
        <span className="fcc-num min-w-0 truncate font-mono text-micro uppercase text-bone-mute">{String(live).padStart(2, '0')} live / {ordered.length} channels · ranked by relevance · scroll for more</span>
        <div className="ml-auto flex shrink-0 gap-1">
          <button type="button" aria-label="Scroll feeds left" disabled={!edges.left} onClick={() => scroll(-1)} className="flex h-5 w-6 items-center justify-center border border-line text-bone-dim hover:bg-ink-800 disabled:opacity-30"><Icon name="chevron-left" size={12} /></button>
          <button type="button" aria-label="Scroll feeds right" disabled={!edges.right} onClick={() => scroll(1)} className="flex h-5 w-6 items-center justify-center border border-line text-bone-dim hover:bg-ink-800 disabled:opacity-30"><Icon name="chevron-right" size={12} /></button>
        </div>
      </div>
      <div ref={row} role="list" aria-label="Feeds sorted by relevance" tabIndex={0} onScroll={updateEdges}
        className="flex min-h-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden px-3 pb-2 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-line-strong">
        {!ordered.length && <div className="fcc-hatch flex h-full w-full items-center justify-center font-mono text-micro uppercase text-bone-mute">No feeds yet</div>}
        {ordered.map((f, i) => <Tile key={f.id} feed={f} lead={i === 0} active={active === f.id} onOpen={onOpen} />)}
      </div>
    </div>
  );
}
