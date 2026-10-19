"use client";
import {useState} from "react";

type Box = {nativeVoxelBoxXYZ:number[][];volumeVoxels:number;sourceGeometry:string};
type ColonResult = {
 schema:"opus-msd-colon-real-vista3d-expert-v1";
 task:string;modality:"CT";region:string[];
 realOfficialPretrainedInference:true;
 sourceBoundVoxelGrid:true;boundToDicomSop:false;
 independentTrainingHoldout:false;clinicalValidation:false;patientUseAllowed:false;
 case:string;model:string;modelRevisionSha:string;modelWeightsSha256:string;
 sourceSha256:string;expertSha256:string;predictionSha256:string;
 nativeShape:number[];classId:27;
 expertVoxels:number;predictedVoxels:number;TP:number;FP:number;FN:number;
 voxelDice:number|null;voxelRecall:number|null;voxelPrecision:number|null;
 localizedNativeVoxelCandidates:Box[];
 limitations:string[];
};
const sha=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const goodCount=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
const score=(v:unknown)=>v===null||(typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1);
const axes=["X","Y","Z"];

export function parseColonCancerResearchResult(text:string):ColonResult{
 if(text.length>1024*1024)throw Error("Отчёт превышает 1 МиБ.");
 const v:unknown=JSON.parse(text);
 if(!v||typeof v!=="object")throw Error("Некорректный JSON.");
 const r=v as Partial<ColonResult>;
 if(r.schema!=="opus-msd-colon-real-vista3d-expert-v1"||
    r.task!=="CT colon cancer primary lesion segmentation"||
    r.modality!=="CT"||r.model!=="MONAI/vista3d"||r.classId!==27||
    !Array.isArray(r.region)||r.region.join(",")!=="abdomen,pelvis"||
    r.realOfficialPretrainedInference!==true||
    r.sourceBoundVoxelGrid!==true||r.boundToDicomSop!==false||
    r.independentTrainingHoldout!==false||r.clinicalValidation!==false||
    r.patientUseAllowed!==false||
    !sha(r.modelWeightsSha256)||!sha(r.sourceSha256)||
    !sha(r.expertSha256)||!sha(r.predictionSha256)||
    typeof r.modelRevisionSha!=="string"||!/^[a-f0-9]{40}$/.test(r.modelRevisionSha)||
    typeof r.case!=="string"||!/^[a-z0-9_]{1,40}\.nii\.gz$/i.test(r.case)||
    !Array.isArray(r.nativeShape)||r.nativeShape.length!==3||
    !r.nativeShape.every(x=>goodCount(x)&&x>=32&&x<=850)||
    !goodCount(r.expertVoxels)||!goodCount(r.predictedVoxels)||
    !goodCount(r.TP)||!goodCount(r.FP)||!goodCount(r.FN)||
    r.TP+r.FP!==r.predictedVoxels||r.TP+r.FN!==r.expertVoxels||
    !score(r.voxelDice)||!score(r.voxelRecall)||!score(r.voxelPrecision)||
    !Array.isArray(r.localizedNativeVoxelCandidates)||
    r.localizedNativeVoxelCandidates.length>100||
    !Array.isArray(r.limitations)||r.limitations.length<1||r.limitations.length>20)
   throw Error("Не подтверждён формат или происхождение реального исследовательского результата.");
 for(const c of r.localizedNativeVoxelCandidates){
   if(!goodCount(c.volumeVoxels)||c.volumeVoxels<10||
      c.sourceGeometry!=="NIfTI affine; not DICOM SOP resolved"||
      !Array.isArray(c.nativeVoxelBoxXYZ)||c.nativeVoxelBoxXYZ.length!==3||
      !c.nativeVoxelBoxXYZ.every((v,i)=>Array.isArray(v)&&v.length===2&&
        v.every(goodCount)&&v[0]<=v[1]&&v[1]<r.nativeShape![i]))
     throw Error("Координаты очага выходят за границы публичного тома.");
 }
 for(const key of ["voxelDice","voxelRecall","voxelPrecision"] as const){
   const x=r[key];
   if(x!==null&&typeof x==="number"&&x>1)throw Error("Недопустимая метрика.");
 }
 return r as ColonResult;
}

/** File-only research result. Does NOT analyze the currently loaded DICOM/patient. */
export default function ColonCancerResearchResults(){
 const [report,setReport]=useState<ColonResult|null>(null);
 const [error,setError]=useState("");
 const fmt=(x:number|null)=>x===null?"не определено":x.toFixed(4);
 return <section className="cs-geometry" aria-label="Реальная исследовательская детекция опухоли толстой кишки">
  <h2>Толстая кишка · опухоль на КТ</h2>
  <p>MONAI VISTA3D: специализированная предобученная метка <strong>27 — colon cancer primaries</strong>.
   Это не автоматическое определение опухоли в текущей DICOM-серии. Исследовательский GPU-инференс запускается отдельно.</p>
  <p role="alert">Результаты применимы только к собственной публичной КТ MSD Task10 и её экспертной маске.
   Пока нет проверенной связи с DICOM SOP, анализа пациента здесь нет. Использование весов — только некоммерческое исследование.</p>
  <label>Импорт числового JSON, полученного настоящим запуском VISTA3D
   <input type="file" accept=".json,application/json" onChange={async event=>{
    const file=event.target.files?.[0];event.currentTarget.value="";
    setError("");setReport(null);
    if(!file)return;
    try{
     if(file.size>1024*1024)throw Error("Файл больше 1 МиБ.");
     setReport(parseColonCancerResearchResult(await file.text()));
    }catch(err){setError(err instanceof Error?err.message:"Ошибка чтения отчёта.");}
   }}/>
  </label>
  {error&&<p role="alert">{error}</p>}
  {!report?<p>Подтверждённый результат не импортирован. Нет оснований говорить о выявлении либо отсутствии опухоли.</p>:<>
    <h3>Оригинальный публичный случай: {report.case}</h3>
    <p>Веса SHA-256: <code>{report.modelWeightsSha256.slice(0,20)}…</code>.
     Исходная КТ: <code>{report.sourceSha256.slice(0,20)}…</code>.</p>
    <p>Исходная сетка: {report.nativeShape.join(" × ")} вокселей.
     Объём опухоли в экспертной маске: {report.expertVoxels.toLocaleString("ru-RU")} вокселей.
     Предсказано: {report.predictedVoxels.toLocaleString("ru-RU")}.</p>
    <table><thead><tr><th>TP</th><th>FP</th><th>FN</th><th>Dice</th><th>Recall</th><th>Precision</th></tr></thead>
     <tbody><tr><td>{report.TP}</td><td>{report.FP}</td><td>{report.FN}</td>
      <td>{fmt(report.voxelDice)}</td><td>{fmt(report.voxelRecall)}</td><td>{fmt(report.voxelPrecision)}</td>
     </tr></tbody></table>
    <h4>Пространственные кандидаты модели ({report.localizedNativeVoxelCandidates.length})</h4>
    {report.localizedNativeVoxelCandidates.length?
      <ol>{report.localizedNativeVoxelCandidates.map((c,i)=><li key={i}>
       {c.volumeVoxels} вокселей, диапазоны {c.nativeVoxelBoxXYZ.map((b,j)=>axes[j]+": "+b.join("–")).join("; ")}.
       <small> Не подтверждено врачом. Только исходная координатная сетка NIfTI.</small>
      </li>)}</ol>:
      <p role="alert">Модель не возвратила пространственных кандидатов. Это не отрицательное исследование.</p>}
    <p><strong>Ограничения:</strong> отсутствие независимого holdout, валидации на пациентах
     и DICOM-SOP-регистрации. Dice одного исследования не является клинической чувствительностью.</p>
    <button type="button" onClick={()=>setReport(null)}>Закрыть результат</button>
   </>}
  <p><a href="https://github.com/vasiliys961/opus-radiology-ai/blob/main/docs/MSD_COLON_CANCER_REAL_PRETRAINED.md"
     target="_blank" rel="noreferrer">Исследовательский протокол и лицензия модели</a></p>
 </section>;
}
