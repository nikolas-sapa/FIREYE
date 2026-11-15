import { useEffect, useState } from 'react';
import {
  AutonomyDial, Brackets, CaptionBar, DecisionCard, DirectiveToast, DraftDocument, GridBg, LedgerCounter, LensSelect, PredictionCheckCard, ProvenanceTag,
  AppearanceToggle, FireyeMark, FireyeWordmark, InstallAppButton, OrchestratorAvatar, THEMES, TimelineScrubber, WhyPopover, ZoneTag, useTheme,
  zoneMeta, type ConsoleActionStatus, type ConsoleAutonomy, type ConsoleLens, type ConsoleZone,
} from '@ds';
import { GroupTitle, Spec, SubSection } from './Spec';

const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const H = 3600_000;
const T0 = Date.UTC(2021, 7, 16, 19, 0); // Aug 16 12:00 PDT
const T1 = T0 + 24 * H;
const acres = [
  { t: T0, v: 30000 }, { t: T0 + 4 * H, v: 33500 }, { t: T0 + 8 * H, v: 41000 }, { t: T0 + 12 * H, v: 53800 },
  { t: T0 + 18 * H, v: 62500 }, { t: T1, v: 68630 },
];
const ticks = Array.from({ length: 5 }, (_, i) => ({ t: T0 + i * 6 * H, label: i === 2 ? 'AUG 17' : `${String((12 + i * 6) % 24).padStart(2, '0')}:00`, major: i === 2 }));
const fmt = (t: number) => {
  const d = new Date(t - 7 * H);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} PDT`;
};

const factors = { severity: 1, exposure: 0.92, confidence: 0.87, freshness: 1, corroboration: 6, actionability: 8, novelty: 4, fatigue: 0, lens: 1 };

const rescueBody = `TASK: Locate and extract 2 hikers, Capps Crossing trail, 1.6 km SE of Grizzly Flats.
UNITS: M-12 (EMS) via Grizzly Flats Rd, HAWK-3 overwatch at 120 m AGL.
APPROACH: North on Grizzly Flats Rd, east on Capps Crossing Rd to the trailhead. Do not proceed past the +1H band.
SAFETY ZONE: Grizzly Flats school lot, 38.6352°N 120.5370°W.
COMMS: TAC 2. HAWK-3 relays position every 60 s.`;

function ScrubberDemo() {
  const [t, setT] = useState(T0 + 9.5 * H);
  const [play, setPlay] = useState(() => !prefersReduced());
  useEffect(() => {
    if (!play) return;
    const id = window.setInterval(() => setT((x) => (x + 0.25 * H > T1 ? T0 : x + 0.25 * H)), 400);
    return () => window.clearInterval(id);
  }, [play]);
  return (
    <div className="relative flex flex-col gap-6 border border-line bg-ink-900 p-5">
      <Brackets size={6} />
      <div className="flex items-center justify-between">
        <span className="fcc-micro">Scenario axis · NIFC acres · projection window · ghost revisions</span>
        <button type="button" onClick={() => setPlay(!play)} className="font-mono text-micro uppercase text-bone-mute hover:text-bone">
          {play ? 'Pause' : 'Play'}
        </button>
      </div>
      <TimelineScrubber
        start={T0}
        end={T1}
        t={t}
        onSeek={setT}
        ticks={ticks}
        series={acres}
        projectionUntil={t + 6 * H}
        marks={[
          { t: T0 + 4 * H, kind: 'perimeter', label: 'Perimeter' },
          { t: T0 + 12 * H, kind: 'perimeter', label: 'Perimeter' },
          { t: T0 + 6 * H, kind: 'ghost', label: 'Projection rev 4' },
          { t: T0 + 9 * H, kind: 'ghost', label: 'Projection rev 5' },
          { t: T0 + 2 * H, kind: 'beat', label: 'Beat 2' },
          { t: T0 + 8 * H, kind: 'event', label: 'Wind shift' },
        ]}
        format={fmt}
      />
      <div className="flex flex-col gap-2">
        <span className="fcc-micro">Compact · command strip</span>
        <TimelineScrubber compact start={T0} end={T1} t={t} onSeek={setT} ticks={ticks} series={acres} projectionUntil={t + 6 * H} format={fmt} className="max-w-[420px]" />
      </div>
    </div>
  );
}

function DecisionDemo() {
  const [status, setStatus] = useState<ConsoleActionStatus>('proposed');
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-2">
        <DecisionCard
          kind="evac-notice"
          title="Evacuation ORDER · Zone EDC-GF-1 (Grizzly Flats)"
          summary="Head reaches Grizzly Flats in about 90 min on the new wind. Order covers 312 structures; routes out via Grizzly Flats Rd to Pollock Pines."
          risk="high"
          status={status}
          audiences={['ic', 'law', 'public']}
          windowLabel="Issue ≤ 10 min · clear ≤ 75 min"
          trigger="+3H band crosses Grizzly Flats Rd"
          units={['LAW-2', 'E-41']}
          drafted="Orchestrator drafted · 12 s ago"
          primary
          onApprove={() => setStatus('approved')}
          onReject={() => setStatus('rejected')}
          onEdit={() => undefined}
          onUndo={() => setStatus('undone')}
          onLocate={() => undefined}
        />
        {status !== 'proposed' && (
          <button type="button" onClick={() => setStatus('proposed')} className="self-start font-mono text-micro uppercase text-bone-mute hover:text-bone">
            Reset
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <DecisionCard
          kind="rescue"
          title="Rescue 2 hikers · Capps Crossing trail"
          summary="M-12 with HAWK-3 overwatch. Approach from the north, outside the +1H band."
          risk="high"
          status="proposed"
          audiences={['ems', 'ops', 'air']}
          windowLabel="Start ≤ 4 min"
          units={['M-12', 'HAWK-3']}
          drafted="Orchestrator drafted · 40 s ago"
          onApprove={() => undefined}
          onReject={() => undefined}
          onEdit={() => undefined}
        />
        <DecisionCard compact kind="resource-order" title="Order 2 Type 1 engines and 1 VLAT" risk="high" status="proposed" onExpand={() => undefined} />
        <DecisionCard compact kind="retask-drone" title="Retask HAWK-5 to the spot fire NE of the head" risk="low" status="executing" onExpand={() => undefined} />
      </div>
    </div>
  );
}

function ToastDemo() {
  const [k, setK] = useState(0);
  return (
    <div className="relative h-[300px] overflow-hidden border border-line bg-ink-950">
      <GridBg variant="lines" />
      <div className="absolute left-4 top-4 flex flex-col gap-2">
        <DirectiveToast
          key={`a${k}`}
          kind="promoteFeed"
          title="Put HAWK-3 · EO/IR GIMBAL on the stage"
          reason="Confirms 2 hikers reported by a social video 14 min ago"
          time="21:04Z"
          ttlMs={8000}
          onUndo={() => undefined}
          onHold={() => undefined}
          onDismiss={() => undefined}
        />
        <DirectiveToast
          key={`b${k}`}
          kind="focusStage"
          suggestion
          title="Move the camera to Grizzly Flats"
          reason="Re-projection: head ETA 92 min"
          time="21:06Z"
          ttlMs={16000}
          onApply={() => undefined}
          onDismiss={() => undefined}
        />
      </div>
      <button type="button" onClick={() => setK(k + 1)} className="absolute bottom-3 right-3 font-mono text-micro uppercase text-bone-mute hover:text-bone">
        Replay
      </button>
    </div>
  );
}

export function ConsoleSpec() {
  const [autonomy, setAutonomy] = useState<ConsoleAutonomy>('assist');
  const [lens, setLens] = useState<ConsoleLens>('ic');
  const [ledger, setLedger] = useState(14.2);
  useEffect(() => {
    if (prefersReduced()) return;
    const id = window.setInterval(() => setLedger((v) => v + 0.3), 2200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <SubSection
      id="system-console"
      index="05.9"
      kicker="Console patterns"
      title="The attention budget, made visible."
      lede="REV C full-screen console vocabulary. Six zones hold everything the Orchestrator shows. Decisions carry their risk and audience; every placement explains itself; the work the agents did is counted."
    >
      <div className="flex flex-col gap-14">
        <div>
          <GroupTitle code="C.1">ZoneTag / Z0–Z5 attention budget</GroupTitle>
          <div className="relative grid grid-cols-1 border border-line bg-ink-900 md:grid-cols-2 xl:grid-cols-3">
            <Brackets size={6} />
            {(Object.keys(zoneMeta) as ConsoleZone[]).map((z) => (
              <div key={z} className="flex flex-col gap-2 border-b border-r border-line-faint p-4">
                <div className="flex items-center justify-between">
                  <ZoneTag zone={z} />
                  <span className="font-mono text-micro uppercase text-bone-mute fcc-num">Cap {zoneMeta[z].capacity}</span>
                </div>
                <span className="text-sm text-bone-dim">{zoneMeta[z].where}.</span>
              </div>
            ))}
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<ZoneTag zone="Z3_FOCUS" showName />'}</code>
        </div>

        <div>
          <GroupTitle code="C.2">DecisionCard / Z2 decision queue</GroupTitle>
          <DecisionDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">
            {'<DecisionCard kind title summary risk status audiences windowLabel trigger units drafted primary compact onApprove onEdit onReject onUndo onLocate />'}
          </code>
        </div>

        <div>
          <GroupTitle code="C.3">WhyPopover / every placement explains itself</GroupTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_1fr]">
            <WhyPopover
              title="2 hikers · Capps Crossing trail"
              score={94}
              factors={factors}
              reason="Life · in +1H band (ETA 42 min) · conf 0.87 · 2 sources · drone task available"
              zone="Z0_INTERRUPT"
              placement="Placed in Z0 because people are inside the +1H band and a live drone confirmed them. EMS and Ops were notified."
            />
            <div className="flex flex-col justify-center gap-3 border border-line bg-ink-900 p-5 text-sm text-bone-dim">
              <code className="font-mono text-tiny text-bone">score = 100 × S × E × C × F × L + corroboration + actionability + novelty − fatigue</code>
              <p>Multipliers scale the base; points nudge it. The final score is clamped to 0–100 and placed by zone with ±5 hysteresis and an 8 s minimum dwell.</p>
              <p className="font-mono text-micro uppercase text-bone-mute">Opens on hover or the sparkle button of a focus card</p>
            </div>
          </div>
        </div>

        <div>
          <GroupTitle code="C.4">AutonomyDial / LensSelect</GroupTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Spec code="<AutonomyDial value onChange />" tag="Full" bodyClassName="items-stretch">
              <AutonomyDial value={autonomy} onChange={setAutonomy} className="w-full" />
            </Spec>
            <Spec code="<AutonomyDial compact />" tag="Strip">
              <AutonomyDial compact value={autonomy} onChange={setAutonomy} />
            </Spec>
            <Spec code="<LensSelect value onChange showKeys />" tag="Lens">
              <LensSelect value={lens} onChange={setLens} />
            </Spec>
          </div>
        </div>

        <div>
          <GroupTitle code="C.5">TimelineScrubber / scenario time</GroupTitle>
          <ScrubberDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<TimelineScrubber start end t onSeek ticks series marks projectionUntil format compact />'}</code>
        </div>

        <div>
          <GroupTitle code="C.6">LedgerCounter / useful work</GroupTitle>
          <div className="relative grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
            <LedgerCounter size="lg" label="Analyst hours saved" value={ledger} format={(v) => v.toFixed(1)} tone="nominal" className="col-span-2 bg-ink-900 p-5" />
            <LedgerCounter label="Footage reviewed" value={Math.round(ledger * 290)} unit="S" className="bg-ink-900 p-5" />
            <LedgerCounter label="Drafts written" value={Math.floor(ledger / 2)} className="bg-ink-900 p-5" />
            <LedgerCounter size="sm" label="Articles" value={Math.round(ledger * 3)} className="bg-ink-900 p-3" />
            <LedgerCounter size="sm" label="Sat passes" value={Math.round(ledger / 3)} className="bg-ink-900 p-3" />
            <LedgerCounter size="sm" label="Radio min" value={Math.round(ledger * 4)} className="bg-ink-900 p-3" />
            <LedgerCounter size="sm" label="Drone tasks" value={Math.round(ledger / 1.5)} className="bg-ink-900 p-3" />
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<LedgerCounter label value unit format size tone sub />'}</code>
        </div>

        <div>
          <GroupTitle code="C.7">DraftDocument / the work, drafted</GroupTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DraftDocument
              format="rescue"
              title="Rescue tasking · 2 hikers, Capps Crossing trail"
              serial="ACT-0007"
              fields={[
                { label: 'Location', value: '38.6231°N 120.5298°W ±60 M' },
                { label: 'Units', value: 'M-12 · HAWK-3' },
                { label: 'Window', value: 'Start ≤ 4 min' },
              ]}
              body={rescueBody}
              editable
              onChange={() => undefined}
              meta="Orchestrator drafted · 12 s ago · high risk"
            />
            <DraftDocument
              format="radio"
              title="Radio script · Division A"
              serial="ACT-0009"
              fields={[{ label: 'Channel', value: 'TAC 2' }]}
              body={'Division A, Caldor IC. Pull back to the Grizzly Flats Rd safety zone now. Head ETA 90 minutes on a 240 wind. Confirm when clear. IC out.'}
            />
          </div>
        </div>

        <div>
          <GroupTitle code="C.8">DirectiveToast / the Orchestrator rearranges the screen</GroupTitle>
          <ToastDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<DirectiveToast kind title reason time suggestion ttlMs onUndo onHold onApply onDismiss />'}</code>
        </div>

        <div>
          <GroupTitle code="C.9">CaptionBar / demo director</GroupTitle>
          <div className="relative flex h-[200px] items-end justify-center overflow-hidden border border-line bg-ink-950 p-6">
            <GridBg variant="dots" />
            <CaptionBar
              className="relative"
              beat={1}
              total={6}
              title="A social video becomes a rescue"
              caption="A vision agent flags two hikers in a social clip. The Orchestrator retasks HAWK-3 to confirm and puts its feed on the stage."
              progress={0.22}
              beatMarks={[0, 0.11, 0.33, 0.55, 0.72, 0.88]}
              onPrev={() => undefined}
              onNext={() => undefined}
              onClose={() => undefined}
            />
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<CaptionBar beat total title caption progress beatMarks onPrev onNext onClose />'}</code>
        </div>

        <div>
          <GroupTitle code="C.10">FireyeMark + FireyeWordmark + OrchestratorAvatar / brand, FCC theme locked</GroupTitle>
          <ThemeDemo />
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<FireyeMark size weight draw state title />  ·  <FireyeWordmark size sub />  ·  <OrchestratorAvatar state size framed />  ·  <AppearanceToggle />  ·  Team tokens retained, not selectable'}</code>
        </div>

        <div>
          <GroupTitle code="C.11">PredictionCheckCard + ProvenanceTag / honest scoring</GroupTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PredictionCheckCard
              status="scored"
              horizonMin={60}
              issued="17:30 EEST"
              target="18:30 EEST"
              iou={0.64}
              areaPred={1180}
              areaActual={1265}
              checkpoints={[
                { id: 'coast', label: 'Coast reached', predicted: '18:24', documented: '18:30', uncertaintyMin: 10, errorMin: -6 },
                { id: 'road', label: 'Main road crossed', predicted: '17:58', documented: '17:40', uncertaintyMin: 10, errorMin: 18 },
              ]}
              method="Wavelet spread on DEM + fuel + hourly wind; no tuning to this fire"
            />
            <div className="flex flex-col gap-3">
              <PredictionCheckCard compact status="pending" horizonMin={180} issued="18:00 EEST" target="21:00 EEST" countdown="42 min" areaPred={2410} />
              <div className="flex flex-wrap items-center gap-2 border border-line bg-ink-900 p-3">
                <ProvenanceTag kind="real" />
                <ProvenanceTag kind="simulated" />
                <ProvenanceTag kind="model" />
                <span className="font-mono text-micro uppercase text-bone-mute">Specimen values, not from a scenario pack</span>
              </div>
            </div>
          </div>
          <code className="mt-2 block font-mono text-micro text-bone-dim">{'<PredictionCheckCard status horizonMin issued target countdown iou areaPred areaActual areaUnit checkpoints method compact />  ·  <ProvenanceTag kind="real|simulated|model" />'}</code>
        </div>
      </div>
    </SubSection>
  );
}

function ThemeDemo() {
  const theme = useTheme();
  return (
    <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-[auto_1fr_1fr]">
      <div className="flex flex-col items-start gap-3 bg-ink-900 p-5">
        <span className="flex items-center gap-4 text-bone">
          <FireyeMark size={40} draw />
          <FireyeWordmark size={22} sub="Incident console" />
        </span>
        <span className="flex items-center gap-2">
          {(['idle', 'listening', 'thinking', 'speaking', 'alert'] as const).map((s) => <OrchestratorAvatar key={s} size={28} framed state={s} />)}
        </span>
        <AppearanceToggle />
        <InstallAppButton />
        <span className="fcc-micro max-w-48 leading-4">Auto follows map daylight in the console. Install opens a standalone app.</span>
      </div>
      {(['fcc', 'team'] as const).map((id) => {
        const t = THEMES[id];
        return (
          <div key={id} className="flex flex-col gap-2 bg-ink-900 p-5">
            <span className="flex items-center gap-2 font-mono text-micro uppercase text-bone-mute">
              <span aria-hidden className={theme === id ? 'h-2 w-2 bg-signal' : 'h-2 w-2 border border-ink-400'} />
              {t.label} {theme === id && <span className="text-bone">· active</span>}
            </span>
            <span className="text-sm text-bone">{t.description}</span>
            <span className="font-mono text-micro uppercase text-bone-mute fcc-num">
              Signal {t.accent.DEFAULT} · warning {t.amber}
            </span>
          </div>
        );
      })}
    </div>
  );
}
