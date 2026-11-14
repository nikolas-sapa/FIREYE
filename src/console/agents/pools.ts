import type { AgentPool, SourceKind } from '../contracts';

export interface PoolDef {
  id: string;
  role: AgentPool['role'];
  source?: SourceKind;
  label: string;
  provider: string;
  model: string;
  /** Agent name prefix, e.g. "VISION" -> "VISION-07". */
  agent: string;
  maxWorkers: number;
  /** Work units accumulated per scenario minute (0 = on demand only). */
  workPerMin: number;
  /** Feeds whose footage is accumulated per source instead of `workPerMin`. */
  perSource?: 'drones' | 'ground';
  minWork: number;
  /** Agent-seconds between emitted jobs. */
  everyAgentS: number;
  baseS: number;
  perWorkS: number;
}

/**
 * Agent pools with their real vendor / model labels. Workers run in boxd sandboxes (autoscaled on queue
 * depth with a cold-start delay); `pool-boxd` is the aggregate sandbox view.
 */
export const POOL_DEFS: PoolDef[] = [
  { id: 'pool-crawl', role: 'ingest', source: 'web', label: 'Web search + scrape', provider: 'firecrawl', model: 'firecrawl · search + scrape', agent: 'CRAWL', maxWorkers: 16, workPerMin: 0.6, minWork: 1, everyAgentS: 30, baseS: 5, perWorkS: 2 },
  { id: 'pool-extract', role: 'analysis', source: 'web', label: 'Article extraction', provider: 'treq', model: 'treq · extraction', agent: 'EXTRACT', maxWorkers: 16, workPerMin: 0, minWork: 1, everyAgentS: 1e9, baseS: 4, perWorkS: 2 },
  { id: 'pool-social', role: 'analysis', source: 'social', label: 'Social video screening', provider: 'fal', model: 'fal-ai/video-understanding', agent: 'SOCIAL', maxWorkers: 24, workPerMin: 5, minWork: 3, everyAgentS: 20, baseS: 6, perWorkS: 0.6 },
  { id: 'pool-drone', role: 'analysis', source: 'drone-cam', label: 'Drone video understanding', provider: 'fal', model: 'fal-ai/video-understanding · florence-2 labels', agent: 'VISION', maxWorkers: 32, workPerMin: 0, perSource: 'drones', minWork: 30, everyAgentS: 8, baseS: 3, perWorkS: 0.04 },
  { id: 'pool-ground', role: 'analysis', source: 'ground-cam', label: 'Dash + helmet cam analysis', provider: 'fal', model: 'fal-ai/video-understanding · grounding-dino', agent: 'GROUND', maxWorkers: 24, workPerMin: 0, perSource: 'ground', minWork: 30, everyAgentS: 9, baseS: 3, perWorkS: 0.04 },
  { id: 'pool-fixed', role: 'analysis', source: 'fixed-cam', label: 'Ridge camera smoke detection', provider: 'fal', model: 'fal-ai/florence-2-large · smoke + flame', agent: 'RIDGE', maxWorkers: 8, workPerMin: 12, minWork: 6, everyAgentS: 15, baseS: 3, perWorkS: 0.3 },
  { id: 'pool-sat', role: 'analysis', source: 'satellite', label: 'Satellite fire detection', provider: 'nasa-firms', model: 'nasa-firms + nasa-gibs · prithvi burn-scar', agent: 'SAT', maxWorkers: 6, workPerMin: 0.1, minWork: 1, everyAgentS: 30, baseS: 8, perWorkS: 4 },
  { id: 'pool-weather', role: 'ingest', source: 'weather', label: 'Weather + alerts', provider: 'open-meteo', model: 'open-meteo archive · nws alerts', agent: 'WX', maxWorkers: 4, workPerMin: 1 / 15, minWork: 1, everyAgentS: 30, baseS: 2, perWorkS: 1 },
  { id: 'pool-radio', role: 'analysis', source: 'radio', label: 'Radio transcription', provider: 'fal', model: 'fal-ai/whisper → treq · extraction', agent: 'RADIO', maxWorkers: 8, workPerMin: 1.2, minWork: 0.5, everyAgentS: 25, baseS: 3, perWorkS: 3 },
  { id: 'pool-projection', role: 'projection', label: 'Fire spread projection', provider: 'treq', model: 'treq · reasoning + rothermel/elmfire', agent: 'PROJ', maxWorkers: 8, workPerMin: 0, minWork: 1, everyAgentS: 1e9, baseS: 8, perWorkS: 0 },
  { id: 'pool-orchestrator', role: 'orchestrator', label: 'Orchestrator', provider: 'treq', model: 'treq · reasoning-large', agent: 'ORCH', maxWorkers: 4, workPerMin: 0, minWork: 1, everyAgentS: 1e9, baseS: 3, perWorkS: 0 },
];

export const BOXD_POOL = { id: 'pool-boxd', label: 'Agent sandboxes', provider: 'boxd', model: 'boxd · microVM sandboxes' } as const;
