export type ContractVersion = 'backend-protocol.v1';

export type RejectionCode =
  | 'INVALID_SCHEMA'
  | 'INVALID_TIME'
  | 'VERSION_MISMATCH'
  | 'UNAUTHORIZED'
  | 'STALE_VERSION'
  | 'STREAM_GAP'
  | 'CONFLICT'
  | 'EXPIRED'
  | 'FROZEN';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: RejectionCode; readonly reason: string };

export interface ActorContext {
  readonly principal_id: string;
  readonly session_id: string;
  readonly incident_id: string;
  readonly run_id: string;
  readonly actor_kind: 'human' | 'simulator' | 'analyst' | 'server' | 'fixture';
  readonly chief_epoch: number | null;
  readonly producer_id: string | null;
  readonly capture_epoch: number | null;
}

export interface CommitContext {
  readonly actor: ActorContext;
  readonly recorded_at: string;
  readonly received_at: string;
  readonly sim_tick: number;
  readonly mode: 'live' | 'replay' | 'offline';
}

export interface Identity {
  readonly contract_version: ContractVersion;
  readonly incident_id: string;
  readonly run_id: string;
  readonly authority_epoch: number;
}

export interface Position {
  readonly x_m: number;
  readonly y_m: number;
  readonly z_m: number;
}

export interface SourcePosition {
  readonly coordinate_frame: string;
  readonly units: string;
  readonly altitude_datum: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Asset {
  readonly asset_id: string;
  readonly capabilities: readonly ('thermal' | 'eo')[];
  readonly thermal_feed_id: string;
  readonly eo_feed_id?: string;
}

export interface Calibration {
  readonly calibration_id: string;
  readonly source_id: string;
  readonly sensor_id: string;
  readonly method: string;
  readonly units: string;
  readonly calibrated_at: string | null;
  readonly verified_source: string | null;
  readonly verification_status: 'verified' | 'unverified' | 'unknown';
}

export interface Feed {
  readonly feed_id: string;
  readonly asset_id: string;
  readonly modality: 'thermal' | 'eo';
  readonly source_kind: 'simulated' | 'uploaded' | 'live';
  readonly synthetic: boolean;
  readonly radiometric: boolean | 'unknown';
  readonly calibration: Calibration | null;
  readonly source_id: string;
  readonly source_revision: number;
  readonly capture_owner_id: string;
  readonly capture_epoch: number;
  readonly status: 'available' | 'paused' | 'stale' | 'unavailable';
}

export interface Candidate {
  readonly candidate_id: string;
  readonly action_id: string;
  readonly asset_id: string;
  readonly mission_id: string;
  readonly mission_version: number;
  readonly route_id: string;
  readonly plan_revision: number;
  readonly feasibility_snapshot_id: string;
  readonly feasible: boolean;
  readonly expires_at_sim_tick: number;
}

export interface IncidentSeed extends Identity {
  readonly incident_revision: number;
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_id: string;
  readonly chief_epoch: number;
  readonly producer_id: string;
  readonly capture_epoch: number;
  readonly authority_active: boolean;
  readonly assets: readonly Asset[];
  readonly feeds: readonly Feed[];
  readonly candidates: readonly Candidate[];
}

export interface CaptureClock {
  readonly captured_at: string | null;
  readonly capture_time_status: 'known' | 'unknown';
}

export interface TelemetryPayload extends CaptureClock {
  readonly asset_id: string;
  readonly mission_id: string | null;
  readonly mission_version: number;
  readonly sim_tick: number;
  readonly position: Position | null;
  readonly battery_percent: number | null;
  readonly producer_id: string;
  readonly capture_epoch: number;
}

export interface FramePayload extends CaptureClock {
  readonly frame_id: string;
  readonly feed_id: string;
  readonly asset_id: string;
  readonly evidence_id: string;
  readonly source_snapshot_id: string;
  readonly source_revision: number;
  readonly capture_owner_id: string;
  readonly capture_epoch: number;
  readonly sim_tick: number | null;
  readonly source_position: SourcePosition | null;
  readonly location_uncertainty_m: number | null;
  readonly mime_type: string;
  readonly byte_length: number;
  readonly media_ref: string;
  readonly content_hash: string;
  readonly width_px: number;
  readonly height_px: number;
  readonly media_limits_version: string;
}

export interface ModelScore {
  readonly value: number;
  readonly scale: string;
}

export interface HypothesisPayload {
  readonly hypothesis_id: string;
  readonly kind: 'human' | 'animal' | 'fire' | 'gas_canister' | 'other';
  readonly verification_status: 'unverified';
  readonly evidence_ids: readonly string[];
  readonly source_snapshot_id: string;
  readonly input_revision: number;
  readonly geography: Position | null;
  readonly location_uncertainty_m: number | null;
  readonly model_score: ModelScore | null;
  readonly contradictions: readonly string[];
  readonly critical: boolean;
}

export interface ProposalPayload {
  readonly proposal_id: string;
  readonly proposal_revision: number;
  readonly candidate_ids: readonly string[];
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_epoch: number;
  readonly rationale: string;
  readonly expires_at_sim_tick: number;
}

export type ReceiptStage = 'sent' | 'delivered' | 'accepted' | 'running'
  | 'completed' | 'failed' | 'cancelled' | 'rejected';

export interface ReceiptPayload extends CaptureClock {
  readonly receipt_id: string;
  readonly command_id: string;
  readonly command_version: number;
  readonly transmission_id: string;
  readonly mission_id: string;
  readonly mission_version: number;
  readonly stage: ReceiptStage;
  readonly sim_tick: number;
  readonly producer_id: string;
  readonly capture_epoch: number;
  readonly reason: string | null;
  readonly evidence_ids: readonly string[];
}

export interface AuthorityPayload {
  readonly authority_active: boolean;
  readonly producer_id: string;
  readonly capture_epoch: number;
  readonly next_authority_epoch: number;
}

export interface ChiefPayload {
  readonly chief_id: string;
  readonly chief_epoch: number;
}

export interface EventEnvelope extends Identity {
  readonly event_id: string;
  readonly stream_id: string;
  readonly stream_sequence: number;
  readonly trace_id: string;
  readonly causation_id: string | null;
}

export type EventInput = EventEnvelope & (
  | { readonly kind: 'telemetry.received'; readonly payload: TelemetryPayload }
  | { readonly kind: 'frame.received'; readonly payload: FramePayload }
  | { readonly kind: 'hypothesis.received'; readonly payload: HypothesisPayload }
  | { readonly kind: 'proposal.created'; readonly payload: ProposalPayload }
  | { readonly kind: 'command.receipt'; readonly payload: ReceiptPayload }
  | { readonly kind: 'authority.changed'; readonly payload: AuthorityPayload }
  | { readonly kind: 'chief.changed'; readonly payload: ChiefPayload }
);

export interface ApprovalRequest extends Identity {
  readonly approval_id: string;
  readonly proposal_id: string;
  readonly proposal_revision: number;
  readonly candidate_id: string;
  readonly expected_incident_revision: number;
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_epoch: number;
  readonly expires_at_sim_tick: number;
}

export interface Reservation {
  readonly reservation_id: string;
  readonly asset_id: string;
  readonly route_id: string;
  readonly approval_id: string;
  readonly reservation_revision: number;
  readonly expires_at_sim_tick: number;
}

export type CommandStatus = 'enqueued' | ReceiptStage;

export interface Command extends Identity {
  readonly command_id: string;
  readonly command_version: number;
  readonly idempotency_key: string;
  readonly transmission_id: string;
  readonly asset_id: string;
  readonly mission_id: string;
  readonly mission_version: number;
  readonly route_id: string;
  readonly action_id: string;
  readonly approval_id: string;
  readonly proposal_id: string;
  readonly proposal_revision: number;
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_epoch: number;
  readonly chief_id: string;
  readonly sent_sim_tick: number | null;
  readonly deadline_sim_tick: number;
  readonly lease_expires_at_sim_tick: number;
  readonly status: CommandStatus;
}

export interface CommittedMetadata {
  readonly incident_revision: number;
  readonly actor_id: string;
  readonly actor_kind: ActorContext['actor_kind'];
  readonly session_id: string;
  readonly recorded_at: string;
  readonly received_at: string;
  readonly sim_tick: number;
}

export interface ApprovalCommittedPayload {
  readonly request: ApprovalRequest;
  readonly command: Command;
  readonly reservation: Reservation;
}

export type CommittedEvent = CommittedMetadata & (
  | EventInput
  | (EventEnvelope & { readonly kind: 'approval.committed'; readonly payload: ApprovalCommittedPayload })
);

export type CommittedFor<K extends CommittedEvent['kind']> = Extract<CommittedEvent, { readonly kind: K }>;

export interface IncidentState extends Identity {
  readonly seed: IncidentSeed;
  readonly incident_revision: number;
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_id: string;
  readonly chief_epoch: number;
  readonly producer_id: string;
  readonly capture_epoch: number;
  readonly authority_active: boolean;
  readonly stream_cursors: Readonly<Record<string, number>>;
  readonly telemetry: Readonly<Record<string, CommittedFor<'telemetry.received'>>>;
  readonly frames: Readonly<Record<string, CommittedFor<'frame.received'>>>;
  readonly hypotheses: Readonly<Record<string, CommittedFor<'hypothesis.received'>>>;
  readonly proposals: Readonly<Record<string, CommittedFor<'proposal.created'>>>;
  readonly reservations: Readonly<Record<string, Reservation>>;
  readonly commands: Readonly<Record<string, Command>>;
  readonly log: readonly CommittedEvent[];
}

export interface ReceivedSnapshot extends Identity {
  readonly incident_revision: number;
  readonly telemetry: IncidentState['telemetry'];
  readonly frames: IncidentState['frames'];
  readonly hypotheses: IncidentState['hypotheses'];
  readonly commands: IncidentState['commands'];
  readonly received_at: string;
}
