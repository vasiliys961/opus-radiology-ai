"use client";
import {useState, type ChangeEvent} from "react";
import {validateMorphometryReport, type NumericReview} from "../lib/morphometry-evidence";

const MAX_REPORT_BYTES=128*1024;

/** Numeric-only public research outputs. This control NEVER uploads selected files. */
export default function MorphometryEvidenceReview(){
 const [report,setReport]=useState<NumericReview|null>(null);
 const [sourceConfirm,setSourceConfirm]=useState("");
 const [error,setError]=useState("");
 const [name,setName]=useState("");
 async function onPick(e:ChangeEvent<HTMLInputElement>){
  setReport(null);setSourceConfirm("");setName("");setError("");
  const file=e.target.files?.[0];
  e.target.value="";
  if(!file)return;
  if(file.size===0||file.size>MAX_REPORT_BYTES||!file.name.toLowerCase().endsWith(".json")){
   setError("Выберите небольшой числовой исследовательский JSON до 128 КБ.");return;
  }
  try{
   const raw=await file.text();
   if(raw.length>MAX_REPORT_BYTES)throw Error("Числовой JSON превышает ограничение.");
   const imported=validateMorphometryReport(JSON.parse(raw) as unknown);
   setReport(imported);setName(file.name);
  }catch(err){setError(err instanceof Error?err.message:"Невозможно проверить результат.");}
 }
 const confirmed=!!report&&sourceConfirm.toLowerCase()===report.sourceSha256;
 return <section className="cs-geometry" aria-label="Количественные находки КТ и МРТ">
  <h2>Морфометрия · числовые результаты</h2>
  <p>Отдельные исследовательские измерения сердца и сосудов, позвоночника, печени,
   белого вещества мозга, желчного пузыря и тазобедренных суставов.</p>
  <p><strong>Только локальный JSON.</strong> Изображения, DICOM и маски сюда не загружаются и не передаются в облако.
   Сам JSON не доказывает подлинность модели или принадлежность результатов открытой серии.</p>
  <label>Исследовательский числовой отчёт {" "}
   <input type="file" accept=".json,application/json" onChange={e=>{void onPick(e);}}/>
  </label>
  {error&&<p role="alert">{error}</p>}
  {report&&<div>
   <h3>{report.title}</h3>
   <p>Файл: {name}</p>
   <p>SHA-256 исходной серии: <code style={{overflowWrap:"anywhere"}}>{report.sourceSha256}</code></p>
   <label>Для просмотра величин введите SHA-256 оригинальной КТ/МРТ, отдельно
    сверенный с открытым исследованием: {" "}
    <input type="text" value={sourceConfirm} onChange={e=>setSourceConfirm(e.target.value.trim())}
     placeholder="64 символа SHA-256" maxLength={64} style={{maxWidth:"100%"}}/>
   </label>
   {!confirmed?<p role="status">Измерения скрыты, пока не подтверждён SHA-256 исходного исследования.</p>:<>
    <div role="table" aria-label="Числовые морфометрические измерения">
     {report.fields.map(x=><div role="row" key={x.label} style={{display:"flex",gap:12,justifyContent:"space-between"}}>
      <span role="cell">{x.label}</span><strong role="cell">{x.value}</strong>
     </div>)}
    </div>
    {report.warnings.map(w=><p key={w}><small>{w}</small></p>)}
   </>}
   <p><strong>Исследовательский режим · клиническая точность не подтверждена.</strong></p>
   <button type="button" onClick={()=>{setReport(null);setSourceConfirm("");setName("");setError("");}}>
    Очистить данные
   </button>
  </div>}
 </section>;
}
