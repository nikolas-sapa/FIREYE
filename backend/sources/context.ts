import { createHash } from 'node:crypto';
import { closed, fail, freeze, id, integer, plainJson } from '../integrations/receipts.ts';
import { safeSourceUrl } from '../integrations/treg/client.ts';
import type { SourceContext, SourcePacket, SourceResult, SourceSnapshot } from './types.ts';

export const SOURCE_PACKET_KEYS = Object.freeze(['kind', 'snapshot_id', 'evidence_id', 'source_id', 'rights_manifest_id', 'url', 'published_at_ms', 'observed_at_ms',
  'retrieved_at_ms', 'received_at_ms', 'geography', 'uncertainty_m', 'content', 'content_hash', 'links'] as const);
export const SOURCE_MAX_BYTES = 262_144;

export function validSourceContext(input: unknown): input is SourceContext {
  if (!plainJson(input) || !closed(input, ['snapshot_id', 'received_cutoff_ms', 'valid_until_ms', 'now_ms', 'permissions'])
    || !id(input.snapshot_id) || !integer(input.now_ms) || !integer(input.received_cutoff_ms) || !integer(input.valid_until_ms)
    || input.received_cutoff_ms > input.now_ms || input.valid_until_ms <= input.now_ms || input.valid_until_ms - input.received_cutoff_ms > 60_000
    || !Array.isArray(input.permissions) || input.permissions.length > 32) return false;
  return input.permissions.every(p => closed(p, ['source_id', 'rights_manifest_id', 'url', 'context_use', 'retrieval'])
    && id(p.source_id) && id(p.rights_manifest_id) && typeof p.context_use === 'boolean' && typeof p.retrieval === 'boolean'
    && typeof p.url === 'string' && safeSourceUrl(p.url) === p.url)
    && new Set(input.permissions.map(p => `${p.source_id}|${p.rights_manifest_id}|${p.url}`)).size === input.permissions.length;
}

export function normalizeSourceContext(input: unknown, context: SourceContext): SourceResult<SourceSnapshot> {
  if (!validSourceContext(context)) return fail('STALE');
  if (!plainJson(input) || !closed(input, SOURCE_PACKET_KEYS) || !['article', 'treg-links', 'weather'].includes(input.kind as string)
    || !id(input.snapshot_id) || input.snapshot_id !== context.snapshot_id || !id(input.evidence_id) || !id(input.source_id) || !id(input.rights_manifest_id)
    || typeof input.url !== 'string' || safeSourceUrl(input.url) !== input.url || typeof input.content !== 'string' || typeof input.content_hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.content_hash) || !Array.isArray(input.links) || input.links.length > 100
    || !input.links.every(link => typeof link === 'string' && link.length <= 2048)
    || Buffer.byteLength(JSON.stringify(input), 'utf8') > SOURCE_MAX_BYTES) return fail('INVALID_INPUT');
  const packet = input as unknown as SourcePacket;
  if (![packet.published_at_ms, packet.observed_at_ms].every(time => time === null || (integer(time) && time <= packet.retrieved_at_ms))
    || !integer(packet.retrieved_at_ms) || !integer(packet.received_at_ms) || packet.retrieved_at_ms > packet.received_at_ms
    || packet.received_at_ms > context.received_cutoff_ms) return fail('INVALID_INPUT');
  if (packet.geography !== null && (!closed(packet.geography, ['latitude', 'longitude'])
    || typeof packet.geography.latitude !== 'number' || Math.abs(packet.geography.latitude) > 90
    || typeof packet.geography.longitude !== 'number' || Math.abs(packet.geography.longitude) > 180)) return fail('INVALID_INPUT');
  if (!(packet.uncertainty_m === null || (typeof packet.uncertainty_m === 'number' && packet.uncertainty_m >= 0))
    || (packet.geography === null && packet.uncertainty_m !== null)) return fail('INVALID_INPUT');
  if (!context.permissions.some(p => p.source_id === packet.source_id && p.rights_manifest_id === packet.rights_manifest_id
    && p.url === packet.url && p.context_use)) return fail('UNAUTHORIZED');
  if (createHash('sha256').update(packet.content, 'utf8').digest('hex') !== packet.content_hash) return fail('INVALID_INPUT');
  const links: string[] = [];
  for (const link of packet.links) {
    const url = safeSourceUrl(link);
    if (url && !links.includes(url) && links.length < 5) links.push(url);
  }
  const sourceTime = packet.observed_at_ms ?? packet.published_at_ms;
  return freeze({ ok: true, value: { ...structuredClone(packet), links, verification_status: 'unverified', instruction_authority: 'none',
    incident_assessment: 'not-assessed', source_age_ms: sourceTime === null ? null : context.now_ms - sourceTime } });
}

export function normalizeTregContext(links: unknown, input: unknown, context: SourceContext): SourceResult<SourceSnapshot> {
  if (!plainJson(links) || !closed(links, ['kind', 'urls', 'verification_status', 'served_by']) || links.kind !== 'public-source-links'
    || links.verification_status !== 'unverified' || !(links.served_by === null || id(links.served_by))
    || !Array.isArray(links.urls) || links.urls.length > 5 || !links.urls.every(url => typeof url === 'string' && safeSourceUrl(url) === url)
    || !plainJson(input) || !closed(input, SOURCE_PACKET_KEYS) || input.kind !== 'treg-links' || input.content !== ''
    || input.content_hash !== createHash('sha256').update('').digest('hex')) return fail('INVALID_INPUT');
  return normalizeSourceContext({ ...input, links: [...links.urls] }, context);
}
