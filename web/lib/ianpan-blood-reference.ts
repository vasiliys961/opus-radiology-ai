/** External evaluation of real ianpan source ROI against separately authorized
 * ORIGINAL expert BLOOD labels. Do not treat bounding boxes as masks,
 * or imported JSON as independent annotation authenticity proof.
 */
import type {IchAlternativeReport} from "./ianpan-ich-report.ts";

const BLOOD=["IPH","IVH","SAH","SDH","EDH"] as const;
export type BloodClass=(typeof BLOOD)[number];
export type IchBloodReferenceRow={
  referenceClass:BloodClass;
  label:number;
  referencePositiveVoxels:number;
  expertReferenceVolumeMl:number;
  subtypeCandidateBoxes:number;
  maxRawUncalibratedScore?:number|null;
  expertVoxelsInsideModelBoxUnion?:number;
  expertVoxelShareInsideModelBoxes:number|null;
  expertComponentsWithBoxIntersection:number;
  expertComponentsTotal:number;
  expertReferenceNotCoveredVoxels?:number;
  modelBoundingBoxVoxelCountNotAValidHematomaVolume?:number;
  modelPredictedHematomaVolumeMl:null;
  modelVoxelsSegmentedWithIndependentExpertMask?:false;
  geometricBoxContactIsClinicalTruePositive?:false;
};
export type IchBloodReferenceResult={
  schema:"opus-ianpan-expert-hemorrhage-roi-spatial-comparison/v1";
  status:"authentic_model_roi_vs_operator_attested_original_hemorrhage_mask";
  referenceDescription:"HEMORRHAGE_BLOOD_NOT_EDEMA";
  evidenceHashes:{
    sourceCtSha256:string;
    originalExpertMaskSha256:string;
    originalOntologySha256:string;
    modelResearchReportSha256:string;
  };
  originalNativeShapeXYZ:number[];
  referenceGridMatchesSourceWithin005Mm:true;
  allOriginalCtSlicesAvailable:true;
  sourceResampled:false;
  modelCheckpointSha256VerifiedInSourceReport:true;
  referenceAnnotationAuthenticityIndependentlyAuditedByOpus:false;
  referenceRightsAttestedByOperator:true;
  comparisonMethod:"expert_blood_voxel_fraction_inside_union_of_model_source_bbox_envelopes";
  referenceClasses:IchBloodReferenceRow[];
  falsePositivePerCase:null;
  clinicalTruePositiveCount:null;
  modelPredictedHematomaVolumeMl:null;
  hematomaSegmentationDice:null;
  clinicalSensitivity:null;
  heldOutFromTrainingProven:false;
  sourceDICOMRescaleIndependentlyAudited:false;
  clinicalValidation:false;
  patientDiagnosticUseAllowed:false;
  limitations:string[];
};
const sha=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const obj=(x:unknown):Record<string,unknown>=>{
  if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Неверный формат экспертного паспорта.");
  return x as Record<string,unknown>;
};
const integer=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
const number=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
export function parseIchBloodExpertSpatialReview(
  raw:string,model:IchAlternativeReport,originalModelReportSha256:string
):IchBloodReferenceResult{
  if(raw.length<20||raw.length>2*1024*1024)
    throw Error("Паспорт сравнения не должен превышать 2 МиБ.");
  const root=obj(JSON.parse(raw));
  const hashes=obj(root.evidenceHashes);
  const expectedDims=model.source.sourceDimensionsXYZ;
  const dims=root.originalNativeShapeXYZ;
  if(root.schema!=="opus-ianpan-expert-hemorrhage-roi-spatial-comparison/v1"||
     root.status!=="authentic_model_roi_vs_operator_attested_original_hemorrhage_mask"||
     root.referenceDescription!=="HEMORRHAGE_BLOOD_NOT_EDEMA"||
     !sha(hashes.originalExpertMaskSha256)||!sha(hashes.originalOntologySha256)||
     hashes.sourceCtSha256!==model.source.niftiSha256||
     !sha(originalModelReportSha256)||
     hashes.modelResearchReportSha256!==originalModelReportSha256||
     !Array.isArray(dims)||dims.length!==3||
     dims.some((n,i)=>n!==expectedDims[i])||
     root.referenceGridMatchesSourceWithin005Mm!==true||
     root.allOriginalCtSlicesAvailable!==true||
     root.sourceResampled!==false||
     root.modelCheckpointSha256VerifiedInSourceReport!==true||
     root.referenceAnnotationAuthenticityIndependentlyAuditedByOpus!==false||
     root.referenceRightsAttestedByOperator!==true||
     root.comparisonMethod!=="expert_blood_voxel_fraction_inside_union_of_model_source_bbox_envelopes"||
     root.falsePositivePerCase!==null||root.clinicalTruePositiveCount!==null||
     root.modelPredictedHematomaVolumeMl!==null||root.hematomaSegmentationDice!==null||
     root.clinicalSensitivity!==null||root.heldOutFromTrainingProven!==false||
     root.sourceDICOMRescaleIndependentlyAudited!==false||
     root.clinicalValidation!==false||root.patientDiagnosticUseAllowed!==false||
     !Array.isArray(root.limitations)||root.limitations.length<2||
     root.limitations.some(x=>typeof x!=="string"||x.length>1000))
    throw Error("Сравнение не соответствует настоящему исследованию или содержит клинические утверждения.");
  if(!Array.isArray(root.referenceClasses)||!root.referenceClasses.length||
     root.referenceClasses.length>BLOOD.length)
    throw Error("Экспертные классы крови отсутствуют или некорректны.");
  const seenLabel=new Set<number>();
  const seenClass=new Set<string>();
  let totalPositive=0;
  for(const rawClass of root.referenceClasses){
    const c=obj(rawClass),cl=c.referenceClass;
    if(typeof cl!=="string"||!BLOOD.includes(cl as BloodClass)||
       !integer(c.label)||c.label<1||c.label>65535||
       seenLabel.has(c.label)||seenClass.has(cl)||
       !integer(c.referencePositiveVoxels)||
       !number(c.expertReferenceVolumeMl)||
       !integer(c.subtypeCandidateBoxes)||
       !integer(c.expertComponentsWithBoxIntersection)||
       !integer(c.expertComponentsTotal)||
       c.expertComponentsWithBoxIntersection>c.expertComponentsTotal||
       c.modelPredictedHematomaVolumeMl!==null)
      throw Error("Экспертные метки крови или объёмы недостоверны.");
    const predictedSubtype={
      IPH:"intraparenchymal",IVH:"intraventricular",
      SAH:"subarachnoid",SDH:"subdural",EDH:"epidural"
    }[cl];
    const available=model.candidates.filter(v=>v.class===predictedSubtype&&
      v.sourceVoxelProjection!==null&&v.sourceVoxelProjection!==undefined);
    if(c.subtypeCandidateBoxes!==available.length)
      throw Error("Модельные области не принадлежат загруженному инференсу.");
    if(c.referencePositiveVoxels===0){
      if(c.expertVoxelShareInsideModelBoxes!==null||
        c.expertComponentsTotal!==0||c.expertComponentsWithBoxIntersection!==0||
        c.expertReferenceVolumeMl!==0)
        throw Error("Нельзя вычислять покрытие для пустой экспертной маски.");
    }else{
      const overlap=c.expertVoxelsInsideModelBoxUnion;
      if(!integer(overlap)||overlap>c.referencePositiveVoxels||
         c.expertReferenceNotCoveredVoxels!==c.referencePositiveVoxels-overlap||
         !number(c.expertVoxelShareInsideModelBoxes)||
         c.expertVoxelShareInsideModelBoxes>1||
         Math.abs(c.expertVoxelShareInsideModelBoxes-overlap/c.referencePositiveVoxels)>1e-7||
         !integer(c.modelBoundingBoxVoxelCountNotAValidHematomaVolume)||
         c.modelVoxelsSegmentedWithIndependentExpertMask!==false||
         c.geometricBoxContactIsClinicalTruePositive!==false)
        throw Error("Покрытие экспертных вокселей не соответствует исходным числам.");
      if(!number(c.maxRawUncalibratedScore)&&c.maxRawUncalibratedScore!==null)
        throw Error("Невалидная исследовательская оценка модели.");
      if(available.length&&!number(c.maxRawUncalibratedScore))
        throw Error("Отсутствует максимальная оценка модели.");
      if(available.length&&Math.abs(Math.max(...available.map(v=>v.rawUncalibratedScore))-
          c.maxRawUncalibratedScore)>1e-6)
        throw Error("Оценка модели не соответствует исходной КТ.");
    }
    seenLabel.add(c.label);seenClass.add(cl);
    totalPositive+=c.referencePositiveVoxels;
  }
  if(totalPositive===0)throw Error("Загруженный экспертный эталон не содержит крови.");
  return root as IchBloodReferenceResult;
}
