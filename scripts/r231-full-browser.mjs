/** Full supplied public CT acceptance. No model mocks or full native mask allocation. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export function fullMaskHeader(inputHeader) {
  assert.equal(inputHeader.length,352);
  assert.equal(inputHeader.readInt16LE(70),16);assert.equal(inputHeader.readInt16LE(72),32);
  const header=Buffer.from(inputHeader);header.writeInt16LE(2,70);header.writeInt16LE(8,72);return header;
}

export function inspectSlab(bytes, encodedProof, request, result, start, count) {
  assert.ok(encodedProof && encodedProof.length <= 8192);
  const proof=JSON.parse(Buffer.from(encodedProof,'base64').toString('utf8'));
  const affine=[...request.geometry.affineLps];
  for(let row=0;row<3;row++)affine[row*4+3]+=affine[row*4+2]*start;
  const dimensions=[512,512,count];
  assert.equal(proof.schema,'opus-full-ct-slab/v1');
  for(const key of ['requestId','sourceIdentitySha256','inputSha256'])assert.equal(proof[key],request[key]);
  assert.equal(proof.fullMaskSha256,result.maskSha256);
  assert.equal(proof.start,start);assert.equal(proof.count,count);assert.equal(proof.sourceFrameCount,103);
  assert.deepEqual(proof.geometry,{dimensions,affineLps:affine});
  assert.equal(bytes.length,352+512*512*count);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),proof.slabMaskSha256);
  assert.equal(bytes.readInt32LE(0),348);assert.equal(bytes.subarray(344,348).toString(),'n+1\0');
  assert.deepEqual([42,44,46].map(n=>bytes.readInt16LE(n)),dimensions);
  assert.equal(bytes.readInt16LE(70),2);assert.equal(bytes.readInt16LE(72),8);
  for(let i=0;i<12;i++)assert.ok(Math.abs(bytes.readFloatLE(280+4*i)-(i<8?-affine[i]:affine[i]))<0.0001);
  const counts=[0,0,0];for(const label of bytes.subarray(352)){assert.ok(label<=2);counts[label]++;}
  return {proof,counts};
}

export async function verifyFullBrowser({page,workerOrigin,token,manifest,observed,setStage}) {
  const panel=page.locator('details[aria-label="Полная КТ через локальный R231"]');
  setStage('full-r231-open-panel');await panel.waitFor();
  if(!await panel.evaluate(n=>n.open))await panel.locator('summary').click();
  await panel.getByLabel('Адрес полного локального worker',{exact:true}).fill(workerOrigin);
  await panel.getByLabel('Токен полного локального задания',{exact:true}).fill(token);
  await panel.getByRole('checkbox').check();
  setStage('full-r231-job');await panel.getByRole('button',{name:'Обработать всю КТ локально',exact:true}).click();
  await Promise.race([
    panel.getByRole('button',{name:'Скачать Evidence полной КТ',exact:true}).waitFor({timeout:900000}),
    panel.locator('[role=alert]').waitFor({timeout:900000}).then(()=>{throw Error('Full worker/UI rejected reference');}),
  ]);
  const state=observed();assert.ok(state.outputStatus && !state.deleted);
  const {request,outputStatus}=state,result=outputStatus.result;
  setStage('full-r231-binding');assert.equal(request.schema,'opus-analysis-request/v2');
  assert.equal(request.frameCount,103);assert.deepEqual(request.geometry.dimensions,[512,512,103]);
  const candidate=manifest.niftiCandidates.find(c=>c.inputSha256===request.inputSha256);assert.ok(candidate);
  request.geometry.affineLps.forEach((n,i)=>assert.ok(Math.abs(n-candidate.affineLps[i])<0.00001));
  for(const k of ['requestId','sourceIdentitySha256','inputSha256'])assert.equal(result[k],request[k]);
  assert.equal(result.model.id,'lungmask-R231');assert.equal(result.model.version,'0.2.20');
  assert.equal(result.model.weightsSha256,'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f');
  assert.equal(outputStatus.metrics.inferenceImplementation,'full-ct-streamed-r231/v2');
  assert.ok(outputStatus.metrics.inferenceSeconds>0 && outputStatus.metrics.peakRssMiB>0);
  assert.equal(result.fullVolume.coverage,'all-supplied-frames');
  assert.deepEqual(result.fullVolume.dimensions,request.geometry.dimensions);
  assert.ok(result.fullVolume.labelVoxels.every(n=>Number.isSafeInteger(n)&&n>0));
  setStage('full-r231-evidence');
  const downloadPromise=page.waitForEvent('download');
  await panel.getByRole('button',{name:'Скачать Evidence полной КТ',exact:true}).click();
  const download=await downloadPromise,stream=await download.createReadStream();let text='';
  for await(const chunk of stream){text+=chunk;assert.ok(text.length<65536);}
  const evidence=JSON.parse(text);await download.delete();
  assert.equal(evidence.schema,'opus-full-ct-evidence/v1');assert.equal(evidence.clinicalStatus,'unverified_research_draft');
  assert.deepEqual(evidence.request,request);assert.equal(evidence.result.maskSha256,result.maskSha256);
  assert.deepEqual(evidence.observations.map(o=>o.voxels),result.fullVolume.labelVoxels);
  assert.ok(!text.includes(token)&&!text.includes(workerOrigin));
  const slabPanel=page.getByRole('region',{name:'Фрагмент КТ для MPR и локального AI',exact:true});
  const fullHash=createHash('sha256'),counts=[0,0,0],slabs=[];
  // Every mask voxel is independently checked once, in native order, without
  // keeping a full mask. At most one <=32-frame crop and one MPR are resident.
  for(const [start,count] of [[0,32],[32,32],[64,32],[96,7]]) {
    setStage(`full-r231-mpr-${start}-${count}`);
    await page.getByRole('button',{name:'2D',exact:true}).click();
    await page.locator('.ora-mpr').waitFor({state:'detached'});
    await slabPanel.getByLabel('Первый срез фрагмента КТ',{exact:true}).fill(String(start+1));
    await slabPanel.getByLabel('Последний срез фрагмента КТ',{exact:true}).fill(String(start+count));
    await slabPanel.getByRole('button',{name:'Открыть фрагмент в MPR',exact:true}).click();
    const show=page.getByRole('button',{name:'Показать маску полного задания для этого фрагмента',exact:true});
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Показать маску полного задания для этого фрагмента'&&!b.disabled));
    const replyPromise=page.waitForResponse(r=>r.url()===`${workerOrigin}/v1/jobs/${state.jobId}/mask-slab`&&r.request().method()==='POST');
    await show.click();const reply=await replyPromise;assert.equal(reply.status(),200);
    const received=observed().slabReply;assert.ok(received);
    const bytes=received.bytes;const {proof,counts:local}=inspectSlab(bytes,received.proof,request,result,start,count);
    assert.equal(proof.jobId,state.jobId);
    if(start===0)fullHash.update(fullMaskHeader(state.inputHeader));
    fullHash.update(bytes.subarray(352));local.forEach((n,i)=>counts[i]+=n);
    await page.locator('.ora-mask-success').waitFor();
    if(local[1]+local[2]>0) {
      // Move through actual controls to an occupied native plane. The default
      // sagittal midline can legitimately contain no lung labels.
      let remaining=Math.floor((local[1]+local[2])/2),at=352;
      for(;at<bytes.length;at++)if(bytes[at]&&remaining--===0)break;
      const voxel=at-352,indices={axial:Math.floor(voxel/(512*512)),coronal:Math.floor(voxel/512)%512,sagittal:voxel%512};
      for(const plane of ['axial','coronal','sagittal']) {
        setStage(`full-r231-navigation-${start}-${plane}`);
        const slider=page.locator(`#ora-mpr-slider-${plane}`),maximum=Number(await slider.getAttribute('max'));
        for(const index of [indices[plane],maximum-indices[plane]]) {
          await slider.evaluate((node,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,String(v));node.dispatchEvent(new Event('input',{bubbles:true}));},index);
          const visible=await page.waitForFunction(p=>{
            const c=document.querySelector(`#ora-mpr-slider-${p}`).closest('.ora-mpr-plane').querySelector('.ora-mpr-mask-overlay');
            return c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);
          },plane,{timeout:3000}).then(()=>true,()=>false);
          if(visible)break;
        }
      }
    }
    // Empty peripheral planes are legitimate. Verify the rendered alpha count
    // separately from nonempty whole-series labels; never call background normal.
    await page.waitForFunction(()=>document.querySelectorAll('.ora-mpr-mask-overlay').length===3);
    const overlayPixels=await page.locator('.ora-mpr-mask-overlay').evaluateAll(cs=>cs.map(c=>{
      const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<a.length;i+=4)if(a[i])n++;return n;
    }));
    slabs.push({start,count,slabMaskSha256:proof.slabMaskSha256,labelVoxels:local,overlayPixels});
  }
  setStage('full-r231-complete-mask-sha');assert.equal(fullHash.digest('hex'),result.maskSha256);
  setStage('full-r231-complete-label-counts');assert.deepEqual(counts.slice(1),result.fullVolume.labelVoxels);
  setStage('full-r231-visible-overlay');assert.ok(slabs.some(s=>s.overlayPixels.every(n=>n>0)),'At least one native range must display nonempty overlays in all planes');
  setStage('full-r231-delete');await panel.getByRole('button',{name:'Удалить полное задание и маску',exact:true}).click();
  await panel.getByText('Полное задание удалено.',{exact:true}).waitFor();
  await page.locator('.ora-mask-success').waitFor({state:'detached'});
  assert.equal(observed().fullMaskGets,0);
  return {counts,slabs};
}
