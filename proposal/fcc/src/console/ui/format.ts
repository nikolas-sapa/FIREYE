import type { Audience, GradedItem, Ms, ScenarioPack } from '../contracts';
import type { OrchAudience, OrchTier } from '@ds';
import { SCENARIOS, scenarioEntry } from './scenarios';

/** Minutes east of UTC for common display labels; packs override through `registerZone`. */
const OFFSETS = new Map<string, number>([
  ['UTC', 0], ['Z', 0], ['GMT', 0],
  ['PDT', -420], ['PST', -480], ['MDT', -360], ['MST', -420], ['CDT', -300], ['EDT', -240],
  ['EEST', 180], ['EET', 120], ['CEST', 120], ['CET', 60], ['BST', 60], ['AEST', 600],
]);
for (const s of SCENARIOS) OFFSETS.set(s.tz, s.utcOffsetMin);

/** Registers the pack's own label → offset so every clock follows the manifest. */
export function registerZone(label: string, offsetMin: number) {
  if (label && Number.isFinite(offsetMin)) OFFSETS.set(label, offsetMin);
}

/** Display zone of a pack: label from the manifest, offset from manifest extras or the scenario registry. */
export function packZone(pack: ScenarioPack | null): { label: string; offsetMin: number } {
  const m = pack?.manifest as (ScenarioPack['manifest'] & { tzOffsetMin?: number; utcOffsetMin?: number }) | undefined;
  const entry = scenarioEntry(m?.id);
  const label = m?.tz ?? entry?.tz ?? 'UTC';
  const offsetMin = m?.tzOffsetMin ?? m?.utcOffsetMin ?? entry?.utcOffsetMin ?? OFFSETS.get(label) ?? 0;
  return { label, offsetMin };
}

/** Zone label for a pack (fallback "UTC"). */
export function packTz(pack: ScenarioPack | null) {
  return packZone(pack).label;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Shifts t into the zone so UTC getters read local wall time. Fixed offset: replay windows never cross a DST change. */
function wall(t: Ms, tz: string) {
  return new Date(t + (OFFSETS.get(tz) ?? 0) * 60000);
}

/** "21:04:12Z" */
export function zuluTime(t: Ms, seconds = true) {
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${seconds ? ':' + pad2(d.getUTCSeconds()) : ''}Z`;
}

/** "14:04" in the scenario's local zone. */
export function localTime(t: Ms, tz = 'UTC', seconds = false) {
  const d = wall(t, tz);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${seconds ? ':' + pad2(d.getUTCSeconds()) : ''}`;
}

/** "AUG 16" */
export function localDay(t: Ms, tz = 'UTC') {
  const d = wall(t, tz);
  return `${MONTHS[d.getUTCMonth()]} ${pad2(d.getUTCDate())}`;
}

/** "MON" */
export function localWeekday(t: Ms, tz = 'UTC') {
  return WEEKDAYS[wall(t, tz).getUTCDay()]!;
}

/** Local hour 0..23 for tick generation. */
export function localHour(t: Ms, tz = 'UTC') {
  return wall(t, tz).getUTCHours();
}
/** Scenario-relative "12 S AGO" / "4 MIN AGO" / "2 H AGO". */
export function ago(now: Ms, then: Ms) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h ago`;
}

export function minutesFrom(now: Ms, then: Ms) {
  return Math.round((then - now) / 60000);
}

export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');

export function fmtDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = seconds / 60;
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
  const h = m / 60;
  return `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

/** Contract audiences → DS relay audiences. Fire covers IC, Ops and Air. */
export function toOrchAudiences(a: Audience[]): OrchAudience[] {
  const out = new Set<OrchAudience>();
  for (const x of a) {
    if (x === 'ic' || x === 'ops' || x === 'air') out.add('fire');
    else out.add(x);
  }
  return [...out];
}

export function tierOfZone(item: Pick<GradedItem, 'zone' | 'score'>): OrchTier {
  switch (item.zone) {
    case 'Z0_INTERRUPT':
      return 0;
    case 'Z1_STAGE':
    case 'Z2_DECISION':
    case 'Z3_FOCUS':
      return 1;
    case 'Z4_AMBIENT':
      return 2;
    default:
      return 3;
  }
}

export interface AreaUnit {
  unit: 'AC' | 'HA';
  /** Converts acres (the pack's native perimeter unit) to this unit. */
  from: (acres: number) => number;
}
const ACRES: AreaUnit = { unit: 'AC', from: (a) => a };
const HECTARES: AreaUnit = { unit: 'HA', from: (a) => a * 0.40468564 };

/** Display area unit: manifest `areaUnit` if present, else acres for the Americas and hectares elsewhere. */
export function areaUnit(pack: ScenarioPack | null): AreaUnit {
  const m = pack?.manifest as (ScenarioPack['manifest'] & { areaUnit?: 'ac' | 'ha' }) | undefined;
  if (m?.areaUnit === 'ac') return ACRES;
  if (m?.areaUnit === 'ha') return HECTARES;
  return packZone(pack).offsetMin <= -180 ? ACRES : HECTARES;
}

/** Incident number if the pack provides one, else the scenario id ("MATI-2018"). */
export function incidentNumber(pack: ScenarioPack | null) {
  const m = pack?.manifest as (ScenarioPack['manifest'] & { incidentNumber?: string; irwinId?: string }) | undefined;
  return m?.incidentNumber ?? m?.irwinId ?? (m?.id ?? 'scenario').toUpperCase();
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
