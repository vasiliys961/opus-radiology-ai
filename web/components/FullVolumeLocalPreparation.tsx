"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {planOriginalVolumeSource,prepareOriginalVolumeBatches,type VolumePreparedBatch} from "../lib/vision-volume-source";
import {markPrivacyReview,buildVisionPrivacyPacket} from "../lib/vision-privacy";
import {appendGeminiVolumeReceipt,volumeLedger,canPayForNextBatch,makeSafeVolumeOpusInput,
  type LocalVolumeReceipt} from "../lib/full-volume-receipts";
import type {VolumeGeminiBatchResult} from "../lib/approved-volume-batch-review";
import type {FullVolumeOpusResult} from "../lib/full-volume-opus-synthesis";

type Phase="idle"|"preparing"|"review"|"sending"|"opus-ready"|"opus-running"|"completed"|"interrupted";
export default function FullVolumeLocalPreparation({series,files,flaggedIndex,onOpenSlice}:{
  series:DicomSeries;files:ReadonlyMap<string,File>;
  flaggedIndex:number|null;onOpenSlice:(fileId:string)=>void;
}){
 const [phase,setPhase]=useState<Phase>("idle");
 const [notice,setNotice]=useState("");
 const [cap,setCap]=useState(0.50);
 const [token,setToken]=useState("");
 const [lawful,setLawful]=useState(false);
 const [reviewed,setReviewed]=useState(false);
 const [opusConsent,setOpusConsent]=useState(false);
 const [batch,setBatch]=useState<VolumePreparedBatch|null>(null);
 const [receipts,setReceipts]=useState<LocalVolumeReceipt[]>([]);
 const [report,setReport]=useState<FullVolumeOpusResult|null>(null);
 const [editable,setEditable]=useState("");
 const controller=useRef<AbortController|null>(null);
 const stream=useRef<AsyncGenerator<VolumePreparedBatch>|null>(null);
 const paid=useRef<LocalVolumeReceipt[]>([]);
 const active=useRef<VolumePreparedBatch|null>(null);
 const locked=useRef(false);
 const plan=useMemo(()=>{
   try{return planOriginalVolumeSource(series,{maxGeminiUSD:cap,
     flaggedIndices:flaggedIndex===null?[]:[flaggedIndex]});}
   catch{return null;}
 },[series,flaggedIndex,cap]);
 const ledger=useMemo(()=>plan?volumeLedger(plan.budget,plan.batches,receipts):null,[plan,receipts]);
 const complete=!!plan&&paid.current.length===plan.batches.length&&ledger?.completedFullOverview===true;
 useEffect(()=>()=>{controller.current?.abort();void stream.current?.return?.(undefined);active.current=null;paid.current=[];},[series,files]);
 async function next(){
   if(!stream.current||controller.current?.signal.aborted)return;
   setPhase("preparing");setBatch(null);active.current=null;setReviewed(false);
   setNotice("Готовим очередной локальный пакет DICOM и проверяем OCR…");
   const item=await stream.current.next();
   if(controller.current?.signal.aborted)return;
   if(item.done){
     setPhase("opus-ready");
     setNotice("Полный обзор Gemini завершён. Доступно одно итоговое заключение Opus.");
   }else{
     active.current=item.value;setBatch(item.value);setPhase("review");
     setNotice("Проверьте каждый исходящий PNG, в том числе края изображения.");
   }
 }
 async function start(){
   if(!plan||phase!=="idle"||locked.current||!lawful||token.length<24)return;
   locked.current=true;controller.current=new AbortController();paid.current=[];
   setReceipts([]);setReport(null);setEditable("");setOpusConsent(false);
   stream.current=prepareOriginalVolumeBatches(series,files,{
     signal:controller.current.signal,maxGeminiUSD:cap,
     flaggedIndices:flaggedIndex===null?[]:[flaggedIndex],
   });
   try{await next();}
   catch(e){setPhase("interrupted");setNotice("Локальный DICOM не подготовлен: "+
     (e instanceof Error?e.message:"ошибка декодирования"));}
   finally{locked.current=false;}
 }
 async function send(){
   const current=active.current;
   if(!plan||!current||phase!=="review"||!reviewed||!lawful||
      token.length<24||locked.current)return;
   if(current.privacy.unresolved||current.privacy.frames.some(f=>
     current.privacy.ocr[f.frameId]?.sha256!==f.sha256||
     current.privacy.ocr[f.frameId].regions.length!==0)){
      setNotice("В кадрах остаются надписи: платная передача запрещена.");return;
   }
   if(!canPayForNextBatch(plan.budget,plan.batches,paid.current)){
     setPhase("interrupted");setNotice("Предварительный предел стоимости Gemini достигнут.");return;
   }
   locked.current=true;setPhase("sending");setReviewed(false);
   try{
     const frames=current.privacy.frames.map(f=>
       markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true));
     const packet=buildVisionPrivacyPacket(frames,crypto.randomUUID());
     const r=await fetch("/api/ai/approved-volume-gemini-batch",{
       method:"POST",cache:"no-store",credentials:"same-origin",
       signal:controller.current?.signal,
       headers:{"Content-Type":"application/json","X-Opus-Local-Operator-Token":token},
       body:JSON.stringify({packet,
         acknowledgeClinicianLawfulDisclosure:true,
         acknowledgeProviderHealthDataTerms:true,
         acknowledgePixelIdentityReviewed:true,
         acknowledgeOnePaidGeminiBatch:true}),
     });
     if(!r.ok)throw Error("Gemini HTTP "+r.status);
     const answer=await r.json() as VolumeGeminiBatchResult;
     if(answer.modality!==series.modality)throw Error("Несовпадение модальности");
     const results=appendGeminiVolumeReceipt(paid.current,plan.batches,current.batchIndex,answer);
     paid.current=results;setReceipts(results);
     setBatch(null);active.current=null;
     if(results.length<plan.batches.length&&!canPayForNextBatch(plan.budget,plan.batches,results)){
       setPhase("interrupted");setNotice("Порог бюджета достигнут. Полный обзор не закончен.");return;
     }
     await next();
   }catch(e){
     if(!controller.current?.signal.aborted){
       setPhase("interrupted");setNotice("Gemini не подтвердил пакет: "+
         (e instanceof Error?e.message:"ошибка")+
         ". Автоповтора нет, ранее начатый запрос мог быть оплачен.");
     }
   }finally{locked.current=false;}
 }
 async function finish(){
   if(!plan||!complete||phase!=="opus-ready"||!opusConsent||!lawful||
     token.length<24||locked.current)return;
   locked.current=true;setPhase("opus-running");
   try{
     const payload=makeSafeVolumeOpusInput(series.modality as "CT"|"MR",
       plan.budget,plan.batches,paid.current);
     const r=await fetch("/api/ai/complete-volume-opus",{
       method:"POST",cache:"no-store",credentials:"same-origin",
       signal:controller.current?.signal,
       headers:{"Content-Type":"application/json","X-Opus-Local-Operator-Token":token},
       body:JSON.stringify(payload),
     });
     if(!r.ok)throw Error("Opus HTTP "+r.status);
     const data=await r.json() as FullVolumeOpusResult;
     if(data.schema!=="opus-full-volume-radiologist/v1"||
       data.modality!==series.modality||
       data.overviewReviewed!==plan.sourceFrames.length||
       data.plannedFrames!==plan.sourceFrames.length||
       data.clinicalValidation!==false||
       !data.physicianSignatureRequired||
       typeof data.finalReport!=="string"||
       !Number.isSafeInteger(data.receipt?.inputTokens)||
       !Number.isSafeInteger(data.receipt?.outputTokens))throw Error("Неверный контракт Opus");
     setReport(data);setEditable(data.finalReport);setToken("");
     setPhase("completed");setNotice("Получен единый редактируемый предварительный протокол.");
   }catch(e){
     if(!controller.current?.signal.aborted){
       setPhase("interrupted");setNotice("Opus не сформировал протокол: "+
         (e instanceof Error?e.message:"неизвестная ошибка")+". Автоповтора нет.");
     }
   }finally{locked.current=false;}
 }
 function stop(){
   controller.current?.abort();setBatch(null);active.current=null;
   setPhase("interrupted");
   setNotice("Остановлено. Необработанные срезы не считаются нормальными. Начатые запросы могут быть оплачены.");
 }
 function download(){
   if(!report||phase!=="completed"||!editable.trim())return;
   const url=URL.createObjectURL(new Blob([editable.trim()+"\n"],{type:"text/plain;charset=utf-8"}));
   const a=document.createElement("a");a.href=url;a.download="opus-full-volume-radiologist.txt";
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 if(!plan)return <p role="status">Полный обзор невозможен: геометрия DICOM или бюджет не подтверждены.</p>;
 return <section aria-label="Полный DICOM Gemini Opus">
   <h4>Полный томографический объём · Gemini пакетами → один Opus</h4>
   <p>Исходные DICOM локальны. Обрабатываются все {plan.sourceFrames.length} срезов
     пакетами до 4; каждый пакет требует врачебной проверки PNG. После получения всех
     квитанций Opus получает только текстовые наблюдения. Никаких автоматических
     повторных платных запросов.</p>
   {phase==="idle"&&<>
     <label>Предел предполагаемых затрат Gemini, USD
       <input type="number" min="0.05" max="5" step="0.05" value={cap}
         onChange={e=>setCap(Number(e.target.value))}/>
     </label>
     <p>Тарифы — расчётные; фактическая цена может отличаться. Это не лимит
       аккаунта OpenRouter. Opus оплачивается отдельно.</p>
     <label>Локальный пароль оператора
       <input type="password" autoComplete="off" value={token}
         onChange={e=>setToken(e.target.value)}/>
     </label>
     <label><input type="checkbox" checked={lawful}
       onChange={e=>setLawful(e.target.checked)}/>
       Подтверждаю право передачи обезличенных медицинских изображений OpenRouter,
       условия провайдера и разрешаю платные Gemini-запросы только после
       проверки каждой точной PNG-копии.</label>
     <button type="button" disabled={!lawful||token.length<24}
       onClick={()=>void start()}>Начать полный пакетный обзор</button>
   </>}
   {ledger&&<p role="status">Реально обработано Gemini: {ledger.processedOverviewFrames}/{ledger.plannedFrames}
     обзорных и {ledger.processedTargetedFrames} повторных срезов;
     пакетов {receipts.length}/{plan.batches.length}.
     Токены {ledger.providerReportedInputTokens} входящих и
     {ledger.providerReportedOutputTokens} исходящих.
     Стоимость по оценочному тарифу: {ledger.totalUSD.toFixed(4)} USD
     из {cap.toFixed(2)} USD.</p>}
   <p role="status">{notice}</p>
   {phase==="review"&&batch&&<>
     <h4>Пакет {batch.batchIndex+1}/{plan.batches.length} — {batch.pass}</h4>
     <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
       {batch.privacy.frames.map((f,i)=><div key={batch.sources[i].fileId}>
         <img src={"data:image/png;base64,"+f.pngBase64} width={160}
           alt={"Точная исходящая PNG-копия среза "+(batch.sources[i].index+1)}/>
         <p>Срез {batch.sources[i].index+1}; OCR: {batch.privacy.ocr[f.frameId]?.regions.length??"?"}</p>
         <button type="button" onClick={()=>onOpenSlice(batch.sources[i].fileId)}>
           Открыть исходный DICOM</button>
       </div>)}
     </div>
     {batch.privacy.unresolved>0?<p role="alert">Оставшиеся надписи:
       отправка блокирована. Нужна новая подготовка источника.</p>:
       <label><input type="checkbox" checked={reviewed}
         onChange={e=>setReviewed(e.target.checked)}/>
         Проверил ВСЕ точные PNG в этом пакете, включая края: нет имён,
         дат, ID, лиц и иных узнаваемых признаков. Разрешаю один Gemini-запрос.
       </label>}
     <button type="button" disabled={!reviewed||batch.privacy.unresolved>0||
       !canPayForNextBatch(plan.budget,plan.batches,receipts)}
       onClick={()=>void send()}>Передать этот пакет Gemini</button>
   </>}
   {phase==="opus-ready"&&complete&&<>
     <p>Полный набор исходных кадров обработан Gemini; Opus получает текст,
       не пиксели и не DICOM UID. Новый платный вызов требует согласия.</p>
     <label><input type="checkbox" checked={opusConsent}
       onChange={e=>setOpusConsent(e.target.checked)}/>
       Разрешаю один платный запрос Claude Opus для итогового предварительного протокола.
     </label>
     <button type="button" disabled={!opusConsent} onClick={()=>void finish()}>
       Сформировать стандартный протокол Opus
     </button>
   </>}
   {phase==="completed"&&report&&<section>
     <h4>Описание и заключение рентгенолога · редактор и TXT</h4>
     <p>Opus использовал текстовые наблюдения Gemini, а не самостоятельно
       просматривал исходные DICOM. Заключение требует врачебной проверки.</p>
     <textarea rows={18} style={{width:"100%"}} maxLength={12000} value={editable}
       onChange={e=>setEditable(e.target.value)}/>
     <button type="button" onClick={download}>Сохранить TXT</button>
   </section>}
   {phase!=="idle"&&phase!=="completed"&&phase!=="interrupted"&&
     <button type="button" onClick={stop}>Остановить</button>}
   {phase==="interrupted"&&<p>Обзор неполон или прерван.
     Ни отсутствие патологий, ни отрицательное заключение не установлены.</p>}
 </section>;
}
