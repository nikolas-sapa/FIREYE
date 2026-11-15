import { isUtc } from '../world/frame-capture';
import type { BridgeViewLite } from '../fireye/data/fleet';

type Row<T> = { incident_revision: number; received_at: string; payload: T };
export interface CrewFrame {
  frame_id: string; feed_id: string; asset_id: string; evidence_id: string; source_snapshot_id: string;
  source_revision: number; capture_owner_id: string; capture_epoch: number; sim_tick: number | null;
  captured_at: string | null; capture_time_status: 'known' | 'unknown'; source_position: {
    coordinate_frame: string; units: string; altitude_datum: string; x: number; y: number; z: number;
  } | null;
  location_uncertainty_m: number | null; mime_type: string; byte_length: number; media_ref: string;
  content_hash: string; width_px: number; height_px: number; media_limits_version: string;
}
export interface CrewHypothesis {
  hypothesis_id: string; kind: 'human' | 'animal' | 'fire' | 'gas_canister' | 'other';
  verification_status: 'unverified'; evidence_ids: string[]; source_snapshot_id: string; input_revision: number;
  geography: { x_m: number; y_m: number; z_m: number } | null; location_uncertainty_m: number | null;
  model_score: { value: number; scale: string } | null; contradictions: string[]; critical: boolean;
}
export interface CrewView extends BridgeViewLite {
  contract_version: 'backend-protocol.v1';
  authority_epoch: number; input_revision: number; plan_revision: number; reservation_revision: number; chief_epoch: number;
  frames: Record<string, Row<CrewFrame>>;
  hypotheses: Record<string, Row<CrewHypothesis>>;
  candidates: readonly { candidate_id: string; asset_id: string; route_id: string; mission_id: string; mission_version: number }[];
}

type Check = (value: unknown) => boolean;
const str: Check = v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\u0000-\u001f]/.test(v);
const text: Check = v => typeof v === 'string' && v.length <= 4096;
const num: Check = v => typeof v === 'number' && Number.isFinite(v);
const uint: Check = v => num(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const bool: Check = v => typeof v === 'boolean';
const eq = (expected: unknown): Check => v => v === expected;
const one = (...values: unknown[]): Check => v => values.includes(v);
const nullable = (check: Check): Check => v => v === null || check(v);
const list = (check: Check, max = 1000): Check => v => Array.isArray(v) && v.length <= max && v.every(check);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const shape = (fields: Record<string, Check>): Check => v => object(v) && Object.entries(fields).every(([key, check]) => Object.prototype.hasOwnProperty.call(v, key) && check(v[key]));
const position = shape({ x_m: num, y_m: num, z_m: num });
const nonnegative: Check = v => num(v) && (v as number) >= 0;
const clock: Check = v => object(v) && ((v.capture_time_status === 'known' && isUtc(v.captured_at))
  || (v.capture_time_status === 'unknown' && v.captured_at === null));
const calibration = nullable(shape({
  calibration_id: str, source_id: str, sensor_id: str, method: str, units: str,
  calibrated_at: nullable(isUtc), verified_source: nullable(str), verification_status: one('verified', 'unverified', 'unknown'),
}));
const feed = shape({
  feed_id: str, asset_id: str, modality: one('thermal', 'eo'), source_kind: one('simulated', 'uploaded', 'live'),
  synthetic: bool, radiometric: one(true, false, 'unknown'), calibration,
  source_id: str, source_revision: uint, capture_owner_id: str, capture_epoch: uint,
  status: one('available', 'paused', 'stale', 'unavailable'),
});
const telemetry: Check = v => clock(v) && shape({
  asset_id: str, mission_id: nullable(str), mission_version: uint, sim_tick: uint,
  position: nullable(position), battery_percent: nullable(v => nonnegative(v) && (v as number) <= 100),
  producer_id: str, capture_epoch: uint,
})(v);
const frame: Check = v => clock(v) && shape({
  frame_id: str, feed_id: str, asset_id: str, evidence_id: str, source_snapshot_id: str,
  source_revision: uint, capture_owner_id: str, capture_epoch: uint, sim_tick: nullable(uint),
  source_position: nullable(shape({ coordinate_frame: str, units: str, altitude_datum: str, x: num, y: num, z: num })),
  location_uncertainty_m: nullable(nonnegative), mime_type: str, byte_length: uint, media_ref: str, content_hash: str,
  width_px: uint, height_px: uint, media_limits_version: str,
})(v);
const hypothesis = shape({
  hypothesis_id: str, kind: one('human', 'animal', 'fire', 'gas_canister', 'other'), verification_status: eq('unverified'),
  evidence_ids: list(str), source_snapshot_id: str, input_revision: uint, geography: nullable(position),
  location_uncertainty_m: nullable(nonnegative), model_score: nullable(shape({ value: num, scale: str })),
  contradictions: list(text), critical: bool,
});
const proposal = shape({
  proposal_id: str, proposal_revision: uint, candidate_ids: list(str), input_revision: uint, plan_revision: uint,
  reservation_revision: uint, chief_epoch: uint, rationale: text, expires_at_sim_tick: uint,
});
const candidate = shape({
  candidate_id: str, action_id: str, asset_id: str, mission_id: str, mission_version: uint, route_id: str,
  plan_revision: uint, feasibility_snapshot_id: str, feasible: bool, expires_at_sim_tick: uint,
});
const command = shape({
  command_id: str, command_version: uint, asset_id: str, mission_id: str, mission_version: uint, approval_id: str,
  proposal_id: str, status: one('enqueued', 'sent', 'delivered', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'rejected'),
});

/** Copies only declared DTO fields, never private top-level objects or unknown nested payloads. */
function pick(value: Record<string, unknown>, keys: string): Record<string, unknown> {
  return Object.fromEntries(keys.split(' ').map(k => [k, value[k]]));
}
const FEED_KEYS = 'feed_id asset_id modality source_kind synthetic radiometric calibration source_id source_revision capture_owner_id capture_epoch status';
const TELEMETRY_KEYS = 'asset_id mission_id mission_version sim_tick position battery_percent producer_id capture_epoch captured_at capture_time_status';
const FRAME_KEYS = 'frame_id feed_id asset_id evidence_id source_snapshot_id source_revision capture_owner_id capture_epoch sim_tick captured_at capture_time_status source_position location_uncertainty_m mime_type byte_length media_ref content_hash width_px height_px media_limits_version';
const HYPOTHESIS_KEYS = 'hypothesis_id kind verification_status evidence_ids source_snapshot_id input_revision geography location_uncertainty_m model_score contradictions critical';
const PROPOSAL_KEYS = 'proposal_id proposal_revision candidate_ids input_revision plan_revision reservation_revision chief_epoch rationale expires_at_sim_tick';
const CANDIDATE_KEYS = 'candidate_id action_id asset_id mission_id mission_version route_id plan_revision feasibility_snapshot_id feasible expires_at_sim_tick';
const COMMAND_KEYS = 'command_id command_version asset_id mission_id mission_version approval_id proposal_id status';

export function parseCrewView(input: unknown, incident: string): CrewView {
  const error = () => new Error('Invalid or unsupported exercise snapshot');
  const v = object(input) && Object.prototype.hasOwnProperty.call(input, 'data') ? input.data : input;
  if (!object(v) || !shape({
    contract_version: eq('backend-protocol.v1'), bridge_version: eq('backend-bridge.v1'), mode: eq('EXERCISE'),
    incident_id: eq(incident), run_id: str, authority_epoch: uint, incident_revision: uint,
    input_revision: uint, plan_revision: uint, reservation_revision: uint, chief_epoch: uint,
    authority_active: bool, as_of_received_at: isUtc, media_verified: eq(false), coordinate_frame: eq(null),
    feeds: list(feed), proposals: list(proposal), candidates: list(candidate), commands: list(command),
  })(v)) throw error();
  const revision = v.incident_revision as number;
  const rows = (raw: unknown, check: Check, key: string, keys: string) => {
    if (!object(raw) || Object.keys(raw).length > 1000) throw error();
    return Object.fromEntries(Object.entries(raw).map(([id, row]) => {
      if (!shape({ incident_revision: uint, received_at: isUtc, payload: check })(row)) throw error();
      const r = row as { incident_revision: number; received_at: string; payload: Record<string, unknown> };
      if (r.incident_revision > revision || Date.parse(r.received_at) > Date.parse(v.as_of_received_at as string) || r.payload[key] !== id) throw error();
      return [id, { incident_revision: r.incident_revision, received_at: r.received_at, payload: pick(r.payload, keys) }];
    }));
  };
  const array = (key: string, idKey: string, keys: string) => {
    const a = v[key] as Record<string, unknown>[];
    if (new Set(a.map(row => row[idKey])).size !== a.length) throw error();
    return a.map(row => pick(row, keys));
  };
  const result = {
    ...pick(v, 'contract_version bridge_version mode incident_id run_id authority_epoch incident_revision input_revision plan_revision reservation_revision chief_epoch authority_active as_of_received_at media_verified coordinate_frame'),
    feeds: array('feeds', 'feed_id', FEED_KEYS),
    telemetry: rows(v.telemetry, telemetry, 'asset_id', TELEMETRY_KEYS),
    frames: rows(v.frames, frame, 'feed_id', FRAME_KEYS),
    hypotheses: rows(v.hypotheses, hypothesis, 'hypothesis_id', HYPOTHESIS_KEYS),
    proposals: array('proposals', 'proposal_id', PROPOSAL_KEYS), candidates: array('candidates', 'candidate_id', CANDIDATE_KEYS),
    commands: array('commands', 'command_id', COMMAND_KEYS),
  } as unknown as CrewView;
  const feeds = new Map(result.feeds.map(f => [f.feed_id, f]));
  const assets = new Set(result.feeds.map(f => f.asset_id));
  for (const row of Object.values(result.telemetry)) if (!assets.has(row.payload.asset_id)) throw error();
  for (const row of Object.values(result.frames)) {
    const registered = feeds.get(row.payload.feed_id);
    if (!registered || registered.asset_id !== row.payload.asset_id) throw error();
  }
  const candidates = new Set(result.candidates.map(c => c.candidate_id));
  if (result.candidates.some(c => !assets.has(c.asset_id)) || result.commands.some(c => !assets.has(c.asset_id))
    || result.proposals.some(p => new Set(p.candidate_ids).size !== p.candidate_ids.length || p.candidate_ids.some(id => !candidates.has(id)))) throw error();
  // Strip any nested extensions as well; the wire may grow, but private fields never become UI state.
  for (const f of result.feeds) {
    const raw = f as unknown as Record<string, unknown>;
    if (raw.calibration) raw.calibration = pick(raw.calibration as Record<string, unknown>, 'calibration_id source_id sensor_id method units calibrated_at verified_source verification_status');
  }
  for (const row of Object.values(result.telemetry)) {
    const payload = row.payload as unknown as Record<string, unknown>;
    if (payload.position) payload.position = pick(payload.position as Record<string, unknown>, 'x_m y_m z_m');
  }
  for (const row of Object.values(result.frames)) {
    if (row.payload.source_position) row.payload.source_position = pick(row.payload.source_position as unknown as Record<string, unknown>, 'coordinate_frame units altitude_datum x y z') as unknown as CrewFrame['source_position'];
  }
  for (const row of Object.values(result.hypotheses)) {
    if (row.payload.geography) row.payload.geography = pick(row.payload.geography as unknown as Record<string, unknown>, 'x_m y_m z_m') as unknown as NonNullable<CrewHypothesis['geography']>;
    if (row.payload.model_score) row.payload.model_score = pick(row.payload.model_score as unknown as Record<string, unknown>, 'value scale') as unknown as NonNullable<CrewHypothesis['model_score']>;
  }
  // Own the complete accepted snapshot; callers cannot mutate canonical received facts through aliases.
  return freeze(JSON.parse(JSON.stringify(result)) as CrewView);
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
