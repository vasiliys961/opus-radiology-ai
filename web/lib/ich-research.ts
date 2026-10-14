/** Offline import of a genuine externally run SAMIHS research report.
 * This verifies the contract, NOT trained inference, diagnostic accuracy,
 * user identity, source-to-DICOM binding or validity of untrusted JSON claims.
 */
export type IchComponent={
  componentIndex:number;
  voxelCount:number;
  volumeMl:number;
  peakSliceIndexK?:number;
  peakSliceComponentVoxels?:number;
  boundsVoxelMin:[number,number,number];
  boundsVoxelMax:[number,number,number];
  modelProbabilityCalibrated:false;
  clinicianVerified:false;
};
export type IchResearchReport={
  schema:"opus-ich-samihs-public-research/v1";
  researchStatus:"trained_upstream_adapter_executed_public_only";
  model:{id:"samihs-ich-binary-ct";origin:"MooreMuaMu/samihs-ich-segmentation";
    version:string;checkpointSha256:string;wrapperSha256:string;modelWeightsUsed:true};
  source:{format:"3d-nifti";sha256:string;fullVolumeProcessed:true;
    sourceDicomSopBound:false;patientData:false;
    geometry:{dimensions:[number,number,number];voxelVolumeMl:number;
      sliceAxis:number;affineRas:number[][]}};
  prediction:{predictedPositiveVoxelCount:number;predictedMaskVolumeMl:number;
    connectedComponentsTotal:number;largestComponents:IchComponent[];
    componentListTruncated:boolean;maskSha256:string;
    maskFormat:"3d-binary-nifti-uint8";thresholdUncalibrated:number;
    ichSubtype:null;negativeDiagnosisPermitted:false;detectionStatus:string};
  validation:{independentDice:null;sensitivity:null;specificity:null;
    externalCohortEvaluated:false;clinicalValidation:false;physicianReviewRequired:true};
};
const object=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Некорректный объект результата.");
 return v as Record<string,unknown>;
};
const sha=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const integer=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v);
function vec(v:unknown):[number,number,number]{
 if(!Array.isArray(v)||v.length!==3||!v.every(integer))throw Error("Недостоверные границы очага.");
 return [v[0],v[1],v[2]];
}
export function parseIchResearchReport(raw:string):IchResearchReport{
 if(raw.length>2*1024*1024)throw Error("Отчёт превышает лимит 2 МиБ.");
 const root=object(JSON.parse(raw));
 const model=object(root.model),source=object(root.source),
   geometry=object(source.geometry),prediction=object(root.prediction),
   validation=object(root.validation);
 if(root.schema!=="opus-ich-samihs-public-research/v1"||
    root.researchStatus!=="trained_upstream_adapter_executed_public_only"||
    model.id!=="samihs-ich-binary-ct"||
    model.origin!=="MooreMuaMu/samihs-ich-segmentation"||
    model.modelWeightsUsed!==true||!sha(model.checkpointSha256)||
    !sha(model.wrapperSha256)||typeof model.version!=="string"||
    model.version.length>100||
    source.format!=="3d-nifti"||source.fullVolumeProcessed!==true||
    source.sourceDicomSopBound!==false||source.patientData!==false||
    !sha(source.sha256)||prediction.maskFormat!=="3d-binary-nifti-uint8"||
    !sha(prediction.maskSha256)||prediction.ichSubtype!==null||
    prediction.negativeDiagnosisPermitted!==false||
    validation.independentDice!==null||validation.sensitivity!==null||
    validation.specificity!==null||validation.externalCohortEvaluated!==false||
    validation.clinicalValidation!==false||validation.physicianReviewRequired!==true)
    throw Error("Отчёт ICH не соответствует исследовательскому контракту.");
 const dimensions=vec(geometry.dimensions);
 if(dimensions.some(x=>x<16||x>512)||!integer(geometry.sliceAxis)||
   geometry.sliceAxis<0||geometry.sliceAxis>2||!finite(geometry.voxelVolumeMl)||
   geometry.voxelVolumeMl<=0||geometry.voxelVolumeMl>1||
   !Array.isArray(geometry.affineRas)||geometry.affineRas.length!==4||
   geometry.affineRas.some(row=>!Array.isArray(row)||row.length!==4||
     !row.every(finite)))
   throw Error("Неподдерживаемая геометрия исходного NIfTI.");
 const total=dimensions.reduce((x,y)=>x*y,1);
 const positives=prediction.predictedPositiveVoxelCount;
 if(!integer(positives)||positives<0||positives>total||
   !finite(prediction.predictedMaskVolumeMl)||prediction.predictedMaskVolumeMl<0||
   Math.abs(prediction.predictedMaskVolumeMl-positives*geometry.voxelVolumeMl)>0.000051||
   !integer(prediction.connectedComponentsTotal)||
   prediction.connectedComponentsTotal<0||
   !Array.isArray(prediction.largestComponents)||
   prediction.largestComponents.length>128||
   prediction.largestComponents.length>prediction.connectedComponentsTotal||
   prediction.componentListTruncated!==(prediction.connectedComponentsTotal>128)||
   !finite(prediction.thresholdUncalibrated)||
   prediction.thresholdUncalibrated<0.05||prediction.thresholdUncalibrated>0.95||
   !["candidates_from_binary_mask","no_mask_candidate_not_a_negative_diagnosis"]
    .includes(String(prediction.detectionStatus))||
   (positives===0)!==(prediction.detectionStatus==="no_mask_candidate_not_a_negative_diagnosis"))
   throw Error("Противоречие в маске и измерениях.");
 const ids=new Set<number>();
 let countSum=0;
 for(const rawComponent of prediction.largestComponents){
   const c=object(rawComponent);
   const lo=vec(c.boundsVoxelMin),hi=vec(c.boundsVoxelMax);
   if(!integer(c.componentIndex)||c.componentIndex<0||ids.has(c.componentIndex)||
      !integer(c.voxelCount)||c.voxelCount<=0||
      !finite(c.volumeMl)||c.volumeMl<0||
      Math.abs(c.volumeMl-c.voxelCount*geometry.voxelVolumeMl)>0.000051||
      lo.some((x,i)=>x<0||x>hi[i]||hi[i]>=dimensions[i])||
      c.modelProbabilityCalibrated!==false||c.clinicianVerified!==false)
     throw Error("Некорректная пространственная находка SAMIHS.");
   const hasPeak=c.peakSliceIndexK!==undefined||c.peakSliceComponentVoxels!==undefined;
   if(hasPeak&&(!integer(c.peakSliceIndexK)||
      c.peakSliceIndexK<lo[2]||c.peakSliceIndexK>hi[2]||
      !integer(c.peakSliceComponentVoxels)||
      c.peakSliceComponentVoxels<1||c.peakSliceComponentVoxels>c.voxelCount||
      c.peakSliceComponentVoxels>(hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)))
     throw Error("Некорректный срез локализации SAMIHS.");
   ids.add(c.componentIndex);countSum+=c.voxelCount;
 }
 if(countSum>positives||(positives>0&&prediction.connectedComponentsTotal===0)||
    (positives===0&&prediction.connectedComponentsTotal!==0))
    throw Error("Несовместимые объёмы предполагаемых очагов.");
 return root as IchResearchReport;
}
export type IchReviewDecision="unreviewed"|"needs_source_review"|"rejected_by_reviewer";
export type IchLocalReview={
 schema:"opus-ich-local-research-review/v1";
 status:"unsigned_unverified";
 sourceSha256:string;maskSha256:string;
 matchedSourceFileSha256:boolean;matchedMaskFileSha256:boolean;
 sourceToDicomSopBound:false;
 decisions:{componentIndex:number;decision:IchReviewDecision;note:string}[];
 clinicianDiagnosisConfirmed:false;
 cloudTransmission:false;
};
export function buildIchLocalReview(
 report:IchResearchReport,
 verifiedSource:boolean,verifiedMask:boolean,
 decisions:Readonly<Record<number,{decision:IchReviewDecision;note:string}>>
):IchLocalReview{
 const rows=report.prediction.largestComponents.map(c=>{
   const review=decisions[c.componentIndex]??{decision:"unreviewed",note:""};
   if(!["unreviewed","needs_source_review","rejected_by_reviewer"].includes(review.decision)||
      typeof review.note!=="string"||review.note.length>1000||review.note.includes("\u0000"))
      throw Error("Некорректное врачебное решение.");
   return {componentIndex:c.componentIndex,decision:review.decision,note:review.note.trim()};
 });
 return {schema:"opus-ich-local-research-review/v1",status:"unsigned_unverified",
   sourceSha256:report.source.sha256,maskSha256:report.prediction.maskSha256,
   matchedSourceFileSha256:verifiedSource,matchedMaskFileSha256:verifiedMask,
   sourceToDicomSopBound:false,decisions:rows,
   clinicianDiagnosisConfirmed:false,cloudTransmission:false};
}
