import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { Position, Result } from '../protocol/types.ts';
import type {
  MissionCapability, MissionDrone, MissionEvidence, MissionExclusion, MissionExclusionReason,
  MissionFeed, MissionLease, MissionPlan, MissionPlanningContext, MissionPlanningSnapshot,
  MissionSector, ProposedMissionAssignment, ProposedMissionOption, ToyMissionPolicy, ToyRectangle,
} from './mission-types.ts';

type Guard<T> = (input: unknown) => input is T;
type Template = 'coverage_x' | 'coverage_y';
const reject = (reason: string, code: 'INVALID_SCHEMA' | 'STALE_VERSION' | 'EXPIRED' | 'CONFLICT' | 'FROZEN' = 'INVALID_SCHEMA'): Result<never> =>
  Object.freeze({ ok: false, code, reason });
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 128 && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const scalar = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1_000_000;
const coordinate = (value: unknown): value is number => finite(value) && Math.abs(value) <= 1_000_000;
const tick = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const capability = (value: unknown): value is MissionCapability => value === 'thermal' || value === 'eo';
const sourceKind = (value: unknown): boolean => value === 'simulated' || value === 'uploaded' || value === 'live';

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Fail before guards read properties: reject proxies, accessors, cycles, exotic
 * prototypes, sparse/custom arrays and bounded-depth/size violations. Never
 * invoke a caller getter/proxy trap. Shared DAGs are visited only once.
 */
function plainJson(value: unknown, active = new WeakSet<object>(), completed = new WeakSet<object>(),
  budget = { nodes: 0 }, depth = 0): boolean {
  if (++budget.nodes > 4096 || depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 128;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || types.isProxy(value) || active.has(value)) return false;
  if (completed.has(value)) return true;
  const array = Array.isArray(value); const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64 || (array && (value.length > 16 || keys.length !== value.length + 1))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  active.add(value);
  for (const key of keys) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) return false;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) return false;
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) return false;
    if (!plainJson(descriptor.value, active, completed, budget, depth + 1)) return false;
  }
  active.delete(value); completed.add(value); return true;
}

function list<T>(value: unknown, guard: Guard<T>, max = 16): value is readonly T[] {
  return Array.isArray(value) && value.length <= max && value.every(guard);
}

function ids(value: unknown): value is readonly string[] {
  return list(value, id) && new Set(value).size === value.length;
}

function capabilities(value: unknown): value is readonly MissionCapability[] {
  return list(value, capability, 2) && new Set(value).size === value.length;
}

function rectangle(value: unknown): value is ToyRectangle {
  return closed(value, ['min_x_m', 'max_x_m', 'min_y_m', 'max_y_m'])
    && coordinate(value.min_x_m) && coordinate(value.max_x_m)
    && coordinate(value.min_y_m) && coordinate(value.max_y_m)
    && value.min_x_m < value.max_x_m && value.min_y_m < value.max_y_m;
}

function position(value: unknown): value is Position {
  return closed(value, ['x_m', 'y_m', 'z_m']) && coordinate(value.x_m)
    && coordinate(value.y_m) && coordinate(value.z_m);
}

function source(value: Record<string, unknown>): boolean {
  return id(value.source_id) && sourceKind(value.source_kind)
    && boolean(value.synthetic) && (value.source_kind !== 'simulated' || value.synthetic === true);
}

function evidence(value: unknown): value is MissionEvidence {
  return closed(value, ['evidence_id', 'source_snapshot_id', 'source_id', 'source_kind', 'synthetic',
    'captured_at_sim_tick', 'received_at_sim_tick']) && id(value.evidence_id) && id(value.source_snapshot_id)
    && source(value) && tick(value.received_at_sim_tick) && (value.captured_at_sim_tick === null
      || tick(value.captured_at_sim_tick) && value.captured_at_sim_tick <= value.received_at_sim_tick);
}

function feed(value: unknown): value is MissionFeed {
  return closed(value, ['feed_id', 'modality', 'status', 'source_id', 'source_kind', 'synthetic'])
    && id(value.feed_id) && capability(value.modality) && source(value)
    && (value.status === 'available' || value.status === 'paused' || value.status === 'stale' || value.status === 'unavailable');
}

function drone(value: unknown): value is MissionDrone {
  if (!(closed(value, ['drone_id', 'position', 'home', 'capabilities', 'feeds', 'reserve_units', 'link_available'])
    && id(value.drone_id) && position(value.position) && position(value.home)
    && capabilities(value.capabilities) && list(value.feeds, feed, 2)
    && new Set(value.feeds.map(item => item.feed_id)).size === value.feeds.length
    && new Set(value.feeds.map(item => item.modality)).size === value.feeds.length
    && scalar(value.reserve_units) && boolean(value.link_available))) return false;
  const declared = value.capabilities;
  return value.feeds.every(item => declared.includes(item.modality));
}

function sector(value: unknown): value is MissionSector {
  return closed(value, ['sector_id', 'bounds', 'coverage_age_ticks', 'evidence_ids'])
    && id(value.sector_id) && rectangle(value.bounds) && tick(value.coverage_age_ticks) && ids(value.evidence_ids);
}

function lease(value: unknown): value is MissionLease {
  return closed(value, ['lease_id', 'drone_id', 'sector_id', 'expires_at_sim_tick'])
    && id(value.lease_id) && id(value.drone_id) && id(value.sector_id) && tick(value.expires_at_sim_tick);
}

function policy(value: unknown): value is ToyMissionPolicy {
  return closed(value, ['model', 'snapshot_max_age_ticks', 'intent_ttl_ticks', 'route_speed_m_per_tick',
    'energy_units_per_m', 'minimum_reserve_units', 'wind_m_per_tick', 'max_wind_m_per_tick',
    'separation_m', 'coverage_altitude_m']) && value.model === 'toy-scalar.v1'
    && tick(value.snapshot_max_age_ticks) && tick(value.intent_ttl_ticks) && value.intent_ttl_ticks > 0
    && scalar(value.route_speed_m_per_tick) && value.route_speed_m_per_tick > 0
    && scalar(value.energy_units_per_m) && scalar(value.minimum_reserve_units)
    && scalar(value.wind_m_per_tick) && scalar(value.max_wind_m_per_tick)
    && scalar(value.separation_m) && coordinate(value.coverage_altitude_m);
}

function snapshot(value: unknown): value is MissionPlanningSnapshot {
  if (!closed(value, ['snapshot_id', 'incident_id', 'run_id', 'input_revision', 'observed_at_sim_tick',
    'intent_id', 'intent_created_at_sim_tick', 'objective', 'approved_region', 'sectors', 'drones',
    'evidence', 'active_leases', 'blocked_areas', 'policy'])) return false;
  if (!id(value.snapshot_id) || !id(value.incident_id) || !id(value.run_id) || !tick(value.input_revision)
    || !tick(value.observed_at_sim_tick) || !id(value.intent_id) || !tick(value.intent_created_at_sim_tick)
    || !closed(value.objective, ['objective_id', 'capture_goal', 'required_capabilities'])
    || !id(value.objective.objective_id) || value.objective.capture_goal !== 'refresh_coverage'
    || !capabilities(value.objective.required_capabilities) || value.objective.required_capabilities.length === 0
    || !rectangle(value.approved_region) || !list(value.sectors, sector, 3) || !list(value.drones, drone, 3)
    || !list(value.evidence, evidence) || !list(value.active_leases, lease)
    || !list(value.blocked_areas, rectangle) || !policy(value.policy)) return false;
  const droneIds = new Set(value.drones.map(item => item.drone_id));
  const sectorIds = new Set(value.sectors.map(item => item.sector_id));
  const evidenceIds = new Set(value.evidence.map(item => item.evidence_id));
  const feeds = value.drones.flatMap(item => item.feeds);
  const observed = value.observed_at_sim_tick;
  return droneIds.size === value.drones.length && sectorIds.size === value.sectors.length
    && evidenceIds.size === value.evidence.length && new Set(feeds.map(item => item.feed_id)).size === feeds.length
    && new Set(value.active_leases.map(item => item.lease_id)).size === value.active_leases.length
    && value.sectors.every(item => item.evidence_ids.every(evidenceId => evidenceIds.has(evidenceId)))
    && value.evidence.every(item => item.received_at_sim_tick <= observed);
}

function context(value: unknown): value is MissionPlanningContext {
  return closed(value, ['incident_id', 'run_id', 'input_revision', 'current_sim_tick', 'mode', 'used_intent_ids'])
    && id(value.incident_id) && id(value.run_id) && tick(value.input_revision) && tick(value.current_sim_tick)
    && (value.mode === 'live' || value.mode === 'replay' || value.mode === 'offline') && ids(value.used_intent_ids);
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

// Canonical JSON preserves types and escapes delimiters/Unicode, avoiding tuple
// concatenation ambiguity. SHA-256 bounds proposed IDs, not signatures/authenticity.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compare).map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function identity(kind: string, value: unknown): string {
  return `proposed:${kind}:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function normalized(input: MissionPlanningSnapshot): MissionPlanningSnapshot {
  return { ...input, objective: { ...input.objective, required_capabilities: [...input.objective.required_capabilities].sort(compare) },
    drones: [...input.drones].sort((a, b) => compare(a.drone_id, b.drone_id)).map(item => ({ ...item,
      capabilities: [...item.capabilities].sort(compare), feeds: [...item.feeds].sort((a, b) => compare(a.feed_id, b.feed_id)) })),
    sectors: [...input.sectors].sort((a, b) => compare(a.sector_id, b.sector_id)).map(item => ({ ...item, evidence_ids: [...item.evidence_ids].sort(compare) })),
    evidence: [...input.evidence].sort((a, b) => compare(a.evidence_id, b.evidence_id)),
    active_leases: [...input.active_leases].sort((a, b) => compare(a.lease_id, b.lease_id)),
    blocked_areas: [...input.blocked_areas].sort((a, b) => compare(canonical(a), canonical(b))) };
}

function inside(point: Position, bounds: ToyRectangle): boolean {
  return point.x_m >= bounds.min_x_m && point.x_m <= bounds.max_x_m
    && point.y_m >= bounds.min_y_m && point.y_m <= bounds.max_y_m;
}

// Slab clipping against a CLOSED rectangle: tangencies/edge travel are blocked.
// Region is convex, so both endpoints imply the entire segment stays within it.
function intersectsRectangle(a: Position, b: Position, bounds: ToyRectangle): boolean {
  let low = 0; let high = 1;
  for (const [start, end, min, max] of [[a.x_m, b.x_m, bounds.min_x_m, bounds.max_x_m],
    [a.y_m, b.y_m, bounds.min_y_m, bounds.max_y_m]]) {
    const delta = end - start;
    if (delta === 0) { if (start < min || start > max) return false; }
    else { const first = (min - start) / delta; const last = (max - start) / delta;
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
      if (low > high) return false; }
  }
  return true;
}

function route(input: MissionPlanningSnapshot, item: MissionDrone, area: MissionSector, template: Template): readonly Position[] {
  const points: Position[] = [{ ...item.position }]; const bounds = area.bounds;
  for (let pass = 0; pass < 4; pass++) {
    const fraction = pass / 3;
    const start = pass % 2 === 0 ? 0 : 1; const end = 1 - start;
    for (const along of [start, end]) points.push({
      x_m: bounds.min_x_m + (bounds.max_x_m - bounds.min_x_m) * (template === 'coverage_x' ? along : fraction),
      y_m: bounds.min_y_m + (bounds.max_y_m - bounds.min_y_m) * (template === 'coverage_x' ? fraction : along),
      z_m: input.policy.coverage_altitude_m,
    });
  }
  points.push({ ...item.home }); return points;
}

function distance(points: readonly Position[]): number {
  return points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x_m - points[index].x_m,
    point.y_m - points[index].y_m, point.z_m - points[index].z_m), 0);
}

function eligible(input: MissionPlanningSnapshot, current: MissionPlanningContext, item: MissionDrone,
  area: MissionSector, points: readonly Position[]): MissionExclusionReason | null {
  if (input.active_leases.some(lease => lease.expires_at_sim_tick > current.current_sim_tick
    && (lease.drone_id === item.drone_id || lease.sector_id === area.sector_id))) return 'ACTIVE_LEASE';
  if (!input.objective.required_capabilities.every(required => item.capabilities.includes(required)
    && item.feeds.some(feed => feed.modality === required && feed.status === 'available'))) return 'SENSOR_UNAVAILABLE';
  if (!item.link_available) return 'LINK_UNAVAILABLE';
  if (input.policy.wind_m_per_tick > input.policy.max_wind_m_per_tick) return 'WIND_LIMIT';
  if (!points.every(point => inside(point, input.approved_region))) return 'REGION';
  for (let n = 1; n < points.length; n++) {
    if (input.blocked_areas.some(bounds => intersectsRectangle(points[n - 1], points[n], bounds))) return 'BLOCKED_ROUTE';
  }
  const travelled = distance(points); const elapsed = travelled / input.policy.route_speed_m_per_tick;
  const cost = travelled * input.policy.energy_units_per_m * (1 + input.policy.wind_m_per_tick / input.policy.route_speed_m_per_tick);
  if (!Number.isFinite(elapsed) || !Number.isFinite(cost)
    || item.reserve_units - cost < input.policy.minimum_reserve_units) return 'LOW_RESERVE';
  return null;
}

function pointSegmentDistance(point: Position, a: Position, b: Position): number {
  const x = b.x_m - a.x_m; const y = b.y_m - a.y_m; const squared = x * x + y * y;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x_m - a.x_m) * x + (point.y_m - a.y_m) * y) / squared));
  return Math.hypot(point.x_m - (a.x_m + t * x), point.y_m - (a.y_m + t * y));
}

function segmentDistance(a: Position, b: Position, c: Position, d: Position): number {
  const cross = (p: Position, q: Position, r: Position): number =>
    (q.x_m - p.x_m) * (r.y_m - p.y_m) - (q.y_m - p.y_m) * (r.x_m - p.x_m);
  const overlaps = Math.max(Math.min(a.x_m, b.x_m), Math.min(c.x_m, d.x_m)) <= Math.min(Math.max(a.x_m, b.x_m), Math.max(c.x_m, d.x_m))
    && Math.max(Math.min(a.y_m, b.y_m), Math.min(c.y_m, d.y_m)) <= Math.min(Math.max(a.y_m, b.y_m), Math.max(c.y_m, d.y_m));
  if (overlaps && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function separated(a: ProposedMissionAssignment, b: ProposedMissionAssignment, minimum: number): boolean {
  const first = a.waypoints; const second = b.waypoints;
  for (let n = 1; n < first.length; n++) for (let m = 1; m < second.length; m++) {
    if (segmentDistance(first[n - 1].position, first[n].position, second[m - 1].position, second[m].position) < minimum) return false;
  }
  return true;
}

function assignment(input: MissionPlanningSnapshot, fingerprint: string, item: MissionDrone, area: MissionSector,
  template: Template, points: readonly Position[]): ProposedMissionAssignment {
  const tuple = [fingerprint, template, item.drone_id, area.sector_id]; const missionId = identity('mission', tuple);
  const travelled = distance(points); const elapsed = travelled / input.policy.route_speed_m_per_tick;
  const cost = travelled * input.policy.energy_units_per_m * (1 + input.policy.wind_m_per_tick / input.policy.route_speed_m_per_tick);
  return { candidate_id: identity('candidate', tuple), mission_id: missionId, route_id: identity('route', tuple),
    action_id: identity('action', tuple), registration_status: 'proposed_awaiting_reviewed_registration',
    drone_id: item.drone_id, sector_id: area.sector_id, capture_goal: input.objective.capture_goal,
    required_capabilities: input.objective.required_capabilities,
    selected_feeds: item.feeds.filter(feed => input.objective.required_capabilities.includes(feed.modality)),
    evidence: input.evidence.filter(evidence => area.evidence_ids.includes(evidence.evidence_id)),
    waypoints: points.map((position, index) => ({ mission_id: missionId, position,
      reason: index === 0 ? 'received_position' : index === points.length - 1 ? 'return_home' : 'fixed_coverage_pass' })),
    reasons: ['toy_constraints_passed', 'received_coverage_age_preference', 'reviewed_registration_and_current_chief_approval_required'],
    toy_estimate: { model: 'toy-scalar.v1', distance_m: travelled, elapsed_ticks: elapsed,
      cost_units: cost, remaining_reserve_units: item.reserve_units - cost, observed_coverage_age_ticks: area.coverage_age_ticks } };
}

function courseCompare(a: readonly ProposedMissionAssignment[], b: readonly ProposedMissionAssignment[]): number {
  const totalCost = (items: readonly ProposedMissionAssignment[]): number => items.reduce((sum, item) => sum + item.toy_estimate.cost_units, 0);
  // Compare sorted ages lexically, avoiding overflow from summed arbitrary ticks.
  const first = a.map(item => item.toy_estimate.observed_coverage_age_ticks).sort((a, b) => b - a);
  const second = b.map(item => item.toy_estimate.observed_coverage_age_ticks).sort((a, b) => b - a);
  if (a.length !== b.length) return b.length - a.length;
  for (let n = 0; n < first.length; n++) if (first[n] !== second[n]) return second[n] - first[n];
  return totalCost(a) - totalCost(b)
    || compare(canonical(a.map(item => [item.sector_id, item.drone_id])), canonical(b.map(item => [item.sector_id, item.drone_id])));
}

function allocate(input: MissionPlanningSnapshot, choices: readonly ProposedMissionAssignment[]): readonly ProposedMissionAssignment[] {
  const sectors = [...input.sectors].sort((a, b) => b.coverage_age_ticks - a.coverage_age_ticks || compare(a.sector_id, b.sector_id));
  let best: readonly ProposedMissionAssignment[] = [];
  // <=3 sectors and <=3 drones: <=4^3 branches. Max-cardinality first, stable
  // coverage-age/cost/ID tie-breaks; every pair must satisfy toy separation.
  function visit(index: number, selected: readonly ProposedMissionAssignment[]): void {
    if (index === sectors.length) { if (courseCompare(selected, best) < 0) best = selected; return; }
    visit(index + 1, selected);
    for (const choice of choices.filter(item => item.sector_id === sectors[index].sector_id)) {
      if (selected.some(item => item.drone_id === choice.drone_id
        || !separated(item, choice, input.policy.separation_m))) continue;
      visit(index + 1, [...selected, choice]);
    }
  }
  visit(0, []); return best;
}

function owned<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(owned)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, owned(item)]))) as T;
}

/** Pure, proposed options only. Never mutates received inputs, consumes intent,
 * registers candidates, approves, reserves, calls providers or executes routes.
 * Later ranking must use a separately reviewed registered-candidate adapter.
 */
export function generateMissionCandidates(input: unknown, current: unknown): Result<MissionPlan> {
  if (!plainJson(input) || !plainJson(current) || !snapshot(input) || !context(current)) return reject('Invalid or unknown required bounded planner inputs');
  if (current.mode !== 'live') return reject('Replay/offline intent cannot produce current mission options', 'FROZEN');
  if (current.incident_id !== input.incident_id || current.run_id !== input.run_id || current.input_revision !== input.input_revision) {
    return reject('Incident/run/input revision must exactly match current context', 'STALE_VERSION');
  }
  if (current.used_intent_ids.includes(input.intent_id)) return reject('Intent already recorded as used', 'CONFLICT');
  const age = current.current_sim_tick - input.observed_at_sim_tick;
  const intentAge = current.current_sim_tick - input.intent_created_at_sim_tick;
  if (age < 0 || age > input.policy.snapshot_max_age_ticks || intentAge < 0 || intentAge >= input.policy.intent_ttl_ticks) {
    return reject('Snapshot/intent is stale, future or expired', 'EXPIRED');
  }
  const received = normalized(input);
  const { incident_id, run_id, input_revision, mode, used_intent_ids } = current;
  const fingerprint = identity('input', [received, { incident_id, run_id, input_revision, mode,
    used_intent_ids: [...used_intent_ids].sort(compare) }]);
  const exclusions: MissionExclusion[] = []; const courses: ProposedMissionOption[] = [];
  const routeKeys = new Set<string>();
  for (const template of ['coverage_x', 'coverage_y'] as const) {
    const choices: ProposedMissionAssignment[] = [];
    for (const area of received.sectors) for (const item of received.drones) {
      const points = route(received, item, area, template); const reason = eligible(received, current, item, area, points);
      if (reason !== null) exclusions.push({ template, drone_id: item.drone_id, sector_id: area.sector_id, reason });
      else choices.push(assignment(received, fingerprint, item, area, template, points));
    }
    const assignments = allocate(received, choices);
    const routeKey = canonical(assignments.map(item => [item.drone_id, item.sector_id, item.waypoints.map(waypoint => waypoint.position)]));
    if (assignments.length === 0 || routeKeys.has(routeKey)) continue;
    routeKeys.add(routeKey);
    courses.push({ option_id: identity('option', [fingerprint, template, assignments.map(item => item.candidate_id)]),
      kind: template, executable: false, assignments, reasons: ['actual_surviving_fixed_template', 'toy_not_validated_flight_safety'] });
  }
  courses.sort((a, b) => courseCompare(a.assignments, b.assignments) || compare(a.kind, b.kind));
  const hold: ProposedMissionOption = { option_id: identity('hold', fingerprint), kind: 'hold', executable: false,
    assignments: [], reasons: ['review_only_hold_baseline', 'no_movement_or_lease_extension_authorized'] };
  return Object.freeze({ ok: true, value: owned<MissionPlan>({ snapshot_id: input.snapshot_id, input_revision: input.input_revision,
    intent_id: input.intent_id, objective_id: input.objective.objective_id, executable: false,
    options: [hold, ...courses], exclusions, assumptions: [
      'toy-scalar.v1: declared inputs, not calibrated energy/wind/link or flight safety',
      'closed 2D rectangles; all ingress/coverage/return segments checked; fixed four-pass coverage, not measured coverage',
      'whole-polyline pair separation ignores timing; no separation from occupied routes whose geometry is unavailable',
      'coverage age is received input, not promised freshness or independently verified observation',
      'proposed IDs await reviewed registration; current Chief approval/executor revalidation remain separate',
      'caller context is not authentication; replay detection only against supplied used-intent IDs; no state writes',
    ] }) });
}
