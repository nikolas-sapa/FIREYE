import type { ReactNode } from 'react';
import { Badge, Button, Icon, Metric, Panel, cn, fmtLat, fmtLon } from '@ds';
import { SubSection } from './Spec';

function Verdict({ ok, children, note }: { ok: boolean; children: ReactNode; note: string }) {
  return (
    <figure className={'flex flex-col border border-line bg-ink-900'}>
      <div className={cn('flex h-8 items-center gap-2 border-b px-3', ok ? 'border-phosphor/30' : 'border-ember/30')}>
        <Icon name={ok ? 'check' : 'close'} size={12} strokeWidth={1.75} className={ok ? 'text-phosphor' : 'text-ember'} />
        <span className={cn('font-mono text-micro uppercase tracking-[0.14em]', ok ? 'text-phosphor' : 'text-ember')}>{ok ? 'Do' : "Don't"}</span>
      </div>
      <div className="flex min-h-[160px] flex-1 flex-wrap items-center justify-center gap-3 p-6">{children}</div>
      <figcaption className="border-t border-line px-3 py-2.5 text-xs text-bone-dim">{note}</figcaption>
    </figure>
  );
}

export function DoDontSpec() {
  return (
    <SubSection
      id="system-dodont"
      index="05.11"
      kicker="Do / Don't"
      title="Four common failures, and the fix."
      lede="When in doubt, remove. A command interface earns trust by being quiet when nothing is wrong."
    >
      <div className="flex flex-col gap-10">
        <Pair index="01" title="Signal is scarce">
          <Verdict ok note="One primary action per view. Everything else is secondary or ghost.">
            <Button variant="primary">Approve plan</Button>
            <Button>Modify</Button>
            <Button variant="ghost">Defer</Button>
          </Verdict>
          <Verdict ok={false} note="Three orange buttons means the commander has to guess which one matters.">
            <Button variant="primary">Approve</Button>
            <Button variant="primary">Modify</Button>
            <Button variant="primary">Defer</Button>
          </Verdict>
        </Pair>
        <Pair index="02" title="Hairline over fill">
          <Verdict ok note="1px rules and a mono header define structure without adding visual weight.">
            <Panel index="03" title="Fire behavior" meta="Live" className="w-full max-w-xs" dense>
              <Metric label="Rate of spread" value="0.42" unit="m/s" tone="warning" size="sm" />
            </Panel>
          </Verdict>
          <Verdict ok={false} note="Rounded tinted cards with drop shadows compete with the map and blur hierarchy.">
            <div className="w-full max-w-xs rounded-lg bg-ink-700 p-4 shadow-[0_12px_24px_rgba(0,0,0,0.6)]">
              <div className="text-sm font-semibold text-bone">Fire Behavior</div>
              <div className="mt-2 text-2xl font-bold text-amber">0.42 m/s</div>
            </div>
          </Verdict>
        </Pair>
        <Pair index="03" title="Mono for machines">
          <Verdict ok note="Coordinates and numbers in mono with tabular figures. Columns align and digits do not jitter.">
            <div className="flex flex-col gap-1 font-mono text-tiny text-bone fcc-num">
              <span>{fmtLat(34.1873)} {fmtLon(-118.2241)}</span>
              <span>{fmtLat(34.1911)} {fmtLon(-118.2107)}</span>
              <span className="text-bone-mute">ALT 0120 M / HDG 274°</span>
            </div>
          </Verdict>
          <Verdict ok={false} note="Proportional sans for telemetry breaks alignment and reads as prose rather than data.">
            <div className="flex flex-col gap-1 text-sm italic text-bone" style={{ fontVariantNumeric: 'proportional-nums' }}>
              <span>34.1873, -118.2241</span>
              <span>34.1911, -118.2107</span>
              <span className="text-bone-mute">Altitude 120m, heading 274</span>
            </div>
          </Verdict>
        </Pair>
        <Pair index="04" title="Color by role">
          <Verdict ok note="Ember is reserved for danger, violet for people. Meaning is consistent across map, list and alert.">
            <Badge tone="danger" dot>Fire front</Badge>
            <Badge tone="detection" dot>Human</Badge>
            <Badge tone="telemetry" dot>UAS-07</Badge>
          </Verdict>
          <Verdict ok={false} note="Hue chosen for looks: danger in violet, a drone in red. Operators learn the wrong code.">
            <span className="rounded-pill bg-violet px-3 py-1 text-xs font-semibold text-ink-950">Fire front</span>
            <span className="rounded-pill bg-ember px-3 py-1 text-xs font-semibold text-ink-950">UAS-07</span>
            <span className="rounded-pill bg-phosphor px-3 py-1 text-xs font-semibold text-ink-950">Human</span>
          </Verdict>
        </Pair>
      </div>
    </SubSection>
  );
}

function Pair({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono text-micro text-signal">{index}</span>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone-dim">{title}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}
