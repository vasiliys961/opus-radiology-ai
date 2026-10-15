/** Binds measured real MONAI output to the *separate* pinned LUNA16 centroid.
 * Research-center match ≠ externally validated sensitivity/clinical diagnosis.
 */
import type {MonaiResearchReport} from "./pathology-findings";

export type MonaiLunaCenterComparison={
 schema:"opus-monai-luna16-independent-expert-center-comparison/v1";
 status:"genuine_pretrained_predictions_vs_published_expert_center";
 study:{sourceSeriesIdSha256:string;sourceMhdSha256:string;sourceRawSha256:string;annotationsSha256:string};
 model:{id:"monai-lung-nodule-ct-retinanet";revision:string;checkpointSha256:string;previousGenuineCpuRun:38436406805};
 geometry:{sourceOriginalDimensions:number[];lpsWorldTransformConfirmedByPinnedVendorBundle:true;
   transformContract:"official_monai_itkreader_lps_to_ras_then_affine_box_to_world_lps";
   noduleReferenceSourceVoxel:number[];clinicalLesionContoursAvailable:false};
 independentPublishedLuna16ExpertReference:{
   centerLpsMm:number[];diameterMm:number;
   standard:"published_centroid_and_diameter_not_expert_voxel_mask";
 };
 researchScoreThreshold:0.5;
 modelCandidatesCompared:Array<{
  candidateIndex:number;rawUncalibratedScore:number;sourceNativeVoxelIndex:number[];
  centerDistanceToExpertMm:number;withinExpertReferenceRadius:boolean;
  acceptedAtResearchScorePoint5:boolean;referenceCenterMatchAtScorePoint5:boolean;
 }>;
 candidateCount:number;researchReferenceCenterHitAtScorePoint5:boolean;
 researchCenterHitCandidateIndices:number[];referenceLesions:1;
 datasetHoldoutFromModelTrainingVerified:false;independentClinicalValidation:false;
 externalValidationSensitivity:null;fullFroc:null;dice:null;
 falsePositiveClinicalRate:null;patientUseAllowed:false;
 negativeDiagnosticConclusionAllowed:false;
 evidenceWorkflowRunId:38724788094;evidenceWorkflowRunUrl:string;
};
type Reference={
 sourceSeriesIdSha256:string;sourceMhdSha256:string;annotationsSha256:string;
 sourceGeometry:{
  origin:number[];spacingMm:number[];directionMatrix:number[][];dimensions:number[];
 };
 referenceNodules:Array<{centerMm:number[];diameterMm:number;nativeVoxelIndex:number[]}>;
};
const MODEL_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01";
const REPORT_URL="https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38724788094";
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
function close(a:number,b:number,tol:number){return finite(a)&&finite(b)&&Math.abs(a-b)<=tol;}
function eq3(a:unknown,b:unknown,tol:number):boolean{
 return Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&
   a.every((v,i)=>close(v,b[i],tol));
}
function sourceIndex(center:number[],ref:Reference):number[]{
 const {origin,spacingMm,directionMatrix}=ref.sourceGeometry;
 if(!eq3(origin,origin,0)||!eq3(spacingMm,spacingMm,0)||
    !Array.isArray(directionMatrix)||directionMatrix.length!==3||
    directionMatrix.some(row=>!eq3(row,row,0))||
    spacingMm.some(s=>s<=0))throw Error("Повреждена геометрия публичной КТ.");
 return [0,1,2].map(axis=>
   directionMatrix.reduce((s,row,i)=>s+row[axis]*(center[i]-origin[i]),0)/spacingMm[axis]);
}
export function validateMonaiRealCenterEvidence(
 raw:unknown,report:MonaiResearchReport,reference:Reference
):MonaiLunaCenterComparison{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
   throw Error("Некорректный формат реального сравнения.");
 const e=raw as MonaiLunaCenterComparison;
 if(e.schema!=="opus-monai-luna16-independent-expert-center-comparison/v1"||
    e.status!=="genuine_pretrained_predictions_vs_published_expert_center"||
    e.study?.sourceSeriesIdSha256!==report.publicStudy.sourceSeriesIdSha256||
    e.study?.sourceMhdSha256!==report.publicStudy.sourceMhdSha256||
    e.study?.sourceRawSha256!==report.publicStudy.sourceRawSha256||
    e.study?.annotationsSha256!==reference.annotationsSha256||
    e.model?.checkpointSha256!==MODEL_SHA||
    e.model.checkpointSha256!==report.model.weightsSha256||
    e.model.id!=="monai-lung-nodule-ct-retinanet"||
    e.model.revision!=="7226a40a4c3713f7d5469559b7f2fc296fd54825"||
    e.model.previousGenuineCpuRun!==38436406805||
    e.geometry?.lpsWorldTransformConfirmedByPinnedVendorBundle!==true||
    e.geometry?.transformContract!=="official_monai_itkreader_lps_to_ras_then_affine_box_to_world_lps"||
    e.geometry?.clinicalLesionContoursAvailable!==false||
    !eq3(e.geometry.sourceOriginalDimensions,report.publicStudy.dimensions,0)||
    e.researchScoreThreshold!==0.5||
    e.independentPublishedLuna16ExpertReference?.standard!=="published_centroid_and_diameter_not_expert_voxel_mask"||
    e.referenceLesions!==1||
    e.datasetHoldoutFromModelTrainingVerified!==false||
    e.independentClinicalValidation!==false||
    e.externalValidationSensitivity!==null||
    e.fullFroc!==null||e.dice!==null||
    e.falsePositiveClinicalRate!==null||
    e.patientUseAllowed!==false||e.negativeDiagnosticConclusionAllowed!==false||
    e.evidenceWorkflowRunId!==38724788094||e.evidenceWorkflowRunUrl!==REPORT_URL)
   throw Error("Сравнение не связано с исходным реальным исследованием.");
 const gt=e.independentPublishedLuna16ExpertReference;
 const r=reference.referenceNodules[0];
 if(!r||!eq3(gt.centerLpsMm,r.centerMm,0.0001)||
    !close(gt.diameterMm,r.diameterMm,0.0001)||
    !finite(gt.diameterMm)||gt.diameterMm<=0||
    !eq3(e.geometry.noduleReferenceSourceVoxel,r.nativeVoxelIndex,0.002))
   throw Error("Сравнение не соответствует независимо опубликованному узлу.");
 if(!Array.isArray(e.modelCandidatesCompared)||
    e.candidateCount!==report.candidates.length||
    e.modelCandidatesCompared.length!==report.candidates.length||
    !Array.isArray(e.researchCenterHitCandidateIndices))
   throw Error("Пропущены кандидаты модели.");
 const seen=new Set<number>(),found:number[]=[];
 for(const item of e.modelCandidatesCompared){
   const c=report.candidates.find(c=>c.candidateIndex===item.candidateIndex);
   if(!c||seen.has(item.candidateIndex)||!finite(item.rawUncalibratedScore)||
      !close(item.rawUncalibratedScore,c.rawClassificationScore,1e-7)||
      !eq3(item.sourceNativeVoxelIndex,sourceIndex(c.centerMonaiWorldMm,reference),0.002))
     throw Error("Подменены координаты или оценки кандидата.");
   seen.add(item.candidateIndex);
   const distance=Math.hypot(...c.centerMonaiWorldMm.map((x,i)=>x-r.centerMm[i]));
   const within=distance<=r.diameterMm/2;
   const accepted=c.rawClassificationScore>=0.5;
   if(!finite(item.centerDistanceToExpertMm)||
      !close(item.centerDistanceToExpertMm,distance,0.001)||
      item.withinExpertReferenceRadius!==within||
      item.acceptedAtResearchScorePoint5!==accepted||
      item.referenceCenterMatchAtScorePoint5!==(within&&accepted))
     throw Error("Неверный измеренный результат сопоставления.");
   if(within&&accepted)found.push(item.candidateIndex);
 }
 found.sort((a,b)=>a-b);
 if(e.researchReferenceCenterHitAtScorePoint5!==(found.length>0)||
    found.length!==e.researchCenterHitCandidateIndices.length||
    found.some((v,i)=>v!==e.researchCenterHitCandidateIndices[i]))
   throw Error("Недостоверное подтверждение совпадения с центром.");
 return e;
}
