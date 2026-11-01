"use client";
/** Physician review of TRUE original CLN components on the already opened DICOM.
 * No pixel or patient information is sent to Gemini/Opus from this component.
 */
import {useEffect,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {fullCtGeometry} from "../lib/full-ct-stream";
import {readNoduleNiftiHeader,verifyNoduleSource} from "../lib/live-nodule-report";
import {transformPoint} from "../lib/segmentation-mask";
import type {ClnReport} from "../lib/cln-native-worker";
import {bindOriginalClnCandidates,type ClnSliceCandidate,type ClnVerifiedLocalEvidence} from "../lib/cln-physician-local-review";
import {restoreMissingClnSource} from "../lib/cln-original-source-recovery";
import {prepareDicomMonaiFile} from "../lib/dicom-monai-direct";

type Decision="suspicious_on_review"|"dismissed_on_review"|"unreviewed";
export default function ClnOriginalPhysicianReview({report,series,source,sourceFiles,onNavigate,onVerifiedCandidates}:{
 report:ClnReport;series:DicomSeries;source:File;sourceFiles:readonly File[];onNavigate:(slice:number)=>void;
 onVerifiedCandidates?:(evidence:ClnVerifiedLocalEvidence)=>void;
}){
 const [items,setItems]=useState<ClnSliceCandidate[]|null>(null);
 const [error,setError]=useState("");
 const [decisions,setDecisions]=useState<Record<number,Decision>>({});
 useEffect(()=>{
  const controller=new AbortController();
  setItems(null);setError("");setDecisions({});
  void (async()=>{
   try{
    // The original nnU-Net result is already final. Only reconstruct the
    // temporary HU-NIfTI if Chromium has evicted its OPFS-backed File, and
    // always verify the exact model-source SHA before binding coordinates.
    const verified=await restoreMissingClnSource(source,async candidate=>{
      await readNoduleNiftiHeader(candidate);
      await verifyNoduleSource(candidate,report.sourceNiftiSha256,controller.signal);
    },async()=>{
      if(sourceFiles.length!==series.members.length)
        throw Error("Исходная DICOM-серия недоступна для восстановления HU.");
      return prepareDicomMonaiFile(series,[...sourceFiles],controller.signal);
    });
    if(controller.signal.aborted)return;
    const geometry=fullCtGeometry(series);
    const native=await readNoduleNiftiHeader(verified.source);
    if(native.dimensions.some((n,i)=>n!==geometry.dimensions[i]))
     throw Error("CLN native dimensions differ from original DICOM");
    // Check the physical position of all eight volume corners, not only spacing.
    for(let mask=0;mask<8;mask++){
     const p=geometry.dimensions.map((n,i)=>mask&(1<<i)?n-1:0) as [number,number,number];
     const actual=transformPoint(native.affineLps,p),expected=transformPoint(geometry.affineLps,p);
     if(Math.hypot(...actual.map((n,i)=>n-expected[i]))>0.05)
      throw Error("CLN NIfTI/DICOM geometry mismatch");
    }
    // SHA-256 of the restored or original source was validated above.
    if(controller.signal.aborted)return;
    const candidates=bindOriginalClnCandidates(report,native.dimensions,
     series.members.map(m=>m.metadata.sopInstanceUid??""));
    setItems(candidates);
    onVerifiedCandidates?.({sourceNiftiSha256:report.sourceNiftiSha256,
      dimensions:[...native.dimensions] as [number,number,number],candidates});
   }catch(e){
    if(!controller.signal.aborted)setError(e instanceof Error?e.message:"CLN candidate binding failed");
   }
  })();
  return ()=>controller.abort();
 },[report,series,source,sourceFiles]);
 function exportReview(){
  if(!items)return;
  const payload={
   schema:"opus-original-cln-physician-source-review/v1",
   sourceNiftiSha256:report.sourceNiftiSha256,
   originalCheckpointSha256:report.checkpointSha256,
   realOriginalModelForwardCompleted:true,
   originalDicomSopRegistrationVerified:false,
   researchOnly:true,clinicalValidation:false,negativeDiagnosisPermitted:false,
   physicianDecisions:items.map(c=>({
    modelComponentId:c.componentId,candidateVolumeMl:c.candidateVolumeMl,
    sourceVoxelCentroidIJK:c.sourceVoxelCentroidIJK,
    sourceSopInstanceUid:c.sopInstanceUid,sourceSliceIndex:c.sliceIndex,
    decision:decisions[c.componentId]??"unreviewed",
   })),
   physicianSigned:false,cloudUpload:false,
  };
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],
    {type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="cln-local-physician-review.json";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="cs-geometry" aria-label="CLN original lung-tumor physician review">
  <h3>CLN · опухолевые кандидаты, исходные DICOM-срезы</h3>
  <p>Оригинальный nnU-Net: {report.candidateCount} компонентов.
   Переход к срезу активируется только после проверки SHA-256 исходного HU-NIfTI
   и соответствия физической геометрии текущей DICOM-серии.</p>
  {!items&&!error&&<p role="status">Сверяем исходное исследование...</p>}
  {error&&<p role="alert">Переход к срезам заблокирован: {error}</p>}
  {items?.slice(0,60).map(c=><div key={c.componentId}>
   <button type="button" onClick={()=>onNavigate(c.sliceIndex)}>
    Кандидат {c.componentId} · {c.candidateVolumeMl.toFixed(3)} мл · срез {c.sliceIndex+1}
   </button>
   <span> {decisions[c.componentId]??"не оценён"} </span>
   <button type="button" onClick={()=>setDecisions(p=>({...p,[c.componentId]:"suspicious_on_review"}))}>Подозрительный</button>
   <button type="button" onClick={()=>setDecisions(p=>({...p,[c.componentId]:"dismissed_on_review"}))}>Отклонить</button>
   <button type="button" onClick={()=>setDecisions(p=>({...p,[c.componentId]:"unreviewed"}))}>Не оценено</button>
  </div>)}
  {items&&items.length>60&&<p>Показаны первые 60 кандидатов из {items.length}.</p>}
  {items?.length===0&&<p>Кандидаты отсутствуют; это не исключает опухоль.</p>}
  {items&&<button type="button" onClick={exportReview}>Сохранить локальный JSON решений врача</button>}
  <p>Координаты соответствуют геометрии исходного NIfTI; отдельная независимая
   проверка регистрации DICOM SOP не выполнена. Врач проверяет каждый кандидат
   на изображении. JSON с SOP UID и хешем остаётся локальным.</p>
 </section>;
}
