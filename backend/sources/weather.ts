import { closed, fail, freeze, integer, plainJson } from '../integrations/receipts.ts';
import { normalizeSourceContext, SOURCE_MAX_BYTES, SOURCE_PACKET_KEYS } from './context.ts';
import type { SourceContext, SourcePacket, SourceResult, WeatherPacket, WeatherSnapshot } from './types.ts';

// Normalizes only an explicitly received packet. No vendor, network, forecast generation or unit conversion.
export function normalizeWeatherContext(input: unknown, context: SourceContext): SourceResult<WeatherSnapshot> {
  if (!plainJson(input) || !closed(input, [...SOURCE_PACKET_KEYS, 'weather_kind', 'issued_at_ms', 'valid_from_ms', 'valid_until_ms', 'values'])
    || input.kind !== 'weather' || !['forecast', 'observation', 'reanalysis'].includes(input.weather_kind as string)
    || Buffer.byteLength(JSON.stringify(input), 'utf8') > SOURCE_MAX_BYTES
    || !Array.isArray(input.values) || input.values.length < 1 || input.values.length > 4) return fail('INVALID_INPUT');
  const packet = input as unknown as WeatherPacket;
  if (![packet.issued_at_ms, packet.valid_from_ms, packet.valid_until_ms].every(time => time === null || integer(time))
    || (packet.issued_at_ms !== null && packet.issued_at_ms > packet.retrieved_at_ms)
    || (packet.valid_from_ms === null) !== (packet.valid_until_ms === null)
    || (packet.valid_from_ms !== null && packet.valid_until_ms! < packet.valid_from_ms)
    || (packet.weather_kind === 'forecast' && (packet.issued_at_ms === null || packet.valid_from_ms === null || packet.issued_at_ms > packet.valid_from_ms))
    || (packet.weather_kind === 'observation' && packet.observed_at_ms === null)) return fail('INVALID_INPUT');
  const seen = new Set<string>();
  for (const value of packet.values) {
    if (!closed(value, ['variable', 'value', 'unit']) || typeof value.value !== 'number' || seen.has(value.variable)) return fail('INVALID_INPUT');
    const valid = value.variable === 'wind_speed' ? value.unit === 'm/s' && value.value >= 0
      : value.variable === 'wind_direction' ? value.unit === 'degrees' && value.value >= 0 && value.value <= 360
      : value.variable === 'relative_humidity' ? value.unit === '%' && value.value >= 0 && value.value <= 100
      : value.variable === 'temperature' && value.unit === 'C';
    if (!valid) return fail('INVALID_INPUT');
    seen.add(value.variable);
  }
  const { weather_kind, issued_at_ms, valid_from_ms, valid_until_ms, values, ...source } = packet;
  const result = normalizeSourceContext(source as SourcePacket, context);
  if (!result.ok) return result;
  return freeze({ ok: true, value: { ...result.value, kind: 'weather', weather_kind, issued_at_ms, valid_from_ms, valid_until_ms,
    values: structuredClone(values), operational_forecast: false } });
}
