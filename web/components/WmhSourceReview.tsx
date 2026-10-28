"use client";
import {useEffect,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {bindWmhToSelectedDicom,type BoundWmh} from "../lib/wmh-source-review";
export default function WmhSourceReview({series,files,onNavigate}:{
 series:DicomSeries;files:ReadonlyMap<string,File>;onNavigate:(slice:number)=>void;
}){
 const [result,setResult]=useState<BoundWmh|null>(null);
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const [decisions,setDecisions]=useState<Record<number,"accepted"|"rejected">>({});
 const rev=useRef(0);
 useEffect(()=>{rev.current++;setResult(null);setError("");setBusy(false);setDecisions({});},[series,files]);
 if(series.modality!=="MR"||!series.members.every(m=>m.metadata.bodyRegion==="HEAD"))return null;
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
