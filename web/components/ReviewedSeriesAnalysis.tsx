"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import type {DicomSeries} from '../lib/dicom-series';
import type {VisionPrivacyPacket} from '../lib/vision-privacy';
import {MAX_PRIVACY_PIXELS} from '../lib/vision-privacy';
import {planOriginalVolumeSource} from '../lib/vision-volume-source';
import {decodeDicomPreview} from '../lib/dicom-lite';
import {appendGeminiVolumeReceipt,canPayForNextBatch,makeSafeVolumeOpusInput,volumeLedger,type LocalVolumeReceipt} from '../lib/full-volume-receipts';
import {volumeTechnicalContext} from '../lib/volume-technical-context';
import type {VolumeGeminiBatchResult} from '../lib/approved-volume-batch-review';
import type {FullVolumeOpusResult} from '../lib/full-volume-opus-synthesis';
import type {SanitizedDetectorBundle} from '../lib/detector-consilium-evidence';
import {CT_REVIEW_WINDOWS,suggestCtReviewWindows,type CtReviewWindow} from '../lib/ct-review-window';
import {selectTargetedVisualInput,type TargetedVisualInput} from '../lib/opus-targeted-visual-review';
import type {ClnVerifiedLocalEvidence} from '../lib/cln-physician-local-review';
import {clnDetectorRecheck,type BoundDetectorRecheck} from '../lib/cln-detector-recheck';
import FindingMeasurementReview,{type AcceptedFindingMeasurement} from './FindingMeasurementReview';
import MrSeriesComparison from './MrSeriesComparison';
import StudyPrivacyReview from './StudyPrivacyReview';
import StudyReportDiscussion from './StudyReportDiscussion';
import {estimateStudyCost,opusUsageEstimate} from '../lib/study-cost-estimate';
import {splitReviewedTransport} from '../lib/reviewed-packet-transport';
import type {VisionBatch} from '../lib/vision-batch-ledger';
import {parseStudySliceSelection} from '../lib/study-slice-selection';
type Stage='idle'|'preparing'|'review'|'gemini'|'interrupted'|'opus'|'completed';
export default function ReviewedSeriesAnalysis({series,files,onOpenSlice,detectorStage,detectorEvidence,allSeries=[],clnVerifiedLocal=null}:{
 clnVerifiedLocal?:ClnVerifiedLocalEvidence|null;allSeries?:readonly DicomSeries[];series:DicomSeries;files:ReadonlyMap<string,File>;onOpenSlice:(id:string)=>void;
 detectorStage:'idle'|'running'|'completed'|'vision-only'|'cancelled';
 detectorEvidence:SanitizedDetectorBundle|null;
}){
 const [executionBatches,setExecutionBatches]=useState<VisionBatch[]|null>(null);
 const [opusSpent,setOpusSpent]=useState(0);
 const [stopReason,setStopReason]=useState('');
 const [clinicalContext,setClinicalContext]=useState('');
 const [visualMode,setVisualMode]=useState('selected'),[physicianSlices,setPhysicianSlices]=useState('');
 const [selection,setSelection]=useState('all'),[selectionText,setSelectionText]=useState('1');
 const [measureSource,setMeasureSource]=useState<{sourceIndex:number;findingKey:string}|null>(null);
 const [acceptedMeasurements,setAcceptedMeasurements]=useState<AcceptedFindingMeasurement[]>([]);
 const [additionalWindow,setAdditionalWindow]=useState<CtReviewWindow|'NONE'>(()=>suggestCtReviewWindows(series).additional);
 const [reviewWindow,setReviewWindow]=useState<CtReviewWindow>(()=>suggestCtReviewWindows(series).primary),[visualEnabled,setVisualEnabled]=useState(true);
 const attemptedDetectorKeys=useRef(new Set<string>());
 const detectorKey=(a:BoundDetectorRecheck)=>[a.candidateId,a.sourceIndex,a.xFraction,a.yFraction].join(':');
 const approvedPackets=useRef<VisionPrivacyPacket[]>([]);
 const detectorLocations=useMemo(()=>{try{return {anchors:clnDetectorRecheck(series,clnVerifiedLocal),error:false};}catch{return {anchors:[] as BoundDetectorRecheck[],error:true};}},[series,clnVerifiedLocal]);
 const locationsRef=useRef(detectorLocations);
 useEffect(()=>{locationsRef.current=detectorLocations;},[detectorLocations]);
 const targetedVisual=useRef<TargetedVisualInput|null>(null);
 const [opusUsage,setOpusUsage]=useState<FullVolumeOpusResult['receipt']>();
 const [visualResult,setVisualResult]=useState<FullVolumeOpusResult['visualReview']>();
 const [stage,setStage]=useState<Stage>('idle'),[notice,setNotice]=useState('');
 const noticeElement=useRef<HTMLParagraphElement|null>(null);
 useEffect(()=>{if(stage==='interrupted')noticeElement.current?.scrollIntoView({block:'center',behavior:'smooth'});},[stage,notice]);
 const [budget,setBudget]=useState(2),[connected,setConnected]=useState(false);
 const [connectionAttempt,setConnectionAttempt]=useState(0);

 const [receipts,setReceipts]=useState<LocalVolumeReceipt[]>([]),[report,setReport]=useState('');
 const ctl=useRef<AbortController|null>(null),sending=useRef(false);
 const detector=useRef({stage:detectorStage,evidence:detectorEvidence});
 useEffect(()=>{detector.current={stage:detectorStage,evidence:detectorEvidence};},[detectorStage,detectorEvidence]);
 const selectionResult=useMemo(()=>{try{return {indices:selection==='all'?series.members.map((_,i)=>i):parseStudySliceSelection(selectionText,series.members.length),error:''};}catch(e){return {indices:[] as number[],error:e instanceof Error?e.message:'Ошибка выбора срезов'};}},[selection,selectionText,series]);
 const physicianSelection=useMemo(()=>{try{const indices=physicianSlices.trim()?parseStudySliceSelection(physicianSlices,series.members.length):[];if(indices.length>16)throw Error('Для дополнительной проверки выберите не более 16 срезов.');if(indices.some(n=>!selectionResult.indices.includes(n)))throw Error('Добавьте указанные для Opus срезы в основной выбор анализа.');return {indices,error:''};}catch(e){return {indices:[] as number[],error:e instanceof Error?e.message:'Ошибка выбора для Opus'};}},[physicianSlices,selectionResult,series]);
 const basePlan=useMemo(()=>{try{return planOriginalVolumeSource(series,{maxGeminiUSD:budget,selectedIndices:selectionResult.error?undefined:selectionResult.indices});}catch{return null;}},[series,budget,selectionResult]);
 const plan=useMemo(()=>basePlan?(executionBatches?{...basePlan,batches:executionBatches}:basePlan):null,[basePlan,executionBatches]);
 useEffect(()=>{setExecutionBatches(null);},[selection,selectionText]);
 useEffect(()=>{
  ctl.current?.abort();ctl.current=null;sending.current=false;targetedVisual.current=null;approvedPackets.current=[];attemptedDetectorKeys.current=new Set();setVisualResult(undefined);setOpusUsage(undefined);setReviewWindow(suggestCtReviewWindows(series).primary);setAdditionalWindow(suggestCtReviewWindows(series).additional);
  setExecutionBatches(null);setOpusSpent(0);setStopReason('');setClinicalContext('');setSelection('all');setSelectionText('1');setVisualMode('selected');setPhysicianSlices('');setMeasureSource(null);setAcceptedMeasurements([]);setStage('idle');setReceipts([]);setReport('');
 },[series,files]);
 useEffect(()=>{const c=new AbortController();void fetch('/api/ai/deidentified-openrouter-review',{
  cache:'no-store',credentials:'same-origin',signal:c.signal}).then(async r=>r.ok?r.json():null)
  .then(d=>{if(!c.signal.aborted){setConnected(d?.enabled===true&&d?.workstationConnected===true);
   setNotice(d?.enabled&&d?.workstationConnected?'Локальное рабочее место подключено. Изображения передаются только после проверки и разрешения.':
    'Рабочее место не подключено к Gemini/Opus. Проверьте подключение в технической панели.');}})
  .catch(()=>{if(!c.signal.aborted)setNotice('Локальный сервер подключения недоступен.');});
  return()=>{c.abort();ctl.current?.abort();};
 },[connectionAttempt]);
 const ledger=plan?volumeLedger(plan.budget,plan.batches,receipts):null;
 async function prepare(index:number,signal:AbortSignal){
  if(!plan)throw Error('Исходная серия не подтверждена.');

  const next:string[]=[];
  for(const n of plan.batches[index].indices){
   signal.throwIfAborted();const file=files.get(series.members[n].id);
   if(!file||file.size>6*1024*1024)throw Error('Не удалось подготовить исходный срез '+(n+1)+'. Серия не будет помечена полностью просмотренной.');
   let url:string;
   try{url=(await decodeDicomPreview(file,{maxPixels:MAX_PRIVACY_PIXELS,reviewWindow,additionalWindow:additionalWindow==='NONE'?undefined:additionalWindow})).url;}
   catch{const {decodeCornerstoneVisionPreview}=await import('../lib/cornerstone-vision-preview');url=await decodeCornerstoneVisionPreview(file,MAX_PRIVACY_PIXELS,signal,reviewWindow,additionalWindow==='NONE'?undefined:additionalWindow);}
   signal.throwIfAborted();next.push(url);
  }
  return next;
 }
 function interrupted(e:unknown){setStage('interrupted');setNotice(ctl.current?.signal.aborted?
  'Анализ остановлен. Уже полученные наблюдения сохранены в этой вкладке.':e instanceof Error?e.message:'Анализ не завершён.');}
 async function start(){
  if(!plan||selectionResult.error||(visualEnabled&&physicianSelection.error)||sending.current||stage!=='idle')return;
  const c=new AbortController();ctl.current=c;
  setStage('review');
 }
 async function finalize(done:LocalVolumeReceipt[],signal:AbortSignal,executionPlan=plan){
  const plan=executionPlan;
  if(!plan)throw Error('План серии потерян.');
  const completedBatches=plan.batches.slice(0,done.length);
  const completedIndices=completedBatches.flatMap(b=>b.indices);
  const completedBudget={...plan.budget,overviewIndices:completedIndices,targetedIndices:[]};
  setStage('opus');setNotice('Opus составляет заключение по '+completedIndices.length+' из '+series.members.length+' исходных срезов. Остальные не оцениваются.');
  const pendingCln=()=>!locationsRef.current.error&&!locationsRef.current.anchors.length&&detector.current.evidence?.facts.some(f=>f.task==='lung_tumor'&&f.status==='completed'&&(f.candidateCount??0)>0);
  const began=Date.now();while((detector.current.stage==='running'||pendingCln())&&Date.now()-began<30000){
   signal.throwIfAborted();await new Promise(r=>setTimeout(r,250));
  }
  signal.throwIfAborted();const d=detector.current;
  attemptedDetectorKeys.current=new Set(locationsRef.current.anchors.map(detectorKey));
  const previousVisual=targetedVisual.current;
  targetedVisual.current=visualEnabled?selectTargetedVisualInput(approvedPackets.current.slice(0,done.length),done,locationsRef.current.anchors,completedIndices,visualMode==='selected'&&plan.budget.overviewIndices.length<=16,physicianSelection.indices):null;
  // Keep identical reviewed packets stable so explicit retries reuse the server checkpoint.
  targetedVisual.current?.packets.forEach((packet,i)=>{const previous=previousVisual?.packets[i];if(previous&&JSON.stringify(previous.frames)===JSON.stringify(packet.frames))packet.packetId=previous.packetId;});
  if(targetedVisual.current)targetedVisual.current.windows={primary:reviewWindow,...(additionalWindow==='NONE'?{}:{additional:additionalWindow})};
  const input=makeSafeVolumeOpusInput(series.modality as 'CT'|'MR',completedBudget,completedBatches,done,d.evidence,
   d.stage==='running'?'timeout':d.evidence?.facts.some(f=>f.status==='completed')?'completed':'unavailable');
  input.reviewWindows={primary:reviewWindow,...(additionalWindow==='NONE'?{}:{additional:additionalWindow})};
  if(clinicalContext.trim())input.clinicalContext=clinicalContext.trim();
  input.sourceTotalFrames=series.members.length;input.sourceSliceNumbers=completedIndices.map(n=>n+1);
  input.limitations=[...input.limitations.slice(0,28),'Оценены только '+completedIndices.length+' из '+series.members.length+' исходных срезов. Остальные не оценены; это не исключает патологию вне выборки.'];
  if(series.modality==='CT')input.limitations=[...input.limitations.slice(0,29),'Окна обзора: '+CT_REVIEW_WINDOWS[reviewWindow].label+(additionalWindow==='NONE'?'':'; справа '+CT_REVIEW_WINDOWS[additionalWindow].label)+'. Остальные окна не оценены.'];
  const excludedBySize=visualMode==='selected'&&plan.budget.overviewIndices.length<=16?completedIndices.filter(n=>!targetedVisual.current?.sliceNumbers.includes(n+1)):[];
  const physicianNotReviewed=physicianSelection.indices.filter(n=>!targetedVisual.current?.sliceNumbers.includes(n+1));
  if(visualEnabled&&physicianNotReviewed.length)input.limitations=[...input.limitations.slice(0,28),'Указанные врачом срезы не просмотрены Opus: '+physicianNotReviewed.map(n=>n+1).join(', ')+'. Они могли не пройти обзор Gemini или не поместиться в передачу.'];
  if(visualEnabled&&excludedBySize.length)input.limitations=[...input.limitations.slice(0,29),'В независимый просмотр Opus не поместились срезы '+excludedBySize.map(n=>n+1).join(', ')+'. Они требуют проверки врачом; ограничение размера передачи сохранено.'];
  if(done.some(r=>r.recheckIndices===undefined))input.limitations=[...input.limitations.slice(0,29),'Для части групп Gemini не вернул структурированный список спорных/очаговых кадров. Отсутствие списка не является отсутствием патологии.'];
  if(visualEnabled){const eligible=new Set([...done.flatMap(r=>r.recheckIndices??[]),...locationsRef.current.anchors.map(a=>a.sourceIndex)]).size;
   if(eligible>16)input.limitations=[...input.limitations.slice(0,29),'Для визуальной перепроверки отмечено '+eligible+' срезов. Из-за потолка 16 остальные '+(eligible-16)+' требуют проверки врачом.'];}
  if(!locationsRef.current.anchors.length&&d.evidence?.facts.some(f=>f.status==='completed'&&(f.candidateCount??0)>0))input.limitations=[...input.limitations.slice(0,29),'Положительные детекторные кандидаты переданы агрегированно, без координат. Автоматическая визуальная перепроверка именно детекторных расхождений не выполнена.'];
  const payload=targetedVisual.current?{synthesis:input,visualReview:targetedVisual.current}:input;
  const response=await fetch('/api/ai/complete-volume-opus',{method:'POST',credentials:'same-origin',signal,
   headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},body:JSON.stringify(payload)});
  if(!response.ok){const detail=await response.json().catch(()=>null);throw Error((response.status===429?'Opus занят или достигнут лимит итоговых запросов (2 за 20 минут). Повторите позже.':detail?.message??('Итоговое заключение не получено ('+response.status+').'))+' Наблюдения Gemini сохранены; повторного запуска Gemini не требуется.'+(detail?.visualReviewPreserved?' Визуальная перепроверка Opus сохранена на сервере на 10 минут: при повторе того же запроса она не оплачивается заново.':''));}
  const output=await response.json() as FullVolumeOpusResult;
  signal.throwIfAborted();
  if(output.schema!=='opus-full-volume-radiologist/v1'||output.modality!==series.modality||
    output.overviewReviewed!==completedIndices.length||output.plannedFrames!==completedIndices.length||
    typeof output.finalReport!=='string'||!output.physicianSignatureRequired)throw Error('Сервер не подтвердил охват итогового заключения.');
  setVisualResult(output.visualReview);setOpusUsage(output.receipt);
  setOpusSpent(n=>n+opusUsageEstimate(output.receipt)+(output.visualReview?.status==='completed'?opusUsageEstimate(output.visualReview.receipt):0));
  setReport(output.finalReport);setStage('completed');setNotice('Заключение готово. Проверьте его по исходным изображениям.');
 }
 async function submitAll(packets:VisionPrivacyPacket[],resume=false){
  if(!plan||!connected||sending.current||(!resume&&stage!=='review')||packets.length!==plan.batches.length)return;
  let execution:{packets:VisionPrivacyPacket[];batches:VisionBatch[]};
  try{execution=resume?{packets,batches:plan.batches}:splitReviewedTransport(packets,plan.batches);}catch(e){interrupted(e);return;}
  packets=execution.packets;const batchPlan={...plan,batches:execution.batches};setExecutionBatches(execution.batches);
  approvedPackets.current=packets;
  let current=receipts;
  if(!canPayForNextBatch(plan.budget,batchPlan.batches,current)){
   interrupted(Error('Достигнут лимит расходов Gemini. Частичный результат сохранён.'));return;
  }
  const signal=ctl.current!.signal;sending.current=true;setStage('gemini');setStopReason('');let synthesizing=false;
  try{
   for(let batchIndex=current.length;batchIndex<batchPlan.batches.length;batchIndex++){
   signal.throwIfAborted();
   if(!canPayForNextBatch(plan.budget,batchPlan.batches,current))throw Error('Достигнут лимит расходов Gemini. Частичный результат сохранён.');
   const packet=packets[batchIndex],batch=batchPlan.batches[batchIndex];
   if(packet.frames.length!==batch.indices.length)throw Error('Проверенная группа не совпадает с планом серии.');
   const response=await fetch('/api/ai/approved-volume-gemini-batch',{method:'POST',credentials:'same-origin',signal,
    headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},
    body:JSON.stringify({packet,acknowledgeClinicianLawfulDisclosure:true,acknowledgeProviderHealthDataTerms:true,
     acknowledgePixelIdentityReviewed:true,acknowledgeOnePaidGeminiBatch:true,
     frameContext:{totalFrames:series.members.length,sliceNumbers:batch.indices.map(n=>n+1),technical:{...volumeTechnicalContext(series),window:reviewWindow,...(additionalWindow==='NONE'?{}:{additionalWindow})}}})});
   if(!response.ok){
    const detail=await response.json().catch(()=>null);
    throw Error('Анализ остановлен на срезах '+batch.indices.map(n=>n+1).join(', ')+': '+(detail?.message??('ошибка сервера '+response.status))+'. Полученные результаты сохранены.');
   }
   const answer=await response.json() as VolumeGeminiBatchResult;
   signal.throwIfAborted();
   if(answer.modality!==series.modality)throw Error('Ответ относится к другой модальности.');
   const done=appendGeminiVolumeReceipt(current,batchPlan.batches,batchIndex,answer);setReceipts(done);
   current=done;
   }
   approvedPackets.current=packets;
   synthesizing=true;await finalize(current,signal,batchPlan);
  }catch(e){
   if(ctl.current?.signal===signal){
    if(!synthesizing&&current.length>0&&!signal.aborted){
     setStopReason(e instanceof Error?e.message:'Обзор Gemini прервался.');
     // One authorized final synthesis from actual completed receipts; never retry
     // the failed Gemini call or a failed Opus request automatically.
     try{await finalize(current,signal,batchPlan);}catch(finalError){if(ctl.current?.signal===signal)interrupted(finalError);}
    }else interrupted(e);
   }
  }finally{if(ctl.current?.signal===signal)sending.current=false;}
 }
 function save(){
  const count=ledger?.processedOverviewFrames??0;
  const text=report||['НЕПОЛНЫЙ АНАЛИЗ. Оценено '+count+' из '+series.members.length+' срезов.',
   'Ниже — наблюдения Gemini, не итоговое заключение врача.',
   ...receipts.flatMap(r=>r.findings.map(f=>'Срез '+(f.sourceIndex+1)+': '+f.anatomy+' — '+f.sign+'. Ограничения: '+f.uncertainty)),
   ...receipts.flatMap(r=>r.limitations)].join('\n');
  const url=URL.createObjectURL(new Blob([text.trim()+'\n'],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=report?'opus-study-report.txt':'opus-partial-observations.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 if(!plan)return <p role="alert">Геометрия серии не подтверждена. Полный анализ не запускается; исходные снимки доступны для просмотра.</p>;
 const recheckCount=new Set([...receipts.flatMap(r=>r.recheckIndices??[]),...detectorLocations.anchors.map(a=>a.sourceIndex)]).size;
 const processed=ledger?.processedOverviewFrames??0;
 const processedIndices=plan.batches.slice(0,receipts.length).flatMap(b=>b.indices);
 const flagged=[...new Set([...receipts.flatMap(r=>r.recheckIndices??[]),...detectorLocations.anchors.map(a=>a.sourceIndex)])].filter(n=>processedIndices.includes(n)).sort((a,b)=>a-b);
 const estimate=estimateStudyCost(plan.budget.overviewIndices.length,plan.batches.length,receipts,processed,visualEnabled);
 const opusCost=opusUsage?opusSpent:null;
 const busy=['preparing','gemini','opus'].includes(stage);
 return <section className="reviewed-study" aria-label="Последовательный анализ выбранной серии">
  <MrSeriesComparison series={series} allSeries={allSeries} files={files} onOpenSlice={onOpenSlice}/>
  {detectorLocations.error&&<p role="alert">Координаты детектора не соответствуют выбранным исходным срезам. Пространственная перепроверка не выполнена.</p>}
  {detectorLocations.anchors.length>0&&<section aria-label="Координаты детекторных находок для перепроверки">
   <p>CLN: исходные координаты привязаны к {detectorLocations.anchors.length} кандидатам. При запуске перепроверки их срезы входят в выбор Opus в пределах общего потолка 16. Фактический охват указан в результате.</p>
   {detectorLocations.anchors.slice(0,16).map(a=><p key={a.candidateId}><button type="button" onClick={()=>onOpenSlice(series.members[a.sourceIndex].id)}>Кандидат {a.candidateId} · срез {a.sourceIndex+1}</button> · центр исходного кадра: X {(a.xFraction*100).toFixed(1)}%, Y {(a.yFraction*100).toFixed(1)}%. Это координаты кандидата, не подтверждённый диагноз.</p>)}
  </section>}
  <h2>Анализ КТ/МРТ · в серии {series.members.length} срезов</h2>
  <p role="status"><strong>Обработано {processed} из {plan.budget.overviewIndices.length} выбранных срезов.</strong> Всего в серии: {series.members.length}. Не оценено в серии: {series.members.length-processed}.</p>
  <p role="status">{stage==='gemini'?'Gemini просматривает снимки. Затем результаты автоматически поступят Opus для заключения.':stage==='opus'?'Результаты Gemini переданы Opus. Формируется заключение…':stage==='completed'?(processed<series.members.length?'Предварительное заключение готово по обработанной части исследования.':'Предварительное заключение готово.') :stage==='interrupted'?'Обработка приостановлена. Полученные результаты сохранены.':'Выберите снимки, проверьте подготовленные копии и запустите анализ.'}</p>
  {processed>0&&<section aria-label="Срезы для проверки"><h3>Срезы, требующие внимания: {flagged.length}</h3>
   <p>Это отмеченные ИИ изменения или неясные участки, а не подтверждённые диагнозы.</p>
   {flagged.map(n=><button type="button" key={n} onClick={()=>onOpenSlice(series.members[n].id)}>Срез {n+1}</button>)}
   {!flagged.length&&<p>Пока нет отмеченных кадров. Это не исключает патологию.</p>}
  </section>}
  <p>Примерная стоимость выбранного анализа с заключением: около ${estimate.total.toFixed(2)}. {opusCost!==null?'По полученным квитанциям Gemini + Opus: около $'+((ledger?.totalUSD??0)+opusCost).toFixed(2)+'.':'Gemini по полученным квитанциям: около $'+(ledger?.totalUSD??0).toFixed(2)+'.'}</p>
  <details><summary>Как рассчитана стоимость</summary><p>Расчёт по тарифам OpenRouter от 03.11.2026 и квитанциям полученных ответов. Начальный ориентир использует предполагаемый объём токенов; по мере обработки уточняется. Не включает перевод, вопросы и запросы без квитанции. Точный счёт — у провайдера.</p></details>
  {stopReason&&<p role="status">{stopReason} Opus получает только обработанные срезы; остальные остаются неоценёнными.</p>}
  {notice&&<p ref={noticeElement} role={stage==='interrupted'?'alert':'status'}>{notice}</p>}
  {stage==='interrupted'&&receipts.length>0&&<button type="button" onClick={()=>{
   const c=new AbortController();ctl.current=c;void finalize(receipts,c.signal).catch(interrupted);
  }}>Получить заключение</button>}
  {!connected&&!busy&&<button type="button" onClick={()=>setConnectionAttempt(n=>n+1)}>Восстановить подключение</button>}
  {stage==='idle'&&<>
   <label>Какие срезы анализировать <select value={selection} onChange={e=>setSelection(e.target.value)}><option value="all">Вся серия</option><option value="custom">Отдельные срезы или диапазон</option></select></label>
   {selection==='custom'&&<label>Номера срезов <input aria-label="Номера срезов" value={selectionText} onChange={e=>setSelectionText(e.target.value)} placeholder="5, 12, 20–35"/><small>Например: 5 — один срез; 5, 12 — два среза; 20–35 — диапазон. Номера соответствуют исходной серии.</small></label>}
   {selectionResult.error&&<p role="alert">{selectionResult.error}</p>}
   <label>Клинические данные для заключения (необязательно)<textarea maxLength={4000} value={clinicalContext} onChange={e=>setClinicalContext(e.target.value)} placeholder="Жалобы, длительность, значимый анамнез. Без ФИО, контактов и других идентификаторов."/></label>
   <p>Эти данные будут переданы Opus вместе с наблюдениями после вашего разрешения на отправку. Они не заменяют признаки на снимках.</p>
   <details><summary>Настройки изображения, перепроверки и расходов</summary>
   {series.modality==='CT'&&<p>Окна подобраны по подтверждённым заголовкам и шкале HU. При неизвестной области сохраняется исходное окно. Их можно изменить перед подготовкой.</p>}
   {series.modality==='CT'&&<label>Как показывать ткани на копиях для ИИ <select value={reviewWindow} onChange={e=>{setReviewWindow(e.target.value as CtReviewWindow);setAdditionalWindow('NONE');}}>
    {Object.entries(CT_REVIEW_WINDOWS).map(([id,w])=><option key={id} value={id}>{w.label}</option>)}
   </select></label>}
   {series.modality==='CT'&&<label>Второй вид того же среза <select value={additionalWindow} onChange={e=>setAdditionalWindow(e.target.value as CtReviewWindow|'NONE')}>
    <option value="NONE">Без дополнительного окна</option>{Object.entries(CT_REVIEW_WINDOWS).filter(([id])=>id!==reviewWindow).map(([id,w])=><option key={id} value={id}>{w.label}</option>)}
   </select></label>}
   <label><input type="checkbox" checked={visualEnabled} onChange={e=>setVisualEnabled(e.target.checked)}/>Независимый просмотр изображений Opus (до 16 кадров)</label>
   {visualEnabled&&<>
    <label>Какие изображения показать Opus <select value={visualMode} onChange={e=>setVisualMode(e.target.value)}>
     <option value="selected">Небольшой выбор целиком; для длинной серии — подозрительные</option>
     <option value="automatic">Автоматически: подозрительные, неясные срезы и соседние</option>
    </select></label>
    <label>Дополнительно проверить по мнению врача <input aria-label="Дополнительные срезы для Opus" value={physicianSlices} onChange={e=>setPhysicianSlices(e.target.value)} placeholder="Например: 64, 70–73"/><small>Необязательно. Эти срезы идут первыми, затем автоматически отмеченные; общий предел — 16 кадров и размер передачи. Номера должны входить в выбранный для анализа набор.</small></label>
    {physicianSelection.error&&<p role="alert">{physicianSelection.error}</p>}
   </>}
   <label>Лимит расходов на обзор Gemini, USD <select value={budget} onChange={e=>setBudget(Number(e.target.value))}>
    {[0.5,1,2,3,5].map(v=><option key={v} value={v}>${v.toFixed(2)}</option>)}
   </select></label>
   <p>До {plan.budget.overviewIndices.length} запросов Gemini (по размеру подготовленных копий) и {visualEnabled?'до двух запросов Opus (перепроверка и заключение)':'один итоговый Opus'}. Подготовка выполняется локально; разрешение на отправку будет после просмотра копий.</p>
   <p>«Окно» — настройка яркости и контраста, не введение контрастного препарата. Лёгочное окно показывает лёгкие; мягкие ткани в нём выглядят почти белыми — это ожидаемо. Второй вид справа показывает тот же срез в другом окне. ИИ получает именно подготовленные копии, исходный DICOM не изменяется.</p>
   <p>Если обзор прервётся, Opus автоматически составит заключение по уже обработанной части. Стоимость — расчётный ориентир по тарифам OpenRouter от 03.11.2026, не точный счёт; объём ответа и маршрутизация могут его изменить. Неудачные запросы могут отсутствовать в квитанциях. Повтор Gemini — только по команде продолжения.</p>
   </details>
   <p>{!visualEnabled?'Opus составит заключение по описаниям без отдельного просмотра изображений.':visualMode==='selected'&&plan.budget.overviewIndices.length<=16?'Opus независимо просмотрит выбранные кадры в пределах размера передачи, даже если Gemini не отметил изменений.':'Для длинной серии Opus получит отмеченные кадры и соседние, максимум 16; текстовые наблюдения передаются по всем обработанным срезам.'}</p>
   <p>Выбрано {plan.budget.overviewIndices.length} срезов, {basePlan?.batches.length} групп подготовки. В одном запросе — до 4 срезов, для крупных копий меньше. После обзора — предварительное заключение Opus. Перевод и обсуждение доступны по готовому заключению.</p>
   <button type="button" disabled={!!selectionResult.error||(visualEnabled&&!!physicianSelection.error)} onClick={()=>void start()}>Подготовить выбранные срезы к анализу</button>
  </>}
  {(stage==='review'||stage==='gemini'||stage==='opus')&&<StudyPrivacyReview count={plan.batches.length} modality={series.modality as 'CT'|'MR'}
   load={prepare} onReady={submitAll} canRelease={connected} releaseNotice={"Gemini обработает выбранные срезы группами по размеру копий, затем "+(visualEnabled?"до двух запросов Opus":"один итоговый Opus")+". Порог остановки Gemini: $"+budget.toFixed(2)+"; Opus оплачивается отдельно."} onOpenSlice={onOpenSlice}
   clinicalContext={clinicalContext} sourceNumbers={plan.batches.map(b=>b.indices.map(i=>i+1))} sourceIds={plan.batches.map(b=>b.indices.map(i=>series.members[i].id))}/>}
  {busy&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('interrupted');setNotice('Остановлено. Полученные наблюдения сохранены; весь ряд не объявляется оценённым.');}}>Остановить анализ</button>}
  {stage==='review'&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('idle');setNotice('Подготовка отменена. Выберите срезы заново; отправка не выполнялась.');}}>Вернуться к выбору срезов</button>}
  {(stage==='interrupted'||stage==='completed')&&receipts.length<plan.batches.length&&approvedPackets.current.length===plan.batches.length&&<button type="button" disabled={!connected} onClick={()=>{const c=new AbortController();ctl.current=c;void submitAll(approvedPackets.current,true);}}>Продолжить обработку оставшихся срезов</button>}
  {stage==='interrupted'&&!canPayForNextBatch(plan.budget,plan.batches,receipts)&&receipts.length<plan.batches.length&&<details><summary>Настройки расходов</summary><label>Лимит Gemini для продолжения <select value={budget} onChange={e=>setBudget(Number(e.target.value))}>{[0.5,1,2,3,5].map(v=><option key={v} value={v}>${v.toFixed(2)}</option>)}</select></label></details>}
  {stage==='interrupted'&&!receipts.length&&<button type="button" onClick={()=>{setExecutionBatches(null);setStage('idle');}}>Вернуться к выбору срезов</button>}
  {stage==='completed'&&<button type="button" onClick={()=>{ctl.current?.abort();approvedPackets.current=[];setExecutionBatches(null);setReceipts([]);setReport('');setOpusSpent(0);setVisualResult(undefined);setOpusUsage(undefined);setAcceptedMeasurements([]);setMeasureSource(null);setStage('idle');setNotice('Можно выбрать другие срезы. Сохраните предыдущий результат заранее: новый анализ оплачивается отдельно.');}}>Новый анализ — выбрать другие срезы</button>}
  {stage==='completed'&&visualEnabled&&(visualResult?.status==='unavailable'||detectorLocations.anchors.some(a=>!attemptedDetectorKeys.current.has(detectorKey(a))))&&<button type="button" onClick={()=>{
   const c=new AbortController();ctl.current=c;void finalize(receipts,c.signal).catch(interrupted);
  }}>Перепроверить отмеченные срезы</button>}
  {opusUsage&&<p>Фактический расход итогового Opus: {opusUsage.inputTokens} входных и {opusUsage.outputTokens} выходных токенов.</p>}
  {recheckCount>16&&<p role="alert">Для перепроверки отмечено {recheckCount} срезов; Opus получает максимум 16. Остальные отмеченные срезы требуют проверки врачом.</p>}
  {visualResult&&<section aria-label="Независимая визуальная перепроверка Opus">
   <h3>Визуальная перепроверка Opus</h3>
   <p>{visualResult.status==='completed'?'Независимо просмотрены срезы: ':'Перепроверка не завершилась. Были выбраны срезы: '}{visualResult.sliceNumbers.join(', ')}. Остальные срезы Opus визуально не проверял.</p>
   {visualResult.status==='completed'&&<p>Расход визуальной перепроверки Opus: {visualResult.receipt.inputTokens} входных и {visualResult.receipt.outputTokens} выходных токенов.</p>}
   {visualResult.status==='completed'&&visualResult.observations.map((f,i)=><p key={i}><button type="button" onClick={()=>onOpenSlice(series.members[f.sliceNumber-1].id)}>Срез {f.sliceNumber}</button> {f.anatomy}: {f.sign} · {f.uncertainty}</p>)}
  </section>}
  {report&&<label>Предварительное заключение · проверьте и отредактируйте<textarea rows={18} style={{width:'100%'}} value={report} onChange={e=>setReport(e.target.value)}/></label>}
  {receipts.length>0&&<button type="button" onClick={save}>{report?'Сохранить заключение TXT':'Сохранить промежуточный результат'}</button>}
  {report&&<StudyReportDiscussion report={report} coverage={(ledger?.processedOverviewFrames??0)+' из '+series.members.length+' срезов'}/>}
  {measureSource!==null&&<FindingMeasurementReview key={measureSource.findingKey} findingKey={measureSource.findingKey} member={series.members[measureSource.sourceIndex]} file={files.get(series.members[measureSource.sourceIndex].id)??null}
   sliceNumber={measureSource.sourceIndex+1} onAccept={m=>{setAcceptedMeasurements(previous=>[...previous.filter(x=>x.findingKey!==m.findingKey),m]);setMeasureSource(null);}}/>}
  {acceptedMeasurements.length>0&&<section aria-label="Принятые врачом измерения"><h3>Измерения принятых находок</h3>
   {acceptedMeasurements.map(m=><p key={m.findingKey}>Срез {m.sliceNumber}: {m.lengthMm.toFixed(2)} мм{m.meanHu!==null?', средняя плотность '+m.meanHu.toFixed(2)+' HU':''}.</p>)}
   <button type="button" disabled={!report} onClick={()=>setReport(previous=>previous+'\n\nИзмерения врача по исходным изображениям:\n'+acceptedMeasurements.map(m=>'Срез '+m.sliceNumber+': размер на срезе '+m.lengthMm.toFixed(2)+' мм'+(m.meanHu!==null?', средняя плотность выбранной области '+m.meanHu.toFixed(2)+' HU':'')+'.').join('\n'))}>Добавить измерения в текст заключения</button>
  </section>}
  {receipts.length>0&&<details><summary>Все наблюдения Gemini</summary>{receipts.flatMap((r,ri)=>r.findings.map((f,i)=><p key={ri+':'+i}>
   <button type="button" onClick={()=>onOpenSlice(series.members[f.sourceIndex].id)}>Срез {f.sourceIndex+1}</button> {f.anatomy}: {f.sign} · {f.uncertainty} <button type="button" onClick={()=>setMeasureSource({sourceIndex:f.sourceIndex,findingKey:ri+':'+i})}>Проверить на снимке / измерить при необходимости</button>
  </p>))}</details>}
 </section>;
}
