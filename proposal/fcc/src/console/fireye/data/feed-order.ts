import type { Feed } from '../../contracts';

/** Available video first, then exact relevance. Stable IDs resolve ties without inventing priority. */
export function orderFeedsByRelevance(feeds: readonly Feed[]): Feed[] {
  return [...feeds].sort((a, b) =>
    Number(b.live && !b.offlineReason) - Number(a.live && !a.offlineReason)
    || b.relevance - a.relevance
    || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
}
