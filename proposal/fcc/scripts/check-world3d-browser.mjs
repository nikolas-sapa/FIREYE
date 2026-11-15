import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

// Finite built-app QA, not a development server. Always closes its own browser and listener.
const exec = promisify(execFile), root = resolve(import.meta.dirname, '../dist');
const out = resolve(import.meta.dirname, '../experiments');
const artifacts = process.env.WORLD3D_QA_ARTIFACTS === '1';
const qaCase = process.env.WORLD3D_QA_CASE || 'fireye', initialTime = process.env.WORLD3D_QA_TIME || '16:44';
const controlName = qaCase === 'pointer-minimal' ? 'pointer-minimal' : process.env.WORLD3D_QA_CONTROL
  ? `seek-control-${process.env.WORLD3D_QA_KEYS ? 'keys' : process.env.WORLD3D_QA_HOVER ? 'hover' : process.env.WORLD3D_QA_CLICK ? 'click' : 'pointer'}` : null;
const reportName = (controlName || (qaCase === 'monitoring' ? 'monitoring' : initialTime.replace(':', '')))
  + (process.env.WORLD3D_QA_NO_IMAGERY ? '-palette' : '') + (process.env.WORLD3D_QA_SEEKS ? '-seeks' : '')
  + (process.env.WORLD3D_QA_PROFILE ? '-profile' : '');
const env = { ...process.env, AGENT_BROWSER_SESSION: process.env.AGENT_BROWSER_SESSION || `world3d-qa-${process.pid}` };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/pointer.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Pointer capture isolation</title><div role="slider" tabindex="0" style="width:600px;height:100px;cursor:ew-resize;background:lightgray" onpointerdown="this.setPointerCapture(event.pointerId);this.dataset.down=1" onpointerup="this.dataset.up=1">Pointer capture, no app or WebGL</div>');
      return;
    }
    // Isolate graphics timing from a simultaneous 41 MB service-worker installation.
    // The production worker is validated separately by npm run test:pwa.
    if (req.url === '/sw.js') { res.writeHead(404).end(); return; }
    if (process.env.WORLD3D_QA_NO_IMAGERY && /\.(jpg|jpeg|webp)(\?|$)/.test(req.url)) { res.writeHead(404).end(); return; }
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
const run = async (...args) => {
  const { stdout } = await exec('agent-browser', args, { env, timeout: process.env.WORLD3D_QA_CONTROL ? 15000 : 45000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
};
const evaluate = async js => {
  const raw = await run('eval', js);
  const value = JSON.parse(raw);
  return typeof value === 'string' ? JSON.parse(value) : value;
};
const wait = async condition => { await run('wait', '--fn', condition); };
const exitFull = async () => {
  await evaluate('JSON.stringify((Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Back to globe"))?.click(),true))');
  await wait('!document.querySelector(".fireye-wipe-host") && window.__fccWorld?.stats()?.mode==="wall"');
};
const seek = async time => {
  const [h, m] = time.split(':').map(Number);
  const p = await evaluate(`JSON.stringify((()=>{const e=document.querySelector('[aria-label="Incident timeline"]'),r=e.getBoundingClientRect();return {x:r.left+r.width*((${h}-14)*60+${m})/480,y:r.top+r.height/2}})())`);
  await run('mouse', 'move', String(Math.round(p.x)), String(Math.round(p.y)));
  await run('mouse', 'down'); await run('mouse', 'up');
  await wait(process.env.WORLD3D_QA_CONTROL
    ? `Math.abs(Number(document.querySelector('[aria-label="Incident timeline"]').getAttribute('aria-valuenow'))-${Date.UTC(2018,6,23,h-3,m)})<30000`
    : 'window.__fccWorld.env.t===Number(document.querySelector(\'[aria-label="Incident timeline"]\').getAttribute("aria-valuenow"))');
};
const reports = [], failures = [];
let transitionProfile = [];
const sample = async (label, ms = 1800) => {
  const report = await evaluate(`(async () => {
    const w = window.__fccWorld, samples = [], end = performance.now() + ${ms}, tasks = w.stats().longTasks;
    const browserTasks = [];
    const observer = new PerformanceObserver(list => browserTasks.push(...list.getEntries().map(e=>e.duration)));
    observer.observe({type:'longtask'});
    while (performance.now() < end) {
      samples.push(w.stats()); await new Promise(r => setTimeout(r, 100));
    }
    const s = w.stats();
    observer.disconnect();
    return JSON.stringify({label:${JSON.stringify(label)}, ...s,
      firstFrameMs:Math.min(...[...w.feedFrames.values()].filter(f=>f.length).map(f=>f[0])),
      maxDraws:Math.max(...samples.map(s=>s.draws)), maxTris:Math.max(...samples.map(s=>s.maxTotalViewTris)),
      warmLongTasks:s.longTasks-tasks,
      browserLongTasks:browserTasks,
      visibleFeeds:[...w.surfaces].filter(s=>s.visible&&s.active).map(s=>({id:s.feed.id,full:s.full})),
      shaderErrors:w.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length});
  })()`);
  reports.push(report);
  if (report.mode === 'full' && (report.maxDraws > 150 || report.maxTris > 1500000)) failures.push(`${label}: fullscreen budget ${report.maxDraws} draws / ${report.maxTris} triangles`);
  if (report.mode === 'wall' && report.maxTris > 400000) failures.push(`${label}: wall triangles ${report.maxTris}`);
  if (report.tiles > 64 || report.shaderErrors || report.warmLongTasks || report.browserLongTasks.length || report.genMsMax > 40) failures.push(`${label}: cache/shader/task/generation limit`);
  console.log(JSON.stringify({ label, fps: +report.fps.toFixed(1), draws: report.maxDraws, tris: report.maxTris, tiles: report.tiles,
    stepP95: +report.stepP95Ms.toFixed(1), longTasks: report.warmLongTasks, genMax: report.genMsMax }));
  return report;
};
let started = false;
const watchdog = setTimeout(() => {
  console.error('World3D browser QA exceeded eight minutes');
  void run('close').finally(() => { server.closeAllConnections(); server.close(); process.exit(1); });
}, 480000);
try {
  if (artifacts) await mkdir(out, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  started = true;
  if (qaCase === 'pointer-minimal') {
    await run('open', `${base}/pointer.html`);
    await run('click', '[role="slider"]');
    await wait('document.querySelector("[role=slider]").dataset.up==="1"');
    console.log('Bare HTML pointer-capture control PASS');
  } else if (process.env.WORLD3D_QA_CONTROL) {
    await run('open', `${base}/console.html?mode=fireye&boot=0&paused=1&t=14:00&tokens=0&feeds=cesium`);
    await run('set', 'viewport', '1600', '1000');
    await run('wait', '[aria-label="Incident timeline"]');
    if (process.env.WORLD3D_QA_HOVER) {
      await run('hover', '[aria-label="Incident timeline"]');
      await evaluate('JSON.stringify({t:document.querySelector(\'[aria-label="Incident timeline"]\').getAttribute("aria-valuenow")})');
    } else if (process.env.WORLD3D_QA_KEYS) {
      await run('focus', '[aria-label="Incident timeline"]');
      for (const key of ['End', 'Home', 'End']) {
        await run('press', key);
        await wait(`document.querySelector('[aria-label="Incident timeline"]').getAttribute('aria-valuenow')===document.querySelector('[aria-label="Incident timeline"]').getAttribute('${key==='End'?'aria-valuemax':'aria-valuemin'}')`);
      }
    } else if (process.env.WORLD3D_QA_CLICK) {
      await run('click', '[aria-label="Incident timeline"]');
      await wait(`Math.abs(Number(document.querySelector('[aria-label="Incident timeline"]').getAttribute('aria-valuenow'))-${Date.UTC(2018,6,23,15)})<30000`);
    } else await seek('18:44');
    console.log(`Cesium-only ${controlName} control PASS`);
  } else if (qaCase !== 'monitoring') {
  await run('open', `${base}/console.html?mode=fireye&boot=0&paused=1&t=${initialTime}&tokens=0&world=stats`);
  await run('set', 'viewport', '1600', '1000');
  await wait('window.__fccWorld?.stats()?.mode === "wall" && window.__fccWorld.store.pending === 0');
  const wall = await sample(`fireye-${initialTime}-wall`, 4000);
  assert.ok(wall.visibleFeeds.length < 20, 'offscreen feeds must not all render after asynchronous registration');
  const ids = await evaluate('JSON.stringify([...new Set([...window.__fccWorld.surfaces].map(s=>s.feed.id))])');
  for (const id of process.env.WORLD3D_QA_TIME ? ids.filter(id=>id==='feed-cctv-mati'||id==='feed-uav-3') : process.env.WORLD3D_QA_FOCUS ? ids.slice(-1) : ids) {
    await evaluate(`JSON.stringify((document.querySelector('[data-feed-id="${id}"] button').click(), true))`);
    await wait(`window.__fccWorld?.stats()?.mode === "full" && [...window.__fccWorld.surfaces].some(s=>s.full&&s.feed.id==="${id}"&&s.ready&&s.frame>25) && window.__fccWorld.store.pending===0`);
    await sample(`fireye-${initialTime}-${id}`);
    if (artifacts && ['feed-cctv-mati', 'feed-uav-3', 'feed-cctv-kokkino-limanaki'].includes(id)) {
      await run('screenshot', resolve(out, initialTime === '16:44' && !process.env.WORLD3D_QA_NO_IMAGERY ? `world3d-after-${id}.png` : `world3d-${reportName}-${id}.png`));
    }
  }
  if (process.env.WORLD3D_QA_NO_IMAGERY) assert.equal(await evaluate('JSON.stringify(window.__fccWorld.store.imagery)'), false, 'palette-only generation survives missing imagery');
  if (initialTime === '16:44') {
    const sensor = '[role="group"][aria-label="Display palette, not source modality"]';
    await evaluate(`JSON.stringify((document.querySelector('${sensor} button:last-child').click(),true))`);
    await wait('[...window.__fccWorld.surfaces].some(s=>s.full&&s.thermal)');
    await sample('fireye-thermal');
    await evaluate(`JSON.stringify((document.querySelector('${sensor} button:first-child').click(),true))`);
    await wait('[...window.__fccWorld.surfaces].some(s=>s.full&&!s.thermal)');
    await run('set', 'media', 'dark', 'reduced-motion');
    await wait('[...window.__fccWorld.surfaces].every(s=>!s.moving)');
    await run('set', 'media', 'dark');
    await wait('[...window.__fccWorld.surfaces].every(s=>s.moving)');
    await evaluate('JSON.stringify((window.__visibility=[],document.addEventListener("visibilitychange",()=>window.__visibility.push(document.hidden)),true))');
    await run('tab', 'new', 'about:blank');
    await run('tab', 'close');
    assert.ok(await evaluate('JSON.stringify(window.__visibility.includes(true)&&!document.hidden)'), 'real tab hide/show reaches the renderer');
    console.log('EO/thermal, reduced motion and tab hide/show PASS');
  }
  // Seek through real entry points, including on-pad/offline state, active fire and dusk.
  for (const time of process.env.WORLD3D_QA_SEEKS ? ['14:00', '18:44', '20:30'] : []) {
    await exitFull();
    await seek(time);
    if (process.env.WORLD3D_QA_FOCUS) {
    await evaluate(`JSON.stringify((()=>{
      const s=window.__fccWorld.store, receive=s.receive.bind(s);
      window.__tileEvents=[];
      s.receive=m=>{if(m.type==='tile'){window.__tileEvents.push({key:m.tile.key,frame:s.frame,requested:s.inflight.get(m.id)?.frame,demand:s.demand.has(m.tile.key)});if(window.__tileEvents.length>30)window.__tileEvents.shift()}return receive(m)};
      return true;
    })())`);
    }
    await wait('window.__fccWorld?.stats()?.mode === "wall" && window.__fccWorld.store.pending===0');
    await sample(`fireye-${time}-wall`, 3000);
    for (const id of ['feed-cctv-mati', 'feed-uav-3']) {
      const available = await evaluate(`JSON.stringify([...window.__fccWorld.surfaces].some(s=>s.feed.id==="${id}"))`);
      if (!available) continue;
      await evaluate(`JSON.stringify((document.querySelector('[data-feed-id="${id}"] button').click(), true))`);
      await wait(`window.__fccWorld?.stats()?.mode === "full" && [...window.__fccWorld.surfaces].some(s=>s.full&&s.feed.id==="${id}"&&s.ready&&s.frame>25) && window.__fccWorld.store.pending===0`);
      await sample(`fireye-${time}-${id}`);
      if (artifacts && id === 'feed-cctv-mati') await run('screenshot', resolve(out, `world3d-${time.replace(':', '')}.png`));
    }
  }
  if (process.env.WORLD3D_QA_SEEKS) {
  // Exercise the timeline's real keyboard handler in both directions.
  await run('focus', '[aria-label="Incident timeline"]');
  for (const key of ['Home', 'End', 'Home']) {
    await run('press', key);
    await wait('window.__fccWorld.env.t === Number(document.querySelector(\'[aria-label="Incident timeline"]\').getAttribute("aria-valuenow"))');
  }
  const pausedTime = await evaluate('(async()=>{const t=window.__fccWorld.env.t;await new Promise(r=>setTimeout(r,1200));return JSON.stringify(window.__fccWorld.env.t===t)})()');
  assert.ok(pausedTime, 'paused replay lighting must not drift');
  await run('set', 'media', 'dark', 'reduced-motion');
  await wait('[...window.__fccWorld.surfaces].every(s=>!s.moving)');
  console.log('Replay Home/End/Home, paused lighting and reduced motion PASS');
  }
  const soakEnd = Date.now() + Number(process.env.WORLD3D_QA_SOAK_MS || 0);
  if (process.env.WORLD3D_QA_PROFILE) {
    await evaluate(`JSON.stringify((()=>{
      const w=window.__fccWorld; let current=null;
      window.__transitionProfile=[];
      const wrap=(o,k,label)=>{
        if(!o||!o[k]||o[k].__profiled)return;
        const old=o[k].bind(o);
        o[k]=(...a)=>{const t=performance.now();try{return old(...a)}finally{if(current)current.parts[label]=(current.parts[label]||0)+performance.now()-t}};
        o[k].__profiled=true;
      };
      for(const v of w.views.values()){wrap(v,'select','select');wrap(v,'rebuild','rebuild')}
      wrap(w.store,'upload','upload');wrap(w.sim,'update','agentsUpdate');wrap(w.sim,'populate','populate');
      wrap(w.agentMeshes,'write','agentsWrite');wrap(w.renderer,'render','glRender');wrap(w.post,'render','post');
      const render=w.renderAll.bind(w);
      w.renderAll=(...a)=>{for(const s of w.surfaces)wrap(s.context,'drawImage','copy');return render(...a)};
      wrap(w,'renderAll','renderAll');
      const step=w.step;
      w.step=now=>{
        current={at:now,full:w.full,parts:{},programsBefore:w.renderer.info.programs.length};
        const t=performance.now();
        try{return step(now)}finally{
          current.ms=performance.now()-t;current.programsAfter=w.renderer.info.programs.length;
          if(current.ms>40)window.__transitionProfile.push(current);
          current=null;
        }
      };
      return true;
    })())`);
  }
  let cycle = 0;
  while (Date.now() < soakEnd) {
    await exitFull();
    const id = ids[cycle++ % ids.length];
    await evaluate(`JSON.stringify((document.querySelector('[data-feed-id="${id}"] button').click(),true))`);
    await wait(`!!document.querySelector("[data-feed-toolbar]") && window.__fccWorld.stats()?.mode==="full" && [...window.__fccWorld.surfaces].some(s=>s.full&&s.feed.id==="${id}"&&s.ready&&s.frame>25) && window.__fccWorld.store.pending===0`);
    await sample(`rehearsal-${cycle}-${id}`, Math.min(8000, Math.max(1000, soakEnd - Date.now())));
  }
  if (process.env.WORLD3D_QA_PROFILE) {
    transitionProfile = await evaluate('JSON.stringify(window.__transitionProfile)');
    console.log(JSON.stringify({transitionProfile}));
  }
  }

  // Monitoring retains its independent clock and has no reconstructed fire.
  if (qaCase === 'monitoring') {
  await run('open', `${base}/console.html?mode=monitoring&view=mati&saved=1&tokens=0&world=stats`);
  await run('set', 'viewport', '1600', '1000');
  await wait('window.__fccWorld?.stats()?.mode === "wall" && window.__fccWorld.store.pending===0');
  await sample('monitoring-wall', 4000);
  assert.ok(await evaluate('JSON.stringify(window.__fccWorld.fire===null)'), 'monitoring never mounts reconstructed fire');
  await run('set', 'media', 'dark');
  await run('find', 'role', 'button', 'click', '--name', 'Open simulated UAV-01 · Coastal patrol', '--exact');
  await wait('window.__fccWorld?.stats()?.mode === "full" && [...window.__fccWorld.surfaces].some(s=>s.full&&s.ready&&s.frame>25) && window.__fccWorld.store.pending===0');
  for (let i = 0; i < 6; i++) {
    await sample(`monitoring-${i}`, 1200);
    await run('find', 'role', 'button', 'click', '--name', 'Next simulated camera', '--exact');
    await wait('window.__fccWorld.store.pending===0 && [...window.__fccWorld.surfaces].some(s=>s.full&&s.ready&&s.frame>25)');
  }
  const truth = await evaluate('(async()=>{const w=window.__fccWorld,s=[...w.surfaces].find(s=>s.full),c=await w.captureTruth(s.feed.id);return JSON.stringify({pixels:c?.classes.length,classes:c?.classPixels})})()');
  assert.equal(truth.pixels, 480 * 270, 'truth pass still renders with the surface-detail shaders');
  await run('set', 'offline', 'on');
  const frame = await evaluate('JSON.stringify([...window.__fccWorld.surfaces].find(s=>s.full).frame)');
  await wait(`[...window.__fccWorld.surfaces].some(s=>s.full&&s.frame>${frame+90})`);
  await sample('monitoring-offline-full', 4000);
  await run('set', 'offline', 'off');
  console.log('Monitoring six fullscreen cameras, reconstructed-fire exclusion, truth and offline rendering PASS');
  await evaluate('JSON.stringify((window.__fccWorld.renderer.forceContextLoss(),true))');
  await wait('Array.from(document.querySelectorAll("[data-simulated-feed]")).some(e=>e.textContent.includes("3D unavailable · archive fallback")&&e.querySelector("[data-demo-camera] canvas[data-ready]"))');
  assert.ok(await evaluate('JSON.stringify(window.__fccWorld.failed)'), 'context loss fails cleanly into the labelled archive');
  console.log('Forced WebGL context-loss archive fallback PASS');
  }
  assert.deepEqual(failures, [], 'World3D browser budget checks');
} catch (error) {
  failures.push(String(error));
  console.error(await evaluate('JSON.stringify({url:location.href,title:document.title,hidden:document.hidden,stats:window.__fccWorld?.stats(),failed:window.__fccWorld?.failed,ready:window.__fccWorld?.store.ready,pending:window.__fccWorld?.store.pending,entries:window.__fccWorld&&[...window.__fccWorld.store.entries.keys()],wanted:window.__fccWorld&&[...window.__fccWorld.store.wanted.values()],inflight:window.__fccWorld&&[...window.__fccWorld.store.inflight.values()],events:window.__tileEvents,views:window.__fccWorld&&[...window.__fccWorld.views].map(([id,v])=>({id,requests:v.requests,dirty:v.dirty,tiles:v.tiles.map(t=>t.entry.key)})),surfaces:window.__fccWorld&&[...window.__fccWorld.surfaces].map(s=>({id:s.feed.id,visible:s.visible,ready:s.ready}))})').catch(String));
  throw error;
} finally {
  clearTimeout(watchdog);
  try {
    if (started) await run('close').catch(e => console.error(e.message));
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  // Resource cleanup must happen even if the report cannot be written (for example, disk full).
  if (artifacts) await writeFile(resolve(out, `world3d-browser-${reportName}.json`), JSON.stringify({ at: new Date().toISOString(), viewport: [1600, 1000], reports, failures, transitionProfile }, null, 2) + '\n');
}
