"use client";
import {useState, type ChangeEvent} from "react";

type Candidate = {modelClassId:number;sourceModelLabel:string;candidateVoxelCount:number;sourceVoxelBoundsInclusive:number[][];volumeMlOnlyWhenOriginalUnitsVerified:number|null;clinicalDiagnosis:null;interpretationStatus:string};
type Report={schema:string;model:string;sourceSha256:string;patientClinicalUseAllowed:false;independentAccuracyValidated:false;sourceGeometryVerified:true;findingStatus:string;candidates:Candidate[]};

function validate(value:unknown):Report {
  if (!value || typeof value !== "object") throw Error("Некорректный JSON");
  const q=value as Record<string,unknown>;
  if(q.schema!=="opus-physician-research-candidates/v1"||q.model!=="LungSCAPE191"||q.patientClinicalUseAllowed!==false||q.independentAccuracyValidated!==false||q.sourceGeometryVerified!==true||q.findingStatus!=="research_candidates_not_diagnosis")throw Error("Это не подтверждённый исследовательский отчёт LungSCAPE191");
  if(typeof q.sourceSha256!=="string"||!/^[0-9a-f]{64}$/.test(q.sourceSha256))throw Error("Отсутствует SHA-256 источника");
  if(!Array.isArray(q.candidates)||q.candidates.length>100)throw Error("Некорректное количество кандидатов");
  for(const k of q.candidates){
    if(!k||typeof k!=="object"||!Number.isInteger(k.modelClassId)||k.modelClassId<1||typeof k.sourceModelLabel!=="string"||k.sourceModelLabel.length>100||!Number.isSafeInteger(k.candidateVoxelCount)||k.candidateVoxelCount<1||k.clinicalDiagnosis!==null||k.interpretationStatus!=="requires_physician_review"||!Array.isArray(k.sourceVoxelBoundsInclusive)||k.sourceVoxelBoundsInclusive.length!==2||!k.sourceVoxelBoundsInclusive.every((a:unknown)=>Array.isArray(a)&&a.length===3&&a.every((n:unknown)=>typeof n === "number" && Number.isSafeInteger(n) && n >= 0)))throw Error("Недопустимые координаты или клинические утверждения");
  }
  return q as unknown as Report;
}
export default function LungscapePhysicianEvidencePanel(){
 const [report,setReport]=useState<Report|null>(null);
 const [problem,setProblem]=useState("");
 const [sourceVerified,setSourceVerified]=useState(false);
 const [verifying,setVerifying]=useState(false);
 async function open(e:ChangeEvent<HTMLInputElement>){
  setReport(null);setProblem("");setSourceVerified(false);
  const file=e.target.files?.[0];e.target.value="";
  if(!file)return;
  if(file.size>128_000){setProblem("Файл превышает лимит 128 КБ");return;}
  try{setReport(validate(JSON.parse(await file.text())))}catch(err){setProblem(err instanceof Error?err.message:"Неизвестная ошибка");}
 }
 async function verifySource(e:ChangeEvent<HTMLInputElement>){
   setSourceVerified(false);setProblem("");
   const source=e.target.files?.[0];e.target.value="";
   if(!source || !report)return;
   // Browser digest is whole-file; protect low-RAM machines from full-file allocation.
   if(source.size>256*1024*1024){setProblem("Исходная КТ больше 256 МБ: используйте отдельную потоковую проверку SHA-256; загрузка в память запрещена.");return;}
   setVerifying(true);
   try{
     const bytes=await source.arrayBuffer();
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
     if(hash!==report.sourceSha256)throw Error("SHA-256 исходной КТ не совпадает с отчётом. Находки нельзя привязать к этой КТ.");
     setSourceVerified(true);
   }catch(err){setProblem(err instanceof Error?err.message:"Ошибка проверки источника");}
   finally{setVerifying(false);}
 }
 return <section aria-label="LungSCAPE191 исследовательские находки">
  <h3>LungSCAPE191 · результаты для врачебной проверки</h3>
  <p>Загрузите только числовой JSON из GitHub Actions. Данные пациентов не передаются. Это не диагноз и не подтверждение отсутствия патологии.</p>
  <label>Импорт числового отчёта <input type="file" accept=".json,application/json" onChange={open}/></label>
  {problem&&<p role="alert">{problem}</p>}
  {report&&<div><p>Исходная КТ SHA-256: <code>{report.sourceSha256}</code></p>
  <label>Подтвердить исходный NIfTI .nii.gz по SHA-256 <input type="file" accept=".nii.gz,.nii" onChange={e=>void verifySource(e)} disabled={verifying}/></label>
  <p role="status">{sourceVerified?"✓ SHA-256 исходной КТ совпадает с отчётом. Геометрическая привязка к DICOM ещё не подтверждена.":verifying?"Проверка SHA-256…":"Исходная КТ ещё не подтверждена: координаты не применять к текущей серии."}</p>
  <p>Исследовательские кандидаты: {report.candidates.length}. Независимая клиническая точность не установлена.</p>
  <ol>{sourceVerified && report.candidates.map((k,i)=><li key={i}>Класс модели {k.modelClassId}: {k.sourceModelLabel}. {k.candidateVoxelCount} вокселей. Границы IJK: {JSON.stringify(k.sourceVoxelBoundsInclusive)}. {k.volumeMlOnlyWhenOriginalUnitsVerified===null?"Объём в мл не подтверждён.":`Объём ${k.volumeMlOnlyWhenOriginalUnitsVerified} мл.`} Требуется врачебная оценка.</li>)}</ol>
  <p>Наложение на текущую DICOM-серию отключено: необходима независимая проверка идентичности исходной КТ и геометрии.</p></div>}
 </section>;
}
