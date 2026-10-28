"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {planNativeStudyAnalysis} from "../lib/unified-study-dispatch";
import {prepareDicomMonaiFile} from "../lib/dicom-monai-direct";
import {runPublicIchWorker} from "../lib/public-ich-worker";
import {call,type WorkerSession} from "../lib/local-worker";
import {bindWmhToSelectedDicom,type BoundWmh} from "../lib/wmh-source-review";
import type {EvidenceJson} from "../lib/evidence-json";
import {createNativePhysicianDraft,type NativeDicomDigest} from "../lib/native-physician-draft";

/** A single primary action that reuses the real DICOM -> MONAI/ianpan/WMH paths.
 * Never advertises a checkpoint as installed until its private worker proves it.
 * No automatic cloud image transfer; Gemini/Opus require a separate privacy gate.
 */
export default function UnifiedDicomStudyAnalysis({series,files,onMonaiReady,onNavigate}:{
 series:DicomSeries;files:ReadonlyMap<string,File>;
 onMonaiReady:(source:File,session:WorkerSession)=>void;
 onNavigate:(slice:number)=>void;
}){
 const available=useMemo(()=>new Set(files.keys()),[files]);
 const plan=useMemo(()=>planNativeStudyAnalysis(series,available),[series,available]);
 const [endpoint,setEndpoint]=useState("");
 const [token,setToken]=useState("");
 const [authorized,setAuthorized]=useState(false);
 const [flairConfirmed,setFlairConfirmed]=useState(false);
 const [sourceUrl,setSourceUrl]=useState("");
 const [sourceLicense,setSourceLicense]=useState("");
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [ich,setIch]=useState<EvidenceJson|null>(null);
 const [wmh,setWmh]=useState<BoundWmh|null>(null);
 const [decisions,setDecisions]=useState<Record<string,"accepted"|"rejected">>({});
 const [draftText,setDraftText]=useState("");
 const [exporting,setExporting]=useState(false);
 const serial=useRef(0),active=useRef<AbortController|null>(null);
 const preset=plan.route==="monai-nodules"?"http://127.0.0.1:8768":
   plan.route==="ianpan-ich"?"http://127.0.0.1:8766":"http://127.0.0.1:8772";
 useEffect(()=>{
   serial.current++;active.current?.abort();
   setEndpoint(preset);setToken("");setAuthorized(false);setFlairConfirmed(false);
   setSourceUrl("");setSourceLicense("");setBusy(false);setError("");setStatus("");
   setIch(null);setWmh(null);setDecisions({});setDraftText("");setExporting(false);
   return ()=>{serial.current++;active.current?.abort();};
 },[series,files,preset]);
 const ready=!!plan.route&&authorized&&!!token&&!!endpoint.trim()&&!busy&&
   (!plan.needsExplicitFlair||(flairConfirmed&&sourceUrl.startsWith("https://")&&!!sourceLicense.trim()));

 async function launch(){
   if(!ready||!plan.route)return;
   const version=++serial.current;
   active.current?.abort();
   const controller=new AbortController();active.current=controller;
   setBusy(true);setStatus("Проверяем совместимость и доступность настоящей модели...");
   setError("");setIch(null);setWmh(null);setDecisions({});setDraftText("");
   const session:WorkerSession={endpoint,token};
   const progress=(message:string)=>{
     if(version===serial.current&&!controller.signal.aborted)setStatus(message);
   };
   try{
     if(plan.route==="monai-nodules"){
       // Existing OPFS streaming conversion preserves native HU/geometry;
       // the existing MONAI review component performs the actual worker run.
       const original=series.members.map(m=>files.get(m.id));
       if(original.some(f=>!f))throw Error("Исходная DICOM-КТ больше недоступна.");
       const nifti=await prepareDicomMonaiFile(series,original as File[],controller.signal,progress);
       if(version!==serial.current||controller.signal.aborted)return;
       onMonaiReady(nifti,session);
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
    {plan.needsExplicitFlair&&<>
     <label><input type="checkbox" checked={flairConfirmed} disabled={busy} onChange={e=>setFlairConfirmed(e.target.checked)}/>
      Врач подтвердил по протоколу, что выбранная исходная МР-серия действительно FLAIR.</label>
     <label>URL публичного источника <input type="url" value={sourceUrl} disabled={busy} onChange={e=>setSourceUrl(e.target.value)}/></label>
     <label>Лицензия публичного исследования <input type="text" value={sourceLicense} disabled={busy} onChange={e=>setSourceLicense(e.target.value)}/></label>
    </>}
    <label><input type="checkbox" checked={authorized} disabled={busy} onChange={e=>setAuthorized(e.target.checked)}/>
     Подтверждаю разрешённый публичный обезличенный исследовательский источник и полномочия на локальный запуск. Пациентские снимки этим маршрутом не передавать.</label>
    <p>MONAI и WMH используют разрешённые изображения в loopback worker; ianpan передаёт только SHA-256 и анализирует заранее установленную идентичную публичную КТ. Облачная передача не выполняется.</p>
   </details>
   <button type="button" disabled={!ready} onClick={()=>void launch()}>
    {busy?"Выполняется реальный анализ...":"Анализировать исследование"}
   </button>
   {busy&&<button type="button" onClick={cancel}>Отменить</button>}
   {!ready&&!busy&&<p role="status">Для запуска откройте «Настройки» и укажите токен работающего worker и необходимые разрешения. Неподтверждённая модель не запускается.</p>}
  </>}
  {status&&<p role="status">{status}</p>}
  {error&&<p role="alert">Не выполнено: {error}</p>}
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
  <p>Gemini Vision и Claude Opus: пока не запускались. Отсутствие анализа не означает норму;
    результаты исследовательские и требуют врачебной оценки.</p>
 </section>;
}
