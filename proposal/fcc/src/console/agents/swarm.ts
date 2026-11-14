import type { AgentJob, AgentPool, Feed, Finding, SourceKind } from '../contracts';
import type { JobRt, LedgerCounters, PoolRt, Sim } from '../world/sim';
import { nid } from '../world/sim';
import { MIN, clamp, distanceM, fmtDur, round } from '../world/geo';
import { addSocialFeed, frameBox, footprint } from '../world/feeds';
import { BOXD_POOL, POOL_DEFS } from './pools';
import type { FindingSpec } from './catalog';

export function createPools(): PoolRt[] {
  return POOL_DEFS.map((def) => ({
    def,
    acc: 0,
    srcAcc: {},
    sinceEmit: def.everyAgentS * 0.5,
    queue: [],
    running: [],
    workers: 1,
    starting: [],
    idleS: 0,
    durations: [],
    completions: [],
    seq: 0,
  }));
}

export interface EnqueueSpec {
  input: string;
  source?: SourceKind;
  minutes: number;
  counters?: Partial<LedgerCounters>;
  text: (agent: string, findings: number) => string;
  durS?: number;
  front?: boolean;
  onDone?: (sim: Sim, job: AgentJob) => string[] | void;
}

function setJob(sim: Sim, job: AgentJob): void {
  const i = sim.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) {
    const next = sim.jobs.slice();
    next[i] = job;
    sim.jobs = next;
  } else sim.jobs = [job, ...sim.jobs].slice(0, 80);
}

export function enqueue(sim: Sim, poolId: string, spec: EnqueueSpec): AgentJob | null {
  const p = sim.pools.find((x) => x.def.id === poolId);
  if (!p) return null;
  const job: AgentJob = {
    id: nid(sim, 'job'),
    poolId,
    source: spec.source ?? p.def.source ?? 'web',
    agent: p.def.agent,
    input: spec.input,
    model: p.def.model,
    provider: p.def.provider,
    status: 'queued',
    queuedAt: sim.t,
    findingIds: [],
  };
  const rt: JobRt = {
    job,
    durS: spec.durS ?? p.def.baseS,
    leftS: 0,
    minutes: spec.minutes,
    counters: spec.counters ?? {},
    text: spec.text,
    onDone: spec.onDone,
  };
  rt.durS *= sim.rng.range(0.7, 1.3);
  rt.leftS = rt.durS;
  if (spec.front) p.queue.unshift(rt);
  else p.queue.push(rt);
  setJob(sim, job);
  sim.bus.publish({ type: 'analysis.job', at: sim.t, job });
  return job;
}

export function addLedger(sim: Sim, agent: string, text: string, minutes: number, counters: Partial<LedgerCounters> = {}): void {
  const L = sim.ledger;
  const next = { ...L };
  for (const k of Object.keys(counters) as (keyof LedgerCounters)[]) next[k] = L[k] + (counters[k] ?? 0);
  const m = Math.max(0, minutes);
  next.analystMinutesSaved = L.analystMinutesSaved + m;
  if (text) {
    const entry = { id: nid(sim, 'led'), at: sim.t, agent, text, minutesSaved: round(m, 1) };
    next.entries = [entry, ...L.entries].slice(0, 60);
    sim.bus.publish({ type: 'ledger.entry', at: sim.t, entry });
  }
  sim.ledger = next;
}

const QUERIES = [
  'Caldor Fire Grizzly Flats',
  'Caldor Fire evacuation El Dorado County',
  'CAL FIRE incident update Caldor',
  'Caldor Fire road closures',
  'Grizzly Flats fire',
  'El Dorado County OES alerts',
];

function fxName(f: Feed): string {
  return f.fx === 'eo' ? 'EO' : f.fx === 'night' ? 'low-light' : 'IR';
}

function maybeInteriorHeat(sim: Sim, feed: Feed): string[] {
  const randomCount = [...sim.fmeta.values()].filter((m) => m.random).length;
  if (randomCount >= 3 || !sim.rng.chance(0.04)) return [];
  const u = sim.units.find((x) => x.id === feed.unitId);
  const fp = footprint(sim, feed, u);
  if (!fp) return [];
  const arr = sim.ctx.arrivalAt(fp.center);
  if (!(arr < sim.t - 30 * MIN && arr > sim.t - 6 * 60 * MIN)) return [];
  const f: Finding = {
    id: nid(sim, 'f-heat'),
    kind: 'smoke',
    label: 'INTERIOR HEAT · NO SPREAD THREAT',
    detail: `${feed.label.split('·')[0].trim()} IR: residual heat inside the burned area, no spread potential.`,
    pos: { lon: fp.center.lon, lat: fp.center.lat },
    uncertaintyM: 60,
    confidence: 0.8,
    live: false,
    observedAt: sim.t,
    halfLifeS: 300,
    freshness: 1,
    sourceIds: [feed.id],
    bbox: frameBox(sim, feed, u, fp.center, 'smoke'),
  };
  sim.findings.push(f);
  sim.fmeta.set(f.id, { truePos: f.pos, confirmable: false, confirmed: false, confirmQueued: false, resolved: false, persistent: false, poolId: 'pool-drone', sourceKinds: ['drone-cam'], random: true });
  sim.bus.publish({ type: 'analysis.finding', at: sim.t, finding: { ...f } });
  return [f.id];
}

function emitPoolJob(sim: Sim, p: PoolRt): boolean {
  const d = p.def;
  switch (d.id) {
    case 'pool-drone':
    case 'pool-ground': {
      let best = '';
      let bv = 0;
      for (const [k, v] of Object.entries(p.srcAcc)) {
        if (v > bv) {
          best = k;
          bv = v;
        }
      }
      if (bv < d.minWork) return false;
      p.srcAcc[best] = 0;
      const feed = sim.feeds.find((f) => f.id === best);
      if (!feed) return true;
      const cs = feed.label.split('·')[0].trim();
      const fx = fxName(feed);
      const secs = bv;
      enqueue(sim, d.id, {
        input: `${cs} · ${fmtDur(secs)} ${fx} clip`,
        minutes: (secs / 60) * 1.2,
        counters: { footageReviewedS: secs },
        durS: d.baseS + secs * d.perWorkS,
        text: (a, n) => `${a} reviewed ${fmtDur(secs)} of ${cs} ${fx} video${n ? ` · ${n} detection${n > 1 ? 's' : ''}` : ' · nothing new'}`,
        onDone: (s) => (d.id === 'pool-drone' ? maybeInteriorHeat(s, feed) : []),
      });
      return true;
    }
    case 'pool-crawl': {
      if (p.acc < d.minWork) return false;
      const n = Math.max(1, Math.round(p.acc));
      p.acc = 0;
      const q = sim.rng.pick(QUERIES);
      enqueue(sim, d.id, {
        input: `Search "${q}" · scrape ${n} page${n > 1 ? 's' : ''}`,
        minutes: 0,
        durS: d.baseS + n * d.perWorkS,
        text: (a) => `${a} scraped ${n} page${n > 1 ? 's' : ''} for "${q}"`,
        onDone: (s) => {
          enqueue(s, 'pool-extract', {
            input: `Extract incident facts · ${n} article${n > 1 ? 's' : ''}`,
            minutes: n * 3,
            counters: { articlesRead: n },
            durS: 4 + n * 2,
            text: (a) => `${a} read ${n} article${n > 1 ? 's' : ''} ("${q}") · facts extracted`,
          });
        },
      });
      return true;
    }
    case 'pool-social': {
      if (p.acc < d.minWork) return false;
      const n = Math.round(p.acc);
      p.acc = 0;
      enqueue(sim, d.id, {
        input: `Screen ${n} public posts · geofenced #CaldorFire`,
        minutes: n * 0.5,
        counters: { postsScreened: n },
        durS: d.baseS + n * d.perWorkS,
        text: (a) => `${a} screened ${n} social posts · no actionable content`,
      });
      return true;
    }
    case 'pool-fixed': {
      if (p.acc < d.minWork) return false;
      const n = Math.round(p.acc);
      p.acc = 0;
      const ridge = sim.feeds.filter((f) => f.kind === 'ridge-cam');
      const cam = ridge.length ? ridge[p.seq % ridge.length].label.split('·')[0].trim() : 'RIDGE CAM';
      enqueue(sim, d.id, {
        input: `${cam} · ${n} frames · smoke/flame`,
        minutes: n * 0.25,
        counters: { imagesAnalyzed: n },
        durS: d.baseS + n * d.perWorkS,
        text: (a) => `${a} analyzed ${n} ${cam} frames`,
      });
      return true;
    }
    case 'pool-sat': {
      if (p.acc < d.minWork) return false;
      p.acc -= 1;
      const goes = p.seq % 4 !== 3;
      enqueue(sim, d.id, {
        input: goes ? `GOES-17 ABI FDC frame · ${sim.ctx.fmtTime(sim.t)}` : 'FIRMS VIIRS 375 m + GIBS tiles · bbox query',
        minutes: 6,
        counters: { satellitePasses: 1 },
        durS: d.baseS + d.perWorkS,
        text: (a) => (goes ? `${a} processed a GOES-17 fire frame` : `${a} merged FIRMS VIIRS detections with GIBS imagery`),
      });
      return true;
    }
    case 'pool-weather': {
      if (p.acc < d.minWork) return false;
      p.acc -= 1;
      const w = sim.ctx.weatherAt(sim.t);
      enqueue(sim, d.id, {
        input: `Open-Meteo hourly + NWS alerts · ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph`,
        minutes: 4,
        durS: d.baseS + d.perWorkS,
        text: (a) => `${a} updated weather: ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph, gusts ${Math.round(w.gustKph)}, RH ${Math.round(w.rh)}%`,
      });
      return true;
    }
    case 'pool-radio': {
      if (p.acc < d.minWork) return false;
      const mins = p.acc;
      p.acc = 0;
      const ch = p.seq % 3 === 0 ? 'Div Z tactical' : p.seq % 3 === 1 ? 'Div A tactical' : 'Air-to-ground';
      enqueue(sim, d.id, {
        input: `${ch} · ${fmtDur(mins * 60)} audio`,
        minutes: mins * 1.5,
        counters: { radioMinutesTranscribed: mins },
        durS: d.baseS + mins * d.perWorkS,
        text: (a) => `${a} transcribed ${fmtDur(mins * 60)} of ${ch} traffic`,
      });
      return true;
    }
    default:
      return false;
  }
}

function finish(sim: Sim, p: PoolRt, j: JobRt): void {
  const ids = j.onDone?.(sim, j.job) ?? [];
  const job: AgentJob = { ...j.job, status: 'done', finishedAt: sim.t, findingIds: [...j.job.findingIds, ...(ids || [])] };
  setJob(sim, job);
  sim.bus.publish({ type: 'analysis.job', at: sim.t, job });
  p.durations = [...p.durations.slice(-14), j.durS];
  p.completions.push(sim.agentS);
  addLedger(sim, job.agent, j.text(job.agent, job.findingIds.length), j.minutes - j.durS / 60, j.counters);
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (fm && fm.persistent && fm.poolId === p.def.id) f.observedAt = Math.max(f.observedAt, sim.t);
  }
}

export function tickSwarm(sim: Sim, dtScen: number, dtAgent: number): void {
  for (const p of sim.pools) {
    const d = p.def;
    if (d.perSource) {
      for (const f of sim.feeds) {
        const ok = d.perSource === 'drones' ? f.kind.startsWith('uav') : f.kind === 'dash-cam' || f.kind === 'helmet-cam';
        if (ok && f.live) p.srcAcc[f.id] = (p.srcAcc[f.id] ?? 0) + dtScen / 1000;
      }
    } else p.acc += (d.workPerMin * dtScen) / MIN;
    p.sinceEmit += dtAgent;
    if (p.sinceEmit >= d.everyAgentS && emitPoolJob(sim, p)) {
      p.sinceEmit = 0;
      p.seq++;
    }
    // Autoscale boxd workers on queue depth, with a cold start.
    p.starting = p.starting.map((s) => s - dtAgent);
    const ready = p.starting.filter((s) => s <= 0).length;
    if (ready) {
      p.workers = Math.min(d.maxWorkers, p.workers + ready);
      p.starting = p.starting.filter((s) => s > 0);
    }
    const desired = clamp(Math.ceil((p.queue.length + p.running.length) / 1.5), 1, d.maxWorkers);
    while (desired > p.workers + p.starting.length) p.starting.push(sim.rng.range(2.5, 6));
    if (desired < p.workers) {
      p.idleS += dtAgent;
      if (p.idleS > 20) {
        p.workers--;
        p.idleS = 0;
      }
    } else p.idleS = 0;
    while (p.running.length < p.workers && p.queue.length) {
      const j = p.queue.shift()!;
      const idx = 1 + ((p.seq * 7 + p.running.length * 3) % Math.max(4, d.maxWorkers));
      j.job = { ...j.job, status: 'running', startedAt: sim.t, agent: `${d.agent}-${String(idx).padStart(2, '0')}` };
      p.seq++;
      p.running.push(j);
      setJob(sim, j.job);
    }
    const still: JobRt[] = [];
    for (const j of p.running) {
      j.leftS -= dtAgent;
      if (j.leftS <= 0) finish(sim, p, j);
      else still.push(j);
    }
    p.running = still;
    p.completions = p.completions.filter((c) => c > sim.agentS - 60);
  }
}

export function poolSnapshot(sim: Sim): AgentPool[] {
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    return round(s[s.length >> 1], 1);
  };
  const out: AgentPool[] = sim.pools.map((p) => ({
    id: p.def.id,
    role: p.def.role,
    source: p.def.source,
    label: p.def.label,
    provider: p.def.provider,
    model: p.def.model,
    workers: p.workers,
    maxWorkers: p.def.maxWorkers,
    queue: p.queue.length,
    throughputPerMin: p.completions.length,
    p50LatencyS: median(p.durations) || p.def.baseS,
  }));
  out.push({
    id: BOXD_POOL.id,
    role: 'ingest',
    label: BOXD_POOL.label,
    provider: BOXD_POOL.provider,
    model: BOXD_POOL.model,
    workers: out.reduce((n, p) => n + p.workers, 0) + sim.pools.reduce((n, p) => n + p.starting.length, 0),
    maxWorkers: out.reduce((n, p) => n + p.maxWorkers, 0),
    queue: out.reduce((n, p) => n + p.queue, 0),
    throughputPerMin: out.reduce((n, p) => n + p.throughputPerMin, 0),
    p50LatencyS: round(sim.pools.reduce((n, p) => n + p.starting.length, 0) ? 4.2 : 0.8, 1),
  });
  return out;
}

/* ------------------------------------------------------------------ findings */

export function createFinding(sim: Sim, spec: FindingSpec, at: number): Finding {
  const f: Finding = {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    detail: spec.detail,
    pos: { lon: spec.pos.lon, lat: spec.pos.lat },
    uncertaintyM: spec.uncertaintyM,
    confidence: spec.confidence,
    live: false,
    observedAt: at,
    halfLifeS: spec.halfLifeS,
    freshness: 1,
    sourceIds: [`src-${spec.id}`],
    count: spec.count,
  };
  if (spec.source === 'social') {
    const feedId = addSocialFeed(sim, f);
    f.sourceIds.push(feedId);
    f.bbox = { feedId, x: 0.4, y: 0.44, w: 0.12, h: 0.22 };
  } else if (spec.feedId) {
    const feed = sim.feeds.find((x) => x.id === spec.feedId);
    if (feed) {
      f.sourceIds.push(feed.id);
      const u = sim.units.find((x) => x.id === feed.unitId);
      f.bbox = frameBox(sim, feed, u, spec.truePos ?? spec.pos, spec.kind);
    }
  }
  sim.findings.push(f);
  sim.fmeta.set(f.id, {
    specId: spec.id,
    truePos: spec.truePos ?? spec.pos,
    confirmable: !!spec.confirmable,
    confirmed: false,
    confirmQueued: false,
    resolved: false,
    persistent: !!spec.persistent,
    poolId: spec.poolId,
    place: spec.place,
    sourceKinds: [spec.source],
    random: false,
  });
  if (spec.kind === 'spot') sim.intelPending = 'New spot fire ahead of the head (ridge camera)';
  sim.gradeDirty = true;
  sim.briefDirty = true;
  sim.bus.publish({ type: 'analysis.finding', at: sim.t, finding: { ...f } });
  return f;
}

function reveal(sim: Sim, spec: FindingSpec): void {
  sim.revealed.add(spec.id);
  sim.bus.publish({
    type: 'source.ingested',
    at: sim.t,
    source: {
      id: `src-${spec.id}`,
      kind: spec.source,
      label: spec.sourceLabel,
      title: spec.sourceTitle,
      summary: spec.detail,
      pos: spec.pos,
      uncertaintyM: spec.uncertaintyM,
      feedId: spec.feedId,
      url: spec.url,
    },
  });
  enqueue(sim, spec.poolId, {
    front: true,
    input: spec.jobInput,
    source: spec.source,
    minutes: spec.minutes,
    counters: spec.counters,
    durS: 6,
    text: (a) => `${a} flagged ${spec.label}`,
    onDone: (s) => {
      createFinding(s, spec, s.t);
      return [spec.id];
    },
  });
}

export function tickReveals(sim: Sim): void {
  for (const spec of sim.catalog) {
    if (sim.revealed.has(spec.id)) continue;
    const r = spec.reveal;
    if ('at' in r) {
      if (sim.t >= r.at) reveal(sim, spec);
    } else {
      const u = sim.units.find((x) => x.id === r.unitId);
      const near = !!u && sim.t >= (r.notBefore ?? 0) && distanceM(u.pos, spec.truePos ?? spec.pos) <= r.radiusM;
      if (near || sim.t >= r.fallbackAt) reveal(sim, spec);
    }
  }
}

/** Findings that would already exist at the reset time (no jobs, no events). */
export function prefillFindings(sim: Sim): void {
  for (const spec of sim.catalog) {
    if ('at' in spec.reveal && spec.reveal.at <= sim.t) {
      sim.revealed.add(spec.id);
      createFinding(sim, spec, spec.reveal.at);
    }
  }
}

export function requestConfirm(sim: Sim, f: Finding, feed: Feed): void {
  const fm = sim.fmeta.get(f.id);
  if (!fm) return;
  fm.confirmQueued = true;
  const cs = feed.label.split('·')[0].trim();
  const what = f.label.split('·')[0].trim();
  enqueue(sim, 'pool-drone', {
    front: true,
    input: `${cs} · confirm ${what} · live gimbal`,
    source: 'drone-cam',
    minutes: 3,
    counters: { footageReviewedS: 20 },
    durS: 5,
    text: (a) => `${a} confirmed ${what} on ${cs} live video`,
    onDone: (s) => {
      confirmFinding(s, f.id, feed.id);
      return [f.id];
    },
  });
}

function confirmFinding(sim: Sim, id: string, feedId: string): void {
  const f = sim.findings.find((x) => x.id === id);
  const fm = sim.fmeta.get(id);
  const feed = sim.feeds.find((x) => x.id === feedId);
  if (!f || !fm || !feed) return;
  const spec = sim.catalog.find((s) => s.id === fm.specId);
  const cs = feed.label.split('·')[0].trim();
  fm.confirmed = true;
  f.pos = { lon: fm.truePos.lon, lat: fm.truePos.lat };
  f.uncertaintyM = f.kind === 'human' ? 25 : 40;
  f.confidence = f.kind === 'human' ? 0.93 : 0.9;
  f.live = true;
  f.observedAt = sim.t;
  f.halfLifeS = 300;
  f.label = f.label.replace(/\s*\(.*\)$/, '');
  f.detail = `Confirmed live by ${cs} at ${sim.ctx.fmtTime(sim.t)}: ${spec?.confirmDetail ?? 'object confirmed on live video.'}`;
  if (!fm.sourceKinds.includes('drone-cam')) fm.sourceKinds.push('drone-cam');
  if (!f.sourceIds.includes(feed.id)) f.sourceIds = [...f.sourceIds, feed.id];
  const u = sim.units.find((x) => x.id === feed.unitId);
  f.bbox = frameBox(sim, feed, u, fm.truePos, f.kind);
  if (f.kind === 'spot') sim.intelPending = `Spot fire confirmed by ${cs}`;
  sim.gradeDirty = true;
  sim.briefDirty = true;
  sim.bus.publish({ type: 'analysis.finding', at: sim.t, finding: { ...f } });
}

/** Freshness decay f = 0.5^(age / t½), expiry below 0.10. */
export function tickFindings(sim: Sim, isPinned: (id: string) => boolean): string[] {
  const expired: string[] = [];
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (f.live) f.freshness = 1;
    else f.freshness = round(Math.pow(0.5, Math.max(0, sim.t - f.observedAt) / 1000 / f.halfLifeS), 3);
    if (fm && f.kind === 'spot' && !fm.resolved && sim.ctx.arrivalAt(fm.truePos) < sim.t - 20 * MIN) {
      fm.resolved = true;
      f.label = 'SPOT FIRE · MERGED WITH MAIN FRONT';
      f.detail = 'The main front has reached the spot fire; tracked as part of the perimeter.';
    }
    if (f.freshness < 0.1 && !isPinned(f.id)) expired.push(f.id);
  }
  if (expired.length) {
    const gone = new Set(expired);
    sim.findings = sim.findings.filter((f) => !gone.has(f.id));
    sim.feeds = sim.feeds.filter((x) => !(x.kind === 'social' && gone.has(x.findingIds[0])));
    sim.gradeDirty = true;
  }
  return expired;
}
