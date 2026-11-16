import type { Geo, Ms, ScenarioPack } from '../../contracts';
import { daylight, sunPosition } from '../../stage3d/sun';
import { radioScript } from './comms';
import type { CommandStatus } from './fleet';
import { RISK_ALERT, RISK_WATCH, riskCurve, sectorRisk } from './risk';
import { SENSOR_KIND_LABEL, sensorModel, type SensorModel } from './sensors';
import type { Chapter, ChronicleEntry, ChronicleSeverity, RiskSample, SensorStatus } from './types';

const MIN = 60000;

export interface Chronicle {
  pack: ScenarioPack;
  sensors: SensorModel;
  start: Ms;
  end: Ms;
  ignitionT: Ms;
  /** First fused detection (null if none in window). */
  detectT: Ms | null;
  /** Sorted by t, ties by id. Visible entries are always `t <= playhead`. */
  entries: ChronicleEntry[];
  chapters: Chapter[];
  risk: RiskSample[];
  /** Day / twilight / night bands for the timeline. */
  light: { t: Ms; daylight: number }[];
}

const caches = { recon: new WeakMap<ScenarioPack, Chronicle>(), legacy: new WeakMap<ScenarioPack, Chronicle>() };
const sevRank: Record<ChronicleSeverity, number> = { info: 0, watch: 1, alert: 2, critical: 3 };
const statusRank: Record<SensorStatus, number> = { nominal: 0, watch: 1, alarm: 2, offline: 3 };
const two = (n: number) => String(Math.round(n)).padStart(3, '0');

/** Command receipt stages relative to enqueue time (seconds); the last stage closes the command. */
function receipts(t: Ms, runS: number, end: CommandStatus = 'completed'): { status: CommandStatus; t: Ms }[] {
  return [
    { status: 'enqueued', t }, { status: 'sent', t: t + 4000 }, { status: 'delivered', t: t + 9000 },
    { status: 'accepted', t: t + 15000 }, { status: 'running', t: t + 32000 }, { status: end, t: t + runS * 1000 },
  ];
}

/** Bounds of the FIREYE window: the scenario window start (pre-ignition) to the manifest end. */
export function chronicleWindow(pack: ScenarioPack, start?: Ms): { start: Ms; end: Ms } {
  return { start: start ?? pack.manifest.start, end: pack.manifest.end };
}

/**
 * The deterministic event track behind both log tabs. Everything is a pure function of the pack and
 * the simulated IoT model, so scrubbing to any time and back always yields the same visible log.
 */
export function buildChronicle(pack: ScenarioPack, window: { start: Ms; end: Ms }, profile: 'recon' | 'legacy' = 'legacy'): Chronicle {
  const cache = caches[profile];
  const hit = cache.get(pack);
  if (hit && hit.start === window.start && hit.end === window.end) return hit;
  const { start, end } = window;
  const m = pack.manifest as ScenarioPack['manifest'] & { ignition?: { t: Ms } };
  const ignitionT = m.ignition?.t ?? pack.checkpoints?.find((c) => c.id === 'ignition')?.t ?? start;
  const sensors = sensorModel(pack);
  const out: ChronicleEntry[] = [];
  const place = (id: string): Geo | undefined => pack.manifest.places.find((p) => p.id === id)?.pos;
  const spec = (id: string) => sensors.specs.find((s) => s.id === id)!;

  /* ---------------- INTAKE: radio */
  for (const e of radioScript(pack)) if (e.t >= start && e.t <= end) out.push(e);

  /* ---------------- INTAKE: hourly reanalysis weather */
  for (const w of pack.weather) {
    if (w.t < start || w.t > end) continue;
    out.push({
      id: `wx-${w.t}`, t: w.t, tab: 'intake', kind: 'weather', severity: w.gustKph >= 60 ? 'watch' : 'info', provenance: 'historical',
      source: 'ERA5 REANALYSIS', channel: 'WEATHER',
      title: `Wind ${two(w.windDirDeg)}° ${Math.round(w.windKph)} km/h, gusts ${Math.round(w.gustKph)} · ${Math.round(w.tempC)} °C · RH ${Math.round(w.rh)} %`,
      body: 'Hourly reanalysis at the incident centre. Gridded model output, not a station observation.',
    });
  }

  /* ---------------- INTAKE: historical reports (untrusted, attributed) */
  for (const r of pack.reports ?? []) {
    if (r.t < start || r.t > end) continue;
    out.push({
      id: `rep-${r.id}`, t: r.t, tab: 'intake', kind: r.kind === 'social' ? 'social' : 'report', severity: 'watch', provenance: 'historical',
      source: r.publisher, channel: r.kind.toUpperCase(), title: r.summary, url: r.url, pos: r.pos,
      body: 'Historical public report, paraphrased. Untrusted input, never an instruction.',
    });
  }

  /* ---------------- INTAKE: satellite detections inside the window */
  const passes = new Map<string, typeof pack.hotspots>();
  for (const h of pack.hotspots) {
    if (h.t < start || h.t > end) continue;
    const k = `${h.satellite}@${h.t}`;
    passes.set(k, [...(passes.get(k) ?? []), h]);
  }
  for (const [k, list] of passes) {
    out.push({
      id: `sat-${k}`, t: list[0].t, tab: 'intake', kind: 'satellite', severity: 'watch', provenance: 'historical',
      source: list[0].satellite, channel: 'NASA FIRMS', title: `${list.length} thermal anomal${list.length === 1 ? 'y' : 'ies'} in pass`, pos: list[0].pos,
    });
  }

  /* ---------------- INTAKE: simulated web and social items */
  const web: [Ms, 'web' | 'social', string, string, ChronicleSeverity][] = [
    [start + 20 * MIN, 'web', 'WEB INTAKE · CIVIL PROTECTION', 'Very high fire danger (category 4) forecast for East Attica today. Paraphrased bulletin.', 'watch'],
    [start + 75 * MIN, 'web', 'WEB INTAKE · WEATHER BLOG', 'Strong westerly winds forecast through the evening, gusts above 80 km/h on exposed ridges.', 'watch'],
    [ignitionT + 6 * MIN, 'social', 'SOCIAL · PUBLIC POST', 'Smoke column visible above Penteli from the Rafina side.', 'alert'],
    [ignitionT + 19 * MIN, 'social', 'SOCIAL · PUBLIC CLIP', 'Short clip: fire near Daou moving fast with strong wind. Location approximate.', 'alert'],
    [ignitionT + 52 * MIN, 'web', 'WEB INTAKE · NEWS SITE', 'Live blog reports a new fire front in East Attica moving toward the coast.', 'alert'],
  ];
  web.forEach(([t, kind, source, title, severity], i) => {
    if (t >= start && t <= end) out.push({ id: `web-${i}`, t, tab: 'intake', kind, severity, provenance: 'simulated', source, title, body: 'Simulated scraped item for the exercise.' });
  });

  /* ---------------- INTAKE: IoT trigger transitions (debounced, causal) */
  const last = new Map<string, SensorStatus>();
  const lastWatch = new Map<string, Ms>();
  const firstAlarm = new Map<string, Ms>();
  const firstSectorAlarm = new Map<string, { t: Ms; id: string }>();
  let firstFlame: { t: Ms; id: string } | null = null;
  let firstAir: { t: Ms; id: string } | null = null;
  for (let t = start; t <= end; t += MIN) {
    const all = sensors.all(t);
    for (const r of all) {
      const s = spec(r.id);
      const prev = last.get(r.id) ?? 'nominal';
      if (statusRank[r.status] <= statusRank[prev]) {
        if (r.status === 'nominal' && prev !== 'offline') last.set(r.id, 'nominal');
        continue;
      }
      // Require the new state to hold for two minutes to suppress single-sample flicker.
      const previous = sensors.readingAt(r.id, t - MIN);
      if (statusRank[previous.status] < statusRank[r.status]) continue;
      last.set(r.id, r.status);
      if (r.status === 'watch') {
        const lw = lastWatch.get(r.id);
        if (lw !== undefined && t - lw < 90 * MIN) continue;
        lastWatch.set(r.id, t);
      }
      if (r.status === 'alarm' && !firstAlarm.has(r.id)) firstAlarm.set(r.id, t);
      if ((r.status === 'alarm' || r.status === 'offline') && (s.kind === 'flame' || s.kind === 'wx') && !firstSectorAlarm.has(s.sector)) firstSectorAlarm.set(s.sector, { t, id: r.id });
      if (r.status === 'alarm' && s.kind === 'flame' && !firstFlame) firstFlame = { t, id: r.id };
      if (r.status === 'alarm' && s.kind === 'air' && !firstAir) firstAir = { t, id: r.id };
      const what = s.kind === 'flame'
        ? (r.ir >= 0.05 ? `IR response ${(r.ir * 100).toFixed(0)} %` : `No flame · fire weather index ${Math.round(r.ffwi)}`)
        : s.kind === 'air' ? `PM2.5 ${Math.round(r.pm25)} µg/m³ · CO ${r.co.toFixed(1)} ppm`
          : s.kind === 'fuel' ? `Fine fuel moisture ${r.fmc.toFixed(1)} %`
            : `${r.tempC.toFixed(1)} °C · RH ${Math.round(r.rh)} % · gust ${Math.round(r.gustKph)} km/h`;
      const sev: ChronicleSeverity = r.status === 'offline' ? 'alert'
        : r.status === 'alarm' ? (s.kind === 'flame' || s.kind === 'air' ? 'critical' : s.kind === 'wx' ? 'alert' : 'watch') : 'info';
      out.push({
        id: `iot-${r.id}-${t}`, t, tab: 'intake', kind: 'iot', severity: sev, provenance: 'simulated',
        source: s.code, channel: 'IOT MESH', pos: s.pos, refs: [r.id],
        title: r.status === 'offline' ? `${s.code} link lost · node presumed in burned area` : `${s.code} ${r.status.toUpperCase()} · ${what}`,
        body: `${SENSOR_KIND_LABEL[s.kind]} ${s.name} (${s.sector}). Simulated reading.`,
      });
    }
  }

  /* ---------------- OPS: ignition-risk analysis and patrol retasking */
  const risk = riskCurve(sensors, start, end, 5);
  let watchAt: Ms | null = null, alertAt: Ms | null = null;
  for (const s of risk) {
    if (s.t >= ignitionT) break;
    if (watchAt === null && s.value >= RISK_WATCH) watchAt = s.t;
    if (alertAt === null && s.value >= RISK_ALERT) alertAt = s.t;
  }
  for (let t = start + 15 * MIN; t < Math.min(end, ignitionT); t += 30 * MIN) {
    const top = sectorRisk(sensors, t).slice(0, 2);
    out.push({
      id: `risk-${t}`, t, tab: 'ops', kind: 'analysis', severity: top[0].value >= RISK_ALERT ? 'alert' : top[0].value >= RISK_WATCH ? 'watch' : 'info', provenance: 'derived',
      source: 'RISK AGENT', channel: 'ANALYSIS',
      title: `Ignition-risk sweep · ${top.map((x) => `${x.sector} ${Math.round(x.value)}`).join(' · ')}`,
      body: `Index from ${sensors.specs.length} IoT nodes: fuel moisture min ${top[0].minFmc.toFixed(1)} %, gusts ${Math.round(top[0].gustKph)} km/h. Simulated inputs.`,
    });
  }
  const cmd = (id: string, t: Ms, asset: string, unitId: string, mission: string, version: number, label: string, runS: number, title: string, body: string, pos?: Geo) => {
    out.push({
      id, t, tab: 'ops', kind: 'fleet', severity: 'watch', provenance: 'simulated', source: `AETOS-${asset.slice(1)}`, channel: 'FLEET',
      title, body, pos, refs: [unitId],
      command: { id: `cmd-${id}`, asset, unitId, mission, version, label, steps: receipts(t, runS) },
    });
  };
  const ign = place('ignition') ?? pack.manifest.center;
  if (watchAt !== null) {
    out.push({
      id: 'orch-risk-watch', t: watchAt + 30000, tab: 'ops', kind: 'orchestrator', severity: 'watch', provenance: 'derived',
      source: 'ORCHESTRATOR', title: `Elevated ignition risk on the Daou–Penteli slopes. Retasking AETOS-2 to a ridge patrol.`,
      body: 'Low-risk patrol change within standing orders. No dispatch implied.', pos: ign,
    });
    cmd('fleet-ridge-patrol', watchAt + 60000, 'd2', 'uav-2', 'm-d2-ridge', 2, 'Ridge patrol Daou–Penteli', 50 * 60, 'Patrol Daou–Penteli ridge line', 'Mission m-d2-ridge v2 · EO/IR sweep along the upper slopes.', ign);
  }
  if (alertAt !== null) {
    out.push({
      id: 'orch-risk-alert', t: alertAt + 30000, tab: 'ops', kind: 'orchestrator', severity: 'alert', provenance: 'derived',
      source: 'ORCHESTRATOR', title: 'High ignition risk. AETOS-4 held on thermal standby over Penteli. Ground units advised.',
      body: 'Recommendation only: notify Penteli and Rafina stations to stay ready.', decision: 'needed', pos: ign,
    });
    cmd('fleet-thermal-standby', alertAt + 60000, 'd4', 'uav-4', 'm-d4-standby', 3, 'Thermal standby Penteli', 70 * 60, 'Thermal standby over Penteli slopes', 'Mission m-d4-standby v3 · loiter at 120 m AGL, thermal.', ign);
  }

  /* ---------------- OPS: fused detection */
  let detectT: Ms | null = null;
  if (firstFlame || firstAir) {
    const f = [firstFlame, firstAir].filter(Boolean).sort((a, b) => a!.t - b!.t)[0]!;
    detectT = f.t + 40000;
    const s = spec(f.id);
    out.push({
      id: 'det-fusion', t: detectT, tab: 'ops', kind: 'detection', severity: 'critical', provenance: 'derived', source: 'FUSION AGENT', channel: 'ANALYSIS',
      title: `Probable ignition on the ${s.sector} slopes. ${s.code} alarm corroborated by neighbouring nodes.`,
      body: 'Sensor fusion of IR flame, temperature and smoke nodes. Not yet visually confirmed. Simulated.', pos: s.pos, refs: [f.id],
    });
    out.push({
      id: 'orch-confirm', t: detectT + 20000, tab: 'ops', kind: 'orchestrator', severity: 'critical', provenance: 'derived', source: 'ORCHESTRATOR',
      title: 'Divert AETOS-2 to confirm the ignition visually and report to Fire Ops.', decision: 'needed', pos: s.pos,
      body: 'Visual confirmation before any dispatch recommendation. Human approval required to relay.',
    });
    cmd('fleet-confirm', detectT + 45000, 'd2', 'uav-2', 'm-d2-confirm', 3, 'Confirm ignition', 9 * 60, 'Orbit suspected ignition point', 'Mission m-d2-confirm v3 · EO orbit 420 m radius.', s.pos);
    cmd('fleet-head', detectT + 3 * MIN, 'd1', 'uav-1', 'm-d1-head', 2, 'Map head fire', 60 * 60, 'Map head fire downwind (nadir)', 'Mission m-d1-head v2 · nadir mapping run ahead of the front.', s.pos);
    out.push({
      id: 'det-visual', t: detectT + 4 * MIN, tab: 'ops', kind: 'analysis', severity: 'critical', provenance: 'simulated', source: 'VISION AGENT', channel: 'ANALYSIS',
      title: 'AETOS-2 EO frames show an active flame front in low vegetation. Smoke drifting east.', pos: s.pos, refs: ['feed-uav-2'],
      body: 'Simulated feed analysis. Model score, not a confidence statement.',
    });
  }

  /* ---------------- OPS: projection runs (observable inputs only) */
  if (detectT !== null) {
    let rev = 1;
    for (let t = detectT + 6 * MIN; t <= end; t += 20 * MIN, rev++) {
      const w = pack.weather.reduce((best, x) => (x.t <= t && x.t > best.t ? x : best), pack.weather[0]);
      out.push({
        id: `proj-${rev}`, t, tab: 'ops', kind: 'projection', severity: rev === 1 ? 'alert' : 'info', provenance: 'derived', source: 'PROJECTION AGENT', channel: 'ANALYSIS',
        title: `Spread projection rev ${rev} · +1 h / +3 h / +6 h bands · wind ${two(w.windDirDeg)}° ${Math.round(w.windKph)} km/h`,
        body: 'Toy estimate: minimum travel time on DEM, fuel and the latest hourly wind. Seeded only from fire observed by this time.',
      });
    }
  }

  /* ---------------- OPS: sector alarms → orchestrator recommendations */
  const sectorNote: Record<string, [string, string, string, string]> = {
    'Neos Voutzas': ['Front reaching Neos Voutzas. Evacuation notice drafted for the settlement.', 'd3', 'Overwatch Neos Voutzas', 'neos-voutzas'],
    'Marathonos Ave': ['Fire at Marathonos Avenue. Recommend police hold traffic toward Mati and open the coastal route.', 'd5', 'Overwatch Marathonos Ave', 'marathonos-crossing'],
    Mati: ['Fire entering Mati. Recommend shoreline advisory relayed to Coast Guard VHF 16.', 'd6', 'Shoreline overwatch Mati', 'mati'],
    'Kokkino Limanaki': ['Smoke at Kokkino Limanaki shoreline. Recommend boats requested via Coast Guard.', 'd6', 'Shoreline overwatch Kokkino', 'kokkino-limanaki'],
  };
  for (const [sector, a] of firstSectorAlarm) {
    const note = sectorNote[sector];
    if (!note) continue;
    const [title, asset, label, pid] = note;
    const pos = place(pid) ?? spec(a.id).pos;
    out.push({
      id: `orch-${sector}`, t: a.t + 50000, tab: 'ops', kind: 'orchestrator', severity: 'critical', provenance: 'derived', source: 'ORCHESTRATOR',
      title, body: `Triggered by ${spec(a.id).code}. High-risk recommendation: requires a human approval.`, decision: 'needed', pos, refs: [a.id],
    });
    cmd(`fleet-${sector}`, a.t + 80000, asset, `uav-${asset.slice(1)}`, `m-${asset}-${pid}`, 4, label, 45 * 60, label, `Mission m-${asset}-${pid} v4 · oblique EO, 150 m AGL.`, pos);
  }

  /* ---------------- OPS: night thermal sweep */
  const light: { t: Ms; daylight: number }[] = [];
  const c = pack.manifest.center;
  let nightAt: Ms | null = null;
  for (let t = start; t <= end; t += 5 * MIN) {
    const d = daylight(sunPosition(t, c.lat, c.lon).elDeg);
    light.push({ t, daylight: d });
    if (nightAt === null && d < 0.2) nightAt = t;
  }
  if (nightAt !== null) {
    out.push({
      id: 'orch-night', t: nightAt, tab: 'ops', kind: 'orchestrator', severity: 'watch', provenance: 'derived', source: 'ORCHESTRATOR',
      title: 'Loss of daylight. Fleet switching to thermal; mop-up sweeps over the burned area.',
    });
    cmd('fleet-night', nightAt + 40000, 'd3', 'uav-3', 'm-d3-night', 5, 'Night thermal sweep', 80 * 60, 'Thermal sweep of burned area', 'Mission m-d3-night v5 · white-hot thermal, 120 m AGL. Simulated thermal, no temperatures.');
  }

  // Recon owns actual drone tasking. Keep scripted review/receipt history only for Ops.
  if (profile === 'recon') {
    for (let i = out.length - 1; i >= 0; i--) {
      const e = out[i];
      if (e.id === 'orch-night') {
        out[i] = { ...e, kind: 'analysis', severity: 'info', source: 'VISION AGENT',
          title: 'Low light reduces EO visibility. Thermal reconnaissance remains available.' };
      } else if (e.command || e.decision || ['command', 'fleet', 'orchestrator', 'projection'].includes(e.kind)) out.splice(i, 1);
    }
  }
  out.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const firstReport = (pack.reports ?? []).filter((r) => r.t >= start).sort((a, b) => a.t - b.t)[0]?.t ?? null;
  const firstProj = out.find((e) => e.kind === 'projection')?.t ?? null;
  const coast = pack.checkpoints?.find((x) => x.id === 'coast-mati')?.t ?? null;
  const ch: (Chapter | null)[] = [
    { id: 'risk', t: watchAt ?? start, label: 'Pre-ignition risk', short: 'RISK' },
    { id: 'ignition', t: ignitionT, label: 'Ignition', short: 'IGN' },
    detectT !== null ? { id: 'detection', t: detectT, label: 'Detection', short: 'DET' } : null,
    firstReport !== null ? { id: 'report', t: firstReport, label: 'First report', short: 'RPT' } : null,
    firstProj !== null ? { id: 'projection', t: firstProj, label: 'Projection', short: 'PROJ' } : null,
    coast !== null ? { id: 'coast', t: coast, label: 'Coastal run', short: 'COAST' } : null,
    nightAt !== null ? { id: 'night', t: nightAt, label: 'Night', short: 'NIGHT' } : null,
  ];
  const chapters = ch.filter((x): x is Chapter => !!x && x.t >= start && x.t <= end);

  const result: Chronicle = { pack, sensors, start, end, ignitionT, detectT, entries: out, chapters, risk, light };
  cache.set(pack, result);
  return result;
}

/** Entries visible at t (binary search on the sorted track). */
export function visibleAt(ch: Chronicle, t: Ms): ChronicleEntry[] {
  let lo = 0, hi = ch.entries.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ch.entries[mid].t <= t) lo = mid + 1; else hi = mid; }
  return ch.entries.slice(0, lo);
}

export const severityRank = sevRank;
