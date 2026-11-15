import { useEffect, useLayoutEffect, useRef } from 'react';
import { useDecisions } from '../fireye/shell/OrchestratorCallout';
import { fireyeUi, useFireye } from '../fireye/shell/ui';

/** Keys from `open` missing in `snoozed`. Pure so it can be checked without React. */
export function missingKeys(snoozed: readonly string[], open: readonly string[]): string[] {
  return open.filter((k, i) => !snoozed.includes(k) && open.indexOf(k) === i);
}

/** `snoozed` without the keys this hook added; keys the user deferred themselves stay. */
export function withoutAdded(snoozed: readonly string[], added: ReadonlySet<string>): string[] {
  return snoozed.filter((k) => !added.has(k));
}

/**
 * Hides FIREYE's OrchestratorCallout by keeping every open decision key in `fireyeUi.snoozed`
 * (the public "Later" mechanism). Decisions stay in `useDecisions().open`, so the ORCH count and
 * api.approve/reject from the ops cards are unaffected. Keys added here are removed again when
 * `active` turns false or on unmount.
 */
export function useHideCallout(active = true): void {
  const { open } = useDecisions();
  const snoozed = useFireye((s) => s.snoozed);
  const added = useRef(new Set<string>());
  const keys = open.map((d) => d.key);
  const sig = keys.join('\n');

  // Layout effect so the callout never paints for a frame before it is snoozed.
  useLayoutEffect(() => {
    if (!active) return;
    const missing = missingKeys(fireyeUi.get().snoozed, keys);
    if (!missing.length) return;
    missing.forEach((k) => added.current.add(k));
    fireyeUi.set((s) => ({ snoozed: [...s.snoozed, ...missingKeys(s.snoozed, missing)] }));
    // keys is derived from sig; snoozed re-runs this if something else clears the list.
  }, [active, sig, snoozed]);

  useEffect(() => {
    if (active) return;
    const mine = added.current;
    if (!mine.size) return;
    added.current = new Set();
    fireyeUi.set((s) => ({ snoozed: withoutAdded(s.snoozed, mine) }));
  }, [active]);

  useEffect(() => () => {
    const mine = added.current;
    if (!mine.size) return;
    added.current = new Set();
    fireyeUi.set((s) => ({ snoozed: withoutAdded(s.snoozed, mine) }));
  }, []);
}
