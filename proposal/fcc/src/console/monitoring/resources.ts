import { useEffect, useRef, useState } from 'react';
import type { SourceResult } from './model';

export type ResourceOrigin = 'retrieved' | 'in-memory-last-known' | 'local-storage' | 'bundled';
export interface Resource<T> { value?: SourceResult<T>; loading: boolean; error?: string; saved?: boolean; origin?: ResourceOrigin }
export function sourceLabel(resource: Resource<unknown>): string {
  switch (resource.origin) {
    case 'retrieved': return 'Retrieved data';
    case 'in-memory-last-known': return 'Last known real data (memory)';
    case 'local-storage': return 'Saved real data (local storage)';
    case 'bundled': return 'Bundled real snapshot';
    default: return 'Source origin unknown';
  }
}
export function detectionSummary(resource: Resource<unknown>, count: number): string {
  if (!resource.value) return `Thermal detection count unknown · ${resource.loading ? 'retrieving source' : 'source unavailable'}`;
  const origin = resource.origin === 'retrieved' ? 'retrieved data'
    : resource.origin === 'in-memory-last-known' ? 'last known data (memory)'
      : resource.origin === 'local-storage' ? 'saved local data'
        : resource.origin === 'bundled' ? 'bundled snapshot' : 'source data (origin unknown)';
  return `${count} thermal detections in ${origin}`;
}
const PREFIX = 'fcc.monitor.v1.';
const MAX_SAVED = 4 * 1024 * 1024;
export function readSaved<T>(key: string): SourceResult<T> | undefined {
  if (!['firms', 'forecast', 'metar', 'case2024'].includes(key)) return;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw || raw.length > MAX_SAVED) return;
    const data = JSON.parse(raw) as SourceResult<T>;
    return data && typeof data.source === 'string' && typeof data.fetchedAt === 'string'
      && Number.isFinite(Date.parse(data.fetchedAt)) && data.data !== undefined ? data : undefined;
  } catch { return; }
}
export function writeSaved(key: string, value: SourceResult<unknown>): boolean {
  if (!['firms', 'forecast', 'metar', 'case2024'].includes(key)) return false;
  try {
    const body = JSON.stringify(value);
    let size = body.length;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(PREFIX) && k !== PREFIX + key) size += (localStorage.getItem(k) ?? '').length;
    }
    if (size * 2 > MAX_SAVED) return false;
    localStorage.setItem(PREFIX + key, body); return true;
  } catch { return false; }
}
export function clearSaved() {
  try { for (const name of ['firms', 'forecast', 'metar', 'case2024']) localStorage.removeItem(PREFIX + name); } catch { /* Storage can be disabled. */ }
}
/** A cancelled response must never commit, even if a provider ignores abort. */
export async function loadResource<T>(key: string, saved: boolean, bundled: string | undefined, last: SourceResult<T> | undefined,
  signal: AbortSignal, fetcher: typeof fetch = fetch, lastOrigin: ResourceOrigin = 'in-memory-last-known'): Promise<Resource<T>> {
  const get = async (url: string) => {
    const response = await fetcher(url, { signal, cache: 'no-store' });
    signal.throwIfAborted();
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.error === 'string' ? error.error : `Source unavailable (HTTP ${response.status})`);
    }
    const value = await response.json() as SourceResult<T>;
    signal.throwIfAborted();
    if (!value || typeof value.source !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt)) || value.data === undefined)
      throw new Error('Unexpected source response');
    return value;
  };
  signal.throwIfAborted();
  if (saved && last) return { value: last, loading: false, saved: true, origin: lastOrigin };
  const url = saved ? bundled : `${import.meta.env?.BASE_URL ?? '/'}api/monitor/${key}`;
  if (!url) return { loading: false, error: 'No saved snapshot for this source. Refresh current data first.' };
  try {
    return { value: await get(url), loading: false, saved, origin: saved ? 'bundled' : 'retrieved' };
  } catch (e) {
    signal.throwIfAborted();
    // Prefer the most recent successfully retrieved value, never replace it with an older bundle.
    if (last) return { value: last, loading: false, saved: true, origin: lastOrigin, error: e instanceof Error ? e.message : 'Source unavailable' };
    if (bundled && !saved) {
      try {
        return { value: await get(bundled), loading: false, saved: true, origin: 'bundled', error: 'Provider unavailable; bundled real snapshot displayed.' };
      } catch { signal.throwIfAborted(); }
    }
    return { loading: false, error: e instanceof Error ? e.message : 'Source unavailable' };
  }
}
export function useSource<T>(key: string, enabled: boolean, saved: boolean, refresh: number, bundled?: string): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ loading: enabled });
  const latest = useRef<{ key: string; value: SourceResult<T>; origin?: ResourceOrigin }>();
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) { setState({ loading: false }); return () => controller.abort(); }
    const memory = latest.current?.key === key ? latest.current : undefined;
    const last = memory ? memory.value : readSaved<T>(key);
    const origin: ResourceOrigin | undefined = memory ? memory.origin === 'bundled' ? 'bundled' : 'in-memory-last-known'
      : last ? 'local-storage' : undefined;
    setState({ value: last, loading: true, saved: !!last, origin });
    void loadResource(key, saved, bundled, last, controller.signal, fetch, origin).then(next => {
      if (controller.signal.aborted) return;
      if (next.value) latest.current = { key, value: next.value, origin: next.origin };
      setState(next);
    }).catch(() => { /* Obsolete requests are deliberately ignored. */ });
    return () => controller.abort();
  }, [key, enabled, saved, refresh, bundled]);
  return state;
}
