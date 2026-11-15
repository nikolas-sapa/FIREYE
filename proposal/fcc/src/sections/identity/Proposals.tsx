import type { ReactNode } from 'react';
import { FireyeMark, cn } from '@ds';

/**
 * Alternative FIREYE mark concepts for review. Proposal-only drawings on the same 32-unit grid as
 * the current mark; they are not design-system components until one is chosen.
 */
interface Concept {
  id: string;
  name: string;
  idea: string;
  avatar: string;
  draw: (sw: number) => ReactNode;
}

const CONCEPTS: Concept[] = [
  {
    id: 'A',
    name: 'Aperture',
    idea: 'Four reticle corners frame a diamond pupil: the target-lock brackets the console already uses when it dives into a drone feed.',
    avatar: 'Corners breathe while monitoring and close in on the pupil to lock when a decision is needed.',
    draw: (sw) => (
      <>
        <path strokeWidth={sw} d="M3 10V3h7M22 3h7v7M29 22v7h-7M10 29H3v-7" />
        <path className="fill-signal" stroke="none" d="M16 11.5 20.5 16 16 20.5 11.5 16Z" />
      </>
    ),
  },
  {
    id: 'B',
    name: 'Lens',
    idea: 'A scope ring open at north with an index tick, an inner iris and an ember core. Reads as optics, compass and sensor at once.',
    avatar: 'The outer ring rotates while it works; the index tick points to where it is looking.',
    draw: (sw) => (
      <>
        <path strokeWidth={sw} d="M13.5 3.75A12.5 12.5 0 1 0 18.5 3.75" />
        <path strokeWidth={sw} d="M16 1v5" />
        <circle strokeWidth={sw} cx={16} cy={16} r={6.5} />
        <circle className="fill-signal" stroke="none" cx={16} cy={16} r={2.4} />
      </>
    ),
  },
  {
    id: 'C',
    name: 'Ember',
    idea: 'A single flame outline that is also a vertical eye, with the pupil sitting low like a coal. The most direct fire reference of the set.',
    avatar: 'The pupil rises and settles like breathing; the outline flickers once on alert.',
    draw: (sw) => (
      <>
        <path strokeWidth={sw} strokeLinejoin="miter" d="M16 2.5C21.5 9 25 13.5 25 19.5a9 9 0 0 1-18 0C7 13.5 10.5 9 16 2.5Z" />
        <path className="fill-signal" stroke="none" d="M16 16.25 19.5 19.75 16 23.25 12.5 19.75Z" />
      </>
    ),
  },
  {
    id: 'D',
    name: 'Lookout',
    idea: 'A ridge line under a single signal point: the fire lookout spotting first smoke. Calm, terrain-first and close to how the globe looks.',
    avatar: 'The point drifts along the ridge while scanning and pulses above the peak when it needs you.',
    draw: (sw) => (
      <>
        <path strokeWidth={sw} strokeLinejoin="miter" d="M2 25 10 15l5 5 6-9 9 14" />
        <path strokeWidth={sw} d="M2 29h28" />
        <path className="fill-signal" stroke="none" d="M21 2.5 23.5 5 21 7.5 18.5 5Z" />
      </>
    ),
  },
  {
    id: 'E',
    name: 'Mesh',
    idea: 'A 3×3 grid of sensor cells with one cell lit. Stands for the drones, ridge cameras and IoT nodes the Orchestrator fuses into one picture.',
    avatar: 'Cells light in sequence while thinking; the lit cell moves to wherever the evidence is.',
    draw: (sw) => {
      const cells = [3.5, 13, 22.5];
      return (
        <>
          {cells.flatMap((y) => cells.map((x) => (
            x === 13 && y === 13
              ? <rect key={`${x}-${y}`} className="fill-signal" stroke="none" x={x} y={y} width={6} height={6} />
              : <rect key={`${x}-${y}`} strokeWidth={sw} x={x} y={y} width={6} height={6} />
          )))}
        </>
      );
    },
  },
];

function ConceptMark({ c, size, weight }: { c: Concept; size: number; weight?: number }) {
  const px = weight ?? (size >= 64 ? 1.25 : 1.5);
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={`Concept ${c.id}, ${c.name}`}
      className="shrink-0 overflow-visible" fill="none" stroke="currentColor" strokeLinecap="butt">
      {c.draw((px * 32) / size)}
    </svg>
  );
}

export function LogoProposals() {
  return (
    <div className="mt-16">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="fcc-label text-bone">06.6 · Alternative marks for review</h3>
        <span className="font-mono text-micro uppercase text-bone-mute">Same grid, hairline weight and single signal accent as the current eye</span>
      </div>
      <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-5">
        {CONCEPTS.map((c) => (
          <article key={c.id} className="flex flex-col bg-ink-900">
            <div className="relative flex h-56 items-center justify-center bg-void text-bone">
              <span className="absolute left-3 top-3 font-mono text-micro text-signal fcc-num">{c.id}</span>
              <ConceptMark c={c} size={112} />
            </div>
            <div className="flex items-end gap-5 border-y border-line px-4 py-4 text-bone">
              <ConceptMark c={c} size={40} />
              <ConceptMark c={c} size={24} />
              <ConceptMark c={c} size={16} />
              <span className="ml-auto flex h-11 w-11 items-center justify-center border border-line-strong bg-ink-950">
                <ConceptMark c={c} size={26} />
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <span className="font-mono text-tiny uppercase tracking-[0.2em] text-bone">{c.name}</span>
              <p className="text-xs leading-5 text-bone-dim">{c.idea}</p>
              <p className="mt-auto border-l border-line pl-3 text-xs leading-5 text-bone-mute">
                <span className="font-mono text-micro uppercase text-bone-dim">As avatar · </span>{c.avatar}
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-px grid grid-cols-1 gap-px border border-t-0 border-line bg-line md:grid-cols-[12rem_1fr]">
        <span className="flex items-center bg-ink-900 px-4 py-3 fcc-micro">In the top bar</span>
        <div className="flex flex-wrap items-center gap-px bg-line">
          {[{ id: 'Current', node: <FireyeMark size={22} /> }, ...CONCEPTS.map((c) => ({ id: c.id, node: <ConceptMark c={c} size={22} /> }))].map((m) => (
            <span key={m.id} className={cn('flex h-11 flex-1 items-center gap-2.5 bg-ink-950 px-3 text-bone', m.id === 'Current' && 'bg-ink-900')}>
              {m.node}
              <span className="font-mono text-tiny font-normal uppercase tracking-[0.34em]">FIREYE</span>
              <span className="ml-auto font-mono text-micro uppercase text-bone-mute">{m.id}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
