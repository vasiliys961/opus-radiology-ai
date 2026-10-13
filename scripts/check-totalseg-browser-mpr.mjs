/** Real five-lobe TotalSegmentator NIfTI slab over original public LCTSC DICOM in MPR. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve,relative,dirname,isAbsolute,sep} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
const arg=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error('missing argument');return args[i+1];};
const reference=resolve(arg('--reference')), mask=resolve(arg('--mask'));
const proof=resolve(arg('--slab-manifest')), report=resolve(arg('--report'));
const outside=p=>{const x=relative(root,p);return x==='..'||x.startsWith('..'+sep)||isAbsolute(x);};
assert.ok([reference,mask,proof,report].every(outside));
assert.ok(outside(await realpath(dirname(report))));
try{await lstat(report);throw Error('existing report');}catch(e){if(e.code!=='ENOENT')throw e;}
const full=JSON.parse(await readFile(join(reference,'reference.json'),'utf8'));
const slab=JSON.parse(await readFile(proof,'utf8'));
assert.equal(full.schema,'opus-r231-browser-reference/v1');
assert.equal(full.sourceContentChainSha256,'bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61');
assert.equal(full.allSourceFrames,true);
assert.deepEqual(full.dimensions,[512,512,103]);
assert.equal(slab.schema,'opus-totalseg-native-mpr-slab/v1');
assert.equal(slab.sourceFullCtSha256,'99615ddb66e09bd46c2ff70c352d73414285145b358e448682b7cffc41249738');
assert.equal(slab.readyForClinicalUse,false);
assert.equal(slab.sourceGridGeometry,'native_contiguous_unresampled');
assert.deepEqual(slab.sourceDimensions,[512,512,103]);
assert.deepEqual(slab.slabDimensions,[512,512,32]);
assert.equal(slab.firstOriginalSliceIndexZeroBased,35);
assert.equal(slab.lastOriginalSliceIndexZeroBased,66);
const data=await readFile(mask);
assert.equal(data.length,352+512*512*32);
assert.equal(createHash('sha256').update(data).digest('hex'),slab.slabMaskSha256);
assert.equal(data.readInt32LE(0),348);
assert.deepEqual([data.readInt16LE(42),data.readInt16LE(44),data.readInt16LE(46)],[512,512,32]);
assert.deepEqual([data.readInt16LE(70),data.readInt16LE(72)],[2,8]);
assert.equal(data[123]&7,2);
const totals=new Map([10,11,12,13,14].map(id=>[id,0]));
for(const id of data.subarray(352)){
  assert.ok(id===0||totals.has(id),'unexpected label');
  if(id)totals.set(id,totals.get(id)+1);
}
for(const item of slab.labelVoxels){
  assert.ok(totals.has(item.id));
  assert.equal(item.voxels,totals.get(item.id));
}
assert.ok([...totals.values()].every(v=>v>0));
const files=[];
for(let n=35;n<=66;n++){
  const path=join(reference,'dicom','reference-'+String(n).padStart(3,'0')+'.dcm');
  const pixels=await readFile(path);
  assert.equal(createHash('sha256').update(pixels).digest('hex'),full.selectedFileSha256[n]);
  files.push(path);
}
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
const freePort=()=>new Promise((ok,fail)=>{
  const srv=net.createServer();srv.once('error',fail);
  srv.listen(0,'127.0.0.1',()=>{const p=srv.address().port;srv.close(()=>ok(p));});
});
const origin='http://127.0.0.1:'+(await freePort());
let web,browser,page,stage='launch';
const browserFlags=[];
const stop=async child=>{
  if(!child||child.exitCode!==null)return;
  const done=once(child,'exit');child.kill('SIGTERM');
  if(await Promise.race([done.then(()=>true),delay(10000).then(()=>false)]))return;
  child.kill('SIGKILL');await done;
};
try{
  stage='start-web';
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',origin.split(':').at(-1)],{
    cwd:join(root,'web'),stdio:'ignore'});
  let ready=false;
  for(let i=0;i<150;i++){
    try{if((await fetch(origin)).ok){ready=true;break;}}catch{}
    await delay(200);
  }
  assert.ok(ready,'web not ready');
  stage='launch-browser';
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(120000);
  page.on('pageerror',()=>browserFlags.push('error'));
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).origin!==origin){
      browserFlags.push('external');return route.abort();
    }
    return route.continue();
  });
  stage='load-original-dicom';
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator('input[accept*=".dcm"]').setInputFiles(files);
  stage='open-mpr';
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='MPR · 3 плоскости'&&!b.disabled));
  await page.getByRole('button',{name:'MPR · 3 плоскости',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Загрузить маску .nii / .nii.gz'&&!b.disabled));
  stage='load-real-mask';
  await page.locator('.ora-mask-controls input[accept*=".nii"]').setInputFiles(mask);
  await page.locator('.ora-mask-success').waitFor({timeout:120000});
  assert.match(await page.locator('.ora-mask-success').innerText(),/Сетка совмещена/);
  assert.match(await page.locator('.ora-mask-coverage').innerText(),/не подтверждена/);
  stage='verify-three-planes';
  await page.waitForFunction(()=>{
    const canvases=[...document.querySelectorAll('.ora-mpr-mask-overlay')];
    return canvases.length===3&&canvases.every(c=>{
      const ctx=c.getContext('2d');if(!ctx||!c.width||!c.height)return false;
      const rgba=ctx.getImageData(0,0,c.width,c.height).data;
      for(let i=3;i<rgba.length;i+=4)if(rgba[i]>0)return true;
      return false;
    });
  },undefined,{timeout:120000});
  const pixels=await page.locator('.ora-mpr-mask-overlay').evaluateAll(canvases=>canvases.map(c=>{
    const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let found=0;for(let i=3;i<rgba.length;i+=4)if(rgba[i]>0)found++;
    return found;
  }));
  assert.equal(browserFlags.length,0);
  const result={schema:'opus-totalseg-browser-real-mpr/v1',status:'passed',
    sourceFullCtSha256:slab.sourceFullCtSha256,sourceFullMaskSha256:slab.sourceFullMaskSha256,
    slabMaskSha256:slab.slabMaskSha256,sourceIndices:[35,66],
    nonemptyLobeIds:[...totals].filter(([,n])=>n>0).map(([id])=>id),
    overlayPixels:pixels,threePlanesPassed:true,externalBrowserNetwork:false,
    clinicalDice:null,readyForClinicalUse:false};
  await writeFile(report,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));
}catch{
  const failure={schema:'opus-totalseg-browser-real-mpr/v1',
    status:'failed',stage,browserFlags:browserFlags.length>0,readyForClinicalUse:false};
  await writeFile(report,JSON.stringify(failure,null,2),{flag:'wx',mode:0o600}).catch(()=>{});
  console.log(JSON.stringify(failure));
  process.exitCode=2;
}finally{
  await browser?.close().catch(()=>{});
  await stop(web);
}
