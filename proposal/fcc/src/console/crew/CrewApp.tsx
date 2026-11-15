import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppearanceToggle, Button, FireyeMark, cn } from '@ds';
import { CrewStore, type CrewSnapshot } from '../bus/crew-transport';
import type { CrewView } from '../bus/crew-view';

const EMPTY: CrewSnapshot = { state: 'idle', view: null };
const idle = () => EMPTY;
const subscribe = () => () => {};
const field = 'h-9 min-w-0 border border-line-strong bg-ink-900 px-2 font-mono text-nano text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal';
const micro = 'font-mono text-micro uppercase tracking-[0.12em]';
const stamp = (v: string | null | undefined) => v ?? 'Unknown';

/** Received-only entry: no ConsoleProvider, Runtime, stage truth, Director or approval sink. */
export default function CrewApp() {
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:8787');
  const [incident, setIncident] = useState('i1');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [store, setStore] = useState<CrewStore | null>(null);
  const secret = useRef('');
  const snap = useSyncExternalStore(store?.subscribe ?? subscribe, store?.get ?? idle, store?.get ?? idle);
  useEffect(() => {
    document.title = 'FIREYE · received exercise crew';
    if (!store) return;
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => () => { secret.current = ''; }, []);
  const connect = () => {
    setError('');
    try {
      if (!token.trim()) { setError('Paste a reader capability from the local backend handoff.'); return; }
      const next = new CrewStore({ url: endpoint, incident, token: () => secret.current });
      store?.stop();
      secret.current = token.trim(); setToken(''); setStore(next);
    } catch { setError('Use a loopback bridge origin and a nonempty incident ID.'); }
  };
  return <div className="fcc-console-shell flex min-h-dvh flex-col bg-ink-950 text-bone">
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-900 px-6 py-3">
      <FireyeMark size={20} /><h1 className={micro}>FIREYE / received crew</h1>
      <span className={cn(micro, 'border border-amber/40 px-2 py-1 text-amber')}>Exercise · read only</span>
      <div className="ml-auto"><AppearanceToggle /></div>
      <a href="/console.html" className={cn(micro, 'text-bone-dim underline')}>Separate local simulation</a>
    </header>
    <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6 lg:px-10">
      <form className="flex flex-wrap items-end gap-3 border-b border-line pb-5" onSubmit={e => { e.preventDefault(); connect(); }}>
        <label className={cn(micro, 'flex flex-1 flex-col gap-2 text-bone-mute')}>Loopback bridge
          <input className={field} aria-label="Loopback bridge" value={endpoint} onChange={e => setEndpoint(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className={cn(micro, 'flex w-32 flex-col gap-2 text-bone-mute')}>Incident ID
          <input className={field} value={incident} onChange={e => setIncident(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className={cn(micro, 'flex flex-1 flex-col gap-2 text-bone-mute')}>Reader capability only
          <input className={field} type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <Button type="submit">{store ? 'Reconnect explicitly' : 'Connect reader'}</Button>
        {store && <Button type="button" variant="ghost" onClick={() => { store.stop(); secret.current = ''; }}>Disconnect</Button>}
      </form>
      <p className="py-3 text-sm text-bone-mute">Use the backend’s private local reader handoff, never a Chief or producer capability. Credentials stay in memory. No media, map coordinates, simulator, approvals, or command execution are started here.</p>
      {(error || snap.error) && <p role="alert" className="border-y border-amber/40 py-3 text-sm text-amber">{error || snap.error}</p>}
      <CrewFacts snapshot={snap} />
    </main>
    <footer className={cn(micro, 'border-t border-line px-6 py-3 text-amber')}>Simulated exercise · received facts only · not operational guidance</footer>
  </div>;
}

export function CrewFacts({ snapshot }: { snapshot: CrewSnapshot }) {
  const view = snapshot.view;
  const current = snapshot.state === 'connected';
  const [selected, setSelected] = useState<string | null>(null);
  const identity = view ? `${view.incident_id}/${view.run_id}/${view.authority_epoch}` : '';
  useEffect(() => setSelected(null), [identity]);
  return <div>
    <div role="status" className={cn(micro, 'flex flex-wrap gap-4 border-b border-line py-4', current ? 'text-bone-dim' : 'text-amber')}>
      <span>{snapshot.state === 'frozen' ? 'Authority frozen · last received facts only' : snapshot.state}</span>
      {view && <><span>Revision {view.incident_revision}</span><span>{view.incident_id} / {view.run_id} / epoch {view.authority_epoch}</span><span>Receipt cutoff {view.as_of_received_at}</span></>}
    </div>
    {!view ? <p className="py-12 text-bone-mute">No received snapshot. The crew reader does not fall back to a local simulation.</p> : <>
      <section className="border-b border-line py-5" aria-label="Received feeds">
        <h2 className={cn(micro, 'mb-4 text-bone-dim')}>Registered feeds · media unavailable</h2>
        <div className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
          {view.feeds.map(feed => {
            const frame = view.frames[feed.feed_id];
            const tel = view.telemetry[feed.asset_id];
            return <button type="button" key={feed.feed_id} onClick={() => setSelected(feed.feed_id)}
              aria-pressed={selected === feed.feed_id}
              className={cn('flex min-h-40 flex-col items-start gap-3 bg-ink-900 p-4 text-left focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-signal', selected === feed.feed_id && 'bg-ink-800')}>
              <span className={cn(micro, 'text-bone')}>{feed.asset_id} / {feed.feed_id} / {feed.modality}</span>
              <span className={cn(micro, 'text-amber')}>{feed.synthetic ? 'Synthetic' : feed.source_kind} · {feed.radiometric === false ? 'Non-radiometric' : 'Calibration not verified'}</span>
              <span className={cn(micro, 'text-bone-mute')}>{current ? 'Reported' : 'Last reported'} feed status: {feed.status}</span>
              <span className="text-xs leading-5 text-bone-dim">Frame {frame?.payload.frame_id ?? 'unavailable'}<br />
                Acquired {stamp(frame?.payload.captured_at)}<br />Received {stamp(frame?.received_at)}<br />
                Battery {tel?.payload.battery_percent == null ? 'unknown' : `${tel.payload.battery_percent}%`} · position unmapped
              </span>
            </button>;
          })}
        </div>
        <p className="mt-3 text-xs text-bone-mute">Opaque media references are not fetched. No shared media endpoint or reviewed geographic transform is available. A registered feed is not proof of fresh pixels.</p>
      </section>
      <section className="border-b border-line py-5" aria-label="Received commands">
        <h2 className={cn(micro, 'mb-4 text-bone-dim')}>Command facts · no inferred receipt stages</h2>
        {!view.commands.length && <p className="text-sm text-bone-mute">No received commands.</p>}
        {view.commands.map(command => <div key={command.command_id} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
          <span className={cn(micro, 'text-bone')}>{command.command_id} / v{command.command_version}</span>
          <span className={cn(micro, 'text-bone-dim')}>{command.asset_id} / {command.mission_id}</span>
          <span className={cn(micro, 'ml-auto', ['failed', 'rejected'].includes(command.status) ? 'text-ember' : 'text-bone-dim')}>{command.status}</span>
        </div>)}
        <p className="mt-3 text-xs text-bone-mute">Delivered is not accepted. HTTP success is not completion. No transmission clocks or history are invented from this DTO.</p>
      </section>
      <ReceivedHypotheses view={view} />
      <section className="py-5" aria-label="Review-only proposals">
        <h2 className={cn(micro, 'mb-4 text-bone-dim')}>Received review options · no approval controls</h2>
        {view.proposals.length ? view.proposals.map(p => <p key={p.proposal_id} className="border-t border-line py-3 text-sm text-bone-dim">{p.rationale || p.proposal_id} · {p.candidate_ids.length} finite options · current Chief review required</p>)
          : <p className="text-sm text-bone-mute">No current review options received. Absence does not mean completion.</p>}
      </section>
    </>}
  </div>;
}

function ReceivedHypotheses({ view }: { view: CrewView }) {
  const rows = Object.values(view.hypotheses);
  return <section className="border-b border-line py-5" aria-label="Unverified received hypotheses">
    <h2 className={cn(micro, 'mb-4 text-bone-dim')}>Unverified hypotheses · unresolved critical facts remain visible</h2>
    {!rows.length && <p className="text-sm text-bone-mute">No hypotheses received. This does not establish safety or absence of people.</p>}
    {rows.map(row => <div key={row.payload.hypothesis_id} className="border-t border-line py-3">
      <p className={cn(micro, row.payload.critical ? 'text-ember' : 'text-bone-dim')}>{row.payload.critical ? 'Critical · ' : ''}{row.payload.kind} · unverified · {row.payload.hypothesis_id}</p>
      <p className="mt-2 text-xs text-bone-mute">Evidence: {row.payload.evidence_ids.join(', ') || 'unknown'} · received {row.received_at} · location {row.payload.geography === null ? 'unknown' : 'unmapped'} · score {row.payload.model_score ? `${row.payload.model_score.value} (${row.payload.model_score.scale}, not probability)` : 'unknown'}</p>
      {row.payload.contradictions.map((text, i) => <p key={i} className="mt-1 text-xs text-amber">{text}</p>)}
    </div>)}
  </section>;
}
