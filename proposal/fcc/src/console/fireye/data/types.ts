import type { Geo, Ms } from '../../contracts';

/* ------------------------------------------------------------------ IoT mesh (simulated) */

export type SensorKind = 'wx' | 'fuel' | 'air' | 'flame';
export type SensorStatus = 'nominal' | 'watch' | 'alarm' | 'offline';

export interface SensorSpec {
  id: string;
  /** Short display code, e.g. "WX-03". */
  code: string;
  kind: SensorKind;
  /** Placement description (nearest real place). */
  name: string;
  sector: string;
  pos: Geo;
  elevM: number;
  /** Local wind exposure multiplier (ridge > 1, valley < 1). */
  exposure: number;
}

export interface SensorReading {
  id: string;
  t: Ms;
  status: SensorStatus;
  tempC: number;
  rh: number;
  windKph: number;
  gustKph: number;
  windDirDeg: number;
  /** Dead fine fuel moisture, percent (10-h equivalent, simulated). */
  fmc: number;
  /** Particulates, micrograms per cubic metre (simulated). */
  pm25: number;
  /** Carbon monoxide, ppm (simulated). */
  co: number;
  /** Flame-detector response 0..1 (simulated, not radiometric). */
  ir: number;
  /** Fosberg fire weather index at the node (0..100, simulated inputs). */
  ffwi: number;
  /** Distance to the nearest burned cell at t (m), null when none within 3 km. */
  fireDistM: number | null;
  battery: number;
  link: number;
}

/* ------------------------------------------------------------------ chronicle (the two log tabs) */

/** INTAKE = information from outside; OPS = our own analysis, orchestration and fleet work. */
export type ChronicleTab = 'intake' | 'ops';

export type ChronicleKind =
  | 'radio' | 'iot' | 'web' | 'report' | 'satellite' | 'social' | 'weather'
  | 'analysis' | 'orchestrator' | 'fleet' | 'command' | 'projection' | 'detection';

export type ChronicleSeverity = 'info' | 'watch' | 'alert' | 'critical';

/**
 * simulated: invented for the exercise (radio, IoT, social, agent steps).
 * historical: real, sourced public information (untrusted, attributed).
 * derived: computed from the reconstruction or simulated inputs at that time.
 */
export type Provenance = 'simulated' | 'historical' | 'derived';

export interface ChronicleEntry {
  id: string;
  t: Ms;
  tab: ChronicleTab;
  kind: ChronicleKind;
  severity: ChronicleSeverity;
  provenance: Provenance;
  /** Source or actor label, e.g. "ATTICA OPS · CH 2", "FLM-01", "Kathimerini". */
  source: string;
  title: string;
  body?: string;
  pos?: Geo;
  url?: string;
  /** Radio channel or agent lane. */
  channel?: string;
  /** Related sensor / feed / unit ids. */
  refs?: string[];
  /** Fleet command with its receipt stages (backend CommandStatus), for OPS fleet entries. */
  command?: {
    id: string;
    asset: string;
    unitId?: string;
    mission: string;
    version: number;
    label: string;
    steps: { status: import('./fleet').CommandStatus; t: Ms }[];
  };
  /** Present when the entry needs (or records) a human decision. */
  decision?: 'needed' | 'approved' | 'rejected';
}

export interface RiskSample { t: Ms; value: number; sector: string }

export interface Chapter { id: string; t: Ms; label: string; short: string }
