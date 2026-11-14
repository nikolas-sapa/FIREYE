import { RegMark, Ruler, Serial } from '@ds';
import { FccMark, REV_A_HREF } from './Nav';

const META: { label: string; rows: [string, string][] }[] = [
  {
    label: 'Document',
    rows: [
      ['ID', 'FCC-PRP-0001'],
      ['Revision', 'B'],
      ['Date', '2026-11-14'],
      ['Sheets', '05'],
    ],
  },
  {
    label: 'Distribution',
    rows: [
      ['Classification', 'Unclassified'],
      ['Handling', 'For discussion'],
      ['Prepared for', 'Fire agencies & first responders'],
      ['Prepared by', 'FCC program office'],
    ],
  },
  {
    label: 'System',
    rows: [
      ['Core', 'Orchestrator + agent pools'],
      ['AO', 'Sierra-7 (synthetic)'],
      ['Grid', '240 × 150 · 40 M'],
      ['Data', 'Simulated'],
    ],
  },
  {
    label: 'Sections',
    rows: [
      ['01', 'Overview'],
      ['02', 'Architecture'],
      ['03', 'Stack'],
      ['04', 'Live ops'],
      ['05', 'Design system'],
    ],
  },
];

const ANCHORS: Record<string, string> = { '01': '#top', '02': '#architecture', '03': '#stack', '04': '#dashboard', '05': '#system' };

const REVISIONS: { rev: string; date: string; note: string; href?: string }[] = [
  { rev: 'A', date: '2026-11-14', note: 'Initial proposal: dashboard-first console, ARGUS core', href: REV_A_HREF },
  { rev: 'B', date: '2026-11-14', note: 'Orchestrator-first: graded alerts, calm default view, agent pools, drone grid' },
];

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-void">
      <div className="relative mx-auto max-w-[1440px] px-6 pb-10 pt-16 lg:px-10 lg:pt-24">
        <RegMark className="absolute left-2 top-2 hidden lg:block" />
        <RegMark className="absolute right-2 top-2 hidden lg:block" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FccMark size={20} />
            <span className="font-mono text-nano uppercase text-bone">Fire Command Center</span>
          </div>
          <div className="flex items-center gap-2">
            <Serial>FCC-01 / Rev B</Serial>
            <Serial>Sheet 05/05</Serial>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {META.map((col, ci) => (
            <div key={col.label} className="bg-void p-5">
              <div className="flex items-center justify-between">
                <span className="fcc-micro text-bone-dim">{col.label}</span>
                <span className="font-mono text-micro text-ink-500">F-{String(ci + 1).padStart(2, '0')}</span>
              </div>
              <dl className="mt-6 space-y-2">
                {col.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="fcc-micro shrink-0">{k}</dt>
                    <dd className="text-right font-mono text-tiny uppercase text-bone fcc-num">
                      {ANCHORS[k] && col.label === 'Sections' ? (
                        <a href={ANCHORS[k]} className="transition-colors duration-quick ease-servo hover:text-signal">
                          {v}
                        </a>
                      ) : (
                        v
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-px border border-t-0 border-line">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="fcc-micro text-bone-dim">Revision history</span>
            <span className="font-mono text-micro text-ink-500">F-05</span>
          </div>
          <ol>
            {REVISIONS.map((r) => (
              <li key={r.rev} className="grid grid-cols-[48px_104px_1fr_auto] items-center gap-4 border-b border-line-faint px-5 py-2.5 last:border-b-0">
                <span className={r.href ? 'font-mono text-tiny text-bone-mute' : 'font-mono text-tiny text-signal'}>REV {r.rev}</span>
                <span className="font-mono text-tiny text-bone-mute fcc-num">{r.date}</span>
                <span className="min-w-0 truncate text-sm text-bone-dim">{r.note}</span>
                {r.href ? (
                  <a href={r.href} className="font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-signal">
                    Open archive ↗
                  </a>
                ) : (
                  <span className="font-mono text-micro uppercase text-bone">Current</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mt-16 select-none" aria-hidden>
          <div
            className="font-sans font-semibold leading-[0.78] tracking-[-0.06em] text-transparent"
            style={{ fontSize: 'clamp(160px, 31vw, 440px)', WebkitTextStroke: '1px rgb(var(--line-strong))' }}
          >
            FCC
          </div>
          <span className="absolute right-0 top-2 font-mono text-micro uppercase text-bone-mute">Wordmark · outline · 1 px</span>
        </div>

        <Ruler ticks={96} major={8} className="mt-8" />

        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-mono text-micro uppercase text-bone-mute">
            © 2026 FCC · All map data, units and incidents on this page are simulated · Not for operational use
          </span>
          <span className="font-mono text-micro uppercase text-bone-mute">
            FCC <span className="text-ink-500">//</span> Proposal <span className="text-ink-500">//</span> End of document
          </span>
        </div>
      </div>
    </footer>
  );
}
