/**
 * TypeScript port of the wildfire-sweep drone dispatch physics (research.py flight_times /
 * dispatch_physical, single alert with an idle fleet, matching simulator_engine.run_mission).
 * Synthetic model: not flight authorization. See docs/provenance/wildfire-sweep-dispatch.md.
 */

export interface DispatchParams {
  airspeedMps: number;
  windMps: [number, number];
  enduranceMin: number;
  reserveFraction: number;
  launchLatencyS: number;
  maxWindMps: number;
  dwellS: number;
}

/** Defaults from simulator_protocol.json, dwell from sweep.py CONFIG. */
export const SWEEP_DEFAULTS: DispatchParams = {
  airspeedMps: 18,
  windMps: [0, 0],
  enduranceMin: 46,
  reserveFraction: 0.25,
  launchLatencyS: 60,
  maxWindMps: 12,
  dwellS: 120,
};

export interface DispatchBase { id: string; xKm: number; yKm: number; available: boolean }

export interface DispatchCandidate {
  baseId: string;
  outboundS: number | null;
  returnS: number | null;
  airborneS: number | null;
  arrivalS: number | null;
  flightOk: boolean;
  batteryOk: boolean;
  eligible: boolean;
  reason: 'offline' | 'weather' | 'flight' | 'battery' | 'eligible';
}

export interface DispatchResult {
  status: 'served' | 'weather_rejected' | 'battery_rejected' | 'flight_rejected';
  selectedBaseId: string | null;
  responseS: number | null;
  within15min: boolean;
  usableAirborneS: number;
  candidates: DispatchCandidate[];
}

const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);

/**
 * Wind-triangle flight times for a displacement (dx east, dy north, km) under a steady wind
 * vector (m/s, blowing-toward, x east y north). Infinity when the leg is infeasible.
 */
export function flightTimes(
  dxKm: number,
  dyKm: number,
  airspeedMps: number,
  wind: [number, number],
): { outS: number; backS: number } {
  const distanceM = Math.hypot(dxKm, dyKm) * 1000;
  if (distanceM === 0) return { outS: 0, backS: 0 };
  const ux = dxKm / (distanceM / 1000);
  const uy = dyKm / (distanceM / 1000);
  const along = ux * wind[0] + uy * wind[1];
  const crossSquared = Math.max(0, wind[0] * wind[0] + wind[1] * wind[1] - along * along);
  const feasible = crossSquared < airspeedMps * airspeedMps;
  const alongAir = Math.sqrt(Math.max(0, airspeedMps * airspeedMps - crossSquared));
  const outbound = alongAir + along;
  const inbound = alongAir - along;
  return {
    outS: feasible && outbound > 0 ? distanceM / outbound : Infinity,
    backS: feasible && inbound > 0 ? distanceM / inbound : Infinity,
  };
}

/**
 * Single-alert dispatch over an idle fleet: for every base, compute the round-trip physics,
 * pick the eligible base with the earliest arrival (first index wins ties, like np.argmin),
 * and explain every base's eligibility. Unavailable bases still get physics like run_mission.
 */
export function planDispatch(
  point: { xKm: number; yKm: number },
  bases: DispatchBase[],
  p?: Partial<DispatchParams>,
): DispatchResult {
  const params = { ...SWEEP_DEFAULTS, ...p };
  const usable = params.enduranceMin * 60 * (1 - params.reserveFraction);
  const weatherClosed = Math.hypot(params.windMps[0], params.windMps[1]) > params.maxWindMps;

  const candidates: DispatchCandidate[] = bases.map((base) => {
    const { outS, backS } = flightTimes(point.xKm - base.xKm, point.yKm - base.yKm, params.airspeedMps, params.windMps);
    const airborne = outS + params.dwellS + backS;
    const arrival = params.launchLatencyS + outS;
    const flightOk = Number.isFinite(airborne);
    const batteryOk = flightOk && airborne <= usable + 1e-9;
    const eligible = base.available && batteryOk && !weatherClosed;
    const reason = !base.available ? 'offline'
      : weatherClosed ? 'weather'
      : !flightOk ? 'flight'
      : !batteryOk ? 'battery'
      : 'eligible';
    return {
      baseId: base.id,
      outboundS: finite(outS),
      returnS: finite(backS),
      airborneS: finite(airborne),
      arrivalS: finite(arrival),
      flightOk,
      batteryOk,
      eligible,
      reason,
    };
  });

  // np.argmin semantics: scan once, keep the first strictly-smallest arrival.
  let selected = -1;
  let best = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const arrival = c.eligible && c.arrivalS != null ? c.arrivalS : Infinity;
    if (arrival < best) { best = arrival; selected = i; }
  }

  let status: DispatchResult['status'];
  let responseS: number | null = null;
  if (selected >= 0) {
    status = 'served';
    responseS = candidates[selected]!.arrivalS;
  } else if (weatherClosed) {
    status = 'weather_rejected';
  } else {
    // dispatch_physical sees only available bases.
    const anyFiniteAirborne = candidates.some((c, i) => bases[i]!.available && c.airborneS != null);
    status = anyFiniteAirborne ? 'battery_rejected' : 'flight_rejected';
  }

  return {
    status,
    selectedBaseId: selected >= 0 ? candidates[selected]!.baseId : null,
    responseS,
    within15min: responseS != null && responseS <= 900,
    usableAirborneS: usable,
    candidates,
  };
}

/** Equirectangular offset in km from `origin` to `g` (x east, y north). */
export function toLocalKm(origin: { lon: number; lat: number }, g: { lon: number; lat: number }): { xKm: number; yKm: number } {
  const R = 6371.0088;
  const d2r = Math.PI / 180;
  return {
    xKm: (g.lon - origin.lon) * d2r * R * Math.cos(origin.lat * d2r),
    yKm: (g.lat - origin.lat) * d2r * R,
  };
}

/** Meteorological "from" direction (deg true) + speed (km/h) → blowing-toward vector in m/s. */
export function windVector(windKph: number, windDirDeg: number): [number, number] {
  const toward = ((windDirDeg + 180) % 360) * (Math.PI / 180);
  const mps = windKph / 3.6;
  return [mps * Math.sin(toward), mps * Math.cos(toward)];
}
