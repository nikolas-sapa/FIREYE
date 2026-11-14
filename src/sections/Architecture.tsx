import { useEffect, useState } from 'react';
import { Brackets, Dot, Icon, Rule, SectionHeader, Serial, cn, type IconName } from '@ds';

/* ---------------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------------- */

type Node = { id: string; title: string; sub: string; icon: IconName; rate: string };

const INPUTS: Node[] = [
  { id: 'I-01', title: 'Drone video', sub: 'EO/IR · LWIR · 30 FPS', icon: 'video', rate: '30 HZ' },
  { id: 'I-02', title: 'Aerial imagery', sub: 'ORTHO · MULTISPECTRAL', icon: 'image', rate: '5 MIN' },
  { id: 'I-03', title: 'News & social', sub: 'WIRE · LOCAL TV · GEO POSTS', icon: 'news', rate: 'STREAM' },
  { id: 'I-04', title: 'Sensors / IoT', sub: 'WX · FUEL MOISTURE · SMOKE', icon: 'sensor', rate: '1 HZ' },
  { id: 'I-05', title: 'Satellite hotspots', sub: 'GOES-18 · VIIRS · FIRMS', icon: 'satellite', rate: '5 MIN' },
  { id: 'I-06', title: 'Radio / CAD', sub: 'CMD NET · 911 CAD · AVL', icon: 'radio', rate: 'LIVE' },
];

const MODULES: Node[] = [
  { id: 'M-01', title: 'Multimodal fusion', sub: 'GEO-REGISTER · DEDUP · TRUST SCORE', icon: 'layers', rate: '0.4 S' },
  { id: 'M-02', title: 'Detection', sub: 'FIRE EDGE · PERSONS · STRUCTURES', icon: 'eye', rate: '0.8 S' },
  { id: 'M-03', title: 'Fire behavior model', sub: 'ROTHERMEL SPREAD + LEARNED CORR.', icon: 'flame', rate: '6.0 S' },
  { id: 'M-04', title: 'Planner', sub: 'FORCE ALLOCATION · ROUTES · SAFETY', icon: 'route', rate: '2.0 S' },
];

const OUTPUTS: Node[] = [
  { id: 'O-01', title: 'Path projection', sub: '+1H / +3H / +6H BANDS · CONF', icon: 'target', rate: '60 S' },
  { id: 'O-02', title: 'Hazard map', sub: 'FUELS · PERSONS · STRUCTURES', icon: 'hazard', rate: 'LIVE' },
  { id: 'O-03', title: 'Force recommendations', sub: 'RANKED MOVES · ETA · IMPACT', icon: 'crew', rate: 'P1–P3' },
  { id: 'O-04', title: 'Situation briefs', sub: 'SITREP · IAP DELTA · PUBLIC INFO', icon: 'news', rate: '15 MIN' },
];

const CAPABILITIES: { id: string; icon: IconName; title: string; body: string; spec: [string, string][] }[] = [
  {
    id: 'C-01', icon: 'layers', title: 'Multimodal fusion',
    body: 'Video, imagery, text, telemetry and voice are geo-registered onto one grid and scored for trust before they touch the plan.',
    spec: [['Modalities', '06'], ['Latency', '< 2 S']],
  },
  {
    id: 'C-02', icon: 'human', title: 'Human detection',
    body: 'Thermal and visual detectors flag people in the fire path, with confidence and source frame attached for verification.',
    spec: [['Min conf.', '0.70'], ['Review', 'Operator']],
  },
  {
    id: 'C-03', icon: 'flame', title: 'Fire behavior model',
    body: 'A physics spread model corrected by observed perimeter, re-run every time wind, fuels or the fire edge change.',
    spec: [['Cell', '40 M'], ['Re-sim', '60 S']],
  },
  {
    id: 'C-04', icon: 'route', title: 'Path projection',
    body: 'Forecast bands at one, three and six hours, each with a stated confidence, so commanders see both the edge and the doubt.',
    spec: [['Horizon', '360 MIN'], ['Bands', '03']],
  },
  {
    id: 'C-05', icon: 'target', title: 'Force planner',
    body: 'Ranked recommendations for engines, crews, aircraft and dozers, with rationale, ETA and expected impact on spread.',
    spec: [['Priority', 'P1–P3'], ['Mode', 'Human-in-loop']],
  },
  {
    id: 'C-06', icon: 'hazard', title: 'Hazard mapping',
    body: 'Dry brush, structures, access roads, water and safety zones kept current as a layered, queryable hazard picture.',
    spec: [['Layers', '08'], ['Refresh', 'Live']],
  },
  {
    id: 'C-07', icon: 'news', title: 'Situation briefs',
    body: 'Plain-language SITREPs and shift briefings generated from the live picture, with every claim linked to its source.',
    spec: [['Cadence', '15 MIN'], ['Citations', 'Always']],
  },
  {
    id: 'C-08', icon: 'shield', title: 'Degraded-comms safe',
    body: 'Runs at the edge on a command vehicle and syncs upstream when links return. The picture survives a lost uplink.',
    spec: [['Edge', 'On-prem'], ['Sync', 'Eventual']],
  },
];

const LOOP = [
  { id: 'L-01', name: 'Ingest', body: 'Every feed lands timestamped and geo-registered.', time: '0.4', unit: 'S' },
  { id: 'L-02', name: 'Detect', body: 'Fire edge, people, structures and fuels extracted.', time: '0.8', unit: 'S' },
  { id: 'L-03', name: 'Forecast', body: 'Spread re-simulated across 1, 3 and 6 hour horizons.', time: '6.0', unit: 'S' },
  { id: 'L-04', name: 'Recommend', body: 'Ranked force moves with rationale and expected impact.', time: '2.0', unit: 'S' },
  { id: 'L-05', name: 'Act', body: 'Commander accepts. Units are dispatched over CAD.', time: 'OPR', unit: 'HUMAN' },
  { id: 'L-06', name: 'Re-plan', body: 'Outcomes are observed and the model corrects itself.', time: 'CONT', unit: 'LOOP' },
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
 * Schematic (SVG, 1280 x 660 design units)
 * ------------------------------------------------------------------------- */

const SW = 1280;
const SH = 660;
const IN = { x: 0, w: 260, h: 64, y: (i: number) => 40 + i * 96 };
const CORE = { x: 420, y: 72, w: 440, h: 512 };
const MOD = { x: 444, w: 392, h: 84, y: (k: number) => 176 + k * 96 };
const OUT = { x: 1020, w: 260, h: 84, y: (k: number) => 84 + k * 128 };
const inEntry = (i: number) => 196 + i * 64;
const outExit = (k: number) => 228 + k * 80;

const inPath = (i: number) => {
  const y0 = IN.y(i) + IN.h / 2;
  const y1 = inEntry(i);
  return `M${IN.x + IN.w} ${y0}C${IN.x + IN.w + 90} ${y0} ${CORE.x - 90} ${y1} ${CORE.x} ${y1}`;
};
const outPath = (k: number) => {
  const y0 = outExit(k);
  const y1 = OUT.y(k) + OUT.h / 2;
  return `M${CORE.x + CORE.w} ${y0}C${CORE.x + CORE.w + 90} ${y0} ${OUT.x - 90} ${y1} ${OUT.x} ${y1}`;
};
const FEEDBACK = `M${OUT.x + OUT.w / 2} ${OUT.y(3) + OUT.h}V${SH - 24}H${IN.x + IN.w / 2}V${IN.y(5) + IN.h}`;

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

function SchematicNode({ n, x, y, w, h, tone = 'line' }: { n: Node; x: number; y: number; w: number; h: number; tone?: 'line' | 'module' }) {
  return (
    <g>
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} className={cn(tone === 'module' ? 'fill-ink-850' : 'fill-ink-900', 'stroke-line')} />
      <Ticks x={x} y={y} w={w} h={h} className="stroke-ink-400" />
      <text x={x + 16} y={y + 22} className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
        {n.id}
      </text>
      <text x={x + w - 16} y={y + 22} textAnchor="end" className="fill-bone-mute font-mono" fontSize={9} letterSpacing="0.14em">
        {n.rate}
      </text>
      <g transform={`translate(${x + 16} ${y + h - 30})`} className="text-bone-dim">
        <Icon name={n.icon} size={16} />
      </g>
      <text x={x + 44} y={y + h - 26} className="fill-bone font-sans" fontSize={14} letterSpacing="-0.01em">
        {n.title}
      </text>
      <text x={x + 44} y={y + h - 12} className="fill-bone-mute font-mono" fontSize={8.5} letterSpacing="0.12em">
        {n.sub}
      </text>
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
  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="h-auto w-full" role="img" aria-label="Signal path: six input modalities flow into the ARGUS AI core (fusion, detection, fire behavior model, planner), which produces path projections, a hazard map, force recommendations and situation briefs. Outcomes feed back into the core.">
      {/* column captions */}
      <g className="fill-bone-mute font-mono" fontSize={9} letterSpacing="0.14em">
        <text x={IN.x} y={20}>A · INPUTS / 06 MODALITIES</text>
        <text x={CORE.x} y={52}>B · ARGUS AI CORE</text>
        <text x={OUT.x} y={64}>C · OUTPUTS / OPERATIONAL PICTURE</text>
      </g>

      {/* connectors */}
      <g fill="none" strokeWidth={1}>
        {INPUTS.map((_, i) => (
          <path key={i} d={inPath(i)} className="stroke-ink-600" />
        ))}
        {OUTPUTS.map((_, k) => (
          <path key={k} d={outPath(k)} className="stroke-ink-600" />
        ))}
        <path d={FEEDBACK} className="stroke-signal" strokeOpacity={0.45} strokeDasharray="2 4" />
      </g>
      <text x={(IN.x + IN.w / 2 + OUT.x + OUT.w / 2) / 2} y={SH - 32} textAnchor="middle" className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
        FEEDBACK · OBSERVED OUTCOMES RE-ENTER AS SIGNAL · RE-PLAN CONTINUOUS
      </text>
      {INPUTS.map((_, i) => (
        <rect key={i} x={CORE.x - 3} y={inEntry(i) - 3} width={6} height={6} className="fill-ink-950 stroke-ink-300" />
      ))}
      {OUTPUTS.map((_, k) => (
        <rect key={k} x={CORE.x + CORE.w - 3} y={outExit(k) - 3} width={6} height={6} className="fill-ink-950 stroke-signal" />
      ))}

      {/* inputs */}
      {INPUTS.map((n, i) => (
        <SchematicNode key={n.id} n={n} x={IN.x} y={IN.y(i)} w={IN.w} h={IN.h} />
      ))}

      {/* core */}
      <g>
        <rect x={CORE.x + 0.5} y={CORE.y + 0.5} width={CORE.w - 1} height={CORE.h - 1} className="fill-ink-950 stroke-line-strong" />
        <Ticks x={CORE.x - 4} y={CORE.y - 4} w={CORE.w + 8} h={CORE.h + 8} className="stroke-signal" />
        <text x={CORE.x + 24} y={CORE.y + 48} className="fill-bone font-sans" fontSize={30} letterSpacing="-0.02em">
          ARGUS
        </text>
        <text x={CORE.x + 24} y={CORE.y + 70} className="fill-bone-mute font-mono" fontSize={9} letterSpacing="0.14em">
          AI CORE · REV 2.1 · EDGE + CLOUD
        </text>
        <g transform={`translate(${CORE.x + CORE.w - 24} ${CORE.y + 26})`}>
          <rect x={-74} y={0} width={74} height={18} fill="none" className="stroke-signal" strokeOpacity={0.6} />
          <rect x={-66} y={6} width={6} height={6} className="fill-signal" />
          <text x={-8} y={12.5} textAnchor="end" className="fill-signal font-mono" fontSize={9} letterSpacing="0.14em">
            ONLINE
          </text>
        </g>
        {MODULES.map((m, k) => (
          <g key={m.id}>
            <SchematicNode n={m} x={MOD.x} y={MOD.y(k)} w={MOD.w} h={MOD.h} tone="module" />
            {k < MODULES.length - 1 && (
              <path d={`M${MOD.x + MOD.w / 2} ${MOD.y(k) + MOD.h}V${MOD.y(k + 1)}`} className="stroke-ink-400" strokeWidth={1} />
            )}
          </g>
        ))}
        <rect x={CORE.x + 24} y={CORE.y + CORE.h - 28} width={CORE.w - 48} height={8} fill="url(#fcc-arch-hatch)" />
      </g>

      {/* outputs */}
      {OUTPUTS.map((n, k) => (
        <SchematicNode key={n.id} n={n} x={OUT.x} y={OUT.y(k)} w={OUT.w} h={OUT.h} />
      ))}

      <defs>
        <pattern id="fcc-arch-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} className="stroke-ink-500" strokeWidth={1} />
        </pattern>
      </defs>

      {!reduced && (
        <g>
          {INPUTS.map((_, i) => (
            <Packet key={`i${i}`} path={inPath(i)} dur={2.2 + (i % 3) * 0.5} begin={i * 0.37} className="fill-ice" />
          ))}
          {OUTPUTS.map((_, k) => (
            <Packet key={`o${k}`} path={outPath(k)} dur={2.6 + (k % 2) * 0.6} begin={0.9 + k * 0.45} className="fill-signal" />
          ))}
          <Packet path={FEEDBACK} dur={7} begin={1.5} className="fill-signal" />
        </g>
      )}
    </svg>
  );
}

function StackedSchematic() {
  const group = (code: string, title: string, nodes: Node[], accent = false) => (
    <div className="relative border border-line bg-ink-900">
      {accent && <Brackets tone="signal" />}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="fcc-micro">
          <span className="text-signal">{code}</span> · {title}
        </span>
        <span className="fcc-micro">{String(nodes.length).padStart(2, '0')}</span>
      </div>
      <ul className="divide-y divide-line">
        {nodes.map((n) => (
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
      {group('B', 'ARGUS AI core', MODULES, true)}
      {arrow}
      {group('C', 'Outputs', OUTPUTS)}
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
              Every signal.
              <br />
              <span className="text-bone-mute">One picture.</span>
            </>
          }
          lede="Six kinds of evidence stream into ARGUS, a fusion and reasoning core that turns them into a forecast, a hazard map and a ranked set of moves. Commanders stay in the loop; the loop never stops."
          meta={<Serial>FCC-02 / Schematic</Serial>}
        />

        {/* 02.1 signal path */}
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
              <span className="inline-block h-1.5 w-1.5 bg-ice" /> Inbound evidence
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block h-1.5 w-1.5 bg-signal" /> Decision product
            </span>
            <span className="flex items-center gap-2 fcc-micro">
              <span className="inline-block w-4 border-t border-dashed border-signal" /> Feedback
            </span>
          </div>
        </div>

        {/* 02.2 capabilities */}
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

        {/* 02.3 decision loop */}
        <div className="mt-24">
          <Rule title="02.3 — Decision loop" />
          <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
            <p className="max-w-xl text-lg text-bone-dim">
              A closed loop from evidence to action. Machine stages run in seconds; the one human stage is where authority
              lives.
            </p>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="fcc-micro">Median cycle</span>
                <span className="font-mono text-2xl text-bone fcc-num">
                  42<span className="ml-1 text-nano text-bone-mute">S</span>
                </span>
              </div>
              <div className="h-10 w-px bg-line" aria-hidden />
              <div className="flex flex-col items-end">
                <span className="fcc-micro">Machine time</span>
                <span className="font-mono text-2xl text-bone fcc-num">
                  9.2<span className="ml-1 text-nano text-bone-mute">S</span>
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
            <span className="fcc-micro text-signal">Re-plan · loop restarts on every new signal</span>
          </div>
        </div>
      </div>
    </section>
  );
}
