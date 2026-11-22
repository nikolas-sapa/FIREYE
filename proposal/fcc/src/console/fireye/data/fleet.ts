import type { ConsoleState, Geo, Ms, ScenarioPack } from '../../contracts';
import type { ChronicleEntry } from './types';
import { CrewStore, type CrewOptions } from '../../bus/crew-transport';
import { cellToGeo } from '../../scenario';
import { planDispatch, toLocalKm, windVector, type DispatchBase } from '../../../sim/dispatch';

/* ------------------------------------------------------------------ mirrored backend shapes (backend-protocol.v1) */

/** Mirrors backend/protocol/types.ts (review/pr-35). Read-only; the console never writes commands. */
export type FeedStatus = 'available' | 'paused' | 'stale' | 'unavailable';
export type ReceiptStage = 'sent' | 'delivered' | 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected';
export type CommandStatus = 'enqueued' | ReceiptStage;
export const COMMAND_FLOW: readonly CommandStatus[] = ['enqueued', 'sent', 'delivered', 'accepted', 'running', 'completed'];
export const COMMAND_TERMINAL: readonly CommandStatus[] = ['completed', 'failed', 'cancelled', 'rejected'];
export type AssessmentStatus = 'assessing' | 'review_ready' | 'review_only' | 'proposed' | 'approved' | 'superseded';
export type RankingSource = 'validated-ranking' | 'deterministic-fallback';
/** Runtime lists of the mirrored unions, kept in backend order for contract checks. */
export const FEED_STATUSES = ['available', 'paused', 'stale', 'unavailable'] as const satisfies readonly FeedStatus[];
export const RECEIPT_STAGES = ['sent', 'delivered', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'rejected'] as const satisfies readonly ReceiptStage[];
export const ASSESSMENT_STATUSES = ['assessing', 'review_ready', 'review_only', 'proposed', 'approved', 'superseded'] as const satisfies readonly AssessmentStatus[];

export interface BridgeAsset {
  readonly asset_id: string;
  readonly capabilities: readonly ('thermal' | 'eo')[];
  readonly thermal_feed_id: string;
  readonly eo_feed_id?: string;
}
export interface BridgeFeed {
  readonly feed_id: string;
  readonly asset_id: string;
  readonly modality: 'thermal' | 'eo';
  readonly source_kind: 'simulated' | 'uploaded' | 'live';
  readonly synthetic: boolean;
  readonly radiometric: boolean | 'unknown';
  readonly status: FeedStatus;
}
export interface BridgeTelemetry {
  readonly asset_id: string;
  readonly mission_id: string | null;
  readonly mission_version: number;
  readonly sim_tick: number;
  readonly position: { x_m: number; y_m: number; z_m: number } | null;
  readonly battery_percent: number | null;
}
export interface BridgeCommand {
  readonly command_id: string;
  readonly command_version: number;
  readonly asset_id: string;
  readonly mission_id: string;
  readonly mission_version: number;
  readonly approval_id: string;
  readonly proposal_id: string;
  readonly status: CommandStatus;
}
export interface BridgeViewLite {
  readonly bridge_version: 'backend-bridge.v1';
  readonly mode: 'EXERCISE';
  readonly incident_id: string;
  readonly run_id: string;
  readonly incident_revision: number;
  readonly authority_active: boolean;
  readonly as_of_received_at: string;
  readonly media_verified: false;
  readonly coordinate_frame: null;
  readonly feeds: readonly BridgeFeed[];
  readonly telemetry: Readonly<Record<string, { incident_revision: number; received_at: string; payload: BridgeTelemetry }>>;
  readonly proposals: readonly { proposal_id: string; rationale: string; candidate_ids: readonly string[] }[];
  readonly commands: readonly BridgeCommand[];
}

/* ------------------------------------------------------------------ console fleet view */

export interface FleetCommand { id: string; label: string; status: CommandStatus; at: Ms; version: number }

export interface FleetAsset {
  asset_id: string;
  callsign: string;
  capabilities: ('thermal' | 'eo')[];
  thermal_feed_id: string;
  eo_feed_id?: string;
  /** Console feed rendered for this asset (sim only). */
  feedId?: string;
  unitId?: string;
  feed_status: FeedStatus;
  battery_percent: number | null;
  mission_id: string | null;
  mission_version: number | null;
  /** Null = the source has no map frame ("position unmapped"). */
  position: Geo | null;
  headingDeg: number | null;
  altM: number | null;
  speedMps: number | null;
  task: string;
  command: FleetCommand | null;
}
export interface FleetAssessment {
  id: string;
  label: string;
  status: AssessmentStatus;
  ranking_source: RankingSource;
  note: string;
}
export interface FleetProvider { id: string; label: string; status: 'simulated' | 'not connected' | 'connected' }

export interface FleetSnapshot {
  source: 'sim' | 'bridge';
  state: 'live' | 'connecting' | 'error' | 'idle' | 'frozen' | 'disconnected';
  mode: 'EXERCISE';
  revision: number;
  receivedAt: string | null;
  error?: string;
  assets: FleetAsset[];
  assessments: FleetAssessment[];
  providers: FleetProvider[];
}

export interface FleetSource {
  readonly kind: 'sim' | 'bridge';
  get(): FleetSnapshot;
  subscribe(fn: () => void): () => void;
  start(): void;
  stop(): void;
}

export const PROVIDERS: FleetProvider[] = [
  { id: 'vision', label: 'Vision analysis', status: 'not connected' },
  { id: 'reasoning', label: 'Reasoning model', status: 'not connected' },
  { id: 'scrape', label: 'Web intake', status: 'simulated' },
  { id: 'radio', label: 'Radio transcription', status: 'simulated' },
  { id: 'iot', label: 'IoT mesh', status: 'simulated' },
];

/* ------------------------------------------------------------------ sim adapter */

const ASSET_OF = (unitId: string) => `d${unitId.split('-')[1] ?? unitId}`;

/** Command status at t from a scripted fleet entry's receipts (latest stage at or before t). */
export function commandAt(e: ChronicleEntry, t: Ms): FleetCommand | null {
  const c = e.command;
  if (!c) return null;
  let cur: { status: CommandStatus; t: Ms } | null = null;
  for (const s of c.steps) if (s.t <= t) cur = s;
  return cur ? { id: c.id, label: c.label, status: cur.status, at: cur.t, version: c.version } : null;
}

/** Centroid of cells ignited so far, or null when nothing has burned at t. */
function fireCentroid(pack: ScenarioPack, t: Ms): Geo | null {
  const rel = t - pack.manifest.start;
  const { w, h } = pack.raster;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w; x < w; x++, i++) {
      if (pack.arrival[i]! <= rel) { sx += x; sy += y; n++; }
    }
  }
  return n ? cellToGeo(pack, sx / n, sy / n) : null;
}

/** Hourly weather row in effect at t (latest sample at or before t). */
function hourlyWeatherAt(pack: ScenarioPack, t: Ms) {
  let best = pack.weather[0];
  for (const w of pack.weather) {
    if (w.t <= t) best = w;
    else break;
  }
  return best;
}

/**
 * Fleet view of the running replay. Positions come from the simulation; commands come from the
 * deterministic chronicle (and the user's approvals), so they are identical after any scrub.
 */
export function simFleet(state: Pick<ConsoleState, 'clock' | 'pack' | 'units' | 'feeds' | 'projection' | 'predictions' | 'actions' | 'recon'>, fleetLog: ChronicleEntry[]): FleetSnapshot {
  const t = state.clock.t;
  const latest = new Map<string, ChronicleEntry>();
  for (const e of fleetLog) {
    if (e.t > t || !e.command) continue;
    latest.set(e.command.asset, e);
  }
  const assets: FleetAsset[] = state.units.filter((u) => u.kind === 'drone').map((u) => {
    const id = ASSET_OF(u.id);
    const feed = state.feeds.find((f) => f.unitId === u.id);
    const channels = state.feeds.filter(f => f.unitId === u.id && f.modality);
    const ir = !!feed && feed.fx !== 'eo';
    const entry = latest.get(id);
    const cmd = entry ? commandAt(entry, t) : null;
    const battery = u.battery != null ? Math.round(u.battery * 100) : null;
    const rtb = u.status === 'rtb';
    return {
      asset_id: id,
      callsign: u.callsign,
      capabilities: [...new Set(channels.map(f => f.modality!))],
      thermal_feed_id: channels.find(f => f.modality === 'thermal')?.id ?? '',
      eo_feed_id: channels.find(f => f.modality === 'eo')?.id,
      feedId: feed?.id,
      unitId: u.id,
      feed_status: !feed ? 'unavailable' : rtb ? 'paused' : feed.live ? 'available' : 'stale',
      battery_percent: battery,
      mission_id: entry?.command ? entry.command.mission : `m-${id}-patrol`,
      mission_version: entry?.command ? entry.command.version : 1,
      position: { lon: u.pos.lon, lat: u.pos.lat, alt: u.pos.alt },
      headingDeg: u.heading,
      altM: u.pos.alt ?? null,
      speedMps: u.speedMps,
      task: cmd && !COMMAND_TERMINAL.includes(cmd.status) ? cmd.label : rtb ? 'Return to base' : ir ? 'Thermal patrol' : 'EO patrol',
      command: cmd,
    };
  });
  const assessments: FleetAssessment[] = [];
  if (state.projection) {
    assessments.push({
      id: `proj-${state.projection.rev}`, label: `Spread projection rev ${state.projection.rev}`,
      status: 'review_only', ranking_source: 'deterministic-fallback',
      note: 'Toy estimate. Minimum travel time on DEM, fuel and hourly wind.',
    });
  }
  const stations = state.recon?.stations;
  const fire = state.pack ? fireCentroid(state.pack, t) : null;
  const wx = state.pack ? hourlyWeatherAt(state.pack, t) : undefined;
  if (stations?.length && fire && wx) {
    const origin = state.pack!.manifest.center;
    const point = toLocalKm(origin, fire);
    const bases: DispatchBase[] = stations.map((s) => ({ id: s.id, ...toLocalKm(origin, s.pos), available: true }));
    const windMps = windVector(wx.windKph, wx.windDirDeg);
    const dispatch = planDispatch(point, bases, { windMps });
    const station = dispatch.selectedBaseId ? stations.find((s) => s.id === dispatch.selectedBaseId) : undefined;
    const windKph = Math.round(wx.windKph);
    const note = dispatch.status === 'served' && station && dispatch.responseS != null
      ? `${station.name} · arrival ${(dispatch.responseS / 60).toFixed(1)} min · ${dispatch.within15min ? 'within 15 min' : 'over 15 min'} · wind ${windKph} km/h. Synthetic wildfire-sweep model, not flight authorization.`
      : `No eligible station (${dispatch.status.replace(/_/g, ' ')}) · wind ${windKph} km/h. Synthetic wildfire-sweep model, not flight authorization.`;
    assessments.push({
      id: `dispatch-${state.projection?.rev ?? Math.floor(t / 60000)}`, label: 'Dispatch check',
      status: 'review_only', ranking_source: 'deterministic-fallback',
      note,
    });
  }
  for (const p of (state.predictions ?? []).slice(0, 2)) {
    assessments.push({
      id: p.id, label: `Check +${p.horizonMin} min`,
      status: p.status === 'pending' ? 'assessing' : 'superseded', ranking_source: 'deterministic-fallback',
      note: p.status === 'scored' && p.iou != null ? `Overlap with reconstruction ${Math.round(p.iou * 100)} %` : 'Awaiting target time',
    });
  }
  const proposed = state.actions.filter((a) => a.status === 'proposed' && a.requiresApproval).slice(0, 2);
  for (const a of proposed) {
    assessments.push({ id: a.id, label: a.title, status: 'proposed', ranking_source: 'deterministic-fallback', note: 'Needs a human approval' });
  }
  return { source: 'sim', state: 'live', mode: 'EXERCISE', revision: Math.floor(t / 1000), receivedAt: null, assets, assessments, providers: PROVIDERS };
}

/* ------------------------------------------------------------------ bridge adapter */

/** Pure mapping from a received bridge view to the fleet snapshot. Assets are joined from feeds[].asset_id. */
export function fromBridge(v: BridgeViewLite): FleetSnapshot {
  const ids = [...new Set(v.feeds.map((f) => f.asset_id))].sort();
  const assets: FleetAsset[] = ids.map((id) => {
    const feeds = v.feeds.filter((f) => f.asset_id === id);
    const thermal = feeds.find((f) => f.modality === 'thermal');
    const eo = feeds.find((f) => f.modality === 'eo');
    const tel = v.telemetry[id]?.payload;
    const cmds = v.commands.filter((c) => c.asset_id === id).sort((a, b) => b.command_version - a.command_version);
    const c = cmds[0];
    const rank: FeedStatus[] = ['available', 'paused', 'stale', 'unavailable'];
    const status = feeds.reduce<FeedStatus>((best, f) => (rank.indexOf(f.status) < rank.indexOf(best) ? f.status : best), 'unavailable');
    return {
      asset_id: id,
      callsign: id.toUpperCase(),
      capabilities: [...new Set(feeds.map((f) => f.modality))],
      thermal_feed_id: thermal?.feed_id ?? '',
      eo_feed_id: eo?.feed_id,
      feed_status: status,
      battery_percent: tel?.battery_percent ?? null,
      mission_id: tel?.mission_id ?? c?.mission_id ?? null,
      mission_version: tel?.mission_version ?? c?.mission_version ?? null,
      // coordinate_frame is null: backend positions are not map coordinates.
      position: null,
      headingDeg: null,
      altM: null,
      speedMps: null,
      task: c ? `Mission ${c.mission_id} v${c.mission_version}` : 'No command',
      command: c ? { id: c.command_id, label: `Mission ${c.mission_id}`, status: c.status, at: 0, version: c.command_version } : null,
    };
  });
  const assessments: FleetAssessment[] = v.proposals.map((p) => ({
    id: p.proposal_id, label: p.rationale || p.proposal_id, status: 'proposed', ranking_source: 'deterministic-fallback',
    note: `${p.candidate_ids.length} candidate${p.candidate_ids.length === 1 ? '' : 's'} · Chief approval required`,
  }));
  return {
    source: 'bridge', state: v.authority_active ? 'live' : 'frozen', mode: 'EXERCISE', revision: v.incident_revision, receivedAt: v.as_of_received_at,
    assets, assessments, providers: PROVIDERS.map((p) => ({ ...p, status: 'not connected' as const })),
  };
}

export const BRIDGE_DEFAULT_URL = 'http://127.0.0.1:8787';

/**
 * Long-polls the exercise bridge with a caller-supplied memory-only reader capability. The console only
 * reads; chief and producer credentials are never bundled or requested.
 */
export class BridgeFleetSource implements FleetSource {
  readonly kind = 'bridge' as const;
  private snap: FleetSnapshot = { source: 'bridge', state: 'idle', mode: 'EXERCISE', revision: 0, receivedAt: null, assets: [], assessments: [], providers: PROVIDERS };
  private listeners = new Set<() => void>();
  private readonly reader: CrewStore;

  constructor(opts: CrewOptions) {
    this.reader = new CrewStore(opts);
    this.reader.subscribe(() => {
      const received = this.reader.get();
      this.snap = {
        ...(received.view ? fromBridge(received.view) : this.snap),
        state: received.state === 'connected' ? 'live' : received.state,
        error: received.error,
      };
      for (const fn of this.listeners) fn();
    });
  }

  get = () => this.snap;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  start() { this.reader.start(); }
  stop() { this.reader.stop(); }

  /** One request. Exposed for tests. Returns false when there was nothing new (204). */
  pollOnce(waitMs = 10000) { return this.reader.pollOnce(waitMs); }
}
