import { Badge, Brackets, Icon, Rule, SectionHeader, Serial, cn, type IconName, type Tone } from '@ds';

type Status = 'verified' | 'confirm' | 'optional';

const statusMeta: Record<Status, { label: string; tone: Tone }> = {
  verified: { label: 'Verified', tone: 'nominal' },
  confirm: { label: 'To confirm', tone: 'warning' },
  optional: { label: 'Optional', tone: 'neutral' },
};

interface Row {
  id: string;
  job: string;
  icon: IconName;
  vendor: string;
  what: string;
  fallback?: string;
  status: Status;
  refs: { label: string; href: string }[];
}

const ROWS: Row[] = [
  {
    id: 'S-01', job: 'Local news & articles', icon: 'web', vendor: 'Firecrawl',
    what: 'Search API returns ranked results with full-page markdown, so agents read the article, not a snippet.',
    status: 'verified', refs: [{ label: 'docs.firecrawl.dev/features/search', href: 'https://docs.firecrawl.dev/features/search' }],
  },
  {
    id: 'S-02', job: 'Image & video understanding', icon: 'video', vendor: 'fal',
    what: 'Vision API (Claude, GPT, Gemini, Qwen, Florence-2 and others) for frames and imagery, plus a video-understanding model endpoint for clips.',
    status: 'verified',
    refs: [
      { label: 'fal.ai/docs · vision-api', href: 'https://fal.ai/docs/model-api-reference/vision-api/overview' },
      { label: 'fal-ai/video-understanding', href: 'https://fal.ai/models/fal-ai/video-understanding/api' },
    ],
  },
  {
    id: 'S-03', job: 'Model routing', icon: 'ai', vendor: 'Treq',
    what: 'Described by the client as an OpenRouter-like model gateway. We could not verify it publicly.',
    fallback: 'OpenRouter or a self-hosted LiteLLM proxy',
    status: 'confirm', refs: [],
  },
  {
    id: 'S-04', job: 'Autoscaling agent sandboxes', icon: 'agents', vendor: 'boxd',
    what: 'One sandbox per analysis job, scaled by queue depth per input pool. We could not verify it publicly.',
    fallback: 'MicroVM sandbox providers (Firecracker-based)',
    status: 'confirm', refs: [],
  },
  {
    id: 'S-05', job: 'Active-fire hotspots', icon: 'satellite', vendor: 'NASA FIRMS',
    what: 'Near-real-time MODIS and VIIRS active-fire detections through a keyed API.',
    status: 'verified', refs: [{ label: 'firms.modaps.eosdis.nasa.gov/api', href: 'https://firms.modaps.eosdis.nasa.gov/api/' }],
  },
  {
    id: 'S-06', job: 'Multispectral imagery', icon: 'image', vendor: 'Sentinel-2 · Copernicus',
    what: 'Open 10 to 20 m multispectral imagery for burn scar mapping (NBR) and fuel moisture. Revisit is days, so it decays slowly but is never live.',
    status: 'verified', refs: [{ label: 'dataspace.copernicus.eu', href: 'https://dataspace.copernicus.eu/' }],
  },
  {
    id: 'S-07', job: 'Weather', icon: 'wind', vendor: 'NWS API',
    what: 'api.weather.gov: forecasts, observations and alerts. Free, no key, US coverage.',
    status: 'verified', refs: [{ label: 'api.weather.gov', href: 'https://api.weather.gov' }],
  },
  {
    id: 'S-08', job: 'Terrain', icon: 'map', vendor: 'USGS 3DEP',
    what: 'National elevation data for slope and aspect, which drive spread rate in the projection agent.',
    status: 'verified', refs: [{ label: 'usgs.gov · 3DEP', href: 'https://www.usgs.gov/3d-elevation-program' }],
  },
  {
    id: 'S-09', job: 'Photoreal map layer', icon: 'layers', vendor: 'Google Earth Engine / Map Tiles',
    what: 'Optional photoreal 3D base layer for orientation. Licensing for operational use is to be confirmed.',
    status: 'optional', refs: [],
  },
];

const QUESTIONS: { id: string; icon: IconName; title: string; body: string }[] = [
  {
    id: 'Q-01', icon: 'social', title: 'Social media access',
    body: 'Which platforms matter most locally, and do we have API access for geotagged video? Several platforms restrict scraping in their terms of service.',
  },
  {
    id: 'Q-02', icon: 'camera', title: 'Video transport and latency',
    body: 'What glass-to-glass latency do crews need from vehicle and drone cameras, and over which links (LTE, mesh, satellite)? This sets bitrate and where analysis runs.',
  },
  {
    id: 'Q-03', icon: 'radio', title: 'CAD and radio integration',
    body: 'Should approved movements be pushed to the existing CAD as assignments? Is radio traffic available for transcription as an additional input?',
  },
  {
    id: 'Q-04', icon: 'shield', title: 'Data retention and privacy',
    body: 'How long do we keep video that shows civilians, who may see it, and what must be redacted before anything reaches the public audience?',
  },
];

export default function Stack() {
  const counts = ROWS.reduce<Record<Status, number>>((a, r) => ({ ...a, [r.status]: a[r.status] + 1 }), { verified: 0, confirm: 0, optional: 0 });
  return (
    <section id="stack" className="relative scroll-mt-16 border-b border-line">
      <div className="mx-auto max-w-[1440px] px-6 py-24 lg:px-10 lg:py-32">
        <SectionHeader
          index="03"
          eyebrow="Stack & open questions"
          title={
            <>
              Open data in.
              <br />
              <span className="text-bone-mute">Composable services through.</span>
            </>
          }
          lede="Every job in the brief mapped to a vendor or open data source, with what we checked and what still needs the client. Unverified pieces have a named fallback so the build does not wait on them."
          meta={<Serial>FCC-03 / Spec / Rev B</Serial>}
        />

        <div className="mt-20">
          <Rule title="03.1 — Services per job" />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {(Object.keys(statusMeta) as Status[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-2">
                <Badge tone={statusMeta[s].tone} variant="soft" dot>
                  {statusMeta[s].label}
                </Badge>
                <span className="font-mono text-micro text-bone-mute fcc-num">{String(counts[s]).padStart(2, '0')}</span>
              </span>
            ))}
            <span className="ml-auto fcc-micro">Checked 2026-11-14</span>
          </div>

          <div className="relative mt-4 border border-line bg-ink-950">
            <Brackets size={8} />
            <div className="hidden grid-cols-[64px_220px_200px_1fr_148px] border-b border-line-strong lg:grid">
              {['Ref', 'Job', 'Service', 'What it gives us', 'Status'].map((h) => (
                <span key={h} className="flex h-10 items-center px-4 font-mono text-micro uppercase tracking-[0.14em] text-bone-mute">
                  {h}
                </span>
              ))}
            </div>
            <ul>
              {ROWS.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    'group grid grid-cols-1 gap-3 border-b border-line-faint px-4 py-5 transition-colors duration-quick ease-servo last:border-b-0 hover:bg-ink-900',
                    'lg:grid-cols-[64px_220px_200px_1fr_148px] lg:gap-0 lg:px-0',
                  )}
                >
                  <span className="font-mono text-micro text-signal fcc-num lg:px-4 lg:pt-1">{r.id}</span>
                  <span className="flex items-start gap-2.5 lg:px-4">
                    <Icon name={r.icon} size={16} className="mt-0.5 text-bone-mute transition-colors duration-quick ease-servo group-hover:text-bone" />
                    <span className="font-mono text-nano uppercase leading-5 tracking-[0.12em] text-bone-dim">{r.job}</span>
                  </span>
                  <span className="text-base font-medium text-bone lg:px-4">{r.vendor}</span>
                  <span className="flex flex-col gap-2 lg:px-4">
                    <span className="text-sm text-bone-dim">{r.what}</span>
                    {r.fallback && (
                      <span className="font-mono text-micro uppercase text-bone-mute">
                        <span className="text-amber">Fallback</span> · {r.fallback}
                      </span>
                    )}
                    {r.refs.length > 0 && (
                      <span className="flex flex-wrap gap-x-4 gap-y-1">
                        {r.refs.map((ref) => (
                          <a
                            key={ref.href}
                            href={ref.href}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 font-mono text-micro uppercase text-bone-mute underline decoration-line-strong underline-offset-4 transition-colors duration-quick ease-servo hover:text-bone hover:decoration-bone-mute"
                          >
                            {ref.label}
                            <Icon name="arrow-up-right" size={9} />
                          </a>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="lg:px-4 lg:pt-0.5">
                    <Badge tone={statusMeta[r.status].tone} variant={r.status === 'verified' ? 'soft' : 'outline'} dot={r.status !== 'optional'}>
                      {statusMeta[r.status].label}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-24">
          <Rule title="03.2 — Open questions for the client" />
          <div className="mt-10 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            {QUESTIONS.map((q) => (
              <article key={q.id} className="flex flex-col bg-ink-950 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-micro text-amber">{q.id}</span>
                  <Icon name={q.icon} size={18} className="text-bone-mute" />
                </div>
                <h3 className="mt-10 text-xl text-bone">{q.title}</h3>
                <p className="mt-3 flex-1 text-sm text-bone-dim">{q.body}</p>
                <div className="mt-8 flex items-center justify-between border-t border-line pt-3">
                  <span className="fcc-micro">Owner</span>
                  <span className="font-mono text-tiny uppercase text-bone">Client</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
