import { Brackets, Label, Serial, Datum, color, radius, space, type, cn, fmtLat, fmtLon } from '@ds';
import { GroupTitle, Spec, SubSection } from './Spec';

/* -------------------------------- Principles ------------------------------ */

const principles = [
  { code: 'P-01', title: 'Signal is scarce', body: 'Orange means act. It never exceeds 5% of a screen. If everything is urgent, nothing is.' },
  { code: 'P-02', title: 'Every pixel reports', body: 'Decoration must carry data. A tick is a scale, a bracket is a boundary, a serial is provenance.' },
  { code: 'P-03', title: 'Hairline over fill', body: 'Structure comes from 1px rules, not tinted boxes. Fill is reserved for state.' },
  { code: 'P-04', title: 'Mono for machines, grotesk for humans', body: 'Telemetry, coordinates and labels are set in mono. Sentences and decisions are set in grotesk.' },
  { code: 'P-05', title: 'Calm until critical', body: 'The resting state is quiet graphite. Color, motion and sound escalate with severity, never before.' },
  { code: 'P-06', title: 'Confidence is visible', body: 'Every AI claim ships with a source and a confidence value. No unqualified assertions reach a commander.' },
];

export function Principles() {
  return (
    <SubSection id="system-principles" index="05.1" kicker="Principles" title="Six rules the interface never breaks." lede="Written for the people who build FCC. Each rule resolves a real failure mode of operational software under stress.">
      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
        {principles.map((p, i) => (
          <article key={p.code} className="group relative flex min-h-[220px] flex-col bg-ink-950 p-6 transition-colors duration-base ease-servo hover:bg-ink-900">
            <div className="flex items-center justify-between">
              <span className="font-mono text-micro text-signal">{p.code}</span>
              <Serial>RULE {String(i + 1).padStart(2, '0')}/06</Serial>
            </div>
            <span aria-hidden className="mt-8 font-mono text-3xl font-light text-ink-600 fcc-num transition-colors duration-base ease-servo group-hover:text-ink-500">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h4 className="mt-auto pt-6 text-lg font-medium text-bone">{p.title}</h4>
            <p className="mt-2 text-sm text-bone-dim">{p.body}</p>
          </article>
        ))}
      </div>
    </SubSection>
  );
}

/* ---------------------------------- Color --------------------------------- */

interface Swatch {
  name: string;
  hex: string;
  cssVar: string;
  tw: string;
  role: string;
}

const inkRoles: Record<string, string> = {
  950: 'App background', 900: 'Panel', 850: 'Raised panel', 800: 'Control fill', 700: 'Hover fill', 600: 'Strong rule',
  500: 'Disabled text', 400: 'Tertiary text', 300: 'Secondary text', 200: 'Inverse surface', 100: 'Inverse highlight',
};
const inkSteps = [950, 900, 850, 800, 700, 600, 500, 400, 300, 200, 100] as const;

const groups: { code: string; title: string; items: Swatch[] }[] = [
  {
    code: 'C.1',
    title: 'Surfaces / void + ink',
    items: [
      { name: 'void', hex: color.void, cssVar: '--void', tw: 'bg-void', role: 'Page backdrop, deepest well' },
      ...inkSteps.map((s) => ({ name: `ink-${s}`, hex: color.ink[s], cssVar: `--ink-${s}`, tw: `bg-ink-${s}`, role: inkRoles[s] ?? '' })),
    ],
  },
  {
    code: 'C.2',
    title: 'Foreground / bone',
    items: [
      { name: 'bone', hex: color.bone.DEFAULT, cssVar: '--bone', tw: 'text-bone', role: 'Primary text' },
      { name: 'bone-dim', hex: color.bone.dim, cssVar: '--bone-dim', tw: 'text-bone-dim', role: 'Body secondary' },
      { name: 'bone-mute', hex: color.bone.mute, cssVar: '--bone-mute', tw: 'text-bone-mute', role: 'Captions, micro labels' },
    ],
  },
  {
    code: 'C.3',
    title: 'Hairlines / line',
    items: [
      { name: 'line-faint', hex: color.line.faint, cssVar: '--line-faint', tw: 'border-line-faint', role: 'Row dividers, grids' },
      { name: 'line', hex: color.line.DEFAULT, cssVar: '--line', tw: 'border-line', role: 'Default 1px rule' },
      { name: 'line-strong', hex: color.line.strong, cssVar: '--line-strong', tw: 'border-line-strong', role: 'Controls, emphasis' },
    ],
  },
  {
    code: 'C.4',
    title: 'Signal / the one accent',
    items: [
      { name: 'signal', hex: color.signal.DEFAULT, cssVar: '--signal', tw: 'bg-signal', role: 'Primary action, focus, selection' },
      { name: 'signal-hot', hex: color.signal.hot, cssVar: '--signal-hot', tw: 'bg-signal-hot', role: 'Hover, glow core' },
      { name: 'signal-deep', hex: color.signal.deep, cssVar: '--signal-deep', tw: 'bg-signal-deep', role: 'Pressed' },
      { name: 'signal-wash', hex: color.signal.wash, cssVar: '--signal-wash', tw: 'bg-signal-wash', role: 'Tinted background' },
    ],
  },
  {
    code: 'C.5',
    title: 'Semantic status',
    items: [
      { name: 'ember', hex: color.ember, cssVar: '--ember', tw: 'text-ember', role: 'Danger, active fire front' },
      { name: 'amber', hex: color.amber, cssVar: '--amber', tw: 'text-amber', role: 'Caution, forecast' },
      { name: 'phosphor', hex: color.phosphor, cssVar: '--phosphor', tw: 'text-phosphor', role: 'Nominal, contained, online' },
      { name: 'ice', hex: color.ice, cssVar: '--ice', tw: 'text-ice', role: 'Drones, AI, telemetry, water' },
      { name: 'violet', hex: color.violet, cssVar: '--violet', tw: 'text-violet', role: 'Human detections, POI' },
    ],
  },
];

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function SwatchTile({ s }: { s: Swatch }) {
  return (
    <div className="flex min-w-0 flex-col border border-line bg-ink-900">
      <div className="relative h-20 border-b border-line" style={{ background: s.hex }}>
        <span className={cn('absolute left-2 top-2 font-mono text-micro uppercase', isLight(s.hex) ? 'text-ink-950/70' : 'text-bone/60')}>{s.hex}</span>
      </div>
      <dl className="flex flex-col gap-1 p-2.5">
        <dt className="font-mono text-tiny text-bone">{s.name}</dt>
        <dd className="font-mono text-micro text-bone-mute">var({s.cssVar})</dd>
        <dd className="font-mono text-micro text-bone-mute">.{s.tw}</dd>
        <dd className="mt-1 text-xs text-bone-dim">{s.role}</dd>
      </dl>
    </div>
  );
}

export function ColorSpec() {
  const ramp = [{ k: 'void', hex: color.void }, ...inkSteps.map((s) => ({ k: String(s), hex: color.ink[s] }))];
  return (
    <SubSection
      id="system-color"
      index="05.2"
      kicker="Color"
      title="Graphite, bone, and one fire-orange signal."
      lede="A cool-neutral ink ramp carries structure. Warm bone carries language. Color is assigned by role, never by taste."
      aside={
        <div className="mt-2 border border-line p-3">
          <span className="fcc-micro">Source of truth</span>
          <p className="mt-1 font-mono text-micro text-bone-dim">tokens/tokens.css</p>
          <p className="font-mono text-micro text-bone-dim">tokens/index.ts (mirror)</p>
        </div>
      }
    >
      <GroupTitle code="C.0">Ink ramp / continuous</GroupTitle>
      <div className="mb-14">
        <div className="flex h-24 border border-line">
          {ramp.map((r) => (
            <div key={r.k} className="relative flex-1" style={{ background: r.hex }}>
              <span className={cn('absolute bottom-2 left-2 font-mono text-micro', isLight(r.hex) ? 'text-ink-950/70' : 'text-bone/50')}>{r.k}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex">
          {ramp.map((r) => (
            <span key={r.k} className="flex-1 truncate font-mono text-micro text-bone-mute">
              {r.hex}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-12">
        {groups.map((g) => (
          <div key={g.code}>
            <GroupTitle code={g.code}>{g.title}</GroupTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {g.items.map((s) => (
                <SwatchTile key={s.name} s={s} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <GroupTitle code="C.6">Semantic status row</GroupTitle>
          <div className="flex flex-col border border-line">
            {[
              { c: color.ember, n: 'Danger', d: 'Fire front, life safety, failure' },
              { c: color.amber, n: 'Caution', d: 'Forecast spread, degraded link' },
              { c: color.phosphor, n: 'Nominal', d: 'Contained line, unit online' },
              { c: color.ice, n: 'Telemetry', d: 'Drone, AI analysis, water' },
              { c: color.violet, n: 'Detection', d: 'Human, structure, point of interest' },
            ].map((r) => (
              <div key={r.n} className="flex items-center gap-3 border-b border-line-faint px-3 py-2.5 last:border-b-0">
                <span className="h-3 w-3 shrink-0" style={{ background: r.c }} />
                <span className="w-20 font-mono text-micro uppercase text-bone">{r.n}</span>
                <span className="text-xs text-bone-dim">{r.d}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <GroupTitle code="C.7">Signal budget / under 5% of pixels</GroupTitle>
          <div className="relative border border-line bg-ink-900 p-4">
            <Brackets size={6} />
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(20, minmax(0, 1fr))' }}>
              {Array.from({ length: 100 }).map((_, i) => (
                <span key={i} className={cn('aspect-square', i === 37 || i === 38 || i === 57 || i === 58 ? 'bg-signal' : i % 7 === 0 ? 'bg-ink-700' : 'bg-ink-800')} />
              ))}
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-4">
              <p className="max-w-sm text-xs text-bone-dim">
                Each cell is 1% of a screen. Four cells of signal is the ceiling. Spend it on the one action a commander must take next.
              </p>
              <span className="font-mono text-2xl font-light text-signal fcc-num">04%</span>
            </div>
          </div>
        </div>
      </div>
    </SubSection>
  );
}

/* -------------------------------- Typography ------------------------------ */

const typeClass: Record<string, string> = {
  '6xl': 'text-6xl', '5xl': 'text-5xl', '4xl': 'text-4xl', '3xl': 'text-3xl', '2xl': 'text-2xl', xl: 'text-xl', lg: 'text-lg',
  base: 'text-base', sm: 'text-sm', xs: 'text-xs', tiny: 'text-tiny', nano: 'text-nano', micro: 'text-micro',
};
const monoTokens = new Set(['3xl', 'tiny', 'nano', 'micro']);

export function TypeSpec() {
  return (
    <SubSection
      id="system-type"
      index="05.3"
      kicker="Typography"
      title="Two families. Thirteen sizes. No exceptions."
      lede="Inter Tight sets language for humans. JetBrains Mono sets anything a machine produced: numbers, coordinates, labels, serials."
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="relative flex min-h-[300px] flex-col justify-between border border-line bg-ink-900 p-6">
          <Brackets size={6} />
          <div className="flex items-center justify-between">
            <Label index="T.1">Grotesk / human</Label>
            <Serial>Inter Tight Variable</Serial>
          </div>
          <div className="py-6 text-6xl font-medium leading-none text-bone">Aa</div>
          <div>
            <p className="text-xl text-bone">Hold the line at Ridge Road. Evacuate sector 4.</p>
            <p className="mt-2 font-mono text-micro uppercase text-bone-mute">Weights 300 / 400 / 500 / Tracking -0.01 to -0.045em at display sizes</p>
          </div>
        </div>
        <div className="relative flex min-h-[300px] flex-col justify-between border border-line bg-ink-900 p-6">
          <Brackets size={6} />
          <div className="flex items-center justify-between">
            <Label index="T.2">Mono / machine</Label>
            <Serial>JetBrains Mono Variable</Serial>
          </div>
          <div className="py-6 font-mono text-6xl font-light leading-none text-bone fcc-num">0.82</div>
          <div>
            <p className="font-mono text-base text-bone fcc-num">
              {fmtLat(34.1873)} {fmtLon(-118.2241)} / 274° / 18KT
            </p>
            <p className="mt-2 font-mono text-micro uppercase text-bone-mute">Tabular numerals / slashed zero / uppercase + tracked below 12px</p>
          </div>
        </div>
      </div>

      <GroupTitle code="T.3" className="mt-14">
        Type scale
      </GroupTitle>
      <div className="border border-line">
        {type.map((t) => (
          <div key={t.token} className="grid grid-cols-[72px_56px_1fr] items-center gap-4 border-b border-line-faint px-3 py-2 last:border-b-0 md:grid-cols-[88px_64px_1fr_240px]">
            <span className="font-mono text-tiny text-bone">{t.token}</span>
            <span className="font-mono text-micro text-bone-mute fcc-num">{t.px}px</span>
            <span
              className={cn(
                'min-w-0 overflow-hidden whitespace-nowrap text-bone',
                typeClass[t.token],
                monoTokens.has(t.token) ? 'font-mono fcc-num' : 'font-medium',
                (t.token === 'tiny' || t.token === 'nano' || t.token === 'micro') && 'uppercase',
              )}
            >
              {t.token === '3xl' ? '1,284 HA' : t.px >= 80 ? 'Fireline' : t.px <= 11 ? 'Sector 04 / Wind 274° / 18 kt' : 'Forecast: spread northeast in 40 min'}
            </span>
            <span className="hidden text-xs text-bone-dim md:block">{t.use}</span>
          </div>
        ))}
      </div>

      <GroupTitle code="T.4" className="mt-14">
        Micrographic labels
      </GroupTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Spec code='<Label index="03">' tag="nano">
          <Label index="03">Fire behavior</Label>
        </Spec>
        <Spec code="<Serial>" tag="micro">
          <Serial>FCC-01 / REV B</Serial>
        </Spec>
        <Spec code=".fcc-micro" tag="micro">
          <span className="fcc-micro">Sensor array / 12 of 14 online</span>
        </Spec>
        <Spec code="<Datum>" tag="tiny">
          <Datum label="Position" value={fmtLat(34.1873, 3)} />
          <Datum label="ROS" value="0.42" unit="m/s" tone="text-amber" />
        </Spec>
      </div>
    </SubSection>
  );
}

/* ----------------------------- Spacing & Grid ----------------------------- */

const radiusUse: Record<string, string> = {
  none: 'Default. Panels, buttons, inputs.', hair: 'Optical softening on small fills.', xs: 'Chips at very small sizes.',
  sm: 'Rare.', DEFAULT: 'Avoid.', md: 'Avoid.', lg: 'Avoid.', pill: 'Status dots and pulses only.',
};

export function SpaceSpec() {
  const scale = Object.entries(space).sort((a, b) => a[1] - b[1]).filter(([, v]) => v > 0);
  return (
    <SubSection
      id="system-space"
      index="05.4"
      kicker="Spacing & Grid"
      title="A 4px grid at micro scale. A 12-column rail at macro scale."
      lede="Dense where data lives, generous where decisions live. All spacing resolves to multiples of four."
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="relative border border-line bg-ink-900 p-4">
          <Brackets size={6} />
          <GroupTitle code="S.1">4px base grid</GroupTitle>
          <div
            className="relative h-56 border border-line"
            style={{
              backgroundImage:
                'linear-gradient(rgb(var(--line-faint)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line-faint)) 1px, transparent 1px), linear-gradient(rgb(var(--line)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line)) 1px, transparent 1px)',
              backgroundSize: '4px 4px, 4px 4px, 16px 16px, 16px 16px',
            }}
          >
            <div className="absolute left-4 top-4 flex h-9 w-[152px] items-center gap-2 border border-signal/60 bg-ink-900/90 px-3">
              <span className="h-1 w-1 bg-signal" />
              <span className="font-mono text-nano uppercase text-bone">Dispatch</span>
            </div>
            <span className="absolute left-4 top-[60px] font-mono text-micro text-signal">h 36 = 9u</span>
            <div className="absolute bottom-4 left-4 right-4 h-16 border border-line-strong bg-ink-900/90 p-3">
              <span className="fcc-micro">Panel / padding 12 = 3u</span>
            </div>
          </div>
        </div>

        <div className="relative border border-line bg-ink-900 p-4">
          <Brackets size={6} />
          <GroupTitle code="S.2">Spacing scale</GroupTitle>
          <div className="flex flex-col gap-1.5">
            {scale.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[40px_40px_1fr] items-center gap-3">
                <span className="font-mono text-micro text-bone">{k}</span>
                <span className="font-mono text-micro text-bone-mute fcc-num">{v}px</span>
                <span className="flex h-2 items-center">
                  <span className="h-2 bg-ink-600" style={{ width: v * 2 }} />
                  <span className="h-2 w-px bg-signal" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 border border-line bg-ink-900 p-4">
        <GroupTitle code="S.3">12-column rail / 1440 max / 24 gutter</GroupTitle>
        <div className="relative">
          <div className="grid h-40 grid-cols-12 gap-2 md:gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="relative border-x border-line-faint fcc-hatch">
                <span className="absolute left-1 top-1 font-mono text-micro text-bone-mute">{String(i + 1).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 grid grid-cols-12 gap-2 md:gap-6">
            <div className="col-span-3 flex h-8 items-center border border-line-strong bg-ink-850 px-2 font-mono text-micro uppercase text-bone-dim">Rail 3</div>
            <div className="col-span-9 flex h-8 items-center border border-signal/50 bg-ink-850 px-2 font-mono text-micro uppercase text-signal">Content 9</div>
          </div>
        </div>
        <div className="mt-2 flex justify-between font-mono text-micro text-bone-mute">
          <span>0</span>
          <span>px-6 / lg:px-10</span>
          <span>1440</span>
        </div>
      </div>

      <GroupTitle code="S.4" className="mt-14">
        Radii
      </GroupTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {Object.entries(radius).map(([k, v]) => {
          const allowed = k === 'none' || k === 'hair' || k === 'xs' || k === 'pill';
          return (
            <div key={k} className="flex flex-col border border-line bg-ink-900">
              <div className="flex h-24 items-center justify-center border-b border-line">
                <span
                  className={cn('h-12 w-12 border', allowed ? 'border-bone-dim bg-ink-800' : 'border-ink-500 border-dashed')}
                  style={{ borderRadius: k === 'pill' ? 999 : v }}
                />
              </div>
              <div className="p-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-tiny text-bone">{k}</span>
                  <span className={cn('font-mono text-micro', allowed ? 'text-phosphor' : 'text-ink-400')}>{k === 'pill' ? '999' : v}px</span>
                </div>
                <p className="mt-1 text-xs text-bone-dim">{radiusUse[k]}</p>
              </div>
            </div>
          );
        })}
      </div>
    </SubSection>
  );
}
