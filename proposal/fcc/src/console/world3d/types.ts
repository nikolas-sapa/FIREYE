import type { BBox, Geo } from '../contracts';

/** Raster subset the world generator needs. Transferable to the worker. */
export interface WorldSourceGrid {
  w: number;
  h: number;
  bbox: BBox;
  center: Geo;
  elevation: Float32Array;
  fuel: Uint8Array;
  clc: Uint16Array | null;
}

export interface SourceRoad { kind: 'highway' | 'road' | 'track'; pts: Float32Array /* x,z pairs */; cum: Float32Array /* arclength at each point */ }
export interface SourceBuilding { x: number; z: number; kind: string; id: number }
export interface SourceImagery { width: number; height: number; bbox: BBox; pixels: Uint8ClampedArray }

/** A curated dump placed in a camera's view so every ground feed has analysis material. */
export interface CuratedSite { x: number; z: number; seed: number; kind: DumpKind }
export type DumpKind = 'household' | 'tyres' | 'green' | 'construction' | 'mixed';

export interface WorldSource {
  grid: WorldSourceGrid;
  roads: SourceRoad[];
  buildings: SourceBuilding[];
  imagery?: SourceImagery;
  sites: CuratedSite[];
  /** The 2009 Daou burn scar the 2018 fire started in (manifest ignition note); snags and dry shrubs are denser here. */
  scar?: { x: number; z: number; r: number };
}

/** Per-pixel truth classes (stable codes; additive changes only). */
export enum TruthClass {
  None = 0, Sky = 1, Water = 2, Bare = 3, GrassGround = 4, Litter = 5, Sand = 6, Paved = 7, Road = 8, Track = 9, Field = 10, DumpGround = 11,
  Tree = 20, Shrub = 21, Grass = 22, DeadVegetation = 23, Crop = 24,
  Structure = 30, Fence = 31, Utility = 32,
  Vehicle = 40, EmergencyVehicle = 41, Aircraft = 42,
  FuelContainer = 50, CombustibleDebris = 51, NonCombustibleDebris = 52, Furniture = 53,
  Person = 60, Animal = 61,
}

export type Flammability = 'none' | 'low' | 'moderate' | 'high' | 'extreme';
export const FLAMMABILITY: readonly Flammability[] = ['none', 'low', 'moderate', 'high', 'extreme'];

/** Vertex flags shared by the generator, materials and truth shader (aMeta.y). */
export const Flag = {
  None: 0, Foliage: 1, Window: 2, Lamp: 3, Wood: 4, Paint: 5, Glass: 6, Beacon: 7,
  GroundBare: 10, GroundGrass: 11, GroundLitter: 12, GroundSand: 13, GroundPaved: 14, GroundField: 15, GroundDump: 16, Road: 17, Track: 18, GroundWater: 19,
} as const;

export type Detail = 'near' | 'far';

export interface MeshArrays {
  position: Float32Array;
  color: Float32Array;
  meta: Float32Array;
  params: Float32Array;
  index?: Uint32Array;
}

export interface InstanceGroup {
  archetype: string;
  count: number;
  /** column-major 4×4 per instance */
  matrices: Float32Array;
  /** linear rgb per instance */
  colors: Float32Array;
  /** phase, sensitivity, truth class, local object id */
  params: Float32Array;
  /** first local object id (ids are contiguous per group) */
  firstId: number;
}

export interface Spawns {
  homes: Float32Array; // x,z
  nodes: Float32Array; // walkable x,z (roads, yards)
  pasture: Float32Array; // x,z
}

export interface TileData {
  key: string;
  tx: number;
  tz: number;
  detail: Detail;
  minY: number;
  maxY: number;
  terrain: MeshArrays;
  roads: MeshArrays | null;
  groups: InstanceGroup[];
  objectCount: number;
  spawns: Spawns;
  /** Garbage dumps whose centre lies in this tile (ground truth summary). */
  dumps?: DumpInfo[];
  ms: number;
}
export interface DumpInfo { x: number; z: number; r: number; kind: DumpKind; curated: boolean; items: number; canisters: number }

/** Whole-area terrain; each chunk has a full 40 m mesh and a 4× coarser skirted mesh for distant views. */
export interface FarTerrain { chunks: { mesh: MeshArrays; coarse: MeshArrays; minY: number; maxY: number; bounds: [number, number, number, number] }[]; tilesX: number; tilesZ: number; xMin: number; zMin: number }
