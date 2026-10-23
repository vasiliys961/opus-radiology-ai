"use client";
import {useState,type ChangeEvent} from "react";
import {sha256} from "@noble/hashes/sha2.js";

type RenalReport={
 schema:"opus-real-public-kits23-kidney-cyst-comparison/v1";
 task:"kidney_cysts";
 truePretrainedModelInferenceCompleted:true;
 originalNativeSourceGridVerified:true;
 clinicalValidation:false;
 noCystDiagnosisPermitted:false;
 sourceSha256:string;
 originalDimensions:number[];
 publicCaseCode:string;
 expertRenalCystLabel3Voxels:number;
 truePositiveCystVoxels:number;
 falsePositiveCystVoxels:number;
 falseNegativeCystVoxels:number;
 falseCystVoxelsInsideExpertTumor:number;
 oneSourceCystDice:number|null;
 oneSourceCystVoxelRecall:number;
};
function readReport(raw:unknown):RenalReport {
 if(!raw||typeof raw!=="object")throw Error("Требуется числовой JSON-отчёт");
 const p=raw as Record<string,unknown>;
 if(p.schema!=="opus-real-public-kits23-kidney-cyst-comparison/v1"||
 p.task!=="kidney_cysts"||p.truePretrainedModelInferenceCompleted!==true||
 p.originalNativeSourceGridVerified!==true||p.clinicalValidation!==false||
 p.noCystDiagnosisPermitted!==false||typeof p.sourceSha256!=="string"||
 !/^[a-f0-9]{64}$/.test(p.sourceSha256))throw Error("Неизвестный протокол проверки кист");
 if(!Array.isArray(p.originalDimensions)||p.originalDimensions.length!==3||
 p.originalDimensions.some((x:unknown)=>!Number.isSafeInteger(x)||Number(x)<=0))
 throw Error("Недопустимая геометрия КТ");
 for(const k of ["expertRenalCystLabel3Voxels","truePositiveCystVoxels",
 "falsePositiveCystVoxels","falseNegativeCystVoxels","falseCystVoxelsInsideExpertTumor"]){
  if(!Number.isSafeInteger(p[k])||Number(p[k])<0)throw Error("Неверные счётчики экспертной разметки");
 }
 if(p.oneSourceCystDice!==null&&
 (typeof p.oneSourceCystDice!=="number"||p.oneSourceCystDice<0||p.oneSourceCystDice>1))
 throw Error("Неверный Dice");
 if(typeof p.oneSourceCystVoxelRecall!=="number"||
 p.oneSourceCystVoxelRecall<0||p.oneSourceCystVoxelRecall>1)
 throw Error("Неверная полнота");
 return p as unknown as RenalReport;
}
export default function RenalCystResearchEvidence(){
 const [data,setData]=useState<RenalReport|null>(null);
 const [verified,setVerified]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function readFile(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value="";
  setData(null);setVerified(false);setError("");
  if(!file)return;
  if(file.size>100000){setError("Отчёт слишком велик");return;}
  try{setData(readReport(JSON.parse(await file.text())));}
  catch(e){setError(e instanceof Error?e.message:"Неверный отчёт");}
 }
 async function verify(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value="";
  setVerified(false);setError("");
  if(!file||!data)return;
  if(file.size>1024**3){setError("Лимит исходной КТ: 1 ГБ");return;}
  setBusy(true);
  const hash=sha256.create();let bytes=0;
  const reader=file.stream().getReader();
  try{
   for(;;){const part=await reader.read();if(part.done)break;
    bytes+=part.value.length;
    if(bytes>1024**3)throw Error("Размер КТ превышает лимит");
    hash.update(part.value);
   }
   const digest=Array.from(hash.digest(),x=>x.toString(16).padStart(2,"0")).join("");
   if(bytes!==file.size||digest!==data.sourceSha256)throw Error("Исходная КТ не совпадает по SHA-256");
   setVerified(true);
  }catch(e){setError(e instanceof Error?e.message:"Невозможно проверить КТ");}
  finally{reader.releaseLock();setBusy(false);}
 }
 return <section aria-label="Кисты почек: исследовательский анализ KiTS23">
 <h3>Почки · настоящая модель кист · KiTS23</h3>
 <p>Исследовательское сравнение предобученной модели с экспертной маской кист на одной публичной КТ. Не ставит диагноз и не исключает кисты или опухоли. Лицензия набора KiTS23 ограничивает коммерческое применение.</p>
 <label>Отчёт оценки модели (.json) <input type="file" accept=".json,application/json" onChange={e=>void readFile(e)}/></label>
 {error&&<p role="alert">{error}</p>}
 {data&&<div>
  <p>Источник: {data.publicCaseCode}; экспертные воксели кист: {data.expertRenalCystLabel3Voxels}.</p>
  <p>Одно исследование: Dice {data.oneSourceCystDice===null?"не рассчитан":data.oneSourceCystDice.toFixed(3)}; полнота по вокселям {data.oneSourceCystVoxelRecall.toFixed(3)}. Клиническая чувствительность и специфичность неизвестны.</p>
  <label>Проверить исходную публичную КТ (.nii.gz) <input disabled={busy} type="file" accept=".nii,.gz" onChange={e=>void verify(e)}/></label>
  <p role="status">{verified?"Совпадение SHA-256 подтверждено":"Привязка к исходной КТ не подтверждена"}</p>
  {verified&&<p>TP: {data.truePositiveCystVoxels}; FP: {data.falsePositiveCystVoxels}; FN: {data.falseNegativeCystVoxels}; ошибочное включение опухоли: {data.falseCystVoxelsInsideExpertTumor} вокселей.</p>}
 </div>}
 </section>;
}
