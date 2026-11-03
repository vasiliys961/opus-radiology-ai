import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStructuredRadiologyReview,bindStructuredRadiologyReview,validSourceRadiologyReview,type StructuredRadiologyReview} from './structured-radiology-review.ts';
import {appendGeminiVolumeReceipt,makeSafeVolumeOpusInput} from './full-volume-receipts.ts';
import {planBudgetedVisionReview} from './vision-budget-plan.ts';
import {createVisionBatches} from './vision-batch-ledger.ts';
import {synthesizeSafeFullVolumeOpus,validateSafeFullVolumeOpusInput} from './full-volume-opus-synthesis.ts';
const review:StructuredRadiologyReview={structures:[{imageIds:['frame-1','frame-2'],anatomy:'Плевральные полости',visibility:'partial',description:'Видимые задние отделы на двух уровнях.',importantNegatives:['На представленных уровнях крупного скопления жидкости не видно.'],limitations:'Другие уровни не представлены.'}],imageQuality:['frame-1','frame-2'].map(imageId=>({imageId,quality:'diagnostic',limitations:'Только два аксиальных уровня.'}))};
test('structured description binds organ coverage, bounded negatives and quality to original numbers',()=>{
 assert.deepEqual(parseStructuredRadiologyReview(review,['frame-1','frame-2']),review);
 const bound=bindStructuredRadiologyReview(review,[59,68]);
 assert.deepEqual(bound.structures[0].sliceNumbers,[60,69]);assert.deepEqual(bound.imageQuality.map(q=>q.sliceNumber),[60,69]);
 assert.equal(validSourceRadiologyReview(bound,[60,69]),true);
 assert.equal(validSourceRadiologyReview(bound,[1,2]),false);
 for(const raw of [{...review,patientName:'forbidden'},{...review,imageQuality:review.imageQuality.slice(0,1)},{...review,structures:review.structures.map(s=>({...s,imageIds:['frame-99']}))},{...review,structures:review.structures.map(s=>({...s,imageIds:['frame-1']}))},{...review,structures:review.structures.map(s=>({...s,visibility:'not_assessed'}))},{...review,imageQuality:review.imageQuality.map(q=>({...q,quality:'non_diagnostic'}))}])assert.throws(()=>parseStructuredRadiologyReview(raw,['frame-1','frame-2']));
});
test('rich morphology, visible structures and negative scope survive receipts and final Opus input',async()=>{
 const plan=planBudgetedVisionReview({frameCount:150,maxGeminiUSD:2});plan.overviewIndices=[59,68];
 const batches=createVisionBatches(plan,4);
 const receipts=appendGeminiVolumeReceipt([],batches,0,{schema:'opus-gemini-volume-batch/v1',model:'google/gemini-3.8-flash',modality:'CT',imagesReviewed:2,reviewedImageIds:['frame-1','frame-2'],observations:[{id:'f1',imageId:'frame-1',anatomy:'Лёгочная паренхима',sign:'Участок уплотнения',uncertainty:'Природа не установлена',localization:'На изображении слева, сзади',morphology:'Линейное субплевральное уплотнение'}],structuredReview:review,visualRecheck:[],limitations:['Не весь объём'],receipt:{inputTokens:1000,outputTokens:500},clinicalValidation:false,sourceBindingsLocalOnly:true});
 const input=makeSafeVolumeOpusInput('CT',plan,batches,receipts);input.sourceTotalFrames=150;input.sourceSliceNumbers=[60,69];input.reviewWindows={primary:'LUNG',additional:'SOFT'};
 assert.equal(validateSafeFullVolumeOpusInput(input),true);
 assert.equal(validateSafeFullVolumeOpusInput({...input,reviewWindows:{primary:'INVALID'}}),false);
 assert.equal(validateSafeFullVolumeOpusInput({...input,modality:'MR',reviewWindows:{primary:'LUNG',additional:'SOFT'}}),false);
 assert.equal(input.observations[0].morphology,'Линейное субплевральное уплотнение');
 assert.deepEqual(input.structuredReviews![0].structures[0].sliceNumbers,[60,69]);
 assert.equal(validateSafeFullVolumeOpusInput({...input,structuredReviews:[{...input.structuredReviews![0],imageQuality:[{sliceNumber:61,quality:'diagnostic',limitations:'Wrong slice'}]}]}),false);
 await synthesizeSafeFullVolumeOpus(input,async req=>{
  const payload=JSON.stringify(req.messages);assert.match(payload,/Линейное субплевральное/);assert.match(payload,/крупного скопления жидкости/);assert.match(payload,/sourceBoundStructuredGeminiReviews/);const user=JSON.parse(req.messages[1].content as string);assert.deepEqual(user.suppliedDisplayWindows,{primary:'LUNG',additional:'SOFT'});assert.match(payload,/Missing organ text means the reader did not document assessment/);assert.ok(!payload.includes('image_url'));
  return {choices:[{message:{content:JSON.stringify({summary:'ИССЛЕДОВАНИЕ: Тестовая КТ.\nМЕТОДИКА: Два представленных уровня.\nОПИСАНИЕ: Структурированные наблюдения требуют проверки врачом.\nЗАКЛЮЧЕНИЕ: Предварительный тестовый протокол, не клинический результат.\nРЕКОМЕНДАЦИИ: Проверка исходных изображений врачом.',limitations:['Partial']})}}],usage:{prompt_tokens:1200,completion_tokens:200}};
 });
});
