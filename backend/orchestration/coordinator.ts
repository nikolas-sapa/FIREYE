import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import { SponsorJobs } from '../integrations/jobs.ts';
import { closed, fail, freeze, plainJson, serverReceipt, validSnapshot } from '../integrations/receipts.ts';
import { createQueuedIrisClient } from './queued-iris.ts';
import { createQueuedGeminiClient } from './queued-gemini.ts';
import type { BridgeAuthority, BridgeResult } from '../integration/session.ts';
import type { ActorContext, IncidentState, Result } from '../protocol/types.ts';
import type { MissionPlanningSnapshot, ProposedMissionOption } from '../planning/mission-types.ts';
import type { IrisRanking } from '../integrations/iris/types.ts';
import type { EvidenceAnalysis } from '../integrations/gemini/types.ts';
import type { ClientConfig, Receipt, Result as SponsorResult, Snapshot } from '../integrations/receipts.ts';
import type { ExerciseAssessment, ExerciseCoordinatorConfig, ExerciseCoordinatorState, ExerciseLayout, ExerciseObjective } from './types.ts';

const success = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
const reject = (reason: string, code: 'INVALID_SCHEMA' | 'STALE_VERSION' | 'FROZEN' | 'CONFLICT' = 'INVALID_SCHEMA'): Result<never> =>
  Object.freeze({ ok: false, code, reason });
const localId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim().length > 0;
const terminal = (status: string): boolean => ['completed', 'failed', 'cancelled', 'rejected'].includes(status);
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
const hash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export const exerciseCourseFingerprint = (course: ProposedMissionOption): string => hash(course);

function objectiveGuard(input: unknown): input is ExerciseObjective {
  return plainJson(input) && closed(input, ['objective_id', 'capture_goal', 'required_capabilities', 'created_at_sim_tick'])
    && localId(input.objective_id) && input.capture_goal === 'refresh_coverage'
    && Number.isSafeInteger(input.created_at_sim_tick) && (input.created_at_sim_tick as number) >= 0
    && Array.isArray(input.required_capabilities) && input.required_capabilities.length > 0
    && input.required_capabilities.length <= 2 && new Set(input.required_capabilities).size === input.required_capabilities.length
    && input.required_capabilities.every(item => item === 'eo' || item === 'thermal');
}

function versions(state: IncidentState): string {
  return canonical([state.incident_id, state.run_id, state.authority_epoch, state.input_revision,
    state.plan_revision, state.reservation_revision, state.chief_epoch, state.authority_active]);
}

/** Only received telemetry/frames and explicit toy configuration cross this seam. */
export function createPlanningSnapshot(authority: BridgeAuthority, input: unknown, layout: ExerciseLayout): Result<MissionPlanningSnapshot> {
  if (!objectiveGuard(input) || !plainJson(layout)
    || !closed(layout, ['approved_region', 'sectors', 'drones', 'blocked_areas', 'policy', 'rights_manifests'])
    || !Array.isArray(layout.sectors) || layout.sectors.length > 3
    || !layout.sectors.every(sector => closed(sector, ['sector_id', 'bounds', 'evidence_ids', 'coverage_age_ticks'])
      && Array.isArray(sector.evidence_ids) && sector.evidence_ids.every(localId))
    || !Array.isArray(layout.drones) || layout.drones.length > 3
    || !layout.drones.every(item => closed(item, ['drone_id', 'home', 'reserve_units', 'link_available']) && localId(item.drone_id))) {
    return reject('Expected closed objective and declared exercise layout');
  }
  const state = authority.read();
  if (!state.authority_active) return reject('Exercise authority frozen', 'FROZEN');
  let now;
  try { now = authority.now(); } catch { return reject('Trusted exercise clock unavailable', 'FROZEN'); }
  // Latest-per-feed cache replaces old frames; cited received evidence remains
  // factual in canonical log and must not disappear when a new frame arrives.
  const frames = state.log.filter(row => row.kind === 'frame.received')
    .filter(row => layout.sectors.some(sector => sector.evidence_ids.includes(row.payload.evidence_id)));
  const evidence = frames.map(row => {
    const feed = state.seed.feeds.find(item => item.feed_id === row.payload.feed_id)!;
    return { evidence_id: row.payload.evidence_id, source_snapshot_id: row.payload.source_snapshot_id,
      source_id: feed.source_id, source_kind: feed.source_kind, synthetic: feed.synthetic,
      captured_at_sim_tick: row.payload.capture_time_status === 'known' ? row.payload.sim_tick : null,
      received_at_sim_tick: row.sim_tick };
  });
  const drones = layout.drones.flatMap(item => {
    const row = state.telemetry[item.drone_id]; const asset = state.seed.assets.find(value => value.asset_id === item.drone_id);
    if (!row?.payload.position || !asset) return [];
    return [{ ...item, position: row.payload.position, capabilities: asset.capabilities,
      feeds: state.seed.feeds.filter(feed => feed.asset_id === asset.asset_id).map(feed => ({ feed_id: feed.feed_id,
        modality: feed.modality, status: feed.status, source_id: feed.source_id, source_kind: feed.source_kind, synthetic: feed.synthetic })) }];
  });
  const observed = Math.max(0, ...frames.map(row => row.sim_tick), ...drones.map(item => state.telemetry[item.drone_id].sim_tick));
  const snapshot_id = `snapshot:${hash([versions(state), evidence, drones, layout])}`;
  const active_leases = Object.values(state.reservations).filter(value => value.expires_at_sim_tick > now.sim_tick
    && !Object.values(state.commands).some(command => command.approval_id === value.approval_id && terminal(command.status)))
    .flatMap(value => layout.sectors.map(sector => ({ lease_id: `${value.reservation_id}:${sector.sector_id}`,
      drone_id: value.asset_id, sector_id: sector.sector_id, expires_at_sim_tick: value.expires_at_sim_tick })));
  const snapshot: MissionPlanningSnapshot = { snapshot_id, incident_id: state.incident_id, run_id: state.run_id,
    input_revision: state.input_revision, observed_at_sim_tick: observed, intent_id: `intent:${hash([input, snapshot_id])}`,
    intent_created_at_sim_tick: input.created_at_sim_tick,
    objective: { objective_id: input.objective_id, capture_goal: input.capture_goal, required_capabilities: input.required_capabilities },
    approved_region: layout.approved_region, sectors: layout.sectors, drones, evidence,
    active_leases, blocked_areas: layout.blocked_areas, policy: layout.policy };
  // Validate through the real planner, not a duplicate permissive DTO guard.
  const plan = generateMissionCandidates(snapshot, { incident_id: state.incident_id, run_id: state.run_id,
    input_revision: state.input_revision, current_sim_tick: now.sim_tick, mode: 'live', used_intent_ids: [] });
  return plan.ok ? success(freeze(structuredClone(snapshot))) : plan;
}

function sponsorSnapshot(state: IncidentState, snapshot: MissionPlanningSnapshot, layout: ExerciseLayout, now: number): Snapshot | null {
  const evidence = snapshot.evidence.map(item => {
    const row = state.log.filter(value => value.kind === 'frame.received').find(value => value.payload.evidence_id === item.evidence_id)!;
    const feed = state.seed.feeds.find(value => value.feed_id === row.payload.feed_id)!;
    return { evidence_id: item.evidence_id, source_id: item.source_id, rights_manifest_id: layout.rights_manifests[feed.feed_id],
      source_kind: item.source_kind, captured_at_ms: row.payload.captured_at === null ? null : Date.parse(row.payload.captured_at),
      received_at_ms: Date.parse(row.received_at), modality: feed.modality, synthetic: item.synthetic,
      radiometric: feed.radiometric === false ? false as const : 'unknown' as const, calibration: null,
      content_hash: row.payload.content_hash, byte_length: row.payload.byte_length,
      width_px: row.payload.width_px, height_px: row.payload.height_px };
  });
  const result: Snapshot = { incident_id: state.incident_id, run_id: state.run_id, authority_epoch: state.authority_epoch,
    input_revision: state.input_revision, snapshot_id: snapshot.snapshot_id, received_cutoff_ms: now,
    valid_until_ms: now + 8000, evidence };
  return validSnapshot(result, now) ? freeze(result) : null;
}

function rankingGuard(input: unknown, ids: readonly string[]): input is IrisRanking {
  if (!plainJson(input) || !closed(input, ['kind', 'ranking']) || input.kind !== 'finite-ranking'
    || !Array.isArray(input.ranking) || input.ranking.length !== ids.length || ids.length === 0) return false;
  const seen = new Set<string>(); let total = 0;
  for (const row of input.ranking) {
    if (!closed(row, ['candidate_id', 'score', 'scale']) || !localId(row.candidate_id)
      || !ids.includes(row.candidate_id) || seen.has(row.candidate_id) || typeof row.score !== 'number'
      || !Number.isFinite(row.score) || row.score < 0 || row.score > 1
      || row.scale !== 'provider choice probability, not calibrated incident probability') return false;
    seen.add(row.candidate_id); total += row.score;
  }
  return Math.abs(total - 1) <= .001;
}

const failureCodes = new Set(['DISABLED', 'UNAUTHORIZED', 'UNSUPPORTED', 'INVALID_INPUT', 'STALE', 'BUDGET', 'DEADLINE',
  'TRANSPORT', 'REDIRECT', 'OVERSIZE', 'INVALID_REPLY', 'QUEUE_FULL', 'IDENTITY_CONFLICT']);

/** Custom clients are untrusted. Inspect own values, never execute getters or
 * copy a caller-provided receipt. Only actual issued receipts can carry origin. */
function replyValues(input: unknown): { ok: boolean; value: unknown; code: string; receipt: unknown } {
  const invalid = { ok: false, value: null, code: 'INVALID_REPLY', receipt: null };
  if (!input || typeof input !== 'object' || types.isProxy(input) || Array.isArray(input)) return invalid;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string'
    || !['ok', 'value', 'code', 'receipt'].includes(key) || !Object.hasOwn(descriptors[key], 'value'))) return invalid;
  if (descriptors.ok?.value !== true && descriptors.ok?.value !== false) return invalid;
  const rawCode: unknown = descriptors.code?.value;
  return { ok: descriptors.ok.value, value: descriptors.value?.value,
    code: typeof rawCode === 'string' && failureCodes.has(rawCode) ? rawCode : 'INVALID_REPLY', receipt: descriptors.receipt?.value };
}

function boundReceipt(input: unknown, snapshot: Snapshot, ids: readonly string[], status: string): Receipt | null {
  if (!serverReceipt(input) || input.adapter !== 'iris' || input.snapshot_id !== snapshot.snapshot_id
    || input.input_hash !== createHash('sha256').update(JSON.stringify({ snapshot, candidate_ids: ids })).digest('hex')
    || input.status !== status || input.endpoint !== 'https://inference.oumi.ai/v1/systemone'
    || typeof input.model !== 'string' || !/^projects\/[A-Za-z0-9_-]{1,128}\/models\/iris(?:-[A-Za-z0-9_-]{1,40})?$/.test(input.model)
    || canonical(input.evidence_ids) !== canonical(snapshot.evidence.map(item => item.evidence_id))) return null;
  return input;
}

/** No approval, execution or receipt generation happens during assessment. */
export function createExerciseCoordinator(authority: BridgeAuthority, config: ExerciseCoordinatorConfig) {
  const analyst = freeze(structuredClone(config.analyst));
  const layout = freeze(structuredClone(config.layout));
  const manifests = freeze(structuredClone(config.reviewed_courses));
  const scope = authority.read();
  const sponsorVersions = new Map<string, string>();
  const enabled = config.sponsors?.enabled === true;
  const readEvidence = config.sponsors?.read_evidence;
  const sponsorConfig: ClientConfig = { enabled, authorization_id: config.sponsors?.authorization_id,
    budget: config.sponsors?.budget, max_call_micro: config.sponsors?.max_call_micro,
    deadline_ms: config.sponsors?.deadline_ms, now: () => Date.parse(authority.now().received_at),
    is_current: snapshot => {
      const state = authority.read();
      return state.authority_active && state.incident_id === scope.incident_id && state.run_id === scope.run_id
        && snapshot.incident_id === state.incident_id && snapshot.run_id === state.run_id
        && snapshot.authority_epoch === state.authority_epoch && snapshot.input_revision === state.input_revision
        && sponsorVersions.get(snapshot.snapshot_id) === versions(state);
    } };
  const sponsorJobs = new SponsorJobs(sponsorConfig);
  const iris = config.iris ?? createQueuedIrisClient({ ...sponsorConfig,
    model: config.sponsors?.iris?.model, transport: config.sponsors?.iris?.transport,
    transport_mode: config.sponsors?.iris?.transport_mode,
    registered_candidate_ids: scope.seed.candidates.map(candidate => candidate.candidate_id) }, sponsorJobs);
  const gemini = createQueuedGeminiClient({ ...sponsorConfig,
    model: config.sponsors?.gemini?.model, transport: config.sponsors?.gemini?.transport,
    transport_mode: config.sponsors?.gemini?.transport_mode }, sponsorJobs);
  const jobs = new Map<string, { assessment: ExerciseAssessment; promise: Promise<Result<ExerciseAssessment>>; versions: string; snapshot: MissionPlanningSnapshot }>();
  const analyses = new Map<string, { promise: Promise<SponsorResult<EvidenceAnalysis>>; snapshot: Snapshot }>();
  let inFlight = 0;

  function rememberSponsor(snapshot: Snapshot, state: IncidentState): boolean {
    if (!sponsorVersions.has(snapshot.snapshot_id) && sponsorVersions.size >= 256) return false;
    sponsorVersions.set(snapshot.snapshot_id, versions(state));
    return true;
  }

  async function analyzeEvidence(input: unknown): Promise<SponsorResult<EvidenceAnalysis>> {
    if (!enabled) return fail('DISABLED');
    if (!plainJson(input) || !closed(input, ['objective', 'evidence_id']) || !localId(input.evidence_id)) return fail('INVALID_INPUT');
    try {
      const projected = createPlanningSnapshot(authority, input.objective, layout);
      if (!projected.ok) return fail(projected.code === 'INVALID_SCHEMA' ? 'INVALID_INPUT' : 'STALE');
      const state = authority.read(); const expected = versions(state);
      const identity = hash([projected.value, input.evidence_id, expected]);
      let job = analyses.get(identity);
      if (!job) {
        if (analyses.size >= 256) return fail('QUEUE_FULL');
        const sponsor = sponsorSnapshot(state, projected.value, layout, Date.parse(authority.now().received_at));
        if (!sponsor || !sponsor.evidence.some(e => e.evidence_id === input.evidence_id && e.modality === 'eo')) return fail('INVALID_INPUT');
        if (!rememberSponsor(sponsor, state)) return fail('QUEUE_FULL');
        if (!sponsorConfig.is_current!(sponsor)) return fail('STALE');
        if (!readEvidence) return fail('UNSUPPORTED');
        const frame = state.log.find(row => row.kind === 'frame.received' && row.payload.evidence_id === input.evidence_id);
        if (!frame || frame.kind !== 'frame.received') return fail('INVALID_INPUT');
        const bytes = readEvidence(input.evidence_id, frame.payload.media_ref);
        if (!plainJson(bytes) || !closed(bytes, ['png_base64'])) return fail('INVALID_INPUT');
        job = { promise: gemini.analyze({ snapshot: sponsor, evidence_id: input.evidence_id, png_base64: bytes.png_base64 }), snapshot: sponsor };
        analyses.set(identity, job);
      }
      const sponsor = job.snapshot;
      const result = await job.promise;
      if (versions(authority.read()) !== expected || !sponsorConfig.is_current!(sponsor)
        || !validSnapshot(sponsor, Date.parse(authority.now().received_at))
        || !createPlanningSnapshot(authority, input.objective, layout).ok) return fail('STALE');
      return result;
    } catch { return fail('STALE'); }
  }

  function refresh(): void {
    const current = versions(authority.read());
    let tick;
    try { tick = authority.now().sim_tick; } catch { tick = Infinity; }
    for (const job of jobs.values()) if (job.assessment.status !== 'superseded'
      && (job.versions !== current || tick >= job.snapshot.intent_created_at_sim_tick + layout.policy.intent_ttl_ticks
        || tick - job.snapshot.observed_at_sim_tick > layout.policy.snapshot_max_age_ticks)) {
      job.assessment = freeze({ ...job.assessment, status: 'superseded', reasons: [...job.assessment.reasons,
        job.versions !== current ? 'received_versions_changed' : 'snapshot_or_intent_expired'] });
    }
  }

  function eligible(course: ProposedMissionOption, snapshot: MissionPlanningSnapshot): boolean {
    if (course.assignments.length !== 1 || course.kind === 'hold') return false;
    const manifest = manifests.find(value => value.option_id === course.option_id && value.course_fingerprint === exerciseCourseFingerprint(course));
    const assignment = course.assignments[0]; const state = authority.read();
    const candidate = state.seed.candidates.find(value => value.candidate_id === manifest?.candidate_id);
    return !!candidate && candidate.candidate_id === assignment.candidate_id && candidate.action_id === assignment.action_id
      && candidate.asset_id === assignment.drone_id && candidate.route_id === assignment.route_id
      && candidate.mission_id === assignment.mission_id && candidate.mission_version === 1
      && candidate.plan_revision === state.plan_revision && candidate.feasibility_snapshot_id === snapshot.snapshot_id
      && candidate.feasible && candidate.expires_at_sim_tick > authority.now().sim_tick;
  }

  function assess(input: unknown): Promise<Result<ExerciseAssessment>> {
    refresh();
    const projected = createPlanningSnapshot(authority, input, layout);
    if (!projected.ok) return Promise.resolve(projected);
    const snapshot = projected.value; const state = authority.read(); const now = authority.now();
    const identity = `assessment:${hash([snapshot, versions(state)])}`;
    const duplicate = jobs.get(identity);
    if (duplicate) return duplicate.promise.then(result => {
      refresh();
      return duplicate.assessment.status === 'superseded'
        ? reject('Assessment superseded', 'STALE_VERSION') : result.ok ? success(duplicate.assessment) : result;
    });
    if (jobs.size >= 64 || inFlight >= 2) return Promise.resolve(reject('Bounded local assessment limit reached', 'CONFLICT'));
    const planned = generateMissionCandidates(snapshot, { incident_id: state.incident_id, run_id: state.run_id,
      input_revision: state.input_revision, current_sim_tick: now.sim_tick, mode: 'live', used_intent_ids: [] });
    if (!planned.ok) return Promise.resolve(planned);
    // New objective supersedes prior uncommitted review, even without observation.
    for (const job of jobs.values()) if (job.snapshot.intent_id !== snapshot.intent_id
      && ['assessing', 'review_ready', 'review_only', 'proposed'].includes(job.assessment.status)) {
      job.assessment = freeze({ ...job.assessment, status: 'superseded', reasons: [...job.assessment.reasons, 'new_objective'] });
    }
    const courses = planned.value.options.filter(course => eligible(course, snapshot));
    const ids = courses.map(course => course.assignments[0].candidate_id);
    const initial: ExerciseAssessment = freeze({ contract_version: 'orchestration-demo.v1', mode: 'EXERCISE',
      verification_status: 'unverified', assessment_id: identity, snapshot_id: snapshot.snapshot_id,
      objective_id: snapshot.objective.objective_id, input_revision: snapshot.input_revision, status: 'assessing',
      plan: planned.value, selected_option_id: null, registered_candidate_ids: ids, proposal_id: null, command_id: null,
      ranking: { source: 'deterministic-fallback', reason: 'pending', receipt: null },
      evidence_ids: snapshot.evidence.map(item => item.evidence_id), reasons: ['received_metadata_only', 'declared_toy_policy_not_flight_safety'] });
    let resolve!: (result: Result<ExerciseAssessment>) => void;
    const promise = new Promise<Result<ExerciseAssessment>>(done => { resolve = done; });
    const job = { assessment: initial, promise, versions: versions(state), snapshot };
    jobs.set(identity, job); inFlight++;
    const sponsor = sponsorSnapshot(state, snapshot, layout, Date.parse(now.received_at));
    // Execute immediately after storing job, so concurrent identical inputs dedupe.
    void (async () => {
      let ranking: ExerciseAssessment['ranking'] = { source: 'deterministic-fallback', reason: ids.length ? 'RECEIVED_METADATA_UNAVAILABLE' : 'NO_REVIEWED_REGISTRATION', receipt: null };
      let selected: ProposedMissionOption | null = courses[0] ?? null;
      try {
        if (ids.length > 0 && sponsor && (!enabled || rememberSponsor(sponsor, state))) {
          const reply = replyValues(await iris.analyze({ snapshot: sponsor, candidate_ids: ids }));
          const receipt = boundReceipt(reply.receipt, sponsor, ids, reply.ok ? 'accepted' : reply.code);
          if (reply.ok && rankingGuard(reply.value, ids)) {
            const ranked = [...reply.value.ranking].sort((a, b) => b.score - a.score || a.candidate_id.localeCompare(b.candidate_id));
            selected = courses.find(course => course.assignments[0].candidate_id === ranked[0].candidate_id) ?? null;
            ranking = { source: 'validated-ranking', reason: receipt ? 'finite_received_snapshot_ranking'
              : 'fixture_finite_ranking_without_provider_receipt', receipt };
          } else ranking = { source: 'deterministic-fallback', reason: reply.ok ? 'INVALID_REPLY' : reply.code, receipt };
        }
      } catch { ranking = { source: 'deterministic-fallback', reason: 'TRANSPORT', receipt: null }; }
      finally { inFlight--; }
      refresh();
      if (job.assessment.status === 'superseded') { resolve(reject('Ranking snapshot superseded', 'STALE_VERSION')); return; }
      job.assessment = freeze({ ...job.assessment, status: selected ? 'review_ready' : 'review_only',
        selected_option_id: selected?.option_id ?? null, ranking,
        reasons: [...job.assessment.reasons, selected ? 'exact_seed_registered_exercise_course' : 'dynamic_registration_absent_review_only'] });
      resolve(success(job.assessment));
    })();
    return promise.then(result => {
      refresh();
      return job.assessment.status === 'superseded'
        ? reject('Assessment superseded', 'STALE_VERSION') : result.ok ? success(job.assessment) : result;
    });
  }

  function commitReview(assessmentId: string, optionId: string): BridgeResult<ExerciseAssessment> {
    refresh(); const job = jobs.get(assessmentId);
    if (!job || job.assessment.status !== 'review_ready' || optionId !== job.assessment.selected_option_id) {
      return reject('Unknown, stale or unselected review', 'STALE_VERSION');
    }
    const course = job.assessment.plan.options.find(value => value.option_id === optionId)!;
    if (!eligible(course, job.snapshot)) return reject('Review does not match immutable registered exercise course');
    const state = authority.read(); const now = authority.now();
    const current = generateMissionCandidates(job.snapshot, { incident_id: state.incident_id, run_id: state.run_id,
      input_revision: state.input_revision, current_sim_tick: now.sim_tick, mode: 'live', used_intent_ids: [] });
    if (!current.ok) return current;
    if (!current.value.options.some(value => exerciseCourseFingerprint(value) === exerciseCourseFingerprint(course))) {
      return reject('Planner context changed before proposal commit', 'STALE_VERSION');
    }
    const candidate = state.seed.candidates.find(value => value.candidate_id === course.assignments[0].candidate_id)!;
    const proposal_id = `proposal:${hash([assessmentId, optionId])}`; const stream_id = `orchestration:${analyst.principal_id}`;
    const result = authority.ingest({ contract_version: state.contract_version, incident_id: state.incident_id,
      run_id: state.run_id, authority_epoch: state.authority_epoch, event_id: `event:${hash(proposal_id)}`,
      stream_id, stream_sequence: (state.stream_cursors[stream_id] ?? 0) + 1,
      trace_id: assessmentId, causation_id: null, kind: 'proposal.created', payload: {
        proposal_id, proposal_revision: 1, candidate_ids: [candidate.candidate_id], input_revision: state.input_revision,
        plan_revision: state.plan_revision, reservation_revision: state.reservation_revision, chief_epoch: state.chief_epoch,
        rationale: `EXERCISE, unverified. Exact reviewed toy course; evidence: ${job.assessment.evidence_ids.join(',')}`,
        expires_at_sim_tick: Math.min(candidate.expires_at_sim_tick, job.snapshot.intent_created_at_sim_tick + layout.policy.intent_ttl_ticks),
      } }, analyst);
    if (!result.ok) return result;
    job.assessment = freeze({ ...job.assessment, status: 'proposed', proposal_id });
    return success(job.assessment);
  }

  function approve(assessmentId: string, approvalId: string, actor: ActorContext): BridgeResult<ExerciseAssessment> {
    refresh(); const job = jobs.get(assessmentId);
    if (!job || job.assessment.status !== 'proposed' || !localId(approvalId)) return reject('Current proposed review required', 'STALE_VERSION');
    const state = authority.read(); const proposal = state.proposals[job.assessment.proposal_id!].payload;
    const result = authority.approve({ contract_version: state.contract_version, incident_id: state.incident_id,
      run_id: state.run_id, authority_epoch: state.authority_epoch, approval_id: approvalId,
      proposal_id: proposal.proposal_id, proposal_revision: proposal.proposal_revision,
      candidate_id: proposal.candidate_ids[0], expected_incident_revision: state.incident_revision,
      input_revision: proposal.input_revision, plan_revision: proposal.plan_revision,
      reservation_revision: proposal.reservation_revision, chief_epoch: proposal.chief_epoch,
      expires_at_sim_tick: proposal.expires_at_sim_tick }, actor);
    if (!result.ok) return result;
    job.versions = versions(result.value);
    job.assessment = freeze({ ...job.assessment, status: 'approved', command_id: `command:${approvalId}` });
    return success(job.assessment);
  }

  function read(): ExerciseCoordinatorState {
    refresh(); return freeze({ mode: 'EXERCISE', assessment_count: jobs.size, in_flight: inFlight,
      assessments: [...jobs.values()].map(job => job.assessment) });
  }
  return Object.freeze({ assess, analyzeEvidence, refresh, commitReview, approve, read,
    sponsorCounts: () => sponsorJobs.counts() });
}
