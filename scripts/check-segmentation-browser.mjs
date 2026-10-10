import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
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
  assert.match(await page.locator('.ora-mpr-volume-stats').innerText(),/0\.3 МиБ/);
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
  assert.deepEqual(errors,[]);
  console.log('PASS: phantom import, all three overlays, exact label volumes, hide/show, wrong-grid rejection, slice navigation, 3D/MIP controls and return to 2D.');
}catch(e){console.error('FAIL:',e);console.error('PAGE ERRORS:',errors);console.error('SERVER:',logs);if(page){console.error('ALERTS:',await page.locator('[role=alert]').allTextContents());await page.screenshot({path:join(results,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await rm(fixture,{recursive:true,force:true});}
