"use client";
import {useEffect,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {call,type WorkerSession} from "../lib/local-worker";
import {bindWmhToSelectedDicom,type BoundWmh} from "../lib/wmh-source-review";
export default function WmhSourceReview({series,files,onNavigate}:{
 series:DicomSeries;files:ReadonlyMap<string,File>;onNavigate:(slice:number)=>void;
}){
 const [workerEndpoint,setWorkerEndpoint]=useState("http://127.0.0.1:8772");
 const [token,setToken]=useState("");
 const [sourceUrl,setSourceUrl]=useState("");
 const [sourceLicense,setSourceLicense]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const [result,setResult]=useState<BoundWmh|null>(null);
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const [decisions,setDecisions]=useState<Record<number,"accepted"|"rejected">>({});
 const rev=useRef(0);
 useEffect(()=>{rev.current++;setResult(null);setError("");setBusy(false);setDecisions({});},[series,files]);
 if(series.modality!=="MR"||!series.members.every(m=>m.metadata.bodyRegion==="HEAD"))return null;
 async function direct(){
  if(busy||!confirmed||!token||!sourceUrl.startsWith("https://")||!sourceLicense.trim())return;
  const version=++rev.current;setBusy(true);setError("");setResult(null);setDecisions({});
  try{
   const session:WorkerSession={endpoint:workerEndpoint,token};
   const capabilities=await call(session,"/v1/wmh/capabilities");
   const cap=await capabilities.json() as Record<string,unknown>;
   if(cap.schema!=="opus-direct-wmh-worker/v1"||cap.originalModelReady!==true||cap.patientMode!==false||cap.imageUpload!==true||cap.dataPolicy!=="approved-public-research-only"||cap.modelVersion!=="1.6.0")
    throw Error("WMH worker не подтвердил подлинную установленную модель.");
   const form=new FormData();form.set("confirmed","yes");form.set("publicRights","yes");form.set("sourceUrl",sourceUrl);form.set("sourceLicense",sourceLicense);
   for(const member of series.members){const source=files.get(member.id);if(!source)throw Error("Отсутствует исходный DICOM-срез.");form.append("dicom",source,"slice.dcm");}
   const response=await call(session,"/v1/wmh/analyze",{method:"POST",body:form});
   const data:unknown=await response.json();
   const verified=await bindWmhToSelectedDicom(data,series,files);
   if(version===rev.current)setResult(verified);
  }catch(e){if(version===rev.current)setError(e instanceof Error?e.message:"Невозможно выполнить настоящий WMH-инференс.");}
  finally{if(version===rev.current)setBusy(false);}
 }
 async function load(file:File|undefined){
  if(!file)return;const v=++rev.current;setBusy(true);setError("");setResult(null);
  try{
   if(file.size>2*1024*1024)throw Error("WMH JSON превышает 2 МБ.");
   const report:unknown=JSON.parse(await file.text());
   const verified=await bindWmhToSelectedDicom(report,series,files);
   if(v===rev.current)setResult(verified);
  }catch(e){if(v===rev.current)setError(e instanceof Error?e.message:"Не удалось проверить отчёт.");}
  finally{if(v===rev.current)setBusy(false);}
 }
 return <section className="cs-geometry">
  <h3>WMH · оригинальная FLAIR-модель</h3>
  <p>Откройте отчёт настоящего WMH fold 0, выполненного на текущей публичной МРТ. Проверяются SHA-256 каждого DICOM-среза и положение всех очагов, затем можно перейти к исходному срезу.</p>
  <label>Приватный Linux WMH-worker <input type="text" value={workerEndpoint} disabled={busy} onChange={e=>setWorkerEndpoint(e.target.value)}/></label>
  <label>Токен worker <input type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
  <label>Публичный URL источника <input type="url" value={sourceUrl} disabled={busy} onChange={e=>setSourceUrl(e.target.value)}/></label>
  <label>Лицензия публичной МРТ <input type="text" value={sourceLicense} disabled={busy} onChange={e=>setSourceLicense(e.target.value)}/></label>
  <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Я проверил FLAIR-протокол, обезличивание и разрешение на локальный исследовательский анализ. Не пациентское исследование.</label>
  <button type="button" disabled={busy||!confirmed||!token||!sourceUrl.startsWith("https://")||!sourceLicense.trim()} onClick={()=>void direct()}>Анализировать открытую FLAIR-МРТ настоящей моделью WMH</button>
  <label>Загрузить WMH JSON для этой серии <input type="file" accept=".json,application/json" disabled={busy} onChange={e=>void load(e.target.files?.[0])}/></label>
  {busy&&<p role="status">Сверка исходных DICOM SHA-256…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<div>
   <p><strong>Проверено совпадение источника.</strong> Исследовательских компонентов: {result.components.length}; общий объём гиперинтенсивностей: {result.totalMl.toFixed(2)} мл.</p>
   {result.components.slice(0,100).map((x,i)=><div key={x.component}>
    <button type="button" onClick={()=>onNavigate(Math.floor((x.sourceVoxelBoundsInclusive[0][2]+x.sourceVoxelBoundsInclusive[1][2])/2))}>
     Очаг {i+1} · перейти к DICOM-срезу {Math.floor((x.sourceVoxelBoundsInclusive[0][2]+x.sourceVoxelBoundsInclusive[1][2])/2)+1}
    </button>
    <span> {x.volumeMl.toFixed(3)} мл · {decisions[x.component]??"требует оценки"}</span>
    <button type="button" onClick={()=>setDecisions(d=>({...d,[x.component]:"accepted"}))}>Подтвердить</button>
    <button type="button" onClick={()=>setDecisions(d=>({...d,[x.component]:"rejected"}))}>Отклонить</button>
   </div>)}
   {result.components.length>100&&<p>Показаны первые 100 компонентов из {result.components.length}.</p>}
   <p>Гиперинтенсивности FLAIR неспецифичны: результат не устанавливает РС, сосудистый генез или отсутствие иной патологии. Решения врача остаются только в текущей вкладке.</p>
  </div>}
 </section>;
}
