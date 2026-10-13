/** Strict, source-bound, single-case ICH expert-mask quantitative comparison import.
 * Imported metrics are externally calculated, not recomputed in browser.
 * Never interpret them as clinical sensitivity, held-out validation or diagnosis.
 */
import type {IchResearchReport} from "./ich-research.ts";

export type IchReferenceComparison={
 schema:"opus-ich-public-expert-mask-comparison/v1";
 status:"single_public_case_mask_comparison_not_independent_validation";
 modelId:"samihs-ich-binary-ct";
 evidenceHashes:{sourceSha256:string;predictionSha256:string;expertMaskSha256:string};
 referenceLabel:number;referenceRightsAttested:true;
 sourceNativeIndexGridMatch:true;
 sourceDicomSopBound:false;
 heldOutFromTrainingProven:false;
 expertAnnotationAuthenticityIndependentlyVerified:false;
 caseCount:1;
 metrics:{
   truePositiveVoxels:number;falsePositiveVoxels:number;falseNegativeVoxels:number;
   dice:number|null;iou:number|null;voxelPrecision:number|null;voxelRecall:number|null;
   hd95Mm:number|null;hd95UnavailableReason:string|null;
   predictedVolumeMl:number;expertMaskVolumeMl:number;
   volumeErrorMl:number;absoluteVolumeErrorMl:number;relativeVolumeError:number|null;
   bothMasksEmpty:boolean;clinicalSensitivity:null;frocFalsePositivesPerScan:null;
 };
 clinicalValidation:false;
 limitations:string[];
};
const sha=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const obj=(v:unknown):Record<string,unknown>=>{
 if(v===null||typeof v!=="object"||Array.isArray(v))throw Error("Повреждён паспорт сравнения.");
 return v as Record<string,unknown>;
};
const near=(a:number,b:number,tolerance=1e-7)=>Math.abs(a-b)<=tolerance;
const integral=(x:unknown):x is number=>
 typeof x==="number"&&Number.isSafeInteger(x)&&x>=0;
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
function fraction(v:unknown,expected:number|null,name:string){
 if(expected===null){
   if(v!==null)throw Error("Нельзя рассчитывать показатель "+name+" без знаменателя.");
 }else if(!finite(v)||v<0||v>1||!near(v,expected)){
   throw Error("Несогласованный показатель "+name+".");
 }
}
export function parseIchReferenceComparison(
 raw:string,sourceReport:IchResearchReport
):IchReferenceComparison{
 if(raw.length>2*1024*1024)throw Error("Сравнение превышает лимит 2 МиБ.");
 const root=obj(JSON.parse(raw)),hashes=obj(root.evidenceHashes),m=obj(root.metrics);
 if(root.schema!=="opus-ich-public-expert-mask-comparison/v1"||
    root.status!=="single_public_case_mask_comparison_not_independent_validation"||
    root.modelId!=="samihs-ich-binary-ct"||
    root.caseCount!==1||
    root.referenceRightsAttested!==true||
    root.sourceNativeIndexGridMatch!==true||
    root.sourceDicomSopBound!==false||
    root.heldOutFromTrainingProven!==false||
    root.expertAnnotationAuthenticityIndependentlyVerified!==false||
    root.clinicalValidation!==false||
    !sha(hashes.expertMaskSha256)||
    hashes.sourceSha256!==sourceReport.source.sha256||
    hashes.predictionSha256!==sourceReport.prediction.maskSha256||
    !integral(root.referenceLabel)||root.referenceLabel<1||root.referenceLabel>65535||
    !Array.isArray(root.limitations)||root.limitations.length<1||
    root.limitations.some(x=>typeof x!=="string"||x.length>1000)||
    m.clinicalSensitivity!==null||m.frocFalsePositivesPerScan!==null)
    throw Error("Сравнение не связано с текущей КТ/SAMIHS или выдаёт клинические утверждения.");
 const tp=m.truePositiveVoxels,fp=m.falsePositiveVoxels,fn=m.falseNegativeVoxels;
 if(!integral(tp)||!integral(fp)||!integral(fn)||
    tp+fp!==sourceReport.prediction.predictedPositiveVoxelCount)
   throw Error("Контингентная таблица масок не соответствует текущему результату.");
 const pred=tp+fp,expert=tp+fn,sum=pred+expert,union=tp+fp+fn;
 fraction(m.dice,sum?2*tp/sum:null,"Dice");
 fraction(m.iou,union?tp/union:null,"IoU");
 fraction(m.voxelPrecision,pred?tp/pred:null,"voxel precision");
 fraction(m.voxelRecall,expert?tp/expert:null,"voxel recall");
 if(m.bothMasksEmpty!==(pred===0&&expert===0))
   throw Error("Неверная классификация пустых масок.");
 const voxelMl=sourceReport.source.geometry.voxelVolumeMl;
 const predictedMl=pred*voxelMl,expertMl=expert*voxelMl;
 if(!finite(m.predictedVolumeMl)||!finite(m.expertMaskVolumeMl)||
    !finite(m.volumeErrorMl)||!finite(m.absoluteVolumeErrorMl)||
    !near(m.predictedVolumeMl,predictedMl,0.000051)||
    !near(m.expertMaskVolumeMl,expertMl,0.000051)||
    !near(m.volumeErrorMl,predictedMl-expertMl,0.000051)||
    !near(m.absoluteVolumeErrorMl,Math.abs(predictedMl-expertMl),0.000051))
   throw Error("Объёмные измерения не согласуются с вокселями и мм.");
 if(expert===0){
   if(m.relativeVolumeError!==null)throw Error("Нельзя вычислять относительную ошибку при пустом эталоне.");
 }else if(!finite(m.relativeVolumeError)||
     !near(m.relativeVolumeError,(predictedMl-expertMl)/expertMl))
   throw Error("Неверная относительная ошибка объёма.");
 if(m.hd95Mm===null){
   if(typeof m.hd95UnavailableReason!=="string"||!m.hd95UnavailableReason||
      m.hd95UnavailableReason.length>120)
      throw Error("Нужно объяснить отсутствие HD95.");
 }else if(!finite(m.hd95Mm)||m.hd95Mm<0||m.hd95UnavailableReason!==null)
    throw Error("Некорректное HD95.");
 return root as IchReferenceComparison;
}
