import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readdir, mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {chromium}=require('playwright');
const fixture=await mkdtemp(join(tmpdir(),'opus-browser-phantom-'));
const results=join(root,'web/browser-results');
await mkdir(results,{recursive:true});
execFileSync(process.execPath,[join(root,'scripts/generate-segmentation-phantom.mjs'),fixture],{stdio:'pipe'});
const port=await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(()=>resolve(address.port));});});
const baseUrl=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root+'/web',stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
let browser,page;const errors=[];
try {
  for(let i=0;i<80;i++) {
    try {const r=await fetch(baseUrl);if(r.ok)break;}catch{}
    if(i===79)throw new Error('Server not ready: '+logs);
    await new Promise(r=>setTimeout(r,250));
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  const computeModes=await page.locator('.ora-ai-compute-modes').innerText();
  assert.match(computeModes,/На Mac · ONNX CPU/);
  assert.match(computeModes,/Облако · OpenRouter/);
  assert.match(computeModes,/настоящих пациентских изображений.*заблокирована/s);

  // In production, even a same-origin read-only provider probe remains closed.
  // API credentials, DICOM and clinical context are never exposed.
  const readinessResponse=await page.request.get(
    baseUrl+'/api/ai/provider-readiness?provider=openrouter');
  assert.equal(readinessResponse.status(),404);
  assert.doesNotMatch(await readinessResponse.text(),/OPENROUTER_API_KEY|secret|sk-/);
  const blockedUpload=await page.request.post(baseUrl+'/api/ai',{
    data:{provider:'openrouter',role:'vision',model:'never-forward',messages:[
      {role:'user',content:'nonclinical sentinel'}
    ]},
  });
  assert.equal(blockedUpload.status(),410);
  assert.match(await blockedUpload.text(),/disabled/);
  const deniedSyntheticDemo=await page.request.post(
    baseUrl+'/api/ai/synthetic-demo',{
      headers:{origin:baseUrl,'content-type':'application/json',
        'sec-fetch-site':'same-origin'},
      data:{
        modality:'MR',region:'head',visionModel:'google/fixture',
        clinicalModel:'openai/fixture',acknowledgePaidSyntheticExperiment:true,
      },
    });
  assert.equal(deniedSyntheticDemo.status(),404);
  assert.doesNotMatch(await deniedSyntheticDemo.text(),/OPENROUTER_API_KEY|secret|sk-/);
  const deniedPhantomPreview=await page.request.get(
    baseUrl+'/api/ai/synthetic-demo/preview?region=head&modality=MR&frame=0');
  assert.equal(deniedPhantomPreview.status(),404);


  await page.getByRole('button',{name:'Проверить Polza',exact:true}).click();
  await page.locator('.ora-provider-error').waitFor();
  assert.match(await page.locator('.ora-provider-error').innerText(),/только на localhost/);
  console.log('Provider readiness remains closed in production and gives a visible safe fallback');
  // The preferred four-model profile is selected once, reused by both gateway
  // probes/trials and never replaced by alphabetic catalogue entries. All APIs mocked.
  const visionChoice=page.locator('#ora-vision-choice'),judgeChoice=page.locator('#ora-clinical-choice');
  assert.deepEqual(await visionChoice.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['google/gemini-3.8-flash']);
  const judges=['openai/gpt-6.1-sol','anthropic/claude-sonnet-5.5','anthropic/claude-opus-5.5'];
  assert.deepEqual(await judgeChoice.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),judges);
  const catalogueModel=id=>({id,name:id,acceptsImages:true,acceptsText:true,producesText:true});
  let missingPreferred=false;const trialSubmissions=[];
  await page.route('**/api/ai/provider-readiness?provider=*',route=>{
    const provider=new URL(route.request().url()).searchParams.get('provider');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      schema:'opus-provider-readiness/v1',provider,keyConfigured:true,catalogStatus:'verified-response',
      vision:{modelId:null,configured:false,inCatalogue:null,matchingModality:null},
      clinical:{modelId:null,configured:false,inCatalogue:null,matchingModality:null},
      suggestions:{vision:missingPreferred?[]:[catalogueModel('google/gemini-3.8-flash')],clinical:judges.map(catalogueModel)},
      notes:[],patientImagesAllowed:false,inferenceAllowed:false,
    })});
  });
  await page.route('**/api/ai/synthetic-demo/preview?*',route=>route.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1cAAAAASUVORK5CYII=','base64')}));
  await page.route('**/api/ai/synthetic-demo',route=>{
    trialSubmissions.push(route.request().postDataJSON());
    return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Synthetic fixture: no paid inference performed'})});
  });
  for(const [provider,judge] of [['polza','anthropic/claude-opus-5.5'],['openrouter','openai/gpt-6.1-sol']]){
    await page.locator('#ora-provider-choice').selectOption(provider);await judgeChoice.selectOption(judge);
    const gateway=provider==='polza'?'Polza':'OpenRouter';
    await page.getByRole('button',{name:'Проверить '+gateway,exact:true}).click();
    const trial=page.getByRole('region',{name:'Эксперимент '+gateway+' с искусственными изображениями',exact:true});
    await trial.waitFor();assert.equal(await trial.locator('select').count(),2); // region/modality only; no second model picker
    assert.match(await trial.innerText(),new RegExp(judge.replaceAll('.','\\.')));
    const cost=trial.locator('#ora-synthetic-cost-ack');await cost.check();
    await trial.getByRole('button',{name:'Запустить реальный '+gateway+'-тест',exact:true}).click();
    await trial.getByRole('alert').waitFor();
    assert.deepEqual(trialSubmissions.at(-1),{provider,modality:'CT',region:'chest',visionModel:'google/gemini-3.8-flash',clinicalModel:judge,acknowledgePaidSyntheticExperiment:true});
  }
  // Changing evaluator cancels an outstanding request; a late old response
  // cannot be shown under the new selection and cost acknowledgement is reset.
  await page.unroute('**/api/ai/synthetic-demo');let releaseOldResponse;
  await page.route('**/api/ai/synthetic-demo',async route=>{
    trialSubmissions.push(route.request().postDataJSON());
    await new Promise(resolve=>{releaseOldResponse=resolve;});
    await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'STALE-EVALUATOR-RESPONSE'})}).catch(()=>{});
  });
  const pendingTrial=page.getByRole('region',{name:'Эксперимент OpenRouter с искусственными изображениями',exact:true});
  await pendingTrial.getByRole('button',{name:'Запустить реальный OpenRouter-тест',exact:true}).click();
  await pendingTrial.getByRole('button',{name:'Отменить тест',exact:true}).waitFor();
  await judgeChoice.selectOption('anthropic/claude-sonnet-5.5');
  await pendingTrial.getByRole('button',{name:'Отменить тест',exact:true}).waitFor({state:'detached'});
  assert.equal(await pendingTrial.locator('#ora-synthetic-cost-ack').isChecked(),false);
  releaseOldResponse?.();assert.doesNotMatch(await pendingTrial.innerText(),/STALE-EVALUATOR-RESPONSE/);
  missingPreferred=true;await page.getByRole('button',{name:'Проверить OpenRouter',exact:true}).click();
  const absentTrial=page.getByRole('region',{name:'Эксперимент OpenRouter с искусственными изображениями',exact:true});
  await absentTrial.getByText(/Другая модель автоматически не выбирается/).waitFor();
  await absentTrial.locator('#ora-synthetic-cost-ack').check();
  assert.equal(await absentTrial.getByRole('button',{name:'Запустить реальный OpenRouter-тест',exact:true}).isDisabled(),true);
  assert.equal(await visionChoice.inputValue(),'google/gemini-3.8-flash');assert.equal(trialSubmissions.length,3);
  await page.unroute('**/api/ai/provider-readiness?provider=*');await page.unroute('**/api/ai/synthetic-demo/preview?*');await page.unroute('**/api/ai/synthetic-demo');
  await page.locator('#ora-provider-choice').selectOption('polza');await judgeChoice.selectOption('anthropic/claude-sonnet-5.5');
  console.log('Preferred model profile: exact Gemini + chosen evaluator, both gateways, no duplicate picker, missing-model refusal without downgrade and paid HTTP requests mocked');
  const files=(await readdir(fixture+'/dicom')).sort().map(n=>fixture+'/dicom/'+n);
  // Deliberately fake identifiers in a preamble/private tag. No real PHI.
  const phiSentinel='SYNTHETIC-PHI-REMOVE-ME',dirtyDicom=await readFile(files[0]);
  dirtyDicom.write(phiSentinel,0,'ascii');
  const privateValue=Buffer.from(phiSentinel+' '),privateHeader=Buffer.alloc(8);
  privateHeader.writeUInt16LE(0x0029);privateHeader.writeUInt16LE(0x1001,2);privateHeader.write('LO',4,'ascii');
  privateHeader.writeUInt16LE(privateValue.length,6);
  const pixelTagAt=dirtyDicom.length-64*64*2-12;
  await writeFile(files[0],Buffer.concat([dirtyDicom.subarray(0,pixelTagAt),privateHeader,privateValue,dirtyDicom.subarray(pixelTagAt)]));
  await page.locator('input[accept*=".dcm"]').setInputFiles(files);
  // Study Intelligence verifies ALL indexed synthetic series without calling AI.
  const intelligence=page.locator('.ora-study-intel');
  await intelligence.getByText('Проиндексировано', {exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.ora-study-intel-stats')
    ?.textContent?.includes('32'),undefined,{timeout:30000});
  assert.match(await intelligence.innerText(),/Полнота анатомического охвата.*не подтверждена/s);
  await intelligence.getByRole('button',{name:'Все серии и протоколы'}).click();
  await intelligence.getByText('Протокол:',{exact:false}).first().waitFor();
  assert.equal(await intelligence.getByRole('button',{name:'Открыть эту серию'}).count(),1);
  await intelligence.getByRole('button',{name:'Открыть эту серию'}).click();
  await intelligence.getByRole('button',{name:'Свернуть анализ'}).click();
  // Generic raw AI uploads must fail even if caller tries to send text or pixels.
  const rawResponseStatus=await page.evaluate(async()=>(await fetch('/api/ai',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({provider:'polza',messages:[{role:'user',content:'patient info'}]}),
  })).status);
  assert.equal(rawResponseStatus,410);
  console.log('Study Intelligence: all series indexed, no completeness claims; raw cloud API disabled');
  // v1.7: a structured AI research result is local-only and must link to
  // the exact SOP instance of this synthetic series before it is navigable.
  await page.waitForFunction(() => {
    const button=document.querySelector('.ora-evidence-actions button');
    return button && !button.disabled;
  },undefined,{timeout:30000});
  const uid='2.25.1043521000001';
  const sampleReview={
    schema:'opus-orchestra/v1',provider:'polza',modality:'MR',
    visionModel:'gemini-fixture-only',clinicalModel:'claude-fixture-only',
    clinicalStatus:'unverified_research_draft',
    sourceImages:[{
      imageId:'phantom-frame-2',seriesUid:uid+'.2',
      sopInstanceUid:uid+'.4.2',frameIndex:0,
      slicePositionMm:-29,mimeType:'image/png',viewLabel:'synthetic phantom 2/32',
    }],
    evidence:{
      schema:'opus-evidence/v1',modality:'MR',coverage:'partially_assessed',
      seriesReviewed:[uid+'.2'],warnings:['Only one synthetic frame assessed'],
      findings:[{
        findingId:'anatomy:synthetic',sign:'Synthetic geometric sphere, not an anatomical finding',
        anatomy:'synthetic phantom',status:'candidate',
        source:{seriesUid:uid+'.2',sopInstanceUid:uid+'.4.2',frameIndex:0,slicePositionMm:-29},
        measurements:{diameterMm:null,volumeMl:null},
        model:{id:'gemini-fixture-only',provider:'polza',version:null},
        limitations:['Mathematical test data only'],
      }],
    },
    clinicalDraft:{summary:'Nonmedical phantom. No patient findings.',limitations:['Synthetic only']},
  };
  const reviewInput=page.getByRole('region',{name:'Врачебная проверка AI-находок',exact:true}).locator('input[type="file"]');
  await reviewInput.setInputFiles({name:'synthetic-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sampleReview))});
  await page.locator('.ora-evidence-success').waitFor();
  assert.match(await page.locator('.ora-evidence-success').innerText(),/DICOM подтверждены/);
  await page.getByRole('button',{name:'Открыть исходный срез',exact:true}).click();
  assert.match(await page.locator('.ora-file-row.ora-file-selected .ora-file-name').innerText(),/synthetic-002\.dcm/);
  const wrongReview=structuredClone(sampleReview);
  wrongReview.evidence.findings[0].source.sopInstanceUid=uid+'.4.999';
  await reviewInput.setInputFiles({name:'wrong-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wrongReview))});
  await page.locator('.ora-evidence-error').waitFor();
  assert.match(await page.locator('.ora-evidence-error').innerText(),/не связана/);
  assert.match(await page.locator('.ora-evidence-success').innerText(),/synthetic-review\.json/);
  console.log('Local AI evidence review: matched SOP, slice navigation, refused forged source');
  // v1.8: a user-enabled WebAudio chime sounds after a successful local
  // Vision-frame manifest. No network images, real AI or patient data involved.
  await page.waitForFunction(() => {
    const button=document.querySelector('.ora-vision-plan-controls button');
    return button && !button.disabled;
  },undefined,{timeout:30000});
  await page.evaluate(() => {
    window.__opusToneStarts=0;
    class FakeAudioContext {
      state='running';currentTime=0;destination={};
      createOscillator(){
        return {
          type:'sine',
          frequency:{setValueAtTime(){}},
          connect(){},disconnect(){},
          start(){window.__opusToneStarts+=1;},
          stop(){},
          onended:null,
        };
      }
      createGain(){
        return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
          connect(){},disconnect(){}};
      }
      resume(){return Promise.resolve();}
      close(){return Promise.resolve();}
    }
    Object.defineProperty(window,'AudioContext',{value:FakeAudioContext,configurable:true});
  });
  await page.locator('.ora-completion-toggle input').check();
  await page.getByRole('button',{name:'Проверить звук · дзинь',exact:true}).click();
  await page.waitForFunction(()=>window.__opusToneStarts===2);
  await page.locator('.ora-vision-plan-controls button').click();
  await page.locator('.ora-vision-plan-result').waitFor();
  assert.equal(await page.locator('.ora-vision-plan-list>div').count(),4);
  await page.locator('.ora-vision-plan-thumbnail').first().waitFor({timeout:20000});
  assert.match(await page.locator('.ora-vision-plan-thumbnail').first().getAttribute('src'),/^data:image\/png;base64,/);
  assert.match(await page.locator('.ora-vision-plan-result').innerText(),/Загрузка изображений в AI:.*заблокирована/s);
  await page.waitForFunction(()=>window.__opusToneStarts===4);
  await page.locator('.ora-vision-plan-list button').nth(1).click();
  assert.match(await page.locator('.ora-file-row.ora-file-selected .ora-file-name').innerText(),/synthetic-011\.dcm/);
  const previousCount=await page.evaluate(()=>window.__opusToneStarts);
  await page.locator('.ora-completion-toggle input').uncheck();
  await page.locator('.ora-vision-plan-controls button').click();
  assert.equal(await page.evaluate(()=>window.__opusToneStarts),previousCount);
  console.log('Vision-frame manifest and WebAudio: SOP navigation, opt-in ding, no sound after opt-out');
  // Local privacy workbench: metadata-free copies, actual black raster pixels,
  // exact-image review, no network, no promotion to patient-cloud authorization.
  await page.locator('.ora-vision-plan-thumbnail').nth(3).waitFor();
  const privacy=page.getByRole('region',{name:'Подготовка обезличенных кадров',exact:true});
  const privacyRequests=[],observePrivacyRequest=request=>privacyRequests.push(request.url());
  page.on('request',observePrivacyRequest);
  await page.getByLabel('Жалобы, анамнез, лабораторные данные',{exact:true}).fill(phiSentinel);
  await privacy.getByRole('button',{name:'Подготовить копии без метаданных',exact:true}).click();
  const privacyImage=privacy.getByAltText('Точная подготовленная копия кадра',{exact:true});
  const privacySelect=privacy.getByRole('combobox',{name:'Копия кадра',exact:true});
  const reviewText=privacy.getByRole('checkbox',{name:'Проверил копию: идентифицирующих надписей нет',exact:true});
  const reviewFace=privacy.getByRole('checkbox',{name:'Проверил копию: лица и узнаваемых признаков нет',exact:true});
  const privacyDownloadButton=privacy.getByRole('button',{name:'Скачать локальный пакет копий JSON',exact:true});
  const savePrivacyJson=async(region,buttonName,filename)=>{
    const downloaded=page.waitForEvent('download');await region.getByRole('button',{name:buttonName,exact:true}).click();
    const path=join(fixture,filename);await (await downloaded).saveAs(path);return JSON.parse(await readFile(path,'utf8'));
  };
  const journalButton=privacy.getByRole('button',{name:'Скачать журнал без пикселей JSON',exact:true});
  const bundleButton=privacy.getByRole('button',{name:'Скачать копии с журналом JSON',exact:true});
  const preparationStatus=privacy.getByRole('region',{name:'Готовность локальных копий к проверке',exact:true});
  await preparationStatus.getByText(/0\/4 кадров проверено вручную/).waitFor();
  assert.equal(await preparationStatus.locator('tbody tr').count(),4);
  assert.equal(await bundleButton.isDisabled(),true);
  assert.equal(await privacyDownloadButton.isDisabled(),true);
  await privacySelect.selectOption('1');await reviewText.check();await reviewFace.check();
  const originalThumbnail=await page.locator('.ora-vision-plan-thumbnail').nth(1).getAttribute('src');
  const outgoingPixel=async()=>page.evaluate(async()=>{
    const image=document.querySelector('.ora-privacy-preview');await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(32,32,1,1).data];
  });
  assert.ok((await outgoingPixel())[0]>0);
  for(const [field,value] of [['X','28'],['Y','28'],['Ширина','8'],['Высота','8']])await privacy.getByRole('spinbutton',{name:field,exact:true}).fill(value);
  await privacy.getByRole('button',{name:'Скрыть область в копии',exact:true}).click();
  await privacy.getByText(/Скрытых областей: 1/).waitFor();
  assert.equal(await reviewText.isChecked(),false);assert.equal(await reviewFace.isChecked(),false);
  assert.deepEqual(await outgoingPixel(),[0,0,0,255]);
  assert.equal(await page.locator('.ora-vision-plan-thumbnail').nth(1).getAttribute('src'),originalThumbnail);
  for(let i=0;i<4;i++){
    await privacySelect.selectOption(String(i));await reviewText.check();await reviewFace.check();
    assert.equal(await privacyDownloadButton.isDisabled(),i!==3);
  }
  const privacyDownload=page.waitForEvent('download');await privacyDownloadButton.click();
  const privacyFile=await privacyDownload,privacyPath=join(fixture,'privacy-candidate.json');await privacyFile.saveAs(privacyPath);
  const privacyPacket=JSON.parse(await readFile(privacyPath,'utf8'));
  assert.equal(privacyPacket.frames.length,4);assert.equal(privacyPacket.transmissionPermitted,false);
  assert.equal(privacyPacket.deidentificationVerified,false);assert.equal(privacyPacket.metadataPolicy,'pixel-only-no-DICOM');
  assert.equal(privacyPacket.coverage,'sampled-frames-only');
  assert.deepEqual(privacyPacket.frames[1].redactions,[{x:28,y:28,width:8,height:8}]);
  assert.doesNotMatch(JSON.stringify(privacyPacket),new RegExp(phiSentinel+'|sopInstanceUid|seriesUid|filename|clinicalContext'));
  for(const f of privacyPacket.frames){
    const png=Buffer.from(f.pngBase64,'base64'),types=[];let at=8;
    assert.equal(createHash('sha256').update(png).digest('hex'),f.sha256);
    assert.equal(f.pixelReviewSha256,f.sha256);assert.equal(f.visualReviewSha256,f.sha256);
    assert.equal(png.includes(Buffer.from(phiSentinel)),false);assert.equal(png.includes(Buffer.from(uid)),false);
    while(at<png.length){types.push(png.subarray(at+4,at+8).toString('ascii'));at+=12+png.readUInt32BE(at);}
    assert.ok(types.every(t=>['IHDR','IDAT','IEND'].includes(t)));
  }
  const bundle=await savePrivacyJson(privacy,'Скачать копии с журналом JSON','privacy-review-bundle.json');
  await preparationStatus.getByText(/4\/4 кадров проверено вручную/).waitFor();
  const readiness=await savePrivacyJson(privacy,'Скачать локальный статус без пикселей JSON','privacy-readiness.json');
  assert.equal(readiness.schema,'opus-local-privacy-readiness/v1');assert.equal(readiness.localReviewDone,true);
  assert.equal(readiness.transmissionPermitted,false);assert.equal(readiness.deidentificationVerified,false);
  assert.equal(readiness.validation,'local-copy-sha-and-journal-checked');
  assert.equal(readiness.serverChecks.length,7);assert.ok(readiness.serverChecks.every(c=>c.status==='not-connected'));
  assert.deepEqual(readiness.frames.map(f=>f.sha256),privacyPacket.frames.map(f=>f.sha256));
  assert.doesNotMatch(JSON.stringify(readiness),new RegExp(phiSentinel+'|pngBase64|sopInstanceUid|clinicalContext|token|initialFrames'));
  assert.equal(bundle.schema,'opus-vision-privacy-review/v1');
  assert.deepEqual(bundle.candidate.frames,privacyPacket.frames);
  assert.equal(bundle.review.journal.actor,'local-unverified');assert.equal(bundle.review.transmissionPermitted,false);
  const history=bundle.review.journal.events;assert.equal(history.length,11);
  assert.deepEqual(history.map(e=>e.revision),Array.from({length:11},(_,i)=>i+1));
  assert.equal(history[2].action.kind,'redacted');assert.equal(history[2].frameId,'frame-2');
  assert.equal(history[2].sha256,bundle.review.journal.initialFrames[1].sha256);
  assert.equal(history[2].action.nextSha256,privacyPacket.frames[1].sha256);
  assert.notEqual(history[2].sha256,history[2].action.nextSha256);
  assert.equal(bundle.review.journalSha256,createHash('sha256').update(JSON.stringify(bundle.review.journal)).digest('hex'));
  const journalOnly=await savePrivacyJson(privacy,'Скачать журнал без пикселей JSON','privacy-journal-only.json');
  assert.deepEqual(journalOnly,bundle.review);
  assert.equal(readiness.journalSha256,journalOnly.journalSha256);assert.equal(readiness.journalRevision,11);
  assert.doesNotMatch(JSON.stringify(journalOnly),new RegExp(phiSentinel+'|pngBase64|sopInstanceUid|seriesUid|filename|clinicalContext'));
  await privacySelect.selectOption('1');
  assert.equal(await privacyImage.evaluate(img=>img.getBoundingClientRect().width===img.naturalWidth),true);
  await privacy.screenshot({path:join(results,'synthetic-privacy-preparation.png')});
  await privacy.getByRole('button',{name:'Создать копии заново',exact:true}).click();
  assert.equal(await reviewText.isChecked(),false);assert.equal(await reviewFace.isChecked(),false);
  assert.equal(await privacyDownloadButton.isDisabled(),true);
  assert.equal(await bundleButton.isDisabled(),true);assert.equal(await journalButton.isDisabled(),false);
  const resetJournal=await savePrivacyJson(privacy,'Скачать журнал без пикселей JSON','privacy-reset-journal.json');
  assert.equal(resetJournal.journal.events.length,0);assert.notEqual(resetJournal.journal.sessionId,journalOnly.journal.sessionId);
  await preparationStatus.getByText(/0\/4 кадров проверено вручную/).waitFor();
  const draftStatus=await savePrivacyJson(privacy,'Скачать локальный статус без пикселей JSON','privacy-draft-readiness.json');
  assert.equal(draftStatus.localReviewDone,false);assert.equal(draftStatus.status,'needs-local-review');
  const restoreInput=privacy.getByLabel('Восстановить копии с журналом JSON',{exact:true});
  await restoreInput.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"SYNTHETIC-SECRET":oops}')});
  await privacy.getByRole('alert').filter({hasText:/Пакет повреждён/}).waitFor();
  assert.doesNotMatch(await privacy.getByRole('alert').innerText(),/SYNTHETIC-SECRET/);
  const afterBad=await savePrivacyJson(privacy,'Скачать журнал без пикселей JSON','privacy-after-bad.json');
  assert.deepEqual(afterBad,resetJournal);
  await restoreInput.setInputFiles({name:'too-big.json',mimeType:'application/json',buffer:Buffer.alloc(12*1024*1024+1)});
  await privacy.getByRole('alert').filter({hasText:/не более 12 МиБ/}).waitFor();
  await restoreInput.setInputFiles(join(fixture,'privacy-journal-only.json'));
  await privacy.getByRole('alert').filter({hasText:/Нужен пакет копий с журналом/}).waitFor();
  await restoreInput.setInputFiles(join(fixture,'privacy-review-bundle.json'));
  await privacy.getByText(/Копии и история восстановлены/).waitFor();
  await preparationStatus.getByText(/0\/4 кадров проверено вручную/).waitFor();
  assert.equal(await privacyDownloadButton.isDisabled(),true);assert.equal(await bundleButton.isDisabled(),true);
  assert.equal(await reviewText.isChecked(),false);assert.equal(await reviewFace.isChecked(),false);
  await privacySelect.selectOption('1');assert.deepEqual(await outgoingPixel(),[0,0,0,255]);
  assert.equal(await page.locator('.ora-vision-plan-thumbnail').nth(1).getAttribute('src'),originalThumbnail);
  const restoredJournal=await savePrivacyJson(privacy,'Скачать журнал без пикселей JSON','privacy-restored-journal.json');
  assert.equal(restoredJournal.schema,'opus-privacy-journal-export/v2');
  assert.deepEqual(restoredJournal.journal.events.slice(0,11),history);
  assert.deepEqual(restoredJournal.journal.events.slice(11).map(e=>e.action.kind),Array(4).fill('copy-restored'));
  // Re-importing the old file cannot drop the newly appended restore entries.
  await restoreInput.setInputFiles(join(fixture,'privacy-review-bundle.json'));
  await privacy.getByRole('alert').filter({hasText:/Пакет старее/}).waitFor();
  const afterOld=await savePrivacyJson(privacy,'Скачать журнал без пикселей JSON','privacy-after-old.json');
  assert.deepEqual(afterOld,restoredJournal);assert.deepEqual(await outgoingPixel(),[0,0,0,255]);
  for(let i=0;i<4;i++){await privacySelect.selectOption(String(i));await reviewText.check();await reviewFace.check();}
  const restoredBundle=await savePrivacyJson(privacy,'Скачать копии с журналом JSON','privacy-restored-bundle.json');
  assert.equal(restoredBundle.schema,'opus-vision-privacy-review/v2');assert.equal(restoredBundle.candidate.transmissionPermitted,false);
  assert.equal(restoredBundle.review.journal.events.length,23);
  // A fresh preparation may restore the saved v2 session, still requiring all checks again.
  await privacy.getByRole('button',{name:'Создать копии заново',exact:true}).click();
  await restoreInput.setInputFiles(join(fixture,'privacy-restored-bundle.json'));
  await privacy.getByText(/Копии и история восстановлены/).waitFor();
  assert.equal(await reviewText.isChecked(),false);assert.equal(await reviewFace.isChecked(),false);
  assert.equal(await bundleButton.isDisabled(),true);
  page.off('request',observePrivacyRequest);assert.deepEqual(privacyRequests,[]);
  const forgedPrivacyStatus=await page.request.post(baseUrl+'/api/ai',{
    data:{...privacyPacket,transmissionPermitted:true,deidentificationVerified:true,physicianAuthentication:true,studyConsent:true},
  });
  assert.equal(forgedPrivacyStatus.status(),410);
  await page.locator('#ora-frame-count').selectOption('2');
  await privacy.waitFor({state:'detached'});await page.locator('#ora-frame-count').selectOption('4');
  await page.getByLabel('Жалобы, анамнез, лабораторные данные',{exact:true}).fill('');
  console.log('Local privacy preparation: preamble/private metadata and context excluded, exact black pixels, unchanged source, SHA-bound reviews, bounded no-network candidate, forged cloud flags refused and lifecycle reset (synthetic only)');
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
  // An explicit offline-ONNX workflow is offered for the selected DICOM series.
  await page.locator('.ora-offline-model-instructions>summary').click();
  const offlineInstructions=await page.locator('.ora-offline-model-instructions').innerText();
  assert.match(offlineInstructions,/ONNX · без облака/);
  assert.match(offlineInstructions,/scripts\/run-local-onnx\.py/);
  assert.match(offlineInstructions,/--profile/);
  assert.match(offlineInstructions,/\.request\.json/);
  await page.locator('.ora-offline-model-instructions>summary').click();

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
  await page.locator('.ora-segmentation-evidence').waitFor();
  assert.match(await page.locator('.ora-segmentation-evidence').innerText(),/Synthetic sphere/);
  // Local R231 panel: synthetic readiness response only. MR must never create
  // a medical model job, and the previous verified overlay must survive.
  let localJobs=0;
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const r=route.request();
    const headers={'access-control-allow-origin':baseUrl,
      'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PUT,DELETE'};
    if(r.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(r.url().endsWith('/v1/capabilities'))await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({
      schema:'opus-worker-capabilities/v1',mode:'local',device:'cpu',dataPolicy:'public-reference-only',patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,chunkUpload:{version:1,maxChunkBytes:262144},
      model:{id:'lungmask-R231',version:'0.2.20',weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',ready:true},
    })});
    else {localJobs++;await route.fulfill({status:500,headers});}
  });
  await page.locator('.ora-local-lungmask>summary').click();
  const local=page.locator('.ora-local-lungmask');
  await local.getByLabel('Токен локального worker').fill('synthetic-test-token-for-browser-only-123456789');
  await local.locator('input[type=checkbox]').check();
  await local.getByRole('button',{name:'Сегментировать лёгкие локально',exact:true}).click();
  await local.locator('[role=alert]').waitFor();
  assert.match(await local.locator('[role=alert]').innerText(),/только КТ/);
  assert.equal(localJobs,0);
  assert.match(await page.locator('.ora-mask-provenance').innerText(),/synthetic-fixture-only/);
  await page.locator('.ora-local-lungmask>summary').click();
  console.log('R231 panel: unsupported MR stopped before a job; existing MPR mask retained (synthetic readiness fixture)');
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
  assert.equal(await page.locator('.ora-segmentation-evidence').count(),0);
  // Positive local transport/UI test: mathematical CT-tag phantom + mocked
  // prediction. This validates chunk production and MPR, never medical quality.
  const ctFixture=join(fixture,'ct');
  execFileSync(process.execPath,[join(root,'scripts/generate-segmentation-phantom.mjs'),ctFixture,'CT'],{stdio:'pipe'});
  const ctMask=await readFile(join(ctFixture,'synthetic-mask.nii'));
  const localId='11111111-1111-4111-8111-111111111111';
  let localRequest,offset=0,chunkCount=0,completed=false,deleted=false,jobAttempts=0;
  const resourcePreflight={availableRamBytes:512*1024**2,requiredRamBytes:1536*1024**2,
    availableDiskBytes:4*1024**3,requiredDiskBytes:256*1024**2,guardDecision:'allow'};
  const inputHash=createHash('sha256');
  await page.unroute('http://127.0.0.1:8765/**');
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    const headers={'access-control-allow-origin':baseUrl,
      'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PUT,DELETE'};
    const json=body=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(body)});
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(path==='/v1/capabilities')return json({schema:'opus-worker-capabilities/v1',mode:'local',device:'cpu',
      dataPolicy:'public-reference-only',patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,
      resourceProfile:{name:'safe',threads:1,interOpThreads:1},chunkUpload:{version:1,maxChunkBytes:262144},model:{id:'lungmask-R231',version:'0.2.20',
        weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',ready:true}});
    if(path==='/v1/jobs'&&r.method()==='POST') {
      jobAttempts++;
      const code=['insufficient_memory','insufficient_disk','model_not_ready'][jobAttempts-1];
      if(code)return route.fulfill({status:code==='model_not_ready'?503:507,headers,contentType:'application/json',
        body:JSON.stringify({detail:{code,preflight:{...resourcePreflight,guardDecision:code==='insufficient_memory'?'reject-memory':'reject-disk'}}})});
      localRequest=r.postDataJSON().request;assert.equal(localRequest.modality,'CT');return json({jobId:localId});
    }
    if(path.includes('/input/chunks/')) {
      assert.equal(Number(path.split('/').at(-1)),offset);
      const block=r.postDataBuffer();assert.ok(block.length<=131072);
      inputHash.update(block);offset+=block.length;chunkCount++;
      return json({state:'receiving_chunks',uploadedBytes:offset});
    }
    if(path.endsWith('/input/complete')) {
      assert.equal(offset,352+64*64*32*4);assert.equal(inputHash.digest('hex'),localRequest.inputSha256);
      completed=true;return json({state:'queued'});
    }
    if(r.method()==='DELETE') {deleted=true;return route.fulfill({status:204,headers});}
    assert.ok(completed);
    if(path.endsWith('/mask'))return route.fulfill({status:200,headers:{...headers,'content-length':String(ctMask.length)},body:ctMask});
    return json({schema:'opus-worker-job-status/v1',jobId:localId,state:'succeeded',result:{
      schema:'opus-segmentation-result/v1',requestId:localRequest.requestId,sourceIdentitySha256:localRequest.sourceIdentitySha256,
      inputSha256:localRequest.inputSha256,maskSha256:createHash('sha256').update(ctMask).digest('hex'),
      model:{id:'lungmask-R231',version:'0.2.20',weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',modality:'CT',task:'synthetic-browser-transport-only'},
      labels:[{id:1,name:'Synthetic sphere'},{id:2,name:'Synthetic insert'}],limitations:['Synthetic prediction; no medical model invoked.']},
      metrics:{device:'cpu',inferenceSeconds:0,totalSeconds:0,peakRssMiB:0,platform:'synthetic',machine:'fixture',
        preflight:{...resourcePreflight,availableRamBytes:4*1024**3},guardDecision:'allow',resourceProfile:'safe',threads:1,interOpThreads:1}});
  });
  await page.reload({waitUntil:'networkidle'});
  await page.locator('input[accept*=".dcm"]').setInputFiles((await readdir(ctFixture+'/dicom')).sort().map(n=>ctFixture+'/dicom/'+n));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='MPR · 3 плоскости'&&!b.disabled));
  await page.getByRole('button',{name:'MPR · 3 плоскости',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Подготовить пакет серии'&&!b.disabled));
  await page.locator('.ora-local-lungmask>summary').click();
  const positive=page.locator('.ora-local-lungmask');
  await positive.getByLabel('Токен локального worker').fill('synthetic-test-token-for-browser-only-123456789');
  await positive.locator('input[type=checkbox]').check();
  await positive.getByRole('button',{name:'Сегментировать лёгкие локально',exact:true}).click();
  for(const text of [/Недостаточно RAM:.*0\.50 ГиБ.*1\.50 ГиБ/,/Недостаточно места/,/Модель R231 недоступна/]) {
    await positive.locator('[role=alert]').waitFor();
    assert.match(await positive.locator('[role=alert]').innerText(),text);
    assert.equal(offset,0);assert.equal(deleted,false);
    assert.equal(await positive.locator('input[type=checkbox]').isChecked(),true);
    await positive.getByRole('button',{name:'Повторить R231',exact:true}).click();
  }
  await positive.locator('.ora-local-worker-metrics').waitFor();
  assert.equal(jobAttempts,4);
  assert.match(await positive.innerText(),/Маска возвращена в MPR/);
  assert.equal(chunkCount,5);assert.equal(deleted,true);
  assert.match(await page.locator('.ora-mask-coverage').innerText(),/только к загруженным срезам/);
  await page.locator('.ora-mask-provenance>summary').click();
  assert.match(await page.locator('.ora-mask-provenance').innerText(),/synthetic-browser-transport-only/);
  await page.waitForFunction(()=>[...document.querySelectorAll('.ora-mpr-mask-overlay')].every(c=>{
    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return pixels.some((v,i)=>i%4===3&&v>0);
  }));
  assert.equal(await page.locator('.ora-mpr-mask-overlay').count(),3);
  const evidencePanel=page.locator('.ora-segmentation-evidence');
  await evidencePanel.waitFor();
  assert.match(await evidencePanel.innerText(),/только в загруженных срезах.*не подтверждена/s);
  const observation=evidencePanel.locator('.ora-evidence-list>li').first();
  await observation.getByRole('button',{name:'Перепроверить метку',exact:true}).click();
  assert.match(await observation.innerText(),/На перепроверку/);
  const evidenceDownload=page.waitForEvent('download');
  await evidencePanel.getByRole('button',{name:'Скачать Evidence JSON',exact:true}).click();
  const exportedFile=await evidenceDownload, exportedPath=join(fixture,'specialist-evidence.json');
  await exportedFile.saveAs(exportedPath);
  const evidence=JSON.parse(await readFile(exportedPath,'utf8'));
  assert.equal(evidence.schema,'opus-specialist-evidence/v1');
  assert.equal(evidence.clinicalStatus,'unverified_research_draft');
  assert.equal(evidence.source.inputSha256,localRequest.inputSha256);
  assert.equal(evidence.mask.sha256,createHash('sha256').update(ctMask).digest('hex'));
  assert.equal(evidence.observations[0].review,'requires_recheck');
  assert.equal(evidence.reviewHistory.schema,'opus-evidence-review/v1');
  assert.equal(evidence.reviewHistory.events.length,1);
  assert.equal(evidence.reviewHistory.events[0].from,'unreviewed');
  assert.equal(evidence.reviewHistory.events[0].to,'requires_recheck');
  assert.equal(evidence.producer.executionMode,'local');
  assert.doesNotMatch(JSON.stringify(evidence),/synthetic-test-token|sopInstanceUid|patientName/);
  const downloadReport=async(button,path)=>{
    const event=page.waitForEvent('download');await button.click();const file=await event;
    await file.saveAs(path);return readFile(path,'utf8');
  };
  const specialistHtml=await downloadReport(evidencePanel.getByRole('button',{name:'Скачать отчёт Evidence HTML',exact:true}),join(fixture,'evidence-report.html'));
  assert.match(specialistHtml,/НЕУТВЕРЖДЁННЫЙ ИССЛЕДОВАТЕЛЬСКИЙ ЧЕРНОВИК/);
  assert.match(specialistHtml,/Гипотезы LLM не импортированы/);
  assert.match(specialistHtml,/На перепроверку/);
  assert.ok(specialistHtml.includes(evidence.mask.sha256));
  const notePanel=evidencePanel.locator('.ora-reviewer-note'),noteEditor=notePanel.locator('textarea');
  const reviewerText='Synthetic reviewer comment <script>alert(42)</script>. No real clinical finding.';
  await noteEditor.fill(reviewerText);
  assert.equal(await evidencePanel.getByRole('button',{name:'Скачать Evidence JSON',exact:true}).isDisabled(),true);
  assert.equal(await evidencePanel.getByRole('button',{name:'Скачать отчёт Evidence HTML',exact:true}).isDisabled(),true);
  await notePanel.getByRole('button',{name:'Сохранить заметку',exact:true}).click();
  await notePanel.getByText(/сохранённых версий: 1/).waitFor();
  const firstNoteDownload=page.waitForEvent('download');
  await notePanel.getByRole('button',{name:'Скачать заметку JSON',exact:true}).click();
  const firstNoteFile=await firstNoteDownload,firstNotePath=join(fixture,'reviewer-note-first.json');
  await firstNoteFile.saveAs(firstNotePath);
  const firstNote=JSON.parse(await readFile(firstNotePath,'utf8'));
  assert.equal(firstNote.schema,'opus-reviewer-note/v1');assert.equal(firstNote.versions[0].text,reviewerText);
  assert.equal(firstNote.versions[0].reviewRevision,1);assert.equal(firstNote.binding.maskSha256,evidence.mask.sha256);
  // Shared LPS focus must synchronise all three plane controls to the exported
  // occupied voxel, respecting each viewport's camera direction.
  const beforeEvidenceNavigation=await page.locator('.ora-mpr-controls label').allTextContents();
  const offCentreObservation=evidencePanel.locator('.ora-evidence-list>li').nth(1);
  await offCentreObservation.getByRole('button',{name:'Показать метку в MPR',exact:true}).click();
  assert.equal(await evidencePanel.locator('[role=alert]').count(),0);
  assert.equal(await page.locator('.ora-mask-settings select').inputValue(),String(evidence.observations[1].labelId));
  assert.notDeepEqual(await page.locator('.ora-mpr-controls label').allTextContents(),beforeEvidenceNavigation);
  assert.equal(await page.locator('.ora-mpr-crosshair').count(),3);
  // Reconciliation uses imported metadata only, never a model/provider call.
  const comparisonPanel=evidencePanel.locator('.ora-evidence-comparison');
  const templateDownload=page.waitForEvent('download');
  await comparisonPanel.getByRole('button',{name:'Скачать шаблон гипотез',exact:true}).click();
  const templateFile=await templateDownload,templatePath=join(fixture,'llm-template.json');
  await templateFile.saveAs(templatePath);
  const hypotheses=JSON.parse(await readFile(templatePath,'utf8'));
  assert.equal(hypotheses.schema,'opus-llm-measurements/v1');
  assert.equal(hypotheses.producer.model,'not-recorded');
  assert.ok(hypotheses.claims.every(c=>c.valueMl===null&&c.scope==='unknown'));
  hypotheses.producer={kind:'llm',provider:'synthetic-fixture',model:'no-real-LLM'};
  hypotheses.claims[0]={...hypotheses.claims[0],scope:'loaded-slices',
    valueMl:evidence.observations[0].volumeMl+1,statement:'Synthetic volume discrepancy; <img src="https://example.invalid/x" onerror="alert(1)"> no LLM invoked.'};
  const hypothesisInput=comparisonPanel.locator('input[type=file]');
  const importHypotheses=async value=>hypothesisInput.setInputFiles({name:'synthetic-hypotheses.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await importHypotheses(hypotheses);
  const comparedClaim=comparisonPanel.locator('.ora-comparison-list>li').first();
  await comparedClaim.getByText(/Числовое расхождение/).waitFor();
  assert.match(await comparedClaim.innerText(),/Разность LLM − маска: 1\.00000 мл/);
  assert.equal(await comparedClaim.getByRole('button',{name:'Показать точку LLM в MPR',exact:true}).count(),0);
  hypotheses.claims[0].anchor={coordinateSystem:'LPS-mm',pointLpsMm:evidence.observations[0].anchorLpsMm,maskSha256:evidence.mask.sha256};
  await importHypotheses(hypotheses);
  const anchorButton=comparedClaim.getByRole('button',{name:'Показать точку LLM в MPR',exact:true});
  await comparedClaim.getByText(/В точке находится целевая метка/).waitFor();
  await anchorButton.click();
  assert.equal(await page.locator('.ora-mask-settings select').inputValue(),String(evidence.observations[0].labelId));
  const beforeLlmNavigation=await page.locator('.ora-mpr-controls label').allTextContents();
  hypotheses.claims[0].anchor.pointLpsMm=evidence.observations[1].anchorLpsMm;
  await importHypotheses(hypotheses);
  await comparedClaim.getByText(/В точке другая метка маски/).waitFor();
  await anchorButton.click();
  assert.equal(await page.locator('.ora-mask-settings select').inputValue(),String(evidence.observations[1].labelId));
  assert.notDeepEqual(await page.locator('.ora-mpr-controls label').allTextContents(),beforeLlmNavigation);
  assert.equal(await page.locator('.ora-mpr-crosshair').count(),3);
  const wrongAnchor=structuredClone(hypotheses);wrongAnchor.claims[0].anchor.maskSha256='f'.repeat(64);
  await importHypotheses(wrongAnchor);
  await comparedClaim.getByText(/Привязка точки не подтверждена/).waitFor();
  assert.equal(await anchorButton.isDisabled(),true);
  const outsideAnchor=structuredClone(hypotheses);outsideAnchor.claims[0].anchor.pointLpsMm=[1e9,1e9,1e9];
  await importHypotheses(outsideAnchor);
  await comparedClaim.getByText('За пределами объёма.',{exact:true}).waitFor();
  assert.equal(await anchorButton.isDisabled(),true);
  const wrongHypotheses=structuredClone(hypotheses);wrongHypotheses.source.inputSha256='f'.repeat(64);
  await importHypotheses(wrongHypotheses);
  await comparedClaim.getByText(/Нельзя сопоставить/).waitFor();
  assert.match(await comparedClaim.innerText(),/Не совпадают пакет/);
  assert.equal(await anchorButton.isDisabled(),true);
  assert.doesNotMatch(await comparedClaim.innerText(),/Разность LLM/);
  await importHypotheses(sampleReview);
  await comparisonPanel.locator('[role=alert]').waitFor();
  assert.match(await comparisonPanel.locator('[role=alert]').innerText(),/не содержит SHA/);
  assert.match(await comparedClaim.innerText(),/Нельзя сопоставить/); // failed replacement preserves old import
  await importHypotheses(hypotheses);
  await comparedClaim.getByText(/Числовое расхождение/).waitFor();
  assert.equal(await comparisonPanel.locator('[role=alert]').count(),0);
  const comparisonDownload=page.waitForEvent('download');
  await comparisonPanel.getByRole('button',{name:'Скачать сопоставление JSON',exact:true}).click();
  const comparisonFile=await comparisonDownload,comparisonPath=join(fixture,'comparison.json');
  await comparisonFile.saveAs(comparisonPath);
  const compared=JSON.parse(await readFile(comparisonPath,'utf8'));
  assert.equal(compared.schema,'opus-evidence-comparison/v1');
  assert.equal(compared.provenance,'imported-unverified');
  assert.equal(compared.comparisons[0].deltaMl,1);
  assert.equal(compared.comparisons[0].review,'needs_review');
  assert.equal(compared.comparisons[0].spatial.relation,'different_label');
  assert.equal(compared.comparisons[0].spatial.sampledLabelId,evidence.observations[1].labelId);
  assert.deepEqual(compared.comparisons[0].spatial.pointLpsMm,evidence.observations[1].anchorLpsMm);
  assert.equal(compared.specialist.observations[0].review,'requires_recheck');
  assert.equal(compared.specialist.reviewHistory.events.length,1);
  assert.equal(compared.llm.claims[0].valueMl,evidence.observations[0].volumeMl+1);
  assert.doesNotMatch(JSON.stringify(compared),/synthetic-test-token|sopInstanceUid|patientName/);
  const combinedHtml=await downloadReport(comparisonPanel.getByRole('button',{name:'Скачать отчёт с сопоставлением HTML',exact:true}),join(fixture,'comparison-report.html'));
  assert.match(combinedHtml,/Числовое расхождение/);assert.match(combinedHtml,/В точке другая метка/);
  assert.match(combinedHtml,/Происхождение, независимость и охват не удостоверены/);
  assert.match(combinedHtml,/Synthetic reviewer comment &lt;script&gt;/);
  assert.match(combinedHtml,/Заметка проверяющего · черновик/);
  assert.doesNotMatch(combinedHtml,/<img|<script|<iframe|<a\s/i);
  const reportPage=await browser.newPage({viewport:{width:1200,height:1000}}),reportRequests=[];
  reportPage.on('request',request=>reportRequests.push(request.url()));
  await reportPage.setContent(combinedHtml,{waitUntil:'load'});
  assert.equal(await reportPage.locator('img,script,iframe,a,form').count(),0);
  assert.match(await reportPage.locator('body').innerText(),/<img src=/); // text only, never parsed as markup
  await reportPage.emulateMedia({media:'print'});
  await reportPage.pdf({path:join(results,'synthetic-evidence-report.pdf'),preferCSSPageSize:true,printBackground:true});
  await reportPage.screenshot({path:join(results,'synthetic-evidence-report.png'),fullPage:true});
  assert.deepEqual(reportRequests,[]);await reportPage.close();
  await comparisonPanel.getByRole('button',{name:'Удалить гипотезы LLM',exact:true}).click();
  assert.equal(await comparisonPanel.locator('.ora-comparison-list').count(),0);
  await importHypotheses(hypotheses);
  await comparedClaim.getByText(/Числовое расхождение/).waitFor();
  await observation.getByRole('button',{name:'Отклонить метку',exact:true}).click();
  assert.match(await observation.innerText(),/Отклонено локально/);
  assert.match(await notePanel.innerText(),/Заметку нужно перепроверить/);
  assert.match(await comparedClaim.innerText(),/Нельзя сопоставить.*Целевая метка отклонена/s);
  assert.equal(await anchorButton.isDisabled(),true);
  assert.equal(await page.locator('.ora-mpr-mask-overlay').count(),3);
  // Reset is a new review event; exported journals can extend but cannot erase
  // or fork the active history. Restoring never replaces any measurements.
  const historyPanel=evidencePanel.locator('.ora-review-history');
  await observation.getByRole('button',{name:'Сбросить отметку',exact:true}).click();
  assert.match(await observation.innerText(),/Не проверено врачом/);
  assert.match(await historyPanel.innerText(),/версия 3/);
  await historyPanel.locator('details>summary').click();
  assert.equal(await historyPanel.locator('ol>li').count(),3);
  const historyDownload=page.waitForEvent('download');
  await historyPanel.getByRole('button',{name:'Скачать историю JSON',exact:true}).click();
  const historyFile=await historyDownload,historyPath=join(fixture,'review-history.json');
  await historyFile.saveAs(historyPath);
  const journal=JSON.parse(await readFile(historyPath,'utf8'));
  assert.deepEqual(journal.events.map(e=>[e.revision,e.from,e.to]),[[1,'unreviewed','requires_recheck'],[2,'requires_recheck','rejected'],[3,'rejected','unreviewed']]);
  assert.equal(journal.binding.maskSha256,evidence.mask.sha256);
  const historyInput=historyPanel.locator('input[type=file]');
  const importHistory=async value=>historyInput.setInputFiles({name:'synthetic-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  const continued=structuredClone(journal);
  continued.events.push({revision:4,observationId:evidence.observations[0].observationId,from:'unreviewed',to:'rejected',at:'2026-10-12T00:00:00.000Z',actor:'local-unverified-reviewer'});
  await importHistory(continued);
  await historyPanel.getByRole('status').waitFor();
  assert.match(await observation.innerText(),/Отклонено локально/);
  assert.match(await historyPanel.innerText(),/версия 4/);
  assert.equal(await anchorButton.isDisabled(),true); // comparison follows restored review
  const foreign=structuredClone(continued);foreign.binding.maskSha256='f'.repeat(64);
  await importHistory(foreign);
  await historyPanel.locator('[role=alert]').waitFor();
  assert.match(await historyPanel.locator('[role=alert]').innerText(),/другому пакету/);
  assert.match(await observation.innerText(),/Отклонено локально/);
  await importHistory(journal);
  await historyPanel.getByText(/Более старая версия/).waitFor();
  assert.match(await historyPanel.innerText(),/версия 4/);
  const forked=structuredClone(continued);forked.events[0].at='2026-10-12T01:00:00.000Z';
  await importHistory(forked);
  await historyPanel.getByText(/Расходящаяся версия/).waitFor();
  assert.equal(await historyPanel.locator('ol>li').count(),4);
  await importHistory(continued);
  await historyPanel.locator('[role=alert]').waitFor({state:'detached'});
  assert.equal(await historyPanel.locator('[role=alert]').count(),0);
  const rejectedHtml=await downloadReport(comparisonPanel.getByRole('button',{name:'Скачать отчёт с сопоставлением HTML',exact:true}),join(fixture,'rejected-report.html'));
  assert.match(rejectedHtml,/Версия 4/);assert.match(rejectedHtml,/Отклонено локально/);
  assert.match(rejectedHtml,/Нельзя сопоставить/);assert.match(rejectedHtml,/Целевая метка отклонена/);
  assert.match(rejectedHtml,/Заметку нужно перепроверить/);
  await notePanel.getByRole('button',{name:'Сохранить заметку',exact:true}).click();
  await notePanel.getByText(/сохранённых версий: 2/).waitFor();
  assert.doesNotMatch(await notePanel.innerText(),/Заметку нужно перепроверить/);
  const noteDownload=page.waitForEvent('download');
  await notePanel.getByRole('button',{name:'Скачать заметку JSON',exact:true}).click();
  const noteFile=await noteDownload,notePath=join(fixture,'reviewer-note-current.json');await noteFile.saveAs(notePath);
  const note=JSON.parse(await readFile(notePath,'utf8'));
  assert.equal(note.versions.length,2);assert.equal(note.versions[1].reviewRevision,4);
  const noteInput=notePanel.locator('input[type=file]');
  const importNote=async value=>noteInput.setInputFiles({name:'synthetic-reviewer-note.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  const foreignNote=structuredClone(note);foreignNote.binding.maskSha256='f'.repeat(64);
  await importNote(foreignNote);await notePanel.getByText(/другому источнику/).waitFor();
  assert.equal(await noteEditor.inputValue(),reviewerText);
  await importNote(firstNote);await notePanel.getByText(/не продолжает текущую историю версий/).waitFor();
  await importNote(note);await notePanel.locator('[role=alert]').waitFor({state:'detached'});
  await noteEditor.fill('Unsaved synthetic edit');
  assert.equal(await comparisonPanel.getByRole('button',{name:'Скачать сопоставление JSON',exact:true}).isDisabled(),true);
  assert.equal(await comparisonPanel.getByRole('button',{name:'Скачать отчёт с сопоставлением HTML',exact:true}).isDisabled(),true);
  await notePanel.getByRole('button',{name:'Сбросить правки заметки',exact:true}).click();
  assert.equal(await noteEditor.inputValue(),reviewerText);
  const confirmedHtml=await downloadReport(comparisonPanel.getByRole('button',{name:'Скачать отчёт с сопоставлением HTML',exact:true}),join(fixture,'reviewer-confirmed-report.html'));
  assert.match(confirmedHtml,/Версия заметки 2, история проверки 4/);assert.doesNotMatch(confirmedHtml,/Заметку нужно перепроверить/);
  // Optional exact observation targets retain the legacy general note and use
  // existing occupied-label anchors, never invent a lesion/ROI coordinate.
  const noteTarget=notePanel.getByRole('combobox',{name:'К чему относится заметка',exact:true});
  const labelComments=['Synthetic first label comment <script>sentinel</script>.','Synthetic second label comment.'];
  for(let i=0;i<2;i++){
    await noteTarget.selectOption(evidence.observations[i].observationId);
    assert.equal(await noteEditor.inputValue(),'');
    await noteEditor.fill(labelComments[i]);
    assert.equal(await noteTarget.isDisabled(),true);
    assert.equal(await evidencePanel.getByRole('button',{name:'Скачать Evidence JSON',exact:true}).isDisabled(),true);
    await notePanel.getByRole('button',{name:'Сохранить заметку',exact:true}).click();
    await notePanel.getByText(new RegExp(`сохранённых версий: ${i+3}`)).waitFor();
    assert.equal(await noteTarget.isDisabled(),false);
    await notePanel.getByRole('button',{name:'Показать метку заметки в MPR',exact:true}).click();
    assert.equal(await page.locator('.ora-mask-settings select').inputValue(),String(evidence.observations[i].labelId));
    assert.equal(await page.locator('.ora-mpr-crosshair').count(),3);
  }
  const targetedDownload=page.waitForEvent('download');
  await notePanel.getByRole('button',{name:'Скачать заметку JSON',exact:true}).click();
  const targetedFile=await targetedDownload,targetedPath=join(fixture,'targeted-notes.json');await targetedFile.saveAs(targetedPath);
  const targetedNote=JSON.parse(await readFile(targetedPath,'utf8'));
  assert.equal(targetedNote.schema,'opus-reviewer-note/v2');
  assert.equal(targetedNote.versions.length,4);
  assert.equal('observationId' in targetedNote.versions[0],false); // old general shape preserved
  assert.deepEqual(targetedNote.versions.slice(2).map(v=>v.observationId),evidence.observations.slice(0,2).map(o=>o.observationId));
  await noteTarget.selectOption(evidence.observations[0].observationId);
  const wrongTarget=structuredClone(targetedNote);wrongTarget.versions[3].observationId='foreign-label';
  await importNote(wrongTarget);await notePanel.getByText(/Цель заметки/).waitFor();
  assert.equal(await noteEditor.inputValue(),labelComments[0]);
  await importNote(targetedNote);await notePanel.locator('[role=alert]').waitFor({state:'detached'});
  assert.equal(await noteEditor.inputValue(),labelComments[0]); // selected target, not last overall version
  await noteTarget.selectOption('');assert.equal(await noteEditor.inputValue(),reviewerText);
  assert.equal(await notePanel.getByRole('button',{name:'Показать метку заметки в MPR',exact:true}).count(),0);
  const targetedHtml=await downloadReport(comparisonPanel.getByRole('button',{name:'Скачать отчёт с сопоставлением HTML',exact:true}),join(fixture,'targeted-report.html'));
  assert.match(targetedHtml,/Synthetic reviewer comment &lt;script&gt;/);
  assert.match(targetedHtml,/Synthetic first label comment &lt;script&gt;/);assert.match(targetedHtml,/Synthetic second label comment/);
  for(const o of evidence.observations.slice(0,2))assert.ok(targetedHtml.includes(`Наблюдение: ${o.observationId}`));
  assert.doesNotMatch(targetedHtml,/<script|<img|Заметку нужно перепроверить/);
  assert.equal(await page.locator('.ora-mpr-mask-overlay').count(),3);
  await page.getByRole('button',{name:'Удалить маску',exact:true}).click();
  assert.equal(await evidencePanel.count(),0);
  assert.equal(await comparisonPanel.count(),0);
  assert.equal(await historyPanel.count(),0);
  assert.equal(await notePanel.count(),0);
  console.log('Reviewer note: unsaved export/target-switch block, general + exact label versions, occupied-point MPR navigation, stale/recheck, target-aware restore/refusal, escaped multi-target report and teardown (synthetic only)');
  console.log('Local review history: immutable reset, journal/export, source-bound extension restore, older/forked/foreign refusal, comparison refresh and lifecycle clear (synthetic only)');
  console.log('Local printable report: specialist/LLM separation, escaped markup, no requests, print-to-PDF and current rejected history (synthetic only)');
  console.log('Local metadata reconciliation: blank template, numeric discrepancy, source/scope abstention, failed-import retention, review-aware export and lifecycle clear (synthetic only)');
  console.log('LLM LPS anchors: active mask target/different label, three-plane navigation, wrong mask/source/outside/rejected abstention and export (synthetic only)');
  console.log('Bound specialist Evidence -> local review/export -> occupied-point MPR navigation -> lifecycle clear passed (synthetic only)');
  console.log('Memory/disk/model errors -> retry without reload -> chunk upload -> bound mask -> three MPR planes passed (synthetic CT/prediction only)');
  // Explicit native CT slab: exact physical subset, full 2D remains available.
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.locator('.cs-stack').waitFor();
  const slabPanel=page.getByRole('region',{name:'Фрагмент КТ для MPR и локального AI',exact:true});
  await slabPanel.getByLabel('Первый срез фрагмента КТ',{exact:true}).fill('0');
  await slabPanel.getByLabel('Последний срез фрагмента КТ',{exact:true}).fill('14');
  await slabPanel.getByRole('button',{name:'Открыть фрагмент в MPR',exact:true}).click();
  await slabPanel.getByRole('alert').waitFor();assert.equal(await page.locator('.ora-mpr').count(),0);
  await slabPanel.getByLabel('Первый срез фрагмента КТ',{exact:true}).fill('7');
  await slabPanel.getByRole('button',{name:'Открыть фрагмент в MPR',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Подготовить пакет серии'&&!b.disabled));
  assert.match(await page.locator('.ora-mpr-volume-stats').innerText(),/7–14 из 32/);
  assert.match(await page.locator('.ora-mpr-volume-stats').innerText(),/64 × 64 × 8/);
  assert.equal(await slabPanel.getByLabel('Первый срез фрагмента КТ',{exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.ora-package-ready').count(),0);
  assert.equal(await page.locator('.ora-mask-provenance').count(),0);
  await page.locator('.ora-analysis-package>summary').click();
  await page.getByRole('button',{name:'Подготовить пакет серии',exact:true}).click();await page.locator('.ora-package-ready').waitFor();
  const slabNiftiPath=join(fixture,'slab.nii'),slabRequestPath=join(fixture,'slab-request.json');
  await download('Скачать объём .nii',slabNiftiPath);await download('Скачать паспорт .json',slabRequestPath);
  const slabBytes=await readFile(slabNiftiPath),slabRequest=JSON.parse(await readFile(slabRequestPath,'utf8'));
  assert.deepEqual(slabRequest.geometry.dimensions,[64,64,8]);assert.equal(slabRequest.frameCount,8);
  assert.equal(slabRequest.inputSha256,createHash('sha256').update(slabBytes).digest('hex'));
  assert.equal(slabRequest.coverage,'not-confirmed');assert.equal(slabBytes.length,352+64*64*8*4);
  const sa=slabRequest.geometry.affineLps,zEnds=[sa[11],sa[10]*7+sa[11]].sort((a,b)=>a-b);
  assert.deepEqual(zEnds,[-19,-5]);
  for(let k=0;k<8;k++)for(let j=0;j<64;j++)for(let i=0;i<64;i++){
    const x=sa[0]*i+sa[1]*j+sa[2]*k+sa[3],y=sa[4]*i+sa[5]*j+sa[6]*k+sa[7],z=sa[8]*i+sa[9]*j+sa[10]*k+sa[11];
    const inner=(x-9)**2+(y+2)**2+z*z<36,outer=x*x+y*y+z*z<256;
    assert.equal(slabBytes.readFloatLE(352+4*(i+64*(j+64*k))),inner?1400:outer?Math.round(850+200*x/16):0);
  }
  await page.locator('input[accept=".nii,.nii.gz"]').setInputFiles(join(ctFixture,'synthetic-mask.nii'));
  await page.locator('.ora-mask-error').waitFor();assert.equal(await page.locator('.ora-mask-success').count(),0);
  // Same real browser job/chunk contract for the selected slab, mocked worker only.
  const slabMask=Buffer.alloc(352+64*64*8*2);slabBytes.copy(slabMask,0,0,352);
  slabMask.writeInt16LE(512,70);slabMask.writeInt16LE(16,72);
  for(let i=0;i<64*64*8;i++)slabMask.writeUInt16LE(slabBytes.readFloatLE(352+i*4)===1400?2:slabBytes.readFloatLE(352+i*4)>0?1:0,352+i*2);
  const slabUploadHash=createHash('sha256');let slabJobRequest,slabOffset=0,slabChunks=0,slabDeleted=false;
  await page.unroute('http://127.0.0.1:8765/**');
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    const headers={'access-control-allow-origin':baseUrl,'access-control-allow-headers':'authorization,content-type',
      'access-control-allow-methods':'GET,POST,PUT,DELETE'};
    const json=value=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(path.endsWith('/capabilities'))return json({schema:'opus-worker-capabilities/v1',mode:'local',device:'cpu',dataPolicy:'public-reference-only',
      patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,chunkUpload:{version:1,maxChunkBytes:262144},
      model:{id:'lungmask-R231',version:'0.2.20',weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',ready:true}});
    if(r.method()==='POST'&&path==='/v1/jobs'){
      slabJobRequest=r.postDataJSON().request;assert.equal(slabJobRequest.frameCount,8);assert.deepEqual(slabJobRequest.geometry,slabRequest.geometry);
      assert.equal(slabJobRequest.inputSha256,slabRequest.inputSha256);
      return json({jobId:localId,state:'uploading',upload:{receivedBytes:0,maxChunkBytes:262144}});
    }
    if(r.method()==='PUT'){
      const bytes=r.postDataBuffer();slabUploadHash.update(bytes);slabOffset+=bytes.length;slabChunks++;
      return json({state:'receiving_chunks',uploadedBytes:slabOffset});
    }
    if(r.method()==='POST'){
      assert.equal(slabUploadHash.digest('hex'),slabJobRequest.inputSha256);assert.equal(slabOffset,slabBytes.length);return json({state:'queued'});
    }
    if(r.method()==='DELETE'){slabDeleted=true;return route.fulfill({status:204,headers});}
    if(path.endsWith('/mask'))return route.fulfill({status:200,headers:{...headers,'content-length':String(slabMask.length)},body:slabMask});
    return json({schema:'opus-worker-job-status/v1',jobId:localId,state:'succeeded',result:{
      schema:'opus-segmentation-result/v1',requestId:slabJobRequest.requestId,sourceIdentitySha256:slabJobRequest.sourceIdentitySha256,
      inputSha256:slabJobRequest.inputSha256,maskSha256:createHash('sha256').update(slabMask).digest('hex'),
      model:{id:'lungmask-R231',version:'0.2.20',weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',modality:'CT',task:'synthetic-slab-contract-only'},
      labels:[{id:1,name:'Synthetic outer'},{id:2,name:'Synthetic inner'}],limitations:['Synthetic prediction only; no trained inference']},
      metrics:{device:'cpu',inferenceSeconds:0,totalSeconds:0,peakRssMiB:0,platform:'synthetic',machine:'fixture',
        preflight:{...resourcePreflight,availableRamBytes:4*1024**3},guardDecision:'allow',resourceProfile:'safe',threads:1,interOpThreads:1}});
  });
  await page.locator('.ora-local-lungmask>summary').click();
  const slabLocal=page.locator('.ora-local-lungmask');
  await slabLocal.getByLabel('Токен локального worker').fill('synthetic-test-token-for-browser-only-123456789');
  await slabLocal.locator('input[type=checkbox]').check();
  await slabLocal.getByRole('button',{name:'Сегментировать лёгкие локально',exact:true}).click();
  await page.locator('.ora-mask-provenance').waitFor();assert.equal(slabDeleted,true);assert.ok(slabChunks>=2);
  assert.equal(await page.locator('.ora-mpr-mask-overlay').count(),3);
  await page.waitForFunction(()=>[...document.querySelectorAll('.ora-mpr-mask-overlay')].every(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return true;return false;
  }));
  await slabPanel.getByRole('button',{name:'Вернуть полную серию в 2D',exact:true}).click();
  await page.locator('.cs-stack').waitFor();assert.match(await page.locator('.cs-slider-row label').innerText(),/\/ 32/);
  assert.equal(await page.locator('.ora-mpr').count(),0);assert.equal(await page.locator('.ora-package-ready').count(),0);
  await mpr.click();await page.waitForFunction(()=>document.querySelector('.ora-mpr-volume-stats')?.textContent?.includes('64 × 64 × 32'));
  assert.equal(await page.locator('.ora-mask-provenance').count(),0);
  console.log('Bounded CT slab: invalid range refused, exact native 7–14/32 scalar/SHA/LPS export, wrong full mask refused, job/chunks/bound mask in three MPR planes/delete, reset and full 2D/MPR restored (mocked inference only)');
  // Full-series path decodes actual mathematical DICOM planes without a full MPR
  // volume. The local worker/inference response is mocked; no trained model runs.
  const huFixture=join(fixture,'full-native-hu');
  execFileSync(process.execPath,[join(root,'scripts/generate-segmentation-phantom.mjs'),huFixture,'CT','rescale-hu'],{stdio:'pipe'});
  await page.reload({waitUntil:'networkidle'});
  await page.locator('input[accept*=".dcm"]').setInputFiles((await readdir(huFixture+'/dicom')).sort().map(n=>huFixture+'/dicom/'+n));
  await page.locator('.cs-stack').waitFor();
  let fullJobRequest,fullInput,fullMask,fullDeleted=false,fullMaskGets=0,fullSlabBad=true;
  const fullBlocks=[];let fullOffset=0;const fullIdentifier='22222222-2222-4222-8222-222222222222';
  await page.unroute('http://127.0.0.1:8765/**');
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    const headers={'access-control-allow-origin':baseUrl,'access-control-allow-headers':'authorization,content-type',
      'access-control-allow-methods':'GET,POST,PUT,DELETE','access-control-expose-headers':'X-Opus-Mask-Proof'};
    const json=value=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(path.endsWith('/capabilities'))return json({schema:'opus-worker-capabilities/v1',mode:'local',device:'cpu',dataPolicy:'public-reference-only',
      patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,chunkUpload:{version:1,maxChunkBytes:262144},
      model:{id:'lungmask-R231',version:'0.2.20',weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',ready:true},
      fullCt:{requestSchema:'opus-analysis-request/v2',maxPlane:512,maxFrames:300,maskAccess:'bounded-slabs-only'}});
    if(r.method()==='POST'&&path==='/v1/jobs'){
      fullJobRequest=r.postDataJSON().request;assert.equal(fullJobRequest.schema,'opus-analysis-request/v2');assert.equal(fullJobRequest.frameCount,32);
      assert.deepEqual(fullJobRequest.geometry.dimensions,[64,64,32]);return json({jobId:fullIdentifier});
    }
    if(r.method()==='PUT'){
      assert.equal(Number(path.split('/').at(-1)),fullOffset);const block=r.postDataBuffer();assert.ok(block.length<=131072);
      fullBlocks.push(block);fullOffset+=block.length;return json({state:'receiving_chunks',uploadedBytes:fullOffset});
    }
    if(path.endsWith('/input/complete')){
      fullInput=Buffer.concat(fullBlocks);assert.equal(fullInput.length,352+64*64*32*4);
      assert.equal(createHash('sha256').update(fullInput).digest('hex'),fullJobRequest.inputSha256);
      const fa=fullJobRequest.geometry.affineLps;
      fullMask=Buffer.alloc(352+64*64*32);fullInput.copy(fullMask,0,0,352);fullMask.writeInt16LE(2,70);fullMask.writeInt16LE(8,72);
      for(let z=0;z<32;z++)for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        const px=fa[0]*x+fa[1]*y+fa[2]*z+fa[3],py=fa[4]*x+fa[5]*y+fa[6]*z+fa[7],pz=fa[8]*x+fa[9]*y+fa[10]*z+fa[11];
        const inner=(px-9)**2+(py+2)**2+pz*pz<36,outer=px*px+py*py+pz*pz<256;
        const i=x+64*(y+64*z);assert.equal(fullInput.readFloatLE(352+i*4),(inner?1400:outer?Math.round(850+200*px/16):0)-1000);
        fullMask[352+i]=inner?2:outer?1:0;
      }
      return json({state:'queued'});
    }
    if(r.method()==='DELETE'){fullDeleted=true;return route.fulfill({status:204,headers});}
    if(path.endsWith('/mask')){fullMaskGets++;return route.fulfill({status:500,headers});}
    if(path.endsWith('/mask-slab')){
      const {start,count}=r.postDataJSON();assert.equal(start,19);assert.equal(count,8);
      const mask=Buffer.alloc(352+64*64*count);fullMask.copy(mask,0,0,352);fullMask.copy(mask,352,352+start*64*64,352+(start+count)*64*64);
      mask.writeInt16LE(count,46);const affine=[...fullJobRequest.geometry.affineLps];
      for(let row=0;row<3;row++)affine[row*4+3]+=affine[row*4+2]*start;
      affine.forEach((v,i)=>mask.writeFloatLE(i<8?-v:v,280+i*4));
      const proof={schema:'opus-full-ct-slab/v1',jobId:fullIdentifier,requestId:fullJobRequest.requestId,
        sourceIdentitySha256:fullJobRequest.sourceIdentitySha256,inputSha256:fullJobRequest.inputSha256,
        fullMaskSha256:fullSlabBad?'d'.repeat(64):createHash('sha256').update(fullMask).digest('hex'),slabMaskSha256:createHash('sha256').update(mask).digest('hex'),
        geometry:{dimensions:[64,64,count],affineLps:affine},start,count,sourceFrameCount:32};
      return route.fulfill({status:200,headers:{...headers,'X-Opus-Mask-Proof':Buffer.from(JSON.stringify(proof)).toString('base64')},body:mask});
    }
    const labelVoxels=[1,2].map(label=>fullMask.subarray(352).filter(v=>v===label).length);
    return json({state:'succeeded',result:{schema:'opus-segmentation-result/v1',requestId:fullJobRequest.requestId,
      sourceIdentitySha256:fullJobRequest.sourceIdentitySha256,inputSha256:fullJobRequest.inputSha256,
      maskSha256:createHash('sha256').update(fullMask).digest('hex'),model:{id:'lungmask-R231',version:'0.2.20',
        weightsSha256:'d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f',modality:'CT',task:'synthetic-full-contract-only'},
      labels:[{id:1,name:'Synthetic outer'},{id:2,name:'Synthetic inner'}],limitations:['No trained inference'],
      fullVolume:{dimensions:[64,64,32],labelVoxels,coverage:'all-supplied-frames',clinicalStatus:'unverified_research_draft'}},
      metrics:{device:'cpu',inferenceSeconds:0,totalSeconds:0,peakRssMiB:0,inferenceImplementation:'full-ct-streamed-r231/v2',platform:'Linux',machine:'x86_64'}});
  });
  const fullPanel=page.getByRole('group',{name:'Полная КТ через локальный R231',exact:true});
  await page.locator('details[aria-label="Полная КТ через локальный R231"]>summary').click();
  await fullPanel.getByLabel('Токен полного локального задания',{exact:true}).fill('synthetic-full-session-token-123456789');
  await fullPanel.locator('input[type=checkbox]').check();
  await fullPanel.getByRole('button',{name:'Обработать всю КТ локально',exact:true}).click();
  await fullPanel.getByRole('button',{name:'Скачать Evidence полной КТ',exact:true}).waitFor({timeout:60000});
  assert.equal(fullDeleted,false);assert.equal(fullMaskGets,0);assert.equal(await page.locator('.ora-mpr').count(),0);
  const fullDownload=page.waitForEvent('download');await fullPanel.getByRole('button',{name:'Скачать Evidence полной КТ',exact:true}).click();
  const fullPath=join(fixture,'full-ct-report.json');await (await fullDownload).saveAs(fullPath);const fullReport=JSON.parse(await readFile(fullPath,'utf8'));
  assert.equal(fullReport.schema,'opus-full-ct-evidence/v1');assert.equal(fullReport.request.frameCount,32);
  assert.equal(JSON.stringify(fullReport).includes('synthetic-full-session-token'),false);
  await slabPanel.getByLabel('Первый срез фрагмента КТ',{exact:true}).fill('20');await slabPanel.getByLabel('Последний срез фрагмента КТ',{exact:true}).fill('27');
  await slabPanel.getByRole('button',{name:'Открыть фрагмент в MPR',exact:true}).click();
  const showFullMask=page.getByRole('button',{name:'Показать маску полного задания для этого фрагмента',exact:true});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Показать маску полного задания для этого фрагмента'&&!b.disabled));
  await showFullMask.click();await page.locator('.ora-mask-error').waitFor();assert.match(await page.locator('.ora-mask-error').innerText(),/Чужой/);
  fullSlabBad=false;await showFullMask.click();await page.locator('.ora-mask-success').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.ora-mpr-mask-overlay')].every(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=4)if(d[i])return true;return false;
  }));
  await fullPanel.getByRole('button',{name:'Удалить полное задание и маску',exact:true}).click();
  await fullPanel.getByText('Полное задание удалено.',{exact:true}).waitFor();assert.equal(fullDeleted,true);
  await page.locator('.ora-mask-success').waitFor({state:'detached'});assert.equal(fullMaskGets,0);
  console.log('Full CT: actual per-plane DICOM/rescale/SHA streaming, full job retained without full mask download, Evidence without token, forged crop refused, bound crop in MPR and explicit job/overlay deletion (mocked inference)');
  // Actual local OCR, separate synthetic text fixture. No clinical model/data.
  await page.reload({waitUntil:'networkidle'});
  const textPixels=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,64,64);
    ctx.fillStyle='black';ctx.font='18px Arial';ctx.fillText('TEST',5,24);ctx.fillText('ТЕСТ',5,48);
    const rgba=ctx.getImageData(0,0,64,64).data;return Array.from({length:4096},(_,i)=>Math.round(rgba[i*4]/255*1400));
  });
  const textDicom=await readFile(files[0]),textAt=textDicom.length-64*64*2;
  textPixels.forEach((v,i)=>textDicom.writeUInt16LE(v,textAt+i*2));
  const ocrDicomPath=join(fixture,'synthetic-ocr.dcm');await writeFile(ocrDicomPath,textDicom);
  await page.locator('input[accept*=".dcm"]').setInputFiles([ocrDicomPath,...files.slice(1)]);
  const planButton=page.getByRole('button',{name:'Сформировать план',exact:true});
  await page.waitForFunction(()=>{const b=document.querySelector('.ora-vision-plan-controls button');return b&&!b.disabled;});
  await planButton.click();await page.locator('.ora-vision-plan-thumbnail').nth(3).waitFor();
  const ocrPrivacy=page.getByRole('region',{name:'Подготовка обезличенных кадров',exact:true});
  await ocrPrivacy.getByRole('button',{name:'Подготовить копии без метаданных',exact:true}).click();
  const ocrPanel=ocrPrivacy.getByRole('region',{name:'Локальный поиск надписей',exact:true});
  const ocrRequests=[],watchOcr=request=>ocrRequests.push({url:request.url(),method:request.method(),body:request.postData()});
  page.on('request',watchOcr);
  await ocrPanel.getByRole('button',{name:'Найти надписи локально',exact:true}).click();
  assert.equal(await ocrPrivacy.getByRole('button',{name:'Скачать журнал без пикселей JSON',exact:true}).isDisabled(),true);
  await ocrPanel.getByRole('button',{name:'Отменить OCR',exact:true}).click();
  await ocrPanel.getByText(/OCR отменён/).waitFor();
  assert.equal(await ocrPrivacy.getByRole('button',{name:'Скачать локальный пакет копий JSON',exact:true}).isDisabled(),true);
  await ocrPanel.getByRole('button',{name:'Найти надписи локально',exact:true}).click();
  await ocrPanel.getByText(/Областей с надписями:/).waitFor({timeout:35000});
  const detected=await ocrPanel.locator('li').count();assert.ok(detected>=2&&detected<=32,'Actual RU/EN OCR must detect synthetic words');
  assert.doesNotMatch(await ocrPanel.innerText(),/TEST|ТЕСТ/); // recognized text never shown
  const ocrTextReview=ocrPrivacy.getByRole('checkbox',{name:'Проверил копию: идентифицирующих надписей нет',exact:true});
  await ocrTextReview.dispatchEvent('click');
  assert.equal(await ocrTextReview.isChecked(),false);await ocrPrivacy.getByText(/Сначала скройте найденные надписи/).waitFor();
  await ocrPanel.getByRole('button',{name:'Оставить надписи: не идентифицируют пациента',exact:true}).click();
  await ocrTextReview.check();assert.equal(await ocrPanel.locator('li').count(),detected); // acknowledgement retains detections
  await ocrPanel.getByRole('button',{name:'Найти надписи локально',exact:true}).click();
  await ocrPanel.getByText(/Областей с надписями:/).waitFor({timeout:35000});
  assert.equal(await ocrTextReview.isChecked(),false); // a new scan clears the previous acknowledgement
  await ocrPanel.getByRole('button',{name:'Выбрать область 1',exact:true}).click();
  const regionX=Number(await ocrPrivacy.getByRole('spinbutton',{name:'X',exact:true}).inputValue());
  const regionY=Number(await ocrPrivacy.getByRole('spinbutton',{name:'Y',exact:true}).inputValue());
  const unchangedSource=await page.locator('.ora-vision-plan-thumbnail').first().getAttribute('src');
  await ocrPanel.getByRole('button',{name:'Скрыть найденные надписи',exact:true}).click();
  await ocrPrivacy.getByText(new RegExp('Скрытых областей: '+detected)).waitFor();
  assert.equal(await page.locator('.ora-vision-plan-thumbnail').first().getAttribute('src'),unchangedSource);
  const black=await page.evaluate(async({x,y})=>{
    const img=document.querySelector('.ora-privacy-preview');await img.decode();
    const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    return [...ctx.getImageData(x,y,1,1).data];
  },{x:regionX,y:regionY});assert.deepEqual(black,[0,0,0,255]);
  assert.equal(await ocrPrivacy.getByRole('checkbox',{name:'Проверил копию: идентифицирующих надписей нет',exact:true}).isChecked(),false);
  await ocrPanel.getByRole('button',{name:'Найти надписи локально',exact:true}).click();
  await ocrPanel.getByText(/Областей с надписями: 0/).waitFor({timeout:35000});
  const ocrStatus=await savePrivacyJson(ocrPrivacy,'Скачать локальный статус без пикселей JSON','privacy-ocr-readiness.json');
  assert.equal(ocrStatus.frames[0].ocrState,'no-text-found');assert.equal(ocrStatus.frames[0].regionCount,0);
  assert.equal(ocrStatus.frames[0].textReviewed,false);assert.equal(ocrStatus.localReviewDone,false);
  assert.equal(ocrStatus.transmissionPermitted,false);assert.doesNotMatch(JSON.stringify(ocrStatus),/TEST|ТЕСТ|pngBase64|confidence/);
  // Empty OCR output still never checks the human review box or releases cloud.
  assert.equal(await ocrPrivacy.getByRole('checkbox',{name:'Проверил копию: идентифицирующих надписей нет',exact:true}).isChecked(),false);
  assert.equal(await ocrPrivacy.getByRole('button',{name:'Скачать локальный пакет копий JSON',exact:true}).isDisabled(),true);
  page.off('request',watchOcr);
  const ocrJournal=await savePrivacyJson(ocrPrivacy,'Скачать журнал без пикселей JSON','privacy-ocr-journal.json');
  assert.deepEqual(ocrJournal.journal.events.map(e=>e.action.kind),['ocr-started','ocr-cancelled','ocr-started','ocr-completed',
    'text-retained','review-set','ocr-started','ocr-completed','redacted','ocr-started','ocr-completed']);
  assert.equal(ocrJournal.journal.events.at(-1).action.regionCount,0);
  assert.equal(ocrJournal.journal.events[3].action.regionCount,detected);
  assert.doesNotMatch(JSON.stringify(ocrJournal),/TEST|ТЕСТ|pngBase64|sopInstanceUid|clinicalContext|errorMessage/);
  assert.ok(ocrRequests.some(r=>r.url.endsWith('/eng.traineddata.gz')));
  assert.ok(ocrRequests.some(r=>r.url.endsWith('/rus.traineddata.gz')));
  const unexpectedOcrRequests=ocrRequests.filter(r=>!(r.method==='GET'&&!r.body&&(r.url.startsWith(baseUrl+'/api/privacy-ocr/assets/v1/')||
    r.url.startsWith(baseUrl+'/_next/static/')||r.url===baseUrl+'/favicon.ico'|| // background viewer/static assets, never uploads
    r.url.startsWith('data:application/octet-stream;base64,AGFzbQ')))); // embedded public WASM; no network destination
  assert.deepEqual(unexpectedOcrRequests.map(r=>{const u=new URL(r.url);return {method:r.method,protocol:u.protocol,
    path:u.protocol==='http:'||u.protocol==='https:'?u.pathname:'local-data',hasBody:!!r.body};}),[]);
  assert.equal((await page.request.post(baseUrl+'/api/privacy-ocr/assets/v1/host-worker.js',{data:{pixels:'synthetic'}})).status(),405);
  assert.equal((await page.request.get(baseUrl+'/api/privacy-ocr/assets/v1/package.json')).status(),404);
  await ocrPrivacy.screenshot({path:join(results,'synthetic-privacy-ocr.png')});
  console.log('Actual local RU/EN Tesseract OCR: synthetic words, cancel/restart, SHA-bound boxes, raster batch redaction, empty rescan still unverified, same-origin GET assets only and no pixel/text upload');
  assert.deepEqual(errors,[]);
  console.log('PASS: overlays, volumes, full scalar NIfTI export (all voxels), checksummed model-result handoff, wrong-package rejection, 3D/MIP controls and resource reset on 2D/MPR. No trained medical model inference performed; actual OCR used synthetic text only.');
}catch(e){console.error('FAIL:',e);console.error('PAGE ERRORS:',errors);console.error('SERVER:',logs);if(page){console.error('ALERTS:',await page.locator('[role=alert]').allTextContents());await page.screenshot({path:join(results,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await rm(fixture,{recursive:true,force:true});}
