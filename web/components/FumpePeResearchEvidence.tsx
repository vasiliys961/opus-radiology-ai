"use client";
import {useState, type ChangeEvent} from "react";
import {sha256} from "@noble/hashes/sha2.js";
type Location = {
 originalSourceVoxelBoundsInclusive:[number[],number[]];
 originalSourceVoxelCentroid:number[];
 originalSourceRasMmCentroid:number[]|null;
 candidateVolumeMl:number|null;voxels:number;matchesOneExpertLesion:boolean;notConfirmedPE:true
};
type Report={
 schema:"opus-real-public-ctpa-fumpe-embolism-expert-comparison/v1";
 sourceSha256:string;actualFull3DTrainedInferenceCompleted:true;
 clinicalValidation:false;patientDiagnosisAllowed:false;
 modelConnectedPECandidates:number;
 candidateLocationsOriginalSourceRasMm:Location[];
 originalFullVolumeShape:number[];
 oneVolumeEmbolusDice:number;singleStudyComponentRecall:number;
 candidateLocationListTruncated:boolean
};
function parse(value:unknown):Report {
 if(!value||typeof value!=="object")throw Error("Отчёт должен быть JSON-объектом");
 const v=value as Record<string,unknown>;
 if(v.schema!=="opus-real-public-ctpa-fumpe-embolism-expert-comparison/v1"||
 v.actualFull3DTrainedInferenceCompleted!==true||v.clinicalValidation!==false||
 v.patientDiagnosisAllowed!==false||!/^[a-f0-9]{64}$/.test(String(v.sourceSha256)))
 throw Error("Неизвестный или недостоверный исследовательский отчёт ТЭЛА");
 if(!Array.isArray(v.originalFullVolumeShape)||v.originalFullVolumeShape.length!==3||
 v.originalFullVolumeShape.some((x:unknown)=>!Number.isSafeInteger(x)||Number(x)<2))throw Error("Нет размерности исходной КТ");
 if(!Number.isInteger(v.modelConnectedPECandidates)||Number(v.modelConnectedPECandidates)<0||
 !Array.isArray(v.candidateLocationsOriginalSourceRasMm)||v.candidateLocationsOriginalSourceRasMm.length>40)
 throw Error("Недопустимое количество находок");
 for(const obj of v.candidateLocationsOriginalSourceRasMm){
   if(!obj||obj.notConfirmedPE!==true||!Number.isSafeInteger(obj.voxels)||obj.voxels<1||
   !Array.isArray(obj.originalSourceVoxelBoundsInclusive)||obj.originalSourceVoxelBoundsInclusive.length!==2)
    throw Error("Находка не прошла проверку");
   const [lo,hi]=obj.originalSourceVoxelBoundsInclusive;
   if(!Array.isArray(lo)||!Array.isArray(hi)||lo.length!==3||hi.length!==3||
   lo.some((x:number,i:number)=>!Number.isSafeInteger(x)||x<0||x>hi[i]||hi[i]>=Number((v.originalFullVolumeShape as number[])[i])))
     throw Error("Находка выходит за пределы исходной КТ");
 }
 return v as unknown as Report;
}
export default function FumpePeResearchEvidence(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState("");
 const [bound,setBound]=useState(false),[working,setWorking]=useState(false);
 async function load(e:ChangeEvent<HTMLInputElement>){
   const file=e.target.files?.[0];e.target.value="";setReport(null);setBound(false);setError("");
   if(!file)return;
   if(file.size>200000){setError("Числовой отчёт слишком большой");return;}
   try{setReport(parse(JSON.parse(await file.text())))}catch(x){setError(x instanceof Error?x.message:"Ошибка отчёта");}
 }
 async function verify(e:ChangeEvent<HTMLInputElement>){
   const file=e.target.files?.[0];e.target.value="";setBound(false);setError("");
   if(!file||!report)return;
   if(file.size>1024*1024*1024){setError("Превышен лимит 1 ГБ");return;}
   setWorking(true);
   const digest=sha256.create();let total=0;
   const reader=file.stream().getReader();
   try{
    for(;;){const item=await reader.read();if(item.done)break;
      total+=item.value.byteLength;
      if(total>1024*1024*1024)throw Error("Превышен лимит чтения");
      digest.update(item.value);
    }
    const actual=Array.from(digest.digest(),b=>b.toString(16).padStart(2,"0")).join("");
    if(actual!==report.sourceSha256||total!==file.size)throw Error("SHA-256 КТ не совпадает: координаты скрыты");
    setBound(true);
   }catch(x){setError(x instanceof Error?x.message:"Ошибка SHA-256");}
   finally{reader.releaseLock();setWorking(false);}
 }
 return <section aria-label="ТЭЛА: исследовательская детекция на публичной КТ-ангиографии">
 <h3>ТЭЛА · оригинальная модель FUMPE / Mazurowski</h3>
 <p>Проверка числового результата предобученной модели на публичной КТ-ангиографии. Исследовательский режим CC BY-NC 4.0. Не является диагностикой ТЭЛА и не исключает её отсутствие.</p>
 <label>Числовой отчёт сравнения с экспертной маской <input type="file" accept=".json,application/json" onChange={e=>void load(e)}/></label>
 {error&&<p role="alert">{error}</p>}
 {report&&<div>
 <p>Одна публичная КТ: Dice {report.oneVolumeEmbolusDice.toFixed(3)}; чувствительность по связанным компонентам {report.singleStudyComponentRecall.toFixed(3)}. Не клинические показатели точности.</p>
 <label>Подтвердить исходную КТ NIfTI по SHA-256 <input type="file" accept=".nii.gz,.nii" disabled={working} onChange={e=>void verify(e)}/></label>
 <p role="status">{bound?"✓ Источник идентичен исходной КТ отчёта":"Координаты скрыты до проверки оригинального файла"}</p>
 {bound&&<><p>Всего компонентов модели: {report.modelConnectedPECandidates}. {report.candidateLocationListTruncated?"Показаны не все кандидаты.":""}</p>
 <ol>{report.candidateLocationsOriginalSourceRasMm.map((x,i)=><li key={i}>
 Кандидат {i+1}: {x.voxels} вокселей; координаты IJK {JSON.stringify(x.originalSourceVoxelBoundsInclusive)};
 {x.matchesOneExpertLesion?" пересекается с одним экспертным компонентом":" экспертное совпадение не установлено"}.
 </li>)}</ol></>}
 </div>}
 </section>;
}
