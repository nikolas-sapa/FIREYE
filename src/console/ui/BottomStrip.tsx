import { useEffect, useMemo, useRef, useState } from 'react';
import { Datum, FeedTile, Icon, TimelineScrubber, cn, type TimelineMark } from '@ds';
import type { Feed, Projection } from '../contracts';
import { useConsoleApi, useConsoleSelector } from '../store';
import { FeedSurface } from '../stage3d';
import { useTimelineTicks } from './CommandStrip';
import { acresAt, acresSeries } from './derived';
import { areaUnit, fmtInt, localDay, localTime, packTz } from './format';
import { SurfaceBoundary } from './SurfaceBoundary';

const kindLabel: Record<Feed['kind'], string> = {
  'uav-nadir': 'UAV NADIR', 'uav-oblique': 'UAV OBLIQUE', 'uav-chase': 'UAV CHASE', 'dash-cam': 'DASH CAM', 'helmet-cam': 'HELMET CAM',
  'ridge-cam': 'RIDGE CAM', satellite: 'SATELLITE', social: 'SOCIAL',
};

function Relevance({ v }: { v: number }) {
  return (
    <span className="pointer-events-none absolute bottom-1 left-1 inline-flex items-center gap-1 bg-ink-950/80 px-1 py-px font-mono text-micro text-bone-dim fcc-num">
      <span aria-hidden className="flex h-1 w-6 gap-px">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('flex-1', v >= 25 * (i + 1) - 12 ? 'bg-ice' : 'bg-ink-600')} />
        ))}
      </span>
      {String(Math.round(v)).padStart(2, '0')}
    </span>
  );
}

function MiniFeed({ feed, selected, onClick }: { feed: Feed; selected: boolean; onClick: () => void }) {
  const name = feed.label.split(' · ')[0] ?? feed.label;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${feed.label}${feed.live ? ', live' : ', clip'}. Put on stage`}
      onClick={onClick}
      className={cn(
        'group/mini relative aspect-video w-[112px] overflow-hidden border bg-void text-left transition-[border-color] duration-quick ease-servo',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-signal',
        selected ? 'border-signal/60' : 'border-line hover:border-line-strong',
      )}
    >
      <SurfaceBoundary label="Feed" className="absolute inset-0">
        <FeedSurface feedId={feed.id} variant="thumb" className="absolute inset-0 h-full w-full" />
      </SurfaceBoundary>
      <span aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines" />
      <span className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-ink-950/75 px-1 py-px">
        <span className={cn('h-1 w-1 shrink-0', feed.live ? 'bg-ember' : 'border border-ink-400')} />
        <span className="truncate font-mono text-micro uppercase leading-3 tracking-[0.08em] text-bone">{name}</span>
        {feed.fx.startsWith('ir') && <span className="ml-auto shrink-0 font-mono text-micro leading-3 text-bone-mute">IR</span>}
      </span>
      <Relevance v={feed.relevance} />
      {feed.findingIds.length > 0 && (
        <span className="pointer-events-none absolute bottom-1 right-1 bg-ink-950/80 px-1 py-px font-mono text-micro leading-3 text-violet fcc-num">{feed.findingIds.length} DET</span>
      )}
    </button>
  );
}

function FeedStripTiles() {
  const api = useConsoleApi();
  const feeds = useConsoleSelector((s) => s.feeds);
  const stage = useConsoleSelector((s) => s.stage);
  const ordered = useMemo(() => [...feeds].sort((a, b) => b.relevance - a.relevance), [feeds]);
  const top = ordered[0];
  const rest = ordered.slice(1);
  const live = feeds.filter((f) => f.live).length;
  const onStage = stage.mode === 'feed' ? stage.feedId : undefined;
  const toggle = (id: string) => api.promoteFeed(onStage === id ? null : id);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-6 shrink-0 items-center gap-2 px-3">
        <Icon name="camera" size={11} className="text-bone-mute" />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">Feeds</span>
        <span className="font-mono text-micro uppercase text-bone-mute fcc-num">
          {String(live).padStart(2, '0')} live · {String(feeds.length).padStart(2, '0')} total · ordered by Orchestrator relevance
        </span>
        {onStage && (
          <button type="button" onClick={() => api.promoteFeed(null)} className="ml-auto inline-flex items-center gap-1 font-mono text-micro uppercase text-bone-dim hover:text-bone">
            <Icon name="map" size={10} />
            Back to globe
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-3 pb-2">
        {feeds.length === 0 && <div className="fcc-hatch flex h-full w-full items-center justify-center font-mono text-micro uppercase text-bone-mute">No feeds yet</div>}
        {top && (
          <FeedTile
            key={top.id}
            label={top.label}
            live={top.live}
            selected={onStage === top.id}
            onClick={() => toggle(top.id)}
            className="w-[240px] shrink-0"
          >
            <SurfaceBoundary label="Feed" className="absolute inset-0">
              <FeedSurface feedId={top.id} variant="thumb" className="absolute inset-0 h-full w-full" />
            </SurfaceBoundary>
            <Relevance v={top.relevance} />
            <span className="pointer-events-none absolute bottom-1 right-1 bg-ink-950/80 px-1 py-px font-mono text-micro uppercase text-bone-mute">
              {kindLabel[top.kind]}
              {top.findingIds.length > 0 && <span className="text-violet"> · {top.findingIds.length} DET</span>}
            </span>
          </FeedTile>
        )}
        <div className="grid shrink-0 auto-cols-[112px] grid-flow-col grid-rows-2 gap-1.5">
          {rest.map((f) => (
            <MiniFeed key={f.id} feed={f} selected={onStage === f.id} onClick={() => toggle(f.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function useProjectionHistory(p: Projection | null) {
  const [hist, setHist] = useState<{ rev: number; at: number }[]>([]);
  const last = useRef(-1);
  useEffect(() => {
    if (!p || p.rev === last.current) return;
    last.current = p.rev;
    setHist((h) => [...h.filter((x) => x.rev !== p.rev), { rev: p.rev, at: p.issuedAt }].slice(-40));
  }, [p]);
  return hist;
}

function Progression() {
  const api = useConsoleApi();
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 60000) * 60000);
  const projection = useConsoleSelector((s) => s.projection);
  const hist = useProjectionHistory(projection);
  const tz = packTz(pack);
  const area = areaUnit(pack);
  const start = pack?.manifest.start ?? 0;
  const end = pack?.manifest.end ?? 1;
  const ticks = useTimelineTicks(start, end, tz);
  const series = useMemo(() => acresSeries(pack), [pack]);
  const marks = useMemo<TimelineMark[]>(
    () => [
      ...(pack?.perimeters ?? []).filter((p) => p.t >= start && p.t <= end).map((p) => ({ t: p.t, kind: 'perimeter' as const, label: `Perimeter ${fmtInt(area.from(p.acres))} ${area.unit}` })),
      ...hist.map((h) => ({ t: h.at, kind: 'ghost' as const, label: `Projection rev ${h.rev}` })),
      ...(pack?.checkpoints ?? [])
        .filter((c) => c.t >= start && c.t <= end)
        .map((c) => ({ t: c.t, kind: 'checkpoint' as const, label: `Documented ${localTime(c.t, tz)} ${tz} · ${c.label}` })),
    ],
    [pack, start, end, hist, tz, area],
  );
  const horizon = projection ? Math.max(0, ...projection.bands.map((b) => b.horizonMin)) : 0;
  const next = pack?.perimeters.find((p) => p.t > t);
  const acres = acresAt(pack, t);

  return (
    <div className="flex w-[400px] shrink-0 flex-col border-l border-line px-3 max-[1700px]:w-[320px]">
      <div className="flex h-6 shrink-0 items-center gap-2">
        <Icon name="flame" size={11} className="text-ember" />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">Fire progression</span>
        <span className="ml-auto font-mono text-micro uppercase text-bone-mute">
          {pack?.checkpoints?.length ? 'Bars = documented moments · ' : ''}drag to seek
        </span>
      </div>
      <TimelineScrubber
        start={start}
        end={end}
        t={t}
        onSeek={(v) => api.seek(v)}
        ticks={ticks}
        series={series}
        marks={marks}
        projectionUntil={horizon ? t + horizon * 60000 : undefined}
        format={(v) => `${localDay(v, tz)} ${localTime(v, tz)}`}
        label="Fire progression timeline"
        className="mt-3"
      />
      <div className="mt-auto flex items-end gap-5 pb-2">
        <Datum label="Burned now" value={fmtInt(area.from(acres))} unit={area.unit} tone="text-ember" />
        <Datum label="Projection" value={projection ? `REV ${projection.rev}` : '—'} tone="text-amber" />
        <Datum label="Next perimeter" value={next ? `${localDay(next.t, tz)} ${localTime(next.t, tz)}` : '—'} />
      </div>
    </div>
  );
}

export function BottomStrip() {
  return (
    <div className="flex h-[180px] shrink-0 border-t border-line bg-ink-950 pt-1.5">
      <FeedStripTiles />
      <Progression />
    </div>
  );
}
