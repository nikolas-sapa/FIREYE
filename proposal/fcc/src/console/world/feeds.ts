import type { Feed, FindingKind, Finding, Geo, Unit } from '../contracts';
import type { ScenarioContext } from './context';
import type { Sim } from './sim';
import { MIN, angDiff, bearingDeg, clamp, destination, distanceM } from './geo';
import { requestConfirm } from '../agents/swarm';
import { isOnPad } from './drone-stations';

export function isNight(ctx: ScenarioContext, t: number): boolean {
  const h = (((t + ctx.tzOffsetMin * MIN) / 3_600_000) % 24 + 24) % 24;
  return h < 6.2 || h >= 20;
}

/** Aim the ridge camera at terrain, not above a fire hundreds of metres below its mount. */
function ridgeAim(ctx: ScenarioContext, pos: Geo, target: Geo) {
  const range = Math.max(1, distanceM(pos, target));
  return {
    headingDeg: bearingDeg(pos, target),
    pitchDeg: clamp(Math.atan2(ctx.elevAt(target) - ctx.elevAt(pos) - 18, range) * 180 / Math.PI, -60, 15),
  };
}

export function createFeeds(sim: Sim): Feed[] {
  const feeds: Feed[] = [];
  for (const u of sim.units) {
    if (u.kind === 'drone') {
      const n = Number(u.id.split('-')[1]);
      const gimbal = n === 3 || n % 2 === 0;
      const fx = n === 3 ? 'eo' : n % 2 === 0 ? 'ir-ironbow' : 'eo';
      feeds.push({
        id: `feed-${u.id}`,
        modality: n % 2 === 0 && n !== 3 ? 'thermal' : 'eo',
        sourceKind: 'simulated', synthetic: true, radiometric: false, calibration: null,
        unitId: u.id,
        kind: gimbal ? 'uav-oblique' : 'uav-nadir',
        fx,
        label: `${u.callsign} · ${fx === 'eo' ? 'EO' : 'IR'} ${gimbal ? 'GIMBAL' : 'NADIR'}`,
        live: true,
        pose: { mode: 'unit', pitchDeg: gimbal ? -40 : -90, fovDeg: gimbal ? 45 : 60 },
        relevance: 10,
        findingIds: [],
      });
      const primary = feeds[feeds.length - 1];
      const modality = primary.modality === 'thermal' ? 'eo' : 'thermal';
      feeds.push({
        ...primary, id: `feed-${u.id}-${modality}`, modality,
        fx: modality === 'thermal' ? 'ir-whitehot' : 'eo',
        label: `${u.callsign} · ${modality === 'thermal' ? 'IR' : 'EO'} ${gimbal ? 'GIMBAL' : 'NADIR'}`,
        pose: { ...primary.pose }, findingIds: [],
      });
    } else if (u.kind === 'engine' || u.kind === 'dozer') {
      feeds.push({ id: `feed-${u.id}`, unitId: u.id, kind: 'dash-cam', fx: 'eo', label: `${u.callsign} · DASH CAM`, live: true, pose: { mode: 'unit', pitchDeg: -6, fovDeg: 75 }, relevance: 8, findingIds: [] });
    } else if (sim.umeta.get(u.id)?.helmetCam) {
      feeds.push({ id: `feed-${u.id}`, unitId: u.id, kind: 'helmet-cam', fx: 'eo', label: `${u.callsign} · HELMET CAM`, live: true, pose: { mode: 'unit', pitchDeg: -12, fovDeg: 85 }, relevance: 8, findingIds: [] });
    }
  }
  for (const r of sim.ctx.ridge) {
    feeds.push({
      id: `feed-${r.id}`,
      kind: 'ridge-cam',
      fx: 'eo',
      label: r.name,
      live: true,
      pose: { mode: 'fixed', pos: { lon: r.pos.lon, lat: r.pos.lat, alt: sim.ctx.elevAt(r.pos) + 18 }, ...ridgeAim(sim.ctx, r.pos, sim.recon ? sim.ctx.pack.manifest.center : sim.ctx.sites.fireCenterT0), fovDeg: 50 },
      relevance: 20,
      findingIds: [],
    });
  }
  if (sim.recon) {
    const mounts: [string, string, number][] = [
      ['neos-voutzas', 'VOUTZAS WUI CCTV', 270], ['mati', 'MATI WEST CCTV', 265],
      ['kallitechnoupoli', 'KALLITECHNOUPOLI CCTV', 315], ['kokkino-limanaki', 'KOKKINO LIMANAKI CCTV', 285],
      ['rafina', 'RAFINA NORTH CCTV', 330], ['nea-makri', 'NEA MAKRI SOUTH CCTV', 200],
    ];
    mounts.forEach(([id, label, heading], i) => {
      const place = sim.ctx.pack.manifest.places.find(p => p.id === id);
      const p = place?.pos ?? destination(sim.ctx.pack.manifest.center, i * 60, 1600);
      const target = destination(p, heading, 650);
      feeds.push({ id: `feed-cctv-${id}`, kind: 'ridge-cam', fx: 'eo', label: `${label} · SIMULATED`,
        live: true, pose: { mode: 'fixed', pos: { ...p, alt: sim.ctx.elevAt(p) + 18 }, target, ...ridgeAim(sim.ctx, p, target), fovDeg: 65 },
        relevance: 18, findingIds: [] });
    });
  }
  const c = sim.ctx.sites.fireCenterT0;
  if (sim.profile !== 'recon') feeds.push({
    id: 'feed-sat',
    kind: 'satellite',
    fx: 'sat',
    label: 'SATELLITE · LATEST ARCHIVED SCENE',
    live: false,
    pose: { mode: 'fixed', pos: { lon: c.lon, lat: c.lat, alt: 700_000 }, target: c, pitchDeg: -90, fovDeg: 3, rangeM: 60_000 },
    relevance: 12,
    findingIds: [],
  });
  return feeds;
}

/** A transient, non-live feed for a social clip, placed where the clip was filmed. */
export function addSocialFeed(sim: Sim, f: Finding): string {
  const id = `feed-social-${f.id}`;
  if (sim.profile === 'recon') return id;
  if (sim.feeds.some((x) => x.id === id)) return id;
  const target = sim.projHead ?? sim.ctx.sites.fireCenterT0;
  sim.feeds.push({
    id,
    kind: 'social',
    fx: 'phone',
    label: `SOCIAL CLIP · ${f.label.split('·')[0].trim()}`,
    live: false,
    pose: { mode: 'fixed', pos: { lon: f.pos.lon, lat: f.pos.lat, alt: sim.ctx.elevAt(f.pos) + 1.6 }, headingDeg: bearingDeg(f.pos, target), pitchDeg: 4, fovDeg: 65 },
    relevance: 30,
    findingIds: [f.id],
  });
  return id;
}

export function removeFeedsFor(sim: Sim, findingId: string): void {
  sim.feeds = sim.feeds.filter((x) => !(x.kind === 'social' && x.findingIds[0] === findingId));
}

/** Ground point a camera is looking at and the radius it covers. */
export function footprint(sim: Sim, f: Feed, u: Unit | undefined): { center: Geo; r: number } | null {
  if (sim.recon && f.pose.target && u) return { center: f.pose.target, r: 320 };
  if (f.pose.mode === 'orbit' && f.pose.target) return { center: f.pose.target, r: 320 };
  if (!u) return null;
  if (f.kind === 'uav-nadir') return { center: u.pos, r: 260 };
  if (f.kind === 'uav-oblique' || f.kind === 'uav-chase') return { center: destination(u.pos, u.heading, 150), r: 320 };
  void sim;
  return null;
}

export function seesPos(sim: Sim, f: Feed, u: Unit | undefined, p: Geo, kind: FindingKind): boolean {
  switch (f.kind) {
    case 'uav-nadir':
    case 'uav-oblique':
    case 'uav-chase': {
      const fp = footprint(sim, f, u);
      return !!fp && distanceM(fp.center, p) <= fp.r;
    }
    case 'dash-cam':
    case 'helmet-cam': {
      if (!u) return false;
      const d = distanceM(u.pos, p);
      const lim = f.kind === 'dash-cam' ? 300 : 160;
      return d <= lim && (d < 40 || Math.abs(angDiff(u.heading, bearingDeg(u.pos, p))) <= 50);
    }
    case 'ridge-cam': {
      if (kind !== 'spot' && kind !== 'smoke') return false;
      const pos = f.pose.pos;
      return !!pos && distanceM(pos, p) <= 14000 && Math.abs(angDiff(f.pose.headingDeg ?? 0, bearingDeg(pos, p))) <= 40;
    }
    case 'satellite':
      return kind === 'smoke' || kind === 'fuel';
    default:
      return false;
  }
}

const BOX: Partial<Record<FindingKind, [number, number]>> = {
  human: [0.07, 0.14],
  animal: [0.12, 0.1],
  vehicle: [0.13, 0.09],
  combustible: [0.1, 0.1],
  spot: [0.16, 0.14],
  structure: [0.2, 0.16],
  'road-block': [0.18, 0.08],
};

/** Normalized detection box for a finding seen in a feed frame. */
export function frameBox(sim: Sim, f: Feed, u: Unit | undefined, p: Geo, kind: FindingKind): Finding['bbox'] {
  const [bw, bh] = BOX[kind] ?? [0.14, 0.12];
  let x = 0.5;
  let y = 0.5;
  const fp = footprint(sim, f, u);
  if (fp) {
    const d = distanceM(fp.center, p);
    const b = bearingDeg(fp.center, p) - (u?.heading ?? 0);
    x = 0.5 + (Math.sin((b * Math.PI) / 180) * d) / (fp.r * 2.2);
    y = 0.5 - (Math.cos((b * Math.PI) / 180) * d) / (fp.r * 2.2);
  } else if (u) {
    x = 0.5 + angDiff(u.heading, bearingDeg(u.pos, p)) / (f.pose.fovDeg ?? 70);
    y = 0.58;
  }
  return { feedId: f.id, x: clamp(x - bw / 2, 0.02, 0.98 - bw), y: clamp(y - bh / 2, 0.02, 0.98 - bh), w: bw, h: bh };
}

export function updateFeeds(sim: Sim): void {
  const night = isNight(sim.ctx, sim.t);
  const umap = new Map(sim.units.map((u) => [u.id, u]));
  const look = sim.projHead ?? (sim.recon ? sim.ctx.pack.manifest.center : sim.ctx.sites.fireCenterT0);
  for (const f of sim.feeds) {
    const u = f.unitId ? umap.get(f.unitId) : undefined;
    if (u && u.kind === 'drone') {
      const drone = sim.recon?.drones.find(d => d.unitId === u.id);
      const offline = drone && (isOnPad(drone) || (u.pos.alt ?? 0) < 12);
      if (drone) {
        f.live = !offline;
        f.offlineReason = offline ? `${drone.phase === 'charging' ? 'Recharging' : drone.phase === 'launching' ? 'Taking off' : 'At station'} · camera powered down` : undefined;
      }
      if (offline) { f.findingIds = []; continue; }
      const m = sim.umeta.get(u.id);
      const task = sim.recon?.tasks.find(t => t.id === u.taskId);
      const n = Number(u.id.split('-')[1]), gimbal = n === 3 || n % 2 === 0;
      if (sim.recon) {
        f.kind = gimbal ? 'uav-oblique' : 'uav-nadir';
        f.label = `${u.callsign} · ${f.modality === 'thermal' ? 'IR' : 'EO'} ${task?.pattern === 'hover' ? 'HOVER LOCK' : gimbal ? 'GIMBAL' : 'NADIR'}`;
      }
      if (task?.pattern === 'hover') {
        f.kind = 'uav-oblique';
        f.pose = { mode: 'unit', target: task.target, fovDeg: 45 };
      } else if (m && m.plan.mode === 'orbit') {
        f.pose = { mode: 'orbit', target: { lon: m.plan.center.lon, lat: m.plan.center.lat }, rangeM: 420, pitchDeg: -35, headingDeg: (m.plan.ang + 180) % 360, fovDeg: 30 };
      } else {
        const nadir = f.kind === 'uav-nadir';
        f.pose = { mode: 'unit', pitchDeg: nadir ? -90 : -40, fovDeg: nadir ? 60 : 45, headingDeg: u.heading };
      }
    } else if (u) {
      f.pose = { ...f.pose, mode: 'unit', headingDeg: u.heading };
      f.fx = night ? 'night' : 'eo';
    } else if (f.kind === 'ridge-cam' && f.pose.pos) {
      f.fx = night ? 'night' : 'eo';
      f.pose = { ...f.pose, ...ridgeAim(sim.ctx, f.pose.pos, f.pose.target ?? look) };
    }
    if (f.kind !== 'social') {
      const ids: string[] = [];
      for (const fd of sim.findings) {
        const fm = sim.fmeta.get(fd.id);
        if (fm && seesPos(sim, f, u, fm.truePos, fd.kind)) ids.push(fd.id);
      }
      f.findingIds = ids;
    }
  }
}

/** Live flags, re-acquisition and drone confirmation requests. */
export function updateLive(sim: Sim): void {
  const umap = new Map(sim.units.map((u) => [u.id, u]));
  const seenBy = new Map<string, Feed[]>();
  for (const f of sim.feeds) {
    if (!f.live || f.kind === 'social') continue;
    for (const id of f.findingIds) {
      const l = seenBy.get(id);
      if (l) l.push(f);
      else seenBy.set(id, [f]);
    }
  }
  for (const fd of sim.findings) {
    const fm = sim.fmeta.get(fd.id);
    if (!fm) continue;
    const feeds = seenBy.get(fd.id) ?? [];
    const drone = feeds.find((f) => f.kind.startsWith('uav'));
    if (fm.confirmable && !fm.confirmed) {
      if (drone && !fm.confirmQueued) requestConfirm(sim, fd, drone);
      continue;
    }
    const best = drone ?? feeds.find((f) => f.kind === 'dash-cam' || f.kind === 'helmet-cam') ?? feeds[0];
    if (best && best.kind !== 'satellite' && best.kind !== 'ridge-cam') {
      if (!fd.live) {
        fd.live = true;
        if (!fm.sourceKinds.includes(best.kind.startsWith('uav') ? 'drone-cam' : 'ground-cam')) fm.sourceKinds.push(best.kind.startsWith('uav') ? 'drone-cam' : 'ground-cam');
        if (!fd.sourceIds.includes(best.id)) fd.sourceIds = [...fd.sourceIds, best.id];
      }
      fd.observedAt = sim.t;
      fd.bbox = frameBox(sim, best, best.unitId ? umap.get(best.unitId) : undefined, fm.truePos, fd.kind);
    } else if (fd.live) {
      fd.live = false;
      fd.observedAt = sim.t;
      if (!fm.persistent) fd.halfLifeS = 300;
    }
  }
}
