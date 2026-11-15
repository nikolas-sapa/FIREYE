import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppearanceToggle, Button, FireyeMark, Icon, cn } from '@ds';
import type { Geo, ScenarioPack } from '../contracts';
import { clc2018, finalPerimeter, loadScenario, scenarioExtras } from '../scenario/load';
import type { EnvInput } from '../world3d/env';
import type { ArchiveImage } from '../stage3d/feeds/ArchiveCamera';
import { DEMO_FEEDS } from './feed-motion';
import { SimulatedFeed, SimulatedFeedsProvider } from './SimulatedFeed';
import { CAMERAS, HISTORICAL_MEDIA } from './cameras';
import { MonitoringGlobe, type Focus } from './MonitoringGlobe';
import { clearSaved, useSource, writeSaved, type Resource } from './resources';
import { ATTICA, VIEWS, contextPack, distanceKm, inside, type Camera, type Detection, type GeometryCollection, type Mapping, type SourceResult, type Station, type ViewId, type Weather } from './model';

const field = 'border border-line-strong bg-ink-900 px-2 py-1 font-mono text-micro text-bone focus-visible:outline-signal';
const link = 'text-ice underline decoration-ice/30 underline-offset-2 hover:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal';
const emptyDetections: Detection[] = [];
const ATTICA_DETAIL: ArchiveImage = { url: '/data/monitoring/attica-detail-2020.jpg', bbox: ATTICA, date: '2020 cloudless composite',
  source: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)' };
const stamp = (s?: string | number) => s === undefined ? 'Unknown' : Number.isFinite(new Date(s).getTime()) ? new Date(s).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : 'Unknown';
const num = (n: number | null | undefined, unit = '', digits = 0) => n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}${unit}`;
function age(s?: string) {
  if (!s) return 'Time unknown';
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(s)) / 60000));
  return mins < 60 ? `${mins} min old` : mins < 1440 ? `${Math.floor(mins / 60)} h old` : `${Math.floor(mins / 1440)} d old`;
}
function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={link}>{children}</a>;
}
function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="border-b border-line px-4 py-3">
    <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-mono text-micro uppercase tracking-[0.14em] text-bone-dim">{title}</h2>{aside}</div>
    {children}
  </section>;
}
function SourceState<T>({ resource }: { resource: Resource<T> }) {
  return <div className="mt-2 space-y-1 font-mono text-micro leading-4 text-bone-mute" aria-live="polite">
    {resource.loading && <p>Retrieving source…</p>}
    {resource.error && <p className="text-amber">{resource.value ? 'Last known / stale · ' : ''}{resource.error}</p>}
    {resource.value && <>
      <p className="uppercase">{resource.value.dataClass} · {resource.saved ? 'Saved real data' : 'Retrieved data'}</p>
      {resource.value.observedAt && <p>Source time {stamp(resource.value.observedAt)}</p>}
      <p>Fetched {stamp(resource.value.fetchedAt)}</p>
      <p>{resource.value.note}</p>
      <p><External href={resource.value.url}>{resource.value.attribution}</External></p>
    </>}
  </div>;
}
function WeatherRow({ weather }: { weather: Weather }) {
  return <div className="grid grid-cols-3 gap-px bg-line">
    {[['Wind', num(weather.windKph, ' km/h')], ['From', num(weather.windFromDeg, '°')], ['Gust', num(weather.gustKph, ' km/h')],
      ['Temp', num(weather.tempC, ' °C', 1)], ['Humidity', num(weather.humidity, '%')], ['Rain / 1h', num(weather.precipitationMm, ' mm', 1)]].map(([label, value]) =>
      <div key={label} className="bg-ink-900 px-2 py-2"><p className="font-mono text-micro uppercase text-bone-mute">{label}</p><p className="mt-1 font-mono text-nano text-bone fcc-num">{value}</p></div>)}
  </div>;
}
function ImageTile({ src, title, onOpen }: { src?: string; title: string; onOpen: () => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => setStatus('loading'), [src]);
  return <button onClick={onOpen} className="relative h-full w-56 shrink-0 overflow-hidden border border-line bg-ink-900 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" aria-label={`Open ${title}`}>
    {src && <img src={src} alt={title} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} className="h-full w-full object-cover" />}
    {(!src || status !== 'ready') && <span className="absolute inset-0 flex items-center justify-center p-4 font-mono text-micro uppercase text-bone-mute">
      {!src ? 'Not saved / unavailable' : status === 'error' ? 'No usable image · choose another date' : 'Loading satellite image'}
    </span>}
    <span className="absolute inset-x-0 bottom-0 bg-ink-950/90 p-2 font-mono text-micro uppercase text-bone">{title}</span>
  </button>;
}

export default function MonitoringApp() {
  const [pack, setPack] = useState<ScenarioPack | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewId>(() => {
    const value = new URLSearchParams(location.search).get('view');
    return value === 'mati' || value === 'attica2024' ? value : 'current';
  });
  const [saved, setSaved] = useState(() => new URLSearchParams(location.search).get('saved') === '1');
  useEffect(() => { let active = true;
    void loadScenario('mati-2018').then(p => { if (active) setPack(p); }).catch(() => { if (active) setError('Could not load the local Mati terrain pack. Reload to retry.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.title = `FIREYE · ${VIEWS[view].name}${saved ? ' · saved data' : ''}`;
    const url = new URL(location.href); url.searchParams.set('view', view);
    if (saved) url.searchParams.set('saved', '1'); else url.searchParams.delete('saved');
    history.replaceState(null, '', url);
  }, [view, saved]);
  const context = useMemo(() => pack ? contextPack(pack) : null, [pack]);
  return <div className="fcc-console-shell flex h-dvh flex-col overflow-hidden bg-ink-950 text-bone" data-monitoring-mode="true">
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-line bg-ink-900 px-4 py-2">
      <div className="mr-2 flex items-center gap-2"><FireyeMark size={20} className="text-bone" /><div><h1 className="font-mono text-nano uppercase tracking-[0.16em]">FIREYE / public intelligence</h1><p className="font-mono text-micro uppercase text-bone-mute">Attica · source-linked wildfire awareness</p></div></div>
      <nav aria-label="Data view" className="flex border border-line">
        {(Object.keys(VIEWS) as ViewId[]).map(id => <Button key={id} size="sm" variant="ghost" aria-pressed={view === id} onClick={() => setView(id)} className={view === id ? 'bg-signal/10 text-signal' : ''}>{VIEWS[id].short}</Button>)}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className={cn(field, 'flex items-center gap-2 uppercase')}><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />Saved-data mode</label>
        <AppearanceToggle />
        <a className="font-mono text-micro uppercase text-bone-mute underline" href="/console.html?mode=replay">Legacy replay</a>
      </div>
    </header>
    {error ? <div role="alert" className="m-auto max-w-lg border border-line p-6 text-bone-dim">{error}</div>
      : pack && context ? <CaseView key={`${view}-${saved}`} pack={pack} context={context} view={view} saved={saved} />
        : <div className="m-auto font-mono text-nano uppercase text-bone-dim">Loading real local terrain and historical sources…</div>}
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-ink-900 px-4 py-2 font-mono text-micro uppercase text-bone-mute">
      <span>Informational prototype · camera demos simulated · not an emergency warning service</span>
      <span>Data unavailable ≠ safe · follow official 112 instructions</span>
    </footer>
  </div>;
}

function CaseView({ pack, context, view, saved }: { pack: ScenarioPack; context: ScenarioPack; view: ViewId; saved: boolean }) {
  const current = view === 'current';
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [scope, setScope] = useState<'attica' | 'greece'>('attica');
  // The previous completed UTC day avoids presenting a mostly empty pre-dawn daily mosaic.
  const [date, setDate] = useState(VIEWS[view].date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [satellite, setSatellite] = useState(false), [danger, setDanger] = useState(false), [showCameras, setShowCameras] = useState(true);
  const [imageMode, setImageMode] = useState<'detail' | 'daily'>('detail');
  const [activeFeed, setActiveFeed] = useState(0);
  const [recordingSafe, setRecordingSafe] = useState(true);
  const [panel, setPanel] = useState<'sources' | 'cameras'>('sources');
  const [selected, setSelected] = useState<Camera | null>(null);
  const [modal, setModal] = useState<'imagery' | 'drone' | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const imageDrag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [notice, setNotice] = useState('');
  const [layerNotice, setLayerNotice] = useState('');
  useEffect(() => setLayerNotice(''), [satellite, danger, date, imageMode]);
  const firms = useSource<Detection[]>('firms', current, saved, refresh, '/data/monitoring/current-firms.json');
  const forecast = useSource<Weather[]>('forecast', current, saved, refresh);
  const stations = useSource<Station[]>('metar', current, saved, refresh, '/data/monitoring/current-metar.json');
  const mapping = useSource<Mapping>('case2024', view === 'attica2024', saved, refresh, '/data/monitoring/attica2024.json');
  const webcams = useSource<Camera[]>('cameras', panel === 'cameras' && !saved, false, refresh);
  const [config, setConfig] = useState<{ firms?: boolean; windy?: boolean; contact?: boolean }>({});
  useEffect(() => { if (saved) return; const c = new AbortController();
    void fetch('/api/monitor/config', { signal: c.signal }).then(r => r.json()).then(setConfig).catch(() => undefined);
    return () => c.abort();
  }, [saved]);
  useEffect(() => { if (!current || saved) return; const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, [current, saved]);
  useEffect(() => { if (current && !saved) { const timer = window.setInterval(() => setRefresh(n => n + 1), 600000); return () => clearInterval(timer); } }, [current, saved]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
      if (e.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialogRef.current?.querySelector('button')?.focus();
    window.addEventListener('keydown', close); return () => { window.removeEventListener('keydown', close); previous?.focus(); };
  }, [modal]);
  const caseTime = view === 'mati' ? Date.parse('2018-07-23T15:45:00Z') : Date.parse('2024-08-12T09:05:00Z');
  const time = current ? saved ? Date.parse(firms.value?.fetchedAt ?? forecast.value?.fetchedAt ?? new Date(now).toISOString()) : now : caseTime;
  const localDetections = useMemo<Detection[]>(() => pack.hotspots.map((h, i) => ({ id: `mati-${i}`, lon: h.pos.lon, lat: h.pos.lat,
    observedAt: new Date(h.t).toISOString(), satellite: h.satellite, confidence: h.confidence, frp: Number.isFinite(h.frp) ? h.frp : null })), [pack]);
  const detections = useMemo(() => view === 'mati' ? localDetections : current
    ? (firms.value?.data ?? emptyDetections).filter(d => scope === 'greece' || inside(d.lon, d.lat, ATTICA)) : emptyDetections,
  [current, view, localDetections, firms.value, scope]);
  const geometry = useMemo<GeometryCollection | undefined>(() => {
    if (view === 'attica2024') return mapping.value?.data.geometry;
    if (view !== 'mati') return;
    const final = finalPerimeter(pack);
    if (!final) return;
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { source: 'EFFIS', label: 'Post-event final burned area' },
      geometry: { type: 'Polygon', coordinates: final.polygon.map(r => r.map(g => [g.lon, g.lat])) } }] };
  }, [view, mapping.value, pack]);
  const cameras = useMemo(() => {
    const all = [...CAMERAS];
    for (const c of webcams.value?.data ?? []) {
      if (all.some(a => a.url === c.url || (a.pos && c.pos && distanceKm(a.pos, c.pos) < 0.15))) continue;
      all.push(c);
    }
    return all;
  }, [webcams.value]);
  const nasaDate = scenarioExtras(pack).imageryExtra?.find(im => im.date === date && im.url.endsWith('.jpg'));
  const dailyImage = view === 'mati' && nasaDate ? nasaDate.url : saved
    ? view === 'attica2024' && date === '2024-08-12' ? '/data/monitoring/attica2024-gibs.jpg' : undefined
    : `/api/monitor/image?kind=gibs&view=${view}&date=${date}`;
  const detailImage = view === 'mati' && pack.imagery ? pack.imagery : ATTICA_DETAIL;
  const image = imageMode === 'detail' ? detailImage.url : dailyImage;
  const imageTitle = imageMode === 'detail' ? `Sentinel-2 archive · ${view === 'mati' ? '2018' : '2020'}` : `NASA GIBS · ${date}`;
  const cameraImage = pack.imagery ?? ATTICA_DETAIL;
  const sensorPack = useMemo(() => ({ ...context, imagery: pack.imagery }), [context, pack]);
  useEffect(() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); }, [image, modal]);
  const dangerImage = current && !saved ? `/api/monitor/image?kind=danger&view=current&date=${new Date(now).toISOString().slice(0, 10)}` : undefined;
  const navigate = (pos: Geo, rangeM = 6000) => setFocus({ pos, rangeM, key: performance.now() });
  const weather = forecast.value?.data.find(w => Date.parse(w.time) >= time) ?? forecast.value?.data[0];
  const historicalWeather = view === 'mati' ? pack.weather.reduce<ScenarioPack['weather'][number] | undefined>((best, w) => !best || Math.abs(w.t - caseTime) < Math.abs(best.t - caseTime) ? w : best, undefined) : undefined;
  const station = stations.value?.data[0];
  const clc = useMemo(() => clc2018(pack), [pack]);
  // Simulated feeds follow the selected view's clock and weather; missing values are listed as assumed by the world.
  const worldEnv = useMemo<EnvInput>(() => {
    const base = { view, timeMs: time, live: current && !saved, lat: 38.04, lon: 23.978 };
    if (historicalWeather) return { ...base, weather: { tempC: historicalWeather.tempC, rh: historicalWeather.rh, windKph: historicalWeather.windKph,
      windFromDeg: historicalWeather.windDirDeg, gustKph: historicalWeather.gustKph, precipMm: null, source: 'ERA5 reanalysis (Open-Meteo)' } };
    if (current && (weather || station)) return { ...base, weather: { tempC: weather?.tempC ?? station?.tempC ?? null, rh: weather?.humidity ?? station?.humidity ?? null,
      windKph: weather?.windKph ?? station?.windKph ?? null, windFromDeg: weather?.windFromDeg ?? station?.windFromDeg ?? null, gustKph: weather?.gustKph ?? station?.gustKph ?? null,
      precipMm: weather?.precipitationMm ?? station?.precipitationMm ?? null, source: [weather && 'MET Norway forecast', station && `METAR ${station.id}`].filter(Boolean).join(' + ') } };
    return { ...base, weather: { tempC: null, rh: null, windKph: null, windFromDeg: null, gustKph: null, precipMm: null, source: 'No weather source integrated for this view' } };
  }, [view, time, current, saved, historicalWeather, weather, station]);
  function save() {
    const rows: [string, SourceResult<unknown> | undefined][] = [['firms', firms.value], ['forecast', forecast.value], ['metar', stations.value], ['case2024', mapping.value]];
    const available = rows.filter(([, v]) => v);
    const count = available.filter(([key, value]) => writeSaved(key, value!)).length;
    setNotice(count ? `${count} real source snapshot(s) saved locally. External cameras and current imagery are not saved.` : 'No source data saved. Refresh sources first, or local storage is full.');
  }
  const pick = (id: string) => {
    const c = cameras.find(c => `camera-${c.id}` === id);
    if (c) { setSelected(c); setPanel('cameras'); if (c.pos) navigate(c.pos); }
    const d = detections.find(d => `real-${d.id}` === id);
    if (d) { setNotice(`${d.satellite} · ${stamp(d.observedAt)} · confidence ${d.confidence} · FRP ${num(d.frp, ' MW')}. Nominal 375 m pixel, not an exact ignition point.`); navigate(d); }
  };
  return <SimulatedFeedsProvider pack={sensorPack} clc={clc} env={worldEnv}>
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2">
      <span className={cn('border px-2 py-1 font-mono text-micro uppercase', saved ? 'border-amber/40 text-amber' : current ? 'border-ice/40 text-ice' : 'border-line-strong text-bone-dim')}>
        {saved ? 'Saved snapshot' : current ? 'Current monitoring' : 'Historical case'}
      </span>
      <h2 className="text-sm font-medium">{VIEWS[view].name}</h2>
      <span className="font-mono text-micro text-bone-mute fcc-num">{stamp(time)}</span>
      <div className="ml-auto flex gap-2"><Button size="sm" variant="ghost" disabled={saved} onClick={() => { setNow(Date.now()); setRefresh(n => n + 1); }}>Refresh sources</Button>
        <Button size="sm" variant="ghost" onClick={save}>Save real data</Button></div>
    </div>
    <div className="flex min-h-0 flex-1 max-[900px]:flex-col">
      <main className="relative min-h-[280px] min-w-0 flex-1 overflow-hidden" aria-label="Source-aware globe">
        <MonitoringGlobe pack={context} view={view} time={time} detections={detections} cameras={cameras} geometry={geometry}
          imagery={satellite ? image : undefined} imageryBounds={imageMode === 'detail' ? detailImage.bbox : VIEWS[view].bbox}
          imageryLabel={imageMode === 'detail' ? `${detailImage.source} · CC BY-NC-SA 4.0 · historical basemap` : imageTitle}
          danger={danger ? dangerImage : undefined} focus={focus} onPick={pick} showCameras={showCameras} onStatus={setLayerNotice} active={!modal} />
        <div className="absolute left-3 top-3 z-[3] flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 border border-line bg-ink-950/95 p-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(VIEWS[view].center, view === 'mati' ? 18000 : 48000)}>Home</Button>
          <label className="flex items-center gap-1 font-mono text-micro uppercase text-bone-dim"><input type="checkbox" checked={satellite} onChange={e => setSatellite(e.target.checked)} />Satellite overlay</label>
          <select aria-label="Satellite image product" className={field} value={imageMode} onChange={e => setImageMode(e.target.value as 'detail' | 'daily')}><option value="detail">Sharp archive · Sentinel-2</option><option value="daily">Daily overview · NASA</option></select>
          <label className="flex items-center gap-1 font-mono text-micro uppercase text-bone-dim"><input type="checkbox" checked={showCameras} onChange={e => setShowCameras(e.target.checked)} />Camera locations</label>
          {current && <label className="flex items-center gap-1 font-mono text-micro uppercase text-bone-dim"><input type="checkbox" checked={danger} disabled={saved} onChange={e => setDanger(e.target.checked)} />Forecast danger</label>}
          <input aria-label="Daily satellite imagery date" type="date" value={date} disabled={imageMode === 'detail'} max={new Date().toISOString().slice(0, 10)} min="2000-01-01" className={field} onChange={e => { if (e.target.value) setDate(e.target.value); }} />
        </div>
        <div className="pointer-events-none absolute bottom-14 left-4 z-[2] max-w-lg border border-line bg-ink-950/90 px-3 py-2">
          <p className="font-mono text-micro uppercase text-bone-dim">{current ? `${scope === 'greece' ? 'Greece' : 'Attica'} · ${detections.length} thermal detections in retrieved data` : 'Mapped burned area · not active fire front'}</p>
          <p className="mt-1 text-xs leading-4 text-bone-mute">DEM coverage: Mati local pack only · outside this area, streamed cartographic context, not local terrain measurements.</p>
          {danger && <p className="mt-1 font-mono text-micro text-amber">EFFIS / GWIS · forecast danger, not detected fire</p>}
          {satellite && <p className="mt-1 font-mono text-micro text-ice">{imageTitle} · {imageMode === 'detail' ? 'EOX · historical basemap, not incident-date imagery' : 'Coarse daily overview'}</p>}
          {layerNotice && <p role="status" className="mt-1 text-xs text-amber">{layerNotice}</p>}
          {scope === 'greece' && <p className="mt-1 text-xs text-bone-mute">Greece-region bounding box includes neighboring border areas.</p>}
        </div>
        {danger && dangerImage && <img className="absolute bottom-14 right-4 z-[2] max-h-48 max-w-[180px] border border-line bg-ink-900" src={dangerImage.replace('kind=danger', 'kind=legend')} alt="EFFIS Fire Weather Index legend" />}
      </main>
      <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-line bg-ink-900 max-[1100px]:w-[310px] max-[900px]:max-h-[38vh] max-[900px]:w-full max-[900px]:border-l-0 max-[900px]:border-t" aria-label="Source information">
        <div className="flex shrink-0 border-b border-line">
          <Button className="flex-1" size="md" variant="ghost" aria-pressed={panel === 'sources'} onClick={() => setPanel('sources')}>Sources</Button>
          <Button className="flex-1" size="md" variant="ghost" aria-pressed={panel === 'cameras'} onClick={() => setPanel('cameras')}>Cameras · {cameras.length}</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === 'sources' ? <>
            <Section title="Source brief"><p className="text-sm leading-5 text-bone-dim">{VIEWS[view].note}</p><p className="mt-2 font-mono text-micro uppercase text-bone-mute">Source summaries · no AI inference</p>
              {view === 'mati' && <p className="mt-2 text-xs text-bone-mute">Bundled real archive. Original retrieval time is not recorded in this pack; observation and report times are shown below.</p>}
            </Section>
            {current ? <>
              <Section title="Satellite thermal anomalies" aside={<span className="font-mono text-lg fcc-num">{firms.value ? detections.length : '—'}</span>}>
                <div className="flex gap-2">{(['attica', 'greece'] as const).map(s => <Button key={s} size="sm" variant="ghost" aria-pressed={scope === s} onClick={() => { setScope(s); navigate(s === 'greece' ? { lon: 24, lat: 38.2 } : VIEWS.current.center, s === 'greece' ? 850000 : 48000); }}>{s}</Button>)}</div>
                {firms.value && !detections.length && <p className="mt-2 text-xs text-bone-dim">No detections in the retrieved selection. This is not an all-clear.</p>}
                {detections.slice(0, 12).map(d => <button key={d.id} onClick={() => pick(`real-${d.id}`)} className="mt-2 block w-full border-b border-line pb-2 text-left font-mono text-micro text-bone-dim focus-visible:outline-signal">
                  {d.satellite} · {stamp(d.observedAt)}<br /><span className="text-bone-mute">{d.lat.toFixed(3)}N {d.lon.toFixed(3)}E · {age(d.observedAt)} · {num(d.frp, ' MW')}</span>
                </button>)}<SourceState resource={firms} />
              </Section>
              <Section title="Forecast · Mati point">
                {weather && <><p className="mb-2 font-mono text-micro text-bone-mute">Valid {stamp(weather.time)}</p><WeatherRow weather={weather} /></>}
                {forecast.value && !weather && <p className="text-xs text-bone-dim">No forecast periods returned.</p>}
                <SourceState resource={forecast} />
              </Section>
              <Section title="Measured airport weather">
                {stations.value && !stations.value.data.length && <p className="text-xs text-bone-dim">No station observations returned.</p>}
                {stations.value?.data.map(s => <div key={s.id} className="mb-3 border-b border-line pb-2">
                  <button onClick={() => navigate(s, 14000)} className="font-mono text-micro uppercase text-ice focus-visible:outline-signal">{s.id} · {s.name}</button>
                  <p className="my-1 font-mono text-micro text-bone-mute">{distanceKm(VIEWS.current.center, s).toFixed(0)} km from Mati point · {stamp(s.time)}</p><WeatherRow weather={s} />
              <p className="mt-1 break-words font-mono text-micro text-bone-mute">{s.raw} · {age(s.time)}</p>
                </div>)}<SourceState resource={stations} />
              </Section>
            </> : view === 'mati' ? <>
              <Section title="Final mapped burned area"><p className="font-mono text-2xl fcc-num">{num(finalPerimeter(pack)?.ha, ' ha')}</p><p className="mt-2 text-xs leading-5 text-bone-mute">EFFIS feature 15060 · post-event footprint. Intermediate reconstructed perimeters are deliberately excluded.</p><External href="https://forest-fire.emergency.copernicus.eu/">EFFIS / European Union</External></Section>
              <Section title="Archived observations"><p className="font-mono text-lg fcc-num">{localDetections.length} satellite detections</p>
                <p className="mt-2 text-xs leading-5 text-bone-mute">FIRMS acquisitions are after the principal afternoon run. They do not measure the minute-by-minute advance.</p>
                {localDetections.slice(0, 4).map(d => <p key={d.id} className="mt-1 font-mono text-micro text-bone-dim">{d.satellite} · {stamp(d.observedAt)}</p>)}
              </Section>
              {historicalWeather && <Section title="Historical weather · reanalysis"><WeatherRow weather={{ time: new Date(historicalWeather.t).toISOString(), tempC: historicalWeather.tempC, humidity: historicalWeather.rh, windKph: historicalWeather.windKph, gustKph: historicalWeather.gustKph, windFromDeg: historicalWeather.windDirDeg }} />
                <p className="mt-2 text-xs leading-5 text-bone-mute">ERA5 via Open-Meteo · {stamp(historicalWeather.t)}. Modeled reanalysis, not station measurements; smooths severe local gusts. CC BY 4.0.</p></Section>}
              <Section title="Documented historical reports">
                {(pack.reports ?? []).slice(0, 10).map(r => <article key={r.id} className="mb-3 border-b border-line pb-2"><p className="font-mono text-micro text-bone-mute">{stamp(r.t)} · {r.publisher}</p><p className="my-1 text-xs leading-5 text-bone-dim">{r.summary}</p><External href={r.url}>Original source</External></article>)}
              </Section>
            </> : <Section title="Copernicus incident mapping">
              {mapping.value && <><p className="font-mono text-2xl fcc-num">{num(mapping.value.data.burnedHa, ' ha', 1)}</p>
                <p className="mt-1 font-mono text-micro uppercase text-bone-mute">Initial mapped burned area · EMSR746</p>
                <p className="mt-2 text-xs text-bone-dim">Acquired {stamp(mapping.value.data.acquiredAt)}<br />Published {stamp(mapping.value.data.publishedAt)}</p></>}
              <SourceState resource={mapping} />
              <p className="mt-3 text-xs text-bone-mute">Historical weather and additional satellite detections are not integrated for this case. No values are synthesized.</p>
            </Section>}
            <Section title="Official information"><div className="space-y-2 text-xs">
              <p><External href="https://civilprotection.gov.gr/en/112/pote-pos-me-eidopoiei">Greek 112 · official instructions</External></p>
              <p><External href="https://civilprotection.gov.gr/en/xartis">Civil Protection · dated seasonal risk map</External></p>
              <p><External href="https://www.astynomia.gr/ektaktes-kykloforiakes-rythmiseis-logo-ekdilosis-pyrkagias/">Police · fire-related road announcements</External></p>
              <p className="leading-5 text-bone-mute">Links only. No automatic evacuation or closure ingestion. A mapped road is not a verified safe route.</p>
            </div></Section>
            {!saved && <Section title="Local configuration"><p className="font-mono text-micro leading-5 text-bone-mute">FIRMS key: {config.firms ? 'configured' : 'not set · public-download fallback'}<br />Windy key: {config.windy ? 'configured' : 'not set · curated camera links'}<br />MET contact: {config.contact ? 'configured' : 'set FCC_APP_CONTACT'}</p></Section>}
            <Section title="Saved presentation data"><Button size="sm" variant="ghost" onClick={() => { clearSaved(); setNotice('Local source snapshots removed.'); }}>Clear saved source snapshots</Button><p className="mt-2 text-xs text-bone-mute">Local snapshots exclude webcam media and keys. Historical bundled assets remain available.</p></Section>
          </> : <>
            <Section title="Simulated terrain cameras"><p className="text-sm leading-5 text-bone-dim">Simulated 3D world drone, ridge, trail and roadside views over the Mati terrain. Vegetation, objects, people and animals are procedural stand-ins derived from land cover and OSM, not measurements. Camera placements and motion are simulated, not these third-party webcams.</p>
              <div className="mt-2 space-y-1">{DEMO_FEEDS.map((f, i) => <Button key={f.id} size="sm" variant="ghost" onClick={() => { setActiveFeed(i); setModal('drone'); }}>{f.label}</Button>)}</div>
            </Section>
            <Section title="Current cameras near the case"><p className="text-sm leading-5 text-bone-dim">Current views, not July 2018 footage. Camera operation and capture time are not verified by a source link.</p>
              <label className="mt-3 flex items-center gap-2 font-mono text-micro uppercase text-bone-dim"><input type="checkbox" checked={recordingSafe} onChange={e => { setRecordingSafe(e.target.checked); setSelected(null); }} />Recording-safe · hide uncleared media</label>
            </Section>
            {cameras.map(c => <Section key={c.id} title={c.name}>
              <p className="font-mono text-micro uppercase text-bone-mute">{c.provider}</p><p className="mt-2 text-xs leading-5 text-bone-dim">{c.note}</p>
              <p className="mt-1 text-xs leading-4 text-bone-mute">{c.locationNote}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3"><External href={c.url}>Open provider</External>
                {c.pos && <Button size="sm" variant="ghost" onClick={() => { setSelected(c); navigate(c.pos!); }}>Locate</Button>}
                {!recordingSafe && c.image && <Button size="sm" variant="ghost" onClick={() => setSelected(c)}>View image</Button>}
              </div>
              {selected?.id === c.id && !recordingSafe && c.image && <a href={c.url} target="_blank" rel="noopener noreferrer"><img src={c.image} alt={`Current ${c.name}, capture time unknown`} className="mt-3 w-full" /><span className="text-micro text-ice">Webcams provided by windy.com · open source</span></a>}
            </Section>)}
            <Section title="Additional camera discovery"><SourceState resource={webcams} /><p className="mt-2 text-xs text-bone-mute">Windy media are on-demand and expire. No footage is downloaded or saved. No archive or recording permission is implied.</p></Section>
            {view === 'mati' && <Section title="2018 camera-footage leads">{HISTORICAL_MEDIA.map(m => <article key={m.url} className="mb-3"><External href={m.url}>{m.title}</External><p className="mt-1 font-mono text-micro text-bone-mute">{m.date}</p><p className="mt-1 text-xs leading-5 text-bone-mute">{m.note}</p></article>)}</Section>}
          </>}
        </div>
      </aside>
    </div>
    {notice && <div role="status" className="flex shrink-0 items-center gap-3 border-t border-line bg-ink-850 px-4 py-2 text-xs text-bone-dim"><p className="flex-1">{notice}</p><Button size="sm" variant="ghost" onClick={() => setNotice('')}>Dismiss</Button></div>}
    <section className="flex h-[192px] shrink-0 gap-3 overflow-x-auto border-t border-line bg-ink-950 p-3" aria-label="Imagery and sensor views">
      <div className="flex w-36 shrink-0 flex-col justify-between"><div><h2 className="font-mono text-micro uppercase tracking-[0.16em] text-bone">Presentation feeds</h2><p className="mt-2 text-xs leading-5 text-bone-mute">Simulated 3D drones and ground cameras · Mati sector in every case.</p></div><p className="font-mono text-micro text-bone-mute">EOX · CC BY-NC-SA 4.0<br />Not live camera footage</p></div>
      <ImageTile src={image} title={imageTitle} onOpen={() => setModal('imagery')} />
      {DEMO_FEEDS.map((feed, i) => <button key={feed.id} aria-label={`Open simulated ${feed.label}`} onClick={() => { setActiveFeed(i); setModal('drone'); }} className="relative w-72 shrink-0 overflow-hidden border border-line text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal">
        <SimulatedFeed feed={feed} image={cameraImage} active={!modal} />
      </button>)}
      {cameras.map(c => <button key={c.id} onClick={() => { setPanel('cameras'); setSelected(c); if (c.pos) navigate(c.pos, 9000); }} className="flex w-44 shrink-0 flex-col justify-between border border-line bg-ink-900 p-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal">
        <Icon name="camera" size={18} className="text-bone-mute" /><div><p className="font-mono text-micro uppercase text-bone">{c.name}</p><p className="mt-1 font-mono text-micro uppercase text-bone-mute">Current source link</p></div>
      </button>)}
    </section>
    {modal && <div ref={dialogRef} className="fixed inset-0 z-modal flex items-center justify-center bg-void/95 p-6" role="dialog" aria-modal="true" aria-label={modal === 'drone' ? 'Simulated camera player' : 'Satellite imagery viewer'}>
      <div className="flex h-full max-h-[850px] w-full max-w-[1300px] flex-col border border-line bg-ink-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3"><h2 className="font-mono text-nano uppercase text-bone">{modal === 'drone' ? `${DEMO_FEEDS[activeFeed].label} · simulated camera player` : imageTitle}</h2>
          <div className="flex gap-2">{modal === 'drone' && <><Button size="sm" variant="ghost" aria-label="Previous simulated camera" onClick={() => setActiveFeed(i => (i + DEMO_FEEDS.length - 1) % DEMO_FEEDS.length)}>Previous</Button><Button size="sm" variant="ghost" aria-label="Next simulated camera" onClick={() => setActiveFeed(i => (i + 1) % DEMO_FEEDS.length)}>Next</Button></>}<Button size="sm" onClick={() => setModal(null)}>Close</Button></div></div>
        <div className="relative min-h-0 flex-1">
          {modal === 'drone' ? <SimulatedFeed key={DEMO_FEEDS[activeFeed].id} feed={DEMO_FEEDS[activeFeed]} image={cameraImage} full />
            : image ? <div className="relative h-full w-full overflow-hidden">
              <img key={image} src={image} alt={imageTitle} draggable={false}
                className={cn('h-full w-full touch-none select-none object-contain', imageZoom > 1 ? 'cursor-grab active:cursor-grabbing' : '')}
                style={{ transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})` }}
                onPointerDown={e => { if (imageZoom > 1) { e.currentTarget.setPointerCapture(e.pointerId); imageDrag.current = { x: e.clientX, y: e.clientY, pan: imagePan }; } }}
                onPointerMove={e => { const drag = imageDrag.current; if (!drag) return;
                  const host = e.currentTarget.parentElement!;
                  const boundX = host.clientWidth * (imageZoom - 1) / 2, boundY = host.clientHeight * (imageZoom - 1) / 2;
                  setImagePan({ x: Math.max(-boundX, Math.min(boundX, drag.pan.x + e.clientX - drag.x)), y: Math.max(-boundY, Math.min(boundY, drag.pan.y + e.clientY - drag.y)) });
                }}
                onPointerUp={() => { imageDrag.current = null; }} onPointerCancel={() => { imageDrag.current = null; }} />
              <div className="absolute left-3 top-3 flex items-center gap-2 border border-line bg-ink-950/95 p-1">
                <Button size="sm" variant="ghost" aria-label="Zoom out satellite image" disabled={imageZoom <= 1} onClick={() => { setImageZoom(z => Math.max(1, z - 0.5)); setImagePan({ x: 0, y: 0 }); }}>−</Button>
                <span className="font-mono text-micro text-bone-dim">{Math.round(imageZoom * 100)}%</span>
                <Button size="sm" variant="ghost" aria-label="Zoom in satellite image" disabled={imageZoom >= 4} onClick={() => setImageZoom(z => Math.min(4, z + 0.5))}>+</Button>
                <Button size="sm" variant="ghost" onClick={() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }); }}>Fit</Button>
                <span className="pr-2 font-mono text-micro uppercase text-bone-mute">Drag to pan</span>
              </div>
            </div> : <p className="p-6 text-bone-mute">Imagery is not available in this saved snapshot.</p>}
        </div>
        <p className="border-t border-line p-3 font-mono text-micro uppercase leading-5 text-bone-mute">{modal === 'drone'
          ? 'Simulated 3D world · Mati sector in every case · local DEM, CORINE 2018 land cover, OSM roads and building positions, EOX Sentinel-2 2018 colours (CC BY-NC-SA 4.0) · vegetation, buildings, garbage, people and animals are procedural low-poly stand-ins, not measured objects · time, season and weather follow the selected view · not observed video or thermal measurements'
          : imageMode === 'detail' ? `${detailImage.source} · historical composite, not incident-date or current imagery · approximately 10 m source resolution · CC BY-NC-SA 4.0 · s2maps.eu`
            : `${nasaDate?.source ?? 'NASA GIBS / VIIRS'} · coarse optical overview may contain cloud or missing swaths · imagery date is not a continuous capture time`}</p>
      </div>
    </div>}
  </SimulatedFeedsProvider>;
}
