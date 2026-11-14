import { useEffect, useRef, useState } from 'react';
import {
  AlertCard, Brackets, Button, Drawer, FeedTile, Freshness, GridBg, Icon, IconButton, IconRail, InterruptBanner, MovementCard, OrchBubble,
  PoolBar, PromptChip, ScoreMeter, Slider, TIER_BANDS, TierBadge, Toggle, alertClassLabel, alertTone, cn, tierOf, toneClass,
  type IconRailItem, type MovementStatus, type OrchAlertClass, type OrchAudience, type OrchTier,
} from '@ds';
import { GroupTitle, Spec, SubSection } from './Spec';

const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ Grading matrix ----------------------------- */

const placement: Record<OrchTier, { where: string; who: string; rule: string; notify: OrchAudience[] }> = {
  0: {
    where: 'Interrupt banner, map center-top. Camera flies to the location.',
    who: 'Console user + every field audience in range',
    rule: 'One at a time. Must be acknowledged. Queue the next one behind it.',
    notify: ['fire', 'ems', 'law', 'public'],
  },
  1: {
    where: 'Orchestrator dock, "Needs attention" stack. Map label shown.',
    who: 'Console user + units within 2 km',
    rule: 'Max 3 visible. Oldest drops to ambient when a fourth arrives.',
    notify: ['fire', 'ems'],
  },
  2: {
    where: 'Map glyph only. A count in the dock.',
    who: 'Console user (passive)',
    rule: 'Glyph, no label. Hover or select to read.',
    notify: [],
  },
  3: {
    where: 'Log drawer only.',
    who: 'Nobody, recorded for audit',
    rule: 'Never surfaced proactively. Searchable.',
    notify: [],
  },
};

function GradingMatrix() {
  const [score, setScore] = useState(72);
  const active = tierOf(score);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative border border-line bg-ink-900">
        <Brackets size={6} />
        <div className="grid grid-cols-[120px_150px_1fr_1fr] border-b border-line-strong max-lg:hidden">
          {['Score band', 'Tier', 'Where it renders', 'Who is notified'].map((h) => (
            <span key={h} className="flex h-9 items-center px-3 font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">
              {h}
            </span>
          ))}
        </div>
        {TIER_BANDS.map((b) => {
          const on = b.tier === active;
          const p = placement[b.tier];
          return (
            <div
              key={b.tier}
              className={cn(
                'relative grid grid-cols-1 gap-2 border-b border-line-faint px-3 py-3 transition-colors duration-base ease-servo last:border-b-0 lg:grid-cols-[120px_150px_1fr_1fr] lg:gap-0 lg:px-0',
                on ? 'bg-ink-850' : 'bg-transparent',
              )}
            >
              {on && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-signal" />}
              <span className="flex items-center font-mono text-tiny text-bone fcc-num lg:px-3">
                {String(b.min).padStart(2, '0')}–{b.max}
              </span>
              <span className="flex items-center lg:px-3">
                <TierBadge tier={b.tier} />
              </span>
              <span className="flex flex-col justify-center gap-1 lg:px-3">
                <span className="text-sm text-bone">{p.where}</span>
                <span className="font-mono text-micro uppercase text-bone-mute">{p.rule}</span>
              </span>
              <span className="flex flex-col justify-center gap-1.5 lg:px-3">
                <span className="text-sm text-bone-dim">{p.who}</span>
                <span className="flex gap-px">
                  {(['fire', 'ems', 'law', 'public'] as const).map((a) => (
                    <span
                      key={a}
                      className={cn(
                        'h-4 px-1 font-mono text-micro uppercase leading-4',
                        p.notify.includes(a) ? 'bg-ink-700 text-bone' : 'text-ink-500',
                      )}
                    >
                      {a}
                    </span>
                  ))}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative grid grid-cols-1 items-center gap-6 border border-line bg-ink-900 p-4 md:grid-cols-[1fr_auto]">
        <Brackets size={6} />
        <Slider label="Try a score" value={score} min={0} max={100} step={1} onChange={setScore} />
        <div className="flex items-center gap-4">
          <ScoreMeter score={score} />
          <TierBadge tier={active} />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Alerts --------------------------------- */

const alertSpecimens: Array<{ cls: OrchAlertClass; tier: OrchTier; score: number; title: string; body: string; why: string; time: string; notify: OrchAudience[] }> = [
  {
    cls: 'life', tier: 0, score: 93, title: '2 hikers inside the +1H band at Pine Hollow trailhead',
    body: 'Social video 14 min ago shows two people walking north on the Ridge trail. HAWK-2 is 90 s out to confirm.',
    why: 'Life safety · inside +1H band · conf 0.81 · 2 sources', time: '14:32Z', notify: ['fire', 'ems', 'law'],
  },
  {
    cls: 'hazard', tier: 1, score: 78, title: 'Propane depot 600 m ahead of the head',
    body: 'Three 1,000 gal tanks at Mercer Ranch. E-17 is the closest engine.',
    why: 'Combustible · +3H band · terrain upslope', time: '14:29Z', notify: ['fire'],
  },
  {
    cls: 'movement', tier: 1, score: 71, title: 'Pull DIV A back to the Ridge Rd safety zone',
    body: 'The +1H projection crosses HWY 49 at 14:20Z. Route via Ridge Rd is clear.',
    why: 'Movement · trigger in 18 min · 3 units', time: '14:27Z', notify: ['fire'],
  },
  {
    cls: 'fuel', tier: 2, score: 48, title: 'Cured grass corridor along Dry Creek',
    body: 'Sentinel-2 NDMI shows very low moisture. Projection weight raised.',
    why: 'Fuel · not in path yet', time: '14:18Z', notify: [],
  },
  {
    cls: 'projection', tier: 2, score: 41, title: 'Projection revised: head now NE at 32 m/min',
    body: 'Wind veered 20 degrees. The +3H band moved 400 m east.',
    why: 'Projection · delta < 500 m', time: '14:15Z', notify: [],
  },
  {
    cls: 'status', tier: 3, score: 18, title: 'Firecrawl sweep complete: 12 articles, 0 new findings',
    body: 'No new locations extracted.', why: 'Status · no change', time: '14:12Z', notify: [],
  },
];

/* -------------------------------- Freshness -------------------------------- */

const halfLives = [
  { src: 'Social video', icon: 'social' as const, halfMin: 15, ages: [0, 5, 15, 30, 50] },
  { src: 'Web / news (Firecrawl)', icon: 'web' as const, halfMin: 20, ages: [0, 10, 20, 40, 70] },
  { src: 'Satellite pass (FIRMS)', icon: 'satellite' as const, halfMin: 40, ages: [0, 20, 40, 80, 140] },
];
const fresh = (ageMin: number, halfMin: number) => Math.pow(0.5, ageMin / halfMin);
const ageLabel = (m: number) => (m === 0 ? 'Now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')} ago`);

/** Approximate-location glyph: solid dot, dashed uncertainty ring; opacity follows freshness. */
function ApproxGlyph({ f, live = false, r = 26, size = 72 }: { f: number; live?: boolean; r?: number; size?: number }) {
  const c = size / 2;
  const expired = !live && f < 0.1;
  const o = live ? 1 : 0.2 + 0.8 * f;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="overflow-visible">
      <g style={{ opacity: expired ? 0.25 : o }} className="text-violet">
        <circle cx={c} cy={c} r={r} fill="currentColor" fillOpacity={live ? 0 : 0.06 * f} stroke="currentColor" strokeWidth={1} strokeDasharray={live ? undefined : '3 3'} />
        {live ? (
          <>
            <rect x={c - 4} y={c - 4} width={8} height={8} fill="currentColor" />
            <rect x={c - 7} y={c - 7} width={14} height={14} fill="none" stroke="currentColor" />
          </>
        ) : (
          <circle cx={c} cy={c} r={3} fill={expired ? 'none' : 'currentColor'} stroke="currentColor" />
        )}
        <line x1={c} y1={c - r - 4} x2={c} y2={c - r + 3} stroke="currentColor" />
      </g>
    </svg>
  );
}

/* ---------------------------------- Feeds --------------------------------- */

function FakeFeed({ seed, tone = 'warm' }: { seed: number; tone?: 'warm' | 'ir' }) {
  const ridge = Array.from({ length: 9 }, (_, i) => `${i * 12.5},${52 + Math.sin(seed + i * 1.3) * 8 + (i % 2) * 4}`).join(' ');
  return (
    <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <rect width="100" height="56" className={tone === 'ir' ? 'fill-ink-850' : 'fill-ink-800'} />
      <polygon points={`0,56 ${ridge} 100,56`} className={tone === 'ir' ? 'fill-ink-700' : 'fill-ink-600'} />
      <ellipse cx={30 + (seed % 5) * 9} cy={40} rx={9} ry={4} className={tone === 'ir' ? 'fill-bone/70' : 'fill-signal/50'} />
      <ellipse cx={30 + (seed % 5) * 9} cy={34} rx={14} ry={9} className="fill-ink-400/30" />
      <g className="stroke-bone/60" strokeWidth={0.3} fill="none">
        <path d="M46 28h3M51 28h3M50 24v3M50 29v3" />
        <rect x={60} y={30} width={8} height={6} className="stroke-violet" />
      </g>
    </svg>
  );
}

/* ---------------------------------- Pools --------------------------------- */

const poolSeed = [
  { label: 'Video analysis', provider: 'fal', max: 24, base: 9, model: 'video-understanding' },
  { label: 'Image / satellite', provider: 'fal', max: 16, base: 4, model: 'vision · florence-2' },
  { label: 'Web & news', provider: 'firecrawl', max: 12, base: 3, model: 'search + treq' },
  { label: 'Projection', provider: 'boxd', max: 4, base: 2, model: 'treq · reasoning' },
];

function PoolDemo() {
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(() => !prefersReduced());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setT((x) => x + 1), 900);
    return () => window.clearInterval(id);
  }, [running]);
  return (
    <div className="relative flex flex-col gap-5 border border-line bg-ink-900 p-4">
      <Brackets size={6} />
      <div className="flex items-center justify-between gap-3">
        <span className="fcc-micro">Autoscaling sandboxes / one cell per worker slot</span>
        <Toggle size="sm" checked={running} onChange={setRunning} label="Animate" />
      </div>
      {poolSeed.map((p, i) => {
        const wave = Math.sin(t * 0.45 + i * 1.7) * 0.5 + 0.5;
        const surge = i === 0 && t % 14 > 8;
        const workers = Math.min(p.max, Math.round(p.base + wave * (p.max - p.base) * 0.7 + (surge ? p.max : 0)));
        const queue = surge ? 6 + (t % 4) : Math.max(0, Math.round((wave - 0.6) * 10));
        return (
          <PoolBar
            key={p.label}
            label={p.label}
            provider={p.provider}
            workers={workers}
            maxWorkers={p.max}
            queue={queue}
            meta={`${p.model} · p50 ${(2.1 + wave * 3).toFixed(1)} s · ${Math.round(workers * 3.4)}/min`}
          />
        );
      })}
    </div>
  );
}

/* --------------------------------- Thread --------------------------------- */

interface Msg {
  id: number;
  role: 'orchestrator' | 'user';
  text: string;
  time: string;
}

const replies: Record<string, string> = {
  'What changed in the last 10 minutes?':
    'Wind veered 20 degrees. The head is now running NE at 32 m/min. One new life alert: two hikers at Pine Hollow. Everything else is unchanged.',
  'Who is closest to the hikers?': 'HAWK-2 is 90 s out and will confirm. E-41 is the closest ground unit, 4 min by Ridge Rd.',
  'Show me the safest route for DIV A': 'Ridge Rd north to the staging meadow. Clear of the +1H band for 40 min. I placed it on the map.',
};

function Thread() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: 1, role: 'orchestrator', time: '14:30Z', text: 'Monitoring. Head running NE toward Pine Hollow. 1 item needs you, 4 are on the map.' },
  ]);
  const [thinking, setThinking] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const ask = (q: string) => {
    if (thinking) return;
    setMsgs((m) => [...m, { id: m.length + 1, role: 'user', text: q, time: '14:31Z' }]);
    setThinking(true);
    timer.current = window.setTimeout(() => {
      setThinking(false);
      setMsgs((m) => [...m, { id: m.length + 1, role: 'orchestrator', text: replies[q] ?? 'Understood.', time: '14:31Z' }]);
    }, prefersReduced() ? 0 : 1100);
  };
  return (
    <div className="relative flex h-full flex-col border border-line bg-ink-950">
      <Brackets size={6} />
      <div className="flex h-9 items-center gap-2 border-b border-line px-3">
        <Icon name="orchestrator" size={12} className="text-ice" />
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">Orchestrator</span>
        <span className="ml-auto font-mono text-micro uppercase text-phosphor">Monitoring</span>
      </div>
      <div className="flex max-h-[360px] min-h-[260px] flex-1 flex-col gap-3 overflow-auto p-3">
        {msgs.map((m) => (
          <OrchBubble key={m.id} role={m.role} time={m.time}>
            {m.text}
          </OrchBubble>
        ))}
        {thinking && <OrchBubble role="orchestrator" thinking />}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line p-3">
        {Object.keys(replies).map((q) => (
          <PromptChip key={q} onClick={() => ask(q)}>
            {q}
          </PromptChip>
        ))}
        <Button size="sm" variant="ghost" icon="close" className="ml-auto" onClick={() => setMsgs((m) => m.slice(0, 1))}>
          Reset
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------- Rail demo ------------------------------- */

const railItems: IconRailItem[] = [
  { id: 'forces', icon: 'engine', label: 'Forces', badge: 14 },
  { id: 'feeds', icon: 'camera', label: 'Live feeds', badge: 9 },
  { id: 'agents', icon: 'agents', label: 'Agent pipeline' },
  { id: 'layers', icon: 'layers', label: 'Map layers' },
  { id: 'log', icon: 'log', label: 'Log', badge: 3, tone: 'warning' },
];

function RailDemo() {
  const [open, setOpen] = useState<string | null>('feeds');
  const item = railItems.find((i) => i.id === open);
  return (
    <div className="relative flex h-[440px] overflow-hidden border border-line bg-ink-950">
      <IconRail items={railItems} value={open} onChange={setOpen} className="relative z-raised" />
      <div className="relative flex-1">
        <GridBg variant="lines" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="fcc-micro">Map surface</span>
        </div>
        <Drawer
          open={open !== null}
          onClose={() => setOpen(null)}
          title={item?.label ?? ''}
          index={item ? String(railItems.indexOf(item) + 1).padStart(2, '0') : undefined}
          width={320}
          actions={<IconButton icon="expand" label="Pop out" variant="ghost" size="sm" />}
        >
          <div className="flex flex-col gap-2 p-3">
            {open === 'feeds' ? (
              <div className="grid grid-cols-2 gap-2">
                {['E-41 · Dash', 'HAWK-2 · EO/IR', 'HAWK-5 · EO', 'E-17 · Dash'].map((l, i) => (
                  <FeedTile key={l} label={l} live={i < 3}>
                    <FakeFeed seed={i * 3 + 1} tone={l.includes('IR') ? 'ir' : 'warm'} />
                  </FeedTile>
                ))}
              </div>
            ) : (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 border border-line bg-ink-900" />)
            )}
            <p className="pt-2 text-xs text-bone-dim">
              Drawers slide over the map from the rail. One open at a time. Esc or the active rail icon closes it.
            </p>
          </div>
        </Drawer>
      </div>
    </div>
  );
}

/* ------------------------------ Interrupt demo ----------------------------- */

function InterruptDemo() {
  const [acked, setAcked] = useState(false);
  return (
    <div className="relative h-[300px] overflow-hidden border border-line bg-ink-950">
      <GridBg variant="lines" />
      <div className="absolute left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2">
        <ApproxGlyph f={0.85} r={22} />
      </div>
      {acked ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Button size="sm" icon="play" onClick={() => setAcked(false)}>
            Replay interrupt
          </Button>
        </div>
      ) : (
        <div className="absolute inset-x-4 top-4 flex justify-center">
          <InterruptBanner
            cls="life"
            score={93}
            time="14:32:08Z"
            title="2 hikers inside the +1H band at Pine Hollow trailhead"
            body="HAWK-2 is 90 s out to confirm. Evac route via Ridge Rd is open."
            notify={['fire', 'ems', 'law']}
            onAck={() => setAcked(true)}
            onLocate={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Movement demo ------------------------------ */

function MovementDemo() {
  const [status, setStatus] = useState<MovementStatus>('proposed');
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="flex flex-col gap-2">
        <MovementCard
          title="Pull DIV A back to the Ridge Rd safety zone"
          group="DIV A · E-41, E-17, CREW-7"
          windowLabel="Start ≤ 4 min · done by 14:20Z"
          trigger="+1H crosses HWY 49 at 14:20Z"
          reason="The head will reach the current line before the dozer finishes. Ridge Rd stays clear for 40 min."
          score={74}
          status={status}
          onApprove={() => setStatus('approved')}
          onReject={() => setStatus('rejected')}
          onLocate={() => undefined}
        />
        {status !== 'proposed' && (
          <Button size="sm" variant="ghost" icon="close" onClick={() => setStatus('proposed')} className="self-start">
            Reset
          </Button>
        )}
      </div>
      <MovementCard
        title="Stage HAWK-5 over Mercer Ranch propane depot"
        group="AIR · HAWK-5"
        windowLabel="Now · 25 min on station"
        trigger="Depot inside +3H band"
        score={66}
        status="executing"
      />
      <MovementCard
        title="Move CREW-12 to drop point 7"
        group="DIV B · CREW-12"
        windowLabel="Completed 14:02Z"
        trigger="Handline complete"
        score={52}
        status="done"
      />
    </div>
  );
}

/* --------------------------------- Chapter -------------------------------- */

export function OrchestratorSpec() {
  const [selected, setSelected] = useState<number | null>(1);
  return (
    <SubSection
      id="system-orchestrator"
      index="05.8"
      kicker="Orchestrator patterns"
      title="Graded, placed, relayed."
      lede="The Orchestrator scores every finding from 0 to 100. The score decides where it renders, who hears about it, and whether it may interrupt. The default view stays calm; importance earns screen space."
    >
      <div className="flex flex-col gap-14">
        <div>
          <GroupTitle code="O.1">Grading → placement</GroupTitle>
          <GradingMatrix />
        </div>

        <div>
          <GroupTitle code="O.2">ScoreMeter / TierBadge</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Spec code='<ScoreMeter score size="sm|md" showValue />' tag="Meter" bodyClassName="flex-col items-start gap-4">
              {[96, 72, 47, 12].map((s) => (
                <div key={s} className="flex items-center gap-4">
                  <ScoreMeter score={s} />
                  <ScoreMeter score={s} size="sm" />
                </div>
              ))}
            </Spec>
            <Spec code="<TierBadge tier={0|1|2|3} />" tag="Tier" bodyClassName="flex-col items-start gap-3">
              {([0, 1, 2, 3] as const).map((t) => (
                <div key={t} className="flex items-center gap-4">
                  <TierBadge tier={t} />
                  <span className="font-mono text-micro uppercase text-bone-mute">{TIER_BANDS.find((b) => b.tier === t)?.placement}</span>
                </div>
              ))}
            </Spec>
          </div>
        </div>

        <div>
          <GroupTitle code="O.3">AlertCard / class × tier</GroupTitle>
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
            {(['life', 'hazard', 'fuel', 'movement', 'projection', 'status'] as const).map((c) => (
              <span key={c} className="inline-flex items-center gap-2 font-mono text-micro uppercase text-bone-dim">
                <span className={cn('h-2 w-2', toneClass[alertTone(c, 2)].dot)} />
                {alertClassLabel[c]}
                {c === 'life' && (
                  <>
                    <span className="text-ink-500">/ T0–1</span>
                    <span className={cn('h-2 w-2', toneClass.danger.dot)} />
                  </>
                )}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {alertSpecimens.map((a, i) => (
              <AlertCard
                key={a.title}
                {...a}
                selected={selected === i}
                onClick={() => setSelected(selected === i ? null : i)}
                actions={
                  a.tier <= 1 ? (
                    <IconButton icon="locate" label="Locate on map" size="sm" variant="ghost" onClick={(e) => e.stopPropagation()} />
                  ) : undefined
                }
              />
            ))}
          </div>
          <GroupTitle code="O.3b" className="mt-8">
            Compact / dock and log rows
          </GroupTitle>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {alertSpecimens.map((a) => (
              <AlertCard key={a.title} cls={a.cls} tier={a.tier} score={a.score} title={a.title} time={a.time} compact onClick={() => undefined} />
            ))}
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<AlertCard cls tier score title body why time notify actions compact selected onClick />'}</code>
        </div>

        <div>
          <GroupTitle code="O.4">InterruptBanner / tier 0</GroupTitle>
          <InterruptDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<InterruptBanner cls title body score time notify onAck onLocate />'}</code>
        </div>

        <div>
          <GroupTitle code="O.5">Freshness / non-live data fades</GroupTitle>
          <div className="relative border border-line bg-ink-900">
            <Brackets size={6} />
            <div className="grid grid-cols-[180px_repeat(5,1fr)] border-b border-line-strong max-md:hidden">
              <span className="flex h-9 items-center px-3 font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">Source / half-life</span>
              {['Fresh', '', '1 half-life', '', 'Expiring'].map((h, i) => (
                <span key={i} className="flex h-9 items-center justify-center font-mono text-micro uppercase text-bone-mute">
                  {h}
                </span>
              ))}
            </div>
            {halfLives.map((h) => (
              <div key={h.src} className="grid grid-cols-2 border-b border-line-faint last:border-b-0 md:grid-cols-[180px_repeat(5,1fr)]">
                <div className="col-span-2 flex items-center gap-2 px-3 py-3 md:col-span-1">
                  <Icon name={h.icon} size={14} className="text-bone-dim" />
                  <span className="flex flex-col">
                    <span className="font-mono text-nano uppercase text-bone">{h.src}</span>
                    <span className="font-mono text-micro uppercase text-bone-mute fcc-num">t½ {h.halfMin} min</span>
                  </span>
                </div>
                {h.ages.map((age) => {
                  const f = fresh(age, h.halfMin);
                  return (
                    <div key={age} className="flex flex-col items-center gap-1 py-3">
                      <ApproxGlyph f={f} size={56} r={12 + (1 - f) * 10} />
                      <Freshness freshness={f} age={ageLabel(age)} />
                      <span className="font-mono text-micro text-ink-400 fcc-num">{f.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="grid grid-cols-2 border-t border-line-strong md:grid-cols-[180px_repeat(5,1fr)]">
              <div className="col-span-2 flex items-center gap-2 px-3 py-3 md:col-span-1">
                <Icon name="drone" size={14} className="text-phosphor" />
                <span className="flex flex-col">
                  <span className="font-mono text-nano uppercase text-bone">Drone / ground cam</span>
                  <span className="font-mono text-micro uppercase text-bone-mute">Live, confirmed</span>
                </span>
              </div>
              <div className="flex flex-col items-center gap-1 py-3">
                <ApproxGlyph f={1} live size={56} r={10} />
                <Freshness freshness={1} live />
                <span className="font-mono text-micro text-ink-400 fcc-num">1.00</span>
              </div>
              <div className="col-span-1 flex items-center px-3 py-3 text-xs text-bone-dim md:col-span-4">
                Live confirmation snaps the glyph solid and shrinks the ring to sensor accuracy. When the feed moves on, the finding starts decaying with
                a 5 min half-life.
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Spec code="f = 0.5 ^ (age / t½)" tag="Decay" bodyClassName="flex-col items-start gap-1 text-left">
              <span className="text-sm text-bone">Freshness halves every half-life of its source.</span>
              <span className="font-mono text-micro uppercase text-bone-mute">Live sources hold f = 1</span>
            </Spec>
            <Spec code="opacity = 0.2 + 0.8 f" tag="Render" bodyClassName="flex-col items-start gap-1 text-left">
              <span className="text-sm text-bone">The glyph and its label fade and desaturate together.</span>
              <span className="font-mono text-micro uppercase text-bone-mute">Ring radius = location uncertainty</span>
            </Spec>
            <Spec code="f < 0.10 → expired" tag="Expire" bodyClassName="flex-col items-start gap-1 text-left">
              <span className="text-sm text-bone">About 3.3 half-lives. Removed from the map, kept in the log.</span>
              <span className="font-mono text-micro uppercase text-bone-mute">Score is also scaled by f</span>
            </Spec>
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<Freshness freshness live age />'}</code>
        </div>

        <div>
          <GroupTitle code="O.6">OrchBubble / PromptChip</GroupTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
            <Thread />
            <div className="flex flex-col gap-3 border border-line bg-ink-900 p-4">
              <span className="fcc-micro">Orchestrator voice</span>
              <ul className="flex flex-col gap-2 text-sm text-bone-dim">
                <li>Calm. No adjectives of alarm; the tier carries urgency.</li>
                <li>Plain. Street names, unit callsigns, minutes.</li>
                <li>Specific. Numbers with units, sources named.</li>
                <li>One action per sentence.</li>
              </ul>
              <code className="mt-auto font-mono text-micro text-bone-dim">{'<OrchBubble role time thinking />'}</code>
              <code className="font-mono text-micro text-bone-dim">{'<PromptChip onClick />'}</code>
            </div>
          </div>
        </div>

        <div>
          <GroupTitle code="O.7">IconRail + Drawer / progressive disclosure</GroupTitle>
          <RailDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<IconRail items value onChange /> + <Drawer open onClose title index side width offset actions />'}</code>
        </div>

        <div>
          <GroupTitle code="O.8">FeedTile / camera surfaces</GroupTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: 'E-41 · Dash cam', live: true, m: 'HDG 042° · 3 det' },
              { l: 'HAWK-2 · EO/IR', live: true, m: 'ALT 120 M · C-07', ir: true },
              { l: 'TikTok · @pinehollow', live: false, m: '14 min ago · approx' },
              { l: 'HAWK-5 · EO', live: true, m: 'ALT 140 M · C-11' },
            ].map((f, i) => (
              <FeedTile key={f.l} label={f.l} live={f.live} selected={i === 1} onClick={() => undefined} meta={<span className="truncate">{f.m}</span>}>
                <FakeFeed seed={i * 2 + 3} tone={f.ir ? 'ir' : 'warm'} />
              </FeedTile>
            ))}
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<FeedTile label live meta selected onClick>{<CameraView feedId />}</FeedTile>'}</code>
        </div>

        <div>
          <GroupTitle code="O.9">PoolBar / agent autoscale</GroupTitle>
          <PoolDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<PoolBar label provider workers maxWorkers queue meta />'}</code>
        </div>

        <div>
          <GroupTitle code="O.10">MovementCard / group movement proposals</GroupTitle>
          <MovementDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<MovementCard title group windowLabel trigger reason score status onApprove onReject onLocate />'}</code>
        </div>
      </div>
    </SubSection>
  );
}
