import type { Position } from '../protocol/types.ts';

/** Bounded exercise DTOs, not core Candidate registrations or flight-safety records.
 * Caller supplies received knowledge only. No truth labels, pixels, model confidence,
 * calibration, approval, or hidden simulator state belong in this boundary.
 * Bounds: 3 drones/sectors, 16 evidence/blocks/leases/used intents, 2 modalities.
 * Rectangles are closed 2D toy-metre projections; abs coordinates <=1,000,000.
 */
export type MissionCapability = 'thermal' | 'eo';

export interface ToyRectangle {
  readonly min_x_m: number;
  readonly max_x_m: number;
  readonly min_y_m: number;
  readonly max_y_m: number;
}

export interface MissionEvidence {
  readonly evidence_id: string;
  readonly source_snapshot_id: string;
  readonly source_id: string;
  readonly source_kind: 'simulated' | 'uploaded' | 'live';
  readonly synthetic: boolean;
  readonly captured_at_sim_tick: number | null;
  readonly received_at_sim_tick: number;
}

export interface MissionFeed {
  readonly feed_id: string;
  readonly modality: MissionCapability;
  readonly status: 'available' | 'paused' | 'stale' | 'unavailable';
  readonly source_id: string;
  readonly source_kind: MissionEvidence['source_kind'];
  readonly synthetic: boolean;
}

export interface MissionDrone {
  readonly drone_id: string;
  readonly position: Position;
  readonly home: Position;
  readonly capabilities: readonly MissionCapability[];
  readonly feeds: readonly MissionFeed[];
  readonly reserve_units: number;
  readonly link_available: boolean;
}

export interface MissionSector {
  readonly sector_id: string;
  readonly bounds: ToyRectangle;
  readonly coverage_age_ticks: number;
  readonly evidence_ids: readonly string[];
}

export interface MissionLease {
  readonly lease_id: string;
  readonly drone_id: string;
  readonly sector_id: string;
  readonly expires_at_sim_tick: number;
}

/** All required, caller-declared toy scalars. No calibrated energy/wind/RF physics.
 * Route distance includes current position -> 8 coverage points -> home.
 * Time = distance/speed. Cost = distance*energy_per_m*(1+wind/speed).
 * Separation checks entire 2D polyline pairs, conservatively ignoring timing.
 */
export interface ToyMissionPolicy {
  readonly model: 'toy-scalar.v1';
  readonly snapshot_max_age_ticks: number;
  readonly intent_ttl_ticks: number;
  readonly route_speed_m_per_tick: number;
  readonly energy_units_per_m: number;
  readonly minimum_reserve_units: number;
  readonly wind_m_per_tick: number;
  readonly max_wind_m_per_tick: number;
  readonly separation_m: number;
  readonly coverage_altitude_m: number;
}

export interface MissionPlanningSnapshot {
  readonly snapshot_id: string;
  readonly incident_id: string;
  readonly run_id: string;
  readonly input_revision: number;
  readonly observed_at_sim_tick: number;
  readonly intent_id: string;
  readonly intent_created_at_sim_tick: number;
  readonly objective: {
    readonly objective_id: string;
    readonly capture_goal: 'refresh_coverage';
    readonly required_capabilities: readonly MissionCapability[];
  };
  readonly approved_region: ToyRectangle;
  readonly sectors: readonly MissionSector[];
  readonly drones: readonly MissionDrone[];
  readonly evidence: readonly MissionEvidence[];
  readonly active_leases: readonly MissionLease[];
  readonly blocked_areas: readonly ToyRectangle[];
  readonly policy: ToyMissionPolicy;
}

/** Explicit current context, not authentication or human approval. A future trusted
 * adapter must derive these values and atomically consume intent IDs. This pure
 * function neither writes them nor proves cross-request replay protection.
 * current_sim_tick revalidates freshness/expiry/leases on every call, but alone
 * does not change proposed IDs. All other context and snapshot inputs remain
 * identity-bound; changing eligible survivors can still change course IDs.
 */
export interface MissionPlanningContext {
  readonly incident_id: string;
  readonly run_id: string;
  readonly input_revision: number;
  readonly current_sim_tick: number;
  readonly mode: 'live' | 'replay' | 'offline';
  readonly used_intent_ids: readonly string[];
}

export interface ProposedMissionWaypoint {
  readonly mission_id: string;
  readonly position: Position;
  readonly reason: 'received_position' | 'fixed_coverage_pass' | 'return_home';
}

export interface ProposedMissionAssignment {
  readonly candidate_id: string;
  readonly mission_id: string;
  readonly route_id: string;
  readonly action_id: string;
  readonly registration_status: 'proposed_awaiting_reviewed_registration';
  readonly drone_id: string;
  readonly sector_id: string;
  readonly capture_goal: 'refresh_coverage';
  readonly required_capabilities: readonly MissionCapability[];
  readonly selected_feeds: readonly MissionFeed[];
  readonly evidence: readonly MissionEvidence[];
  readonly waypoints: readonly ProposedMissionWaypoint[];
  readonly reasons: readonly string[];
  readonly toy_estimate: {
    readonly model: 'toy-scalar.v1';
    readonly distance_m: number;
    readonly elapsed_ticks: number;
    readonly cost_units: number;
    readonly remaining_reserve_units: number;
    readonly observed_coverage_age_ticks: number;
  };
}

export type MissionExclusionReason = 'ACTIVE_LEASE' | 'SENSOR_UNAVAILABLE'
  | 'LINK_UNAVAILABLE' | 'WIND_LIMIT' | 'REGION' | 'BLOCKED_ROUTE' | 'LOW_RESERVE';

export interface MissionExclusion {
  readonly template: 'coverage_x' | 'coverage_y';
  readonly drone_id: string;
  readonly sector_id: string;
  readonly reason: MissionExclusionReason;
}

export interface ProposedMissionOption {
  readonly option_id: string;
  readonly kind: 'hold' | 'coverage_x' | 'coverage_y';
  readonly executable: false;
  readonly assignments: readonly ProposedMissionAssignment[];
  readonly reasons: readonly string[];
}

export interface MissionPlan {
  readonly snapshot_id: string;
  readonly input_revision: number;
  readonly intent_id: string;
  readonly objective_id: string;
  readonly executable: false;
  readonly options: readonly ProposedMissionOption[];
  readonly exclusions: readonly MissionExclusion[];
  readonly assumptions: readonly string[];
}
