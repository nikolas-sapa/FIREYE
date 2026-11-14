import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCard, DecisionCard, Icon, IconButton, LedgerCounter, OrchBubble, PromptChip, WhyPopover, cn, alertClassLabel } from '@ds';
import type { Action, GradedItem } from '../contracts';
import { useConsoleApi, useConsoleSelector } from '../store';
import { ago, fmtDuration, localTime, toOrchAudiences, tierOfZone, zuluTime } from './format';
import { useUi } from './UiContext';

function SectionHead({ index, title, meta, children }: { index: string; title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-2">
      <span className="font-mono text-micro text-bone-mute fcc-num">{index}</span>
      <span aria-hidden className="h-2.5 w-px bg-line-strong" />
      <span className="font-mono text-micro uppercase tracking-[0.14em] text-bone">{title}</span>
      {meta && <span className="font-mono text-micro uppercase text-bone-mute fcc-num">{meta}</span>}
      <span aria-hidden className="h-px flex-1 bg-line-faint" />
      {children}
    </div>
  );
}

/* --------------------------------- Ledger --------------------------------- */

function LedgerStrip() {
  const ui = useUi();
  const l = useConsoleSelector((s) => s.ledger);
  return (
    <button
      type="button"
      onClick={() => ui.togglePanel('ledger')}
      aria-label="Open the Agent Work Ledger"
      className="grid w-full grid-cols-4 gap-px border-b border-line bg-line text-left transition-colors duration-quick ease-servo hover:bg-line-strong"
    >
      <LedgerCounter size="sm" label="Footage" value={l.footageReviewedS} format={(v) => fmtDuration(v)} className="bg-ink-950 px-3 py-2" />
      <LedgerCounter size="sm" label="Articles" value={l.articlesRead + l.postsScreened} className="bg-ink-950 px-3 py-2" />
      <LedgerCounter size="sm" label="Drafts" value={l.draftsWritten} className="bg-ink-950 px-3 py-2" />
      <LedgerCounter size="sm" label="Hrs saved" value={l.analystMinutesSaved / 60} format={(v) => v.toFixed(1)} tone="nominal" className="bg-ink-950 px-3 py-2" />
    </button>
  );
}

/* ---------------------------------- Brief ---------------------------------- */

function Now() {
  const brief = useConsoleSelector((s) => s.brief);
  const tz = useConsoleSelector((s) => s.pack?.manifest.tz ?? 'PDT');
  return (
    <section aria-label="Now" className="flex flex-col gap-2">
      <SectionHead index="01" title="Now" meta={brief.at ? `${localTime(brief.at, tz)} ${tz}` : undefined} />
      <p className="text-base font-medium leading-6 text-bone">{brief.headline || 'Monitoring the incident.'}</p>
      {brief.bullets.length > 0 && (
        <ul className="flex flex-col gap-1">
          {brief.bullets.slice(0, 3).map((b) => (
            <li key={b} className="flex gap-2 text-xs leading-5 text-bone-dim">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 bg-bone-mute" />
              {b}
            </li>
          ))}
        </ul>
      )}
      {brief.changed.length > 0 && (
        <div className="flex items-baseline gap-2 border-l border-ice/40 pl-2.5" title={brief.changed.join('\n')}>
          <span className="shrink-0 font-mono text-micro uppercase text-ice">Changed</span>
          <span className="min-w-0 truncate text-xs leading-4 text-bone-dim">{brief.changed[0]}</span>
          {brief.changed.length > 1 && <span className="shrink-0 font-mono text-micro text-bone-mute fcc-num">+{brief.changed.length - 1}</span>}
        </div>
      )}
    </section>
  );
}

/* -------------------------------- Decisions -------------------------------- */

function windowLabel(a: Action) {
  if (!a.window) return undefined;
  return `Start ≤ ${a.window.startMin} min · done ≤ ${a.window.endMin} min`;
}

function Decisions() {
  const api = useConsoleApi();
  const ui = useUi();
  const actions = useConsoleSelector((s) => s.actions);
  const items = useConsoleSelector((s) => s.items);
  const units = useConsoleSelector((s) => s.units);
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 5000) * 5000);
  const hasInterrupt = useMemo(() => items.some((i) => i.zone === 'Z0_INTERRUPT' && !i.dismissed), [items]);
  const [open, setOpen] = useState<string | null>(null);

  const pending = useMemo(() => {
    const z2 = new Set(items.filter((i) => i.zone === 'Z2_DECISION').map((i) => i.refId));
    return actions
      .filter((a) => a.status === 'proposed' && a.requiresApproval)
      .sort((a, b) => Number(z2.has(b.id)) - Number(z2.has(a.id)) || (a.risk === b.risk ? b.proposedAt - a.proposedAt : a.risk === 'high' ? -1 : 1));
  }, [actions, items]);
  const shown = pending.slice(0, 3);
  const auto = useMemo(() => actions.filter((a) => a.decidedBy === 'orchestrator' && (a.status === 'executing' || a.status === 'done')).slice(0, 2), [actions]);
  const expanded = shown.find((a) => a.id === open) ?? shown[0];
  const callsign = (id: string) => units.find((u) => u.id === id)?.callsign ?? id;

  return (
    <section aria-label="Decisions needed" className="flex flex-col gap-1.5">
      <SectionHead index="02" title="Decisions" meta={pending.length ? `${String(pending.length).padStart(2, '0')} pending` : undefined} />
      {shown.length === 0 && <p className="py-1 font-mono text-micro uppercase text-bone-mute">Nothing needs you right now.</p>}
      {shown.map((a) =>
        a === expanded ? (
          <DecisionCard
            key={a.id}
            className="animate-rise"
            kind={a.kind}
            title={a.title}
            summary={a.summary}
            risk={a.risk}
            status={a.status}
            audiences={a.audiences}
            windowLabel={windowLabel(a)}
            trigger={a.trigger}
            units={a.unitIds.map(callsign)}
            drafted={`Drafted · ${ago(t, a.proposedAt)}`}
            primary={!hasInterrupt}
            onApprove={() => api.approve(a.id)}
            onReject={() => api.reject(a.id)}
            onEdit={a.draft ? () => ui.openDraft(a.id) : undefined}
            onLocate={a.target || a.safetyZone ? () => api.focus((a.target ?? a.safetyZone?.center)!, 2500) : undefined}
          />
        ) : (
          <DecisionCard key={a.id} compact kind={a.kind} title={a.title} risk={a.risk} status={a.status} onExpand={() => setOpen(a.id)} />
        ),
      )}
      {pending.length > 3 && (
        <button type="button" onClick={() => ui.setPanel('drafts')} className="self-start font-mono text-micro uppercase text-bone-mute hover:text-bone">
          +{pending.length - 3} queued · open drafts
        </button>
      )}
      {auto.length > 0 && (
        <div className="mt-1 flex flex-col">
          {auto.map((a) => (
            <div key={a.id} className="flex h-7 items-center gap-2 border-b border-line-faint text-xs text-bone-dim last:border-b-0">
              <Icon name="check" size={11} className="shrink-0 text-phosphor" />
              <span className="font-mono text-micro uppercase text-bone-mute">Did</span>
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              <button type="button" onClick={() => api.undo(a.id)} className="shrink-0 font-mono text-micro uppercase text-bone-mute hover:text-bone">
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------- Focus ---------------------------------- */

function WhyLayer({ item, anchor, onClose }: { item: GradedItem; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 480;
    setTop(Math.max(56, Math.min(window.innerHeight - h - 12, anchor.top)));
  }, [anchor]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const zoneCode = item.zone.slice(0, 2);
  return createPortal(
    <div ref={ref} className="fixed z-toast animate-rise" style={{ top, right: window.innerWidth - anchor.left + 10 }}>
      <WhyPopover
        title={item.title}
        score={item.score}
        factors={item.factors}
        reason={item.reason}
        zone={item.zone}
        placement={
          <>
            Placed in {zoneCode} because {item.reason.charAt(0).toLowerCase() + item.reason.slice(1)}
            {item.prevZone && item.prevZone !== item.zone ? ` Moved from ${item.prevZone.slice(0, 2)}.` : ''}
            {item.bundleOf?.length ? ` Bundles ${item.bundleOf.length} findings within 400 m.` : ''}
          </>
        }
      />
    </div>,
    document.body,
  );
}

function Focus() {
  const api = useConsoleApi();
  const items = useConsoleSelector((s) => s.items);
  const focus = useMemo(() => items.filter((i) => i.zone === 'Z3_FOCUS' && !i.dismissed).slice(0, 3), [items]);
  const [why, setWhy] = useState<{ id: string; rect: DOMRect; pinned: boolean } | null>(null);
  const whyItem = why ? items.find((i) => i.id === why.id) : undefined;

  const show = (id: string, el: HTMLElement, pinned: boolean) => setWhy({ id, rect: el.getBoundingClientRect(), pinned });

  return (
    <section aria-label="Focus" className="flex flex-col gap-1.5">
      <SectionHead index="03" title="Focus" meta={focus.length ? `${String(focus.length).padStart(2, '0')}/03` : undefined} />
      {focus.length === 0 && <p className="py-1 font-mono text-micro uppercase text-bone-mute">Nothing above the focus line.</p>}
      {focus.map((it, i) => {
        const title = (
          <span className="inline-flex items-center gap-2">
            {it.title}
            {it.kind === 'bundle' && it.bundleOf && (
              <span className="border border-line-strong px-1 font-mono text-micro text-bone-dim fcc-num">×{it.bundleOf.length}</span>
            )}
          </span>
        );
        return (
          <div
            key={it.id}
            onMouseEnter={(e) => !why?.pinned && show(it.id, e.currentTarget, false)}
            onMouseLeave={() => setWhy((w) => (w && !w.pinned ? null : w))}
          >
            <AlertCard
              cls={it.cls}
              tier={tierOfZone(it)}
              score={it.score}
              title={title}
              body={i === 0 ? it.body : undefined}
              why={i === 0 ? it.reason : undefined}
              time={zuluTime(it.updatedAt, false)}
              notify={i === 0 ? toOrchAudiences(it.audiences) : undefined}
              compact={i > 0}
              selected={why?.pinned === true && why.id === it.id}
              onClick={() => {
                api.markSeen(it.id);
                if (it.pos) api.focus(it.pos, 2200);
              }}
              actions={
                i === 0 ? (
                  <>
                    <IconButton
                      icon="sparkle"
                      label="Why am I seeing this"
                      size="sm"
                      variant="ghost"
                      active={why?.pinned === true && why.id === it.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        const el = e.currentTarget.closest('[role="button"]') as HTMLElement | null;
                        if (why?.pinned && why.id === it.id) setWhy(null);
                        else if (el) show(it.id, el, true);
                      }}
                    />
                    <IconButton icon="check" label="Acknowledge" size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), api.acknowledge(it.id))} />
                    <IconButton icon="close" label="Dismiss" size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), api.dismiss(it.id))} />
                  </>
                ) : undefined
              }
            />
          </div>
        );
      })}
      {whyItem && why && <WhyLayer item={whyItem} anchor={why.rect} onClose={() => setWhy(null)} />}
    </section>
  );
}

/* --------------------------------- Ambient --------------------------------- */

function Ambient() {
  const ui = useUi();
  const items = useConsoleSelector((s) => s.items);
  const { n, byCls, log } = useMemo(() => {
    const amb = items.filter((i) => i.zone === 'Z4_AMBIENT' && !i.dismissed);
    const byCls = new Map<string, number>();
    amb.forEach((i) => byCls.set(i.cls, (byCls.get(i.cls) ?? 0) + 1));
    return { n: amb.length, byCls: [...byCls.entries()].sort((a, b) => b[1] - a[1]), log: items.filter((i) => i.zone === 'Z5_LEDGER').length };
  }, [items]);
  return (
    <button
      type="button"
      onClick={() => ui.togglePanel('log')}
      className="flex h-8 w-full items-center gap-2 border-y border-line-faint font-mono text-micro uppercase text-bone-mute transition-colors duration-quick ease-servo hover:text-bone-dim"
    >
      <span className="text-bone-dim fcc-num">Z4 · {String(n).padStart(2, '0')}</span>
      <span>on the stage</span>
      {byCls.slice(0, 3).map(([c, k]) => (
        <span key={c} className="text-bone-mute">
          · {k} {alertClassLabel[c as GradedItem['cls']]}
        </span>
      ))}
      <span className="ml-auto fcc-num">Z5 · {log} in log</span>
      <Icon name="chevron-right" size={10} />
    </button>
  );
}

/* ------------------------------ Conversation ------------------------------- */

function Conversation() {
  const api = useConsoleApi();
  const messages = useConsoleSelector((s) => s.messages);
  const suggestions = useConsoleSelector((s) => s.suggestions);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const recent = messages.slice(-24);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.thinking]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    api.ask(q);
    setText('');
  };
  return (
    <section aria-label="Conversation" className="flex h-[244px] shrink-0 flex-col border-t border-line bg-ink-950 [@media(max-height:960px)]:h-[220px]">
      <div className="px-3 pt-1">
        <SectionHead index="04" title="Ask the Orchestrator" />
      </div>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2" aria-live="polite">
        {recent.map((m) => (
          <OrchBubble key={m.id} role={m.role} time={zuluTime(m.at, false)} thinking={m.thinking}>
            {m.text}
          </OrchBubble>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {suggestions.slice(0, 3).map((s) => (
            <PromptChip key={s} onClick={() => api.ask(s)}>
              {s}
            </PromptChip>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3">
        <Icon name="orchestrator" size={12} className="shrink-0 text-ice" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about risk, units, the projection…"
          aria-label="Ask the Orchestrator"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-bone placeholder:text-bone-mute focus:outline-none"
        />
        <IconButton type="submit" icon="send" label="Send" size="sm" variant="ghost" disabled={!text.trim()} />
      </form>
    </section>
  );
}

/* --------------------------------- Column ---------------------------------- */

export function OrchestratorColumn({ className }: { className?: string }) {
  const model = useConsoleSelector((s) => s.pools.find((p) => p.role === 'orchestrator')?.model ?? 'treq · reasoning-large');
  return (
    <aside aria-label="Orchestrator" className={cn('flex min-h-0 flex-col border-l border-line bg-ink-950', className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Icon name="orchestrator" size={13} className="text-ice" />
        <span className="font-mono text-nano uppercase tracking-[0.16em] text-bone">Orchestrator</span>
        <span className="ml-auto truncate font-mono text-micro uppercase text-bone-mute">{model}</span>
      </div>
      <LedgerStrip />
      <div className="flex min-h-0 flex-[1_1_auto] flex-col gap-4 overflow-y-auto px-3 pb-3 pt-2">
        <Now />
        <Decisions />
        <Focus />
        <Ambient />
      </div>
      <Conversation />
    </aside>
  );
}
