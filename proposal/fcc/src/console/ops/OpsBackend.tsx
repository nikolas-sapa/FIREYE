import { useState, useSyncExternalStore } from 'react';
import { Button } from '@ds';
import type { Action } from '../contracts';
import { approveWithBridge, OpsBridge, parseOpsSetup } from '../bus/ops-bridge';

let bridge: OpsBridge | null = null;
let state = { connected: false, configured: false, busy: false, pending: 0, error: '' };
let polling = false;
const listeners = new Set<() => void>();
function set(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
function safeError(error: unknown) { return error instanceof Error ? error.message : 'Exercise bridge request failed'; }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const opsBackend = {
  get: () => state,
  async connect(text: string) {
    if (state.busy || bridge?.pending) throw new Error('Finish the active command before replacing the connection');
    set({ busy: true, error: '' });
    try {
      const next = new OpsBridge(parseOpsSetup(text));
      await next.heartbeat(); await next.snapshot();
      bridge = next;
      set({ connected: true, configured: true });
    } catch (error) { set({ error: safeError(error) }); throw error; }
    finally { set({ busy: false }); }
  },
  disconnect() {
    if (state.busy || polling || bridge?.pending) { set({ error: 'Active command retained; wait for its receipt before disconnecting' }); return; }
    bridge = null; set({ connected: false, configured: false, error: '' });
  },
  async approve(action: Action, execute: () => void, simTick: number) {
    if (state.busy) return;
    set({ busy: true, error: '' });
    try {
      const mode = await approveWithBridge(bridge, action, execute, simTick);
      set({ connected: mode === 'backend', pending: bridge?.pending ?? 0 });
    } catch (error) { set({ error: safeError(error) }); }
    finally { set({ busy: false, pending: bridge?.pending ?? 0 }); }
  },
  async poll(actions: readonly Action[], simTick: number) {
    if (!bridge || polling || state.busy) return;
    polling = true;
    try {
      await bridge.heartbeat();
      await bridge.observe(actions, simTick);
      await bridge.snapshot();
      set({ connected: true, pending: bridge.pending });
    } catch (error) { set({ connected: false, error: safeError(error) }); }
    finally { polling = false; set({ pending: bridge?.pending ?? 0 }); }
  },
};

export function OpsBackendControl() {
  const status = useSyncExternalStore(subscribe, opsBackend.get);
  const [open, setOpen] = useState(false);
  const [handoff, setHandoff] = useState('');
  const connect = async () => {
    const text = handoff; setHandoff('');
    try { await opsBackend.connect(text); setOpen(false); } catch { /* Safe error remains visible. */ }
  };
  return <div className="relative shrink-0 font-sans">
    <button type="button" className="whitespace-nowrap font-mono text-micro text-bone-dim hover:text-bone" onClick={() => setOpen(!open)}>
      {status.connected ? 'Backend connected (EXERCISE)' : 'Backend offline · local simulation'}
      {status.pending > 0 && <span className="ml-2 text-bone">{status.pending} approved command active</span>}
    </button>
    {status.error && <p role="alert" className="absolute left-0 top-8 z-hud w-80 border border-line bg-ink-950 p-2 text-xs text-bone">{status.error}</p>}
    {open && <section aria-label="Connect exercise backend" className="absolute left-0 top-8 z-hud w-96 border border-line-strong bg-ink-950 p-3 text-xs text-bone">
      <p className="mb-2">Local simulation only. Paste the private capabilities.json handoff. Chief and producer capabilities stay in memory, never in URLs or storage.</p>
      <p className="mb-2 text-bone-dim">Approvals bind the same drone to a declared exercise fixture candidate. Completion registers a synthetic execution-status image, not camera/media registration. Fixture routes are not validated geographic routes. Keep this tab visible for producer heartbeats; background suspension freezes authority.</p>
      <label className="block">Private handoff
        <textarea aria-label="Private backend handoff" autoComplete="off" spellCheck={false} value={handoff} onChange={e => setHandoff(e.target.value)}
          className="mt-1 h-24 w-full border border-line bg-ink-900 p-2 font-mono text-bone" />
      </label>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={status.busy} onClick={() => void connect()}>Connect</Button>
        <Button size="sm" variant="secondary" disabled={status.busy} onClick={() => { opsBackend.disconnect(); setHandoff(''); }}>Disconnect</Button>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setHandoff(''); }}>Close</Button>
      </div>
    </section>}
  </div>;
}
