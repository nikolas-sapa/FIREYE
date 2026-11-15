import type { Failure, Result, Transport } from '../integrations/receipts.ts';

export type SourcePermission = Readonly<{
  source_id: string; rights_manifest_id: string; url: string; context_use: boolean; retrieval: boolean;
}>;
// Trusted caller context, never derived from article content or wire permission flags.
export type SourceContext = Readonly<{
  snapshot_id: string; received_cutoff_ms: number; valid_until_ms: number; now_ms: number;
  permissions: readonly SourcePermission[];
}>;
export type SourcePacket = Readonly<{
  kind: 'article' | 'treg-links' | 'weather'; snapshot_id: string; evidence_id: string; source_id: string; rights_manifest_id: string;
  url: string; published_at_ms: number | null; observed_at_ms: number | null; retrieved_at_ms: number; received_at_ms: number;
  geography: Readonly<{ latitude: number; longitude: number }> | null; uncertainty_m: number | null;
  content: string; content_hash: string; links: readonly string[];
}>;
export type SourceSnapshot = SourcePacket & Readonly<{
  verification_status: 'unverified'; instruction_authority: 'none'; incident_assessment: 'not-assessed'; source_age_ms: number | null;
}>;
export type WeatherPacket = SourcePacket & Readonly<{
  kind: 'weather'; weather_kind: 'forecast' | 'observation' | 'reanalysis'; issued_at_ms: number | null;
  valid_from_ms: number | null; valid_until_ms: number | null;
  values: readonly Readonly<{ variable: 'wind_speed' | 'wind_direction' | 'relative_humidity' | 'temperature'; value: number; unit: 'm/s' | 'degrees' | '%' | 'C' }>[];
}>;
export type WeatherSnapshot = SourceSnapshot & WeatherPacket & Readonly<{ operational_forecast: false }>;
export type SourceResult<T> = Result<T>;
export type FirecrawlRequest = Readonly<{ url: string; formats: readonly ['markdown']; onlyMainContent: true; timeout: number; maxAge: 0 }>;
export type FirecrawlReceipt = Readonly<{
  adapter: 'firecrawl'; endpoint: 'https://api.firecrawl.dev/v2/scrape'; authorization_id: string; snapshot_id: string;
  input_hash: string; provenance: 'fixture' | 'local-http'; fresh_provider_call: false;
  started_at_ms: number; finished_at_ms: number; attempts: 1; status: 'accepted' | Failure;
}>;
export type FirecrawlResult = Readonly<{ ok: true; value: SourceSnapshot; receipt: FirecrawlReceipt }>
  | Readonly<{ ok: false; code: Failure; receipt?: FirecrawlReceipt }>;
export type FirecrawlConfig = Readonly<{
  enabled?: boolean; authorization_id?: string; max_calls?: 0 | 1; deadline_ms?: number; now?: () => number;
  is_current?: (context: SourceContext) => boolean; transport?: Transport; transport_mode?: 'fixture' | 'local-http';
}>;
export type FirecrawlClient = Readonly<{ retrieve(input: unknown, context: SourceContext): Promise<FirecrawlResult> }>;
