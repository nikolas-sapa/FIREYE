import { GridBg, RegMark, SectionHeader, Serial, iconNames } from '@ds';
import { ColorSpec, Principles, SpaceSpec, TypeSpec } from './ds/Foundations';
import { IconSpec, MicrographicsSpec } from './ds/Micrographics';
import { ComponentsSpec } from './ds/Components';
import { OrchestratorSpec } from './ds/Orchestrator';
import { ConsoleSpec } from './ds/Console';
import { MotionSpec } from './ds/Motion';
import { DoDontSpec } from './ds/DoDont';

const toc = [
  { id: 'system-principles', n: '05.1', label: 'Principles' },
  { id: 'system-color', n: '05.2', label: 'Color' },
  { id: 'system-type', n: '05.3', label: 'Typography' },
  { id: 'system-space', n: '05.4', label: 'Spacing & Grid' },
  { id: 'system-micro', n: '05.5', label: 'Micrographics' },
  { id: 'system-icons', n: '05.6', label: 'Iconography' },
  { id: 'system-components', n: '05.7', label: 'Components' },
  { id: 'system-orchestrator', n: '05.8', label: 'Orchestrator' },
  { id: 'system-console', n: '05.9', label: 'Console' },
  { id: 'system-motion', n: '05.10', label: 'Motion' },
  { id: 'system-dodont', n: '05.11', label: "Do / Don't" },
];

export default function DesignSystemSection() {
  return (
    <section id="system" aria-label="Design system" className="relative scroll-mt-16 overflow-hidden border-t border-line bg-ink-950">
      <GridBg variant="lines" className="opacity-50" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-24 pt-24 lg:px-10 lg:pt-30">
        <RegMark className="absolute left-2 top-6 hidden lg:block" />
        <RegMark className="absolute right-2 top-6 hidden lg:block" />

        <SectionHeader
          index="05"
          eyebrow="Design System"
          title={
            <>
              FCC/DS <span className="text-ink-400">/</span> Operational Interface Language
            </>
          }
          lede="One visual language for drones, crews, commanders and the Orchestrator that works beside them. Built for glanceability under smoke, glare and stress: hairline structure, machine-set data, graded alerts, and a single accent reserved for the next action."
          meta={<Serial>FCC-DS / REV B / 2026</Serial>}
        />

        <nav aria-label="Design system contents" className="mt-16 grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-3">
            <span className="fcc-micro">Contents</span>
            <div className="mt-3 flex flex-col gap-1 font-mono text-micro uppercase text-bone-mute">
              <span>11 chapters / 50 components</span>
              <span>{iconNames.length} icons / 3 easings</span>
            </div>
          </div>
          <ol className="col-span-12 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:col-span-9 xl:grid-cols-5">
            {toc.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="group flex h-14 items-center justify-between gap-3 bg-ink-950 px-4 transition-colors duration-quick ease-servo hover:bg-ink-900 focus-visible:bg-ink-900"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-micro text-signal fcc-num">{t.n}</span>
                    <span className="font-mono text-nano uppercase tracking-[0.12em] text-bone-dim transition-colors duration-quick ease-servo group-hover:text-bone">
                      {t.label}
                    </span>
                  </span>
                  <span aria-hidden className="font-mono text-micro text-ink-500 transition-transform duration-quick ease-servo group-hover:translate-x-0.5 group-hover:text-signal">
                    &rarr;
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-20">
          <Principles />
          <ColorSpec />
          <TypeSpec />
          <SpaceSpec />
          <MicrographicsSpec />
          <IconSpec />
          <ComponentsSpec />
          <OrchestratorSpec />
          <ConsoleSpec />
          <MotionSpec />
          <DoDontSpec />
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4 font-mono text-micro uppercase text-bone-mute">
          <span>End of section 05</span>
          <span>FCC/DS / tokens.css + tokens/index.ts</span>
        </div>
      </div>
    </section>
  );
}
