import { useState } from 'react';
import { Brackets, Button, cn, motion } from '@ds';
import { GroupTitle, SubSection } from './Spec';

const curves = [
  { key: 'servo', css: motion.ease.servo, cls: 'ease-servo', p: [0.2, 0, 0, 1], use: 'Default. Hover, focus, state changes. Fast out, precise stop.' },
  { key: 'snap', css: motion.ease.snap, cls: 'ease-snap', p: [0.7, 0, 0.2, 1], use: 'Toggles and mechanical switches. Deliberate start, hard landing.' },
  { key: 'settle', css: motion.ease.settle, cls: 'ease-settle', p: [0.16, 1, 0.3, 1], use: 'Panels, modals, data arriving. Long tail, comes to rest.' },
] as const;

const durations = Object.entries(motion.duration) as [string, number][];
const durCls: Record<string, string> = {
  instant: 'duration-instant', quick: 'duration-quick', base: 'duration-base', slow: 'duration-slow', drift: 'duration-drift',
};

function CurvePlot({ p }: { p: readonly [number, number, number, number] }) {
  const S = 120;
  const [x1, y1, x2, y2] = p;
  const d = `M0 ${S} C${x1 * S} ${S - y1 * S} ${x2 * S} ${S - y2 * S} ${S} 0`;
  return (
    <svg viewBox={`-8 -8 ${S + 16} ${S + 16}`} className="h-40 w-40 overflow-visible" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <g key={i} stroke="rgb(var(--line-faint))">
          <line x1={(i * S) / 4} y1={0} x2={(i * S) / 4} y2={S} />
          <line x1={0} y1={(i * S) / 4} x2={S} y2={(i * S) / 4} />
        </g>
      ))}
      <rect x={0} y={0} width={S} height={S} fill="none" stroke="rgb(var(--line))" />
      <line x1={0} y1={S} x2={x1 * S} y2={S - y1 * S} stroke="rgb(var(--ink-500))" strokeDasharray="2 2" />
      <line x1={S} y1={0} x2={x2 * S} y2={S - y2 * S} stroke="rgb(var(--ink-500))" strokeDasharray="2 2" />
      <rect x={x1 * S - 2} y={S - y1 * S - 2} width={4} height={4} fill="rgb(var(--ink-950))" stroke="rgb(var(--bone-dim))" />
      <rect x={x2 * S - 2} y={S - y2 * S - 2} width={4} height={4} fill="rgb(var(--ink-950))" stroke="rgb(var(--bone-dim))" />
      <path d={d} fill="none" stroke="rgb(var(--signal))" strokeWidth={1.5} />
      <text x={0} y={S + 9} className="fill-current font-mono text-bone-mute" fontSize={6}>t</text>
      <text x={-7} y={4} className="fill-current font-mono text-bone-mute" fontSize={6}>x</text>
    </svg>
  );
}

export function MotionSpec() {
  const [on, setOn] = useState(false);
  return (
    <SubSection
      id="system-motion"
      index="05.10"
      kicker="Motion"
      title="Mechanical, precise, never decorative."
      lede="Motion behaves like a servo: it moves only when state changes, travels the shortest path, and stops without bounce. Reduced-motion users get instant state."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {curves.map((c) => (
          <div key={c.key} className="relative flex flex-col border border-line bg-ink-900">
            <Brackets size={6} />
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="font-mono text-nano uppercase tracking-[0.14em] text-bone">ease-{c.key}</span>
              <span className="fcc-micro">.{c.cls}</span>
            </div>
            <div className="flex justify-center py-6">
              <CurvePlot p={c.p} />
            </div>
            <div className="border-t border-line px-3 py-2.5">
              <code className="block font-mono text-micro text-bone-dim">{c.css}</code>
              <p className="mt-1.5 text-xs text-bone-dim">{c.use}</p>
            </div>
          </div>
        ))}
      </div>

      <GroupTitle code="M.2" className="mt-14">
        Durations
      </GroupTitle>
      <div className="border border-line">
        {durations.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[80px_64px_1fr] items-center gap-4 border-b border-line-faint px-3 py-2 last:border-b-0">
            <span className="font-mono text-tiny text-bone">{k}</span>
            <span className="font-mono text-micro text-bone-mute fcc-num">{v}ms</span>
            <span className="relative h-2 bg-ink-800">
              <span className="absolute inset-y-0 left-0 bg-ink-500" style={{ width: `${(v / 900) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>

      <GroupTitle code="M.3" className="mt-14">
        Live demo / hover or press replay
      </GroupTitle>
      <div className="relative border border-line bg-ink-900 p-4" onMouseEnter={() => setOn((s) => !s)}>
        <Brackets size={6} />
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="fcc-micro">Travel 100% / duration slow (420ms) + drift (900ms)</span>
          <Button size="sm" icon="play" onClick={() => setOn((s) => !s)}>
            Replay
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {curves.map((c) =>
            (['slow', 'drift'] as const).map((d) => (
              <div key={c.key + d} className="grid grid-cols-[120px_1fr] items-center gap-4">
                <span className="font-mono text-micro uppercase text-bone-dim">
                  {c.key} / {d}
                </span>
                <div className="relative h-4 border-y border-line-faint">
                  <span aria-hidden className="absolute inset-y-0 left-1/4 w-px bg-line-faint" />
                  <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line-faint" />
                  <span aria-hidden className="absolute inset-y-0 left-3/4 w-px bg-line-faint" />
                  <span
                    className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 transition-[left]', c.cls, durCls[d], c.key === 'servo' ? 'bg-signal' : 'bg-bone')}
                    style={{ left: on ? 'calc(100% - 10px)' : '0%' }}
                  />
                </div>
              </div>
            )),
          )}
        </div>
      </div>
    </SubSection>
  );
}
