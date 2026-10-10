import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readdir, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const fixture=await mkdtemp(join(tmpdir(),'opus-browser-phantom-'));
const results=join(root,'web/browser-results');
await mkdir(results,{recursive:true});
execFileSync(process.execPath,[join(root,'scripts/generate-segmentation-phantom.mjs'),fixture],{stdio:'pipe'});
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3131'],{cwd:root+'/web',stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let browser,page;const errors=[];
try {
  for(let i=0;i<80;i++) {
    try {const r=await fetch('http://127.0.0.1:3131');if(r.ok)break;}catch{}
    if(i===79)throw new Error('Server not ready: '+logs);
    await new Promise(r=>setTimeout(r,250));
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3131',{waitUntil:'networkidle'});
  const files=(await readdir(fixture+'/dicom')).sort().map(n=>fixture+'/dicom/'+n);
  await page.locator('input[accept*=".dcm"]').setInputFiles(files);
  const mpr=page.getByRole('button',{name:'MPR · 3 плоскости',exact:true});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='MPR · 3 плоскости'&&!b.disabled),undefined,{timeout:30000});
  await mpr.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Загрузить маску .nii / .nii.gz'&&!b.disabled),undefined,{timeout:30000});
  console.log('MPR ready');
  // The loader packs all-zero slices into uint8 despite 16-bit DICOM storage.
  // Check decoded buffers, not the on-disk pixel byte count (0.25 MiB).
  assert.match(await page.locator('.ora-mpr-volume-stats').innerText(),/0\.2 МиБ/);
  const upload=page.locator('input[accept=".nii,.nii.gz"]');
  await upload.setInputFiles(fixture+'/synthetic-mask.nii');
  await page.locator('.ora-mask-success').waitFor({timeout:30000});
  assert.match(await page.locator('.ora-mask-quantification').innerText(),/16\.260/);
  const overlayCounts=()=>page.locator('.ora-mpr-mask-overlay').evaluateAll(canvases=>canvases.map(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;
  }));
  await page.waitForFunction(()=>[...document.querySelectorAll('.ora-mpr-mask-overlay')].every(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return true;return false;
  }));
  console.log('Overlay pixels per plane:',await overlayCounts());
  await page.locator('.ora-mask-settings select').selectOption('2');
  assert.match(await page.locator('.ora-mask-quantification').innerText(),/0\.940/);
  await page.locator('.ora-mask-visible input').uncheck();
  await page.waitForFunction(()=>[...document.querySelectorAll('.ora-mpr-mask-overlay')].every(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return false;return true;
  }));
  await page.locator('.ora-mask-visible input').check();
  await page.locator('.ora-mask-settings select').selectOption('1');
  await upload.setInputFiles(fixture+'/synthetic-mask-shifted.nii');
  await page.locator('.ora-mask-error').waitFor();
  assert.match(await page.locator('.ora-mask-error').innerText(),/не совпадает.*Предыдущая маска сохранена/);
  assert.match(await page.locator('.ora-mask-success').innerText(),/synthetic-mask\.nii/);
  await page.locator('.ora-analysis-package>summary').click();
  await page.getByRole('button',{name:'Подготовить пакет серии',exact:true}).click();
  await page.locator('.ora-package-ready').waitFor();
  const download=async(name,path)=>{
    const event=page.waitForEvent('download');
    await page.getByRole('link',{name,exact:true}).click();
    await (await event).saveAs(path);
  };
  const inputPath=join(fixture,'exported-volume.nii'),requestPath=join(fixture,'request.json');
  await download('Скачать объём .nii',inputPath);await download('Скачать паспорт .json',requestPath);
  const request=JSON.parse(await readFile(requestPath,'utf8')),data=await readFile(inputPath);
  assert.deepEqual(request.geometry.dimensions,[64,64,32]);assert.equal(request.frameCount,32);
  assert.equal(request.inputSha256,createHash('sha256').update(data).digest('hex'));
  assert.equal(data.length,352+64*64*32*4);assert.equal(data.readInt16LE(70),16);
  // Check every exported voxel against the independently generated phantom in
  // physical LPS coordinates, including Cornerstone's possible reversed z axis.
  const a=request.geometry.affineLps;
  for(let k=0;k<32;k++)for(let j=0;j<64;j++)for(let i=0;i<64;i++){
    const x=a[0]*i+a[1]*j+a[2]*k+a[3],y=a[4]*i+a[5]*j+a[6]*k+a[7],z=a[8]*i+a[9]*j+a[10]*k+a[11];
    const inner=(x-9)**2+(y+2)**2+z*z<36,outer=x*x+y*y+z*z<256;
    const expected=inner?1400:outer?Math.round(850+200*x/16):0;
    assert.equal(data.readFloatLE(352+4*(i+64*(j+64*k))),expected,`export voxel ${i}/${j}/${k}`);
  }
  await writeFile(join(fixture,'labels.json'),JSON.stringify([{id:1,name:'Synthetic sphere'},{id:2,name:'Synthetic insert'}]));
  await writeFile(join(fixture,'synthetic-weights.test'),'SYNTHETIC ARTIFACT - NOT MODEL WEIGHTS');
  const resultPath=join(fixture,'model-result.json');
  execFileSync('python3',[join(root,'scripts/package-segmentation-result.py'),
    '--request',requestPath,'--input',inputPath,'--mask',join(fixture,'synthetic-mask.nii'),
    '--weights-artifact',join(fixture,'synthetic-weights.test'),'--model-id','synthetic-fixture-only','--model-version','1','--model-modality','MR',
    '--task','geometry-test-only','--labels',join(fixture,'labels.json'),'--output',resultPath,
    '--limitation','Synthetic reference mask; no model inference was performed.'],{stdio:'pipe'});
  const resultUpload=page.locator('input[accept=".json,.nii,.nii.gz"]');
  await resultUpload.setInputFiles([join(fixture,'synthetic-mask.nii'),resultPath]);
  await page.locator('.ora-mask-provenance').waitFor();
  assert.match(await page.locator('.ora-mask-provenance').innerText(),/synthetic-fixture-only/);
  assert.match(await page.locator('.ora-mask-settings select').innerText(),/Synthetic sphere/);
  const invalid=JSON.parse(await readFile(resultPath,'utf8'));invalid.requestId='22222222-2222-4222-8222-222222222222';
  const wrongPath=join(fixture,'wrong-result.json');await writeFile(wrongPath,JSON.stringify(invalid));
  await resultUpload.setInputFiles([join(fixture,'synthetic-mask.nii'),wrongPath]);
  await page.locator('.ora-mask-error').waitFor();
  assert.match(await page.locator('.ora-mask-error').innerText(),/другому пакету.*Предыдущая маска сохранена/);
  assert.match(await page.locator('.ora-mask-provenance').innerText(),/synthetic-fixture-only/);
  await page.locator('.ora-mpr').screenshot({path:join(results,'segmentation-mpr.png')});
  const before=await page.locator('.ora-mpr-axial .ora-mpr-controls label').innerText();
  await page.locator('.ora-mpr-axial .ora-mpr-controls button').last().click();
  const after=await page.locator('.ora-mpr-axial .ora-mpr-controls label').innerText();
  assert.notEqual(before,after);
  await page.getByRole('button',{name:'3D · Объём',exact:true}).click();
  await page.getByRole('button',{name:'MIP · максимум',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='MIP · максимум'&&!b.disabled));
  await page.getByRole('button',{name:'MIP · максимум',exact:true}).click();
  await page.getByRole('button',{name:'Объём · прозрачность',exact:true}).click();
  await page.getByRole('button',{name:'Развернуть 3D',exact:true}).click();
  assert.equal(await page.locator('.ora-mpr-3d-panel.expanded').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ora-mpr-3d-panel.expanded').count(),0);
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.locator('.cs-stack').waitFor();
  assert.equal(await page.locator('.ora-mpr-mask-overlay').count(),0);
  await mpr.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Подготовить пакет серии'&&!b.disabled));
  assert.equal(await page.locator('.ora-package-ready').count(),0);
  assert.equal(await page.locator('.ora-mask-provenance').count(),0);
  assert.equal(await page.locator('.ora-mask-success').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: overlays, volumes, full scalar NIfTI export (all voxels), checksummed model-result handoff, wrong-package rejection, 3D/MIP controls and resource reset on 2D/MPR. No real model inference performed.');
}catch(e){console.error('FAIL:',e);console.error('PAGE ERRORS:',errors);console.error('SERVER:',logs);if(page){console.error('ALERTS:',await page.locator('[role=alert]').allTextContents());await page.screenshot({path:join(results,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await rm(fixture,{recursive:true,force:true});}
