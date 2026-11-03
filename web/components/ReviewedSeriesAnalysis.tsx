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
import {CT_REVIEW_WINDOWS,type CtReviewWindow} from '../lib/ct-review-window';
import {selectTargetedVisualInput,type TargetedVisualInput} from '../lib/opus-targeted-visual-review';
import FindingMeasurementReview,{type AcceptedFindingMeasurement} from './FindingMeasurementReview';
import MrSeriesComparison from './MrSeriesComparison';
import StudyPrivacyReview from './StudyPrivacyReview';
type Stage='idle'|'preparing'|'review'|'gemini'|'interrupted'|'opus'|'completed';
export default function ReviewedSeriesAnalysis({series,files,onOpenSlice,detectorStage,detectorEvidence,allSeries=[]}:{
 allSeries?:readonly DicomSeries[];series:DicomSeries;files:ReadonlyMap<string,File>;onOpenSlice:(id:string)=>void;
 detectorStage:'idle'|'running'|'completed'|'vision-only'|'cancelled';
 detectorEvidence:SanitizedDetectorBundle|null;
}){
 const [measureSource,setMeasureSource]=useState<{sourceIndex:number;findingKey:string}|null>(null);
 const [acceptedMeasurements,setAcceptedMeasurements]=useState<AcceptedFindingMeasurement[]>([]);
 const [additionalWindow,setAdditionalWindow]=useState<CtReviewWindow|'NONE'>('NONE');
 const [reviewWindow,setReviewWindow]=useState<CtReviewWindow>('SOURCE'),[visualEnabled,setVisualEnabled]=useState(true);
 const targetedVisual=useRef<TargetedVisualInput|null>(null);
 const [opusUsage,setOpusUsage]=useState<FullVolumeOpusResult['receipt']>();
 const [visualResult,setVisualResult]=useState<FullVolumeOpusResult['visualReview']>();
 const [stage,setStage]=useState<Stage>('idle'),[notice,setNotice]=useState('');
 const [budget,setBudget]=useState(2),[connected,setConnected]=useState(false);
 const [connectionAttempt,setConnectionAttempt]=useState(0);

 const [receipts,setReceipts]=useState<LocalVolumeReceipt[]>([]),[report,setReport]=useState('');
 const ctl=useRef<AbortController|null>(null),sending=useRef(false);
 const detector=useRef({stage:detectorStage,evidence:detectorEvidence});
 useEffect(()=>{detector.current={stage:detectorStage,evidence:detectorEvidence};},[detectorStage,detectorEvidence]);
 const plan=useMemo(()=>{try{return planOriginalVolumeSource(series,{maxGeminiUSD:budget});}catch{return null;}},[series,budget]);
 useEffect(()=>{
  ctl.current?.abort();ctl.current=null;sending.current=false;targetedVisual.current=null;setVisualResult(undefined);setOpusUsage(undefined);setReviewWindow('SOURCE');setAdditionalWindow('NONE');
  setMeasureSource(null);setAcceptedMeasurements([]);setStage('idle');setReceipts([]);setReport('');
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
  if(!plan||sending.current||stage!=='idle')return;
  const c=new AbortController();ctl.current=c;
  setStage('review');
 }
 async function finalize(done:LocalVolumeReceipt[],signal:AbortSignal){
  if(!plan)throw Error('План серии потерян.');
  setStage('opus');setNotice('Все срезы переданы Gemini. Opus составляет заключение по наблюдениям и доступным результатам детекторов.');
  const began=Date.now();while(detector.current.stage==='running'&&Date.now()-began<30000){
   signal.throwIfAborted();await new Promise(r=>setTimeout(r,250));
  }
  signal.throwIfAborted();const d=detector.current;
  const input=makeSafeVolumeOpusInput(series.modality as 'CT'|'MR',plan.budget,plan.batches,done,d.evidence,
   d.stage==='running'?'timeout':d.evidence?.facts.some(f=>f.status==='completed')?'completed':'unavailable');
  if(series.modality==='CT')input.limitations=[...input.limitations.slice(0,29),'Окна обзора: '+CT_REVIEW_WINDOWS[reviewWindow].label+(additionalWindow==='NONE'?'':'; справа '+CT_REVIEW_WINDOWS[additionalWindow].label)+'. Остальные окна не оценены.'];
  if(done.some(r=>r.recheckIndices===undefined))input.limitations=[...input.limitations.slice(0,29),'Для части групп Gemini не вернул структурированный список спорных/очаговых кадров. Отсутствие списка не является отсутствием патологии.'];
  if(visualEnabled){const eligible=new Set(done.flatMap(r=>r.recheckIndices??[])).size;
   if(eligible>16)input.limitations=[...input.limitations.slice(0,29),'Для визуальной перепроверки отмечено '+eligible+' срезов. Из-за потолка 16 остальные '+(eligible-16)+' требуют проверки врачом.'];}
  if(d.evidence?.facts.some(f=>f.status==='completed'&&(f.candidateCount??0)>0))input.limitations=[...input.limitations.slice(0,29),'Положительные детекторные кандидаты переданы агрегированно, без координат. Автоматическая визуальная перепроверка именно детекторных расхождений не выполнена.'];
  const payload=targetedVisual.current?{synthesis:input,visualReview:targetedVisual.current}:input;
  const response=await fetch('/api/ai/complete-volume-opus',{method:'POST',credentials:'same-origin',signal,
   headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},body:JSON.stringify(payload)});
  if(!response.ok)throw Error('Итоговое заключение не получено ('+response.status+'). Наблюдения Gemini сохранены; повторного запуска Gemini не требуется.');
  const output=await response.json() as FullVolumeOpusResult;
  signal.throwIfAborted();
  if(output.schema!=='opus-full-volume-radiologist/v1'||output.modality!==series.modality||
    output.overviewReviewed!==series.members.length||output.plannedFrames!==series.members.length||
    typeof output.finalReport!=='string'||!output.physicianSignatureRequired)throw Error('Сервер не подтвердил охват итогового заключения.');
  setVisualResult(output.visualReview);setOpusUsage(output.receipt);
  setReport(output.finalReport);setStage('completed');setNotice('Заключение готово. Проверьте его по исходным изображениям.');
 }
 async function submitAll(packets:VisionPrivacyPacket[]){
  if(!plan||!connected||sending.current||stage!=='review'||packets.length!==plan.batches.length)return;
  let current=receipts;
  if(!canPayForNextBatch(plan.budget,plan.batches,current)){
   interrupted(Error('Достигнут лимит расходов Gemini. Частичный результат сохранён.'));return;
  }
  const signal=ctl.current!.signal;sending.current=true;setStage('gemini');
  try{
   for(let batchIndex=current.length;batchIndex<plan.batches.length;batchIndex++){
   signal.throwIfAborted();
   if(!canPayForNextBatch(plan.budget,plan.batches,current))throw Error('Достигнут лимит расходов Gemini. Частичный результат сохранён.');
   const packet=packets[batchIndex],batch=plan.batches[batchIndex];
   if(packet.frames.length!==batch.indices.length)throw Error('Проверенная группа не совпадает с планом серии.');
   const response=await fetch('/api/ai/approved-volume-gemini-batch',{method:'POST',credentials:'same-origin',signal,
    headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},
    body:JSON.stringify({packet,acknowledgeClinicianLawfulDisclosure:true,acknowledgeProviderHealthDataTerms:true,
     acknowledgePixelIdentityReviewed:true,acknowledgeOnePaidGeminiBatch:true,
     frameContext:{totalFrames:series.members.length,sliceNumbers:batch.indices.map(n=>n+1),technical:{...volumeTechnicalContext(series),window:reviewWindow,...(additionalWindow==='NONE'?{}:{additionalWindow})}}})});
   if(!response.ok)throw Error('Группа срезов не подтверждена сервером ('+response.status+'). Повторная платная отправка автоматически не выполняется.');
   const answer=await response.json() as VolumeGeminiBatchResult;
   signal.throwIfAborted();
   if(answer.modality!==series.modality)throw Error('Ответ относится к другой модальности.');
   const done=appendGeminiVolumeReceipt(current,plan.batches,batchIndex,answer);setReceipts(done);
   current=done;
   }
   targetedVisual.current=visualEnabled?selectTargetedVisualInput(packets,current):null;
   if(visualEnabled&&!targetedVisual.current)setNotice('Очаговые или спорные кадры для дополнительного визуального Opus не отмечены; платная перепроверка пропущена. Это не означает норму исследования.');
   if(targetedVisual.current)targetedVisual.current.windows={primary:reviewWindow,...(additionalWindow==='NONE'?{}:{additional:additionalWindow})};
   await finalize(current,signal);
  }catch(e){if(ctl.current?.signal===signal)interrupted(e);}finally{if(ctl.current?.signal===signal)sending.current=false;}
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
 const busy=['preparing','gemini','opus'].includes(stage);
 return <section aria-label="Последовательный анализ выбранной серии">
  <MrSeriesComparison series={series} allSeries={allSeries} files={files} onOpenSlice={onOpenSlice}/>
  <h2>Анализ всей выбранной серии · {series.members.length} срезов</h2>
  <p role="status">{detectorStage==='running'?'Подходящие детекторы ещё выполняются; просмотр кадров Gemini доступен независимо.':
   detectorEvidence?.facts.some(f=>f.status==='completed')?'Режим: выполненные детекторы + Gemini и Opus.':
    'Режим: Gemini и Opus без результатов детекторов. Задачи недоступных детекторов не оценены.'}</p>
  <p>Gemini последовательно получает все срезы небольшими группами. Подготовленные копии всей серии проверяются перед отправкой; после одного разрешения группы обрабатываются автоматически. Это технический размер группы, а не ограничение охвата четырьмя кадрами.</p>
  <p role="status">Оценено Gemini: {ledger?.processedOverviewFrames??0} из {series.members.length} срезов. Не оценено: {series.members.length-(ledger?.processedOverviewFrames??0)}.</p>
  <p role="status">Расход Gemini по полученным токенам: ${(ledger?.totalUSD??0).toFixed(4)}. Opus оплачивается отдельно: итоговое заключение и, если включена перепроверка, один дополнительный визуальный запрос.</p>
  <p>Opus составляет заключение по Gemini и фактическим результатам детекторов. При включённой перепроверке он сначала независимо просматривает до 16 проверенных кадров без диагноза Gemini; это не повторный просмотр всей серии.</p>
  {notice&&<p role="status">{notice}</p>}
  {(!connected||stage==='interrupted')&&!busy&&<button type="button" onClick={()=>setConnectionAttempt(n=>n+1)}>Повторить проверку подключения</button>}
  {stage==='idle'&&<>
   {series.modality==='CT'&&<label>Окно для анализа КТ <select value={reviewWindow} onChange={e=>{setReviewWindow(e.target.value as CtReviewWindow);setAdditionalWindow('NONE');}}>
    {Object.entries(CT_REVIEW_WINDOWS).map(([id,w])=><option key={id} value={id}>{w.label}</option>)}
   </select></label>}
   {series.modality==='CT'&&<label>Дополнительное окно рядом с основным <select value={additionalWindow} onChange={e=>setAdditionalWindow(e.target.value as CtReviewWindow|'NONE')}>
    <option value="NONE">Без дополнительного окна</option>{Object.entries(CT_REVIEW_WINDOWS).filter(([id])=>id!==reviewWindow).map(([id,w])=><option key={id} value={id}>{w.label}</option>)}
   </select></label>}
   <label><input type="checkbox" checked={visualEnabled} onChange={e=>setVisualEnabled(e.target.checked)}/>Независимая визуальная перепроверка Opus: до 16 кадров, один дополнительный платный запрос</label>
   <label>Порог остановки по расходу Gemini, USD <select value={budget} onChange={e=>setBudget(Number(e.target.value))}>
    {[0.5,1,2,3,5].map(v=><option key={v} value={v}>${v.toFixed(2)}</option>)}
   </select></label>
   <p>До {plan.batches.length} запросов Gemini и {visualEnabled?'до двух запросов Opus (перепроверка и заключение)':'один итоговый Opus'}. Подготовка выполняется локально; разрешение на отправку будет после просмотра копий.</p>
   <button type="button" onClick={()=>void start()}>Подготовить всю серию к последовательному анализу</button>
  </>}
  {(stage==='review'||stage==='gemini'||stage==='opus')&&<StudyPrivacyReview count={plan.batches.length} modality={series.modality as 'CT'|'MR'}
   load={prepare} onReady={submitAll} canRelease={connected} releaseNotice={"Передача через OpenRouter: до "+plan.batches.length+" запросов Gemini и "+(visualEnabled?"до двух запросов Opus":"один итоговый Opus")+". Порог остановки Gemini: $"+budget.toFixed(2)+"; Opus оплачивается отдельно."} onOpenSlice={onOpenSlice}
   sourceIds={plan.batches.map(b=>b.indices.map(i=>series.members[i].id))}/>}
  {busy&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('interrupted');setNotice('Остановлено. Полученные наблюдения сохранены; весь ряд не объявляется оценённым.');}}>Остановить анализ</button>}
  {stage==='review'&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('interrupted');setNotice('Просмотр серии завершён досрочно. Неотправленные кадры не оценены; частичные наблюдения можно сохранить.');}}>Завершить с частичным результатом</button>}
  {stage==='interrupted'&&receipts.length===plan.batches.length&&<button type="button" onClick={()=>{
   const c=new AbortController();ctl.current=c;void finalize(receipts,c.signal).catch(interrupted);
  }}>Повторить Opus (платные запросы)</button>}
  {opusUsage&&<p>Фактический расход итогового Opus: {opusUsage.inputTokens} входных и {opusUsage.outputTokens} выходных токенов.</p>}
  {new Set(receipts.flatMap(r=>r.recheckIndices??[])).size>16&&<p role="alert">Для перепроверки отмечено {new Set(receipts.flatMap(r=>r.recheckIndices??[])).size} срезов; Opus получает максимум 16. Остальные отмеченные срезы требуют проверки врачом.</p>}
  {visualResult&&<section aria-label="Независимая визуальная перепроверка Opus">
   <h3>Визуальная перепроверка Opus</h3>
   <p>{visualResult.status==='completed'?'Независимо просмотрены срезы: ':'Перепроверка не завершилась. Были выбраны срезы: '}{visualResult.sliceNumbers.join(', ')}. Остальные срезы Opus визуально не проверял.</p>
   {visualResult.status==='completed'&&<p>Расход визуальной перепроверки Opus: {visualResult.receipt.inputTokens} входных и {visualResult.receipt.outputTokens} выходных токенов.</p>}
   {visualResult.status==='completed'&&visualResult.observations.map((f,i)=><p key={i}><button type="button" onClick={()=>onOpenSlice(series.members[f.sliceNumber-1].id)}>Срез {f.sliceNumber}</button> {f.anatomy}: {f.sign} · {f.uncertainty}</p>)}
  </section>}
  {report&&<label>Предварительное заключение · проверьте и отредактируйте<textarea rows={18} style={{width:'100%'}} value={report} onChange={e=>setReport(e.target.value)}/></label>}
  {receipts.length>0&&<button type="button" onClick={save}>{report?'Сохранить заключение TXT':'Сохранить полученные наблюдения TXT'}</button>}
  {measureSource!==null&&<FindingMeasurementReview key={measureSource.findingKey} findingKey={measureSource.findingKey} member={series.members[measureSource.sourceIndex]} file={files.get(series.members[measureSource.sourceIndex].id)??null}
   sliceNumber={measureSource.sourceIndex+1} onAccept={m=>{setAcceptedMeasurements(previous=>[...previous.filter(x=>x.findingKey!==m.findingKey),m]);setMeasureSource(null);}}/>}
  {acceptedMeasurements.length>0&&<section aria-label="Принятые врачом измерения"><h3>Измерения принятых находок</h3>
   {acceptedMeasurements.map(m=><p key={m.findingKey}>Срез {m.sliceNumber}: {m.lengthMm.toFixed(2)} мм{m.meanHu!==null?', средняя плотность '+m.meanHu.toFixed(2)+' HU':''}.</p>)}
   <button type="button" disabled={!report} onClick={()=>setReport(previous=>previous+'\n\nИзмерения врача по исходным изображениям:\n'+acceptedMeasurements.map(m=>'Срез '+m.sliceNumber+': размер на срезе '+m.lengthMm.toFixed(2)+' мм'+(m.meanHu!==null?', средняя плотность выбранной области '+m.meanHu.toFixed(2)+' HU':'')+'.').join('\n'))}>Добавить измерения в текст заключения</button>
  </section>}
  {receipts.length>0&&<details><summary>Находки и переход к исходным срезам</summary>{receipts.flatMap((r,ri)=>r.findings.map((f,i)=><p key={ri+':'+i}>
   <button type="button" onClick={()=>onOpenSlice(series.members[f.sourceIndex].id)}>Срез {f.sourceIndex+1}</button> {f.anatomy}: {f.sign} · {f.uncertainty} <button type="button" onClick={()=>setMeasureSource({sourceIndex:f.sourceIndex,findingKey:ri+':'+i})}>Проверить и измерить находку</button>
  </p>))}</details>}
 </section>;
}
