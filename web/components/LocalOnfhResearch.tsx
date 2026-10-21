"use client";
import {useEffect,useState} from "react";
type Impression={schema:string;researchONFHScore:number;researchAboveThreshold:boolean;
 preliminaryClinicalImpression:string;clinicalRecommendations:string;limitations:string[];
 analyzedSliceCount:number;diagnosisConfirmed:false;};
export default function LocalOnfhResearch(){
 const [available,setAvailable]=useState(false);
 const [files,setFiles]=useState<File[]>([]);
 const [ack,setAck]=useState(false);
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState<Impression|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/research/onfh-local",{cache:"no-store",signal:controller.signal})
   .then(r=>r.ok?r.json():null)
   .then(v=>{if(!controller.signal.aborted)setAvailable(v?.available===true);})
   .catch(()=>{});
  return ()=>controller.abort();
 },[]);
 async function run(){
  if(!available||busy||files.length<2||!ack)return;
  setBusy(true);setError("");setResult(null);
  const body=new FormData();body.set("acknowledged","research-only");
  files.forEach(file=>body.append("slices",file));
  try{
   const response=await fetch("/api/research/onfh-local",{method:"POST",body,cache:"no-store"});
   const data:unknown=await response.json();
   if(!response.ok)throw Error((data as {error?:string}).error??"Local inference failed");
   const v=data as Impression;
   if(v.schema!=="opus-onfh-local-preliminary-impression/v1"||
      typeof v.researchONFHScore!=="number"||!Array.isArray(v.limitations)||
      v.diagnosisConfirmed!==false)throw Error("Invalid ONFH research report");
   setResult(v);
  }catch(e){setError(e instanceof Error?e.message:"Ошибка локального анализа");}
  finally{setBusy(false);}
 }
 return <section className="cl-panel" aria-label="ONFH локальный исследовательский инференс">
   <h2>Остеонекроз головки бедренной кости — локальный МРТ-анализ</h2>
   <p>Обученная на JLU-ONFH исследовательская модель. Только папка с PNG-срезами одной МРТ-серии.
   Не поддерживаются DICOM, КТ, NIfTI, смешанные последовательности. Файлы обрабатываются
   локальным процессом Python на вашем компьютере, без облачных LLM.</p>
   {!available&&<p role="status">Локальные ONFH-веса пока не настроены или интерфейс
     открыт не на localhost. См. docs/ONFH_LOCAL_PRELIMINARY_IMPRESSION.md.</p>}
   <label>Выберите оригинальные МРТ-срезы PNG (2–300)
     <input aria-label="МРТ PNG-срезы для ONFH" type="file" accept=".png,image/png" multiple
       disabled={busy||!available} onChange={e=>{setFiles(Array.from(e.target.files??[]));
         setResult(null);setAck(false);}}/>
   </label>
   <p>{files.length} срезов выбрано.</p>
   <label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>
     Подтверждаю исследовательское применение: предварительная оценка не исключает ONFH,
     не устанавливает стадию ARCO и требует пересмотра врачом.</label>
   <p><button type="button" disabled={!available||!ack||busy||files.length<2||files.length>300}
       onClick={()=>void run()}>{busy?"Локальный анализ…":"Получить предварительное заключение ONFH"}</button></p>
   {error&&<p className="cl-error" role="alert">{error}</p>}
   {result&&<div className="cl-case" aria-live="polite">
     <h3>Предварительное клиническое заключение AI</h3>
     <p><strong>{result.preliminaryClinicalImpression}</strong></p>
     <p>Исследовательский показатель ONFH: {result.researchONFHScore.toFixed(4)}
     (не калиброванная вероятность заболевания). Срезов: {result.analyzedSliceCount}.</p>
     <p>{result.clinicalRecommendations}</p>
     <strong>Ограничения:</strong><ul>{result.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul>
     <button type="button" onClick={()=>{
       const blob=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});
       const url=URL.createObjectURL(blob);const a=document.createElement("a");
       a.href=url;a.download="opus-onfh-preliminary-report.json";a.click();
       setTimeout(()=>URL.revokeObjectURL(url),500);
     }}>Скачать предварительный JSON-отчёт</button>
   </div>}
 </section>;
}
