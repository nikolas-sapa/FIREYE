import { Icon, Tooltip, cn, type IconName } from '@ds';
import type { AgentPool } from '../contracts';
import { useConsoleSelector } from '../store';
import { useUi, type PanelId } from './UiContext';

export function poolIcon(p: Pick<AgentPool, 'role' | 'source'>): IconName {
  if (p.role === 'orchestrator') return 'orchestrator';
  if (p.role === 'projection') return 'flame';
  switch (p.source) {
    case 'web':
      return 'web';
    case 'satellite':
      return 'satellite';
    case 'social':
      return 'social';
    case 'drone-cam':
      return 'drone';
    case 'ground-cam':
    case 'fixed-cam':
      return 'video';
    case 'weather':
      return 'wind';
    case 'radio':
      return 'radio';
    case 'terrain':
      return 'map';
    case 'aircraft':
      return 'helo';
    default:
      return 'ai';
  }
}

const items: { id: PanelId; icon: IconName; label: string }[] = [
  { id: 'agents', icon: 'agents', label: 'Agent Ops' },
  { id: 'drafts', icon: 'news', label: 'Drafts' },
  { id: 'ledger', icon: 'zap', label: 'Work Ledger' },
  { id: 'log', icon: 'log', label: 'Log' },
  { id: 'layers', icon: 'layers', label: 'Layers & sources' },
];

function PoolGlyph({ p }: { p: AgentPool }) {
  const max = Math.max(1, p.maxWorkers);
  const sat = p.workers >= max && p.queue > 0;
  const cells = 8;
  const on = Math.round((p.workers / max) * cells);
  return (
    <span className="flex w-full flex-col items-center gap-1">
      <Icon name={poolIcon(p)} size={13} className={p.workers > 0 ? 'text-bone-dim' : 'text-ink-500'} />
      <span aria-hidden className="flex h-1 w-8 gap-px">
        {Array.from({ length: cells }).map((_, i) => (
          <span key={i} className={cn('flex-1 transition-colors duration-base ease-servo', i < on ? (sat ? 'bg-amber' : 'bg-ice') : 'bg-ink-700')} />
        ))}
      </span>
      <span className={cn('font-mono text-micro leading-none tracking-normal fcc-num', p.queue > 0 ? (sat ? 'text-amber' : 'text-bone-mute') : 'text-ink-500')}>
        {String(p.workers).padStart(2, '0')}
      </span>
    </span>
  );
}

export function LeftRail() {
  const ui = useUi();
  const pools = useConsoleSelector((s) => s.pools);
  const pendingDrafts = useConsoleSelector((s) => s.actions.filter((a) => a.draft && a.status === 'proposed').length);
  const workers = pools.reduce((n, p) => n + p.workers, 0);
  const badge: Partial<Record<PanelId, number>> = { agents: workers, drafts: pendingDrafts };
  return (
    <nav aria-label="Console panels" className="relative z-hud flex w-13 shrink-0 flex-col border-r border-line bg-ink-950">
      {items.map((it) => {
        const active = ui.panel === it.id;
        const b = badge[it.id];
        return (
          <Tooltip key={it.id} content={it.label} side="right" className="flex">
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={active}
              onClick={() => ui.togglePanel(it.id)}
              className={cn(
                'relative flex h-12 w-13 items-center justify-center border-b border-line-faint transition-[background-color,color] duration-quick ease-servo',
                'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-3px] focus-visible:outline-signal',
                active ? 'bg-ink-800 text-bone' : 'text-bone-mute hover:bg-ink-900 hover:text-bone',
              )}
            >
              {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-bone" />}
              <Icon name={it.icon} size={18} />
              {b ? (
                <span
                  className={cn(
                    'absolute right-1 top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center px-0.5 font-mono text-micro leading-none tracking-normal fcc-num',
                    it.id === 'drafts' ? 'bg-amber text-ink-950' : 'bg-ink-600 text-bone',
                  )}
                >
                  {b}
                </span>
              ) : null}
            </button>
          </Tooltip>
        );
      })}
      <div className="flex min-h-0 flex-1 flex-col items-center pt-3">
        <span className="mb-2 font-mono text-micro uppercase text-bone-mute">Swarm</span>
        {pools.map((p) => (
          <Tooltip
            key={p.id}
            side="right"
            className="flex w-full"
            content={`${p.label} · ${p.provider} · ${p.workers}/${p.maxWorkers} · Q${p.queue}`}
          >
            <button
              type="button"
              aria-label={`${p.label}: ${p.workers} of ${p.maxWorkers} workers, ${p.queue} queued`}
              onClick={() => ui.setPanel('agents')}
              className="flex w-13 justify-center py-2 transition-colors duration-quick ease-servo hover:bg-ink-900 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-3px] focus-visible:outline-signal"
            >
              <PoolGlyph p={p} />
            </button>
          </Tooltip>
        ))}
      </div>
    </nav>
  );
}
