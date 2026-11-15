import type { Draft, Finding, Geo, Ms, ScenarioId, Unit, UnitKind } from '../../contracts';
import type { CoreSites, Place, RidgeSite, ScenarioContext, SiteHelpers, Sites } from '../../world/context';
import type { Plan, Sim } from '../../world/sim';
import type { FindingSpec } from '../../agents/catalog';
import type { BeatDef } from '../beats';

export interface UnitSpec {
  id: string;
  callsign: string;
  kind: UnitKind;
  division?: Unit['division'];
  pos: Geo;
  plan?: Plan;
  patrol?: Geo[];
  alt?: number;
  /** Straight-line movement over water (boats). */
  marine?: boolean;
  /** Cruise speed override (m/s). */
  cruise?: number;
  helmetCam?: boolean;
}

export type EvacType = 'ORDER' | 'WARNING';

/** Scenario-specific wording and unit choices for the Orchestrator's rules and drafts. */
export interface ScenarioPlans {
  /** Drone preferred for the first retask to confirm people. */
  preferDroneId?: string;
  evac?: {
    /** Further places inside the evacuation zone; the zone ETA is the earliest modelled arrival over them and the primary. */
    zonePlaceIds?: string[];
    /** Propose an ORDER when the modelled head ETA to the zone is at most this (min). */
    orderMin: number;
    /** Propose a WARNING at most this (min) before an ORDER; 0 disables the WARNING stage. */
    warningMin: number;
    title(type: EvacType, ctx: ScenarioContext): string;
    summary(type: EvacType, etaMin: number, rev: number, ctx: ScenarioContext): string;
    unitIds: string[];
    /** Law unit sent to traffic control when the notice is issued. */
    trafficUnitId?: string;
    draft(sim: Sim, type: EvacType, etaMin: number): Draft;
    doneText(title: string): string;
  };
  moveGroup?: {
    unitIds: string[];
    target(ctx: ScenarioContext): Geo;
    safetyLabel: string;
    title(ctx: ScenarioContext): string;
    draft(sim: Sim, units: Unit[], path: Geo[]): Draft;
  };
  resource?: { title: string; summary(sim: Sim): string; draft(sim: Sim, etaMin: number): Draft; doneText: string };
  rescue: {
    unitIds: string[];
    kinds: UnitKind[];
    /** Rescue units travel over water (boats) instead of roads. */
    marine?: boolean;
    title(f: Finding, place: string): string;
    summary(unit: Unit, drone: Unit | undefined, etaMin: number): string;
    /** Where the rescue units go (defaults to the finding). */
    approach?(sim: Sim, f: Finding): Geo;
    safety(ctx: ScenarioContext): { center: Geo; radiusM: number; label: string };
    draft(sim: Sim, f: Finding, unit: Unit, drone: Unit | undefined, path: Geo[], etaMin: number): Draft;
    doneLabel(f: Finding, unit: Unit): string;
    doneDetail(f: Finding, unit: Unit, at: string): string;
    doneSay(f: Finding, unit: Unit, released: string): string;
    returnTo(ctx: ScenarioContext): Geo;
  };
  hazard?: { title: string; transmitted: string; draft(sim: Sim, f: Finding, near: Unit[], etaMin: number): Draft };
  /** Optional reaction to a road-block finding (e.g. reroute an evacuation). */
  roadBlock?(sim: Sim, f: Finding): void;
}

export interface ScenarioScript {
  id: ScenarioId;
  /** "Caldor Fire", "Mati fire". */
  incident: string;
  seed: number;
  tzOffsetMin: number;
  areaUnit: 'acres' | 'ha';
  primary: { match: RegExp; fallback: Place; radiusM?: number };
  timeline(b: { start: Ms; end: Ms; tPrimary: Ms; ignitionT?: Ms }): { T0: Ms; tShift: Ms | null; tDetect: Ms };
  /**
   * Optional earlier playable start (before manifest.start) for pre-ignition context. Pack arrival
   * times stay relative to manifest.start; nothing burns before it.
   */
  windowStart?(b: { start: Ms; ignitionT?: Ms }): Ms;
  sites(h: SiteHelpers): Omit<CoreSites, 'primary' | 'ignition' | 'fireCenterT0'> & Record<string, Geo>;
  names?(h: SiteHelpers, sites: Sites): Record<string, string>;
  cams(h: SiteHelpers, sites: Omit<CoreSites, 'primary' | 'ignition' | 'fireCenterT0'> & Record<string, Geo>): RidgeSite[];
  units(ctx: ScenarioContext): UnitSpec[];
  catalog(ctx: ScenarioContext): FindingSpec[];
  beats(ctx: ScenarioContext): BeatDef[];
  plans: ScenarioPlans;
  satellite: { feedLabel: string; frame: string; done: string };
  queries: string[];
  socialTag: string;
  radioChannels: string[];
  weatherSource: string;
  redFlag: string;
  /** Sitrep naming (defaults to a generic situation report). */
  sitrep?: { title: string; header: string };
  intro(sim: Sim): string;
}
