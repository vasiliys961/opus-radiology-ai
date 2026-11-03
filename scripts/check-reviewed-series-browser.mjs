/** Actual DICOM/UI/PNG/OCR; synthetic source and mocked providers. Zero paid calls. */
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const temp=await mkdtemp(join(tmpdir(),'opus-reviewed-series-'));
execFileSync(process.execPath,['scripts/generate-segmentation-phantom.mjs',temp,'CT','rescale-hu','CHEST'],{stdio:'pipe'});
const browser=await chromium.launch({headless:true,...(process.env.OPUS_BROWSER_EXECUTABLE?{executablePath:process.env.OPUS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
const noFocal=process.env.OPUS_TEST_NO_FOCAL==='1';
const base=process.env.OPUS_TEST_BASE_URL??'http://localhost:3000';
assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
let page;
try{
 page=await browser.newPage();page.setDefaultTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let gemini=0,opus=0;const reviewed=[];
 await page.route('**/api/ai/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='GET')return route.fulfill({json:{enabled:true,workstationConnected:true,productionPatientCloudRelease:false}});
  let body=route.request().postDataJSON();
  if(path==='/api/ai/approved-volume-gemini-batch'){
   if(process.env.OPUS_TEST_PARTIAL==='1'&&gemini===1)return route.fulfill({status:503,json:{error:'Synthetic stop'}});
   assert.equal(body.acknowledgePixelIdentityReviewed,true);
   assert.equal(body.packet.frames.length,gemini===2?1:4);
   assert.ok(body.packet.frames.every(f=>f.width===f.height*2),'Paired source-grid windows on every approved frame');
   assert.equal(body.frameContext.technical.window,'LUNG');assert.equal(body.frameContext.technical.additionalWindow,'SOFT');
   assert.ok(body.packet.frames.every(f=>f.pixelReviewSha256===f.sha256&&f.visualReviewSha256===f.sha256));
   assert.deepEqual(body.frameContext.sliceNumbers,gemini===0?[1,2,3,4]:gemini===1?[5,6,7,8]:[9]);
   reviewed.push(...body.frameContext.sliceNumbers);gemini++;
   return route.fulfill({json:{schema:'opus-gemini-volume-batch/v1',model:'google/gemini-3.8-flash',modality:'CT',
    imagesReviewed:body.packet.frames.length,visualRecheck:noFocal?[]:[{imageId:'frame-1',reason:'focal'}],observations:[{id:'test',imageId:'frame-1',anatomy:'synthetic phantom',sign:'Synthetic test observation',uncertainty:'Not patient data'}],
    limitations:['Synthetic source; no medical inference'],reviewedImageIds:body.packet.frames.map(f=>f.frameId),
    receipt:{inputTokens:600,outputTokens:100},clinicalValidation:false,sourceBindingsLocalOnly:true}});
  }
  if(path==='/api/ai/complete-volume-opus'){
   let visualReview;
   if(noFocal){assert.equal(body.visualReview,undefined,'No focal frames: no second paid Opus request');}else{
   assert.ok(body.visualReview,'Independent visual reread enabled by default');
   assert.deepEqual(body.visualReview.sliceNumbers,[1,5,9,2]);
   assert.equal(body.visualReview.packets.flatMap(p=>p.frames).length,4);
   assert.ok(body.visualReview.packets.flatMap(p=>p.frames).every(f=>f.pixelReviewSha256===f.sha256));
   visualReview={status:'completed',sliceNumbers:body.visualReview.sliceNumbers,observations:[{id:'blind',imageId:'frame-1',sliceNumber:1,anatomy:'synthetic phantom',sign:'Independent synthetic visual observation',uncertainty:'Not medical evidence'}],limitations:['Selected images only'],receipt:{inputTokens:500,outputTokens:100}};
   body=body.synthesis;
   }
   assert.equal(gemini,3);assert.equal(body.overviewReviewed,9);assert.equal(body.plannedFrames,9);
   assert.deepEqual(body.observations.map(f=>f.sliceNumber),[1,5,9]);opus++;
   return route.fulfill({json:{schema:'opus-full-volume-radiologist/v1',modality:'CT',overviewReviewed:9,plannedFrames:9,
    visualReview,finalReport:'ИССЛЕДОВАНИЕ: Синтетическая КТ.\nМЕТОДИКА: Девять тестовых срезов.\nОПИСАНИЕ: Программная проверка последовательной обработки, без клинических выводов.\nЗАКЛЮЧЕНИЕ: Не медицинский результат.\nРЕКОМЕНДАЦИИ: Только проверка интерфейса.',
    limitations:['Mock model response'],clinicalValidation:false,physicianSignatureRequired:true,receipt:{inputTokens:1000,outputTokens:200}}});
  }
  throw Error('Unexpected provider route '+path);
 });
 await page.goto(base+'/viewer');
 await page.waitForFunction(()=>!document.querySelector('input[accept*=".dcm"]')?.disabled);
 const files=(await readdir(join(temp,'dicom'))).sort().slice(0,9).map(f=>join(temp,'dicom',f));
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 await page.getByRole('button',{name:'Анализировать исследование',exact:true}).click();
 const full=page.getByRole('region',{name:'Последовательный анализ выбранной серии',exact:true});await full.waitFor();
 assert.equal(gemini,0);assert.equal(opus,0);
 await full.getByRole('combobox',{name:'Окно для анализа КТ',exact:true}).selectOption('LUNG');
 await full.getByRole('combobox',{name:'Дополнительное окно рядом с основным',exact:true}).selectOption('SOFT');
 await full.getByRole('button',{name:'Подготовить всю серию к последовательному анализу'}).click();
 const partial=process.env.OPUS_TEST_PARTIAL==='1';
 const whole=full.getByRole('region',{name:'Проверка всей серии перед отправкой',exact:true});
 await whole.getByRole('button',{name:'Скрыть данные или проверить надписи на этих кадрах'}).waitFor({timeout:180000});
 // No provider POST while ALL groups are decoded and OCR checked locally.
 assert.equal(gemini,0);assert.equal(opus,0);
 if(process.env.OPUS_TEST_WHOLE_ATTESTATION!=='1'){
  await whole.getByRole('button',{name:'Скрыть данные или проверить надписи на этих кадрах'}).click();
  const editor=whole.getByRole('region',{name:'Подготовка обезличенных кадров',exact:true});
  await editor.getByRole('checkbox',{name:/Я просмотрел все кадры/}).check();
  await editor.getByRole('button',{name:'Сохранить проверку этих кадров'}).click();
  await editor.waitFor({state:'detached'});assert.equal(gemini,0);
 }
 while(process.env.OPUS_TEST_WHOLE_ATTESTATION!=='1'&&await whole.getByRole('button',{name:'Разобрать кадры с возможными надписями'}).count()){
  await whole.getByRole('button',{name:'Разобрать кадры с возможными надписями'}).click();
  const privacy=whole.getByRole('region',{name:'Подготовка обезличенных кадров',exact:true});
  await privacy.getByRole('checkbox',{name:/Я просмотрел все кадры/}).check();
  await privacy.getByRole('button',{name:'Сохранить проверку этих кадров'}).click();
  await privacy.waitFor({state:'detached'});
  assert.equal(gemini,0,'Exception resolution must remain entirely local');
 }
 await whole.getByRole('checkbox',{name:/Я просмотрел подготовленные копии всей серии/}).check();
 await whole.getByRole('button',{name:'Отправить всю проверенную серию в анализ'}).click();
 if(partial){
  await full.getByText(/Группа срезов не подтверждена сервером/).waitFor();
  assert.deepEqual(reviewed,[1,2,3,4]);assert.equal(opus,0);
  assert.equal(await full.getByRole('textbox',{name:/Предварительное заключение/}).count(),0);
  await full.getByRole('button',{name:'Сохранить полученные наблюдения TXT'}).waitFor();
  assert.match(await full.innerText(),/Не оценено: 5/);
  console.log('PASS partial: 4/9 reviewed, 5 not assessed, no final Opus, partial TXT available, no automatic repeat billing.');
 }else{
 await full.getByRole('textbox',{name:/Предварительное заключение/}).waitFor();
 if(!noFocal)await full.getByRole('region',{name:'Независимая визуальная перепроверка Opus',exact:true}).getByText(/Независимо просмотрены срезы/).waitFor();
 assert.deepEqual(reviewed,[1,2,3,4,5,6,7,8,9]);assert.equal(opus,1);assert.deepEqual(errors,[]);
 // Physician measurements use ORIGINAL 64x64 DICOM, not the paired outgoing PNG.
 await full.getByText('Находки и переход к исходным срезам',{exact:true}).click();
 await full.getByRole('button',{name:'Проверить и измерить находку',exact:true}).first().click();
 const measuring=full.getByRole('region',{name:'Проверка и измерение находки врачом',exact:true});
 const accept=measuring.getByRole('button',{name:'Принять находку с измерениями врача'});
 assert.equal(await accept.isDisabled(),true);
 const caliper=measuring.getByRole('img',{name:'Нажмите первую и вторую точку расстояния на исходном DICOM-срезе'});
 await caliper.waitFor();const box=await caliper.boundingBox();
 await caliper.click({position:{x:box.width*.25,y:box.height*.5}});
 await caliper.click({position:{x:box.width*.5,y:box.height*.5}});
 await measuring.getByRole('button',{name:/Сохранить измерение/}).click();assert.equal(await accept.isDisabled(),true);
 const roi=measuring.getByRole('img',{name:'Исходный КТ-срез, нажмите в центре области измерения'});
 const roiBox=await roi.boundingBox();await roi.click({position:{x:roiBox.width*.5,y:roiBox.height*.5}});
 await measuring.getByRole('button',{name:/Сохранить этот ROI/}).click();await accept.click();
 const accepted=full.getByRole('region',{name:'Принятые врачом измерения',exact:true});
 assert.match(await accepted.innerText(),/16.00 мм/);assert.match(await accepted.innerText(),/HU/);
 await accepted.getByRole('button',{name:'Добавить измерения в текст заключения'}).click();
 assert.match(await full.getByRole('textbox',{name:/Предварительное заключение/}).inputValue(),/16.00 мм/);
 assert.deepEqual(errors,[]);
 console.log('PASS: 9 native synthetic DICOM frames, one series release, automatic 4+4+1, three mocked Gemini calls, one final mocked Opus, exact coverage/source links. No paid calls or clinical validation.');
 }
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();await rm(temp,{recursive:true,force:true});}
