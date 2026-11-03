/** Synthetic DICOM + actual local decoding/OCR/UI. Provider POSTs are mocked: no paid calls. */
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const temp=await mkdtemp(join(tmpdir(),'opus-recovery-'));
execFileSync(process.execPath,['scripts/generate-segmentation-phantom.mjs',temp,'CT','rescale-hu','CHEST'],{stdio:'pipe'});
const browser=await chromium.launch({headless:true,executablePath:process.env.OPUS_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const partial=process.env.OPUS_TEST_PARTIAL_REPORT==='1';
try{
 const page=await browser.newPage();page.setDefaultTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let attempts=0,failed=false,finals=0,translations=0,questions=0;const accepted=[];
 await page.route('**/api/ai/**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{enabled:true,workstationConnected:true}});
  const b=route.request().postDataJSON(),path=new URL(route.request().url()).pathname;
  if(path.endsWith('approved-volume-gemini-batch')){
   attempts++;const n=b.frameContext.sliceNumbers;
   assert.deepEqual(n,attempts===1?[2,4,5,6]:[7,8,9]);
   if(attempts===2&&!failed){failed=true;return route.fulfill({status:502,json:{error:'RESPONSE_TRUNCATED',message:'Gemini не завершил ответ в допустимом объёме'}});}
   accepted.push(...n);
   return route.fulfill({json:{schema:'opus-gemini-volume-batch/v1',model:'google/gemini-3.8-flash',modality:'CT',imagesReviewed:n.length,
    observations:[{id:'o',imageId:'frame-1',anatomy:'Лёгкие',sign:'Синтетический признак',uncertainty:'Не медицинский результат'}],
    visualRecheck:[{imageId:'frame-1',reason:'uncertain'}],limitations:['Synthetic'],reviewedImageIds:b.packet.frames.map(f=>f.frameId),receipt:{inputTokens:500,outputTokens:100},clinicalValidation:false,sourceBindingsLocalOnly:true}});
  }
  assert.ok(path.endsWith('complete-volume-opus'));
  if(b.mode){
   assert.equal(b.acknowledgeReviewedText,true);assert.equal(b.clinicalContext,'Кашель 3 недели');
   if(b.mode==='translate'){translations++;return route.fulfill({json:{text:'PROVISIONAL REPORT: Synthetic. Incomplete source coverage. Physician review required.',physicianReviewRequired:true,receipt:{inputTokens:50,outputTokens:20}}});}
   questions++;assert.equal(b.question,'Что уточнить?');return route.fulfill({json:{text:'Синтетический ответ: нужен просмотр исходных срезов.',physicianReviewRequired:true,receipt:{inputTokens:50,outputTokens:20}}});
  }
  finals++;const s=b.synthesis??b;
  assert.deepEqual(s.sourceSliceNumbers,accepted);assert.equal(s.sourceTotalFrames,9);assert.equal(s.plannedFrames,accepted.length);
  assert.equal(s.clinicalContext,'Кашель без идентификаторов');
  assert.ok(b.visualReview.sliceNumbers.every(n=>accepted.includes(n)));
  assert.ok(s.observations.every(o=>accepted.includes(o.sliceNumber)));
  return route.fulfill({json:{schema:'opus-full-volume-radiologist/v1',modality:'CT',overviewReviewed:accepted.length,plannedFrames:accepted.length,
   finalReport:'ИССЛЕДОВАНИЕ: Синтетическая КТ.\nМЕТОДИКА: Только выбранные срезы.\nОПИСАНИЕ: Программный тест.\nЗАКЛЮЧЕНИЕ: Не медицинский результат.\nРЕКОМЕНДАЦИИ: Проверка врачом.\nОценено '+accepted.length+' из 9; остальные срезы не оценены.',
   limitations:['synthetic'],clinicalValidation:false,physicianSignatureRequired:true,receipt:{inputTokens:100,outputTokens:50},
   visualReview:{status:'completed',sliceNumbers:b.visualReview.sliceNumbers,observations:[],limitations:[],receipt:{inputTokens:100,outputTokens:50}}}});
 });
 await page.goto('http://localhost:3000/viewer');
 await page.waitForFunction(()=>!document.querySelector('input[accept*=".dcm"]')?.disabled);
 await page.locator('input[accept*=".dcm"]').setInputFiles((await readdir(join(temp,'dicom'))).sort().slice(0,9).map(f=>join(temp,'dicom',f)));
 await page.getByRole('button',{name:'Анализировать исследование',exact:true}).click();
 const full=page.getByRole('region',{name:'Последовательный анализ выбранной серии',exact:true});await full.waitFor();
 await full.getByRole('combobox',{name:'Какие срезы анализировать',exact:true}).selectOption('custom');
 await full.getByRole('textbox',{name:'Номера срезов',exact:true}).fill('2, 4-9');
 await full.getByRole('textbox',{name:'Клинические данные для заключения (необязательно)',exact:true}).fill('Кашель без идентификаторов');
 await full.getByRole('button',{name:'Подготовить выбранные срезы к анализу',exact:true}).click();
 const review=full.getByRole('region',{name:'Проверка всей серии перед отправкой',exact:true});
 await review.getByRole('checkbox',{name:/Я просмотрел выбранные подготовленные копии/}).waitFor({timeout:180000});
 assert.equal(attempts,0);assert.match(await review.innerText(),/2, 4, 5, 6/);
 await review.getByRole('checkbox',{name:/Я просмотрел выбранные подготовленные копии/}).check();
 await review.getByRole('button',{name:'Отправить всю проверенную серию в анализ',exact:true}).click();
 await full.getByText(/Анализ остановлен на срезах 7, 8, 9/).waitFor();
 await full.getByRole('textbox',{name:/Предварительное заключение/}).waitFor();
 assert.equal(attempts,2);assert.equal(finals,1);assert.deepEqual(accepted,[2,4,5,6]);
 if(!partial){await full.getByRole('button',{name:'Продолжить обработку оставшихся срезов',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea')?.value===undefined||document.body.textContent.includes('Оценено 7 из 9'));}
 await full.getByRole('textbox',{name:/Предварительное заключение/}).waitFor();
 assert.equal(attempts,partial?2:3);assert.equal(finals,partial?1:2);assert.deepEqual(accepted,partial?[2,4,5,6]:[2,4,5,6,7,8,9]);
 if(!partial)assert.match(await full.innerText(),/Gemini \+ Opus: около \$0\.01/,'Both partial and final Opus receipts must be included');
 const discussion=full.getByRole('region',{name:'Перевод и обсуждение заключения',exact:true});
 await discussion.getByRole('textbox',{name:'Клинические данные без идентификации пациента',exact:true}).fill('Кашель 3 недели');
 await discussion.getByRole('checkbox').check();
 await discussion.getByRole('button',{name:'Перевести заключение на английский',exact:true}).click();
 await discussion.getByRole('textbox',{name:/English provisional report/}).waitFor();
 await discussion.getByRole('textbox',{name:'Вопрос по результату',exact:true}).fill('Что уточнить?');
 await discussion.getByRole('button',{name:'Обсудить с Opus',exact:true}).click();
 await discussion.getByText(/Синтетический ответ: нужен просмотр/).waitFor();assert.equal(translations,1);assert.equal(questions,1);
 await page.screenshot({path:'/tmp/opus-study-'+(partial?'auto-partial':'auto-resume')+'.png',fullPage:true});
 await full.getByRole('textbox',{name:/Предварительное заключение/}).fill('Изменённый черновик');
 assert.equal(await discussion.getByRole('textbox',{name:/English provisional report/}).count(),0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({syntheticOnly:true,paidCalls:0,scenario:partial?'partial-report':'resume',originalSlices:accepted,geminiAttempts:attempts,finals,translations,questions,staleTranslationCleared:true}));
}finally{await browser.close();await rm(temp,{recursive:true,force:true});}
