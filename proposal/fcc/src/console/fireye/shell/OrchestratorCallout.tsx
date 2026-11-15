import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, OrchestratorAvatar, ScoreMeter, TierBadge, cn, tierOf } from '@ds';
import type { Action, Geo, GradedItem, Ms } from '../../contracts';
import { useConsoleApi, useConsoleSelector } from '../../store';
import { localTime, packZone } from '../../ui/format';
import { visibleAt } from '../data/chronicle';
import { actionKey, journal } from '../data/journal';
import { applyDecision } from '../data/decision';
import { useChronicle } from './sync';
import { fireyeUi, useFireye } from './ui';
import { TamagotchiSprite } from '../../ui/TamagotchiSprite';

const MIN = 60000;
/** A recommendation stays in the callout this long before it lapses (it remains in the log). */
const OPEN_FOR = 30 * MIN;
const SEV_SCORE = { info: 40, watch: 66, alert: 82, critical: 92 } as const;

export interface Decision {
  key: string;
  origin: 'runtime' | 'chronicle';
  t: Ms;
  title: string;
  body?: string;
  reason?: string;
  score: number;
  pos?: Geo;
  evidence: { t: Ms; source: string; title: string }[];
  action?: Action;
  item?: GradedItem;
}

function useJournalVersion() {
  return useSyncExternalStore(journal.subscribe, journal.version, journal.version);
}

/** Open human decisions at the playhead: runtime interrupts and high-risk drafts plus chronicle recommendations. */
export function useDecisions(): { open: Decision[]; top: Decision | null } {
  const ch = useChronicle();
  const t = useConsoleSelector((s) => Math.floor(s.clock.t / 1000) * 1000);
  const items = useConsoleSelector((s) => s.items);
  const actions = useConsoleSelector((s) => s.actions);
  const jv = useJournalVersion();
  return useMemo(() => {
    const open: Decision[] = [];
    const visible = ch ? visibleAt(ch, t) : [];
    const evidenceFor = (at: Ms) => visible
      .filter((e) => e.tab === 'intake' && e.t <= at && e.t > at - 20 * MIN && (e.severity === 'alert' || e.severity === 'critical'))
      .slice(-3).reverse().map((e) => ({ t: e.t, source: e.source, title: e.title }));
    for (const e of visible) {
      if (e.decision !== 'needed' || t - e.t > OPEN_FOR || journal.at(e.id, t)) continue;
      open.push({ key: e.id, origin: 'chronicle', t: e.t, title: e.title, body: e.body, score: SEV_SCORE[e.severity], pos: e.pos, evidence: evidenceFor(e.t), reason: `${e.source} · ${e.provenance}` });
    }
    const z0 = items.find((i) => i.zone === 'Z0_INTERRUPT' && !i.dismissed);
    for (const a of actions) {
      if (a.status !== 'proposed' || !a.requiresApproval || t - a.proposedAt > OPEN_FOR || journal.at(actionKey(a), t)) continue;
      const item = items.find((i) => i.refId === a.id) ?? (z0?.refId === a.id ? z0 : undefined);
      open.push({ key: actionKey(a), origin: 'runtime', t: a.proposedAt, title: a.title, body: a.summary, score: item?.score ?? (a.risk === 'high' ? 80 : 60), reason: item?.reason ?? a.trigger, pos: a.target ?? item?.pos, evidence: evidenceFor(a.proposedAt), action: a, item });
    }
    if (z0 && z0.kind !== 'action' && !open.some((d) => d.item?.id === z0.id)) {
      open.push({ key: `item:${z0.id}`, origin: 'runtime', t: z0.updatedAt, title: z0.title, body: z0.body, reason: z0.reason, score: z0.score, pos: z0.pos, evidence: evidenceFor(z0.updatedAt), item: z0 });
    }
    open.sort((a, b) => b.score - a.score || b.t - a.t);
    return { open, top: open[0] ?? null };
    // jv invalidates on journal changes.
  }, [ch, t, items, actions, jv]);
}

/** The single prominent card shown when the orchestrator needs a human. High-risk actions still need this click. */
export function OrchestratorCallout({ onFocus }: { onFocus: (g: Geo) => void }) {
  const api = useConsoleApi();
  const { open } = useDecisions();
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const snoozed = useFireye((s) => s.snoozed);
  const dive = useFireye((s) => s.dive.phase);
  const d = open.find((x) => !snoozed.includes(x.key)) ?? null;
  const tz = packZone(pack).label;
  if (!d || dive !== 'idle') return null;
  const tier = tierOf(d.score);
  const decide = (decision: 'approved' | 'rejected') => {
    applyDecision(d, t, decision, api);
  };
  const ask = () => {
    fireyeUi.set({ chat: true });
    api.ask(`Why: ${d.title}`);
  };
  return (
    <div key={d.key} role="alertdialog" aria-label="Orchestrator decision" className="fireye-pop pointer-events-auto relative w-[560px] max-w-full border border-line-strong border-t-signal bg-ink-950/95 shadow-lift">
      <div aria-hidden className="fireye-brackets pointer-events-none absolute -inset-1">
        {['left-0 top-0 border-l border-t', 'right-0 top-0 border-r border-t', 'bottom-0 right-0 border-b border-r', 'bottom-0 left-0 border-b border-l'].map((c) => (
          <span key={c} className={cn('absolute h-2.5 w-2.5 border-bone', c)} />
        ))}
      </div>
      <div className="flex h-9 items-center gap-2 border-b border-line px-2">
        <OrchestratorAvatar size={24} framed state="alert" />
        <span className="font-mono text-micro uppercase tracking-[0.18em] text-bone">Orchestrator · decision needed</span>
        <TierBadge tier={tier} />
        <span className="ml-auto fcc-num font-mono text-micro uppercase text-bone-mute">{localTime(d.t, tz, true)} {tz}</span>
        {open.length > 1 && <span className="fcc-num font-mono text-micro uppercase text-bone-mute">+{open.length - 1} queued</span>}
        <button type="button" aria-label="Later" title="Later (stays in the ORCH queue)" onClick={() => fireyeUi.set((s) => ({ snoozed: [...s.snoozed, d.key] }))}
          className="text-bone-mute hover:text-bone"><Icon name="minus" size={11} /></button>
      </div>
      <div className="flex gap-4 px-4 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 text-bone">{d.title}</p>
          {d.body && <p className="mt-1 text-xs leading-4 text-bone-dim">{d.body}</p>}
          {d.reason && <p className="mt-1.5 font-mono text-micro uppercase leading-4 text-bone-mute">{d.reason}</p>}
        </div>
        <div className="flex w-24 shrink-0 flex-col items-end gap-1">
          <span className="fcc-micro">Score</span>
          <ScoreMeter score={d.score} size="sm" />
        </div>
      </div>
      {d.evidence.length > 0 && (
        <ul className="mx-4 mb-3 border-l border-line pl-3">
          {d.evidence.map((e) => (
            <li key={`${e.t}-${e.title}`} className="flex gap-2 py-0.5 font-mono text-micro uppercase leading-4">
              <span className="fcc-num shrink-0 text-bone-mute">{localTime(e.t, tz)}</span>
              <span className="shrink-0 text-bone-dim">{e.source}</span>
              <span className="truncate normal-case tracking-normal text-bone-mute">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <Button variant="primary" size="sm" icon="check" onClick={() => decide('approved')}>{d.action ? 'Approve' : 'Acknowledge'}</Button>
        <Button variant="secondary" size="sm" icon="close" onClick={() => decide('rejected')}>{d.action ? 'Reject' : 'Dismiss'}</Button>
        <Button variant="ghost" size="sm" icon="orchestrator" onClick={ask}>Ask</Button>
        {d.pos && <Button variant="ghost" size="sm" icon="locate" onClick={() => onFocus(d.pos!)}>Locate</Button>}
        <span className="ml-auto font-mono text-micro uppercase text-bone-mute">Simulated · human approval required</span>
      </div>
    </div>
  );
}

/** Collapsible orchestrator chat docked in the stage. Replies are deterministic simulation, not an LLM. */
export function OrchestratorChat() {
  const api = useConsoleApi();
  const open = useFireye((s) => s.chat);
  const messages = useConsoleSelector((s) => s.messages);
  const { open: openDecisions } = useDecisions();
  const paused = useConsoleSelector((s) => s.clock.paused);
  const suggestions = useConsoleSelector((s) => s.suggestions);
  const pack = useConsoleSelector((s) => s.pack);
  const tz = packZone(pack).label;
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const recent = messages.slice(-30);
  const mascotState = messages.some((m) => m.thinking) ? 'thinking' : openDecisions.length > 0 ? 'alert' : 'idle';
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [recent.length, open]);
  const send = (q: string) => { if (!q.trim()) return; api.ask(q.trim()); setText(''); };
  if (!open) {
    return (
      <button type="button" aria-label="Chat with Chief" aria-expanded={false} onClick={() => fireyeUi.set({ chat: true })}
        className="pointer-events-auto flex items-center gap-3 border border-line-strong bg-ink-950/90 px-3 py-2 font-mono text-micro uppercase tracking-[0.14em] text-bone-dim hover:text-bone max-[639px]:fixed max-[639px]:bottom-12 max-[639px]:left-3">
        <TamagotchiSprite size={64} state={mascotState} paused={paused} />
        <TamagotchiSprite character="scout" size={32} state={mascotState} paused={paused} />
        <span className="flex flex-col items-start gap-1">
          <span className="text-bone">Chief</span>
          <span className="text-bone-mute">Simulated assistant</span>
        </span>
      </button>
    );
  }
  return (
    <section aria-label="Orchestrator chat" className="fireye-pop pointer-events-auto flex h-[340px] max-h-[28vh] w-[360px] max-w-[calc(100vw-24px)] flex-col border border-line-strong bg-ink-950/95 shadow-panel max-[639px]:fixed max-[639px]:bottom-12 max-[639px]:left-3">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3">
        <TamagotchiSprite size={32} state={mascotState} paused={paused} />
        <TamagotchiSprite character="scout" size={16} state={mascotState} paused={paused} />
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Chief</span>
        <span className="font-mono text-micro uppercase text-bone-mute">simulated · no LLM</span>
        <button type="button" aria-label="Close chat" onClick={() => fireyeUi.set({ chat: false })} className="ml-auto text-bone-mute hover:text-bone"><Icon name="close" size={11} /></button>
      </header>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-live="polite">
        {recent.length === 0 && <p className="py-4 text-center font-mono text-micro uppercase text-bone-mute">Ask about risk, sensors, the fleet or a decision</p>}
        {recent.map((m) => (
          <div key={m.id} className={cn('mb-2 flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            <span className="fcc-num flex items-center gap-1 font-mono text-micro uppercase text-bone-mute">
              {m.role !== 'user' && <TamagotchiSprite size={16} state={m.thinking ? 'thinking' : mascotState} paused={paused} />}
              {m.role === 'user' ? 'You' : 'Orch'} · {localTime(m.at, tz)}
            </span>
            <p className={cn('mt-0.5 max-w-[90%] border px-2 py-1 text-xs leading-4', m.role === 'user' ? 'border-line-strong bg-ink-800 text-bone' : 'border-line bg-ink-900 text-bone-dim')}>
              {m.thinking ? 'Working…' : m.text}
            </p>
          </div>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
          {suggestions.slice(0, 4).map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="shrink-0 border border-line px-1.5 font-mono text-micro uppercase leading-5 text-bone-mute hover:text-bone">{s}</button>
          ))}
        </div>
      )}
      <form className="flex shrink-0 border-t border-line" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Chief" aria-label="Message"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-bone placeholder:text-bone-mute focus:outline-none" />
        <button type="submit" aria-label="Send" className="px-3 text-bone-dim hover:text-bone"><Icon name="send" size={12} /></button>
      </form>
    </section>
  );
}
