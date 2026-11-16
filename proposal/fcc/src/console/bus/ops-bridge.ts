import type { Action } from '../contracts';
import type { ApprovalRequest, Candidate, Command, EventInput, Feed } from '../../../../../backend/protocol/types';
import { parseCrewView, type CrewView } from './crew-view';

export interface OpsSetup {
  url: string; incident_id: string; run_id: string; mode: 'EXERCISE';
  roles: { chief: { capability: string }; producer: { capability: string; principal_id: string } };
}
type OpsView = Omit<CrewView, 'feeds' | 'candidates'> & { feeds: readonly Feed[]; candidates: readonly Candidate[] };
export class BridgeRejected extends Error {}
export class BridgeOffline extends Error {}

export function parseOpsSetup(text: string): OpsSetup {
  let s: OpsSetup;
  try { s = JSON.parse(text); } catch { throw new Error('Paste the private capabilities.json handoff'); }
  const u = new URL(s.url);
  if (s.mode !== 'EXERCISE' || u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    || u.username || u.password || u.search || u.hash || u.pathname !== '/'
    || !s.incident_id || !s.run_id || !s.roles?.producer?.principal_id
    || [s.roles?.chief?.capability, s.roles?.producer?.capability].some(t => typeof t !== 'string' || !t || t.length > 256 || /\s/.test(t))) {
    throw new Error('Expected a loopback EXERCISE handoff with Chief and producer capabilities');
  }
  return { url: u.origin, incident_id: s.incident_id, run_id: s.run_id, mode: 'EXERCISE',
    roles: { chief: { capability: s.roles.chief.capability }, producer: { ...s.roles.producer } } };
}

/** Ops names drones uav-N; the local backend fixture declares those exercise assets as dN. */
export function backendAssetId(localUnitId: string): string {
  const match = /^uav-([1-6])$/.exec(localUnitId);
  return match ? `d${match[1]}` : localUnitId;
}

/** Explicit exercise alias: only the same declared drone, never another asset or a field route. */
export function candidateForAction(action: Action, candidates: readonly Candidate[], assets: readonly { asset_id: string }[] = candidates): Candidate {
  if (action.kind !== 'retask-drone' || action.unitIds.length !== 1 || !action.target) throw new BridgeRejected('Only single-drone retasking is bridged');
  const assetId = backendAssetId(action.unitIds[0]);
  if (!assets.some(a => a.asset_id === assetId)) throw new BridgeRejected(`Unsupported backend asset: ${action.unitIds[0]}`);
  const candidate = candidates.find(c => c.asset_id === assetId && c.feasible);
  if (!candidate) throw new BridgeRejected('No eligible backend candidate for this drone; restart the exercise if its scope expired');
  return candidate;
}

export function proposalForAction(action: Action, view: OpsView, candidate: Candidate, id: string): EventInput {
  candidateForAction(action, [candidate]);
  return { contract_version: 'backend-protocol.v1', incident_id: view.incident_id, run_id: view.run_id,
    authority_epoch: view.authority_epoch, event_id: `${id}:proposal`, stream_id: `ops:${id}`, stream_sequence: 1,
    trace_id: id, causation_id: null, kind: 'proposal.created', payload: {
      proposal_id: id, proposal_revision: 1, candidate_ids: [candidate.candidate_id], input_revision: view.input_revision,
      plan_revision: view.plan_revision, reservation_revision: view.reservation_revision, chief_epoch: view.chief_epoch,
      rationale: `EXERCISE fixture alias for local simulated task: ${action.title}. Backend route is not calibrated geographic approval.`,
      expires_at_sim_tick: candidate.expires_at_sim_tick,
    } };
}

export function approvalForProposal(view: OpsView, candidate: Candidate, id: string): ApprovalRequest {
  return { contract_version: 'backend-protocol.v1', incident_id: view.incident_id, run_id: view.run_id,
    authority_epoch: view.authority_epoch, approval_id: `${id}:approval`, proposal_id: id, proposal_revision: 1,
    candidate_id: candidate.candidate_id, expected_incident_revision: view.incident_revision,
    input_revision: view.input_revision, plan_revision: view.plan_revision, reservation_revision: view.reservation_revision,
    chief_epoch: view.chief_epoch, expires_at_sim_tick: candidate.expires_at_sim_tick };
}

export function localActionId(command: Command, binding: { actionId: string; approvalId: string; candidate: Candidate }): string {
  const c = binding.candidate;
  if (command.approval_id !== binding.approvalId || command.asset_id !== c.asset_id || command.route_id !== c.route_id
    || command.action_id !== c.action_id || command.mission_id !== c.mission_id || command.mission_version !== c.mission_version) {
    throw new BridgeRejected('Backend command does not match the reviewed exercise binding');
  }
  return binding.actionId;
}

export function receiptForCommand(command: Command, producer: string, captureEpoch: number,
  stage: 'running' | 'completed' | 'cancelled', simTick: number, evidenceIds: readonly string[] = []): EventInput {
  const id = `${command.command_id}:${stage}`;
  return { contract_version: command.contract_version, incident_id: command.incident_id, run_id: command.run_id,
    authority_epoch: command.authority_epoch, event_id: id, stream_id: `ops:${id}`, stream_sequence: 1,
    trace_id: command.command_id, causation_id: null, kind: 'command.receipt', payload: {
      receipt_id: id, command_id: command.command_id, command_version: command.command_version,
      transmission_id: command.transmission_id, mission_id: command.mission_id, mission_version: command.mission_version,
      stage, sim_tick: simTick, producer_id: producer, capture_epoch: captureEpoch, captured_at: null,
      capture_time_status: 'unknown', reason: stage === 'cancelled'
        ? 'Local simulated task cancelled or did not start; no field execution or measured route validation'
        : 'Simulated execution evidence only; no camera/media registration, field execution or measured route validation', evidence_ids: evidenceIds,
    } };
}

/** Renders an execution-status card, not camera pixels. Its exact SVG bytes remain local. */
export async function simulatedExecutionFrame(command: Command, feed: Feed, producer: string,
  stage: 'completed' | 'cancelled', simTick: number): Promise<{ event: EventInput; image: string }> {
  if (feed.asset_id !== command.asset_id || feed.capture_owner_id !== producer || !feed.synthetic || feed.source_kind !== 'simulated') {
    throw new BridgeRejected('Execution evidence requires the command asset’s simulated producer feed');
  }
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
  const image = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120"><title>Simulated execution evidence, not a camera frame</title><text x="12" y="24">EXERCISE: simulated execution ${stage}</text><text x="12" y="48">${escape(command.command_id)}</text><text x="12" y="72">${escape(command.asset_id)} / ${escape(command.mission_id)} v${command.mission_version}</text><text x="12" y="96">Local simulation tick ${simTick}; no camera or field observation</text></svg>`;
  const bytes = new TextEncoder().encode(image);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = `${command.command_id}:execution-${stage}`;
  return { image, event: { contract_version: command.contract_version, incident_id: command.incident_id,
    run_id: command.run_id, authority_epoch: command.authority_epoch, event_id: id, stream_id: `ops:${id}`, stream_sequence: 1,
    trace_id: command.command_id, causation_id: null, kind: 'frame.received', payload: {
      frame_id: id, feed_id: feed.feed_id, asset_id: command.asset_id, evidence_id: `${id}:evidence`,
      source_snapshot_id: id, source_revision: feed.source_revision, capture_owner_id: producer, capture_epoch: feed.capture_epoch,
      captured_at: null, capture_time_status: 'unknown', sim_tick: simTick, source_position: null, location_uncertainty_m: null,
      mime_type: 'image/svg+xml', byte_length: bytes.byteLength, media_ref: id,
      content_hash: `sha256:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`,
      width_px: 640, height_px: 120, media_limits_version: 'ops-simulated-execution.v1',
    } } };
}

export class OpsBridge {
  private approving = new Set<string>();
  private commands = new Map<string, { command: Command; feed: Feed; cancelPending: boolean; actionKey: string }>();
  private attempts = new Map<string, { approval: ApprovalRequest; candidate: Candidate; actionKey: string }>();
  private completions = new Map<string, { receipt: EventInput; frame: EventInput; image: string }>();
  constructor(private readonly setup: OpsSetup, private readonly fetchImpl: typeof fetch = fetch.bind(globalThis)) {}

  private async request<T>(path: string, role: 'chief' | 'producer', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.setup.url}/incidents/${encodeURIComponent(this.setup.incident_id)}/${path}`, {
        method: body === undefined && path !== 'producer-heartbeats' ? 'GET' : 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(3000),
        headers: { Authorization: `Bearer ${this.setup.roles[role].capability}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new BridgeOffline('Backend unavailable; no execution authorized by this request'); }
    let result: { data: T; error?: { code?: string; reason?: string } };
    try { result = await response.json(); } catch {
      if (path === 'approvals') throw new BridgeOffline('Invalid backend approval response; request outcome is unknown');
      throw new BridgeRejected('Invalid backend response');
    }
    if (path === 'approvals' && response.status >= 500) throw new BridgeOffline('Backend approval failed; request outcome is unknown');
    if (!response.ok) throw new BridgeRejected(`${result.error?.code ?? response.status}: ${result.error?.reason ?? 'Backend rejected request'}`);
    return result.data;
  }
  async snapshot(): Promise<OpsView> {
    const raw = await this.request<unknown>('snapshot', 'chief');
    const view = parseCrewView(raw, this.setup.incident_id);
    if (view.run_id !== this.setup.run_id || view.incident_id !== this.setup.incident_id || !view.authority_active) {
      throw new BridgeRejected('Exercise authority frozen or changed; restart and reconnect explicitly');
    }
    const candidates = (raw as { candidates: Candidate[] }).candidates;
    if (candidates.some(c => typeof c.action_id !== 'string' || typeof c.feasible !== 'boolean'
      || !Number.isSafeInteger(c.expires_at_sim_tick))) throw new BridgeRejected('Invalid backend candidate scope');
    return { ...view, feeds: (raw as { feeds: Feed[] }).feeds, candidates };
  }
  async heartbeat(): Promise<void> { await this.request('producer-heartbeats', 'producer'); }

  private actionKey(action: Action): string {
    return JSON.stringify([action.proposedAt, action.unitIds, action.target]);
  }

  private async reconcileApproval(id: string): Promise<void> {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    let rejected = false;
    try { await this.request('approvals', 'chief', attempt.approval); }
    catch (error) {
      if (!(error instanceof BridgeRejected)) throw error;
      rejected = true;
    }
    const view = await this.snapshot();
    const row = view.commands.find(c => c.approval_id === attempt.approval.approval_id);
    if ((row && ['completed', 'failed', 'cancelled', 'rejected'].includes(row.status)) || (!row && rejected)) {
      this.attempts.delete(id);
      return;
    }
    const commands = await this.request<Command[]>('commands', 'producer');
    const command = commands.find(c => c.approval_id === attempt.approval.approval_id);
    if (!command) throw new BridgeRejected('Approval outcome retained; command is not currently available for reconciliation');
    localActionId(command, { actionId: id, approvalId: attempt.approval.approval_id, candidate: attempt.candidate });
    const feed = view.feeds.find(f => f.asset_id === command.asset_id);
    if (!feed) throw new BridgeRejected('Producer capture scope unavailable; approval outcome retained');
    this.commands.set(id, { command, feed, cancelPending: true, actionKey: attempt.actionKey });
    this.attempts.delete(id);
  }

  async approve(action: Action, execute: () => unknown, simTick: number): Promise<void> {
    if (this.approving.has(action.id)) throw new BridgeRejected('Command approval already pending');
    this.approving.add(action.id);
    try { await this.approveAction(action, execute, simTick); }
    finally { this.approving.delete(action.id); }
  }

  private async approveAction(action: Action, execute: () => unknown, simTick: number): Promise<void> {
    if (this.attempts.has(action.id)) {
      await this.reconcileApproval(action.id);
      await this.finish(action.id, 'cancelled', simTick);
    }
    if (this.commands.has(action.id)) throw new BridgeRejected('Command already pending; await its terminal receipt');
    await this.heartbeat();
    const view = await this.snapshot();
    const candidate = candidateForAction(action, view.candidates, view.feeds);
    const id = `ops-${crypto.randomUUID()}`;
    const proposal = proposalForAction(action, view, candidate, id);
    await this.request('events', 'chief', proposal);
    const proposed = await this.snapshot();
    const approval = approvalForProposal(proposed, candidate, id);
    const actionKey = this.actionKey(action);
    this.attempts.set(action.id, { approval, candidate, actionKey });
    try { await this.request('approvals', 'chief', approval); }
    catch (error) {
      if (error instanceof BridgeRejected) this.attempts.delete(action.id);
      throw error;
    }
    const commands = await this.request<Command[]>('commands', 'producer');
    const command = commands.find(c => c.approval_id === approval.approval_id);
    if (!command) throw new BridgeRejected('Accepted approval has no executable command');
    localActionId(command, { actionId: action.id, approvalId: approval.approval_id, candidate });
    const feed = view.feeds.find(f => f.asset_id === command.asset_id);
    if (!feed) throw new BridgeRejected('Producer capture scope unavailable');
    const binding = { command, feed, cancelPending: true, actionKey };
    this.commands.set(action.id, binding);
    this.attempts.delete(action.id);
    const current = await this.snapshot();
    const checked = await this.request<Command>('command-checks', 'producer', {
      command_id: command.command_id, expected_incident_revision: current.incident_revision,
    });
    if (JSON.stringify(checked) !== JSON.stringify(command)) throw new BridgeRejected('Command changed before execution');
    await this.request('events', 'producer', receiptForCommand(command, this.setup.roles.producer.principal_id, feed.capture_epoch, 'running', simTick));
    try { await execute(); }
    catch (error) {
      binding.cancelPending = true;
      try { await this.finish(action.id, 'cancelled', simTick); } catch { /* Retain the terminal outcome for observe() to retry. */ }
      throw error;
    }
    binding.cancelPending = false;
  }

  async observe(actions: readonly Action[], simTick: number): Promise<void> {
    for (const id of this.attempts.keys()) await this.reconcileApproval(id);
    for (const [id, binding] of this.commands) {
      const action = actions.find(a => a.id === id);
      const stale = !action || this.actionKey(action) !== binding.actionKey;
      const stage = binding.cancelPending || stale ? 'cancelled' : action.status === 'done' ? 'completed' : action.status !== 'executing' ? 'cancelled' : null;
      if (!stage) continue;
      await this.finish(id, stage, simTick);
    }
  }

  private async finish(id: string, stage: 'completed' | 'cancelled', simTick: number): Promise<void> {
    const binding = this.commands.get(id);
    if (!binding) return;
    let completion = this.completions.get(id);
    if (!completion) {
      const frame = await simulatedExecutionFrame(binding.command, binding.feed, this.setup.roles.producer.principal_id, stage, simTick);
      if (frame.event.kind !== 'frame.received') throw new BridgeRejected('Invalid execution frame');
      completion = { frame: frame.event, image: frame.image, receipt: receiptForCommand(binding.command,
        this.setup.roles.producer.principal_id, binding.feed.capture_epoch, stage, simTick, [frame.event.payload.evidence_id]) };
      this.completions.set(id, completion);
    }
    await this.request('events', 'producer', completion.frame);
    await this.request('events', 'producer', completion.receipt);
    this.commands.delete(id); this.completions.delete(id);
  }
  get pending(): number { return this.commands.size + this.attempts.size; }
}

/** Only an initial read may fall back. Ambiguous mutation failures never authorize execution. */
export async function approveWithBridge(bridge: OpsBridge | null, action: Action, execute: () => unknown, simTick: number): Promise<'local' | 'backend'> {
  if (!bridge) { await execute(); return 'local'; }
  try { await bridge.snapshot(); }
  catch (error) { if (error instanceof BridgeOffline && bridge.pending === 0) { await execute(); return 'local'; } throw error; }
  await bridge.approve(action, execute, simTick);
  return 'backend';
}
