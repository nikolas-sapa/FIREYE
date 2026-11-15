import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Legend, Metric, Segmented, Select, Slider, TileMosaic, Toggle, color, fmtLat, fmtLon, type LegendItem } from '@ds';
import { FuelClass } from '@/console/contracts';
import { GRID_DEFAULT_RETRIES, GRID_MAX_RETRIES, GRID_SOURCE, type GridScene } from '@/image-lab/grid';
import {
  bestAttempt, blendedMosaic, loadLandscape, loadWeather, processGrid, saveBlob, splitSatellite,
  type GridSettings, type GridTileRun, type LoadedLandscape,
} from '@/image-lab/grid-client';
import {
  FUEL_INFO, LANDSCAPE_SOURCES, LANDSCAPE_SCHEMA, MODEL_SIDE, N_MIN, REVIEW_CLASSES, REVIEW_MAX_OFF_PALETTE, REVIEW_PROMPT_VERSION,
  SPREAD_BANDS_MIN, SPREAD_HORIZON_MIN, V_MIN, cellLonLat, fuseFuel, landscapeExport, modelGrid, reviewPrompt, runLandscapeSpread,
  weatherFor, type FusionMode, type ReviewCell, type WeatherSeries, type WindChoice,
} from '@/image-lab/landscape';
import { labRequest } from '@/image-lab/client';
import { LAB_API, LAB_MODELS } from '@/image-lab/protocol';
import { SpreadMap, fuelLegend, type MapLayer } from './landscape/SpreadMap';

interface Props {
  configured?: boolean;
  setupError: string;
  checkConnection: () => void;
  onBusyChange: (busy: boolean) => void;
}

type SourceState = { status: 'idle' | 'loading' | 'ready' | 'failed'; error?: string };
const IDLE: SourceState = { status: 'idle' };
const LABELS = ['NW', 'NE', 'SW', 'SE'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const hourLabel = (t: number) => `${new Date(t).toISOString().slice(5, 13).replace('T', ' ')}:00Z`;
const DEFAULT_WIND: WindChoice = { mode: 'forecast', startHour: 0, useGusts: false, manual: { windKph: 20, windDirDeg: 0, tempC: 30, rh: 30 } };
const FUSION_HELP: Record<FusionMode, string> = {
  base: 'Spread uses CORINE only. Accepted AI review cells are shown as disagreement outlines and change nothing.',
  add: `Accepted review cells can turn non-burnable CORINE land into shrub where at least ${V_MIN * 100}% of the cell is vegetation. Adds spread paths, never removes one.`,
  full: `Also lets confident review cells change agriculture to shrub, and burnable land to rock where at least ${N_MIN * 100}% is exposed surface. Can speed up or slow down spread.`,
};
const spreadLegend = (): LegendItem[] => [
  { label: `Modelled spread / darker = earlier (${SPREAD_BANDS_MIN.map(b => b / 60).join(', ')} h)`, color: color.ember },
  { label: 'Band edge', color: color.bone.DEFAULT, shape: 'line' },
];

export default function GreeceGridLab({ configured, setupError, checkConnection, onBusyChange }: Props) {
  const [scene, setScene] = useState<GridScene>();
  const [imageUrl, setImageUrl] = useState<string>();
  const [tiles, setTiles] = useState<GridTileRun[]>([]);
  const [land, setLand] = useState<LoadedLandscape>();
  const [landState, setLandState] = useState<SourceState>(IDLE);
  const [weather, setWeather] = useState<WeatherSeries>();
  const [weatherState, setWeatherState] = useState<SourceState>(IDLE);
  const [wind, setWind] = useState<WindChoice>(DEFAULT_WIND);
  const [ignition, setIgnition] = useState<number>();
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({ fuel: true, terrain: true, review: false, spread: true });
  const [fusion, setFusion] = useState<FusionMode>('base');
  const [model, setModel] = useState<string>(LAB_MODELS[0].value);
  const [retries, setRetries] = useState(GRID_DEFAULT_RETRIES);
  const [settings, setSettings] = useState<GridSettings>();
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const controller = useRef<AbortController>();
  const running = useRef(false);
  const workingTiles = useRef<GridTileRun[]>([]);
  const completed = tiles.filter(tile => tile.done).length;
  const lock = busy || loading || saving;
  const started = !!settings;
  const budget = settings?.retries ?? retries;
  const maxCalls = 4 * (1 + budget);
  const chosen = useMemo(() => tiles.map(bestAttempt), [tiles]);
  const stableReviews = useRef<(ReviewCell | undefined)[]>([]);
  // Same identity while only statuses change, so stitching, fusion and the mosaic recompute only on new outputs.
  const reviews = useMemo<(ReviewCell | undefined)[]>(() => {
    const next = tiles.map((tile, i) => chosen[i] === undefined ? undefined : tile.attempts[chosen[i]!].review);
    const previous = stableReviews.current;
    if (next.length === previous.length && next.every((r, i) => r === previous[i])) return previous;
    return (stableReviews.current = next);
  }, [tiles, chosen]);
  const accepted = reviews.filter(r => r?.accepted).length;
  const [mosaic, setMosaic] = useState<{ pixels: (Uint8ClampedArray | undefined)[]; blob: Blob; cells: (string | undefined)[] }>();
  const mosaicKey = useRef<(Uint8ClampedArray | undefined)[]>([]);

  useEffect(() => {
    const pixels = [0, 1, 2, 3].map(i => reviews[i]?.pixels);
    if (mosaicKey.current.length && pixels.every((p, i) => p === mosaicKey.current[i])) return;
    mosaicKey.current = pixels;
    if (!pixels.some(Boolean)) { setMosaic(undefined); return; }
    // Status-only tile updates re-run this effect, so staleness is checked by identity, not by cleanup.
    blendedMosaic(pixels).then(next => { if (mosaicKey.current === pixels) setMosaic({ pixels, ...next }); })
      .catch(e => { if (mosaicKey.current === pixels) setError(e instanceof Error ? e.message : 'Could not blend the review outputs.'); });
  }, [reviews]);

  useEffect(() => {
    onBusyChange(lock);
    return () => onBusyChange(false);
  }, [lock, onBusyChange]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  async function fetchInputs(next: GridScene, signal: AbortSignal) {
    setLandState({ status: 'loading' }); setWeatherState({ status: 'loading' });
    const landJob = loadLandscape(next.id, signal).then(result => { setLand(result); setLandState({ status: 'ready' }); })
      .catch(e => { if (!signal.aborted) setLandState({ status: 'failed', error: e instanceof Error ? e.message : 'Land cover is unavailable.' }); });
    const weatherJob = loadWeather(next.id, signal).then(series => {
      const first = series.hours[0];
      setWeather(series); setWeatherState({ status: 'ready' });
      setWind(previous => ({ ...previous, mode: 'forecast', startHour: 0,
        manual: { windKph: Math.round(first.windKph), windDirDeg: Math.round(first.windDirDeg / 5) * 5 % 360, tempC: Math.round(first.tempC), rh: Math.round(first.rh) } }));
    }).catch(e => {
      if (signal.aborted) return;
      setWeatherState({ status: 'failed', error: e instanceof Error ? e.message : 'Weather is unavailable.' });
      setWind(previous => ({ ...previous, mode: 'manual' }));
    });
    await Promise.all([landJob, weatherJob]);
  }

  async function pickLandscape() {
    if (running.current || loading) return;
    running.current = true;
    setLoading(true); setError(''); setConsent(false);
    setScene(undefined); setImageUrl(undefined); setTiles([]); setSettings(undefined);
    setLand(undefined); setWeather(undefined); setLandState(IDLE); setWeatherState(IDLE); setIgnition(undefined);
    setFusion('base'); setNotes(''); setWind(DEFAULT_WIND);
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    try {
      const next = await labRequest<GridScene>('/grid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: abort.signal,
      });
      const response = await fetch(`${LAB_API}/grid/${next.id}/imagery`, { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || 'Could not fetch satellite imagery. No fal analysis was submitted.');
      }
      const blob = await response.blob();
      const prepared = await splitSatellite(blob, next);
      if (abort.signal.aborted) return;
      setScene(next); setImageUrl(URL.createObjectURL(blob)); setTiles(prepared); workingTiles.current = prepared;
      await fetchInputs(next, abort.signal);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load a Greece landscape.');
    } finally {
      if (!abort.signal.aborted) { setLoading(false); running.current = false; }
    }
  }

  async function retryInputs() {
    if (!scene || running.current) return;
    running.current = true; setLoading(true);
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    try { await fetchInputs(scene, abort.signal); }
    finally { if (!abort.signal.aborted) { setLoading(false); running.current = false; } }
  }

  async function analyze() {
    if (!scene || tiles.length !== 4 || !consent || !terms || configured !== true || running.current) return;
    running.current = true; setBusy(true); setError('');
    const snapshot = settings ?? { model, retries };
    setSettings(snapshot);
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    try {
      await processGrid(scene, workingTiles.current, snapshot, abort.signal, next => {
        workingTiles.current = workingTiles.current.map(tile => tile.index === next.index ? next : tile);
        setTiles([...workingTiles.current]);
      });
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'AI review failed.');
    } finally {
      if (!abort.signal.aborted) { setBusy(false); running.current = false; }
    }
  }

  const grid = useMemo(() => scene && modelGrid(scene), [scene]);
  const fused = useMemo(() => land && fuseFuel(land.fuel, reviews, fusion), [land, reviews, fusion]);
  const weatherAt = useMemo(() => weatherFor(weather, wind), [weather, wind]);
  const now = weatherAt(0);
  const spread = useMemo(() => {
    if (!grid || !fused || !land || ignition === undefined) return undefined;
    try { return { result: runLandscapeSpread(grid, fused.fuel, land.elevation, ignition, weatherAt) }; }
    catch (e) { return { error: e instanceof Error ? e.message : 'Spread could not run.' }; }
  }, [grid, fused, land, ignition, weatherAt]);
  const result = spread?.result;

  const describe = (index: number) => {
    if (!grid || !land || !fused) return `Cell ${index % MODEL_SIDE}, ${Math.floor(index / MODEL_SIDE)}`;
    const { lat, lon } = cellLonLat(grid, index);
    const t = result?.arrival[index];
    const reach = result ? (t !== undefined && t <= SPREAD_HORIZON_MIN ? `reached ${Math.round(t)} min` : 'not reached') : 'no ignition';
    const changed = fused.fuel[index] !== land.fuel[index] ? ' (AI-adjusted)' : '';
    return `${fmtLat(lat, 3)} ${fmtLon(lon, 3)} · ${FUEL_INFO[fused.fuel[index] as FuelClass].label}${changed} · ${Math.round(land.elevation[index])} m · ${reach}`;
  };

  async function downloadReviews() {
    if (!scene || saving) return;
    setSaving(true); setError('');
    try {
      const pixels = reviews.map(r => r?.pixels);
      if (pixels.length !== 4 || pixels.some(p => !p)) throw new Error('All four review outputs are required for the blended PNG.');
      const blob = mosaic && mosaic.pixels.every((p, i) => p === pixels[i]) ? mosaic.blob : (await blendedMosaic(pixels)).blob;
      saveBlob(blob, `fcc-greece-${scene.id}-review-blended.png`);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not stitch these images.'); }
    finally { setSaving(false); }
  }

  function exportRun() {
    if (!scene || !land || !fused) return;
    const record = landscapeExport({
      scene, sources: land.sources, baseFuel: land.fuel, fused, elevation: land.elevation, fusion, weather, wind,
      review: { model: settings?.model, retries: settings?.retries, tiles: tiles.map((tile, i) => ({ index: tile.index, label: LABELS[tile.index], status: tile.status,
        requestId: chosen[i] === undefined ? undefined : tile.attempts[chosen[i]!].requestId, review: reviews[i],
        attempts: tile.attempts.map(a => ({ requestId: a.requestId, review: a.review })) })) },
      spread: result, notes,
      imagery: { name: GRID_SOURCE.name, license: 'CC BY-NC-SA 4.0, EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)', url: GRID_SOURCE.website },
    });
    saveBlob(new Blob([JSON.stringify(record)], { type: 'application/json' }), `fcc-landscape-${scene.id}.json`);
  }

  const sourceLine = (label: string, state: SourceState, detail?: string) => (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-mono text-nano uppercase text-bone">{label}</span>
      <span className={state.status === 'failed' ? 'text-xs text-ember' : 'text-xs text-bone-dim'}>
        {state.status === 'loading' ? 'Loading' : state.status === 'failed' ? state.error : state.status === 'ready' ? detail : 'Waiting for a landscape'}
      </span>
    </li>
  );
  const hours = weather?.hours ?? [];
  const legend: LegendItem[] = [
    ...(layers.fuel ? fuelLegend() : []),
    ...(layers.spread && result ? spreadLegend() : []),
    ...(layers.review ? [
      { label: 'Review / vegetation', color: color.amber }, { label: 'Review / exposed', color: color.ice },
      { label: 'Review / uncertain', color: color.ink[300] }, { label: 'CORINE disagrees', color: color.ember, shape: 'line' as const },
    ] : []),
  ];

  return (
    <div id="satellite-grid-lab" className="grid gap-px border border-line bg-line lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.65fr)]">
      <div className="min-w-0 space-y-6 bg-ink-900 p-5 sm:p-6">
        <div>
          <h3 className="fcc-label text-bone">01 / Random Greece landscape</h3>
          <p className="mt-2 text-sm text-bone-dim">An approximately 10 × 10 km landscape from one of eight curated inland Greek areas. Imagery, land cover, terrain and weather load from free public sources. No fal call happens in this step.</p>
          <label className="mt-3 flex items-start gap-2 text-sm text-bone-dim">
            <input id="grid-terms" type="checkbox" checked={terms} disabled={lock} onChange={e => setTerms(e.target.checked)}
              className="mt-1 accent-signal focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
            <span>I am using EOX’s public imagery service for non-commercial testing and will preserve attribution and share-alike terms for adapted imagery.</span>
          </label>
          <Button id="grid-pick" className="mt-3 w-full" disabled={lock || !terms} loading={loading} onClick={() => void pickLandscape()}>
            Pick random Greece landscape
          </Button>
          {scene && <div className="mt-3 space-y-1 text-sm text-bone-dim">
            <p className="font-medium text-bone">{scene.region}, Greece</p>
            <p className="font-mono text-nano">{fmtLat(scene.center.lat)} / {fmtLon(scene.center.lon)} · {grid ? `${grid.cellM.toFixed(1)} m cells` : ''}</p>
          </div>}
        </div>

        <div>
          <h3 className="fcc-label text-bone">02 / Landscape inputs</h3>
          <ul className="mt-3 space-y-2">
            {sourceLine('Imagery / EOX 2020', scene ? { status: 'ready' } : loading ? { status: 'loading' } : IDLE, 'Sentinel-2 cloudless, 1,024 px')}
            {sourceLine('Land cover / CORINE 2018', landState, land?.sources[0]?.detail)}
            {sourceLine('Terrain / Terrarium', landState, land?.sources[1]?.detail)}
            {sourceLine('Weather / Open-Meteo', weatherState, weather ? `${weather.hours.length} forecast hours at ${fmtLat(weather.point?.lat ?? 0, 2)} ${fmtLon(weather.point?.lon ?? 0, 2)}` : undefined)}
          </ul>
          {(landState.status === 'failed' || weatherState.status === 'failed') && <Button size="sm" className="mt-3" disabled={lock} onClick={() => void retryInputs()}>Retry failed sources</Button>}
          <p className="mt-2 text-xs text-bone-dim">Fuel comes from CORINE, mapped to nine classes exactly as the Mati scenario builder does. Without CORINE, no spread runs.</p>
        </div>

        <div className="space-y-3">
          <h3 className="fcc-label text-bone">03 / Wind and weather</h3>
          <Segmented aria-label="Wind source" value={wind.mode} onChange={mode => setWind(w => ({ ...w, mode: mode as WindChoice['mode'] }))}
            options={[{ value: 'forecast', label: 'Forecast' }, { value: 'manual', label: 'Manual' }]} />
          {wind.mode === 'forecast' ? (hours.length ? <>
            <Slider label="Ignition hour / from forecast start" unit="h" min={0} max={hours.length - 1} value={wind.startHour}
              onChange={startHour => setWind(w => ({ ...w, startHour }))} />
            <Toggle size="sm" checked={wind.useGusts} onChange={useGusts => setWind(w => ({ ...w, useGusts }))} label="Use gusts as sustained wind" />
            <p className="font-mono text-nano uppercase text-bone-dim">{hourLabel(hours[wind.startHour].t)} · next {SPREAD_HORIZON_MIN / 60} h follow the forecast hour by hour</p>
          </> : <p className="text-sm text-amber">No forecast loaded. Switch to Manual to set the wind.</p>) : <>
            <Slider label="Wind speed" unit="km/h" min={0} max={100} value={wind.manual.windKph} onChange={windKph => setWind(w => ({ ...w, manual: { ...w.manual, windKph } }))} />
            <Slider label="Wind from" unit="°" min={0} max={355} step={5} value={wind.manual.windDirDeg} onChange={windDirDeg => setWind(w => ({ ...w, manual: { ...w.manual, windDirDeg } }))} />
            <Slider label="Relative humidity" unit="%" min={5} max={100} value={wind.manual.rh} onChange={rh => setWind(w => ({ ...w, manual: { ...w.manual, rh } }))} />
            <Slider label="Air temperature" unit="°C" min={0} max={45} value={wind.manual.tempC} onChange={tempC => setWind(w => ({ ...w, manual: { ...w.manual, tempC } }))} />
            <p className="text-xs text-bone-dim">Manual values hold constant for all {SPREAD_HORIZON_MIN / 60} hours.</p>
          </>}
          <p className="font-mono text-nano uppercase text-bone">At ignition: {Math.round(now.windKph)} km/h from {compass(now.windDirDeg)} ({Math.round(now.windDirDeg)}°) · {Math.round(now.rh)}% RH · {Math.round(now.tempC)}°C</p>
        </div>

        <div className="space-y-3">
          <h3 className="fcc-label text-bone">04 / Optional AI land-cover review</h3>
          <p className="text-sm text-bone-dim">Each cell goes to fal with a 64 px overlap margin and a downscaled view of the whole landscape, so all four are judged on one scale. A cell counts only if no more than {REVIEW_MAX_OFF_PALETTE * 100}% of its pixels are off the three-color palette.</p>
          <Select label="Model / same for all four cells" value={model} onChange={setModel} disabled={lock || started} options={[...LAB_MODELS]} />
          <Select label="Automatic retries / per rejected cell" value={String(budget)} onChange={value => setRetries(Number(value))} disabled={lock || started}
            options={Array.from({ length: GRID_MAX_RETRIES + 1 }, (_, n) => ({ value: String(n), label: n ? `${n} · max ${4 * (1 + n)} calls` : 'None · max 4 calls' }))} />
          <details className="border border-line p-3 text-xs text-bone-dim">
            <summary className="cursor-pointer font-mono text-nano uppercase text-bone">Fixed prompt / {REVIEW_PROMPT_VERSION}</summary>
            <p className="mt-2 whitespace-pre-wrap font-mono text-micro leading-relaxed">{reviewPrompt('NW')}</p>
          </details>
          {(configured === false || setupError) && <div className="space-y-2 text-sm text-amber">
            <p>{setupError || 'Set FAL_KEY in .env or .env.local and restart the local server. Everything except the AI review works without it.'}</p>
            <Button size="sm" onClick={checkConnection}>Check connection</Button>
          </div>}
          <label className="flex items-start gap-2 text-sm text-bone-dim">
            <input id="grid-consent" type="checkbox" checked={consent} disabled={lock} onChange={e => setConsent(e.target.checked)}
              className="mt-1 accent-signal focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
            <span>I authorize up to {maxCalls} paid fal image generations{budget ? ` (one per cell, plus up to ${budget} automatic ${budget > 1 ? 'retries' : 'retry'} for each cell the palette gate rejects)` : ''} and sharing four satellite crops and one downscaled landscape image with fal and its model provider.</span>
          </label>
          <Button id="grid-analyze" className="w-full" loading={busy}
            disabled={lock || !scene || tiles.length !== 4 || !consent || !terms || configured !== true || completed === 4}
            onClick={() => void analyze()}>{started ? 'Recover same cells' : `Run AI review · max ${maxCalls} calls`}</Button>
          <p className="text-xs text-bone-dim">Cells run one at a time. The default makes at most four paid calls, with no automatic regeneration. Selecting retries explicitly increases the paid budget; each palette retry is a new paid call. Network or provider failures are not retried automatically. Recovery polls accepted jobs and resumes the same attempt; the server blocks anything past the budget.</p>
          {tiles.length === 4 && started && <ul className="space-y-1">
            {tiles.map(tile => { const r = reviews[tile.index]; return <li key={tile.index} className="flex flex-wrap justify-between gap-x-3 font-mono text-nano uppercase">
              <span className="text-bone">{LABELS[tile.index]} / {tile.status}</span>
              <span className={tile.error ? 'text-ember' : r ? (r.accepted ? 'text-phosphor' : 'text-amber') : 'text-bone-dim'}>
                {tile.error ?? (r ? `${tile.done ? '' : 'best so far '}${(r.offPalette * 100).toFixed(1)}% off-palette · ${r.accepted ? 'accepted' : 'rejected'}` : 'Pending')}
              </span>
            </li>; })}
          </ul>}
          <div className="space-y-2">
            <span className="fcc-micro block">Fusion / how accepted cells affect fuel</span>
            <Segmented aria-label="Fusion mode" size="sm" value={fusion} onChange={value => setFusion(value as FusionMode)}
              options={[{ value: 'base', label: 'CORINE only' }, { value: 'add', label: 'Add vegetation' }, { value: 'full', label: 'Full review' }]} />
            <p className="text-xs text-bone-dim">{FUSION_HELP[fusion]}{accepted ? '' : ' No accepted review cells yet, so all three modes are identical.'}</p>
            {fused && accepted > 0 && <p className="font-mono text-nano uppercase text-bone-dim">{accepted} / 4 cells accepted · {fused.changed.toLocaleString()} model cells changed · {fused.disagreements.toLocaleString()} disagree with CORINE</p>}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-5 bg-ink-950 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <span className="fcc-label text-bone">Spread path / prototype</span>
          <span role="status" aria-live="polite" className="font-mono text-nano uppercase text-bone-dim">
            {loading ? 'Loading landscape' : busy ? `AI review ${completed} / 4` : !land ? 'No landscape' : result ? `Modelled ${SPREAD_HORIZON_MIN / 60} h in ${Math.max(1, Math.round(result.computeMs))} ms` : 'Click the map to set ignition'}
          </span>
        </div>
        {error && <p role="alert" className="break-words border border-ember/40 bg-ember/10 p-3 text-sm text-ember">{error}</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Map layers">
          {(['fuel', 'terrain', 'review', 'spread'] as MapLayer[]).map(layer => <Toggle key={layer} size="sm" checked={layers[layer]}
            disabled={layer === 'review' && !reviews.some(Boolean)} label={layer === 'review' ? 'AI review' : layer}
            onChange={on => setLayers(previous => ({ ...previous, [layer]: on }))} />)}
        </div>
        <SpreadMap imageUrl={imageUrl} layers={layers} fuel={fused?.fuel} elevation={land?.elevation} reviews={reviews}
          disagree={fused?.disagree} arrival={result?.arrival} ignition={ignition} wind={land ? { fromDeg: now.windDirDeg, kph: now.windKph } : undefined}
          onIgnite={land ? setIgnition : undefined} describe={describe} />
        {legend.length > 0 && <Legend items={legend} />}
        {spread?.error && <p role="alert" className="text-sm text-amber">{spread.error} Pick a vegetated, agricultural or built-up cell.</p>}
        {result && <>
          <div className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
            {SPREAD_BANDS_MIN.map(b => <Metric key={b} size="sm" className="bg-ink-900 p-3" label={`Area ≤ ${b / 60} h`} value={Math.round(result.areasHa[b]).toLocaleString()} unit="ha" />)}
            <Metric size="sm" className="bg-ink-900 p-3" label="Longest run" value={result.run ? (result.run.distanceM / 1000).toFixed(1) : '0'} unit="km"
              sub={result.run ? `toward ${compass(result.run.bearingDeg)} (${Math.round(result.run.bearingDeg)}°)` : undefined} />
          </div>
          {result.reachedEdge && <p className="text-sm text-amber">The modelled fire reached the edge of this landscape, so areas and run length are truncated.</p>}
        </>}
        <div className="border border-amber/40 bg-amber/10 p-3 text-sm text-bone-dim">
          <strong className="font-medium text-bone">Prototype spread, not a forecast.</strong> Same minimum-travel-time solver as the console. It has no spotting, suppression or measured fuel moisture. On the Mati 2018 replay it was up to about 30 min off sourced checkpoint times and burned less than half the reconstructed area. Read the bands as likely paths given fuel, slope and wind, not as arrival times.
        </div>
        {tiles.length === 4 && started && <TileMosaic label="AI review outputs / registered, overlaps blended" seams
          tiles={tiles.map((tile, i) => ({ label: LABELS[tile.index], src: mosaic?.cells[i], status: tile.status }))} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!land || lock} onClick={exportRun}>Export {LANDSCAPE_SCHEMA} JSON</Button>
          <Button size="sm" disabled={completed !== 4 || lock} onClick={() => void downloadReviews()}>Save review outputs PNG</Button>
        </div>
        <p className="text-xs text-bone-dim">The JSON holds the fuel, elevation and arrival rasters, weather, fusion settings, review gate results, request IDs and sources, so the run can be reproduced or loaded by the console later.</p>
        <div>
          <label htmlFor="grid-review-notes" className="fcc-label text-bone">Review notes / included in JSON</label>
          <textarea id="grid-review-notes" rows={3} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)}
            className="mt-2 w-full rounded-none border border-line-strong bg-ink-900 p-3 text-sm text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal"
            placeholder="Does the fuel map match the imagery? Where does the review disagree with CORINE?" />
        </div>
        <div className="space-y-1 text-xs text-bone-dim">
          <p>
            <a href="https://s2maps.eu/" target="_blank" rel="noreferrer" className="underline">Sentinel-2 cloudless</a> by{' '}
            <a href="https://eox.at/" target="_blank" rel="noreferrer" className="underline">EOX IT Services GmbH</a>
            {' '}(Contains modified Copernicus Sentinel data 2020). <a href={GRID_SOURCE.licenseUrl} target="_blank" rel="noreferrer" className="underline">CC BY-NC-SA 4.0</a>.
            {' '}<a href={GRID_SOURCE.termsUrl} target="_blank" rel="noreferrer" className="underline">Source terms</a>. Historical 2020 mosaic, not live.
          </p>
          <p>{LANDSCAPE_SOURCES.corine.license}. {LANDSCAPE_SOURCES.terrain.name}: <a href={LANDSCAPE_SOURCES.terrain.url} target="_blank" rel="noreferrer" className="underline">open terrain sources</a>.
            {' '}Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo.com</a> ({LANDSCAPE_SOURCES.weather.license}).</p>
          <p>Review classes: {REVIEW_CLASSES.map(c => `${c.id} ${c.label}`).join(' · ')}.</p>
        </div>
      </div>
    </div>
  );
}
