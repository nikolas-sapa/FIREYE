import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../../../index.css';
import { loadScenario } from '../../scenario/load';
import type { Directive, ScenarioPack } from '../../contracts';
import { StageView } from '../StageView';
import { FeedSurfaceView } from '../feeds/FeedSurfaceView';
import { stageWorld, useStageWorld } from '../world';
import type { StageSnapshot } from '../types';
import { mockActions, mockCoverage, mockProjection, mockState } from './mock';

const qs = new URLSearchParams(location.search);
const offsetH = Number(qs.get('t') ?? 9);
const speed = Number(qs.get('speed') ?? 60);

function Harness() {
  const [err, setErr] = useState<string | null>(null);
  const feeds = useStageWorld((s) => s.feeds);
  useEffect(() => {
    let pack: ScenarioPack;
    let id = 0;
    const t0 = performance.now();
    loadScenario().then((p) => {
      pack = p;
      const coverage = mockCoverage(p);
      const actions = mockActions(p);
      let proj = mockProjection(p, p.manifest.start + offsetH * 3600e3, 1);
      let rev = 0;
      const directives: Directive[] = [];
      let stage: StageSnapshot['stage'] | undefined;
      const tick = () => {
        const wallS = (performance.now() - t0) / 1000;
        const t = pack.manifest.start + offsetH * 3600e3 + wallS * speed * 1000;
        const m = mockState(pack, t, wallS);
        const fxo = qs.get('fx');
        if (fxo) for (const f of m.feeds) f.fx = fxo as typeof f.fx;
        const fireRev = Math.floor((t - pack.manifest.start) / (5 * 60e3));
        if (fireRev !== rev && fireRev % 6 === 0) proj = mockProjection(pack, t, proj.rev + 1, proj.bands);
        rev = fireRev;
        const feedId = qs.get('feed') ?? undefined;
        stage ??= { mode: feedId ? 'feed' : 'globe', feedId, dimmed: qs.has('dim'), highlight: qs.get('hl')?.split(',') ?? [] };
        stageWorld.set({
          pack, t, units: m.units, findings: m.findings, items: m.items, feeds: m.feeds, projection: proj, coverage, actions,
          stage,
          directives, fireRev,
        });
        id = window.setTimeout(tick, 200);
      };
      tick();
      const focus = qs.get('focus');
      if (focus) {
        window.setTimeout(() => {
          const [lon, lat, range] = focus.split(',').map(Number);
          directives.unshift({ id: 'd-focus', kind: 'focusStage', at: 0, reason: 'dev', target: { lon, lat }, rangeM: range || 3000, pitchDeg: -35 });
          stageWorld.set({ directives: [...directives] });
        }, 1500);
      }
      if (qs.has('dim')) {
        directives.unshift({ id: 'd-dim', kind: 'dimOthers', at: 0, reason: 'dev', itemId: 'f-hikers', on: true });
      }
    }).catch((e) => setErr(String(e)));
    return () => window.clearTimeout(id);
  }, []);
  const thumbs = qs.has('thumbs');
  return (
    <div className="flex h-screen w-screen flex-col bg-void">
      <div className="relative min-h-0 flex-1">
        <StageView onSelect={(sid, k) => console.log('select', sid, k)} />
        {err && <div className="absolute left-4 top-4 font-mono text-tiny text-ember">{err}</div>}
      </div>
      {thumbs && (
        <div className="grid h-[180px] shrink-0 grid-cols-8 gap-px bg-line">
          {feeds.map((f) => (
            <div key={f.id} className="relative bg-ink-950">
              <FeedSurfaceView feedId={f.id} variant="thumb" />
              <span className="absolute bottom-1 left-1 font-mono text-micro uppercase text-bone-dim">{f.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
