import { replayLog, selectReceivedSnapshot } from '../state/index.ts';
import type { Candidate, Command, CommittedFor, Feed, Identity, IncidentState, ProposalPayload, Result } from '../protocol/types.ts';

export type ReceivedRow<K extends 'telemetry.received' | 'frame.received' | 'hypothesis.received'> =
  Pick<CommittedFor<K>, 'incident_revision' | 'received_at' | 'payload'>;
export type CrewCommand = Pick<Command, 'command_id' | 'command_version' | 'asset_id' | 'mission_id'
  | 'mission_version' | 'approval_id' | 'proposal_id' | 'status'>;

export interface BridgeView extends Identity {
  readonly bridge_version: 'backend-bridge.v1';
  readonly mode: 'EXERCISE';
  readonly incident_revision: number;
  readonly input_revision: number;
  readonly plan_revision: number;
  readonly reservation_revision: number;
  readonly chief_epoch: number;
  readonly authority_active: boolean;
  readonly as_of_received_at: string;
  readonly media_verified: false;
  readonly coordinate_frame: null;
  readonly feeds: readonly Feed[];
  readonly telemetry: Readonly<Record<string, ReceivedRow<'telemetry.received'>>>;
  readonly frames: Readonly<Record<string, ReceivedRow<'frame.received'>>>;
  readonly hypotheses: Readonly<Record<string, ReceivedRow<'hypothesis.received'>>>;
  readonly proposals: readonly ProposalPayload[];
  readonly candidates: readonly Candidate[];
  readonly commands: readonly CrewCommand[];
}

function rows<T extends { readonly incident_revision: number; readonly received_at: string; readonly payload: unknown }>(
  source: Readonly<Record<string, T>>,
): Readonly<Record<string, Pick<T, 'incident_revision' | 'received_at' | 'payload'>>> {
  const result: Record<string, Pick<T, 'incident_revision' | 'received_at' | 'payload'>> = Object.create(null);
  for (const [key, row] of Object.entries(source)) result[key] = Object.freeze({
    incident_revision: row.incident_revision, received_at: row.received_at, payload: row.payload,
  });
  return Object.freeze(result);
}

export function createReceivedView(state: IncidentState, cutoff: string): Result<BridgeView> {
  const snapshot = selectReceivedSnapshot(state, cutoff);
  if (!snapshot.ok) return snapshot;
  const prefix = state.log.filter(event => event.incident_revision <= snapshot.value.incident_revision);
  const replayed = replayLog(state.seed, prefix);
  if (!replayed.ok) return replayed;
  const current = replayed.value;
  const tick = current.log.at(-1)?.sim_tick ?? 0;
  const candidates = current.seed.candidates.filter(candidate => current.authority_active && candidate.feasible
    && candidate.plan_revision === current.plan_revision && candidate.expires_at_sim_tick > tick);
  const proposals = Object.values(current.proposals).filter(event => current.authority_active
    && event.authority_epoch === current.authority_epoch && event.payload.input_revision === current.input_revision
    && event.payload.plan_revision === current.plan_revision && event.payload.reservation_revision === current.reservation_revision
    && event.payload.chief_epoch === current.chief_epoch && event.payload.expires_at_sim_tick > tick
    && event.payload.candidate_ids.every(id => candidates.some(candidate => candidate.candidate_id === id))).map(event => event.payload);
  const referenced = new Set(proposals.flatMap(value => value.candidate_ids));
  const commands = Object.values(current.commands).map(command => Object.freeze({
    command_id: command.command_id, command_version: command.command_version, asset_id: command.asset_id,
    mission_id: command.mission_id, mission_version: command.mission_version, approval_id: command.approval_id,
    proposal_id: command.proposal_id, status: command.status,
  }));
  return Object.freeze({ ok: true, value: Object.freeze({ contract_version: current.contract_version,
    bridge_version: 'backend-bridge.v1', mode: 'EXERCISE', incident_id: current.incident_id, run_id: current.run_id,
    authority_epoch: current.authority_epoch, incident_revision: current.incident_revision, input_revision: current.input_revision,
    plan_revision: current.plan_revision, reservation_revision: current.reservation_revision, chief_epoch: current.chief_epoch,
    authority_active: current.authority_active, as_of_received_at: cutoff, media_verified: false, coordinate_frame: null,
    feeds: current.seed.feeds, telemetry: rows(current.telemetry), frames: rows(current.frames), hypotheses: rows(current.hypotheses),
    proposals: Object.freeze(proposals), candidates: Object.freeze(candidates.filter(value => referenced.has(value.candidate_id))),
    commands: Object.freeze(commands) }) });
}
