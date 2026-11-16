import type { CharacterId, CharacterState } from './sprites.ts';

// Pool ids ("pool-drone") and agent names ("VISION-07") share one prefix table.
const CAST: ReadonlyArray<[RegExp, CharacterId]> = [
  [/^(pool-orchestrator|orch)/i, 'chief'],
  [/^(pool-drone|vision|pool-sat|sat)/i, 'scout'],
  [/^(pool-radio|radio|pool-crawl|crawl|pool-extract|extract|pool-social|social)/i, 'relay'],
  [/^(pool-weather|wx|pool-projection|proj)/i, 'tender'],
  [/^(pool-ground|ground|pool-fixed|ridge)/i, 'ranger'],
  [/(civilian|public|warning|warn|alert|112|evac)/i, 'rescue'],
];

export function characterForAgent(agentOrPoolId: string): CharacterId {
  for (const [pattern, id] of CAST) {
    if (pattern.test(agentOrPoolId)) return id;
  }
  return 'relay';
}

export function stateForPool(p: { workers: number; queue: number }, alert?: boolean): CharacterState {
  if (alert) return 'alert';
  if (p.workers > 0) return 'working';
  if (p.queue > 0) return 'thinking';
  return 'idle';
}
