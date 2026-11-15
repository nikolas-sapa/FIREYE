/**
 * Agent pipeline: one autoscaling pool of sandboxed workers per input modality,
 * plus the projection agent and the Orchestrator. Jobs move queued -> running ->
 * done. All pipeline durations and rates are on the "agent clock": sim seconds
 * divided by AGENT_TIME_SCALE, which equals real seconds at 1x speed. Job
 * timestamps (queuedAt, startedAt) are sim seconds like the rest of the snapshot.
 */
import type { AgentPool, AnalysisJob, SourceKind } from './types';

/** Sim seconds per agent-clock second (matches SIM_TIME_SCALE, so 1 agent s = 1 real s at 1x). */
export const AGENT_TIME_SCALE = 30;
export const SANDBOX = 'boxd';

export type PoolId = SourceKind | 'projection' | 'orchestrator';

export interface PoolDef {
  id: PoolId;
  role: AgentPool['role'];
  label: string;
  provider: string;
  model: string;
  /** Model per stage; web jobs run Firecrawl first, then a Treq extraction LLM. */
  stages: { at: number; model: string; stage: string }[];
  inputs: string;
  prefix: string;
  minWorkers: number;
  maxWorkers: number;
  /** Agent-clock seconds. */
  dur: [number, number];
}

export const POOL_DEFS: PoolDef[] = [
  { id: 'web', role: 'analysis', label: 'News & web', provider: 'firecrawl · treq', model: 'search+scrape → extraction LLM',
    stages: [{ at: 0, model: 'firecrawl · search+scrape', stage: 'search+scrape' }, { at: 0.55, model: 'treq · extraction LLM', stage: 'extraction LLM' }],
    inputs: 'Local news · county OES · CHP incidents', prefix: 'SCRAPE', minWorkers: 1, maxWorkers: 6, dur: [3, 9] },
  { id: 'satellite', role: 'analysis', label: 'Satellite imagery', provider: 'fal', model: 'vision',
    stages: [{ at: 0, model: 'fal · vision', stage: 'vision' }],
    inputs: 'NASA FIRMS · Sentinel-2 · GOES-18', prefix: 'ORBIT', minWorkers: 1, maxWorkers: 10, dur: [2, 7] },
  { id: 'ground-cam', role: 'analysis', label: 'Vehicle cameras', provider: 'fal', model: 'video-understanding',
    stages: [{ at: 0, model: 'fal · video-understanding', stage: 'video-understanding' }],
    inputs: 'Engine and dozer dash cams', prefix: 'DASH', minWorkers: 1, maxWorkers: 8, dur: [2, 6] },
  { id: 'drone-cam', role: 'analysis', label: 'Drone video', provider: 'fal', model: 'video-understanding',
    stages: [{ at: 0, model: 'fal · video-understanding', stage: 'video-understanding' }],
    inputs: 'HAWK-1…6 EO / IR', prefix: 'VISION', minWorkers: 2, maxWorkers: 12, dur: [1.5, 5] },
  { id: 'social', role: 'analysis', label: 'Social video', provider: 'fal', model: 'video-understanding',
    stages: [{ at: 0, model: 'fal · video-understanding', stage: 'video-understanding' }],
    inputs: 'Geotagged posts near the AO', prefix: 'SOCIAL', minWorkers: 1, maxWorkers: 8, dur: [4, 11] },
  { id: 'weather', role: 'analysis', label: 'Weather', provider: 'NWS API', model: 'gridpoint + RAWS',
    stages: [{ at: 0, model: 'NWS API · gridpoint + RAWS', stage: 'fetch' }],
    inputs: 'NWS gridpoints · Pine Hollow RAWS', prefix: 'WX', minWorkers: 1, maxWorkers: 2, dur: [1, 2] },
  { id: 'terrain', role: 'analysis', label: 'Terrain & fuels', provider: 'USGS 3DEP', model: 'DEM + fuel model',
    stages: [{ at: 0, model: 'USGS 3DEP · DEM + fuel model', stage: 'fetch' }],
    inputs: 'USGS 3DEP · LANDFIRE', prefix: 'DEM', minWorkers: 1, maxWorkers: 2, dur: [2, 4] },
  { id: 'radio', role: 'analysis', label: 'Radio traffic', provider: 'treq', model: 'transcribe + extract',
    stages: [{ at: 0, model: 'treq · transcribe + extract', stage: 'transcribe' }],
    inputs: 'CMD NET · TAC 2 · AIR NET', prefix: 'RADIO', minWorkers: 1, maxWorkers: 3, dur: [1.5, 4] },
  { id: 'projection', role: 'projection', label: 'Projection agent', provider: 'treq', model: 'reasoning',
    stages: [{ at: 0, model: 'treq · reasoning', stage: 'reasoning' }],
    inputs: 'Perimeter · wind · fuels · slope', prefix: 'PROJ', minWorkers: 1, maxWorkers: 4, dur: [4, 10] },
  { id: 'orchestrator', role: 'orchestrator', label: 'Orchestrator', provider: 'treq', model: 'reasoning',
    stages: [{ at: 0, model: 'treq · reasoning', stage: 'grading' }],
    inputs: 'All findings · projection · forces', prefix: 'ORCH', minWorkers: 1, maxWorkers: 3, dur: [1, 3] },
];

export interface JobRequest {
  input: string;
  /** Agent-clock seconds; drawn from the pool range when omitted. */
  durationS?: number;
  onDone?(job: AnalysisJob): { findings?: number; observationIds?: string[] } | void;
}

interface Rt {
  def: PoolDef;
  ready: number;
  boots: number[]; // agent-clock times when booting workers become ready
  busy: number;
  slotsInUse: Set<number>;
  queue: Live[];
  idle: number;
  doneAt: number[]; // agent-clock completion times (throughput window)
  lat: number[]; // recent queue→done latencies, agent seconds
  scaling: 'up' | 'down' | 'steady';
  scaleHold: number;
}

interface Live {
  job: AnalysisJob;
  pool: Rt;
  slot: number;
  req: JobRequest;
  endAt: number; // sim seconds
}

export interface Pipeline {
  enqueue(pool: PoolId, req: JobRequest): AnalysisJob;
  /** Advance by sim seconds. */
  update(simDt: number): void;
  /** Sim clock used for job timestamps (continuous). */
  readonly now: number;
  queueDepth(pool: PoolId): number;
  snapshotJobs(): AnalysisJob[];
  snapshotPools(): AgentPool[];
  reset(simNow: number): void;
  stats(): { queued: number; running: number; done: number; workers: number };
}

export function createPipeline(rand: () => number): Pipeline {
  let now = 0;
  let idc = 0;
  const pools = new Map<PoolId, Rt>();
  let running: Live[] = [];
  let done: AnalysisJob[] = [];
  let totalDone = 0;

  const agentNow = () => now / AGENT_TIME_SCALE;

  function init(simNow: number) {
    now = simNow;
    idc = 0;
    pools.clear();
    running = [];
    done = [];
    totalDone = 0;
    for (const def of POOL_DEFS) {
      pools.set(def.id, {
        def, ready: def.minWorkers, boots: [], busy: 0, slotsInUse: new Set(), queue: [], idle: 0,
        doneAt: [], lat: [], scaling: 'steady', scaleHold: 0,
      });
    }
  }
  init(0);

  function stageFor(def: PoolDef, progress: number) {
    let s = def.stages[0];
    for (const st of def.stages) if (progress >= st.at) s = st;
    return s;
  }

  function freeSlot(p: Rt) {
    let k = 1;
    while (p.slotsInUse.has(k)) k++;
    p.slotsInUse.add(k);
    return k;
  }

  function start(p: Rt, l: Live) {
    l.slot = freeSlot(p);
    const st = stageFor(p.def, 0);
    l.job = {
      ...l.job, status: 'running', startedAt: now, agent: `${p.def.prefix}-${String(l.slot).padStart(2, '0')}`,
      model: st.model, stage: st.stage, progress: 0,
    };
    l.endAt = now + l.job.durationS * AGENT_TIME_SCALE;
    p.busy++;
    running.push(l);
  }

  function finish(l: Live) {
    const p = l.pool;
    p.busy--;
    p.slotsInUse.delete(l.slot);
    const last = p.def.stages[p.def.stages.length - 1];
    let job: AnalysisJob = { ...l.job, status: 'done', progress: 1, model: last.model, stage: last.stage };
    const res = l.req.onDone?.(job);
    if (res) job = { ...job, findings: res.findings ?? res.observationIds?.length ?? 0, observationIds: res.observationIds };
    done.unshift(job);
    if (done.length > 60) done.length = 60;
    totalDone++;
    const a = agentNow();
    p.doneAt.push(a);
    p.lat.push((now - job.queuedAt) / AGENT_TIME_SCALE);
    if (p.lat.length > 31) p.lat.shift();
  }

  function scale(p: Rt, dtA: number) {
    const a = agentNow();
    // Booting workers come online.
    if (p.boots.length) {
      const still: number[] = [];
      for (const b of p.boots) if (b <= a) p.ready++; else still.push(b);
      p.boots = still;
    }
    const total = p.ready + p.boots.length;
    const demand = p.queue.length + p.busy;
    const target = Math.min(p.def.maxWorkers, Math.max(p.def.minWorkers, demand));
    if (target > total) {
      for (let k = total; k < target; k++) p.boots.push(a + 0.7 + rand() * 0.9 + (k - total) * 0.25);
      p.scaling = 'up';
      p.scaleHold = 3;
      p.idle = 0;
    } else if (target < total && p.queue.length === 0 && p.ready > p.busy) {
      p.idle += dtA;
      // Scale down gradually: one idle sandbox released every ~2.5 s after 4 s idle.
      if (p.idle > 4) {
        p.ready--;
        p.idle = 1.5;
        p.scaling = 'down';
        p.scaleHold = 3;
      }
    } else {
      p.idle = 0;
    }
    if (p.scaleHold > 0) {
      p.scaleHold -= dtA;
      if (p.scaleHold <= 0) p.scaling = 'steady';
    }
    while (p.queue.length && p.busy < p.ready) start(p, p.queue.shift()!);
    while (p.doneAt.length && p.doneAt[0] < a - 60) p.doneAt.shift();
  }

  return {
    get now() { return now; },
    enqueue(poolId, req) {
      const p = pools.get(poolId)!;
      const [d0, d1] = p.def.dur;
      const durationS = req.durationS ?? Math.round((d0 + (d1 - d0) * rand()) * 10) / 10;
      const st = stageFor(p.def, 0);
      // Projection and Orchestrator jobs have no single input modality; `pool` identifies them.
      const source: SourceKind = p.def.role === 'analysis' ? (p.def.id as SourceKind) : poolId === 'projection' ? 'terrain' : 'radio';
      const job: AnalysisJob = {
        id: `job-${String(++idc).padStart(5, '0')}`, source, pool: poolId,
        input: req.input, agent: `${p.def.prefix}-··`, model: st.model, status: 'queued', queuedAt: now, durationS, findings: 0,
        stage: 'queued', sandbox: SANDBOX, progress: 0,
      };
      p.queue.push({ job, pool: p, slot: 0, req, endAt: 0 });
      return job;
    },
    update(simDt) {
      now += simDt;
      const dtA = simDt / AGENT_TIME_SCALE;
      if (running.length) {
        const keep: Live[] = [];
        for (const l of running) {
          if (now >= l.endAt) finish(l);
          else keep.push(l);
        }
        running = keep;
      }
      for (const p of pools.values()) scale(p, dtA);
    },
    queueDepth: (id) => pools.get(id)?.queue.length ?? 0,
    snapshotJobs() {
      const out: AnalysisJob[] = [];
      for (const l of running) {
        const prog = Math.min(1, Math.max(0, (now - (l.job.startedAt ?? now)) / (l.job.durationS * AGENT_TIME_SCALE)));
        const st = stageFor(l.pool.def, prog);
        if (st.model !== l.job.model) l.job = { ...l.job, model: st.model, stage: st.stage };
        out.push({ ...l.job, progress: Math.round(prog * 100) / 100 });
      }
      for (const p of pools.values()) for (const l of p.queue) out.push(l.job);
      out.sort((a, b) => b.queuedAt - a.queuedAt);
      const active = out.slice(0, 40);
      const merged = active.concat(done.slice(0, Math.max(0, 60 - active.length)));
      merged.sort((a, b) => b.queuedAt - a.queuedAt);
      return merged;
    },
    snapshotPools() {
      const out: AgentPool[] = [];
      for (const p of pools.values()) {
        const lat = p.lat.slice().sort((a, b) => a - b);
        out.push({
          id: p.def.id, role: p.def.role, source: p.def.role === 'analysis' ? (p.def.id as SourceKind) : undefined,
          label: p.def.label, provider: p.def.provider, model: p.def.model,
          workers: p.ready + p.boots.length, maxWorkers: p.def.maxWorkers, queue: p.queue.length,
          throughputPerMin: p.doneAt.length,
          p50LatencyS: lat.length ? Math.round(lat[lat.length >> 1] * 10) / 10 : (p.def.dur[0] + p.def.dur[1]) / 2,
          sandbox: SANDBOX, inputs: p.def.inputs, booting: p.boots.length, scaling: p.scaling, running: p.busy,
        });
      }
      return out;
    },
    reset(simNow) { init(simNow); },
    stats() {
      let queued = 0, workers = 0;
      for (const p of pools.values()) { queued += p.queue.length; workers += p.ready + p.boots.length; }
      return { queued, running: running.length, done: totalDone, workers };
    },
  };
}
