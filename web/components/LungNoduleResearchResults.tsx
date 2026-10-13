"use client";
import {useState} from "react";

type Candidate={candidateIndex:number;centerMonaiWorldMm:number[];extentMm:number[];rawClassificationScore:number;coordinateFrameVerifiedAgainstSource:false};
type Report={schema:string;status:string;candidateCount:number;model:{id:string;version:string;weightsSha256:string;modelCheckpointActualSha256Verified:boolean};coverage:{sourceFullCtProcessed:boolean;sourceWorldCoordinateVerification:string};candidates:Candidate[];publicStudy:{dimensions:number[];luna16GroundTruthNoduleCount:number};readyForClinicalUse:false};
const finite=(n:unknown)=>typeof n==="number"&&Number.isFinite(n);
function readReport(raw:string):Report{
  if(raw.length>4*1024*1024)throw Error("Слишком большой файл отчёта.");
  const v:unknown=JSON.parse(raw);
  if(!v||typeof v!=="object")throw Error("Некорректный JSON.");
  const r=v as Partial<Report>;
  if(r.schema!=="opus-monai-luna16-real-single-ct-inference/v1"||
    r.status!=="genuine_trained_checkpoint_executed_on_public_ct"||
    r.readyForClinicalUse!==false||
    r.model?.modelCheckpointActualSha256Verified!==true||
    !/^[a-f0-9]{64}$/.test(r.model.weightsSha256)||
    r.coverage?.sourceFullCtProcessed!==true||
    !Array.isArray(r.candidates)||r.candidates.length>300||
    r.candidateCount!==r.candidates.length||
    !Array.isArray(r.publicStudy?.dimensions)||r.publicStudy.dimensions.length!==3||
    !r.publicStudy.dimensions.every(n=>Number.isSafeInteger(n)&&n>0)||
    !Number.isSafeInteger(r.publicStudy.luna16GroundTruthNoduleCount)||
    r.publicStudy.luna16GroundTruthNoduleCount<0)
    throw Error("Это не подтверждённый формат исследовательского MONAI-отчёта.");
  for(const c of r.candidates){
    if(!Number.isSafeInteger(c.candidateIndex)||
       !Array.isArray(c.centerMonaiWorldMm)||c.centerMonaiWorldMm.length!==3||
       !c.centerMonaiWorldMm.every(finite)||
       !Array.isArray(c.extentMm)||c.extentMm.length!==3||
       !c.extentMm.every(n=>finite(n)&&n>0)||
       !finite(c.rawClassificationScore)||c.rawClassificationScore<0||c.rawClassificationScore>1||
       c.coordinateFrameVerifiedAgainstSource!==false)
       throw Error("Некорректные или неразрешённые координаты кандидата.");
  }
  return r as Report;
}
export default function LungNoduleResearchResults({isChestCT}:{isChestCT:boolean}){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState("");
 const [minScore,setMinScore]=useState(0.5);
 const visible=report?.candidates.filter(c=>c.rawClassificationScore>=minScore)
   .sort((a,b)=>b.rawClassificationScore-a.rawClassificationScore)??[];
 return <section className="cs-geometry" aria-label="Детекция лёгочных узлов · результаты MONAI">
  <h3>Лёгочные узлы · MONAI</h3>
  <p>Импорт результатов настоящего публичного GPU-запуска модели. Не запускает детектор на этом Mac.</p>
  {!isChestCT?<p role="status">Выберите серию КТ грудной клетки для исследовательского контекста.</p>:null}
  <label>Импорт JSON результата <input type="file" accept=".json,application/json" onChange={async e=>{
   const file=e.target.files?.[0];e.currentTarget.value="";setReport(null);setError("");
   if(!file)return;
   try{if(file.size>4*1024*1024)throw Error("Файл превышает 4 МиБ.");
      setReport(readReport(await file.text()));
   }catch(err){setError(err instanceof Error?err.message:"Ошибка импорта.");}
  }}/></label>
  {error&&<p role="alert">{error}</p>}
  {report&&<div>
   <p><strong>MONAI {report.model.version}</strong> · {report.candidateCount} кандидатов · {report.publicStudy.luna16GroundTruthNoduleCount} эталонных узлов в публичном исследовании.</p>
   <p>Веса SHA-256: <code>{report.model.weightsSha256.slice(0,16)}…</code></p>
   <p role="alert">Координаты MONAI ещё не сопоставлены с исходными DICOM/SOP. Отображение маркеров на срезах, диагноз и оценка точности недоступны. Число кандидатов не равно числу истинных узлов.</p>
   <label>Порог оценки модели: {minScore.toFixed(2)} <input type="range" min="0" max="1" step="0.05" value={minScore} onChange={e=>setMinScore(Number(e.target.value))}/></label>
   <p>Кандидатов выше порога: {visible.length}.</p>
   <div style={{maxHeight:280,overflowY:"auto"}}>
    {visible.map(c=><div key={c.candidateIndex} style={{borderBottom:"1px solid #8b9b97",padding:"8px 0"}}>
      <strong>Кандидат {c.candidateIndex+1}</strong> · score {c.rawClassificationScore.toFixed(3)}
      <div>MONAI world: {c.centerMonaiWorldMm.map(x=>x.toFixed(2)).join(" / ")} мм</div>
      <div>Размер бокса: {c.extentMm.map(x=>x.toFixed(1)).join(" × ")} мм</div>
    </div>)}
   </div>
   <button type="button" onClick={()=>setReport(null)}>Закрыть результат</button>
  </div>}
 </section>;
}
