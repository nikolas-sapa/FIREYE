import { legacyEntry } from './monitoring/model';

export type ConsoleEntry = 'crew' | 'replay' | 'monitoring' | 'fireye' | 'ops';

export function consoleEntry(search: string): ConsoleEntry {
  const params = new URLSearchParams(search);
  if (params.get('mode') === 'crew') return 'crew';
  if (legacyEntry(search)) return 'replay';
  const mode = params.get('mode');
  if (mode === 'monitoring') return 'monitoring';
  if (mode === 'fireye') return 'fireye';
  return 'ops';
}
