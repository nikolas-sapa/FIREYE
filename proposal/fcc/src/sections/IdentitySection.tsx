import { useState } from 'react';
import { LogoProposals } from './identity/Proposals';
import { FIREYE_GEOMETRY, FireyeMark, FireyeWordmark, GridBg, OrchestratorAvatar, RegMark, SectionHeader, Serial, cn, type OrchestratorState } from '@ds';

const STATES: { id: OrchestratorState; label: string; when: string }[] = [
  { id: 'idle', label: 'Idle', when: 'Monitoring. No decision waiting. A slow blink every few seconds.' },
  { id: 'listening', label: 'Listening', when: 'Chat open. The lids narrow and hold while it waits for you.' },
  { id: 'thinking', label: 'Thinking', when: 'Analysis or drafting in progress. The pupil scans side to side.' },
  { id: 'speaking', label: 'Speaking', when: 'A reply or brief is arriving. The pupil pulses with it.' },
  { id: 'alert', label: 'Alert', when: 'Z0 only: a human decision is required. The only state with a ring.' },
];

const SIZES = [128, 64, 32, 24, 16] as const;

const RULES: { ok: boolean; text: string }[] = [
  { ok: true, text: 'Hairline lids at every size: 1 to 1.5 rendered pixels, never scaled with the mark.' },
  { ok: true, text: 'Pupil in signal orange only. It counts as the view’s single accent.' },
  { ok: true, text: 'Clear space of one pupil width (8 units) on every side. Minimum size 12 px.' },
  { ok: false, text: 'No fills, gradients, glows or outlines around the lids.' },
  { ok: false, text: 'Never rotate the pupil at rest or recolour it by status.' },
  { ok: false, text: 'Do not use the alert state for anything below a Z0 interrupt.' },
];

/** Construction overlay on the mark's 32-unit grid. */
function Construction() {
  const lines = Array.from({ length: 9 }, (_, i) => i * 4);
  return (
    <svg viewBox={FIREYE_GEOMETRY.viewBox} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden fill="none">
      {lines.map((v) => (
        <g key={v} className="stroke-line">
          <path d={`M${v} 0V32`} vectorEffect="non-scaling-stroke" strokeWidth={1} />
          <path d={`M0 ${v}H32`} vectorEffect="non-scaling-stroke" strokeWidth={1} />
        </g>
      ))}
      <g className="stroke-ice/70" strokeDasharray="2 3">
        <path d="M0 16H32M16 0V32" vectorEffect="non-scaling-stroke" strokeWidth={1} />
        <path d="M2.5 7.5H29.5M2.5 24.5H29.5" vectorEffect="non-scaling-stroke" strokeWidth={1} />
        <path d="M12 12h8v8h-8Z" vectorEffect="non-scaling-stroke" strokeWidth={1} />
      </g>
      {[[2.5, 16], [29.5, 16], [16, 7.5], [16, 24.5]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={0.55} className="fill-ice" />
      ))}
    </svg>
  );
}

export default function IdentitySection() {
  const [grid, setGrid] = useState(true);
  return (
    <section id="identity" aria-label="FIREYE identity" className="relative scroll-mt-16 overflow-hidden border-t border-line bg-ink-950">
      <GridBg variant="lines" className="opacity-40" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-24 pt-24 lg:px-10 lg:pt-30">
        <RegMark className="absolute left-2 top-6 hidden lg:block" />
        <RegMark className="absolute right-2 top-6 hidden lg:block" />
        <SectionHeader
          index="06"
          eyebrow="Identity"
          title={<>FIREYE <span className="text-ink-400">/</span> one mark for the console and its Orchestrator</>}
          lede="Two hairline lids and a diamond pupil. The same drawing is the product logo, the app icon and the Orchestrator's avatar, so the thing that watches the incident and the thing that asks you to decide are visibly the same system."
          meta={<Serial>FIREYE-ID / REV 2 / 2026</Serial>}
        />

        <div className="mt-16 grid grid-cols-1 gap-px border border-line bg-line lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="relative flex min-h-[420px] items-center justify-center bg-void p-10">
            <span className="absolute left-4 top-4 fcc-micro">06.1 · Mark</span>
            <button type="button" aria-pressed={grid} onClick={() => setGrid((g) => !g)}
              className={cn('absolute right-4 top-4 border px-2 py-1 font-mono text-micro uppercase tracking-[0.14em] transition-colors duration-quick ease-servo',
                grid ? 'border-line-strong bg-ink-800 text-bone' : 'border-line text-bone-mute hover:text-bone-dim')}>
              Construction
            </button>
            <div className="relative h-[280px] w-[280px] text-bone">
              {grid && <Construction />}
              <FireyeMark size={280} weight={1.25} draw title="FIREYE mark" />
            </div>
            <span className="absolute bottom-4 left-4 font-mono text-micro uppercase text-bone-mute">32-unit grid · canthi 2.5 / 29.5 · lid apex 7.5 / 24.5 · pupil 8 u</span>
          </div>
          <div className="flex flex-col gap-8 bg-ink-900 p-8">
            {[
              { k: 'Lids', v: 'The sensor aperture. Two open hairlines, no fill. Everything FIREYE sees, from drones, ridge cameras, IoT and radio, comes through the same opening.' },
              { k: 'Pupil', v: 'A diamond in signal orange: the ember, the map’s target marker and the one accent on screen. It is the only filled shape.' },
              { k: 'Avatar', v: 'The mark is alive when it stands for the Orchestrator. It blinks while monitoring, narrows to listen, scans while it works, pulses when it replies and rings only when you must decide.' },
              { k: 'Voice', v: 'Machine-set mono, light weight, wide tracking. Calm, exact and never loud. The mark never shouts; the ring is the only escalation.' },
            ].map((r, i) => (
              <div key={r.k} className="grid grid-cols-[3rem_1fr] gap-4">
                <span className="font-mono text-micro text-signal fcc-num">0{i + 1}</span>
                <div>
                  <h3 className="fcc-label text-bone">{r.k}</h3>
                  <p className="mt-2 max-w-md text-sm text-bone-dim">{r.v}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <h3 className="fcc-label mb-4 text-bone">06.2 · Orchestrator avatar states</h3>
          <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-5">
            {STATES.map((s) => (
              <div key={s.id} className="flex flex-col gap-5 bg-ink-900 p-5">
                <OrchestratorAvatar size={72} framed state={s.id} />
                <div>
                  <span className="font-mono text-tiny uppercase tracking-[0.2em] text-bone">{s.label}</span>
                  <p className="mt-1.5 text-xs leading-5 text-bone-dim">{s.when}</p>
                </div>
                <code className="mt-auto font-mono text-micro text-bone-mute">state=&quot;{s.id}&quot;</code>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-micro uppercase text-bone-mute">Live specimens. Reduced motion shows every state at rest.</p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-px border border-line bg-line lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="bg-ink-900 p-6">
            <h3 className="fcc-label mb-6 text-bone">06.3 · Scale</h3>
            <div className="flex flex-wrap items-end gap-10 text-bone">
              {SIZES.map((s) => (
                <div key={s} className="flex flex-col items-center gap-3">
                  <FireyeMark size={s} title={`FIREYE ${s} px`} />
                  <span className="font-mono text-micro text-bone-mute fcc-num">{s}</span>
                </div>
              ))}
              <div className="flex flex-col items-center gap-3">
                <img src="/icons/fireye-192.png" alt="FIREYE app icon" width={64} height={64} className="border border-line" />
                <span className="font-mono text-micro uppercase text-bone-mute">App icon</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-6 bg-ink-900 p-6">
            <h3 className="fcc-label text-bone">06.4 · Lockups</h3>
            <FireyeWordmark size={28} />
            <FireyeWordmark size={22} sub="Incident console" />
            <div className="flex h-11 items-center gap-3 border border-line bg-ink-950 px-3">
              <FireyeWordmark size={22} />
              <span className="ml-auto inline-flex h-7 items-center gap-2 border border-line-strong bg-ink-900 px-2.5 font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">
                <OrchestratorAvatar size={18} state="alert" className="text-bone" />ORCH <span className="text-signal">1 decision</span>
              </span>
            </div>
            <span className="fcc-micro">Console top bar: the logo at left, the live avatar at the orchestrator status.</span>
          </div>
        </div>

        <div className="mt-16">
          <h3 className="fcc-label mb-4 text-bone">06.5 · Rules</h3>
          <ul className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
            {RULES.map((r) => (
              <li key={r.text} className="flex gap-3 bg-ink-900 p-4 text-sm text-bone-dim">
                <span className={cn('mt-0.5 font-mono text-micro uppercase', r.ok ? 'text-phosphor' : 'text-ember')}>{r.ok ? 'Do' : 'Don’t'}</span>
                {r.text}
              </li>
            ))}
          </ul>
        </div>

        <LogoProposals />

        <div className="mt-16 flex items-center justify-between border-t border-line pt-4 font-mono text-micro uppercase text-bone-mute">
          <span>End of section 06</span>
          <span>@ds / FireyeMark · FireyeWordmark · OrchestratorAvatar</span>
        </div>
      </div>
    </section>
  );
}
