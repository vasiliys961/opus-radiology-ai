"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {assembleSanitizedDetectorBundle,type DetectorRuntimeSnapshot} from "../lib/detector-consilium-evidence";
import type {NumericConsiliumResult} from "../lib/detector-gemini-opus-numeric";
import type {AiProvider} from "../lib/ai-gateway";

export default function DetectorGeminiOpusConsilium({snapshot}:{snapshot:DetectorRuntimeSnapshot}){
 const [provider,setProvider]=useState<AiProvider>("openrouter");
 const [consent,setConsent]=useState(false),[paid,setPaid]=useState(false);
 const [working,setWorking]=useState(false),[error,setError]=useState("");
 const [review,setReview]=useState<NumericConsiliumResult|null>(null),[draft,setDraft]=useState("");
 const controller=useRef<AbortController|null>(null);
 const result=useMemo(()=>{
  try{return {data:assembleSanitizedDetectorBundle(snapshot),error:""};}
  catch(e){return {data:null,error:e instanceof Error?e.message:"Не исследовано"};}
 },[snapshot.modality,snapshot.region,snapshot.nativeSourceSha256,snapshot.nodules,
    snapshot.effusion,snapshot.pe,snapshot.nodes,snapshot.abdomen,
    snapshot.ich,snapshot.wmh,snapshot.brain]);
 const stamp=JSON.stringify(result.data);
 useEffect(()=>{
  controller.current?.abort();setWorking(false);setError("");setReview(null);setDraft("");
  setConsent(false);setPaid(false);
  return()=>controller.current?.abort();
 },[stamp]);
 const data=result.data;
 if(!data)return <section className="cs-geometry"><h3>Gemini → Opus</h3>
  <p>Нет подготовленного общего пакета: {result.error}</p></section>;
 const completed=data.facts.filter(f=>f.status==="completed");
 async function analyze(){
  if(!consent||!paid||working||!data)return;
  controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl;
  setWorking(true);setError("");setReview(null);setDraft("");
  try{
   const res=await fetch("/api/ai/detector-consilium",{method:"POST",signal:ctrl.signal,
    headers:{"Content-Type":"application/json"},cache:"no-store",credentials:"same-origin",
    body:JSON.stringify({schema:"opus-authorized-detector-consilium-request/v1",
     provider,bundle:data,acknowledgeAuthorizedDeidentifiedNumericEvidence:true,
     acknowledgeExternalPaidCalls:true})});
   const result:unknown=await res.json();
   if(!res.ok)throw Error("Сервис не настроен или недоступен (HTTP "+res.status+").");
   if(!result||typeof result!=="object")throw Error("Неверный ответ.");
   const v=result as NumericConsiliumResult;
   if(v.schema!=="opus-numeric-detector-consilium/v1"||
     v.clinicalStatus!=="unverified_research_draft"||
     v.pixelReviewPerformed!==false||v.sourceIdentifiersSubmitted!==false||
     v.clinicalValidation!==false||v.provider!==provider||
     typeof v.opus?.summary!=="string"||!Array.isArray(v.opus.limitations)||
     !Array.isArray(v.gemini?.reviewedTasks)||
     v.gemini.reviewedTasks.length!==completed.length||
     !v.gemini.reviewedTasks.every(t=>completed.some(f=>f.task===t)))
      throw Error("Модель не подтвердила состав исходных задач.");
   if(ctrl.signal.aborted)return;
   setReview(v);setDraft(v.opus.summary);
  }catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:"Ошибка Gemini/Opus");}
  finally{if(!ctrl.signal.aborted)setWorking(false);}
 }
 function exportDraft(){
  if(!review||!draft.trim()||draft.length>6000)return;
  const payload={schema:"opus-unsigned-numeric-physician-draft/v1",
   modality:data?.modality,region:data?.region,facts:data?.facts,
   gemini:review.gemini,opusModel:review.opusModel,
   editableUnsignedReport:draft,limitations:review.opus.limitations,
   patientPixelsSubmitted:false,sourceIdentifiersSubmitted:false,
   clinicalValidation:false,physicianReviewed:false};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],
    {type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="opus-consilium-unsigned.json";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="cs-geometry" aria-label="Числовой консилиум Gemini и Opus">
  <h3>Единый консилиум · Gemini → Claude Opus</h3>
  <p>Передаются только обезличенные числа выполненных детекторов, без DICOM, изображений,
   UID, исходных SHA или истории болезни. Это не Gemini Vision и не клиническая валидация.</p>
  <p>Завершено моделей: {completed.length} из {data.facts.length} задач.</p>
  <details><summary>Проверить передаваемые числовые факты</summary>
   {data.facts.map(f=><p key={f.task}>{f.task}: {f.status==="completed"
    ?("кандидатов "+f.candidateCount+", объём "+(f.candidateVolumeMl??"не измерен"))
    :"не исследовано"}</p>)}
  </details>
  <label>Провайдер <select value={provider} disabled={working}
   onChange={e=>{setProvider(e.target.value as AiProvider);setReview(null);}}>
   <option value="openrouter">OpenRouter</option><option value="polza">Polza</option>
  </select></label>
  <label><input type="checkbox" checked={consent} disabled={working}
    onChange={e=>setConsent(e.target.checked)}/>
   Я уполномочен передать эти обезличенные числовые факты провайдеру.
  </label>
  <label><input type="checkbox" checked={paid} disabled={working}
    onChange={e=>setPaid(e.target.checked)}/>
   Разрешаю два платных запроса: Gemini, затем Opus.
  </label>
  <button type="button" disabled={!consent||!paid||working} onClick={()=>void analyze()}>
   {working?"Анализируем…":"Составить предварительный Gemini → Opus черновик"}
  </button>
  {working&&<button type="button" onClick={()=>controller.current?.abort()}>Отменить</button>}
  {error&&<p role="alert">{error}</p>}
  {review&&<div role="status">
   <h4>Gemini · задания для повторной оценки</h4>
   <p>{review.gemini.priorityTasks.join(", ")||"Приоритеты не указаны"}</p>
   {review.gemini.uncertainties.map((s,i)=><p key={i}>{s}</p>)}
   <h4>Opus · неподписанный предварительный отчёт</h4>
   <textarea rows={7} maxLength={6000} value={draft} onChange={e=>setDraft(e.target.value)}/>
   {review.opus.limitations.map((s,i)=><p key={i}>{s}</p>)}
   <button type="button" disabled={!draft.trim()} onClick={exportDraft}>Сохранить черновик JSON</button>
   <p>Отрицательный диагноз не допускается. Все находки проверяются врачом на исходных срезах.</p>
  </div>}
 </section>;
}
