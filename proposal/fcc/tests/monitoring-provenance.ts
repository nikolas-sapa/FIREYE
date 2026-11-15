import assert from 'node:assert/strict';
import * as resources from '../src/console/monitoring/resources';
import type { Detection, SourceResult } from '../src/console/monitoring/model';

const value: SourceResult<Detection[]> = { source: 'FIRMS', url: 'https://example.org/firms', attribution: 'FIRMS',
  dataClass: 'observation', fetchedAt: '2026-11-14T12:00:00Z', observedAt: '2026-11-14T11:00:00Z', note: 'Source selection only', data: [] };
const signal = () => new AbortController().signal;
const goodFetch = (async () => Response.json(value)) as typeof fetch;
const offlineFetch = (async () => { throw new Error('offline'); }) as typeof fetch;
const retrieved = await resources.loadResource('firms', false, undefined, undefined, signal(), goodFetch);
assert.equal(retrieved.origin, 'retrieved', 'successful provider response has explicit retrieval origin');
const memory = await resources.loadResource('firms', false, '/bundle.json', value, signal(), offlineFetch);
assert.equal(memory.origin, 'in-memory-last-known');
assert.equal(memory.value, value);
assert.equal((await resources.loadResource('firms', true, undefined, value, signal(), offlineFetch)).origin, 'in-memory-last-known');
const bundle = await resources.loadResource('firms', true, '/bundle.json', undefined, signal(), goodFetch);
assert.equal(bundle.origin, 'bundled');
const fallbackBundle = await resources.loadResource('firms', false, '/bundle.json', undefined, signal(),
  (async url => String(url).startsWith('/api/') ? new Response(null, { status: 503 }) : Response.json(value)) as typeof fetch);
assert.equal(fallbackBundle.origin, 'bundled');

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, body: string) => { storage.set(key, body); }, removeItem: (key: string) => { storage.delete(key); },
} });
try {
  assert.equal(resources.writeSaved('firms', value), true);
  const stored = resources.readSaved<Detection[]>('firms');
  assert.deepEqual(stored, value);
  const local = await resources.loadResource('firms', true, undefined, stored, signal(), offlineFetch, 'local-storage');
  assert.equal(local.origin, 'local-storage');
  for (const [resource, label] of [[retrieved, 'Retrieved data'], [memory, 'Last known real data (memory)'],
    [local, 'Saved real data (local storage)'], [bundle, 'Bundled real snapshot']] as const) {
    assert.equal(resources.sourceLabel(resource), label);
    assert.equal(resource.value?.fetchedAt, value.fetchedAt, 'origin changes never fabricate retrieval time');
    assert.equal(resource.value?.observedAt, value.observedAt, 'origin changes never fabricate source time');
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  assert.equal(resources.writeSaved('firms', value), false);
  assert.equal(resources.readSaved('firms'), undefined);
  const failedSave = await resources.loadResource('firms', true, undefined, value, signal(), offlineFetch);
  assert.doesNotMatch(resources.sourceLabel(failedSave), /saved|local storage/i, 'storage failure cannot claim persistence');
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
for (const resource of [{ loading: false }, { loading: true }, { loading: false, error: 'offline' }]) {
  assert.match(resources.detectionSummary(resource, 0), /count unknown/i);
  assert.doesNotMatch(resources.detectionSummary(resource, 0), /\b0\b|in retrieved data/i);
}
assert.equal(resources.detectionSummary(retrieved, 0), '0 thermal detections in retrieved data');
assert.match(resources.detectionSummary(memory, 0), /0 thermal detections in last known data \(memory\)/);
assert.match(resources.detectionSummary(bundle, 0), /0 thermal detections in bundled snapshot/);
assert.match(resources.detectionSummary({ ...memory, loading: true }, 2), /2 thermal detections in last known data/);
assert.doesNotMatch(resources.sourceLabel({ ...memory, origin: undefined }), /saved|retrieved/i, 'unknown provenance cannot claim origin');
console.log('Monitoring provenance passed: 4 origins, 3 unknown counts, source-backed zero, no false persistence.');
