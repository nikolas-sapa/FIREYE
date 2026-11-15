import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

// Finite production-entry QA. No development server, dependencies, or retained recordings.
const exec = promisify(execFile), root = resolve(import.meta.dirname, '../dist');
const env = { ...process.env, AGENT_BROWSER_SESSION: process.env.AGENT_BROWSER_SESSION || `fireye-boot-${process.pid}` };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    // Test the worker independently with test:pwa, without an installation competing for graphics time.
    if (req.url === '/sw.js') { res.writeHead(404).end(); return; }
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
const run = async (...args) => (await exec('agent-browser', args, { env, timeout: 35000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const evaluate = async source => {
  const result = JSON.parse(await run('eval', source));
  return typeof result === 'string' ? JSON.parse(result) : result;
};
const wait = condition => run('wait', '--fn', condition, '--timeout', '25000');
const ready = () => wait('document.querySelector("[data-fireye-dashboard]")?.dataset.bootState==="ready"');
const geometry = `(() => {
  const rect = selector => {const r=document.querySelector(selector)?.getBoundingClientRect();return r?[r.x,r.y,r.width,r.height]:null};
  return {map:rect('[data-fireye-map]'),canvas:rect('.cesium-widget canvas'),window:rect('[data-fireye-map-window]'),hud:rect('.fireye-boot-hud')};
})()`;
const engine = `(() => {
  const node=document.querySelector('.fcc-stage');
  for(let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))];f;f=f.return)
    for(let h=f.memoizedState;h;h=h.next) if(h.memoizedState?.current?.viewer && h.memoizedState.current.homeView) return h.memoizedState.current;
})()`;
const capture = `(() => {
  const qa=window.__bootQA={samples:[],icons:[],order:[],maxVisible:0,renders:[],pixels:[]};
  const original=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){
    if(this.matches('[data-boot-source]')) qa.icons.push({id:this.dataset.bootSource,hold:(frames[2].offset-frames[1].offset)*options.duration});
    return original.call(this,frames,options);
  };
  let off;
  function sample(t){
    const dashboard=document.querySelector('[data-fireye-dashboard]');
    const phase=document.querySelector('[data-boot-phase]')?.dataset.bootPhase;
    const scene=(${engine})?.viewer.scene;
    if(scene&&!off) off=scene.postRender.addEventListener(()=>{
      const phase=document.querySelector('[data-boot-phase]')?.dataset.bootPhase;
      if(!['reveal','globe'].includes(phase)) return;
      qa.renders.push(performance.now());
      if(phase!=='globe'||qa.pixels.length) return;
      const gl=scene.context._gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
      for(const [region,x,y] of [['left',.02,.5],['right',.98,.5],['bottom',.5,.05],['bottom-left',.02,.05],['bottom-right',.98,.05],['center',.5,.5]]){
        const p=new Uint8Array(4);gl.readPixels(Math.floor(w*x),Math.floor(h*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);
        qa.pixels.push({region,rgba:[...p]});
      }
    });
    const visible=[...document.querySelectorAll('[data-boot-source]')].filter(e=>Number(getComputedStyle(e).opacity)>.01).map(e=>e.dataset.bootSource);
    qa.maxVisible=Math.max(qa.maxVisible,visible.length);
    for(const id of visible) if(!qa.order.includes(id)) qa.order.push(id);
    qa.samples.push({t,phase,state:dashboard?.dataset.bootState,...${geometry},
      inert:dashboard?.inert,paused:!!document.querySelector('button[aria-label="Play"]'),
      camera:scene?[scene.camera.position.x,scene.camera.position.y,scene.camera.position.z]:null,
      frustum:scene?[scene.camera.frustum.fov,scene.camera.frustum.xOffset,scene.camera.frustum.yOffset]:null});
    if(dashboard?.dataset.bootState==='ready'&&qa.samples.length>10){
      qa.done=true;off?.();Element.prototype.animate=original;return;
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);return true;
})()`;
const click = selector => run('click', selector);
const watchdog = setTimeout(() => {
  console.error('FIREYE boot browser QA exceeded two minutes');
  void run('close').finally(() => { server.closeAllConnections(); server.close(); process.exit(1); });
}, 120000);
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/console.html?mode=fireye&tokens=0`;
  await run('--headed', 'open', 'about:blank');
  await run('set', 'viewport', '1600', '1000');
  await run('open', base);
  await evaluate(capture);
  await wait('document.querySelector("[data-boot-phase]")?.dataset.bootPhase==="globe"');
  if (process.env.FIREYE_QA_SCREENSHOTS) await run('screenshot', resolve(import.meta.dirname, '../experiments/fireye-full-bleed-reveal.png'));
  await ready();
  await wait('window.__bootQA.done');
  const qa = await evaluate('JSON.stringify(window.__bootQA)');
  const expected = ['terrain', 'fuel', 'osm', 'weather', 'fleet', 'iot', 'comms', 'camera'];
  assert.deepEqual(qa.order, expected);
  assert.deepEqual(qa.icons.map(i => i.id), expected);
  assert.ok(qa.icons.every(i => Math.abs(i.hold - 100) < 1e-8));
  assert.equal(qa.maxVisible, 1);
  assert.ok(qa.samples.filter(s => s.canvas).every(s => JSON.stringify(s.canvas) === '[0,48,1600,952]'), 'canvas must cover all hidden panel slots throughout boot');
  const panels = qa.samples.filter(s => s.state === 'panels');
  assert.ok(panels.length > 10);
  assert.ok(panels.every(s => JSON.stringify(s.camera) === JSON.stringify(panels[0].camera)), 'panel entrance must not move the camera');
  assert.ok(panels.every(s => JSON.stringify(s.frustum) === JSON.stringify(panels[0].frustum)), 'panel entrance must not change framing');
  assert.ok(qa.samples.filter(s => s.state && s.state !== 'ready').every(s => s.inert && s.paused));
  const blank = await evaluate(`JSON.stringify(getComputedStyle(document.querySelector('[data-fireye-dashboard]').parentElement).backgroundColor.match(/\\d+/g).slice(0,3).map(Number))`);
  assert.ok(qa.pixels.length === 6 && qa.pixels.every(p => p.rgba[3] === 255 && JSON.stringify(p.rgba.slice(0, 3)) !== JSON.stringify(blank)), 'the rendered map, not the empty panel-slot background, must fill every region');
  const intervals = qa.renders.slice(1).map((t, i) => t - qa.renders[i]).sort((a, b) => a - b);
  console.log('Boot PASS', JSON.stringify({ holdsMs: qa.icons.map(i => i.hold), canvas: qa.samples.at(-1).canvas, renders: qa.renders.length,
    fps: +(1000 * intervals.length / (qa.renders.at(-1) - qa.renders[0])).toFixed(2), p95Ms: +intervals[Math.floor(intervals.length * .95)].toFixed(1), pixels: qa.pixels }));
  const final = await evaluate(geometry);
  assert.deepEqual(final.hud, final.window);
  const stations = await evaluate(`JSON.stringify((() => {
    const e=${engine},v=e.viewer,points=[];
    for(let i=0;i<v.dataSources.length;i++)for(const entity of v.dataSources.get(i).entities.values)
      if(entity.id.startsWith('p:station-')) points.push({id:entity.id,...e.screenOfCart(entity.position.getValue(v.clock.currentTime),0)});
    return points;
  })())`);
  console.log('Home station framing', JSON.stringify(stations));
  assert.equal(stations.length, 2);
  assert.ok(stations.every(p => p.x > final.window[0] && p.x < final.window[0] + final.window[2] && p.y + 48 > final.window[1] && p.y + 48 < final.window[1] + final.window[3]), 'both stations remain in the unobstructed home view');
  assert.equal(await evaluate(`!document.querySelector('[data-fireye-dashboard]').inert&&(${engine}).viewer.scene.screenSpaceCameraController.enableInputs`), true);
  if (process.env.FIREYE_QA_SCREENSHOTS) await run('screenshot', resolve(import.meta.dirname, '../experiments/fireye-full-bleed-ready.png'));

  // Real hit testing and keyboard entry points, not synthetic React handler calls.
  assert.equal(await evaluate(`document.elementFromPoint(600,300)===document.querySelector('.cesium-widget canvas')`), true);
  const beforeZoom = await evaluate(`(${engine}).viewer.camera.positionCartographic.height`);
  await click('[aria-label="Zoom in"]');
  await wait(`Math.abs((${engine}).viewer.camera.positionCartographic.height-${beforeZoom})>100`);
  for (const selector of ['[aria-label="Expand fleet panel"]', '[aria-label="Show Log"]', '[aria-label="Show Feeds"]']) {
    if (selector.includes('Show Log')) {
      await run('focus', '[role="separator"][aria-label^="Log width"]');
      await run('press', 'Enter');
    }
    if (selector.includes('Show Feeds')) await click('[aria-label="Collapse feeds"]');
    await click(selector);
    const current = await evaluate(geometry);
    assert.deepEqual(current.canvas, final.canvas);
    assert.deepEqual(current.hud, current.window);
  }
  await run('focus', '[role="separator"][aria-label^="Fleet width"]');
  await run('press', 'ArrowRight');
  assert.deepEqual((await evaluate(geometry)).canvas, final.canvas);
  const feedLabel = await evaluate(`JSON.stringify(document.querySelector('button[aria-label^="Open "][aria-label$=" feed"]').getAttribute('aria-label'))`);
  await click(`[aria-label=${JSON.stringify(feedLabel)}]`);
  await wait('!!document.querySelector("[data-feed-toolbar]")');
  assert.equal(await evaluate(`(() => {const r=document.querySelector('[data-feed-toolbar] button').getBoundingClientRect();return r.y>=112&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===document.querySelector('[data-feed-toolbar] button')})()`), true);
  await click('[data-feed-toolbar] button');
  await wait(`!document.querySelector(".fireye-wipe-host")&&!(${engine}).viewer.camera._currentFlight`);
  console.log('Map input, panel toggles/resize, HUD bounds, feed entry/return PASS');

  await run('open', base);
  await run('press', 'Escape');
  await ready();
  assert.equal(await evaluate(`(${engine}).viewer.scene.screenSpaceCameraController.enableInputs`), true);
  await run('close');
  await run('--headed', 'open', 'about:blank');
  await run('set', 'viewport', '1600', '1000');
  await run('set', 'media', 'dark', 'reduced-motion');
  await run('open', base);
  await evaluate(`(() => {window.__bootAnimations=0;const a=Element.prototype.animate;Element.prototype.animate=function(...args){if(this.closest('[data-boot-phase]'))window.__bootAnimations++;return a.apply(this,args)};return true})()`);
  await ready();
  assert.equal(await evaluate('window.__bootAnimations'), 0);
  assert.deepEqual((await evaluate(geometry)).canvas, final.canvas);
  console.log('Escape and reduced-motion entry PASS');
  for (const [width, height] of [[1024, 768], [1920, 1080]]) {
    await run('set', 'viewport', String(width), String(height));
    await wait(`JSON.stringify((${geometry}).canvas)===JSON.stringify([0,48,${width},${height - 48}])&&JSON.stringify((${geometry}).hud)===JSON.stringify((${geometry}).window)`);
  }
  console.log('1024×768 and 1920×1080 viewport resize PASS');
  await run('open', base.replace('?mode=fireye&tokens=0', '?tokens=0&context=0&paused=1'));
  await wait('!!document.querySelector(".ops-root .fcc-stage canvas") && !!document.querySelector(\'button[aria-label="Chat with Chief"]\')');
  assert.equal(await evaluate('!!document.querySelector("[data-fireye-dashboard]")'), false, 'plain console stays Ops');
  await click('[aria-label="Chat with Chief"]');
  await wait('!!document.querySelector(\'input[placeholder="Ask Chief"]\')');
  await run('fill', 'input[placeholder="Ask Chief"]', 'What is the current status?');
  await run('press', 'Enter');
  await wait('document.querySelector(\'[aria-label="Orchestrator chat"]\')?.textContent.includes("You") && !document.querySelector(\'[aria-label="Orchestrator chat"]\')?.textContent.includes("Working…")');
  const history = await evaluate('JSON.stringify(document.querySelector(\'[aria-label="Orchestrator chat"]\').textContent)');
  await click('[aria-label="Close chat"]');
  await click('[aria-label="Chat with Chief"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelector(\'[aria-label="Orchestrator chat"]\').textContent)'), history);
  await run('open', base.replace('?mode=fireye&tokens=0', '?mode=crew&tokens=0'));
  await wait('!!document.querySelector(\'input[type="password"]\')');
  assert.equal(await evaluate('!!document.querySelector(".fcc-stage, [data-fireye-dashboard], .ops-root")'), false, 'Crew never mounts simulation');
  console.log('Current-main Ops default, Chief reply/history and isolated Crew entry PASS');} finally {
  clearTimeout(watchdog);
  try { await run('close'); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
