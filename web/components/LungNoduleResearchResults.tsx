"use client";
import {useState} from "react";
import PathologyFindingsReview from "./PathologyFindingsReview";
import PublicLuna16SourceSlices from "./PublicLuna16SourceSlices";
import type {MonaiResearchReport} from "../lib/pathology-findings";
import {validateMonaiRealCenterEvidence,type MonaiLunaCenterComparison} from "../lib/monai-luna16-center-evidence";

type Report=MonaiResearchReport & {status:string;candidateCount:number};
type PublicReference={schema:string;sourceSeriesIdSha256:string;sourceMhdSha256:string;annotationsSha256:string;referenceNodules:Array<{centerMm:number[];diameterMm:number;nativeVoxelIndex:number[];sliceIndex0Based:number}>;coordinateMappingStatus:string;independentHoldout:false;clinicalValidation:false;sourceGeometry:{dimensions:number[];spacingMm:number[];origin:number[];directionMatrix:number[][]}};
const PUBLIC_MONAI_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01";
function validatePublicReference(value:unknown, report:Report):PublicReference {
 if(!value||typeof value!=="object")throw Error("Неверный формат экспертной разметки.");
 const r=value as Partial<PublicReference>;
 if(r.schema!=="opus-luna16-real-public-reference/v1"||
    r.sourceSeriesIdSha256!==report.publicStudy.sourceSeriesIdSha256||
    r.sourceMhdSha256!==report.publicStudy.sourceMhdSha256||
    report.model.weightsSha256!==PUBLIC_MONAI_SHA||
    r.clinicalValidation!==false||r.independentHoldout!==false||
    r.coordinateMappingStatus!=="model_to_source_not_independently_validated"||
    !Array.isArray(r.referenceNodules)||
    r.referenceNodules.length!==report.publicStudy.luna16GroundTruthNoduleCount||
    r.referenceNodules.length!==1||
    !Array.isArray(r.sourceGeometry?.dimensions)||
    r.sourceGeometry.dimensions.join(",")!==report.publicStudy.dimensions.join(",")||
    !Array.isArray(r.sourceGeometry.spacingMm)||
    r.sourceGeometry.spacingMm.length!==3||
    !r.sourceGeometry.spacingMm.every(n=>finite(n)&&n>0))
    throw Error("Разметка относится к другому исследованию или не прошла проверку.");
 for(const item of r.referenceNodules){
   if(!Array.isArray(item.centerMm)||item.centerMm.length!==3||
      !item.centerMm.every(finite)||!Array.isArray(item.nativeVoxelIndex)||
      item.nativeVoxelIndex.length!==3||!item.nativeVoxelIndex.every(finite)||
      !finite(item.diameterMm)||item.diameterMm<=0||
      !Number.isSafeInteger(item.sliceIndex0Based)||item.sliceIndex0Based<0||
      item.sliceIndex0Based>=report.publicStudy.dimensions[2])
      throw Error("Недостоверные координаты экспертного узла.");
 }
 return r as PublicReference;
}
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
    r.coverage?.sourceWorldCoordinateVerification!=="not_yet_completed"||
    !/^[a-f0-9]{64}$/.test(r.publicStudy?.sourceSeriesIdSha256??"")||
    !/^[a-f0-9]{64}$/.test(r.publicStudy?.sourceMhdSha256??"")||
    !/^[a-f0-9]{64}$/.test(r.publicStudy?.sourceRawSha256??"")||
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
 const [loadingExample,setLoadingExample]=useState(false);
 const [reference,setReference]=useState<PublicReference|null>(null);
 const [referenceLoading,setReferenceLoading]=useState(false);
 const [referenceError,setReferenceError]=useState("");
 const [comparison,setComparison]=useState<MonaiLunaCenterComparison|null>(null);
 async function reviewReference(){
   if(!report)return;
   setReferenceLoading(true);setReferenceError("");setReference(null);setComparison(null);
   try{
     if(!report.publicStudy.sourceSeriesIdSha256||!report.publicStudy.sourceMhdSha256)
       throw Error("Отчёт не содержит хеши оригинальной публичной КТ.");
     const response=await fetch("/api/research/luna16-reference",{cache:"no-store"});
     if(!response.ok)throw Error("Не удалось проверить публикацию LUNA16.");
     const value:unknown=await response.json();
     const checked=validatePublicReference(value,report);
     setReference(checked);
     const evidenceResponse=await fetch(
       "/examples/luna16-monai-expert-center-run-38724788094.json",
       {cache:"no-store"}
     );
     if(!evidenceResponse.ok)throw Error("Недоступно доказательство сравнения с экспертным центром.");
     const evidence:unknown=await evidenceResponse.json();
     setComparison(validateMonaiRealCenterEvidence(evidence,report,checked));
   }catch(err){setReferenceError(err instanceof Error?err.message:"Ошибка сравнения.");}
   finally{setReferenceLoading(false);}
 }
 const visible=report?.candidates.filter(c=>c.rawClassificationScore>=minScore)
   .sort((a,b)=>b.rawClassificationScore-a.rawClassificationScore)??[];
 return <section className="cs-geometry" aria-label="Детекция лёгочных узлов · результаты MONAI">
  <h3>Лёгочные узлы · MONAI</h3>
  <p>Публичный пример настоящего CPU-инференса MONAI на КТ LUNA16. Модель не запускается на этом Mac; координаты ещё не сопоставлены с DICOM.</p>
  {!isChestCT?<p role="status">Выберите серию КТ грудной клетки для исследовательского контекста.</p>:null}
  <button type="button" disabled={loadingExample} onClick={async()=>{
   setLoadingExample(true);setReport(null);setReference(null);setReferenceError("");setComparison(null);setError("");
   try{
     const response=await fetch("/examples/luna16-monai-cpu-run-38436406805.json",{cache:"no-store"});
     if(!response.ok)throw Error("Не удалось загрузить публичный пример.");
     setReport(readReport(await response.text()));
   }catch(err){setError(err instanceof Error?err.message:"Ошибка загрузки примера.");}
   finally{setLoadingExample(false);}
  }}>{loadingExample?"Загрузка публичного результата…":"Показать реальный пример LUNA16 (3 кандидата)"}</button>
  <p><a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38436406805" target="_blank" rel="noopener noreferrer">Доказательство выполнения: GitHub Actions #38436406805</a>. Это результат другой публичной КТ, а не анализ загруженного пациентского исследования.</p>
  <label>Импорт JSON результата <input type="file" accept=".json,application/json" onChange={async e=>{
   const file=e.target.files?.[0];e.currentTarget.value="";setReport(null);setReference(null);setReferenceError("");setComparison(null);setError("");
   if(!file)return;
   try{if(file.size>4*1024*1024)throw Error("Файл превышает 4 МиБ.");
      setReport(readReport(await file.text()));
   }catch(err){setError(err instanceof Error?err.message:"Ошибка импорта.");}
  }}/></label>
  {error&&<p role="alert">{error}</p>}
  {report&&<div>
   <p><strong>MONAI {report.model.version}</strong> · {report.candidateCount} кандидатов · {report.publicStudy.luna16GroundTruthNoduleCount} эталонных узлов в публичном исследовании.</p>
   <p>Веса SHA-256: <code>{report.model.weightsSha256.slice(0,16)}…</code></p>
   <p role="alert">Нативная пациентская DICOM/SOP-серия не привязана. Пространственная проверка относится только к этой публичной MetaImage КТ. Совпадение с опубликованным узлом не подтверждает клиническую чувствительность и не означает диагноз.</p>
   <div style={{border:"1px solid #6d8981",padding:12,borderRadius:8,margin:"12px 0"}}>
    <strong>Экспертная разметка · реальная КТ LUNA16</strong>
    <p>Сравнение с исходным публичным annotations.csv и заголовком .mhd. Проверяются SHA-256 обоих файлов, геометрия и идентичность исследования. Только открытые эталонные метаданные — без отправки ваших DICOM.</p>
    <button type="button" disabled={referenceLoading} onClick={()=>void reviewReference()}>
      {referenceLoading?"Загрузка проверенной разметки…":"Сопоставить с экспертной разметкой"}
    </button>
    {referenceError&&<p role="alert">{referenceError}</p>}
    {reference&&<>
      <p><strong>Экспертный узел:</strong> {reference.referenceNodules[0].diameterMm.toFixed(1)} мм · центр {reference.referenceNodules[0].centerMm.map(x=>x.toFixed(2)).join(" / ")} мм.</p>
      <p>Исходный MetaImage: срез {reference.referenceNodules[0].sliceIndex0Based+1} из {report.publicStudy.dimensions[2]} (рассчитано по заголовку и эталонной координате).</p>
      {comparison&&<div style={{border:"1px solid #888",borderRadius:8,padding:12,margin:"10px 0"}}>
        <strong>Измеренная локализация на настоящей КТ</strong>
        <p>Предобученная MONAI нашла кандидат вблизи опубликованного экспертного узла:
          расстояние между центрами <strong>{comparison.modelCandidatesCompared[0].centerDistanceToExpertMm.toFixed(3)} мм</strong>;
          score модели <strong>{comparison.modelCandidatesCompared[0].rawUncalibratedScore.toFixed(6)}</strong>.
          Экспертный диаметр узла — <strong>{comparison.independentPublishedLuna16ExpertReference.diameterMm.toFixed(3)} мм</strong>.
        </p>
        <p>Критерий совпадения с опубликованным центром при пороге 0,5: {" "}
          <strong>{comparison.researchReferenceCenterHitAtScorePoint5?"выполнен":"не выполнен"}</strong>.
          Исходный MHD, аннотации, модель и сохранённый результат проверены
          по фиксированным версиям и SHA-256.</p>
        <p><small>Это один исходный пример из LUNA16, использованного разработчиками
          сети. Внешний независимый тест, эталонная маска, Dice, клиническая
          чувствительность и FROC отсутствуют. Точность модели на пациентах
          из одного совпадения оценить нельзя.</small></p>
        <a href="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38724788094"
           target="_blank" rel="noopener noreferrer">Реальное сравнение и измерения · GitHub Actions</a>
      </div>}
      <PublicLuna16SourceSlices reference={reference} rawSha256={report.publicStudy.sourceRawSha256} candidates={report.candidates}/>
      <p role="note">{comparison?
        "Для этого публичного примера преобразование координат MONAI world → LPS подтверждено оригинальной конфигурацией и геометрией исходного MetaImage. Независимое визуальное подтверждение контура отсутствует; исследовательское совпадение центров не равно клиническому true positive.":
        "Пространственное сопоставление ещё не прошло проверку подлинных источников. Из одних числовых координат нельзя заключить, что модель обнаружила узел."}</p>
      {report.candidates.map(c=>{
        const d=Math.hypot(...c.centerMonaiWorldMm.map((v,i)=>v-reference.referenceNodules[0].centerMm[i]));
        return <p key={c.candidateIndex}>Кандидат {c.candidateIndex+1} · числовое расстояние до эталонного центра: <strong>{d.toFixed(2)} мм</strong> · score {(c.rawClassificationScore*100).toFixed(1)}%.</p>;
      })}
    </>}
   </div>
   <label>Порог оценки модели: {minScore.toFixed(2)} <input type="range" min="0" max="1" step="0.05" value={minScore} onChange={e=>setMinScore(Number(e.target.value))}/></label>
   <p>Кандидатов выше порога: {visible.length}.</p>
   <div style={{maxHeight:280,overflowY:"auto"}}>
    {visible.map(c=><div key={c.candidateIndex} style={{borderBottom:"1px solid #8b9b97",padding:"8px 0"}}>
      <strong>Кандидат {c.candidateIndex+1}</strong> · score {c.rawClassificationScore.toFixed(3)}
      <div>MONAI world: {c.centerMonaiWorldMm.map(x=>x.toFixed(2)).join(" / ")} мм</div>
      <div>Размер бокса: {c.extentMm.map(x=>x.toFixed(1)).join(" × ")} мм</div>
    </div>)}
   </div>
   <PathologyFindingsReview key={report.publicStudy.sourceSeriesIdSha256+report.model.weightsSha256} report={report}/>
   <button type="button" onClick={()=>{setReport(null);setReference(null);setReferenceError("");setComparison(null);}}>Закрыть результат</button>
  </div>}
 </section>;
}
