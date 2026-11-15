import type { PredictionCheck, Projection } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, round } from '../world/geo';
import { say } from '../orchestrator/messages';
import { addNote } from '../orchestrator/notes';
import { addLedger } from './swarm';
import { burnedMask, fieldMask, fieldMinAt, spreadGrid, type SpreadField } from './spread';

export const PREDICTION_METHOD =
  'Prototype min-travel-time spread on DEM + fuel; reconstructed issue-time seed; archived future hourly weather (perfect-forecast assumption). IoU vs replay reconstruction; timing vs sourced checkpoints; no final-perimeter evaluation.';

const HORIZONS = [30, 60];
const MAX_CHECKS = 16;

interface PredRt {
  mask: Uint8Array;
  base: Uint8Array;
  rev: number;
}

/**
 * Search radius around a documented checkpoint. Capped well below the sources' location uncertainty so a
 * nearby part of the fire observed at issue does not count as an on-time arrival.
 */
const CP_RADIUS_M = 200;

type Checkpoint = NonNullable<Sim['ctx']['pack']['checkpoints']>[number] & { placeId?: string };

function checkpointPos(sim: Sim, cp: Checkpoint) {
  return cp.pos ?? (cp.placeId ? sim.ctx.places.find((p) => p.id === cp.placeId)?.pos : undefined);
}

/** Documented checkpoints inside (from, to] that the fire had not reached at issue in the model's own seed. */
function checkpointsFor(sim: Sim, field: SpreadField, from: number, to: number): PredictionCheck['checkpoints'] {
  const out: PredictionCheck['checkpoints'] = [];
  for (const cp of (sim.ctx.pack.checkpoints ?? []) as Checkpoint[]) {
    const pos = checkpointPos(sim, cp);
    if (cp.t <= from || cp.t > to || !pos) continue;
    const m = fieldMinAt(field, pos, Math.min(cp.radiusM ?? CP_RADIUS_M, CP_RADIUS_M));
    if (m === 0) continue;
    const predictedT = m > 0 && Number.isFinite(m) ? Math.round(field.issuedAt + m * MIN) : undefined;
    out.push({ id: cp.id, label: cp.label, documentedT: cp.t, predictedT });
  }
  return out;
}

function count(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

function push(sim: Sim, c: PredictionCheck, rt: PredRt): void {
  sim.predictions = [c, ...sim.predictions].slice(0, MAX_CHECKS);
  sim.predRt.set(c.id, rt);
  for (const id of [...sim.predRt.keys()]) if (!sim.predictions.some((p) => p.id === id)) sim.predRt.delete(id);
}

/** Issues 30/60-minute checks (one pending per horizon) and one checkpoint check per run ("to coast"). */
export function issueChecks(sim: Sim, proj: Projection, field: SpreadField): void {
  const t = proj.issuedAt;
  const base = fieldMask(field, 0);
  for (const h of HORIZONS) {
    if (t + h * MIN > sim.ctx.end) continue;
    if (sim.predictions.some((p) => p.status === 'pending' && p.horizonMin === h && !p.id.endsWith('-cp'))) continue;
    const mask = fieldMask(field, h);
    const c: PredictionCheck = {
      id: `pred-r${proj.rev}-${h}`,
      issuedAt: t,
      horizonMin: h,
      targetT: t + h * MIN,
      status: 'pending',
      areaPredHa: round(count(mask) * field.grid.cellHa, 0),
      checkpoints: checkpointsFor(sim, field, t, t + h * MIN),
      method: PREDICTION_METHOD,
    };
    push(sim, c, { mask, base, rev: proj.rev });
  }
  const cps = (sim.ctx.pack.checkpoints ?? []).filter((cp) => checkpointPos(sim, cp) && cp.t > t + 20 * MIN && cp.t <= t + field.horizonMin * MIN);
  if (cps.length && !sim.cues.has('pred-cp')) {
    sim.cues.add('pred-cp');
    const last = Math.max(...cps.map((cp) => cp.t));
    const h = Math.min(field.horizonMin, Math.ceil((last - t) / MIN));
    const mask = fieldMask(field, h);
    const c: PredictionCheck = {
      id: `pred-r${proj.rev}-cp`,
      issuedAt: t,
      horizonMin: h,
      targetT: t + h * MIN,
      status: 'pending',
      areaPredHa: round(count(mask) * field.grid.cellHa, 0),
      checkpoints: checkpointsFor(sim, field, t, t + h * MIN),
      method: PREDICTION_METHOD,
    };
    push(sim, c, { mask, base, rev: proj.rev });
  }
}

function errText(sim: Sim, cp: PredictionCheck['checkpoints'][number]): string {
  if (cp.predictedT === undefined) return `${cp.label}: not reached by the model within 6 h (documented ${sim.ctx.fmtTime(cp.documentedT)})`;
  const e = cp.errorMin ?? 0;
  const rel = e === 0 ? 'on time' : e < 0 ? `${-e} min early` : `${e} min late`;
  return `${cp.label}: predicted ${sim.ctx.fmtTime(cp.predictedT)} vs documented ${sim.ctx.fmtTime(cp.documentedT)} (${rel})`;
}

/** Scores pending checks once the clock passes their target time (truth is read only here, after the fact). */
export function tickPredictions(sim: Sim): void {
  for (const c of sim.predictions) {
    if (c.status !== 'pending' || sim.t < c.targetT) continue;
    const rt = sim.predRt.get(c.id);
    if (!rt) continue;
    const g = spreadGrid(sim.ctx.pack);
    const actual = burnedMask(g, c.targetT);
    let inter = 0;
    let uni = 0;
    let gi = 0;
    let gu = 0;
    let na = 0;
    for (let i = 0; i < actual.length; i++) {
      const p = rt.mask[i];
      const a = actual[i];
      na += a;
      if (p & a) inter++;
      if (p | a) uni++;
      if (!rt.base[i]) {
        if (p & a) gi++;
        if (p | a) gu++;
      }
    }
    const iou = uni ? round(inter / uni, 2) : 0;
    const growthIou = gu ? round(gi / gu, 2) : 0;
    const checkpoints = c.checkpoints.map((cp) => ({ ...cp, errorMin: cp.predictedT === undefined ? undefined : Math.round((cp.predictedT - cp.documentedT) / MIN) }));
    const scored: PredictionCheck = { ...c, status: 'scored', iou, areaActualHa: round(na * g.cellHa, 0), checkpoints };
    sim.predictions = sim.predictions.map((p) => (p.id === c.id ? scored : p));
    sim.predRt.delete(c.id);
    sim.bus.publish({ type: 'prediction.scored', at: sim.t, check: scored });
    const cpText = checkpoints.length ? ` ${checkpoints.map((cp) => errText(sim, cp)).join('; ')}.` : '';
    const text = `Projection rev ${rt.rev} vs the replay fire (+${c.horizonMin} min): IoU ${iou.toFixed(2)} (new growth only ${growthIou.toFixed(2)}), ${Math.round(c.areaPredHa).toLocaleString('en-US')} ha predicted vs ${Math.round(scored.areaActualHa ?? 0).toLocaleString('en-US')} ha in the replay.${cpText}`;
    say(sim, text, [c.id]);
    addLedger(sim, 'PROJ', `Scored ${text}`, 6);
    addNote(sim, 'projection', `Prediction check scored: rev ${rt.rev} +${c.horizonMin} min, IoU ${iou.toFixed(2)}`, c.id);
  }
}
