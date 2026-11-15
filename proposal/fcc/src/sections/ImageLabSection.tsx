import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, ImageComparison, SectionHeader, Select, Serial } from '@ds';
import { DEFAULT_LAB_PROMPT, LAB_PALETTE, PROMPT_VERSION } from '@/image-lab/prompt';
import { LAB_MODELS, MAX_PROMPT_LENGTH, type LabResult } from '@/image-lab/protocol';
import { labRequest, pollLab, prepareImage, type PreparedImage } from '@/image-lab/client';
import { LAB_SAMPLES } from '@/image-lab/samples';
import GreeceGridLab from './GreeceGridLab';

interface Run {
  model: string;
  prompt: string;
  resolution: string;
  source: PreparedImage;
  submittedAt: string;
  jobId: string;
  requestId: string;
}

export default function ImageLabSection({ initialMode = 'grid' }: { initialMode?: 'grid' | 'single' }) {
  const [mode, setMode] = useState(initialMode);
  const [gridBusy, setGridBusy] = useState(false);
  const [image, setImage] = useState<PreparedImage>();
  const [model, setModel] = useState<string>(LAB_MODELS[0].value);
  const [resolution, setResolution] = useState('1K');
  const [prompt, setPrompt] = useState(DEFAULT_LAB_PROMPT);
  const [consent, setConsent] = useState(false);
  const [configured, setConfigured] = useState<boolean>();
  const [setupError, setSetupError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState('Ready for a test image');
  const [run, setRun] = useState<Run>();
  const [result, setResult] = useState<LabResult>();
  const controller = useRef<AbortController>();
  const preparation = useRef(0);
  const submitting = useRef(false);
  const supportsResolution = LAB_MODELS.find(m => m.value === model)?.resolution;

  useEffect(() => {
    const abort = new AbortController();
    void labRequest<{ configured: boolean }>('/config', { signal: abort.signal }).then(data => {
      setConfigured(data.configured);
    }).catch(e => { if (!abort.signal.aborted) setSetupError(e.message); });
    return () => { abort.abort(); controller.current?.abort(); preparation.current++; };
  }, []);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    const version = ++preparation.current;
    setPreparing(true);
    setError('');
    try {
      const next = await prepareImage(file);
      if (version === preparation.current) {
        setImage(next); setConsent(false); setRun(undefined); setResult(undefined); setStatus('Ready to submit');
      }
    } catch (e) {
      if (version === preparation.current) setError(e instanceof Error ? e.message : 'Could not read this image.');
    } finally { if (version === preparation.current) setPreparing(false); }
  }

  async function selectSample(sample: typeof LAB_SAMPLES[number]) {
    setPreparing(true);
    setError('');
    const version = ++preparation.current;
    try {
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error('Could not load the local test image.');
      const file = new File([await response.blob()], `${sample.id}.jpg`, { type: 'image/jpeg' });
      const next = await prepareImage(file);
      if (version === preparation.current) {
        setImage(next); setConsent(false); setRun(undefined); setResult(undefined); setStatus('Ready to submit');
      }
    } catch (e) {
      if (version === preparation.current) setError(e instanceof Error ? e.message : 'Could not load this scene.');
    } finally { if (version === preparation.current) setPreparing(false); }
  }

  async function watch(activeRun: Run) {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    try {
      const output = await pollLab(activeRun.jobId, abort.signal, state => {
        setStatus(state.status === 'IN_QUEUE' ? `Queued${state.queuePosition !== undefined ? ` · position ${state.queuePosition}` : ''}`
          : state.status === 'IN_PROGRESS' ? 'Generating review overlay' : 'Complete · review against the source');
      });
      setResult(output);
    } catch (e) {
      if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : 'Could not retrieve the result.'); setStatus('Request needs attention'); }
    } finally { if (!abort.signal.aborted) { setBusy(false); submitting.current = false; } }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!image || !consent || busy || submitting.current || preparing) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setResult(undefined);
    setRun(undefined);
    setStatus('Submitting to fal · do not close this page');
    const snapshot = { model, prompt: prompt.trim(), resolution: supportsResolution ? resolution : 'model default', source: image,
      submittedAt: new Date().toISOString() };
    const abort = new AbortController();
    controller.current = abort;
    try {
      const accepted = await labRequest<{ jobId: string; requestId: string }>('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ model, prompt: snapshot.prompt, image: image.dataUrl, resolution }),
      });
      const next = { ...snapshot, ...accepted };
      setRun(next);
      await watch(next);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Submission failed. Check fal history before resubmitting.');
        setStatus('Submission needs attention');
        setBusy(false);
        submitting.current = false;
      }
    }
  }

  function exportRun() {
    if (!run || !result) return;
    const { dataUrl: _dataUrl, ...source } = run.source;
    const record = {
      schema: 'fcc-image-lab-v1', promptVersion: run.prompt === DEFAULT_LAB_PROMPT ? PROMPT_VERSION : `${PROMPT_VERSION}-modified`,
      model: run.model, prompt: run.prompt, resolution: run.resolution, source, submittedAt: run.submittedAt,
      requestId: run.requestId, palette: LAB_PALETTE, output: result,
      limitations: 'AI-generated visual hypothesis. Not a segmentation raster, fuel measurement, georeferenced map, or fire-spread prediction. Human validation required.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fcc-image-lab-${run.requestId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const displayImage = run?.source ?? image;
  return (
    <section id="image-lab" aria-label="Image analysis lab" className="relative scroll-mt-20 border-t border-line bg-ink-950 py-24">
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10">
        <SectionHeader index="04B" eyebrow="Image intelligence / research bench" className="[&_.text-ink-600]:text-ink-300"
          title={<>One landscape.<br /><span className="text-bone-mute">A prototype fire path.</span></>}
          lede="Pick a random Greece landscape, build fuel, terrain and wind from open data, then set an ignition point to see where a fire would likely run. An optional AI review can refine the fuel map. Or switch to a single uploaded image."
          meta={<Serial>EXPERIMENTAL · NOT OPERATIONAL</Serial>} />

        <div className="mt-10 border border-amber/40 bg-amber/10 p-4 text-sm text-bone-dim">
          <strong className="font-medium text-bone">A research prototype, not a fire forecast.</strong>{' '}
          The spread model has no spotting or measured fuel moisture, and generative overlays can invent details or shift geometry.
          Nothing from this lab feeds FCC console predictions or operational decisions.
        </div>

        <div className="my-6 flex flex-wrap gap-2" role="group" aria-label="Image lab mode">
          <Button aria-pressed={mode === 'grid'} disabled={busy || gridBusy} onClick={() => setMode('grid')}>Greece landscape / spread</Button>
          <Button aria-pressed={mode === 'single'} disabled={busy || gridBusy} onClick={() => setMode('single')}>Single image</Button>
        </div>
        {mode === 'grid' ? <GreeceGridLab configured={configured} setupError={setupError} onBusyChange={setGridBusy}
          checkConnection={() => {
            setSetupError('');
            void labRequest<{ configured: boolean }>('/config').then(data => setConfigured(data.configured)).catch(e => setSetupError(e.message));
          }} /> : <div className="mt-6 grid gap-px border border-line bg-line lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.65fr)]">
          <form onSubmit={submit} className="min-w-0 space-y-6 bg-ink-900 p-5 sm:p-6">
            <div>
              <label htmlFor="lab-image" className="fcc-label text-bone">01 / Source image</label>
              <p id="lab-upload-hint" className="mt-2 text-sm text-bone-dim">JPEG, PNG or WebP · up to 8 MiB. EXIF/GPS removed locally; longest edge limited to 2,560 px.</p>
              <input id="lab-image" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || preparing}
                aria-describedby="lab-upload-hint"
                onChange={e => { void selectFile(e.target.files?.[0]); e.target.value = ''; }}
                className="mt-3 block w-full text-sm text-bone-dim file:mr-3 file:cursor-pointer file:rounded-none file:border file:border-line-strong file:bg-ink-800 file:px-3 file:py-2 file:font-mono file:text-nano file:uppercase file:text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
              {image && <p className="mt-2 break-all font-mono text-nano text-bone-dim">{image.name} · {image.width} × {image.height}</p>}
              <p className="mt-4 fcc-micro">Or load a local test scene</p>
              <div className="mt-2 grid gap-2">
                {LAB_SAMPLES.map(sample => (
                  <div key={sample.id} className="flex items-center gap-3 border border-line p-2">
                    <img src={sample.path} alt="" loading="lazy" className="h-12 w-16 shrink-0 object-cover" />
                    <div className="min-w-0 flex-1">
                      <Button size="sm" variant="ghost" disabled={busy || preparing} onClick={() => void selectSample(sample)}
                        className="max-w-full whitespace-normal text-left">{sample.name}</Button>
                      <a href={sample.source} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-bone-dim underline underline-offset-2">{sample.credit}</a>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-bone-dim">Illustrative scenes, not labeled ground truth. Source links include reuse terms.</p>
            </div>

            <div className="space-y-3">
              <Select label="02 / fal image-edit model" options={[...LAB_MODELS]} value={model} onChange={setModel} disabled={busy} />
              <p className="break-all font-mono text-nano text-bone-dim">{model}</p>
              <Select label="Output resolution / higher may cost more" value={resolution} onChange={setResolution} disabled={busy || !supportsResolution}
                options={[{ value: '1K', label: '1K · quick test' }, { value: '2K', label: '2K · more detail' }, { value: '4K', label: '4K · highest cost' }]} />
              <a href={`https://fal.ai/models/${model}`} target="_blank" rel="noreferrer" className="inline-block text-xs text-bone-dim underline underline-offset-2">Model details and current pricing</a>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="lab-prompt" className="fcc-label text-bone">03 / Instructions</label>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPrompt(DEFAULT_LAB_PROMPT)}>Reset prompt</Button>
              </div>
              <textarea id="lab-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} required maxLength={MAX_PROMPT_LENGTH}
                spellCheck={false} rows={14} aria-describedby="lab-prompt-hint"
                className="mt-2 w-full resize-y rounded-none border border-line-strong bg-ink-950 p-3 font-mono text-xs leading-relaxed text-bone focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
              <p id="lab-prompt-hint" className="mt-1 text-xs text-bone-dim">Seeded for Nano Banana 2.1. Editable in full. Custom instructions may break the palette. {prompt.length.toLocaleString()} / 16,000 characters.</p>
            </div>

            <div className="space-y-3 border-t border-line pt-4">
              {configured === false && <p className="text-sm text-amber">Set <code>FAL_KEY=your_fal_api_key</code> in <code>.env</code> or <code>.env.local</code>, then restart the local server. Never prefix it with <code>VITE_</code>.</p>}
              {setupError && <p className="text-sm text-amber">{setupError}</p>}
              {(configured === false || setupError) && <Button size="sm" onClick={() => {
                setSetupError('');
                void labRequest<{ configured: boolean }>('/config').then(data => setConfigured(data.configured))
                  .catch(e => setSetupError(e.message));
              }}>Check connection</Button>}
              <label className="flex items-start gap-3 text-sm text-bone-dim">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}
                  className="mt-1 h-4 w-4 shrink-0 accent-signal focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
                <span>I may share this image and prompt with fal and its model provider. I understand this is a paid API call and generated media may be accessible by URL. No sensitive incident imagery or personal data.</span>
              </label>
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={busy || preparing || !image || !consent || !prompt.trim() || configured !== true}
                className="w-full">Generate review overlay</Button>
              <p className="text-xs text-bone-dim">Nothing is sent until you click. Keep this page open while waiting. No automatic paid retries.</p>
            </div>
          </form>

          <div className="min-w-0 space-y-5 bg-ink-950 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <span className="fcc-label text-bone">Review bench</span>
              <span role="status" aria-live="polite" className="font-mono text-nano uppercase text-bone-dim">{preparing ? 'Preparing image locally' : status}</span>
            </div>
            {error && <div role="alert" className="break-words border border-ember/40 bg-ember/10 p-3 text-sm text-ember">{error}</div>}
            {run && <div className="space-y-1 break-all text-xs text-bone-dim">
              <p className="font-mono uppercase">Last submitted run / {run.source.name}</p>
              <p>{run.model} · {run.resolution} · {run.submittedAt.replace('T', ' ').replace('.000Z', 'Z')}</p>
              <p>fal request: {run.requestId}</p>
            </div>}
            <ImageComparison before={displayImage?.dataUrl} after={result?.images?.[0]?.url}
              beforeLabel={run ? 'Submitted source' : 'Prepared source'} afterLabel="AI review overlay / unvalidated"
              placeholder={busy ? status : undefined} />
            <p className="text-xs text-bone-dim">Images are contained, never cropped to fit. Side-by-side display does not imply pixel registration. A generated edit is not a segmentation mask.</p>

            {run && !busy && !result && <Button onClick={() => {
              if (submitting.current) return;
              submitting.current = true; setError(''); setBusy(true); void watch(run);
            }}>Check same request again</Button>}
            {result && <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <a href={result.images?.[0]?.url} target="_blank" rel="noreferrer" className="font-mono text-nano uppercase text-ice underline underline-offset-4">Open / save output image</a>
                <Button size="sm" onClick={exportRun}>Export run JSON</Button>
              </div>
              <div className="border border-line bg-ink-900 p-4">
                <h3 className="fcc-label text-bone">Model notes / unverified</h3>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-bone-dim">{result.description?.trim() || 'This endpoint returned an image without explanatory text. No separate analysis report was supplied.'}</p>
              </div>
              <details className="border border-line p-3 text-sm text-bone-dim">
                <summary className="cursor-pointer font-mono text-nano uppercase text-bone">Exact submitted prompt</summary>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs">{run?.prompt}</pre>
              </details>
            </div>}

            <div className="border border-line">
              <div className="border-b border-line p-4">
                <h3 className="fcc-label text-bone">Overlay key / fixed data colors</h3>
                <p className="mt-2 text-xs text-bone-dim">Categorical, not a low-to-high risk scale. Uncolored means unassessed, never safe. Generated colors and boundaries require visual checking.</p>
              </div>
              <dl className="divide-y divide-line">
                {LAB_PALETTE.map(item => <div key={item.id} className="p-4">
                  <dt className="flex items-center gap-3 font-mono text-nano uppercase text-bone">
                    <span aria-hidden className="h-3 w-3 shrink-0 border border-current" style={{ backgroundColor: item.hex }} />
                    {item.id} / {item.label} / {item.hex}
                  </dt>
                  <dd className="ml-6 mt-1 text-sm text-bone-dim">{item.meaning} <span className="text-xs">({item.pattern})</span></dd>
                </div>)}
              </dl>
            </div>
            <details className="border border-line p-4 text-sm text-bone-dim">
              <summary className="cursor-pointer font-mono text-nano uppercase text-bone">What to test / what comes next</summary>
              <ul className="mt-3 list-disc space-y-2 pl-4">
                {LAB_SAMPLES.map(sample => <li key={sample.id}><strong className="font-medium text-bone">{sample.name}:</strong> {sample.check}</li>)}
                <li>Compare false positives, missed objects, class consistency, and geometry drift on the same image and prompt. Model confidence is not a calibrated probability.</li>
                <li>For future spread modeling: validate separate segmentation masks and fuel classes, georeference them, and add measured moisture, weather, wind, and terrain. Do not derive a prediction raster from these generated colors.</li>
              </ul>
            </details>
          </div>
        </div>}
      </div>
    </section>
  );
}
