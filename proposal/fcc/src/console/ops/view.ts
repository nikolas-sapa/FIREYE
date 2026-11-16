import { useSyncExternalStore } from 'react';

export type OpsView = 'responder' | 'civilian';

const KEY = 'ops.view';
const valid = (v: unknown): v is OpsView => v === 'responder' || v === 'civilian';

function syncViewUrl(v: OpsView) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') === v) return;
    url.searchParams.set('view', v);
    window.history.replaceState(window.history.state, '', url);
  } catch { /* optional */ }
}

let view: OpsView = (() => {
  if (typeof window === 'undefined') return 'responder';
  const q = new URLSearchParams(window.location.search).get('view');
  if (valid(q)) return q;
  try { const s = localStorage.getItem(KEY); if (valid(s)) return s; } catch { /* optional */ }
  return 'responder';
})();
syncViewUrl(view);

const listeners = new Set<() => void>();

export const opsView = {
  get: () => view,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  set(v: OpsView) {
    view = v;
    try { localStorage.setItem(KEY, v); } catch { /* optional */ }
    syncViewUrl(v);
    listeners.forEach((fn) => fn());
  },
};

export function useOpsView(): OpsView {
  return useSyncExternalStore(opsView.subscribe, opsView.get, opsView.get);
}

export interface OverlayOpts { routes: boolean; zones: boolean }
let overlay: OverlayOpts = { routes: true, zones: true };
const ol = new Set<() => void>();
export const overlayOpts = {
  get: () => overlay,
  set: (o: Partial<OverlayOpts>) => { overlay = { ...overlay, ...o }; ol.forEach((f) => f()); },
  subscribe(fn: () => void) { ol.add(fn); return () => { ol.delete(fn); }; },
};
export function useOverlayOpts(): OverlayOpts {
  return useSyncExternalStore(overlayOpts.subscribe, overlayOpts.get, overlayOpts.get);
}
