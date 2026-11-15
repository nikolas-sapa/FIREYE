import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCard, Button, Icon, IconButton, MovementCard, OrchBubble, PromptChip, alertTone, cn, toneClass } from '@ds';
import type { MovementProposal, OrchAlert, SimSnapshotB } from '@/sim/types';
import { ageLabel, zuluAt } from './format';
import type { ConsoleActions, Sim, ViewMode } from './types';
import { SCROLL, SectionLabel, SweepBar } from './ui';

const STATUS_LABEL = { monitoring: 'Monitoring', analyzing: 'Analyzing', briefing: 'Briefing' } as const;
const MAX_FOCUS = 3;

function DockHeader({ state }: { state: SimSnapshotB }) {
  const o = state.orchestrator;
  const busy = o.status !== 'monitoring';
  const sources = new Set(state.pools.filter((p) => p.role === 'analysis' && p.source).map((p) => p.source)).size;
  return (
    <div className="relative shrink-0 border-b border-line">
      <div className="flex h-10 items-center gap-2.5 px-4">
        <span className="grid h-6 w-6 shrink-0 place-items-center border border-line-strong text-bone">
          <Icon name="orchestrator" size={14} />
        </span>
        <span className="font-mono text-nano text-bone">Orchestrator</span>
        <span className={cn('flex items-center gap-1.5 font-mono text-micro uppercase', busy ? 'text-ice' : 'text-phosphor')}>
          <span aria-hidden className={cn('h-1 w-1', busy ? 'animate-blink bg-ice' : 'bg-phosphor')} />
          {STATUS_LABEL[o.status]}
        </span>
        <span className="ml-auto fcc-micro fcc-num">{String(sources).padStart(2, '0')} sources</span>
      </div>
      {busy && <SweepBar className="absolute inset-x-0 bottom-[-1px]" />}
    </div>
  );
}

function Brief({ state, view }: { state: SimSnapshotB; view: ViewMode }) {
  const o = state.orchestrator;
  const bullets = view === 'detail' ? o.brief : o.brief.slice(0, 3);
  return (
    <div className="px-4 pb-4 pt-4">
      <p aria-live="polite" className="text-lg font-medium text-bone">
        {o.headline}
      </p>
      {bullets.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-bone-dim">
              <span aria-hidden className="mt-[9px] h-px w-2 shrink-0 bg-ink-400" />
              <span className="min-w-0">{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Attention({
  alerts,
  ambient,
  clock,
  t,
  view,
  highlightId,
  actions,
  ack,
}: {
  alerts: OrchAlert[];
  ambient: OrchAlert[];
  clock: Date;
  t: number;
  view: ViewMode;
  highlightId: string | null;
  actions: ConsoleActions;
  ack(id: string): void;
}) {
  const shown = alerts.slice(0, MAX_FOCUS);
  const more = alerts.length - shown.length;
  return (
    <div className="border-t border-line px-4 pb-4 pt-3">
      <SectionLabel meta={String(alerts.length).padStart(2, '0')}>Needs attention</SectionLabel>
      {shown.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
          <Icon name="check" size={12} className="text-phosphor" />
          Nothing needs you right now
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((a) => (
            <AlertCard
              key={a.id}
              className="animate-rise"
              cls={a.cls}
              tier={a.tier}
              score={a.score}
              title={a.title}
              body={a.body}
              why={view === 'detail' ? a.why : undefined}
              time={zuluAt(clock, t, a.at)}
              notify={a.notify}
              compact={view === 'calm'}
              selected={highlightId === a.id}
              onClick={() => actions.focusAlert(a.id)}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  icon="check"
                  onClick={(e) => {
                    e.stopPropagation();
                    ack(a.id);
                  }}
                >
                  Ack
                </Button>
              }
            />
          ))}
        </div>
      )}
      {more > 0 && (
        <button
          type="button"
          onClick={() => actions.openDrawer('log')}
          className="mt-2 flex h-7 w-full items-center justify-between border border-line px-2.5 font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:border-line-strong hover:text-bone"
        >
          <span className="fcc-num">+{more} more in log</span>
          <Icon name="arrow-right" size={12} />
        </button>
      )}

      {ambient.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => actions.openDrawer('log')}
            className="flex w-full items-center gap-2 font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-bone"
          >
            <span aria-hidden className="h-1.5 w-1.5 border border-ink-300" />
            <span className="fcc-num">
              {ambient.length} ambient {ambient.length === 1 ? 'item' : 'items'} on map
            </span>
          </button>
          {view === 'detail' && (
            <ul className="mt-2 flex flex-col divide-y divide-line border-y border-line">
              {ambient.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => actions.focusAlert(a.id)}
                    className="flex h-7 w-full items-center gap-2 text-left transition-colors duration-quick ease-servo hover:bg-ink-850"
                  >
                    <span aria-hidden className={cn('h-1 w-1 shrink-0', alertDot(a))} />
                    <span className="min-w-0 flex-1 truncate text-xs text-bone-dim">{a.title}</span>
                    <span className="shrink-0 font-mono text-micro text-bone-mute fcc-num">{a.score}</span>
                    <span className="w-10 shrink-0 text-right font-mono text-micro text-ink-400 fcc-num">{ageLabel(t - a.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const alertDot = (a: OrchAlert) => toneClass[alertTone(a.cls, a.tier)].dot;

const MOVE_STATUS: Record<MovementProposal['status'], string> = {
  proposed: 'Proposed', approved: 'Approved', rejected: 'Rejected', executing: 'Executing', done: 'Complete',
};

function Movement({ movements, view, actions, sim, primary }: { movements: MovementProposal[]; view: ViewMode; actions: ConsoleActions; sim: Sim; primary: boolean }) {
  const proposed = useMemo(() => movements.filter((m) => m.status === 'proposed').sort((a, b) => b.score - a.score), [movements]);
  const active = movements.filter((m) => m.status === 'approved' || m.status === 'executing');
  const top = proposed[0];
  if (!top && active.length === 0) return null;
  const activeShown = view === 'detail' ? active : active.slice(0, 2);
  return (
    <div className="border-t border-line px-4 pb-4 pt-3">
      <SectionLabel meta={proposed.length > 1 ? `${proposed.length} queued` : undefined}>Proposed movement</SectionLabel>
      {top && (
        <MovementCard
          key={top.id}
          className="mt-3 animate-rise"
          title={top.title}
          group={top.group}
          windowLabel={top.windowLabel ?? `WITHIN ${top.windowMin[0]}–${top.windowMin[1]} MIN`}
          trigger={top.trigger}
          reason={view === 'detail' ? top.reason : undefined}
          score={top.score}
          status={top.status}
          primary={primary}
          onApprove={() => sim.approveMovement(top.id)}
          onReject={() => sim.rejectMovement(top.id)}
          onLocate={() => {
            actions.flyTo(top.to, 2.2);
            actions.select(top.id);
          }}
        />
      )}
      {activeShown.length > 0 && (
        <ul className={cn('flex flex-col divide-y divide-line border-y border-line', top ? 'mt-2' : 'mt-3')}>
          {activeShown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  actions.flyTo(m.to, 2.2);
                  actions.select(m.id);
                }}
                className="flex h-7 w-full items-center gap-2 text-left transition-colors duration-quick ease-servo hover:bg-ink-850"
              >
                <Icon name="check" size={12} className="shrink-0 text-phosphor" />
                <span className="min-w-0 flex-1 truncate font-mono text-micro uppercase text-bone-dim">{m.group}</span>
                <span className="shrink-0 font-mono text-micro uppercase text-phosphor">{MOVE_STATUS[m.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thread({ state, view }: { state: SimSnapshotB; view: ViewMode }) {
  const o = state.orchestrator;
  const [expanded, setExpanded] = useState(false);
  const last = o.messages[o.messages.length - 1];
  const thinking = o.status === 'analyzing' && last?.role === 'user';
  const limit = view === 'detail' || expanded ? o.messages.length : 3;
  const shown = o.messages.slice(-limit);
  const hidden = o.messages.length - shown.length;
  return (
    <div className="border-t border-line px-4 pb-4 pt-3">
      <SectionLabel meta={String(o.messages.length).padStart(2, '0')}>Conversation</SectionLabel>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-bone"
        >
          <span className="fcc-num">Show {hidden} earlier</span>
        </button>
      )}
      <div className="mt-3 flex flex-col gap-3" aria-live="polite">
        {shown.map((m) => (
          <OrchBubble key={m.id} className="animate-rise" role={m.role} time={zuluAt(state.clock, state.t, m.at)}>
            {m.text}
          </OrchBubble>
        ))}
        {thinking && <OrchBubble role="orchestrator" thinking />}
      </div>
    </div>
  );
}

function Composer({ suggestions, view, onAsk }: { suggestions: string[]; view: ViewMode; onAsk(text: string): void }) {
  const [draft, setDraft] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAsk(text);
    setDraft('');
  };
  const chips = suggestions.slice(0, view === 'detail' ? 3 : 2);
  return (
    <div className="shrink-0 border-t border-line bg-ink-900 px-4 pb-3 pt-2.5">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((s) => (
            <PromptChip key={s} onClick={() => onAsk(s)}>
              {s}
            </PromptChip>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex h-9 items-center gap-1 border border-line-strong bg-ink-950 pl-2.5 pr-1 transition-colors duration-quick ease-servo focus-within:border-signal">
        <Icon name="sparkle" size={14} className="shrink-0 text-bone-mute" />
        <label htmlFor="orch-ask" className="sr-only">
          Ask the Orchestrator
        </label>
        <input
          id="orch-ask"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the Orchestrator"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent px-1 text-sm text-bone outline-none placeholder:text-ink-500"
        />
        <IconButton type="submit" icon="send" label="Send to Orchestrator" size="sm" variant="ghost" disabled={!draft.trim()} />
      </form>
    </div>
  );
}

export function OrchestratorDock({
  sim,
  view,
  highlightId,
  actions,
  className,
}: {
  sim: Sim;
  view: ViewMode;
  highlightId: string | null;
  actions: ConsoleActions;
  className?: string;
}) {
  const state = sim.state;
  // A movement alert whose proposal is already on screen in "Proposed movement" would be shown twice.
  const focus = useMemo(() => {
    const proposed = new Set(state.movements.filter((m) => m.status === 'proposed').map((m) => m.id));
    return state.alerts
      .filter((a) => a.tier === 1 && !a.ack && !a.resolved && !(a.cls === 'movement' && a.movementId && proposed.has(a.movementId)))
      .sort((a, b) => b.score - a.score);
  }, [state.alerts, state.movements]);
  const ambient = useMemo(() => state.alerts.filter((a) => a.tier === 2 && !a.ack && !a.resolved).sort((a, b) => b.score - a.score), [state.alerts]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(false);
  const msgs = state.orchestrator.messages;
  const lastRole = msgs[msgs.length - 1]?.role;

  // Only jump to the thread after the user asks something; proactive messages must not yank the dock away from alerts.
  useEffect(() => {
    if (!followRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    if (lastRole === 'orchestrator') followRef.current = false;
  }, [msgs.length, lastRole]);

  const ask = (text: string) => {
    followRef.current = true;
    sim.ask(text);
  };

  return (
    <aside aria-label="Orchestrator" className={cn('flex min-h-0 min-w-0 flex-col bg-ink-900', className)}>
      <DockHeader state={state} />
      <div ref={scrollRef} className={cn(SCROLL, 'min-h-0 flex-1')}>
        <Brief state={state} view={view} />
        <Attention
          alerts={focus}
          ambient={ambient}
          clock={state.clock}
          t={state.t}
          view={view}
          highlightId={highlightId}
          actions={actions}
          ack={sim.ackAlert}
        />
        <Movement movements={state.movements} view={view} actions={actions} sim={sim} primary={!state.alerts.some((a) => a.tier === 0 && !a.ack)} />
        <Thread state={state} view={view} />
      </div>
      <Composer suggestions={state.orchestrator.suggestions} view={view} onAsk={ask} />
    </aside>
  );
}
