/** Real paid evaluation of TWO independent published 2D CT cases.
 * Uses current local signed-session API and production review/synthesis helpers.
 * Never reads provider keys. Masks, case index, source dataset name and diagnosis
 * are NEVER sent to models. Not a whole-study or clinical-accuracy acceptance.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
import {windowDecodedPlane} from '../web/lib/decoded-vision-preview.ts';
import {pairReviewWindows} from '../web/lib/review-window-pair.ts';
import {createPrivacyFrame,markPrivacyReview,buildVisionPrivacyPacket} from '../web/lib/vision-privacy.ts';
import {planBudgetedVisionReview} from '../web/lib/vision-budget-plan.ts';
import {createVisionBatches} from '../web/lib/vision-batch-ledger.ts';
import {appendGeminiVolumeReceipt,makeSafeVolumeOpusInput} from '../web/lib/full-volume-receipts.ts';
import {selectTargetedVisualInput} from '../web/lib/opus-targeted-visual-review.ts';
const [mode,sourceArg,outputArg]=process.argv.slice(2);
assert.ok(['--prepare-pngs','--execute-paid-reviewed-case-pngs'].includes(mode));
const source=resolve(sourceArg??'');assert.ok(source.startsWith('/tmp/')||source.startsWith('/private/tmp/'));
const manifest=JSON.parse(await readFile(join(source,'cases.json'),'utf8'));
assert.equal(manifest.revision,'c4b975090c16fabe59079a528dd920d956e16c66');
assert.equal(manifest.license,'ODC-By 1.0');assert.deepEqual(manifest.cases.map(c=>c.sourceSliceIndex),[0,40]);
const expectedPng=['4eca865b61cb7bdb8758427898def17f34fae733e6e5c4b262a6523c7edb1ec7','4b5ef6a6ba34d8921165715143806196d1faf188fcc3cecd977ce5f4f1aa23cb'];
const digest=b=>createHash('sha256').update(b).digest('hex');
function chunk(name,payload){
 const tag=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(payload.length);
 let c=0xffffffff;for(const b of Buffer.concat([tag,payload])){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([len,tag,payload,crc]);
}
function png(pixels,width,height){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)rows.set(pixels.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
if(mode==='--prepare-pngs'){
 const prepared=[];
 for(const [index,c] of manifest.cases.entries()){
  assert.equal(c.width,512);assert.equal(c.height,512);
  const bytes=await readFile(join(source,c.valuesFile));assert.equal(digest(bytes),c.valuesSha256);assert.equal(bytes.length,512*512*4);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),values=new Float32Array(512*512);
  for(let i=0;i<values.length;i++)values[i]=v.getFloat32(i*4,true);
  const left=windowDecodedPlane(values,512,512,1048576,1,0,-600,1500,false);
  const right=windowDecodedPlane(values,512,512,1048576,1,0,40,350,false);
  const pair=pairReviewWindows(left,right,512,512,1048576),out=png(pair.pixels,pair.width,pair.height);
  const f=createPrivacyFrame(out,'frame-1','CT');assert.equal(f.sha256,expectedPng[index],'Pinned public source rendering required');
  await writeFile(join(source,c.caseId+'.png'),out,{mode:0o600});
  prepared.push({caseId:c.caseId,pngSha256:f.sha256,width:f.width,height:f.height});
 }
 await writeFile(join(source,'prepared.json'),JSON.stringify(prepared,null,2));
 console.log(JSON.stringify({stage:'prepared-for-visual-review',frames:prepared,providerCalls:0}));process.exit(0);
}
const output=resolve(outputArg??'');assert.ok(output.startsWith('/tmp/')||output.startsWith('/private/tmp/'));
await mkdir(output,{mode:0o700}); // Collision stops accidental repeat billing.
const review=JSON.parse(await readFile(join(source,'reviewed-pngs.json'),'utf8'));
assert.equal(review.explicitVisualReview,true);assert.equal(review.patientData,false);
const prepared=JSON.parse(await readFile(join(source,'prepared.json'),'utf8'));
const base='http://localhost:3000';
const browser=await chromium.launch({headless:true,...(process.env.OPUS_BROWSER_EXECUTABLE?{executablePath:process.env.OPUS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
let attempted=0;
try{
 const page=await browser.newPage();await page.goto(base+'/guide');
 const ready=await page.evaluate(async()=>{const r=await fetch('/api/ai/deidentified-openrouter-review',{cache:'no-store',credentials:'same-origin'});return r.ok?await r.json():null;});
 assert.ok(ready?.enabled&&ready?.workstationConnected,'Existing approved workstation required');
 async function post(path,body,caseId){
  attempted++;await writeFile(join(output,'attempt-'+attempted+'.json'),JSON.stringify({path,caseId,startedAt:new Date().toISOString()}));
  const began=Date.now();
  const response=await page.evaluate(async({path,body})=>{
   const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(295000)});
   return {status:r.status,data:await r.json()};
  },{path,body});
  await writeFile(join(output,caseId+'-'+(path.includes('gemini')?'gemini':'opus')+'.json'),JSON.stringify(response,null,2),{mode:0o600});
  console.log(JSON.stringify({stage:'actual-provider-response',caseId,path,status:response.status,seconds:(Date.now()-began)/1000}));
  assert.equal(response.status,200,'No automatic paid retry; partial response preserved');
  return response.data;
 }
 for(const [i,c] of manifest.cases.entries()){
  const bytes=await readFile(join(source,c.caseId+'.png'));const f=createPrivacyFrame(bytes,'frame-1','CT');
  assert.equal(f.sha256,expectedPng[i]);assert.equal(f.sha256,prepared[i].pngSha256);assert.ok(review.reviewedSha256.includes(f.sha256),'Exact outgoing PNG must be visually reviewed');
  const frame=markPrivacyReview(markPrivacyReview(f,'pixel',true),'visual',true),packet=buildVisionPrivacyPacket([frame],crypto.randomUUID());
  // No filenames, dataset diagnosis, source index, annotation or model evidence.
  const gemini=await post('/api/ai/approved-volume-gemini-batch',{
   packet,acknowledgeClinicianLawfulDisclosure:true,acknowledgeProviderHealthDataTerms:true,acknowledgePixelIdentityReviewed:true,acknowledgeOnePaidGeminiBatch:true,
   frameContext:{totalFrames:1,sliceNumbers:[1],technical:{region:'CHEST',sliceSpacingMm:null,pixelSpacingMm:null,contrast:'UNKNOWN',phase:'UNKNOWN',mrWeighting:'UNKNOWN',mrSequenceCodes:[],window:'LUNG',additionalWindow:'SOFT'}},
  },c.caseId);
  const plan=planBudgetedVisionReview({frameCount:1,maxGeminiUSD:0.5}),batches=createVisionBatches(plan,4);
  const receipts=appendGeminiVolumeReceipt([],batches,0,gemini);
  const synthesis=makeSafeVolumeOpusInput('CT',plan,batches,receipts);
  synthesis.limitations=[...synthesis.limitations.slice(0,27),'Only ONE independent 2D chest CT slice was supplied, not a whole CT study or contiguous series.',
   'Patient orientation, spacing, contrast and prior examination are unknown; physical measurements and full-study negative conclusions are unsupported.',
   'Each image contains the SAME slice twice: lung window on the left, soft-tissue window on the right.'];
  const visual=selectTargetedVisualInput([packet],receipts);
  if(visual)visual.windows={primary:'LUNG',additional:'SOFT'};
  const result=await post('/api/ai/complete-volume-opus',visual?{synthesis,visualReview:visual}:synthesis,c.caseId);
  await writeFile(join(output,c.caseId+'-report.txt'),result.finalReport,{mode:0o600});
  console.log(JSON.stringify({stage:'case-completed',caseId:c.caseId,geminiReceipt:gemini.receipt,finalOpusReceipt:result.receipt,visualReview:result.visualReview?.status??'not-requested',visualReceipt:result.visualReview?.receipt??null}));
 }
 await writeFile(join(output,'completion.json'),JSON.stringify({completedCases:2,actualLocalApiPostAttempts:attempted,masksSent:false,referenceReadByRunner:false,providerResponsesMocked:false,requestedModels:ready.models},null,2));
}catch(e){console.error('Stopped without automatic retry:',e.message);process.exitCode=1;}finally{await browser.close();}
