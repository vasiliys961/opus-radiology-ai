"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import type {SanitizedDetectorBundle} from "../lib/detector-consilium-evidence";
import {planOriginalVolumeSource,prepareOriginalVolumeBatches} from "../lib/vision-volume-source";
import {appendGeminiVolumeReceipt,volumeLedger,canPayForNextBatch,
  makeSafeVolumeOpusInput,type LocalVolumeReceipt} from "../lib/full-volume-receipts";
import type {VolumeGeminiBatchResult} from "../lib/approved-volume-batch-review";
import type {FullVolumeOpusResult} from "../lib/full-volume-opus-synthesis";
import type {AutoVolumePacket} from "../lib/auto-volume-research-packet";
type Stage="idle"|"preparing"|"gemini"|"detectors"|"opus"|"completed"|"unavailable"|"interrupted";
type DetectorStage="idle"|"running"|"completed"|"vision-only"|"cancelled";
export default function FullVolumeLocalPreparation({
  series,files,flaggedIndex,onOpenSlice,autoStart=false,
  detectorStage="idle",detectorEvidence=null,
}:{
  series:DicomSeries;files:ReadonlyMap<string,File>;
  flaggedIndex:number|null;onOpenSlice:(fileId:string)=>void;
  autoStart?:boolean;detectorStage?:DetectorStage;
  detectorEvidence?:SanitizedDetectorBundle|null;
}){
 const [stage,setStage]=useState<Stage>("idle");
 const [notice,setNotice]=useState("После запуска исследования результаты появятся здесь.");
 const [progress,setProgress]=useState(0);
 const [report,setReport]=useState<FullVolumeOpusResult|null>(null);
 const [editable,setEditable]=useState("");
 const [sessionReady,setSessionReady]=useState<boolean|null>(null);
 const [adminToken,setAdminToken]=useState("");
 const [adminIssue,setAdminIssue]=useState("");
 const ctl=useRef<AbortController|null>(null);
 const started=useRef(false);
 const detectorStageRef=useRef(detectorStage);
 const detectorEvidenceRef=useRef(detectorEvidence);
 useEffect(()=>{detectorStageRef.current=detectorStage;detectorEvidenceRef.current=detectorEvidence;},
   [detectorStage,detectorEvidence]);
 const budget=0.50;
 const plan=useMemo(()=>{
   try{return planOriginalVolumeSource(series,{maxGeminiUSD:budget,
     flaggedIndices:flaggedIndex===null?[]:[flaggedIndex]});}
   catch{return null;}
 },[series,flaggedIndex]);
 useEffect(()=>{return()=>ctl.current?.abort();},[]);
 useEffect(()=>{
   let active=true;
   void fetch("/api/ai/volume-operator-session",{cache:"no-store",credentials:"same-origin"})
    .then(async r=>r.ok?await r.json():null)
    .then(d=>{if(active)setSessionReady(d?.workstationConnected===true);})
    .catch(()=>{if(active)setSessionReady(false);});
   return()=>{active=false;};
 },[]);
 async function connectAdmin(){
   setAdminIssue("");
   const r=await fetch("/api/ai/volume-operator-session",{
     method:"POST",cache:"no-store",credentials:"same-origin",
     headers:{"X-Opus-Local-Operator-Token":adminToken},
   }).catch(()=>null);
   setAdminToken("");
   if(!r?.ok){setAdminIssue("Рабочее место не подключено. Проверьте настройки сервера.");return;}
   setSessionReady(true);setAdminIssue("Рабочее место готово к анализу.");
 }
 async function execute(signal:AbortSignal){
   if(!plan)throw Error("Геометрия томографического ряда не подтверждена");
   let receipts:LocalVolumeReceipt[]=[];
   for await(const batch of prepareOriginalVolumeBatches(series,files,{
     signal,maxGeminiUSD:budget,
     flaggedIndices:flaggedIndex===null?[]:[flaggedIndex],
   })){
     if(signal.aborted)throw Error("Анализ отменён");
     setStage("preparing");setNotice("Подготавливаются изображения для анализа…");
     // OCR outputs must correspond to the exact final PNG, without remaining text.
     if(batch.privacy.unresolved!==0||
       batch.privacy.frames.some(f=>batch.privacy.ocr[f.frameId]?.sha256!==f.sha256||
         batch.privacy.ocr[f.frameId].regions.length!==0))
       throw Error("На изображении остались надписи; передача остановлена");
     if(!canPayForNextBatch(plan.budget,plan.batches,receipts))
       throw Error("Достигнут заданный предел расходов онлайн-анализа");
     const packet:AutoVolumePacket={
       schema:"opus-public-volume-auto-ocr/v1",
       modality:series.modality as "CT"|"MR",
       frames:batch.privacy.frames.map(f=>({
         frameId:f.frameId,pngBase64:f.pngBase64,sha256:f.sha256,
         ocrSha256:batch.privacy.ocr[f.frameId].sha256,ocrClear:true,
       })),
     };
     setStage("gemini");setNotice("Gemini изучает изображения исследования…");
     const response=await fetch("/api/ai/approved-volume-gemini-batch",{
       method:"POST",cache:"no-store",credentials:"same-origin",signal,
       headers:{"Content-Type":"application/json","X-Opus-Auto-Public-Volume":"1"},
       body:JSON.stringify({
         packet,acknowledgeClinicianLawfulDisclosure:true,
         acknowledgeProviderHealthDataTerms:true,
         acknowledgeAutomaticOCRAndNoPerFramePhysicianReview:true,
         acknowledgeOnePaidGeminiBatch:true,
       }),
     });
     if(!response.ok)throw Error("Анализ изображений временно недоступен ("+response.status+")");
     const answer=await response.json() as VolumeGeminiBatchResult;
     if(answer.modality!==series.modality)throw Error("Несоответствие исследуемого ряда");
     receipts=appendGeminiVolumeReceipt(receipts,plan.batches,batch.batchIndex,answer);
     setProgress(volumeLedger(plan.budget,plan.batches,receipts).processedOverviewFrames);
   }
   const ledger=volumeLedger(plan.budget,plan.batches,receipts);
   if(!ledger.completedFullOverview||receipts.length!==plan.batches.length)
     throw Error("Не весь томографический ряд удалось оценить");
   setStage("detectors");
   setNotice("Сопоставляем результаты визуального анализа и детекторов…");
   // Gemini was started independently of local models. Never block indefinitely
   // on a hanging CPU/GPU detector worker.
   const began=Date.now();
   while(!signal.aborted&&detectorStageRef.current==="running"&&Date.now()-began<30_000)
     await new Promise<void>(r=>setTimeout(r,250));
   if(signal.aborted)throw Error("Анализ отменён");
   const state=detectorStageRef.current==="completed"?"completed":
     detectorStageRef.current==="running"?"timeout":"unavailable";
   const safe=makeSafeVolumeOpusInput(series.modality as "CT"|"MR",
     plan.budget,plan.batches,receipts,
     detectorEvidenceRef.current,state);
   setStage("opus");setNotice("Claude Opus объединяет результаты и составляет заключение…");
   const final=await fetch("/api/ai/complete-volume-opus",{
     method:"POST",cache:"no-store",credentials:"same-origin",signal,
     headers:{"Content-Type":"application/json","X-Opus-Auto-Public-Volume":"1"},
     body:JSON.stringify(safe),
   });
   if(!final.ok)throw Error("Формирование заключения недоступно ("+final.status+")");
   const output=await final.json() as FullVolumeOpusResult;
   if(output.schema!=="opus-full-volume-radiologist/v1"||
     output.modality!==series.modality||
     output.overviewReviewed!==plan.sourceFrames.length||
     !output.physicianSignatureRequired||
     typeof output.finalReport!=="string"||output.finalReport.length<180)
     throw Error("Сервер не подтвердил структуру заключения");
   setReport(output);setEditable(output.finalReport);
   setStage("completed");setNotice("Описание и заключение готовы для проверки врачом.");
 }
 useEffect(()=>{
   if(!autoStart||!plan||started.current)return;
   if(sessionReady===null)return;
   started.current=true;
   const controller=new AbortController();ctl.current=controller;
   if(!sessionReady){
     setStage("unavailable");
     setNotice("Облачный анализ на рабочем месте не подключён. Исходные DICOM доступны для самостоятельного просмотра.");
     return;
   }
   void execute(controller.signal).catch(e=>{
     if(controller.signal.aborted)return;
     setStage("interrupted");
     setNotice(e instanceof Error?e.message:"Автоматический анализ не завершён");
   });
 // Only the primary action can initiate automatic paid study-wide cloud analysis.
 // Once the operator session is resolved, a user-initiated primary analysis starts.
 // No subsequent admin reconnection silently restarts failed paid inference.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[autoStart,sessionReady]);
 function stop(){
   ctl.current?.abort();setStage("interrupted");
   setNotice("Анализ остановлен. Результат неполный; повторный платный запуск не выполняется.");
 }
 function download(){
   if(stage!=="completed"||!report||!editable.trim())return;
   const url=URL.createObjectURL(new Blob([editable.trim()+"\n"],{
     type:"text/plain;charset=utf-8"}));
   const a=document.createElement("a");a.href=url;
   a.download="opus-radiology-report.txt";document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 if(!plan)return <p role="status">Полный томографический ряд недоступен для автоматической обработки. Снимки можно просмотреть вручную.</p>;
 return <section aria-label="Автоматический анализ всего исследования">
   <h4>Результат анализа исследования</h4>
   <p role="status">{notice}</p>
   {["preparing","gemini","detectors","opus"].includes(stage)&&
     <p>Изучено {progress} из {plan.sourceFrames.length} срезов.
       {stage==="opus"?" Формируется протокол рентгенолога.":""}</p>}
   {stage==="completed"&&report&&<>
     <h4>Описание и заключение</h4>
     <p>Предварительный протокол. Проверьте исходные снимки и при необходимости отредактируйте.</p>
     <textarea rows={18} style={{width:"100%"}} value={editable}
       onChange={e=>setEditable(e.target.value)}/>
     <button type="button" onClick={download}>Сохранить заключение</button>
   </>}
   {["preparing","gemini","detectors","opus"].includes(stage)&&
     <button type="button" onClick={stop}>Остановить анализ</button>}
   {!autoStart&&<p>Для автоматической обработки нажмите общую кнопку
     «Анализировать исследование» над просмотром снимков.</p>}
   {sessionReady===false&&<details>
     <summary>Администратору · подключение рабочего места</summary>
     <p>Однократно настройте разрешённую исследовательскую обработку
       на локальном сервере. Врач не вводит ключи или адреса моделей.</p>
     <label>Код администратора <input type="password" value={adminToken}
       autoComplete="off" onChange={e=>setAdminToken(e.target.value)}/></label>
     <button type="button" onClick={()=>void connectAdmin()}>Подключить</button>
     {adminIssue&&<p role="status">{adminIssue}</p>}
   </details>}
   <details><summary>Просмотреть отдельные срезы</summary>
     {plan.sourceFrames.length} изображений. Выберите срез в окне DICOM
     или используйте просмотр списка исследований.
     <button type="button" onClick={()=>onOpenSlice(plan.sourceFrames[Math.floor(plan.sourceFrames.length/2)].fileId)}>
       Открыть средний срез
     </button>
   </details>
 </section>;
}
