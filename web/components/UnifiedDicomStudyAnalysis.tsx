"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {planNativeStudyAnalysis} from "../lib/unified-study-dispatch";
import {prepareDicomMonaiFile,prepareDicomCtForPathology} from "../lib/dicom-monai-direct";
import {runOriginalAbdominalModels,type AbdominalStudyResults} from "../lib/real-abdominal-worker";
import {executeRealNodule} from "../lib/live-nodule-worker";
import type {BoundNoduleReport} from "../lib/live-nodule-report";
import {runOriginalEffusionTask315,type OriginalEffusionRun} from "../lib/real-effusion-worker";
import {executeOriginalPeCtp,type PeCtpSourceReport} from "../lib/pe-ctpa-direct-worker";
import {runOriginalRaidionicsNodes,type MediastinalNodeReport} from "../lib/mediastinal-raidionics-worker";
import {runPublicIchWorker} from "../lib/public-ich-worker";
import {call,type WorkerSession} from "../lib/local-worker";
import {bindWmhToSelectedDicom,type BoundWmh} from "../lib/wmh-source-review";
import type {EvidenceJson} from "../lib/evidence-json";
import {createNativePhysicianDraft,type NativeDicomDigest} from "../lib/native-physician-draft";
import {prepareNativeBrainMr} from "../lib/brain-native-mr-dicom";
import {executeOriginalBrain,BRAIN_ROLES,type BrainTask,type BrainModelReport} from "../lib/brain-multisequence-original-worker";
import DetectorGeminiOpusConsilium from "./DetectorGeminiOpusConsilium";
import type {SanitizedDetectorBundle} from "../lib/detector-consilium-evidence";

/** A single primary action that reuses the real DICOM -> MONAI/ianpan/WMH paths.
 * Never advertises a checkpoint as installed until its private worker proves it.
 * No automatic cloud image transfer; Gemini/Opus require a separate privacy gate.
 */
export default function UnifiedDicomStudyAnalysis({series,allSeries,files,onMonaiReady,onNavigate,onDetectorEvidence,onReadyForVision}:{
 series:DicomSeries;allSeries:ReadonlyArray<DicomSeries>;files:ReadonlyMap<string,File>;
 onMonaiReady:(source:File,session:WorkerSession,completedReport?:BoundNoduleReport)=>void;
 onNavigate:(slice:number)=>void;
 onDetectorEvidence?:(seriesKey:string,bundle:SanitizedDetectorBundle|null)=>void;
 onReadyForVision?:(seriesKey:string)=>void;
}){
 const available=useMemo(()=>new Set(files.keys()),[files]);
 const plan=useMemo(()=>planNativeStudyAnalysis(series,available),[series,available]);
 const [endpoint,setEndpoint]=useState("");
 const [token,setToken]=useState("");
 const [effusionEndpoint,setEffusionEndpoint]=useState("http://127.0.0.1:8774");
 const [effusionToken,setEffusionToken]=useState("");
 const [peEndpoint,setPeEndpoint]=useState("http://127.0.0.1:8776");
 const [peToken,setPeToken]=useState("");
 const [ctpaConfirmed,setCtpaConfirmed]=useState(false);
 const [chestPe,setChestPe]=useState<PeCtpSourceReport|null>(null);
 const [nodeEndpoint,setNodeEndpoint]=useState("http://127.0.0.1:8777");
 const [nodeToken,setNodeToken]=useState("");
 const [enhancedChestConfirmed,setEnhancedChestConfirmed]=useState(false);
 const [chestNodes,setChestNodes]=useState<MediastinalNodeReport|null>(null);
 const [chestSource,setChestSource]=useState<File|null>(null);
 const [chestNodules,setChestNodules]=useState<BoundNoduleReport|null>(null);
 const [chestEffusion,setChestEffusion]=useState<OriginalEffusionRun|null>(null);
 const [chestIssues,setChestIssues]=useState<string[]>([]);
 const [abdomenResult,setAbdomenResult]=useState<AbdominalStudyResults|null>(null);
 const [authorized,setAuthorized]=useState(false);
 const [flairConfirmed,setFlairConfirmed]=useState(false);
 const [sourceUrl,setSourceUrl]=useState("");
 const [sourceLicense,setSourceLicense]=useState("");
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [ich,setIch]=useState<EvidenceJson|null>(null);
 const [wmh,setWmh]=useState<BoundWmh|null>(null);
 const [brainTask,setBrainTask]=useState<"wmh"|BrainTask>("wmh");
 const [brainSeriesByRole,setBrainSeriesByRole]=useState<Record<string,string>>({});
 const [brainSequenceApproved,setBrainSequenceApproved]=useState(false);
 const [brainResult,setBrainResult]=useState<BrainModelReport|null>(null);
 const [decisions,setDecisions]=useState<Record<string,"accepted"|"rejected">>({});
 const [draftText,setDraftText]=useState("");
 const [exporting,setExporting]=useState(false);
 const serial=useRef(0),active=useRef<AbortController|null>(null);
 const preset=plan.route==="monai-nodules"?"http://127.0.0.1:8768":
   plan.route==="ianpan-ich"?"http://127.0.0.1:8766":
   plan.route==="totalseg-abdomen"?"http://127.0.0.1:8775":
   plan.route==="wmh-flair"&&brainTask!=="wmh"?"http://127.0.0.1:8778":"http://127.0.0.1:8772";
 const compatibleBrainSeries=useMemo(()=>{
   if(plan.route!=="wmh-flair")return [];
   const study=series.members[0]?.metadata.studyUid;
   const frame=series.members[0]?.metadata.frameOfReferenceUid;
   if(!study||!frame)return [];
   return allSeries.filter(s=>s.modality==="MR"&&s.volumeReady&&s.spatiallySorted&&
     s.members.length>=8&&s.members.length<=300&&
     s.members.every(m=>m.metadata.bodyRegion==="HEAD"&&
       m.metadata.studyUid===study&&m.metadata.frameOfReferenceUid===frame&&
       m.metadata.imageRole!=="DERIVED"&&m.metadata.imageRole!=="LOCALIZER"&&files.has(m.id)));
 },[allSeries,files,plan.route,series]);
 const assignedBrainRoles=brainTask==="wmh"?[]:BRAIN_ROLES[brainTask];
 const brainAssignedReady=brainTask!=="wmh"&&
   assignedBrainRoles.every(role=>!!brainSeriesByRole[role]&&
     compatibleBrainSeries.some(s=>s.key===brainSeriesByRole[role]))&&
   new Set(assignedBrainRoles.map(role=>brainSeriesByRole[role])).size===assignedBrainRoles.length;
 useEffect(()=>{
   serial.current++;active.current?.abort();
   setEndpoint(preset);setToken("");setEffusionEndpoint("http://127.0.0.1:8774");setEffusionToken("");
   setPeEndpoint("http://127.0.0.1:8776");setPeToken("");setCtpaConfirmed(false);setChestPe(null);
   setNodeEndpoint("http://127.0.0.1:8777");setNodeToken("");setEnhancedChestConfirmed(false);setChestNodes(null);
   setChestSource(null);setChestNodules(null);setChestEffusion(null);setChestPe(null);setChestNodes(null);setChestIssues([]);setAbdomenResult(null);
   setAuthorized(false);setFlairConfirmed(false);
   setSourceUrl("");setSourceLicense("");setBusy(false);setError("");setStatus("");
   setIch(null);setWmh(null);setBrainResult(null);setDecisions({});setDraftText("");setExporting(false);
   return ()=>{serial.current++;active.current?.abort();};
 },[series,files,preset]);
 const chestPlan=plan.route==="monai-nodules";
 const ready=!!plan.route&&authorized&&!busy&&
   (chestPlan?((!!token&&!!endpoint.trim())||(!!effusionToken&&!!effusionEndpoint.trim())||(ctpaConfirmed&&!!peToken&&!!peEndpoint.trim())||(enhancedChestConfirmed&&!!nodeToken&&!!nodeEndpoint.trim())):
     (!!token&&!!endpoint.trim()))&&
   (!plan.needsExplicitFlair||(
     brainTask==="wmh"?
       (flairConfirmed&&sourceUrl.startsWith("https://")&&!!sourceLicense.trim()):
       (brainSequenceApproved&&brainAssignedReady&&sourceUrl.startsWith("https://")&&!!sourceLicense.trim())
   ));

 async function launch(){
   if(!ready||!plan.route)return;
   const version=++serial.current;
   active.current?.abort();
   const controller=new AbortController();active.current=controller;
   setBusy(true);setStatus("Проверяем совместимость и доступность настоящей модели...");
   onDetectorEvidence?.(series.key,null);
   setError("");setIch(null);setWmh(null);setBrainResult(null);setChestSource(null);setChestNodules(null);
   setChestEffusion(null);setChestPe(null);setChestNodes(null);setChestIssues([]);setAbdomenResult(null);setDecisions({});setDraftText("");
   const session:WorkerSession={endpoint,token};
   const progress=(message:string)=>{
     if(version===serial.current&&!controller.signal.aborted)setStatus(message);
   };
   try{
     if(plan.route==="monai-nodules"){
       // One native HU conversion, TWO truly trained pathology tasks.
       // Each worker runs sequentially: no heavy simultaneous RAM pressure.
       const original=series.members.map(m=>files.get(m.id));
       if(original.some(f=>!f))throw Error("Исходная DICOM-КТ больше недоступна.");
       const nifti=await prepareDicomMonaiFile(series,original as File[],controller.signal,progress);
       if(version!==serial.current||controller.signal.aborted)return;
       setChestSource(nifti);
       const problems:string[]=[];
       let completed=0;
       if(token.trim()){
         try{
           const result=await executeRealNodule(session,nifti,controller.signal,progress);
           if(version!==serial.current||controller.signal.aborted)return;
           setChestNodules(result.report);completed++;
         }catch(e){
           if(controller.signal.aborted)return;
           problems.push("MONAI узлы: "+(e instanceof Error?e.message:"исполнитель недоступен"));
         }
       }else problems.push("MONAI узлы: не указан токен исполнителя; не исследовано.");
       if(effusionToken.trim()){
         try{
           const result=await runOriginalEffusionTask315(
             {endpoint:effusionEndpoint,token:effusionToken},nifti,controller.signal,progress);
           if(version!==serial.current||controller.signal.aborted)return;
           setChestEffusion(result);completed++;
         }catch(e){
           if(controller.signal.aborted)return;
           problems.push("TotalSegmentator выпоты: "+(e instanceof Error?e.message:"исполнитель недоступен"));
         }
       }else problems.push("Плевральный/перикардиальный выпот: нет токена task315; не исследовано.");
       if(ctpaConfirmed){
         if(peToken.trim()){
           try{
             const result=await executeOriginalPeCtp(
               {endpoint:peEndpoint,token:peToken},nifti,true,controller.signal,progress);
             if(version!==serial.current||controller.signal.aborted)return;
             setChestPe(result);completed++;
           }catch(e){
             if(controller.signal.aborted)return;
             problems.push("ТЭЛА nnU-Net: "+(e instanceof Error?e.message:"исполнитель недоступен"));
           }
         }else problems.push("ТЭЛА nnU-Net: модель CTPA не запускалась, не задан токен.");
       }else{
         problems.push("ТЭЛА не исследована: тип серии CTPA не подтверждён врачом.");
       }
       if(enhancedChestConfirmed){
         if(nodeToken.trim()){
           try{
             const result=await runOriginalRaidionicsNodes(
               {endpoint:nodeEndpoint,token:nodeToken},
               nifti,true,controller.signal,progress);
             if(version!==serial.current||controller.signal.aborted)return;
             setChestNodes(result);completed++;
           }catch(e){
             if(controller.signal.aborted)return;
             problems.push("Лимфоузлы средостения Raidionics: "+
               (e instanceof Error?e.message:"исполнитель недоступен"));
           }
         }else problems.push("Лимфоузлы средостения: не указан токен ONNX worker; не исследовано.");
       }else problems.push("Лимфоузлы средостения: контрастная КТ не подтверждена; не исследовано.");
       if(version!==serial.current||controller.signal.aborted)return;
       setChestIssues(problems);
       const total=2+Number(ctpaConfirmed)+Number(enhancedChestConfirmed);
       setDraftText("Исследовательская КТ грудной клетки. Выполнено настоящих патологических моделей: "+
         completed+" из "+total+". Условия оценки ограничены выбранной серией. "+
         "Результаты являются кандидатами, которые обязан проверить врач. "+
         "Остальные заболевания грудной клетки не оценены.");
       setStatus(completed?
         "Завершено моделей: "+completed+" из "+total+". Недоступные анализы явно отмечены.":
         "Ни одна патологическая модель не выполнена. Исследование не оценено.");
       if(completed>0)onReadyForVision?.(series.key);
       return;
     }
     if(plan.route==="totalseg-abdomen"){
       const original=series.members.map(m=>files.get(m.id));
       if(original.some(f=>!f))throw Error("Исходная DICOM-КТ брюшной полости больше недоступна.");
       const nifti=await prepareDicomCtForPathology(
         series,original as File[],controller.signal,"ABDOMEN",progress);
       if(version!==serial.current||controller.signal.aborted)return;
       const result=await runOriginalAbdominalModels(session,nifti,controller.signal,progress);
       if(version!==serial.current||controller.signal.aborted)return;
       setAbdomenResult(result);
       const done=Object.values(result.tasks).filter(x=>x.status==="completed").length;
       setDraftText("Исследовательская КТ брюшной полости. Исполнены оригинальные "+
         "патологические модели: "+done+" из 3 (кисты почек, очаги печени, опухолевые изменения поджелудочной). "+
         "Модельные кандидаты неспецифичны; врач проверяет находки на исходных срезах. "+
         "Невыполненная модель не означает отрицательный результат.");
       setStatus(done?
         "Оригинальные патологические модели завершены: "+done+" из 3. "+
         "Неоценённые задачи показаны отдельно.":
         "Модели патологии живота не смогли завершить инференс; отсутствие патологии не установлено.");
       if(done>0)onReadyForVision?.(series.key);
       return;
     }
     if(plan.route==="ianpan-ich"){
       const evidence=await runPublicIchWorker(session,series,files,controller.signal,progress);
       if(version!==serial.current||controller.signal.aborted)return;
       const sop=new Set(series.members.map(m=>m.metadata.sopInstanceUid));
       const uid=new Set(series.members.map(m=>m.metadata.seriesUid));
       if(evidence.seriesReviewed.some(x=>!uid.has(x))||evidence.findings.some(f=>
         !sop.has(f.source.sopInstanceUid)||!uid.has(f.source.seriesUid)||f.source.frameIndex!==0))
         throw Error("ICH-находки не соответствуют оригинальным DICOM.");
       setIch(evidence);
       setDraftText("Исследовательская КТ головы: исполнена модель ianpan. Кандидатов на кровоизлияние: "+
         evidence.findings.length+". Требуется сверка каждого очага с исходной КТ. "+
         "Отсутствие кандидатов не исключает кровоизлияние; анализ других патологий не проводился.");
       setStatus("Настоящий ianpan выполнен. Кандидаты требуют проверки врача.");
       onReadyForVision?.(series.key);
       return;
     }
     if(plan.route==="wmh-flair"&&brainTask!=="wmh"){
       if(!brainSequenceApproved||!brainAssignedReady)
         throw Error("МР-последовательности не подтверждены врачом.");
       const sourceFiles:Record<string,File>={};
       const usedSeries=new Set<string>();
       for(const role of assignedBrainRoles){
         if(controller.signal.aborted)throw new DOMException("Оригинальная МРТ отменена.","AbortError");
         const chosen=compatibleBrainSeries.find(x=>x.key===brainSeriesByRole[role]);
         if(!chosen||usedSeries.has(chosen.key))
           throw Error("Исходная МР-серия для "+role+" не установлена или повторяется.");
         usedSeries.add(chosen.key);
         const volume=chosen.members.map(m=>files.get(m.id));
         if(volume.some(x=>!x))throw Error("Исходный DICOM "+role+" больше недоступен.");
         progress("Подготавливаем исходную МР-последовательность "+role+"…");
         sourceFiles[role]=await prepareNativeBrainMr(
           chosen,volume as File[],role,controller.signal,progress);
       }
       if(controller.signal.aborted||version!==serial.current)return;
       const result=await executeOriginalBrain(session,brainTask,sourceFiles,
         brainSequenceApproved,controller.signal,progress);
       if(controller.signal.aborted||version!==serial.current)return;
       setBrainResult(result);
       const count=Object.values(result.modelRegions).reduce(
         (sum,region)=>sum+region.components.length,0);
       setDraftText("Исследовательская МРТ головного мозга: модель "+
         (brainTask==="stroke"?"ISLES22 DWI/ADC/FLAIR (ишемические очаги)":
           "BraTS T1CE/T1/T2/FLAIR (опухолевые субрегионы)")+
         " выполнена на подтверждённых исходных последовательностях. "+
         "Модельных компонентов: "+count+". Окончательная диагностика требует "+
         "проверки врача с сопоставлением всех оригинальных серий.");
       setStatus("Настоящая "+(brainTask==="stroke"?"ISLES22":"BraTS")+
         " завершена. Показаны исследовательские очаги на исходной физической сетке.");
       onReadyForVision?.(series.key);
       return;
     }
     // MR weighting cannot be inferred reliably from scanning sequence codes;
     // require a separate explicit FLAIR operator check and public-source rights.
     const response=await call(session,"/v1/wmh/capabilities",{signal:controller.signal});
     const cap=await response.json() as Record<string,unknown>;
     if(cap.schema!=="opus-direct-wmh-worker/v1"||cap.originalModelReady!==true||
        cap.patientMode!==false||cap.imageUpload!==true||
        cap.dataPolicy!=="approved-public-research-only"||cap.modelVersion!=="1.6.0")
       throw Error("WMH worker не подтвердил подлинную установленную модель.");
     const form=new FormData();
     form.set("confirmed","yes");form.set("publicRights","yes");
     form.set("sourceUrl",sourceUrl);form.set("sourceLicense",sourceLicense);
     for(const member of series.members){
       if(controller.signal.aborted)throw new DOMException("Отменено","AbortError");
       const file=files.get(member.id);
       if(!file)throw Error("Отсутствует исходный DICOM-срез МРТ.");
       form.append("dicom",file,"slice.dcm");
     }
     progress("Загружаем разрешённые исходные FLAIR DICOM в приватный worker...");
     const output=await call(session,"/v1/wmh/analyze",{
       method:"POST",body:form,signal:controller.signal,
     });
     const data:unknown=await output.json();
     const bound=await bindWmhToSelectedDicom(data,series,files);
     if(version!==serial.current||controller.signal.aborted)return;
     setWmh(bound);
     setDraftText("Исследовательская FLAIR-МРТ головы: выполнен WMH fold 0. "+
       "Кандидатных гиперинтенсивных компонентов: "+bound.components.length+
       "; суммарный объём "+bound.totalMl.toFixed(2)+" мл. "+
       "Изменения неспецифичны; требуется врачебная оценка и дифференциальная интерпретация.");
     setStatus("Оригинальный WMH fold 0 выполнен. Сверены SHA-256 исходных DICOM.");
     onReadyForVision?.(series.key);
   }catch(e){
     if(version===serial.current&&!controller.signal.aborted)
       setError(e instanceof Error?e.message:"Анализ не завершился. Результата нет.");
   }finally{
     if(version===serial.current)setBusy(false);
   }
 }
 async function saveUnsignedDraft(){
   if(!ich&&!wmh||!draftText.trim()||exporting)return;
   const revision=serial.current;
   setExporting(true);setError("");
   try{
     const digests:NativeDicomDigest[]=[];
     for(const member of series.members){
       if(revision!==serial.current)throw Error("Исследование изменилось во время сохранения.");
       const file=files.get(member.id),sop=member.metadata.sopInstanceUid;
       if(!file||!sop)throw Error("Отсутствует оригинальный DICOM для локального сохранения.");
       // One original DICOM file in memory at a time; no upload or persistence.
       const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
       const sha=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
       digests.push({sopInstanceUid:sop,sha256:sha});
     }
     const input=ich?{kind:"ianpan-ich" as const,result:ich}:
       {kind:"wmh-flair" as const,result:wmh!};
     if(revision!==serial.current)throw Error("Исследование изменилось во время сохранения.");
     const draft=createNativePhysicianDraft(series,input,decisions,draftText,digests,new Date().toISOString());
     const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:"application/json"}));
     try{
       const a=document.createElement("a");a.href=url;
       a.download="opus-native-unsigned-physician-review.json";
       document.body.appendChild(a);a.click();a.remove();
     }finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
     setStatus("Неподписанный предварительный отчёт с UID и SHA-256 сохранён локально.");
   }catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить черновик.");}
   finally{setExporting(false);}
 }
 function cancel(){
   serial.current++;active.current?.abort();active.current=null;
   setBusy(false);setStatus("Анализ отменён. Неинтерпретированные зоны остаются неоценёнными.");
 }
 return <section className="cs-geometry" aria-label="Единый анализ DICOM">
  <h2>Анализ исследования</h2>
  <p><strong>{plan.title}</strong> · КТ/МРТ, текущая исходная серия. Автоматический выбор по проверенной анатомии;
    наличие настоящих весов подтверждается только worker при запуске.</p>
  {plan.reason&&<p role="status">Не запущено: {plan.reason}</p>}
  {plan.route&&<>
   <details>
    <summary>Настройки приватного исполнителя и разрешение</summary>
    <label>Адрес локального worker <input type="text" value={endpoint} disabled={busy} onChange={e=>setEndpoint(e.target.value)}/></label>
    <label>Токен worker <input type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
    {chestPlan&&<div className="cs-geometry">
      <strong>Второй детектор той же КТ: плевральный и перикардиальный выпот</strong>
      <label>Адрес TotalSegmentator task315 worker <input type="text" value={effusionEndpoint} disabled={busy} onChange={e=>setEffusionEndpoint(e.target.value)}/></label>
      <label>Токен task315 <input type="password" autoComplete="off" value={effusionToken} disabled={busy} onChange={e=>setEffusionToken(e.target.value)}/></label>
      <p>Плевральный и перикардиальный классы выполняет ОДНА оригинальная модель; другая модель на те же классы не запускается.</p>
    </div>}
    {chestPlan&&<div className="cs-geometry">
      <strong>Четвёртая отдельная задача: лимфоузлы средостения · оригинальный Raidionics</strong>
      <label><input type="checkbox" checked={enhancedChestConfirmed} disabled={busy}
        onChange={e=>setEnhancedChestConfirmed(e.target.checked)}/>
        Врач подтвердил: исследование — контрастная КТ грудной клетки с оценкой средостения.</label>
      {enhancedChestConfirmed&&<>
        <label>Адрес Raidionics worker <input type="text" value={nodeEndpoint}
          disabled={busy} onChange={e=>setNodeEndpoint(e.target.value)}/></label>
        <label>Токен Raidionics <input type="password" autoComplete="off"
          value={nodeToken} disabled={busy} onChange={e=>setNodeToken(e.target.value)}/></label>
      </>}
      <p>Маска лёгких R231 строится автоматически на той же КТ как анатомическое условие Raidionics.
        Это НЕ второй патологический детектор. Лимфоузлы не классифицируются как метастазы.</p>
    </div>}
    {chestPlan&&<div className="cs-geometry">
      <strong>Третья отдельная задача: ТЭЛА · только подтверждённая CTPA</strong>
      <label><input type="checkbox" checked={ctpaConfirmed} disabled={busy}
        onChange={e=>setCtpaConfirmed(e.target.checked)}/>
        Врач проверил протокол: эта выбранная серия является КТ-ангиографией лёгочных артерий с пригодной контрастной фазой.</label>
      {ctpaConfirmed&&<>
        <label>Адрес PE nnU-Net worker <input type="text" value={peEndpoint} disabled={busy}
          onChange={e=>setPeEndpoint(e.target.value)}/></label>
        <label>Токен PE worker <input type="password" autoComplete="off" value={peToken} disabled={busy}
          onChange={e=>setPeToken(e.target.value)}/></label>
      </>}
      <p>Не применять на произвольной КТ грудной клетки. Исследовательская модель показала Dice 0,038 на одном FUMPE; решение требует ручной проверки, отрицательная ТЭЛА не исключается.</p>
    </div>}
    {plan.needsExplicitFlair&&<div className="cs-geometry">
      <label>Задача оригинальной модели МРТ головного мозга
       <select value={brainTask} disabled={busy} onChange={e=>{
         setBrainTask(e.target.value as "wmh"|BrainTask);
         setBrainSequenceApproved(false);setBrainResult(null);setBrainSeriesByRole({});
       }}>
        <option value="wmh">FLAIR · гиперинтенсивности WMH (одна модель)</option>
        <option value="stroke">DWI + ADC + FLAIR · ишемия ISLES22</option>
        <option value="glioma">T1CE + T1 + T2 + FLAIR · глиома BraTS</option>
       </select>
      </label>
      {brainTask==="wmh"?<>
        <label><input type="checkbox" checked={flairConfirmed} disabled={busy} onChange={e=>setFlairConfirmed(e.target.checked)}/>
         Врач подтвердил: выбранная исходная МР-серия действительно FLAIR.</label>
      </>:<>
        <p>Для модели {brainTask==="stroke"?"ISLES22":"BraTS"} выберите различные
         исходные серии одного StudyUID и FrameOfReferenceUID. Названия последовательностей
         не угадываются по DICOM: их подтверждает врач.</p>
        {assignedBrainRoles.map(role=><label key={role}>Исходная серия для {role.toUpperCase()}
         <select value={brainSeriesByRole[role]??""} disabled={busy}
          onChange={e=>{
            setBrainSeriesByRole(old=>({...old,[role]:e.target.value}));
            setBrainSequenceApproved(false);setBrainResult(null);
          }}>
          <option value="">Выберите исходную МР-серию</option>
          {compatibleBrainSeries.map(item=><option key={item.key} value={item.key}>
             {item.label} · {item.members.length} срезов
          </option>)}
         </select>
        </label>)}
        <label><input type="checkbox" checked={brainSequenceApproved} disabled={busy||!brainAssignedReady}
         onChange={e=>setBrainSequenceApproved(e.target.checked)}/>
          Я проверил назначение всех последовательностей, их принадлежность одному исследованию,
          корректную регистрацию и правомерность обработки.</label>
        {brainTask==="glioma"&&<p>BraTS требует четыре уже зарегистрированные
           МР-серии размером 240×240×155. Несовместимое исследование не запускается.</p>}
      </>}
      <label>URL разрешённого публичного исследования <input type="url" value={sourceUrl}
        disabled={busy} onChange={e=>setSourceUrl(e.target.value)}/></label>
      <label>Лицензия исходного исследования <input type="text" value={sourceLicense}
        disabled={busy} onChange={e=>setSourceLicense(e.target.value)}/></label>
    </div>}
    <label><input type="checkbox" checked={authorized} disabled={busy} onChange={e=>setAuthorized(e.target.checked)}/>
     Подтверждаю разрешённый публичный обезличенный исследовательский источник и полномочия на локальный запуск. Пациентские снимки этим маршрутом не передавать.</label>
    <p>MONAI, task315, оригинальный Raidionics, исследовательский PE, TotalSegmentator живота и WMH используют разрешённые изображения в loopback worker; ianpan передаёт только SHA-256 и анализирует заранее установленную идентичную публичную КТ. Облачная передача не выполняется.</p>
   </details>
   <button type="button" disabled={!ready} onClick={()=>void launch()}>
    {busy?"Выполняется реальный анализ...":"Анализировать исследование"}
   </button>
   {busy&&<button type="button" onClick={cancel}>Отменить</button>}
   {!ready&&!busy&&<p role="status">Для запуска откройте «Настройки» и укажите токен работающего worker и необходимые разрешения. Неподтверждённая модель не запускается.</p>}
  </>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">Не выполнено: {error}</p>}
  {abdomenResult&&<section className="cs-geometry" aria-label="Кисты почек, очаги печени и поджелудочная · исходный DICOM">
    <h3>КТ живота · три различные оригинальные модели</h3>
    <p>Одна подготовленная HU-КТ, последовательное выполнение без повторных моделей
      одной патологии. Исходный объём и отчёты связаны по SHA-256.
      Координаты срезов — предположительное соответствие DICOM; врач проверяет физическую сетку.</p>
    {(["kidney_cysts","liver_lesions","pancreatic_tumor"] as const).map(task=>{
      const item=abdomenResult.tasks[task];
      return <div key={task}>
        <h4>{task==="kidney_cysts"?"Кисты почек · TotalSegmentator":task==="liver_lesions"?"Очаги печени · TotalSegmentator":"Опухолевые кандидаты поджелудочной · MONAI DiNTS"}</h4>
        {item.status!=="completed"?<p role="status">Не исследовано: {item.reason}. Это не отрицательная находка.</p>:
          <div>
            <p>Оригинальная модель выполнена. Кандидаты требуют врачебной оценки.</p>
            {item.report.schema==="opus-real-monai-pancreatic-tumor-source-candidates/v1"?
              <div>
                <p>Модельных вокселей класса 2: {item.report.sourceNativeTumorVoxelCount}.
                  Органная метка поджелудочной (класс 1) НЕ считается опухолью.</p>
                {item.report.tumorCandidateComponents.map((c,i)=><div key={i}>
                  <p>Кандидат {i+1}: {c.candidateVoxelCount} вокселей, {c.candidateVolumeMl.toFixed(2)} мл.
                    Источник RAS: {c.worldRasCentroidMm.join(", ")} мм.</p>
                  <button type="button" onClick={()=>{
                    const k=Math.round(c.nativeSourceCentroidIJK[2]);
                    if(k>=0&&k<series.members.length)onNavigate(k);
                  }}>Открыть предположительный DICOM-срез кандидата</button>
                </div>)}
                {item.report.tumorCandidateComponents.length===0&&<p>Положительных модельных кандидатов нет; опухоль не исключена.</p>}
              </div>:
              item.report.proposals.map(c=><div key={c.labelId}>
              <p><strong>{c.pathologyClass}</strong> · модельных вокселей {c.modelCandidateVoxels};
                исследовательский объём {c.modelCandidateVolumeMl.toFixed(2)} мл.</p>
              {c.nativeSliceIndicesK.length>0&&<button type="button" onClick={()=>{
                const index=c.nativeSliceIndicesK[Math.floor(c.nativeSliceIndicesK.length/2)];
                if(index>=0&&index<series.members.length)onNavigate(index);
              }}>Показать предполагаемый соответствующий DICOM-срез</button>}
              {c.modelCandidateVoxels===0&&<p>Модель не выделила кандидатов; патология не исключена.</p>}
            </div>)}
          </div>}
      </div>;
    })}
    <label>Предварительное заключение врача
      <textarea rows={4} maxLength={12000} value={draftText} onChange={e=>setDraftText(e.target.value)}/>
    </label>
    <p>Исследовательские результаты не содержат независимого клинического подтверждения.
      Обработка Gemini/Opus доступна отдельно после обезличивания и разрешения врача.</p>
  </section>}
  {chestPlan&&chestIssues.length>0&&<div role="status" className="cs-geometry">
    <strong>Непроверенные направления</strong>
    {chestIssues.map((message,i)=><p key={i}>{message}</p>)}
  </div>}
  {chestNodules&&<div className="cs-geometry">
    <h3>Узлы лёгких · оригинальная MONAI RetinaNet</h3>
    <p>Настоящий pretrained inference завершён. Кандидатов: <strong>{chestNodules.candidates.length}</strong>.
      Совпадение NIfTI и исходного DICOM по отдельным SOP ещё не доказано; отрицательного диагноза нет.</p>
    {chestNodules.candidates.slice(0,30).map(c=><p key={c.index}>
      Кандидат #{c.index+1}, score {c.score.toFixed(3)};
      координата LPS {c.centerLpsMm.map(n=>n.toFixed(1)).join(" / ")} мм.
    </p>)}
    {chestNodules.candidates.length>30&&<p>Показаны первые 30 кандидатов.</p>}
    {chestSource&&<button type="button" onClick={()=>onMonaiReady(chestSource,{endpoint,token},chestNodules)}>
      Открыть подробный просмотр и врачебную оценку MONAI
    </button>}
  </div>}
  {chestNodes&&<div className="cs-geometry" aria-label="Средостение — оригинальный Raidionics">
    <h3>Лимфоузлы средостения · настоящий Raidionics ONNX</h3>
    <p>Оригинальный Lungmask R231 подготовил необходимую анатомическую маску,
      затем выполнен оригинальный ONNX. Это одна задача патологической сегментации,
      не диагноз метастазов, опухоли или воспаления.</p>
    <p>Модельных вокселей: {chestNodes.modelPositiveVoxels};
      отдельных кандидатов: {chestNodes.candidates.length}.</p>
    {chestNodes.candidates.slice(0,50).map((c,i)=><div key={i}>
      <p>Лимфоузел-кандидат {i+1}: {c.candidateVolumeMl.toFixed(3)} мл;
        RAS {c.sourceRASmm.join(", ")} мм.</p>
      <button type="button" onClick={()=>{
        const k=Math.round(c.sourceCentroidIJK[2]);
        if(k>=0&&k<series.members.length)onNavigate(k);
      }}>Показать предполагаемый исходный DICOM-срез</button>
    </div>)}
    {chestNodes.candidates.length>50&&<p>Показаны первые 50 кандидатов.</p>}
    {chestNodes.candidates.length===0&&<p>Кандидатов нет; отсутствие лимфаденопатии не доказано.</p>}
  </div>}
  {chestPe&&<div className="cs-geometry" aria-label="CTPA — оригинальная модель ТЭЛА">
    <h3>ТЭЛА · настоящий Mazurowski nnU-Net</h3>
    <p>Протокол CTPA подтверждён врачом. Исходная КТ и маска связаны по SHA-256.
      Модель не валидирована и ранее на одном FUMPE показала Dice 0,038. Отсутствие
      находок не исключает тромбоэмболию.</p>
    <p>Положительных модельных вокселей: {chestPe.sourceNativeVoxelPositiveCount};
      пространственных кандидатов: {chestPe.lesions.length}.</p>
    {chestPe.lesions.slice(0,60).map((c,i)=><div key={i}>
      <p>Кандидат {i+1}: {c.modelCandidateMl.toFixed(3)} мл, RAS {c.sourceRASmm.join(", ")} мм.</p>
      <button type="button" onClick={()=>{
        const k=Math.round(c.sourceCentroidIJK[2]);
        if(k>=0&&k<series.members.length)onNavigate(k);
      }}>Проверить предполагаемый исходный DICOM-срез</button>
    </div>)}
    {chestPe.lesions.length>60&&<p>Показаны первые 60 кандидатов.</p>}
  </div>}
  {chestEffusion&&<div className="cs-geometry">
    <h3>Плевральный и перикардиальный выпот · настоящий task315</h3>
    <p>Исходная HU-КТ и модельный отчёт связаны по SHA-256. Класс 1 — анатомический, не жидкость.</p>
    {chestEffusion.report.evidence.fluidCandidates.map(c=><div key={c.labelId}>
      <p><strong>{c.labelId===2?"Плевральная жидкость":"Перикардиальная жидкость"}</strong>:
        модельных вокселей {c.modelPositiveNativeVoxelCount};
        объём кандидата {c.modelUnvalidatedFluidLabelVolumeMl.toFixed(2)} мл.</p>
      {c.nativeSourceSliceIndicesK.length>0&&<button type="button" onClick={()=>{
        const k=c.nativeSourceSliceIndicesK[Math.floor(c.nativeSourceSliceIndicesK.length/2)];
        if(k>=0&&k<series.members.length)onNavigate(k);
      }}>Показать предполагаемый соответствующий DICOM-срез (проверить геометрию)</button>}
      {c.modelPositiveNativeVoxelCount===0&&<p>Кандидатов нет; отсутствие выпота не доказано.</p>}
    </div>)}
    <p>Модель не валидирована независимо. Врач проверяет соответствие изображения, объёма и протокола.</p>
  </div>}
  {chestPlan&&(chestNodules||chestEffusion)&&<div className="cs-geometry">
    <h3>Предварительный черновик · проверяет врач</h3>
    <label>Комментарий к результатам
      <textarea rows={4} maxLength={12000} value={draftText} onChange={e=>setDraftText(e.target.value)}/>
    </label>
    <p>Сохранение общего source-bound отчёта для двух моделей ещё не подключено;
      используйте детальную оценку MONAI и анализ выпотов на исходных кадрах.</p>
  </div>}
  {brainResult&&<section className="cs-geometry" aria-label="Исходные МРТ — модельные кандидаты">
    <h3>{brainResult.task==="stroke"?"Ишемические очаги · оригинальный ISLES22 nnU-Net":
      "Глиома · оригинальный BraTS SegResNet"}</h3>
    <p>Настоящая оригинальная модель выполнена. Результаты связаны по SHA-256 с
      выбранными исходными МР-последовательностями. Каждая зона — только
      неподтверждённый модельный кандидат.</p>
    {Object.entries(brainResult.modelRegions).map(([kind,region])=><div key={kind}>
      <h4>{kind} · {region.sourcePositiveVoxels} модельных вокселей</h4>
      {region.components.slice(0,50).map((c,i)=><p key={i}>
        Кандидат {i+1}: {c.candidateVolumeMl.toFixed(3)} мл;
        исходная геометрия RAS {c.nativeCenterRASmm.join(", ")} мм;
        индекс среза {Math.round(c.nativeCenterIJK[2])+1} референсной
        {brainResult.sourceReferenceRole.toUpperCase()} серии.
      </p>)}
      {region.components.length===0&&<p>Кандидатов нет; патология не исключена.</p>}
      {region.components.length>50&&<p>Показаны первые 50 компонентов.</p>}
    </div>)}
    <label>Предварительный текст, проверяет врач
      <textarea rows={5} maxLength={12000} value={draftText}
        onChange={e=>setDraftText(e.target.value)}/>
    </label>
    <p>Исходная физическая сетка подтверждена, но точная привязка к DICOM SOP ещё
      не доказана. Исследовательская модель не определяет клинический диагноз.
      Gemini/Opus могут отдельно анализировать разрешённые кадры, но не заменяют валидацию.</p>
  </section>}
  {ich&&<div>
   <p><strong>ianpan: {ich.findings.length} кандидатов.</strong> Отсутствие кандидатов не исключает кровоизлияние.</p>
   {ich.findings.map((f,i)=>{
     const slice=series.members.findIndex(m=>m.metadata.sopInstanceUid===f.source.sopInstanceUid);
     return <div key={f.findingId+"-"+i}>
       <button type="button" disabled={slice<0} onClick={()=>onNavigate(slice)}>
        {f.sign} · перейти к исходному срезу {slice+1}
       </button>
       <span> {decisions["ich-"+i]??"требует оценки"}</span>
       <button type="button" onClick={()=>setDecisions(s=>({...s,["ich-"+i]:"accepted"}))}>Подтвердить</button>
       <button type="button" onClick={()=>setDecisions(s=>({...s,["ich-"+i]:"rejected"}))}>Отклонить</button>
     </div>;
   })}
  </div>}
  {wmh&&<div>
   <p><strong>WMH: {wmh.components.length} очагов; {wmh.totalMl.toFixed(2)} мл.</strong> FLAIR-гиперинтенсивности неспецифичны.</p>
   {wmh.components.slice(0,100).map((c,i)=>{
     const slice=Math.floor((c.sourceVoxelBoundsInclusive[0][2]+c.sourceVoxelBoundsInclusive[1][2])/2);
     return <div key={c.component}>
      <button type="button" onClick={()=>onNavigate(slice)}>
       Очаг {i+1}, {c.volumeMl.toFixed(3)} мл · перейти к срезу {slice+1}
      </button>
      <span> {decisions["wmh-"+c.component]??"требует оценки"}</span>
      <button type="button" onClick={()=>setDecisions(s=>({...s,["wmh-"+c.component]:"accepted"}))}>Подтвердить</button>
      <button type="button" onClick={()=>setDecisions(s=>({...s,["wmh-"+c.component]:"rejected"}))}>Отклонить</button>
     </div>;
   })}
   {wmh.components.length>100&&<p>Показаны первые 100 очагов.</p>}
  </div>}
  {(ich||wmh)&&<div className="cs-geometry" aria-label="Редактируемый предварительный врачебный отчёт">
   <h3>Предварительное заключение · редактирует врач</h3>
   <label>Текст черновика
    <textarea rows={5} maxLength={12000} value={draftText} disabled={exporting}
      onChange={e=>setDraftText(e.target.value)}/>
   </label>
   <button type="button" disabled={exporting||!draftText.trim()} onClick={()=>void saveUnsignedDraft()}>
     {exporting?"Сверяем SHA-256 исходных DICOM...":"Сохранить неподписанный отчёт и решения врача"}
   </button>
   <p>Локальный JSON содержит оригинальные SOP/Series UID, SHA-256 каждого DICOM, версию/источник модели,
      координаты кандидатов и решения врача. Не загружайте такой файл в публичный GitHub или облачный LLM.
      Это не подписанное клиническое заключение.</p>
  </div>}
  {(chestNodules||chestEffusion||chestPe||chestNodes||abdomenResult||ich||wmh||brainResult)&&
    <DetectorGeminiOpusConsilium onBundleReady={bundle=>onDetectorEvidence?.(series.key,bundle)} snapshot={{
      modality:series.modality as "CT"|"MR",
      region:plan.route==="monai-nodules"?"chest":
        plan.route==="totalseg-abdomen"?"abdomen":"brain",
      nativeSourceSha256:chestNodules?.source.sha256??
        chestEffusion?.sourceSha256??
        chestPe?.sourceNiftiSHA256??
        chestNodes?.sourceNiftiSHA256??
        abdomenResult?.sourceNiftiSha256??null,
      nodules:chestNodules,effusion:chestEffusion,pe:chestPe,nodes:chestNodes,
      abdomen:abdomenResult,ich,wmh,brain:brainResult,
    }}/>}
  <p>Gemini Vision по исходным кадрам выполняется отдельно после обезличивания.
    В этой версии единый консилиум анализирует только обезличенные числа моделей.</p>
 </section>;
}
