import { useEffect, useRef, useState } from 'react';
import type { SourceResult } from './model';

export interface Resource<T> { value?: SourceResult<T>; loading: boolean; error?: string; saved?: boolean }
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
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Resource<T>> {
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
  if (saved && last) return { value: last, loading: false, saved: true };
  const url = saved ? bundled : `/api/monitor/${key}`;
  if (!url) return { loading: false, error: 'No saved snapshot for this source. Refresh current data first.' };
  try {
    return { value: await get(url), loading: false, saved };
  } catch (e) {
    signal.throwIfAborted();
    // Prefer the most recent successfully retrieved value, never replace it with an older bundle.
    if (last) return { value: last, loading: false, saved: true, error: e instanceof Error ? e.message : 'Source unavailable' };
    if (bundled && !saved) {
      try {
        return { value: await get(bundled), loading: false, saved: true, error: 'Provider unavailable; bundled real snapshot displayed.' };
      } catch { signal.throwIfAborted(); }
    }
    return { loading: false, error: e instanceof Error ? e.message : 'Source unavailable' };
  }
}
export function useSource<T>(key: string, enabled: boolean, saved: boolean, refresh: number, bundled?: string): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ loading: enabled });
  const latest = useRef<{ key: string; value: SourceResult<T> }>();
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) { setState({ loading: false }); return () => controller.abort(); }
    const last = latest.current?.key === key ? latest.current.value : readSaved<T>(key);
    setState({ value: last, loading: true, saved: !!last });
    void loadResource(key, saved, bundled, last, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      if (next.value) latest.current = { key, value: next.value };
      setState(next);
    }).catch(() => { /* Obsolete requests are deliberately ignored. */ });
    return () => controller.abort();
  }, [key, enabled, saved, refresh, bundled]);
  return state;
}
