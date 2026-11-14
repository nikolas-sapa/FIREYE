import { GridBg, RegMark, SectionHeader, Serial, iconNames } from '@ds';
import { ColorSpec, Principles, SpaceSpec, TypeSpec } from './ds/Foundations';
import { IconSpec, MicrographicsSpec } from './ds/Micrographics';
import { ComponentsSpec } from './ds/Components';
import { MotionSpec } from './ds/Motion';
import { DoDontSpec } from './ds/DoDont';

const toc = [
  { id: 'system-principles', n: '04.1', label: 'Principles' },
  { id: 'system-color', n: '04.2', label: 'Color' },
  { id: 'system-type', n: '04.3', label: 'Typography' },
  { id: 'system-space', n: '04.4', label: 'Spacing & Grid' },
  { id: 'system-micro', n: '04.5', label: 'Micrographics' },
  { id: 'system-icons', n: '04.6', label: 'Iconography' },
  { id: 'system-components', n: '04.7', label: 'Components' },
  { id: 'system-motion', n: '04.8', label: 'Motion' },
  { id: 'system-dodont', n: '04.9', label: "Do / Don't" },
];

export default function DesignSystemSection() {
  return (
    <section id="system" aria-label="Design system" className="relative scroll-mt-16 overflow-hidden border-t border-line bg-ink-950">
      <GridBg variant="lines" className="opacity-50" />
      <div className="relative mx-auto max-w-[1440px] px-6 pb-24 pt-24 lg:px-10 lg:pt-30">
        <RegMark className="absolute left-2 top-6 hidden lg:block" />
        <RegMark className="absolute right-2 top-6 hidden lg:block" />

        <SectionHeader
          index="04"
          eyebrow="Design System"
          title={
            <>
              FCC/DS <span className="text-ink-400">/</span> Operational Interface Language
            </>
          }
          lede="One visual language for drones, crews and commanders. Built for glanceability under smoke, glare and stress: hairline structure, machine-set data, and a single accent reserved for the next action."
          meta={<Serial>FCC-DS / REV A / 2026</Serial>}
        />

        <nav aria-label="Design system contents" className="mt-16 grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-3">
            <span className="fcc-micro">Contents</span>
            <div className="mt-3 flex flex-col gap-1 font-mono text-micro uppercase text-bone-mute">
              <span>9 chapters / 28 components</span>
              <span>{iconNames.length} icons / 3 easings</span>
            </div>
          </div>
          <ol className="col-span-12 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:col-span-9">
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
          <MotionSpec />
          <DoDontSpec />
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4 font-mono text-micro uppercase text-bone-mute">
          <span>End of section 04</span>
          <span>FCC/DS / tokens.css + tokens/index.ts</span>
        </div>
      </div>
    </section>
  );
}
