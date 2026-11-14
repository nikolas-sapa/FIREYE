import { useEffect, useState } from 'react';
import { Brackets, Dot, Freshness, Icon, Rule, SectionHeader, Serial, TIER_BANDS, cn, type IconName } from '@ds';

/* ---------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

type Node = { id: string; title: string; sub: string; icon: IconName; rate: string };

const INPUTS: (Node & { pool: number; live: boolean })[] = [
  { id: 'I-01', title: 'Web & local news', sub: 'FIRECRAWL SEARCH + SCRAPE', icon: 'web', rate: '2 MIN', pool: 0, live: false },
  { id: 'I-02', title: 'Satellite imagery', sub: 'FIRMS · SENTINEL-2 · GOES', icon: 'satellite', rate: 'PASS', pool: 1, live: false },
  { id: 'I-03', title: 'Ground vehicle cams', sub: 'ENGINE · CREW · DOZER DASH', icon: 'camera', rate: 'LIVE', pool: 2, live: true },
  { id: 'I-04', title: 'Drone network cams', sub: 'EO/IR · COVERAGE GRID', icon: 'drone', rate: 'LIVE', pool: 2, live: true },
  { id: 'I-05', title: 'Social media video', sub: 'GEOTAGGED · IN-AREA', icon: 'social', rate: 'STREAM', pool: 2, live: false },
  { id: 'I-06', title: 'Weather API', sub: 'NWS · WIND · RH · GUSTS', icon: 'wind', rate: '5 MIN', pool: 3, live: false },
  { id: 'I-07', title: 'Terrain API', sub: 'USGS 3DEP · SLOPE · FUEL', icon: 'map', rate: 'STATIC', pool: 3, live: false },
];

const POOLS: { id: string; title: string; sub: string; icon: IconName; provider: string; max: number; base: number }[] = [
  { id: 'P-01', title: 'Text & web agents', sub: 'EXTRACT PLACES · PEOPLE · ROADS', icon: 'news', provider: 'FIRECRAWL · TREQ', max: 12, base: 3 },
  { id: 'P-02', title: 'Imagery agents', sub: 'HOTSPOTS · BURN SCAR · NBR', icon: 'image', provider: 'FAL VISION', max: 12, base: 4 },
  { id: 'P-03', title: 'Video agents', sub: 'LIFE · TANKS · VEHICLES · SPOTS', icon: 'video', provider: 'FAL VIDEO-UNDERSTANDING', max: 24, base: 10 },
  { id: 'P-04', title: 'Environment agents', sub: 'WIND FIELD · FUEL MOISTURE', icon: 'thermometer', provider: 'TREQ', max: 6, base: 2 },
];

const OUTPUTS: Node[] = [
  { id: 'O-01', title: 'Console user', sub: 'GRADED VIEW · CHAT', icon: 'eye', rate: 'T0–T3' },
  { id: 'O-02', title: 'Firefighters', sub: 'MOVES · HAZARDS', icon: 'engine', rate: 'T0–T1' },
  { id: 'O-03', title: 'EMS / responders', sub: 'LIFE · ACCESS', icon: 'crew', rate: 'T0–T1' },
  { id: 'O-04', title: 'Law / evacuation', sub: 'ROADS · ZONES', icon: 'shield', rate: 'T0' },
  { id: 'O-05', title: 'Public', sub: 'PLAIN NOTICES', icon: 'radio', rate: 'T0' },
];

const CAPABILITIES: { id: string; icon: IconName; title: string; body: string; spec: [string, string][] }[] = [
  {
    id: 'C-01', icon: 'agents', title: 'Agents per input',
    body: 'Each input type gets its own pool of analysis agents in sandboxes that scale with the queue. A surge of social video never starves the satellite pass.',
    spec: [['Pools', '04'], ['Scale', 'Queue-driven']],
  },
  {
    id: 'C-02', icon: 'human', title: 'Life first',
    body: 'People and animals in or near the projected path are the highest alert class. Every detection carries its source frame and a location uncertainty.',
    spec: [['Class', 'Life'], ['Tier', 'T0–T1']],
  },
  {
    id: 'C-03', icon: 'combustible', title: 'Sensitivity to fire',
    body: 'Propane tanks, fuel depots and vehicles raise local risk; irrigated fields and water lower it. Both feed the projection and alert nearby crews.',
    spec: [['Raise', 'Tanks · brush'], ['Lower', 'Water · fields']],
  },
  {
    id: 'C-04', icon: 'flame', title: 'Projection agent',
    body: 'A concurrent, scoped agent re-draws the +1H, +3H and +6H path every time wind, fuel or a new fire edge arrives, with stated confidence.',
    spec: [['Horizon', '360 MIN'], ['Re-project', 'On change']],
  },
  {
    id: 'C-05', icon: 'orchestrator', title: 'Orchestrator grading',
    body: 'Every finding is scored 0 to 100. The score decides where it renders and who hears it. Only one item may interrupt, and it must be acknowledged.',
    spec: [['Tiers', '04'], ['Interrupts', '1 at a time']],
  },
  {
    id: 'C-06', icon: 'route', title: 'Group movement',
    body: 'Proposals name the group, the destination, the route, the time window, the safety zone and the trigger. The commander approves; units move.',
    spec: [['Fields', '06'], ['Mode', 'Human-in-loop']],
  },
  {
    id: 'C-07', icon: 'grid', title: 'Drone coverage grid',
    body: 'The area is tiled into cells. Drones are assigned to the highest-interest cells and re-assigned as the projection moves, each with a live camera.',
    spec: [['Cell', '1.2 KM'], ['Re-task', 'Continuous']],
  },
  {
    id: 'C-08', icon: 'send', title: 'Audience relay',
    body: 'The same finding is phrased differently for fire, EMS, law and the public, and each audience only gets what it can act on.',
    spec: [['Audiences', '04'], ['Log', 'Always']],
  },
];

const LOOP = [
  { id: 'L-01', name: 'Ingest', body: 'Feeds land timestamped, located and tagged live or not.', time: '0.4', unit: 'S' },
  { id: 'L-02', name: 'Analyze', body: 'Pools extract life, hazards, fuels and fire edges.', time: '2.5', unit: 'S' },
  { id: 'L-03', name: 'Project', body: 'The fire path is re-projected on any material change.', time: '6.0', unit: 'S' },
  { id: 'L-04', name: 'Grade', body: 'The Orchestrator scores, places and relays each item.', time: '0.8', unit: 'S' },
  { id: 'L-05', name: 'Approve', body: 'The commander acknowledges and approves movements.', time: 'OPR', unit: 'HUMAN' },
  { id: 'L-06', name: 'Re-task', body: 'Units and drones move; their cameras confirm or refute.', time: 'CONT', unit: 'LOOP' },
];

/* ---------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------- */

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function useStep(count: number, ms: number, paused: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => window.clearInterval(id);
  }, [count, ms, paused]);
  return i;
}

/* ---------------------------------------------------------------------------
 * Schematic (SVG, 1400 x 700 design units)
 * ------------------------------------------------------------------------- */

const SW = 1400;
const SH = 700;
const IN = { x: 0, w: 220, h: 64, y: (i: number) => 48 + i * 74 };
const POOL = { x: 300, w: 260, h: 110, y: (k: number) => 64 + k * 124 };
const BOX = { x: 284, y: 36, w: 292, h: 600 };
const PROJ = { x: 640, y: 96, w: 210, h: 168 };
const ORCH = { x: 910, y: 48, w: 260, h: 588 };
const OUT = { x: 1240, w: 160, h: 80, y: (k: number) => 68 + k * 112 };

const curve = (x0: number, y0: number, x1: number, y1: number, k = 50) => `M${x0} ${y0}C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}`;

const poolEntry = (k: number, j: number, n: number) => POOL.y(k) + 30 + (n > 1 ? (j * 50) / (n - 1) : 25);
const inPaths = INPUTS.map((inp, i) => {
  const siblings = INPUTS.filter((x) => x.pool === inp.pool);
  const j = siblings.indexOf(inp);
  return curve(IN.x + IN.w, IN.y(i) + IN.h / 2, POOL.x, poolEntry(inp.pool, j, siblings.length), 40);
});
const poolToProj = POOLS.map((_, k) => curve(POOL.x + POOL.w, POOL.y(k) + 40, PROJ.x, PROJ.y + 50 + k * 22, 40));
const poolToOrch = POOLS.map((_, k) => curve(POOL.x + POOL.w, POOL.y(k) + 76, ORCH.x, 340 + k * 34, 120));
const projToOrch = curve(PROJ.x + PROJ.w, PROJ.y + PROJ.h / 2, ORCH.x, PROJ.y + PROJ.h / 2, 30);
const outPaths = OUTPUTS.map((_, k) => curve(ORCH.x + ORCH.w, 150 + k * 90, OUT.x, OUT.y(k) + OUT.h / 2, 30));
const FEEDBACK = `M${OUT.x + OUT.w / 2} ${OUT.y(4) + OUT.h}V${SH - 22}H${IN.x + IN.w / 2}V${IN.y(6) + IN.h}`;

function Ticks({ x, y, w, h, className }: { x: number; y: number; w: number; h: number; className: string }) {
  const s = 7;
  return (
    <path
      d={`M${x} ${y + s}V${y}H${x + s}M${x + w - s} ${y}H${x + w}V${y + s}M${x + w} ${y + h - s}V${y + h}H${x + w - s}M${x + s} ${y + h}H${x}V${y + h - s}`}
      fill="none"
      className={className}
      strokeWidth={1}
    />
  );
}

function SchematicNode({ n, x, y, w, h, live }: { n: Node; x: number; y: number; w: number; h: number; live?: boolean }) {
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} className="fill-ink-900 stroke-line" />
      <Ticks x={x} y={y} w={w} h={h} className="stroke-ink-400" />
      <text x={x + 14} y={y + 20} className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
        {n.id}
      </text>
      <text x={x + w - 14} y={y + 20} textAnchor="end" className={live ? 'fill-phosphor font-mono' : 'fill-bone-mute font-mono'} fontSize={9} letterSpacing="0.14em">
        {n.rate}
      </text>
      <g transform={`translate(${x + 14} ${y + h - 30})`} className="text-bone-dim">
        <Icon name={n.icon} size={16} />
      </g>
      <text x={x + 40} y={y + h - 24} className="fill-bone font-sans" fontSize={13.5} letterSpacing="-0.01em">
        {n.title}
      </text>
      <text x={x + 40} y={y + h - 11} className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.1em">
        {n.sub}
      </text>
    </g>
  );
}

function PoolNode({ p, k, t }: { p: (typeof POOLS)[number]; k: number; t: number }) {
  const x = POOL.x;
  const y = POOL.y(k);
  const wave = Math.sin(t * 0.5 + k * 1.9) * 0.5 + 0.5;
  const workers = Math.min(p.max, Math.round(p.base + wave * (p.max - p.base) * 0.8));
  const cellW = (POOL.w - 28 - (p.max - 1) * 2) / p.max;
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={POOL.w - 1} height={POOL.h - 1} className="fill-ink-850 stroke-line" />
      <Ticks x={x} y={y} w={POOL.w} h={POOL.h} className="stroke-ink-400" />
      <text x={x + 14} y={y + 20} className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
        {p.id}
      </text>
      <text x={x + POOL.w - 14} y={y + 20} textAnchor="end" className="fill-bone-mute font-mono" fontSize={8.5} letterSpacing="0.12em">
        {p.provider}
      </text>
      <g transform={`translate(${x + 14} ${y + 32})`} className="text-bone-dim">
        <Icon name={p.icon} size={16} />
      </g>
      <text x={x + 40} y={y + 45} className="fill-bone font-sans" fontSize={14} letterSpacing="-0.01em">
        {p.title}
      </text>
      <text x={x + 40} y={y + 59} className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.1em">
        {p.sub}
      </text>
      {Array.from({ length: p.max }).map((_, i) => (
        <rect
          key={i}
          x={x + 14 + i * (cellW + 2)}
          y={y + 74}
          width={cellW}
          height={10}
          className={cn('transition-colors duration-base', i < workers ? 'fill-ice' : 'fill-ink-700')}
        />
      ))}
      <text x={x + 14} y={y + 100} className="fill-bone-mute font-mono" fontSize={8.5} letterSpacing="0.12em">
        SANDBOXES
      </text>
      <text x={x + POOL.w - 14} y={y + 100} textAnchor="end" className="fill-ice font-mono" fontSize={8.5} letterSpacing="0.12em">
        {String(workers).padStart(2, '0')}/{String(p.max).padStart(2, '0')}
      </text>
    </g>
  );
}

const tierFill = ['fill-ember', 'fill-amber', 'fill-ice', 'fill-ink-400'];
const tierText = ['fill-ember', 'fill-amber', 'fill-ice', 'fill-bone-mute'];
const tierShort = ['BANNER · ACK · FLY-TO', 'DOCK · NEEDS ATTENTION', 'MAP GLYPH · COUNT', 'LOG DRAWER ONLY'];

function Orchestrator({ active }: { active: number }) {
  const { x, y, w, h } = ORCH;
  const fns = [
    ['Grade', 'SCORE 0–100 · LIFE FIRST'],
    ['Place', 'TIER → WHERE IT SHOWS'],
    ['Relay', 'PER-AUDIENCE PHRASING'],
    ['Propose', 'GROUP MOVES · ROUTES'],
  ];
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} className="fill-ink-950 stroke-line-strong" />
      <Ticks x={x - 4} y={y - 4} w={w + 8} h={h + 8} className="stroke-signal" />
      <g transform={`translate(${x + 20} ${y + 22})`} className="text-ice">
        <Icon name="orchestrator" size={20} />
      </g>
      <text x={x + 48} y={y + 38} className="fill-bone font-sans" fontSize={22} letterSpacing="-0.02em">
        Orchestrator
      </text>
      <text x={x + 20} y={y + 62} className="fill-bone-mute font-mono" fontSize={8.5} letterSpacing="0.14em">
        WORKS BESIDE THE COMMANDER
      </text>
      {fns.map(([t, s], i) => (
        <g key={t}>
          <line x1={x + 20} x2={x + w - 20} y1={y + 82 + i * 42} y2={y + 82 + i * 42} className="stroke-line" />
          <text x={x + 20} y={y + 102 + i * 42} className="fill-bone font-mono" fontSize={10} letterSpacing="0.14em">
            {t.toUpperCase()}
          </text>
          <text x={x + 20} y={y + 115 + i * 42} className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.1em">
            {s}
          </text>
        </g>
      ))}
      <text x={x + 20} y={y + 280} className="fill-bone-mute font-mono" fontSize={8.5} letterSpacing="0.14em">
        OUTPUT STAGE · ALERT TIERS
      </text>
      {TIER_BANDS.map((b, i) => {
        const ty = y + 294 + i * 70;
        const on = active === i;
        return (
          <g key={b.tier}>
            <rect x={x + 20} y={ty} width={w - 40} height={60} className={on ? 'fill-ink-850 stroke-line-strong' : 'fill-ink-900 stroke-line'} />
            <rect x={x + 20} y={ty} width={2} height={60} className={tierFill[i]} />
            <rect x={x + 32} y={ty + 12} width={92} height={16} className={i === 0 ? 'fill-ember' : 'fill-none'} />
            <text x={x + 38} y={ty + 23.5} className={i === 0 ? 'fill-ink-950 font-mono' : cn(tierText[i], 'font-mono')} fontSize={8.5} letterSpacing="0.12em">
              T{b.tier} {b.name.toUpperCase()}
            </text>
            <text x={x + w - 32} y={ty + 24} textAnchor="end" className="fill-bone font-mono" fontSize={10} letterSpacing="0.06em">
              {String(b.min).padStart(2, '0')}–{b.max}
            </text>
            <text x={x + 32} y={ty + 46} className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.1em">
              {tierShort[i]}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Packet({ path, dur, begin, className }: { path: string; dur: number; begin: number; className: string }) {
  return (
    <rect x={-2.5} y={-2.5} width={5} height={5} className={className}>
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={path} rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.7 0 0.2 1" />
    </rect>
  );
}

function Schematic({ reduced }: { reduced: boolean }) {
  const t = useStep(1000, 900, reduced);
  const tierActive = Math.floor(t / 2) % 4;
  return (
    <svg
      viewBox={`0 0 ${SW} ${SH}`}
      className="h-auto w-full"
      role="img"
      aria-label="Signal path: seven inputs (web and news via Firecrawl, satellite imagery, ground vehicle cameras, drone cameras, social video, weather and terrain) feed four autoscaling analysis agent pools on boxd. Pools feed a concurrent projection agent and the Orchestrator. The Orchestrator grades every finding into four tiers and relays it to the console user, firefighters, EMS, law and the public. Field outcomes feed back as new inputs."
    >
      <g className="fill-bone-mute font-mono" fontSize={9} letterSpacing="0.14em">
        <text x={IN.x} y={28}>A · INPUTS / 07</text>
        <text x={BOX.x} y={24}>B · ANALYSIS POOLS · BOXD SANDBOXES</text>
        <text x={PROJ.x} y={PROJ.y - 14}>C · PROJECTION</text>
        <text x={ORCH.x} y={30}>D · ORCHESTRATOR</text>
        <text x={OUT.x} y={48}>E · AUDIENCES</text>
      </g>

      <rect x={BOX.x + 0.5} y={BOX.y + 0.5} width={BOX.w - 1} height={BOX.h - 1} fill="none" className="stroke-ink-600" strokeDasharray="3 3" />
      <text x={BOX.x + BOX.w / 2} y={BOX.y + BOX.h - 10} textAnchor="middle" className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.14em">
        AUTOSCALE ON QUEUE · MODELS VIA TREQ · FAL
      </text>

      <g fill="none" strokeWidth={1}>
        {inPaths.map((d, i) => (
          <path key={i} d={d} className="stroke-ink-600" />
        ))}
        {poolToProj.map((d, k) => (
          <path key={k} d={d} className="stroke-ink-600" />
        ))}
        {poolToOrch.map((d, k) => (
          <path key={k} d={d} className="stroke-ink-600" />
        ))}
        <path d={projToOrch} className="stroke-amber" strokeOpacity={0.6} />
        {outPaths.map((d, k) => (
          <path key={k} d={d} className="stroke-ink-600" />
        ))}
        <path d={FEEDBACK} className="stroke-signal" strokeOpacity={0.45} strokeDasharray="2 4" />
      </g>
      <text x={(IN.x + OUT.x + OUT.w) / 2} y={SH - 30} textAnchor="middle" className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
        FEEDBACK · UNITS AND DRONES RE-TASKED · THEIR CAMERAS CONFIRM OR REFUTE · RE-PROJECT
      </text>

      {INPUTS.map((n, i) => (
        <SchematicNode key={n.id} n={n} x={IN.x} y={IN.y(i)} w={IN.w} h={IN.h} live={n.live} />
      ))}
      {POOLS.map((p, k) => (
        <PoolNode key={p.id} p={p} k={k} t={t} />
      ))}

      <g>
        <rect x={PROJ.x + 0.5} y={PROJ.y + 0.5} width={PROJ.w - 1} height={PROJ.h - 1} className="fill-ink-900 stroke-line-strong" />
        <Ticks x={PROJ.x} y={PROJ.y} w={PROJ.w} h={PROJ.h} className="stroke-amber" />
        <g transform={`translate(${PROJ.x + 16} ${PROJ.y + 16})`} className="text-amber">
          <Icon name="flame" size={16} />
        </g>
        <text x={PROJ.x + 40} y={PROJ.y + 29} className="fill-bone font-sans" fontSize={15}>
          Projection agent
        </text>
        <text x={PROJ.x + 16} y={PROJ.y + 52} className="fill-bone-mute font-mono" fontSize={8} letterSpacing="0.12em">
          CONCURRENT · SCOPED · RE-PROJECTS
        </text>
        {[0.38, 0.6, 0.85].map((s, i) => (
          <path
            key={i}
            d={`M${PROJ.x + 22} ${PROJ.y + 140}q${60 * s} ${-70 * s} ${150 * s} ${-74 * s}`}
            fill="none"
            className={i === 0 ? 'stroke-ember' : 'stroke-amber'}
            strokeOpacity={i === 0 ? 0.9 : 0.75 - i * 0.2}
            strokeDasharray={i === 0 ? undefined : '4 3'}
          />
        ))}
        <text x={PROJ.x + PROJ.w - 16} y={PROJ.y + 156} textAnchor="end" className="fill-amber font-mono" fontSize={8.5} letterSpacing="0.14em">
          +1H · +3H · +6H
        </text>
      </g>

      <Orchestrator active={tierActive} />

      {OUTPUTS.map((n, k) => (
        <SchematicNode key={n.id} n={n} x={OUT.x} y={OUT.y(k)} w={OUT.w} h={OUT.h} />
      ))}

      {!reduced && (
        <g>
          {inPaths.map((d, i) => (
            <Packet key={`i${i}`} path={d} dur={2 + (i % 3) * 0.45} begin={i * 0.31} className="fill-ice" />
          ))}
          {poolToProj.map((d, k) => (
            <Packet key={`p${k}`} path={d} dur={2.4} begin={0.6 + k * 0.5} className="fill-ice" />
          ))}
          {poolToOrch.map((d, k) => (
            <Packet key={`q${k}`} path={d} dur={2.8} begin={1.1 + k * 0.4} className="fill-ice" />
          ))}
          <Packet path={projToOrch} dur={1.6} begin={0.4} className="fill-amber" />
          {outPaths.map((d, k) => (
            <Packet key={`o${k}`} path={d} dur={2.2 + (k % 2) * 0.5} begin={1.2 + k * 0.35} className="fill-signal" />
          ))}
          <Packet path={FEEDBACK} dur={8} begin={1.5} className="fill-signal" />
        </g>
      )}
    </svg>
  );
}

function StackedSchematic() {
  const group = (code: string, title: string, rows: { id: string; icon: IconName; title: string; sub: string; rate: string }[], accent = false) => (
    <div className="relative border border-line bg-ink-900">
      {accent && <Brackets tone="signal" />}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="fcc-micro">
          <span className="text-signal">{code}</span> · {title}
        </span>
        <span className="fcc-micro">{String(rows.length).padStart(2, '0')}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((n) => (
          <li key={n.id} className="flex items-center gap-3 px-4 py-3">
            <Icon name={n.icon} size={16} className="text-bone-dim" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-bone">{n.title}</div>
              <div className="truncate font-mono text-micro uppercase text-bone-mute">{n.sub}</div>
            </div>
            <span className="font-mono text-micro text-bone-mute">{n.rate}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  const arrow = (
    <div className="flex justify-center py-2 text-ink-400" aria-hidden>
      <Icon name="chevron-down" size={16} />
    </div>
  );
  return (
    <div>
      {group('A', 'Inputs', INPUTS)}
      {arrow}
      {group('B', 'Analysis pools · boxd', POOLS.map((p) => ({ ...p, rate: p.provider.split(' ')[0] ?? '' })))}
      {arrow}
      {group('C', 'Projection', [{ id: 'X', icon: 'flame', title: 'Projection agent', sub: 'Concurrent · scoped · +1H/+3H/+6H', rate: 'ON CHANGE' }])}
      {arrow}
      {group(
        'D',
        'Orchestrator / tiers',
        TIER_BANDS.map((b, i) => ({ id: `T${b.tier}`, icon: 'orchestrator' as IconName, title: `T${b.tier} ${b.name}`, sub: tierShort[i] ?? '', rate: `${b.min}–${b.max}` })),
        true,
      )}
      {arrow}
      {group('E', 'Audiences', OUTPUTS)}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Freshness explainer
 * ------------------------------------------------------------------------- */

const FRESH_STEPS = [0, 10, 20, 35, 55];

function FreshnessStrip() {
  const half = 15;
  return (
    <div className="relative border border-line bg-ink-900 p-5">
      <Brackets size={6} />
      <div className="flex items-center justify-between">
        <span className="fcc-micro">Social video · 2 hikers · t½ {half} min</span>
        <span className="font-mono text-micro text-bone-mute">f = 0.5 ^ (age / t½)</span>
      </div>
      <div className="mt-5 grid grid-cols-5 gap-px bg-line">
        {FRESH_STEPS.map((age) => {
          const f = Math.pow(0.5, age / half);
          const expired = f < 0.1;
          return (
            <div key={age} className="flex flex-col items-center gap-3 bg-ink-900 py-4">
              <svg width={84} height={84} viewBox="0 0 84 84" aria-hidden>
                <g className="text-violet" style={{ opacity: expired ? 0.25 : 0.2 + 0.8 * f }}>
                  <circle cx={42} cy={42} r={14 + (1 - f) * 22} fill="currentColor" fillOpacity={0.06 * f} stroke="currentColor" strokeDasharray="3 3" />
                  <circle cx={42} cy={42} r={3} fill={expired ? 'none' : 'currentColor'} stroke="currentColor" />
                </g>
              </svg>
              <Freshness freshness={f} age={age === 0 ? 'Now' : `${age}m ago`} />
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-line-faint pt-3">
        <span className="flex items-center gap-2">
          <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden className="text-violet">
            <rect x={5} y={5} width={8} height={8} fill="currentColor" />
          </svg>
          <Freshness freshness={1} live />
          <span className="text-xs text-bone-dim">Drone confirms: glyph goes solid, ring shrinks to sensor accuracy.</span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Section
 * ------------------------------------------------------------------------- */

export default function Architecture() {
  const reduced = useReducedMotion();
  const active = useStep(LOOP.length, 1600, reduced);

  return (
    <section id="architecture" className="relative border-b border-line">
      <div className="mx-auto max-w-[1440px] px-6 py-24 lg:px-10 lg:py-32">
        <SectionHeader
          index="02"
          eyebrow="Architecture"
          title={
            <>
              Many agents.
              <br />
              <span className="text-bone-mute">One calm voice.</span>
            </>
          }
          lede="Seven kinds of evidence are read by pools of analysis agents that scale with the load. A projection agent re-draws the fire path as they report. The Orchestrator grades everything, decides where it shows, and relays it to the people who can act on it."
          meta={<Serial>FCC-02 / Schematic / Rev B</Serial>}
        />

        <div className="mt-20">
          <Rule title="02.1 — Signal path" />
          <div className="mt-10 hidden lg:block">
            <Schematic reduced={reduced} />
          </div>
          <div className="mt-8 lg:hidden">
            <StackedSchematic />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2">
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block h-1.5 w-1.5 bg-ice" /> Evidence and findings
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block h-1.5 w-1.5 bg-amber" /> Projection
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block h-1.5 w-1.5 bg-signal" /> Graded relay
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block w-4 border-t border-dashed border-signal" /> Feedback
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block w-4 border-t border-dashed border-ink-400" /> Sandbox boundary
            </span>
          </div>
        </div>

        <div className="mt-24">
          <Rule title="02.2 — Capabilities" />
          <div className="mt-10 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <article key={c.id} className="group relative flex flex-col bg-ink-950 p-6 transition-colors duration-base ease-servo hover:bg-ink-900">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-micro text-signal">{c.id}</span>
                  <Icon name={c.icon} size={18} className="text-bone-mute transition-colors duration-base ease-servo group-hover:text-bone" />
                </div>
                <h3 className="mt-10 text-xl text-bone">{c.title}</h3>
                <p className="mt-3 flex-1 text-sm text-bone-dim">{c.body}</p>
                <dl className="mt-8 divide-y divide-line border-t border-line">
                  {c.spec.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-2">
                      <dt className="fcc-micro">{k}</dt>
                      <dd className="font-mono text-tiny uppercase text-bone fcc-num">{v}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-24">
          <Rule title="02.3 — Freshness" />
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <p className="text-lg text-bone-dim">Time is of the essence. Anything that is not seen live right now is shown as approximate, and it fades.</p>
              <ul className="mt-6 flex flex-col gap-3 text-sm text-bone-dim">
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 bg-violet" />
                  Articles, social posts and satellite passes render as a dot inside a dashed uncertainty ring.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 bg-violet" />
                  Each source has a half-life: social 15 min, web 20 min, satellite 40 min. Opacity and score both scale with freshness.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 bg-violet" />
                  Below 0.10 the finding leaves the map and stays in the log. A live camera confirmation resets it to solid.
                </li>
              </ul>
            </div>
            <div className="lg:col-span-8">
              <FreshnessStrip />
            </div>
          </div>
        </div>

        <div className="mt-24">
          <Rule title="02.4 — Decision loop" />
          <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
            <p className="max-w-xl text-lg text-bone-dim">
              A closed loop from evidence to action. Agents run in seconds and in parallel; the one human stage is where
              authority lives, and the Orchestrator keeps it uncluttered.
            </p>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="fcc-micro">Median cycle</span>
                <span className="font-mono text-2xl text-bone fcc-num">
                  38<span className="ml-1 text-nano text-bone-mute">S</span>
                </span>
              </div>
              <div className="h-10 w-px bg-line" aria-hidden />
              <div className="flex flex-col items-end">
                <span className="fcc-micro">Machine time</span>
                <span className="font-mono text-2xl text-bone fcc-num">
                  9.7<span className="ml-1 text-nano text-bone-mute">S</span>
                </span>
              </div>
            </div>
          </div>

          <ol className="mt-10 grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
            {LOOP.map((s, i) => {
              const on = i === active;
              const human = s.id === 'L-05';
              return (
                <li key={s.id} className={cn('relative flex flex-col bg-ink-950 p-5 transition-colors duration-slow ease-servo', on && 'bg-ink-900')}>
                  <span
                    aria-hidden
                    className={cn('absolute inset-x-0 top-0 h-px origin-left bg-signal transition-transform duration-slow ease-servo', on ? 'scale-x-100' : 'scale-x-0')}
                  />
                  <div className="flex items-center justify-between">
                    <span className={cn('font-mono text-micro transition-colors duration-base', on ? 'text-signal' : 'text-ink-500')}>{s.id}</span>
                    {human ? (
                      <span className="font-mono text-micro uppercase text-amber">Human</span>
                    ) : (
                      <Dot className={on ? 'bg-signal' : 'bg-ink-600'} size={5} />
                    )}
                  </div>
                  <h3 className="mt-8 text-xl text-bone">{s.name}</h3>
                  <p className="mt-2 flex-1 text-sm text-bone-dim">{s.body}</p>
                  <div className="mt-8 flex items-baseline gap-1 border-t border-line pt-3">
                    <span className={cn('font-mono text-xl fcc-num', human ? 'text-amber' : 'text-bone')}>{s.time}</span>
                    <span className="font-mono text-nano uppercase text-bone-mute">{s.unit}</span>
                  </div>
                  {i < LOOP.length - 1 && (
                    <span aria-hidden className="absolute -right-[5px] top-1/2 z-raised hidden h-[9px] w-[9px] -translate-y-1/2 rotate-45 border-r border-t border-line-strong bg-ink-950 xl:block" />
                  )}
                </li>
              );
            })}
          </ol>
          <svg viewBox="0 0 1200 40" preserveAspectRatio="none" className="hidden h-10 w-full xl:block" aria-hidden>
            <path d="M1100 0V24H100V6" fill="none" className="stroke-signal" strokeOpacity={0.5} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            <path d="M96 10L100 2L104 10" fill="none" className="stroke-signal" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="mt-1 hidden justify-center xl:flex">
            <span className="fcc-micro text-signal">Re-project · loop restarts on every new finding</span>
          </div>
        </div>
      </div>
    </section>
  );
}
