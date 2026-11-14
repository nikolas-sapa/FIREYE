import type { Audience, GradedItem, Ms, ScenarioPack } from '../contracts';
import type { OrchAudience, OrchTier } from '@ds';

const IANA: Record<string, string> = { PDT: 'America/Los_Angeles', PST: 'America/Los_Angeles', MDT: 'America/Denver', MST: 'America/Denver' };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, opts: Intl.DateTimeFormatOptions, key: string) {
  const k = `${tz}|${key}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: IANA[tz] ?? 'America/Los_Angeles', hourCycle: 'h23', ...opts });
    fmtCache.set(k, f);
  }
  return f;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "21:04:12Z" */
export function zuluTime(t: Ms, seconds = true) {
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${seconds ? ':' + pad2(d.getUTCSeconds()) : ''}Z`;
}

/** "14:04" in the scenario's local zone. */
export function localTime(t: Ms, tz = 'PDT', seconds = false) {
  return dtf(tz, seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' }, seconds ? 'hms' : 'hm').format(new Date(t));
}

/** "AUG 16" */
export function localDay(t: Ms, tz = 'PDT') {
  return dtf(tz, { month: 'short', day: '2-digit' }, 'md').format(new Date(t)).toUpperCase();
}

/** "MON" */
export function localWeekday(t: Ms, tz = 'PDT') {
  return dtf(tz, { weekday: 'short' }, 'wd').format(new Date(t)).toUpperCase();
}

/** Local hour 0..23 for tick generation. */
export function localHour(t: Ms, tz = 'PDT') {
  return Number(dtf(tz, { hour: '2-digit' }, 'h').format(new Date(t))) % 24;
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

/** Incident number, real if the pack provides one. */
export function incidentNumber(pack: ScenarioPack | null) {
  const m = pack?.manifest as (ScenarioPack['manifest'] & { incidentNumber?: string; irwinId?: string }) | undefined;
  return m?.incidentNumber ?? 'CA-ENF-024030';
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
