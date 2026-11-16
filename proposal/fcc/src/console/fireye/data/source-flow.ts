import type { ConsoleState } from '../../contracts';
import type { Chronicle } from './chronicle';

export const SOURCE_LABELS: Record<string, string> = {
  vision: 'Camera analysis', iot: 'Ground sensor mesh', weather: 'Weather intelligence',
  radio: 'Radio intake', terrain: 'Terrain & spread projection', connection: 'Source connection',
};
export interface SourceFlowStep {
  id: string; t: number; stage: 'ingest' | 'analysis' | 'orchestrator' | 'execution';
  title: string; body?: string; status: 'running' | 'queued' | 'done';
}

/** Only recorded source references connect a command to an input. No invented reasoning traces. */
export function sourceFlow(state: ConsoleState, ch: Chronicle | null, sourceId: string): SourceFlowStep[] {
  const t = state.clock.t, feed = state.feeds.find(f => f.id === sourceId);
  const station = state.recon?.stations?.find(s => s.id === sourceId);
  const units = station ? state.recon?.drones?.filter(d => d.stationId === station.id).map(d => d.unitId) ?? [] : feed?.unitId ? [feed.unitId] : [];
  const matches = (refs: string[]) => refs.includes(sourceId) || units.some(id => refs.includes(id))
    || (sourceId === 'vision' && refs.some(id => id.startsWith('feed-') || id === 'vision'));
  const out: SourceFlowStep[] = [];
  for (const e of ch?.entries ?? []) {
    if (e.t > t) continue;
    const include = matches(e.refs ?? []) || (sourceId === 'iot' && (e.kind === 'iot' || e.source === 'RISK AGENT'))
      || (sourceId === 'weather' && (e.kind === 'weather' || e.source === 'RISK AGENT'))
      || (sourceId === 'radio' && e.kind === 'radio')
      || (sourceId === 'vision' && e.source === 'VISION AGENT')
      || (sourceId === 'terrain' && e.kind === 'projection');
    if (include) out.push({ id: `source-${e.id}`, t: e.t, stage: e.tab === 'intake' ? 'ingest' : 'analysis', title: e.title, body: e.body, status: 'done' });
  }
  for (const f of state.findings) {
    if (f.observedAt > t || !(matches(f.sourceIds) || (sourceId === 'vision' && f.sourceIds.some(id => id.startsWith('feed-'))))) continue;
    out.push({ id: `finding-${f.id}`, t: f.observedAt, stage: 'analysis', title: f.label, body: f.detail, status: 'done' });
  }
  // Pool-level jobs are shown only in aggregate views, never falsely attributed to an individual camera.
  const kinds = sourceId === 'vision' ? ['drone-cam', 'ground-cam', 'fixed-cam'] : sourceId === 'weather' ? ['weather'] : sourceId === 'radio' ? ['radio'] : sourceId === 'terrain' ? ['terrain'] : [];
  for (const job of state.jobs) {
    const at = job.finishedAt ?? job.startedAt ?? job.queuedAt;
    if (!kinds.includes(job.source) || at > t) continue;
    out.push({ id: job.id, t: at, stage: 'analysis', title: `${job.agent} · ${job.status}`, body: job.input, status: job.status });
  }
  for (const e of state.recon?.events ?? []) {
    if (e.t > t || !matches(e.refs ?? [])) continue;
    const stage = e.kind !== 'fleet' ? 'analysis' : e.tasking ? 'orchestrator' : 'execution';
    out.push({ id: e.id, t: e.t, stage, title: e.title, body: e.body, status: 'done' });
  }
  return out.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id)).slice(-120);
}
