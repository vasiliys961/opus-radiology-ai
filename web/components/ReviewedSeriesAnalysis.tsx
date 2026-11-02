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
import StudyPrivacyReview from './StudyPrivacyReview';
type Stage='idle'|'preparing'|'review'|'gemini'|'interrupted'|'opus'|'completed';
export default function ReviewedSeriesAnalysis({series,files,onOpenSlice,detectorStage,detectorEvidence}:{
 series:DicomSeries;files:ReadonlyMap<string,File>;onOpenSlice:(id:string)=>void;
 detectorStage:'idle'|'running'|'completed'|'vision-only'|'cancelled';
 detectorEvidence:SanitizedDetectorBundle|null;
}){
 const [stage,setStage]=useState<Stage>('idle'),[notice,setNotice]=useState('');
 const [budget,setBudget]=useState(2),[consent,setConsent]=useState(false),[connected,setConnected]=useState(false);
 const [connectionAttempt,setConnectionAttempt]=useState(0);

 const [receipts,setReceipts]=useState<LocalVolumeReceipt[]>([]),[report,setReport]=useState('');
 const ctl=useRef<AbortController|null>(null),sending=useRef(false);
 const detector=useRef({stage:detectorStage,evidence:detectorEvidence});
 useEffect(()=>{detector.current={stage:detectorStage,evidence:detectorEvidence};},[detectorStage,detectorEvidence]);
 const plan=useMemo(()=>{try{return planOriginalVolumeSource(series,{maxGeminiUSD:budget});}catch{return null;}},[series,budget]);
 useEffect(()=>{
  ctl.current?.abort();ctl.current=null;sending.current=false;
  setStage('idle');setReceipts([]);setReport('');setConsent(false);
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
   try{url=(await decodeDicomPreview(file,{maxPixels:MAX_PRIVACY_PIXELS})).url;}
   catch{const {decodeCornerstoneVisionPreview}=await import('../lib/cornerstone-vision-preview');url=await decodeCornerstoneVisionPreview(file,MAX_PRIVACY_PIXELS,signal);}
   signal.throwIfAborted();next.push(url);
  }
  return next;
 }
 function interrupted(e:unknown){setStage('interrupted');setNotice(ctl.current?.signal.aborted?
  'Анализ остановлен. Уже полученные наблюдения сохранены в этой вкладке.':e instanceof Error?e.message:'Анализ не завершён.');}
 async function start(){
  if(!plan||!consent||!connected||sending.current||stage!=='idle')return;
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
  const response=await fetch('/api/ai/complete-volume-opus',{method:'POST',credentials:'same-origin',signal,
   headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},body:JSON.stringify(input)});
  if(!response.ok)throw Error('Итоговое заключение не получено ('+response.status+'). Наблюдения Gemini сохранены; повторного запуска Gemini не требуется.');
  const output=await response.json() as FullVolumeOpusResult;
  signal.throwIfAborted();
  if(output.schema!=='opus-full-volume-radiologist/v1'||output.modality!==series.modality||
    output.overviewReviewed!==series.members.length||output.plannedFrames!==series.members.length||
    typeof output.finalReport!=='string'||!output.physicianSignatureRequired)throw Error('Сервер не подтвердил охват итогового заключения.');
  setReport(output.finalReport);setStage('completed');setNotice('Заключение готово. Проверьте его по исходным изображениям.');
 }
 async function submitAll(packets:VisionPrivacyPacket[]){
  if(!plan||!consent||!connected||sending.current||stage!=='review'||packets.length!==plan.batches.length)return;
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
     frameContext:{totalFrames:series.members.length,sliceNumbers:batch.indices.map(n=>n+1),technical:volumeTechnicalContext(series)}})});
   if(!response.ok)throw Error('Группа срезов не подтверждена сервером ('+response.status+'). Повторная платная отправка автоматически не выполняется.');
   const answer=await response.json() as VolumeGeminiBatchResult;
   signal.throwIfAborted();
   if(answer.modality!==series.modality)throw Error('Ответ относится к другой модальности.');
   const done=appendGeminiVolumeReceipt(current,plan.batches,batchIndex,answer);setReceipts(done);
   current=done;
   }
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
  <h2>Анализ всей выбранной серии · {series.members.length} срезов</h2>
  <p role="status">{detectorStage==='running'?'Подходящие детекторы ещё выполняются; просмотр кадров Gemini доступен независимо.':
   detectorEvidence?.facts.some(f=>f.status==='completed')?'Режим: выполненные детекторы + Gemini и Opus.':
    'Режим: Gemini и Opus без результатов детекторов. Задачи недоступных детекторов не оценены.'}</p>
  <p>Gemini последовательно получает все срезы небольшими группами. Подготовленные копии всей серии проверяются перед отправкой; после одного разрешения группы обрабатываются автоматически. Это технический размер группы, а не ограничение охвата четырьмя кадрами.</p>
  <p role="status">Оценено Gemini: {ledger?.processedOverviewFrames??0} из {series.members.length} срезов. Не оценено: {series.members.length-(ledger?.processedOverviewFrames??0)}.</p>
  <p role="status">Расход Gemini по полученным токенам: ${(ledger?.totalUSD??0).toFixed(4)}. Итоговый Opus оплачивается отдельно; его запрос выполняется один раз после полного прохода.</p>
  <p>Opus составляет заключение по наблюдениям Gemini и выполненным детекторам; в этом режиме он не просматривает исходные изображения самостоятельно.</p>
  {notice&&<p role="status">{notice}</p>}
  {(!connected||stage==='interrupted')&&!busy&&<button type="button" onClick={()=>setConnectionAttempt(n=>n+1)}>Повторить проверку подключения</button>}
  {stage==='idle'&&<>
   <label>Порог остановки по расходу Gemini, USD <select value={budget} onChange={e=>setBudget(Number(e.target.value))}>
    {[0.5,1,2,3,5].map(v=><option key={v} value={v}>${v.toFixed(2)}</option>)}
   </select></label>
   <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
    Разрешаю обработку всех {series.members.length} срезов через OpenRouter: до {plan.batches.length} запросов Gemini и один итоговый Opus. Имею право передачи, проверил условия обработки медицинских данных. Перед отправкой будет одна проверка всей подготовленной серии.</label>
   <button type="button" disabled={!consent||!connected} onClick={()=>void start()}>Подготовить всю серию к последовательному анализу</button>
  </>}
  {(stage==='review'||stage==='gemini'||stage==='opus')&&<StudyPrivacyReview count={plan.batches.length} modality={series.modality as 'CT'|'MR'}
   load={prepare} onReady={submitAll} onOpenSlice={onOpenSlice}
   sourceIds={plan.batches.map(b=>b.indices.map(i=>series.members[i].id))}/>}
  {busy&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('interrupted');setNotice('Остановлено. Полученные наблюдения сохранены; весь ряд не объявляется оценённым.');}}>Остановить анализ</button>}
  {stage==='review'&&<button type="button" onClick={()=>{ctl.current?.abort();setStage('interrupted');setNotice('Просмотр серии завершён досрочно. Неотправленные кадры не оценены; частичные наблюдения можно сохранить.');}}>Завершить с частичным результатом</button>}
  {stage==='interrupted'&&receipts.length===plan.batches.length&&<button type="button" onClick={()=>{
   const c=new AbortController();ctl.current=c;void finalize(receipts,c.signal).catch(interrupted);
  }}>Повторить итоговый Opus (платный запрос)</button>}
  {report&&<label>Предварительное заключение · проверьте и отредактируйте<textarea rows={18} style={{width:'100%'}} value={report} onChange={e=>setReport(e.target.value)}/></label>}
  {receipts.length>0&&<button type="button" onClick={save}>{report?'Сохранить заключение TXT':'Сохранить полученные наблюдения TXT'}</button>}
  {receipts.length>0&&<details><summary>Находки и переход к исходным срезам</summary>{receipts.flatMap((r,ri)=>r.findings.map((f,i)=><p key={ri+':'+i}>
   <button type="button" onClick={()=>onOpenSlice(series.members[f.sourceIndex].id)}>Срез {f.sourceIndex+1}</button> {f.anatomy}: {f.sign} · {f.uncertainty}
  </p>))}</details>}
 </section>;
}
