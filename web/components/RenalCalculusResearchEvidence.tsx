"use client";
import {useState,type ChangeEvent} from "react";
import {sha256} from "@noble/hashes/sha2.js";

type Candidate={anatomyMaskSide:"left"|"right";sourceVoxelBox:number[][];sourceCentroidIJK:number[];centroidWorldRASmm:number[];candidateVolumeMm3:number;equivalentSphereDiameterMm:number;maxCandidateHU:number;meanCandidateHU:number;stoneDiagnosisProven:false};
type Report={schema:"opus-kidney-calculus-ncct-candidates/v1";modality:"NCCT";sourceCTSHA256:string;sourcePublicURL:string;densityThresholdHU:number;candidateComponents:Candidate[];numberOfCandidateComponents:number;stoneSpecificPretrainedDetector:false;researchOnly:true;patientUseAllowed:false;absenceOfStonesEstablished:false;ureterEvaluated:false;definitiveDiagnosis:null};
const finite=(x:unknown)=>typeof x==="number"&&Number.isFinite(x);
function decode(raw:unknown):Report{
 if(!raw||typeof raw!=="object")throw Error("Некорректный JSON");
 const x=raw as Record<string,unknown>;
 if(x.schema!=="opus-kidney-calculus-ncct-candidates/v1"||x.modality!=="NCCT"||
 !/^[a-f0-9]{64}$/.test(String(x.sourceCTSHA256))||x.stoneSpecificPretrainedDetector!==false||
 x.researchOnly!==true||x.patientUseAllowed!==false||x.absenceOfStonesEstablished!==false||
 x.ureterEvaluated!==false||x.definitiveDiagnosis!==null||
 !finite(x.densityThresholdHU)||Number(x.densityThresholdHU)<120||Number(x.densityThresholdHU)>250||
 typeof x.sourcePublicURL!=="string"||!x.sourcePublicURL.startsWith("https://")||
 !Array.isArray(x.candidateComponents)||x.candidateComponents.length>256||
 !Number.isSafeInteger(x.numberOfCandidateComponents)||x.numberOfCandidateComponents!==x.candidateComponents.length)
 throw Error("Недостоверная схема исследовательского отчёта");
 for(const c of x.candidateComponents as Record<string,unknown>[]){
  if(!c||!["left","right"].includes(String(c.anatomyMaskSide))||
  !Array.isArray(c.sourceVoxelBox)||c.sourceVoxelBox.length!==3||
  c.sourceVoxelBox.some((b:unknown)=>!Array.isArray(b)||b.length!==2||b.some((v:unknown)=>!Number.isSafeInteger(v)||Number(v)<0)||b[1]<b[0])||
  !Array.isArray(c.sourceCentroidIJK)||c.sourceCentroidIJK.length!==3||!c.sourceCentroidIJK.every(finite)||
  !Array.isArray(c.centroidWorldRASmm)||c.centroidWorldRASmm.length!==3||!c.centroidWorldRASmm.every(finite)||
  !["candidateVolumeMm3","equivalentSphereDiameterMm","maxCandidateHU","meanCandidateHU"].every(k=>finite(c[k])&&Number(c[k])>=0)||
  c.stoneDiagnosisProven!==false)throw Error("Недостоверные пространственные координаты кандидата");
 }
 return x as unknown as Report;
}
export default function RenalCalculusResearchEvidence(){
 const [report,setReport]=useState<Report|null>(null),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value="";setReport(null);setVerified(false);setError("");
  if(!f)return;
  try{if(f.size>150000)throw Error("JSON превышает 150 КБ");setReport(decode(JSON.parse(await f.text())));}
  catch(err){setError(err instanceof Error?err.message:"Ошибка чтения");}
 }
 async function verify(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value="";setVerified(false);setError("");if(!f||!report)return;
  if(f.size>800*1024*1024){setError("КТ превышает 800 МиБ");return;}
  setBusy(true);const hash=sha256.create();const reader=f.stream().getReader();let total=0;
  try{for(;;){const x=await reader.read();if(x.done)break;total+=x.value.length;if(total>800*1024*1024)throw Error("Превышен лимит");hash.update(x.value);}
   const digest=Array.from(hash.digest(),v=>v.toString(16).padStart(2,"0")).join("");
   if(total!==f.size||digest!==report.sourceCTSHA256)throw Error("Несовпадение исходной КТ по SHA-256");setVerified(true);
  }catch(err){setError(err instanceof Error?err.message:"Проверка не удалась");}
  finally{reader.releaseLock();setBusy(false);}
 }
 return <section aria-label="Почки: исследовательские гиперденсные включения">
  <h3>Почки · гиперденсные включения NCCT</h3>
  <p>Просмотр 3D-кандидатов из нативной КТ с масками почек. Это пороговый HU-алгоритм, а не обученный детектор камней. Мочеточники не анализируются; отсутствие кандидатов не исключает мочекаменную болезнь.</p>
  <label>Числовой отчёт (.json) <input type="file" accept=".json,application/json" onChange={e=>void load(e)}/></label>
  {error&&<p role="alert">{error}</p>}
  {report&&<div>
   <p>Источник: <a href={report.sourcePublicURL} target="_blank" rel="noreferrer">публичное исследование</a>; порог {report.densityThresholdHU} HU; кандидатов: {report.numberOfCandidateComponents}.</p>
   <label>Подтвердить оригинальную КТ (.nii.gz) <input disabled={busy} type="file" accept=".nii,.gz" onChange={e=>void verify(e)}/></label>
   <p role="status">{verified?"SHA-256 исходной КТ подтверждён":"Источник пока не подтверждён"}</p>
   {verified&&<div>
    {report.candidateComponents.length===0?<p>Кандидаты не выделены. Это НЕ отрицательный диагноз.</p>:
    <ol>{report.candidateComponents.map((c,i)=><li key={i}>
      {c.anatomyMaskSide==="left"?"Левая":"Правая"} почка, кандидат {i+1};
      RAS (мм): {c.centroidWorldRASmm.join(", ")};
      центр IJK: {c.sourceCentroidIJK.join(", ")};
      объём {c.candidateVolumeMm3.toFixed(1)} мм³;
      эквивалентный диаметр {c.equivalentSphereDiameterMm.toFixed(1)} мм;
      максимальная плотность {c.maxCandidateHU.toFixed(0)} HU.
     </li>)}</ol>}
    <p>Гиперденсное включение может быть сосудистым кальцинатом или артефактом. Исследовательский результат требует просмотра исходных срезов врачом.</p>
   </div>}
  </div>}
 </section>;
}
