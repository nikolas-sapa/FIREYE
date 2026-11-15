// Optional finite production-entry check. Requires agent-browser and a current npm run build.
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), root = process.cwd();
await exec('agent-browser', ['--version'], { cwd: root });
await mkdir(resolve(root, '.scratch/qa'), { recursive: true });
const types = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.wasm':'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname, file = resolve(root, 'dist', '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(resolve(root, 'dist') + '/')) throw Error();
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
const session = process.env.AGENT_BROWSER_SESSION || (await exec('agent-browser', ['session','id','--scope','worktree','--prefix','frontend-issues'], { cwd: root })).stdout.trim();
const ab = async args => (await exec('agent-browser', args, { cwd: root, env: { ...process.env, AGENT_BROWSER_SESSION: session }, timeout: 45000, maxBuffer: 2097152 })).stdout;
const evaluate = code => ab(['eval', '-b', Buffer.from(code).toString('base64')]);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  await ab(['--allowed-domains','127.0.0.1,localhost','open',`${origin}/console.html?t=17:00&boot=0&tokens=0&context=0&appearance=dark`]);
  await ab(['wait','--fn',`!!document.querySelector('canvas[data-world="world3d"][data-ready="true"]')`]);
  await ab(['find','role','button','click','--name','1×','--exact']);
  await ab(['click','button[aria-label^="AETOS-2 · IR GIMBAL."]']);
  await ab(['wait','--fn',`!!document.querySelector('[aria-label="Display palette, not source modality"]') && [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Save local frame')&&!b.disabled)`]);
  console.log('EXPORT_PROOF', await evaluate(`(async()=>{
    const captures=[], original=URL.createObjectURL, click=HTMLAnchorElement.prototype.click, frames=[];
    URL.createObjectURL=function(blob){if(blob.type==='application/json')captures.push(blob);return original.call(this,blob)};
    HTMLAnchorElement.prototype.click=function(){if(!this.download)return click.call(this)};
    try {
      for(let i=0;i<20;i++) {
        const end=performance.now()+10000;
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Save local frame'));
        while(button.disabled){if(performance.now()>end)throw Error('Unavailable '+i);await new Promise(requestAnimationFrame);}
        button.click();
        while(captures.length<=i){if(performance.now()>end)throw Error('No export '+i+' connected='+button.isConnected+' label='+button.textContent);await new Promise(requestAnimationFrame);}
        const out=JSON.parse(await captures[i].text()),m=out.metadata,bytes=Uint8Array.from(atob(out.pixels_base64),x=>x.charCodeAt(0));
        const hash='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
        if(hash!==out.content_hash||m.modality!=='thermal'||m.received_at!==null||m.radiometric!==false||/findingIds|truePos|detections|confidence|temperature|arrival|classes/.test(JSON.stringify(m)))throw Error('Invalid provenance '+i);
        const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        if(image.width!==m.width_px||image.height!==m.height_px)throw Error('Pixel size mismatch');
        frames.push({id:m.frame_id,feed:m.feed_id,w:image.width,h:image.height,bytes:bytes.length});image.close();
        await new Promise(requestAnimationFrame);
      }
      if(new Set(frames.map(x=>x.id)).size!==20)throw Error('Repeated frame identities');
      return JSON.stringify({captures:frames.length,uniqueFrames:20,feed:frames[0].feed,dimensions:[frames[0].w,frames[0].h],maxPngBytes:Math.max(...frames.map(x=>x.bytes)),external:performance.getEntriesByType('resource').map(x=>x.name).filter(x=>x.startsWith('http')&&!x.startsWith(location.origin)),viewport:[innerWidth,innerHeight]});
    } finally {URL.createObjectURL=original;HTMLAnchorElement.prototype.click=click}
  })()`));
  console.log(await ab(['screenshot',resolve(root,'.scratch/qa/thermal-capture.png')]));
} catch (e) {
  console.log('FAILED_STATUS', await evaluate(`JSON.stringify({status:[...document.querySelectorAll('[role=status]')].map(x=>x.textContent),canvases:[...document.querySelectorAll('.fcc-sensor canvas')].map(x=>({w:x.width,h:x.height,data:{...x.dataset}}))})`));
  console.log('ERRORS', await ab(['errors']));
  throw new Error(e.stderr ?? e.message);
} finally { try { await ab(['close']); } catch {} await new Promise(r=>server.close(r)); }
