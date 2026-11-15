import type { Ms, ScenarioPack } from '../../contracts';
import type { ChronicleEntry, ChronicleSeverity } from './types';

/**
 * Simulated radio traffic for the exercise. Callsigns are fictional and every line is invented;
 * timing is anchored to the pack's documented checkpoints so the voice picture matches the replay.
 * No casualty or victim content.
 */
export type Channel = 'FIRE OPS' | 'AIR OPS' | 'POLICE' | 'EMS' | 'COAST GUARD' | 'CIV PROT';

interface Line { at: Ms; ch: Channel; from: string; text: string; sev?: ChronicleSeverity; place?: string }

const MIN = 60000;

export function radioScript(pack: ScenarioPack): ChronicleEntry[] {
  const m = pack.manifest as ScenarioPack['manifest'] & { ignition?: { t: Ms } };
  const I = m.ignition?.t ?? m.start + 21 * MIN;
  const cp = (id: string, fb: Ms) => pack.checkpoints?.find((c) => c.id === id)?.t ?? fb;
  const firstHouse = cp('first-house', I + 5 * MIN);
  const fingers = cp('two-fingers', I + 40 * MIN);
  const nvEdge = cp('nv-west-edge', I + 60 * MIN);
  const voutzas = cp('neos-voutzas', I + 81 * MIN);
  const marathonos = cp('marathonos', I + 98 * MIN);
  const coast = cp('coast-mati', I + 124 * MIN);
  const day = Date.UTC(new Date(I).getUTCFullYear(), new Date(I).getUTCMonth(), new Date(I).getUTCDate());
  const Z = (h: number, mm: number) => day + (h * 60 + mm) * MIN;

  const lines: Line[] = [
    { at: Z(11, 2), ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'All stations East Attica, fire danger category four in effect this afternoon. Maintain readiness, report any smoke immediately.' },
    { at: Z(11, 9), ch: 'AIR OPS', from: 'AIR OPS', text: 'Air assets committed west to the Kineta incident. East sector coverage is ground units and drone patrol until further notice.', sev: 'watch' },
    { at: Z(11, 24), ch: 'FIRE OPS', from: 'PENTELI 1', text: 'Penteli 1, routine patrol Daou sector, wind building from the west, nothing showing.' },
    { at: Z(11, 51), ch: 'POLICE', from: 'ELAS EAST', text: 'Traffic heavy on Marathonos Avenue toward the coast, beach traffic, no incidents.' },
    { at: Z(12, 18), ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'Rafina and Nea Makri engines, confirm availability. Two engines released to Kineta, remaining units hold position.' },
    { at: Z(12, 20), ch: 'FIRE OPS', from: 'RAFINA 11', text: 'Rafina 11 and 12 available, holding at station.' },
    { at: Z(12, 47), ch: 'CIV PROT', from: 'CIVPRO ATTICA', text: 'Reminder to municipalities: category four danger. Prohibit outdoor burning and machinery in forest areas.' },
    { at: Z(13, 5), ch: 'AIR OPS', from: 'AIR OPS', text: 'Gusts above fifty kilometres per hour reported on the Kineta line. East Attica drone patrol continue sweeps on Penteli slopes.', sev: 'watch' },
    { at: Z(13, 22), ch: 'FIRE OPS', from: 'PENTELI 1', text: 'Penteli 1 returning to station via Daou, very dry, wind gusting hard on the ridge.' },
    { at: I + 1 * MIN, ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'Report of smoke, Daou Penteli above the settlement. Penteli 1 respond, confirm.', sev: 'alert', place: 'ignition' },
    { at: I + 4 * MIN, ch: 'FIRE OPS', from: 'PENTELI 1', text: 'Penteli 1 on scene approach. Confirmed fire in low vegetation, spreading east with the wind. Request additional engines.', sev: 'critical', place: 'ignition' },
    { at: firstHouse + 1 * MIN, ch: 'FIRE OPS', from: 'PENTELI 1', text: 'Fire at the first houses near the origin. Wind is pushing it fast downslope east.', sev: 'critical' },
    { at: I + 9 * MIN, ch: 'AIR OPS', from: 'AIR OPS', text: 'No fixed-wing available for the east sector at this time. Helicopter H-51 will try to break off from water runs.', sev: 'alert' },
    { at: I + 12 * MIN, ch: 'POLICE', from: 'ELAS EAST', text: 'Units to Marathonos Avenue junctions, prepare for traffic control eastbound.', sev: 'alert' },
    { at: I + 15 * MIN, ch: 'EMS', from: 'EKAB DISPATCH', text: 'Two ambulances staging at Rafina. Hold for tasking, keep clear of the smoke column.' },
    { at: I + 22 * MIN, ch: 'FIRE OPS', from: 'NEA MAKRI 21', text: 'Nea Makri 21 en route via Marathonos, visibility dropping, heavy smoke over the road.', sev: 'alert' },
    { at: fingers - 2 * MIN, ch: 'FIRE OPS', from: 'PENTELI 1', text: 'Fire has split, two heads running southeast and east. Cannot hold it at the road.', sev: 'critical' },
    { at: fingers + 6 * MIN, ch: 'CIV PROT', from: 'CIVPRO ATTICA', text: 'Coordination call with municipalities of Marathonas and Rafina-Pikermi, situation update in progress.', sev: 'alert' },
    { at: nvEdge - 3 * MIN, ch: 'AIR OPS', from: 'H-51', text: 'H-51, fire at the west edge of Neos Voutzas, ember shower ahead of the front, wind very strong.', sev: 'critical', place: 'neos-voutzas' },
    { at: nvEdge + 4 * MIN, ch: 'POLICE', from: 'ELAS EAST', text: 'Heavy congestion on Marathonos, vehicles turning back. Request guidance on routes to the coast.', sev: 'alert' },
    { at: voutzas - 4 * MIN, ch: 'FIRE OPS', from: 'RAFINA 12', text: 'Rafina 12, fire in the streets of Neos Voutzas, we are protecting the road, need water supply.', sev: 'critical', place: 'neos-voutzas' },
    { at: voutzas + 6 * MIN, ch: 'EMS', from: 'EKAB DISPATCH', text: 'Ambulances hold at Rafina staging. Smoke over Marathonos too dense for safe access.', sev: 'alert' },
    { at: marathonos - 2 * MIN, ch: 'FIRE OPS', from: 'NEA MAKRI 21', text: 'Front crossing Marathonos Avenue at several points toward Mati and Kokkino Limanaki.', sev: 'critical', place: 'marathonos-crossing' },
    { at: marathonos + 5 * MIN, ch: 'COAST GUARD', from: 'OLYMPUS 16', text: 'Olympus 16, patrol boats from Rafina port proceeding north along the coast to assist at the shoreline.', sev: 'alert' },
    { at: marathonos + 12 * MIN, ch: 'POLICE', from: 'ELAS EAST', text: 'Coastal streets in Mati blocked by vehicles, officers directing people toward the shore.', sev: 'critical' },
    { at: coast - 6 * MIN, ch: 'COAST GUARD', from: 'OLYMPUS 16', text: 'People gathering at the water along the Mati shore. Requesting all available boats, fishing vessels welcome.', sev: 'critical', place: 'mati-coast' },
    { at: coast + 3 * MIN, ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'Fire has reached the coastline at Mati. All units report positions, crews keep a safe escape route.', sev: 'critical', place: 'mati-coast' },
    { at: coast + 18 * MIN, ch: 'COAST GUARD', from: 'OLYMPUS 16', text: 'Boats working the shoreline between Mati and Kokkino Limanaki, transferring people to Rafina port.', sev: 'alert' },
    { at: coast + 40 * MIN, ch: 'EMS', from: 'EKAB DISPATCH', text: 'Receiving point at Rafina port active, ambulances in position.', sev: 'alert' },
    { at: coast + 70 * MIN, ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'Flare-ups in Mati and Kokkino Limanaki. Engines continue structure protection, avoid isolated streets.', sev: 'alert' },
    { at: coast + 110 * MIN, ch: 'AIR OPS', from: 'AIR OPS', text: 'Loss of daylight, no air operations overnight. Drone thermal patrols continue over the burned area.', sev: 'watch' },
    { at: coast + 140 * MIN, ch: 'FIRE OPS', from: 'ATTICA OPS', text: 'Night shift: mop-up sectors assigned, report hot spots from thermal sweeps.', sev: 'watch' },
  ];
  const places = pack.manifest.places;
  return lines
    .filter((l) => l.at >= Z(0, 0) && l.at <= m.end)
    .map((l, i) => ({
      id: `radio-${i}`,
      t: l.at,
      tab: 'intake' as const,
      kind: 'radio' as const,
      severity: l.sev ?? 'info',
      provenance: 'simulated' as const,
      source: l.from,
      channel: l.ch,
      title: l.text,
      pos: l.place ? places.find((p) => p.id === l.place)?.pos : undefined,
    }));
}
