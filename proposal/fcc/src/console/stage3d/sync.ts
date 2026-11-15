import { useLayoutEffect } from 'react';
import { useConsoleSelector } from '../store';
import { stageWorld } from './world';

/**
 * Mirrors the store slices the stage needs into `stageWorld`. Safe to call from several components
 * (Stage and every FeedSurface); writes are reference-compared and idempotent.
 */
export function useStageSync() {
  const pack = useConsoleSelector((s) => s.pack);
  const t = useConsoleSelector((s) => s.clock.t);
  const paused = useConsoleSelector((s) => s.clock.paused);
  const speed = useConsoleSelector((s) => s.clock.speed);
  const units = useConsoleSelector((s) => s.units);
  const findings = useConsoleSelector((s) => s.findings);
  const feeds = useConsoleSelector((s) => s.feeds);
  const projection = useConsoleSelector((s) => s.projection);
  const items = useConsoleSelector((s) => s.items);
  const actions = useConsoleSelector((s) => s.actions);
  const coverage = useConsoleSelector((s) => s.coverage);
  const stage = useConsoleSelector((s) => s.stage);
  const directives = useConsoleSelector((s) => s.directives);
  const fireRev = useConsoleSelector((s) => s.fireRev);
  useLayoutEffect(() => {
    stageWorld.set({ pack, t, paused, speed, units, findings, feeds, projection, items, actions, coverage, stage, directives, fireRev });
  }, [pack, t, paused, speed, units, findings, feeds, projection, items, actions, coverage, stage, directives, fireRev]);
}
