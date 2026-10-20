"use client";
import {useRef,useState,type ChangeEvent} from "react";
import {validateMorphometryReport, type NumericReview} from "../lib/morphometry-evidence";
import {hashLocalNifti} from "../lib/local-research-nifti-sha";

const MAX_REPORT_BYTES=128*1024;

/** Numeric-only public research outputs. This control NEVER uploads selected files. */
export default function MorphometryEvidenceReview(){
 const [report,setReport]=useState<NumericReview|null>(null);
 const [sourceConfirm,setSourceConfirm]=useState("");
 const [sourceError,setSourceError]=useState("");
 const [sourceProgress,setSourceProgress]=useState("");
 const [verifying,setVerifying]=useState(false);
 const activeVerification=useRef<AbortController|null>(null);
 const verificationVersion=useRef(0);
 const [error,setError]=useState("");
 const [name,setName]=useState("");
 async function onPick(e:ChangeEvent<HTMLInputElement>){
  ++verificationVersion.current;activeVerification.current?.abort();
  setReport(null);setSourceConfirm("");setName("");setError("");
  setSourceError("");setSourceProgress("");setVerifying(false);
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
 async function onOriginalSourcePick(e:ChangeEvent<HTMLInputElement>){
  ++verificationVersion.current;
  const version=verificationVersion.current;
  activeVerification.current?.abort();
  setSourceConfirm("");setSourceError("");setSourceProgress("");setVerifying(false);
  const source=e.target.files?.[0];
  e.target.value="";
  if(!source||!report)return;
  if(!/\.nii(\.gz)?$/i.test(source.name)){
   setSourceError("Выберите оригинальный NIfTI .nii или .nii.gz (не DICOM, PNG или ZIP).");return;
  }
  const controller=new AbortController();
  activeVerification.current=controller;
  setVerifying(true);
  try{
   const actual=await hashLocalNifti(source,controller.signal,(n,total)=>{
    if(version===verificationVersion.current)
     setSourceProgress("Чтение локального изображения: "+Math.round(100*n/total)+"%");
   });
   if(version!==verificationVersion.current||controller.signal.aborted)return;
   if(actual!==report.sourceSha256)throw Error("SHA-256 файла КТ/МРТ не совпадает с исходным исследованием отчёта. Числа скрыты.");
   setSourceConfirm(actual);
   setSourceProgress("Точное совпадение локального изображения и исследовательского отчёта.");
  }catch(err){
   if(version===verificationVersion.current&&!controller.signal.aborted)
    setSourceError(err instanceof Error?err.message:"Ошибка проверки SHA-256 NIfTI.");
  }finally{
   if(version===verificationVersion.current){setVerifying(false);activeVerification.current=null;}
  }
 }
 const confirmed=!!report&&sourceConfirm===report.sourceSha256;
 return <section className="cs-geometry" aria-label="Количественные находки КТ и МРТ">
  <h2>Морфометрия · числовые результаты</h2>
  <p>Отдельные исследовательские измерения сердца и сосудов, позвоночника, печени,
   белого вещества мозга, желчного пузыря и тазобедренных суставов и перпендикулярных сечений аорты.</p>
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
   <label>Для сверки выберите локальный исходный NIfTI КТ/МРТ (.nii или .nii.gz). SHA-256 вычисляется в браузере блоками до 2 МиБ, без отправки изображений: {" "}
    <input type="file" accept=".nii,.nii.gz,application/octet-stream" disabled={verifying} onChange={e=>{void onOriginalSourcePick(e);}}/>
   </label>
   {sourceProgress&&<p role="status">{sourceProgress}</p>}
   {sourceError&&<p role="alert">{sourceError}</p>}
   {!confirmed?<p role="status">Измерения скрыты, пока не подтверждён SHA-256 исходного исследования.</p>:<>
    <div role="table" aria-label="Числовые морфометрические измерения">
     {report.fields.map(x=><div role="row" key={x.label} style={{display:"flex",gap:12,justifyContent:"space-between"}}>
      <span role="cell">{x.label}</span><strong role="cell">{x.value}</strong>
     </div>)}
    </div>
    {report.warnings.map(w=><p key={w}><small>{w}</small></p>)}
   </>}
   <p><strong>Исследовательский режим · клиническая точность не подтверждена.</strong></p>
   <button type="button" onClick={()=>{++verificationVersion.current;activeVerification.current?.abort();setReport(null);setSourceConfirm("");setSourceProgress("");setSourceError("");setVerifying(false);setName("");setError("");}}>
    Очистить данные
   </button>
  </div>}
 </section>;
}
