import type {
  ActorContext,
  ApprovalRequest,
  CommitContext,
  EventInput,
  IncidentSeed,
} from '../protocol/types.ts';

export function seed(): IncidentSeed {
  return {
    contract_version: 'backend-protocol.v1',
    incident_id: 'i1',
    run_id: 'r1',
    authority_epoch: 1,
    incident_revision: 0,
    input_revision: 0,
    plan_revision: 0,
    reservation_revision: 0,
    chief_id: 'chief1',
    chief_epoch: 1,
    producer_id: 'sim1',
    capture_epoch: 1,
    authority_active: true,
    assets: [1, 2, 3, 4].map(n => ({
      asset_id: `d${n}`,
      capabilities: n <= 2 ? ['thermal', 'eo'] : ['thermal'],
      thermal_feed_id: `t${n}`,
      ...(n <= 2 ? { eo_feed_id: `eo${n}` } : {}),
    })),
    feeds: [1, 2, 3, 4, 5, 6].map(n => ({
      feed_id: n <= 4 ? `t${n}` : `eo${n - 4}`,
      asset_id: `d${n <= 4 ? n : n - 4}`,
      modality: n <= 4 ? 'thermal' : 'eo',
      source_kind: 'simulated',
      synthetic: true,
      radiometric: false,
      calibration: null,
      source_id: `source-d${n <= 4 ? n : n - 4}`,
      source_revision: 0,
      capture_owner_id: 'sim1',
      capture_epoch: 1,
      status: 'available',
    })),
    candidates: [1, 2, 3, 4].map(n => ({
      candidate_id: `c${n}`,
      action_id: 'inspect',
      asset_id: `d${n}`,
      mission_id: `m${n}`,
      mission_version: 1,
      route_id: `route${n}`,
      plan_revision: 0,
      feasibility_snapshot_id: `feasibility${n}`,
      feasible: true,
      expires_at_sim_tick: 120,
    })),
  };
}

export function context(actor_kind: ActorContext['actor_kind'] = 'simulator'): CommitContext {
  return {
    actor: {
      principal_id: actor_kind === 'simulator' ? 'sim1' : actor_kind === 'human' ? 'chief1' : `${actor_kind}1`,
      session_id: `session-${actor_kind}`,
      incident_id: 'i1',
      run_id: 'r1',
      actor_kind,
      chief_epoch: actor_kind === 'human' ? 1 : null,
      producer_id: actor_kind === 'simulator' ? 'sim1' : null,
      capture_epoch: actor_kind === 'simulator' ? 1 : null,
    },
    recorded_at: '2026-11-14T00:00:01Z',
    received_at: '2026-11-14T00:00:01Z',
    sim_tick: 1,
    mode: 'live',
  };
}

export function telemetry(stream_sequence = 1): EventInput {
  return {
    contract_version: 'backend-protocol.v1',
    incident_id: 'i1',
    run_id: 'r1',
    authority_epoch: 1,
    event_id: `telemetry${stream_sequence}`,
    stream_id: 'telemetry:d1',
    stream_sequence,
    trace_id: `trace-telemetry${stream_sequence}`,
    causation_id: null,
    kind: 'telemetry.received',
    payload: {
      asset_id: 'd1',
      mission_id: null,
      mission_version: 0,
      captured_at: '2026-11-14T00:00:01Z',
      capture_time_status: 'known',
      sim_tick: stream_sequence,
      position: { x_m: 100, y_m: 200, z_m: 300 },
      battery_percent: 90,
      producer_id: 'sim1',
      capture_epoch: 1,
    },
  };
}

export function frame(stream_sequence = 1): EventInput {
  return {
    contract_version: 'backend-protocol.v1',
    incident_id: 'i1',
    run_id: 'r1',
    authority_epoch: 1,
    event_id: `frame-event${stream_sequence}`,
    stream_id: 'frames:t1',
    stream_sequence,
    trace_id: `trace-frame${stream_sequence}`,
    causation_id: null,
    kind: 'frame.received',
    payload: {
      frame_id: `frame${stream_sequence}`,
      feed_id: 't1',
      asset_id: 'd1',
      evidence_id: `evidence${stream_sequence}`,
      source_snapshot_id: `snapshot${stream_sequence}`,
      source_revision: 0,
      capture_owner_id: 'sim1',
      capture_epoch: 1,
      captured_at: '2026-11-14T00:00:01Z',
      capture_time_status: 'known',
      sim_tick: stream_sequence,
      source_position: null,
      location_uncertainty_m: null,
      mime_type: 'image/png',
      byte_length: 1024,
      media_ref: `media${stream_sequence}`,
      content_hash: `hash${stream_sequence}`,
      width_px: 320,
      height_px: 180,
      media_limits_version: 'preview.v1',
    },
  };
}

export function proposal(): EventInput {
  return {
    contract_version: 'backend-protocol.v1',
    incident_id: 'i1',
    run_id: 'r1',
    authority_epoch: 1,
    event_id: 'proposal-event1',
    stream_id: 'proposals:analyst1',
    stream_sequence: 1,
    trace_id: 'trace-proposal1',
    causation_id: null,
    kind: 'proposal.created',
    payload: {
      proposal_id: 'p1',
      proposal_revision: 1,
      candidate_ids: ['c1'],
      input_revision: 0,
      plan_revision: 0,
      reservation_revision: 0,
      chief_epoch: 1,
      rationale: 'EXERCISE: inspect the declared candidate route.',
      expires_at_sim_tick: 120,
    },
  };
}

export function approval(expected_incident_revision = 1): ApprovalRequest {
  return {
    contract_version: 'backend-protocol.v1',
    incident_id: 'i1',
    run_id: 'r1',
    authority_epoch: 1,
    approval_id: 'a1',
    proposal_id: 'p1',
    proposal_revision: 1,
    candidate_id: 'c1',
    expected_incident_revision,
    input_revision: 0,
    plan_revision: 0,
    reservation_revision: 0,
    chief_epoch: 1,
    expires_at_sim_tick: 120,
  };
}

export function malformedEvents(): readonly unknown[] {
  const invalidTimes = [
    '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-06-31T00:00:00Z', '2026-09-31T00:00:00Z',
    '2026-11-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z', '2026-01-32T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-1-01T00:00:00Z',
    '2026-01-1T00:00:00Z', '2026-01-01T0:00:00Z', '2026-01-01T00:0:00Z',
    '2026-01-01T00:00:0Z', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00',
    '2026-01-01T00:00:00.1Z', '2026-01-01T00:00:00.12Z',
    '2026-01-01T00:00:00.1234Z', ' 2026-01-01T00:00:00Z',
  ];
  const events: unknown[] = invalidTimes.map(captured_at => {
    const event = telemetry();
    return { ...event, payload: { ...event.payload, captured_at } };
  });
  const badNumbers = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, JSON.parse('1e400')];
  for (let n = 0; n < 25; n++) {
    const event = telemetry();
    const field = n < 7 ? 'stream_sequence' : n < 14 ? 'authority_epoch' : n < 21 ? 'sim_tick' : 'capture_epoch';
    const value = badNumbers[n % badNumbers.length];
    events.push(n < 14 ? { ...event, [field]: value } : { ...event, payload: { ...event.payload, [field]: value } });
  }
  const unknownKeys = ['__proto__', 'constructor', 'prototype', 'actor_id', 'actor_kind', 'session_id', 'chief_id', 'recorded_at', 'received_at', 'incident_revision'];
  for (let n = 0; n < 25; n++) {
    const event = n === 0 ? frame() : telemetry();
    if (n === 0) events.push({ ...event, payload: { ...event.payload, modality: 'infrared' } });
    else if (n === 1) events.push({ ...event, contract_version: 'backend-protocol.v0' });
    else if (n === 2) events.push({ ...event, kind: 'world.changed' });
    else if (n < 13) events.push({ ...event, [unknownKeys[n - 3]]: 'forged' });
    else events.push({ ...event, payload: { ...event.payload, [unknownKeys[(n - 13) % unknownKeys.length]]: 'forged' } });
  }
  const required = ['contract_version', 'incident_id', 'run_id', 'event_id', 'stream_id', 'trace_id', 'kind', 'payload', 'asset_id', 'producer_id', 'captured_at', 'position', 'mission_id'];
  for (let n = 0; n < 25; n++) {
    const event = telemetry();
    const field = required[n % required.length];
    if (n % required.length < 8) {
      const copy = { ...event } as Record<string, unknown>;
      delete copy[field];
      events.push(copy);
    } else {
      const payload = { ...event.payload } as Record<string, unknown>;
      delete payload[field];
      events.push({ ...event, payload });
    }
  }
  return events;
}
