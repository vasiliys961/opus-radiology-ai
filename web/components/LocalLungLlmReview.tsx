"use client";
import {useEffect,useState} from "react";
import {localLungFacts,type LocalLungReview,type LocalLungFacts} from "../lib/local-lung-review";
import type {SegmentationEvidence} from "../lib/segmentation-evidence";

/** Optional LOCAL text-only model critique; never touches DICOM pixels or APIs. */
export default function LocalLungLlmReview({evidence}:{evidence:SegmentationEvidence}){
 const [models,setModels]=useState<string[]>([]);
 const [model,setModel]=useState("");
 const [accepted,setAccepted]=useState(false);
 const [review,setReview]=useState<LocalLungReview|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 let facts:LocalLungFacts|null=null;
 try{facts=localLungFacts(evidence);}catch{facts=null;}
 useEffect(()=>{
  if(!facts)return;
  const controller=new AbortController();
  fetch("/api/ai/local-lung-review",{cache:"no-store",signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error("Локальная LM Studio не обнаружена");return r.json() as Promise<{models:{id:string}[]}>;})
   .then(v=>{if(!controller.signal.aborted){const ids=v.models.map(x=>x.id);setModels(ids);setModel(ids[0]??"");}})
   .catch(()=>{if(!controller.signal.aborted)setError("Запустите сервер LM Studio на 127.0.0.1:1234. Облачные LLM не вызываются.");});
  return ()=>controller.abort();
 },[evidence]);
 if(!facts)return null;
 async function ask(){
  if(!facts||!model||!accepted||busy)return;
  setBusy(true);setError("");setReview(null);
  try{
   const response=await fetch("/api/ai/local-lung-review",{method:"POST",cache:"no-store",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({facts,modelId:model,acknowledgeLocalInference:true})});
   const value:unknown=await response.json();
   if(!response.ok)throw Error((value as {error?:string}).error??"Локальная модель недоступна");
   const checked=value as {schema:string;review:LocalLungReview;patientPixelsSent:false;externalProvidersCalled:false};
   if(checked.schema!=="opus-local-lung-review-response/v1"||
      checked.patientPixelsSent!==false||checked.externalProvidersCalled!==false)
     throw Error("Недоверенный ответ локальной модели");
   setReview(checked.review);
  }catch(e){setError(e instanceof Error?e.message:"Ошибка локальной LLM");}
  finally{setBusy(false);}
 }
 return <details className="ora-evidence-draft">
  <summary>Локальная LLM · критическая проверка маски R231 (без облака)</summary>
  <p>Только агрегированные объёмы масок правого и левого лёгкого и число обработанных срезов направляются в LM Studio по 127.0.0.1. Нет изображений, UID, SHA, имён файлов или заметок врача. Модель не диагностирует патологию и не подтверждает полноту КТ.</p>
  <p>R231: правая метка {facts.rightLungMaskMl.toFixed(1)} мл · левая {facts.leftLungMaskMl.toFixed(1)} мл · {facts.frameCount} срезов. Объёмы могут быть частичными.</p>
  <label>Загруженная локальная модель <select value={model} onChange={e=>{setModel(e.target.value);setReview(null);}} disabled={busy}>
    {models.map(id=><option key={id} value={id}>{id}</option>)}
  </select></label>
  <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={busy}/> Я разрешаю передать обезличенные числовые измерения локальному процессу LM Studio и понимаю риск повышенного расхода RAM.</label>
  <div className="ora-evidence-actions"><button type="button" disabled={!model||!accepted||busy} onClick={()=>void ask()}>
    {busy?"Работает локальная модель…":"Критически оценить маску через LM Studio"}</button></div>
  {error&&<p role="alert" className="ora-evidence-error">{error}</p>}
  {review&&<div role="status">
    <p><strong>Непроверенный LLM-черновик:</strong> {review.summary}</p>
    <b>Что проверить врачу:</b><ul>{review.qualityQuestions.map((x,i)=><li key={i}>{x}</li>)}</ul>
    <b>Ограничения:</b><ul>{review.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul>
    <small>Выводы LLM не являются диагностическими и не доказывают отсутствие заболевания.</small>
  </div>}
 </details>;
}
