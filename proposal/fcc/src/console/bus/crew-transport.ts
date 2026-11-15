import { parseCrewView, type CrewView } from './crew-view';

export interface CrewSnapshot {
  readonly state: 'idle' | 'connecting' | 'connected' | 'frozen' | 'error' | 'disconnected';
  readonly view: CrewView | null;
  readonly error?: string;
}
export interface CrewOptions {
  url?: string; incident: string; token: () => string | null; fetchImpl?: typeof fetch; retryMs?: number;
}
class CrewError extends Error {
  constructor(message: string, readonly terminal = false) { super(message); }
}
const MAX_REPLY_BYTES = 2 * 1024 * 1024;
const FACTS = ['feeds', 'telemetry', 'frames', 'hypotheses', 'commands', 'authority_active', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch'] as const;

/** Read-only received store. It has no Runtime, bus mutation, approval, media-fetch or execution API. */
export class CrewStore {
  private snapshot: CrewSnapshot = { state: 'idle', view: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private running = false;
  private controller: AbortController | null = null;
  private pending: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly url: string;

  constructor(private readonly options: CrewOptions) {
    const u = new URL(options.url ?? 'http://127.0.0.1:8787');
    if (!['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
      || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Exercise bridge must be a loopback origin');
    if (!options.incident || options.incident.length > 256 || /[\u0000-\u001f]/.test(options.incident)) throw new Error('Invalid exercise incident ID');
    this.url = u.origin;
  }
  get = (): CrewSnapshot => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(snapshot: CrewSnapshot) { this.snapshot = Object.freeze(snapshot); for (const fn of this.listeners) fn(); }

  start() {
    if (this.running) return;
    this.running = true;
    this.set({ ...this.snapshot, state: 'connecting', error: undefined });
    void this.loop(this.generation);
  }
  stop() {
    this.running = false; this.generation++;
    clearTimeout(this.timer); this.timer = undefined;
    this.controller?.abort();
    this.set({ ...this.snapshot, state: 'disconnected', error: undefined });
  }
  private async loop(generation: number): Promise<void> {
    let delay = 250;
    try { await this.pollOnce(); }
    catch (e) {
      if (e instanceof CrewError && e.terminal) { this.running = false; return; }
      delay = Math.max(250, this.options.retryMs ?? 4000);
    }
    if (this.running && generation === this.generation) this.timer = setTimeout(() => { void this.loop(generation); }, delay);
  }

  /** At most one request/reader. after_revision always uses last accepted revision, including after errors. */
  pollOnce(waitMs = 10000): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!Number.isFinite(waitMs) || waitMs < 0) return Promise.reject(new CrewError('Invalid exercise poll wait'));
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const work = this.request(controller, generation, Math.max(0, Math.min(10000, Math.floor(waitMs))));
    let pending: Promise<boolean>;
    pending = work.finally(() => {
      if (this.pending === pending) this.pending = null;
      if (this.controller === controller) this.controller = null;
    });
    this.pending = pending;
    return pending;
  }

  private async request(controller: AbortController, generation: number, waitMs: number): Promise<boolean> {
    const timer = setTimeout(() => controller.abort(), waitMs + 3000);
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new CrewError(generation !== this.generation ? 'Exercise reader stopped' : 'Exercise bridge unavailable; request timed out'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const changed = await Promise.race([this.read(controller.signal, waitMs), aborted]);
      if (generation !== this.generation || controller.signal.aborted) throw new CrewError('Exercise reader stopped');
      const old = this.snapshot.view;
      if (!changed) {
        if (!old) throw new CrewError('Exercise bridge returned no initial snapshot');
        this.set({ state: old.authority_active ? 'connected' : 'frozen', view: old });
        return false;
      }
      if (old) {
        if (old.run_id !== changed.run_id || old.authority_epoch !== changed.authority_epoch) throw new CrewError('Exercise identity changed; explicitly reconnect to the new run', true);
        if (changed.incident_revision < old.incident_revision) throw new CrewError('Exercise revision regressed; last received facts retained');
        if (changed.incident_revision === old.incident_revision && FACTS.some(k => JSON.stringify(old[k]) !== JSON.stringify(changed[k]))) throw new CrewError('Conflicting facts at the same exercise revision', true);
        if (Object.values(old.hypotheses).some(row => row.payload.critical && !changed.hypotheses[row.payload.hypothesis_id]?.payload.critical)) throw new CrewError('Unresolved critical evidence disappeared; last received facts retained', true);
      }
      this.set({ state: changed.authority_active ? 'connected' : 'frozen', view: changed });
      return true;
    } catch (error) {
      const safe = error instanceof CrewError ? error : new CrewError('Exercise bridge unavailable or invalid snapshot; last received facts retained');
      if (generation === this.generation) this.set({ ...this.snapshot, state: 'error', error: safe.message });
      throw safe;
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
    }
  }

  private async read(signal: AbortSignal, waitMs: number): Promise<CrewView | null> {
    let token: string | null;
    try { token = this.options.token(); } catch { throw new CrewError('Reader capability unavailable; reconnect explicitly', true); }
    if (!token || token.length > 8192 || /\s/.test(token)) throw new CrewError('Reader capability required; reconnect explicitly', true);
    const view = this.snapshot.view;
    const query = view ? `?after_revision=${view.incident_revision}&wait_ms=${waitMs}` : '';
    const response = await (this.options.fetchImpl ?? fetch)(`${this.url}/incidents/${encodeURIComponent(this.options.incident)}/snapshot${query}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal,
      redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (response.status === 401 || response.status === 403) throw new CrewError('Reader capability expired or denied; reconnect explicitly', true);
    if (response.status === 409) throw new CrewError('Exercise cursor or authority changed; reconnect explicitly', true);
    if (response.status === 204) return null;
    if (!response.ok) throw new CrewError(`Exercise bridge HTTP ${response.status}; last received facts retained`);
    if (Number(response.headers.get('content-length')) > MAX_REPLY_BYTES) throw new CrewError('Exercise snapshot exceeds local reader limits');
    const reader = response.body?.getReader();
    if (!reader) throw new CrewError('Exercise snapshot unavailable');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (signal.aborted) throw new CrewError('Exercise reader stopped');
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_REPLY_BYTES) throw new CrewError('Exercise snapshot exceeds local reader limits');
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseCrewView(JSON.parse(new TextDecoder().decode(bytes)), this.options.incident);
  }
}
