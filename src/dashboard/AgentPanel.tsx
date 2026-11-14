import { memo, useEffect, useMemo, useRef } from 'react';
import { Badge, Button, Confidence, Icon, StatusPill, Serial, Tabs, cn, toneClass } from '@ds';
import type { IngestItem, IngestType, Insight, Recommendation, Unit } from '@/sim/types';
import { MediaThumb } from './MediaThumb';
import { hashStr, ingestCode, ingestIcon, insightTone, priorityTone, recConfidence, tPlus } from './format';
import { DPanel, SCROLL, SweepBar } from './ui';

export type AgentTab = 'recs' | 'intel' | 'insights';

const STEPS: Record<IngestType, string[]> = {
  video: ['Decoding H.265 stream', 'Segmenting thermal frames', 'Detecting persons / vehicles', 'Georegistering to DEM'],
  image: ['Orthorectifying frame', 'Classifying fuel model', 'Detecting structures'],
  news: ['Extracting entities', 'Geocoding place names', 'Cross-checking CMD NET'],
  sensor: ['Fusing RAWS telemetry', 'Updating wind field', 'Re-weighting spread model'],
  radio: ['Transcribing CMD NET', 'Extracting tasking + locations'],
  satellite: ['Thresholding FRP pixels', 'Diffing hotspot mask', 'Re-seeding spread model'],
};

const hasThumb = (t: IngestType) => t === 'video' || t === 'image' || t === 'satellite';

/* ------------------------------------------------------------------------ */

function ReasoningStrip({ ingest }: { ingest: IngestItem[] }) {
  const current = ingest.find((i) => i.status === 'analyzing');
  const queued = ingest.filter((i) => i.status === 'queued').length;
  const processed = ingest.filter((i) => i.status === 'processed').length;
  const steps = current ? STEPS[current.type] : null;
  // Wall-clock driven so the step cycles even when sim time is slow; freezes with the sim since renders stop.
  const step = steps ? steps[(Math.floor(Date.now() / 1600) + (hashStr(current!.id) % steps.length)) % steps.length] : null;

  return (
    <div className="shrink-0 border-b border-line bg-ink-850 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon name="ai" size={12} className={current ? 'text-ice' : 'text-bone-mute'} />
        <span className="fcc-micro text-bone-dim">Agent reasoning</span>
        <span className="ml-auto flex items-center gap-2 fcc-micro fcc-num">
          <span>Q {queued}</span>
          <span className={current ? 'text-ice' : undefined}>A {current ? 1 : 0}</span>
          <span>P {processed}</span>
        </span>
      </div>
      {current ? (
        <div key={current.id} className="mt-1.5 animate-rise">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name={ingestIcon[current.type]} size={12} className="shrink-0 text-bone-dim" />
            <span className="min-w-0 truncate text-xs text-bone">{current.title}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-micro uppercase text-ice">
            <span className="h-1 w-1 animate-blink bg-ice" />
            <span className="truncate">{step}</span>
            <span className="ml-auto shrink-0 text-bone-mute">{current.source}</span>
          </div>
          <SweepBar className="mt-2" />
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
          <span className="h-1 w-1 bg-phosphor" />
          Monitoring {ingest.length} feeds · queue clear
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function RecCard({
  rec,
  callsigns,
  onAccept,
  onDismiss,
  onSelect,
}: {
  rec: Recommendation;
  callsigns: Record<string, string>;
  onAccept(id: string): void;
  onDismiss(id: string): void;
  onSelect(id: string | null): void;
}) {
  const conf = recConfidence(rec);
  const pending = rec.status === 'pending';
  const accepted = rec.status === 'accepted';
  return (
    <li
      className={cn(
        'relative animate-rise border-b border-line-faint px-3 py-3 transition-opacity duration-base',
        rec.status === 'dismissed' && 'opacity-40',
        rec.priority === 'P1' && pending && 'bg-ember/[0.04]',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-px', accepted ? 'bg-phosphor' : pending ? toneClass[priorityTone[rec.priority]].dot : 'bg-ink-600')}
      />
      <div className="flex items-center gap-2">
        <Badge tone={priorityTone[rec.priority]} variant={rec.priority === 'P1' ? 'solid' : 'outline'}>
          {rec.priority}
        </Badge>
        <span className="fcc-micro fcc-num">REC-{rec.id.slice(-4).toUpperCase()}</span>
        <span className="fcc-micro fcc-num text-ink-400">{tPlus(rec.at)}</span>
        <span className="ml-auto flex items-center gap-1 fcc-micro fcc-num text-bone-dim">
          <Icon name="clock" size={10} />
          ETA {rec.etaMin} MIN
        </span>
      </div>
      <button type="button" onClick={() => onSelect(rec.unitIds[0] ?? null)} className="mt-2 block w-full text-left">
        <p className="text-sm leading-5 text-bone">{rec.title}</p>
        <p className="mt-1 line-clamp-3 text-xs text-bone-dim">{rec.rationale}</p>
      </button>
      <div className="mt-2.5 flex items-center gap-2 border-y border-line-faint py-1.5">
        <Icon name="arrow-up-right" size={12} className="shrink-0 text-phosphor" />
        <span className="min-w-0 flex-1 truncate font-mono text-tiny text-phosphor">{rec.impact}</span>
        <Confidence value={conf} segments={5} showValue />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {rec.unitIds.map((id) => (
          <span key={id} className="border border-line bg-ink-850 px-1.5 py-px font-mono text-micro uppercase text-bone-dim">
            {callsigns[id] ?? id}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {pending ? (
          <>
            <Button size="sm" variant="primary" icon="check" onClick={() => onAccept(rec.id)}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDismiss(rec.id)}>
              Dismiss
            </Button>
            <span className="ml-auto fcc-micro text-ink-400">Awaiting IC</span>
          </>
        ) : accepted ? (
          <Badge tone="nominal" variant="soft" dot>
            Accepted · units dispatched
          </Badge>
        ) : (
          <Badge tone="neutral" variant="outline">
            Dismissed
          </Badge>
        )}
      </div>
    </li>
  );
}

const ORDER = { pending: 0, accepted: 1, dismissed: 2 } as const;

const RecList = memo(
  function RecList(props: {
    recs: Recommendation[];
    units: Unit[];
    sig: string;
    onAccept(id: string): void;
    onDismiss(id: string): void;
    onSelect(id: string | null): void;
  }) {
    const { recs, units } = props;
    const callsigns = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.callsign])), [units, units.length]);
    const sorted = [...recs].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at - a.at);
    if (sorted.length === 0) return <Empty text="No recommendations yet · ARGUS is building a picture" />;
    return (
      <ul>
        {sorted.map((r) => (
          <RecCard key={r.id} rec={r} callsigns={callsigns} onAccept={props.onAccept} onDismiss={props.onDismiss} onSelect={props.onSelect} />
        ))}
      </ul>
    );
  },
  (a, b) => a.sig === b.sig && a.onAccept === b.onAccept && a.onDismiss === b.onDismiss,
);

/* ------------------------------------------------------------------------ */

function IngestStatus({ item }: { item: IngestItem }) {
  if (item.status === 'analyzing')
    return (
      <Badge tone="telemetry" variant="soft" dot>
        Analyzing
      </Badge>
    );
  if (item.status === 'queued')
    return (
      <Badge tone="neutral" variant="outline">
        Queued
      </Badge>
    );
  return (
    <Badge tone="nominal" variant="outline">
      Processed
    </Badge>
  );
}

function IntelRow({ item, focused, onSelect }: { item: IngestItem; focused: boolean; onSelect(id: string | null): void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  const n = item.derived?.length ?? 0;

  return (
    <li ref={ref} className={cn('relative animate-rise border-b border-line-faint px-3 py-3', focused && 'bg-signal/5')}>
      {focused && <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-signal" />}
      <div className="flex gap-3">
        {hasThumb(item.type) ? (
          <MediaThumb id={item.id} type={item.type} at={item.at} />
        ) : (
          <div className="grid h-10 w-10 shrink-0 place-items-center border border-line bg-ink-850 text-bone-dim">
            <Icon name={ingestIcon[item.type]} size={16} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 fcc-micro">
            <span className="shrink-0 text-signal">{ingestCode[item.type]}</span>
            <span className="min-w-0 truncate text-bone-dim">{item.source}</span>
            <span className="ml-auto shrink-0 fcc-num">{tPlus(item.at)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-bone">{item.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-bone-mute">{item.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <IngestStatus item={item} />
            {n > 0 && (
              <button
                type="button"
                onClick={() => onSelect(item.derived![0])}
                className="inline-flex items-center gap-1 border border-violet/40 px-1.5 py-px font-mono text-micro uppercase text-violet transition-colors duration-quick hover:bg-violet/10"
              >
                <Icon name="target" size={10} />
                {n} detection{n === 1 ? '' : 's'}
              </button>
            )}
            {item.tags.slice(0, 2).map((t) => (
              <span key={t} className="font-mono text-micro uppercase text-ink-400">
                #{t}
              </span>
            ))}
          </div>
          {item.status === 'analyzing' && <SweepBar className="mt-2" />}
        </div>
      </div>
    </li>
  );
}

const IntelList = memo(
  function IntelList({ items, focusId, onSelect }: { items: IngestItem[]; sig: string; focusId: string | null; onSelect(id: string | null): void }) {
    if (items.length === 0) return <Empty text="No feeds ingested" />;
    return (
      <ul>
        {items.map((i) => (
          <IntelRow key={i.id} item={i} focused={focusId === i.id} onSelect={onSelect} />
        ))}
      </ul>
    );
  },
  (a, b) => a.sig === b.sig && a.focusId === b.focusId,
);

/* ------------------------------------------------------------------------ */

const InsightList = memo(
  function InsightList({ items }: { items: Insight[]; sig: string }) {
    if (items.length === 0) return <Empty text="Awaiting first analysis" />;
    return (
      <ol>
        {items.map((it) => {
          const tone = insightTone[it.kind];
          return (
            <li key={it.id} className={cn('relative animate-rise border-b border-line-faint px-3 py-2.5', it.kind === 'alert' && 'bg-ember/[0.06]')}>
              <span aria-hidden className={cn('absolute inset-y-0 left-0 w-px', toneClass[tone].dot)} />
              <div className="flex items-center gap-2">
                <span className={cn('font-mono text-micro uppercase', toneClass[tone].text)}>{it.kind}</span>
                <span className="fcc-micro fcc-num text-ink-400">{tPlus(it.at)}</span>
                <span className="ml-auto">
                  <Confidence value={it.confidence} segments={5} />
                </span>
              </div>
              <p className={cn('mt-1 text-xs', it.kind === 'alert' ? 'text-ember' : 'text-bone')}>{it.title}</p>
              <p className="mt-0.5 text-xs text-bone-mute">{it.body}</p>
            </li>
          );
        })}
      </ol>
    );
  },
  (a, b) => a.sig === b.sig,
);

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center px-6 text-center">
      <span className="fcc-micro">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

export function AgentPanel({
  ingest,
  insights,
  recommendations,
  units,
  tab,
  onTab,
  focusIngestId,
  onAccept,
  onDismiss,
  onSelect,
  className,
}: {
  ingest: IngestItem[];
  insights: Insight[];
  recommendations: Recommendation[];
  units: Unit[];
  tab: AgentTab;
  onTab(t: AgentTab): void;
  focusIngestId: string | null;
  onAccept(id: string): void;
  onDismiss(id: string): void;
  onSelect(id: string | null): void;
  className?: string;
}) {
  // Signatures let the memoized lists skip renders even if the engine mutates arrays in place.
  const recSig = recommendations.map((r) => r.id + r.status).join('|') + '#' + units.length;
  const intelSig = ingest.map((i) => `${i.id}${i.status}${i.derived?.length ?? 0}`).join('|');
  const insightSig = insights.map((i) => i.id).join('|');
  const pending = recommendations.filter((r) => r.status === 'pending').length;
  const analyzing = ingest.some((i) => i.status === 'analyzing');

  const items = [
    { id: 'recs', label: 'Actions', count: pending },
    { id: 'intel', label: 'Intel', count: ingest.length },
    { id: 'insights', label: 'Insights', count: insights.length },
  ];

  return (
    <DPanel
      index="04"
      title={
        <>
          AI Agent <span className="text-bone-mute">—</span> ARGUS
        </>
      }
      meta={
        <>
          <Serial className="hidden xl:inline-flex">v3.2</Serial>
          <StatusPill status={analyzing ? 'telemetry' : 'nominal'} live>
            {analyzing ? 'Analyzing' : 'Online'}
          </StatusPill>
        </>
      }
      className={className}
      bodyClassName="flex flex-col"
    >
      <ReasoningStrip ingest={ingest} />
      <Tabs size="sm" className="shrink-0 px-3" items={items} value={tab} onChange={(id) => onTab(id as AgentTab)} />
      <div className={cn('min-h-0 flex-1', SCROLL)}>
        {tab === 'recs' && <RecList recs={recommendations} units={units} sig={recSig} onAccept={onAccept} onDismiss={onDismiss} onSelect={onSelect} />}
        {tab === 'intel' && <IntelList items={ingest} sig={intelSig} focusId={focusIngestId} onSelect={onSelect} />}
        {tab === 'insights' && <InsightList items={insights} sig={insightSig} />}
      </div>
    </DPanel>
  );
}
