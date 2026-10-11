/** Opt-in REAL R231 -> browser MPR on a pinned public partial CT reference.
 * Never mock inference, copy slices, resample pixels or save CT screenshots.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, realpath, writeFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import net from 'node:net';

async function main() {
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error(`Required ${name}`);return args[i+1];};
const python=value('--python'), weights=resolve(value('--weights'));
const reference=await realpath(value('--reference')), report=resolve(value('--report'));
const outside=path=>{const p=relative(root,path);return p==='..'||p.startsWith('..'+sep)||isAbsolute(p);};
assert.ok(outside(reference)&&outside(await realpath(dirname(report))),'Reference and report must be outside the repository');
try {await lstat(report);throw Error("Report already exists");} catch(e) {if(e.code!=="ENOENT")throw e;}
const manifest=JSON.parse(await readFile(join(reference,'reference.json'),'utf8'));
assert.equal(manifest.schema,'opus-r231-browser-reference/v1');
assert.equal(manifest.sourceContentChainSha256,'bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61');
assert.equal(manifest.fullChest,false);assert.equal(manifest.originalFrames,103);
assert.deepEqual(manifest.selectedIndicesZeroBased,[35,66]);
assert.deepEqual(manifest.dimensions,[512,512,32]);
assert.equal(manifest.selectedFileSha256.length,32);
const names=(await readdir(join(reference,'dicom'))).sort();
assert.equal(names.length,32);
const selectedChain=createHash('sha256');
for(const digest of manifest.selectedFileSha256) {
  assert.match(digest,/^[a-f0-9]{64}$/);selectedChain.update(Buffer.from(digest,'hex'));
}
assert.equal(selectedChain.digest('hex'),'886f229ed355f669e4f5798f50b305c4823aaee949c04253660075c4e75afe30');
assert.deepEqual(manifest.niftiCandidates,[
  {affineLps:[0.976562,0,0,-250,0,0.976562,0,-156,0,0,3,145],inputSha256:'23d0065256550d22ccbe62a1ef4029ddf57bb0ef6334874875c244fc791a35d3'},
  {affineLps:[0.976562,0,0,-250,0,0.976562,0,-156,0,0,-3,238],inputSha256:'f81b3edb3c591afa699b7c6e081a90c57cb2b7a1e8d8e1e7025c3992c45487a6'},
]);
const files=[];
for(let i=0;i<names.length;i++) {
  assert.equal(names[i],`reference-${String(i).padStart(3,'0')}.dcm`);
  const path=join(reference,'dicom',names[i]);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),manifest.selectedFileSha256[i]);
  files.push(path);
}
const freePort=()=>new Promise((resolve,reject)=>{
  const socket=net.createServer();socket.once('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});
});
const appPort=await freePort(),workerPort=await freePort();
const appOrigin=`http://127.0.0.1:${appPort}`, workerOrigin=`http://127.0.0.1:${workerPort}`;
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
let worker,server,browser,page,token,stage='start',jobId,request,outputStatus,maskPromise;
let uploaded=0,chunkCount=0,deleted=false,observerError=null;
const workerHttp={capabilities:null,modelReady:null,createJob:null,firstChunk:null};
let resourceDiagnostic=null;
let workerRequestFailed=false;
const hash=createHash('sha256'), destinations=new Set(), errors=[];
const started=performance.now(), timings={};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async url=>{
  for(let i=0;i<150;i++) {
    try {const r=await fetch(url);if(r.ok)return;}catch{}
    await delay(200);
  }
  throw Error('Local app startup timeout');
};
const stop=async child=>{
  if(!child||child.exitCode!==null)return;
  const exited=once(child,'exit');child.kill('SIGTERM');
  if(await Promise.race([exited.then(()=>true),delay(10000).then(()=>false)]))return;
  child.kill('SIGKILL');await exited;
};
try {
  worker=spawn(python,[join(root,'services/imaging-ai/worker.py'),'--weights',weights,'--origin',appOrigin,'--port',String(workerPort)],
    {stdio:['ignore','pipe','ignore']});
  // Consume but never print the ephemeral bearer token.
  const lines=createInterface({input:worker.stdout});
  const issued=new Promise((resolve,reject)=>{
    lines.on('line',line=>{if(line.startsWith('Paste this ephemeral session token'))resolve(line.split(': ').at(-1));});
    worker.once('exit',()=>reject(Error('Worker exited before token')));
  });
  token=await Promise.race([issued,delay(30000).then(()=>{throw Error('Worker startup timeout');})]);
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(appPort)],
    {cwd:join(root,'web'),stdio:'ignore'});
  await ready(appOrigin);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(120000);
  page.on('pageerror',()=>errors.push('browser-error'));
  // Only technical flags/codes: never log headers, tokens, bodies or Playwright
  // error messages (fill() call logs can contain the session token).
  page.on('requestfailed',r=>{
    if(new URL(r.url()).origin===workerOrigin)workerRequestFailed=true;
  });
  page.on('response',async r=>{
    const url=new URL(r.url());if(url.origin!==workerOrigin)return;
    if(url.pathname==='/v1/capabilities') {
      workerHttp.capabilities=r.status();
      if(r.ok())try {workerHttp.modelReady=(await r.json()).model?.ready===true;}catch{}
    }
    if(url.pathname==='/v1/jobs'&&r.request().method()==='POST') {
      workerHttp.createJob=r.status();
      try {const data=await r.json();resourceDiagnostic=data.detail??data;}catch{}
    }
    if(url.pathname.endsWith('/input/chunks/0')&&r.request().method()==='PUT')workerHttp.firstChunk=r.status();
  });
  // Real requests pass through to localhost. Any other page egress is refused.
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===appOrigin||url.origin===workerOrigin){
      destinations.add(url.origin);
      // Relay unchanged REAL worker replies for independent inspection. This
      // avoids Chromium evicting getResponseBody while the browser streams it.
      if(url.origin===workerOrigin&&route.request().method()==='GET'&&/^\/v1\/jobs\//.test(url.pathname)) {
        try {
          const response=await route.fetch({maxRedirects:0});
          const body=await response.body();
          if(url.pathname.endsWith('/mask'))maskPromise=Promise.resolve(body);
          else if(response.ok()) {
            const data=JSON.parse(body.toString());resourceDiagnostic=data;
            if(data.state==='succeeded'){outputStatus=data;jobId=data.jobId;}
          }
          return route.fulfill({response,body});
        } catch(e) {observerError=e;return route.abort();}
      }
      return route.continue();
    }
    errors.push('outbound-page-request-refused');return route.abort();
  });
  page.on('request',r=>{
    try {
      const url=new URL(r.url());if(url.origin!==workerOrigin)return;
      if(url.pathname==='/v1/jobs'&&r.method()==='POST')request=r.postDataJSON().request;
      if(url.pathname.includes('/input/chunks/')&&r.method()==='PUT') {
        assert.equal(Number(url.pathname.split('/').at(-1)),uploaded);
        const bytes=r.postDataBuffer();assert.ok(bytes&&bytes.length<=131072);
        uploaded+=bytes.length;chunkCount++;hash.update(bytes);
      }
      if(url.pathname.endsWith('/input/complete')&&r.method()==='POST') {
        assert.equal(uploaded,352+512*512*32*4);
        assert.equal(hash.digest('hex'),request.inputSha256);
        assert.ok(manifest.niftiCandidates.some(c=>c.inputSha256===request.inputSha256));
      }
      if(r.method()==='DELETE')deleted=true;
    } catch(e) {observerError=e;}
  });
  stage='import-original-public-slices';
  await page.goto(appOrigin,{waitUntil:'networkidle'});
  await page.locator('input[accept*=".dcm"]').setInputFiles(files);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='MPR · 3 плоскости'&&!b.disabled));
  await page.getByRole('button',{name:'MPR · 3 плоскости',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Подготовить пакет серии'&&!b.disabled));
  timings.importMprSeconds=(performance.now()-started)/1000;
  stage='r231-open-panel';
  const panel=page.locator('.ora-local-lungmask');
  await panel.waitFor({state:'visible'});
  if(!await panel.evaluate(node=>node.open))await panel.locator('summary').click();
  stage='r231-worker-address';
  await panel.getByLabel('Адрес локального worker').fill(workerOrigin);
  stage='r231-session-token';
  await panel.getByLabel('Токен локального worker').fill(token);
  stage='r231-research-confirmation';
  await panel.getByRole('checkbox').check();
  stage='r231-button-enabled';
  const runButton=panel.getByRole('button',{name:'Сегментировать лёгкие локально',exact:true});
  await runButton.waitFor({state:'visible'});
  assert.equal(await runButton.isEnabled(),true,'R231 button disabled');
  const jobStarted=performance.now();
  stage='r231-click';
  await runButton.click();
  stage='r231-await-result';
  await Promise.race([
    panel.locator('.ora-local-worker-metrics').waitFor({timeout:300000}),
    panel.locator('[role=alert]').waitFor({timeout:300000}).then(()=>{throw Error('Worker/UI rejected reference');}),
  ]);
  timings.browserJobSeconds=(performance.now()-jobStarted)/1000;
  stage='verify-bound-mask-and-mpr';
  stage="verify-observed-source";
  if(observerError)throw observerError;
  stage="verify-result-received";
  assert.ok(deleted&&outputStatus&&maskPromise);
  stage="verify-source-geometry";
  assert.deepEqual(request.geometry.dimensions,[512,512,32]);
  const expected=manifest.niftiCandidates.find(c=>c.inputSha256===request.inputSha256);
  assert.ok(expected);
  request.geometry.affineLps.forEach((v,i)=>assert.ok(Math.abs(v-expected.affineLps[i])<0.00001));
  stage="verify-mask-bytes";
  const mask=await maskPromise, result=outputStatus.result;
  assert.equal(result.inputSha256,request.inputSha256);
  assert.equal(result.sourceIdentitySha256,request.sourceIdentitySha256);
  assert.equal(createHash('sha256').update(mask).digest('hex'),result.maskSha256);
  assert.equal(result.model.weightsSha256,'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f');
  assert.equal(mask.length,352+512*512*32);
  const counts=[0,0,0];for(const v of mask.subarray(352)){assert.ok(v<=2);counts[v]++;}
  assert.ok(counts[1]>0&&counts[2]>0);
  stage="verify-mpr-overlay";
  assert.match(await panel.innerText(),/Маска возвращена в MPR/);
  assert.match(await page.locator('.ora-mask-coverage').innerText(),/только к загруженным срезам/);
  await page.waitForFunction(()=>{
    const canvases=[...document.querySelectorAll('.ora-mpr-mask-overlay')];
    return canvases.length===3&&canvases.every(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0));
  });
  const overlayPixels=await page.locator('.ora-mpr-mask-overlay').evaluateAll(canvases=>canvases.map(c=>{
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;
    for(let i=3;i<a.length;i+=4)if(a[i])count++;return count;
  }));
  stage="verify-deletion-and-egress";
  const gone=await page.request.get(`${workerOrigin}/v1/jobs/${jobId}`,{headers:{Origin:appOrigin,Authorization:`Bearer ${token}`}});
  assert.equal(gone.status(),404);assert.equal(errors.length,0);
  timings.totalSeconds=(performance.now()-started)/1000;
  const record={schema:'opus-r231-browser-verification/v1',status:'passed',actualTrainedInference:true,
    reference:{collection:manifest.collection,license:manifest.license,sourceContentChainSha256:manifest.sourceContentChainSha256,
      originalFrames:103,selectedFrames:32,selectedIndicesZeroBased:[35,66],fullChest:false,selection:manifest.selection},
    dimensions:request.geometry.dimensions,affineLps:request.geometry.affineLps,inputSha256:request.inputSha256,
    maskSha256:result.maskSha256,weightsSha256:result.model.weightsSha256,labelVoxels:counts,
    inferenceMetrics:outputStatus.metrics,preflight:outputStatus.metrics.preflight,
    guardDecision:outputStatus.metrics.guardDecision,peakRssMiB:outputStatus.metrics.peakRssMiB,
    controller:{platform:os.platform(),machine:os.arch(),browser:await browser.version()},
    timings,chunkCount,uploadedBytes:uploaded,overlayPixels,jobDeleted:true,pageNetworkOrigins:[...destinations],
    clinicalDice:null,M1Acceptance:'not-accepted; requires separate M1/Safari/system-memory verification',
    limitations:['Partial native CT reference only, not complete chest coverage.','No manual contour Dice or clinical accuracy evaluated.',
      'Model RSS is separate from browser/system RAM; no 8GB acceptance claim.','Live worker status/mask responses are relayed unchanged for inspection; timings include this test instrumentation.','Page egress interception is not an OS network sandbox.','Model weights commercial clearance remains pending.']};
  await writeFile(report,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'passed',actualTrainedInference:true,selectedFrames:32,fullChest:false,
    labelVoxels:counts,overlayPixels,metrics:outputStatus.metrics,timings}));
} catch(cause) {
  const uiAlert=page?await page.locator('.ora-local-lungmask [role=alert]').isVisible().catch(()=>false):false;
  // Project only numeric diagnostics and allowlisted decisions; no raw errors,
  // token-bearing Playwright call logs or worker response bodies.
  const preflight={};
  for(const key of ['availableRamBytes','requiredRamBytes','availableDiskBytes','requiredDiskBytes']) {
    const n=resourceDiagnostic?.preflight?.[key];if(Number.isSafeInteger(n)&&n>=0)preflight[key]=n;
  }
  const guardDecision=resourceDiagnostic?.guardDecision??resourceDiagnostic?.preflight?.guardDecision;
  const diagnostic={schema:'opus-r231-browser-verification/v1',status:'failed',actualTrainedInference:outputStatus?true:uploaded===0?false:null,
    stage,uploaded,chunkCount,deleted,statusReceived:Boolean(outputStatus),maskReceived:Boolean(maskPromise),
    inputSha256:request?.inputSha256,geometry:request?.geometry,observerFailed:Boolean(observerError),errorCount:errors.length,
    errorType:cause instanceof Error?cause.name:'unknown',uiAlert,workerHttp,workerRequestFailed,preflight,
    guardDecision:['allow','reject-memory','reject-disk','reject-model-budget','stop-memory-pressure','stop-rss-limit','stop-timeout'].includes(guardDecision)?guardDecision:null,
    peakRssMiB:Number.isFinite(resourceDiagnostic?.peakRssMiB)?resourceDiagnostic.peakRssMiB:null};
  await writeFile(report,JSON.stringify(diagnostic,null,2),{flag:'wx',mode:0o600});
  console.error(JSON.stringify(diagnostic));
  console.error(`FAIL: real R231 browser verification at ${stage}; no screenshots or source pixels saved.`);
  process.exitCode=1;
} finally {
  await browser?.close();await stop(server);await stop(worker);
}

}
main().catch(()=>{console.error("FAIL: public reference preflight; no metadata or pixels logged.");process.exitCode=1;});
