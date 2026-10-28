/** Physician adjudication of ACTUALLY executed source-bound MONAI candidates.
 * A reader's assessment of a suspicious candidate is not a validated disease
 * classification; preserves uncertain/unreviewed and explicit exclusions.
 */
import type {BoundNoduleReport,NoduleNativeSource} from "./live-nodule-report.ts";

export type ReaderNoduleDecision="suspicious_on_review"|"dismissed_on_review";
export type NodulePhysicianReview={
 schema:"opus-real-monai-physician-candidate-review/v1";
 source:{format:"NIfTI-1-uncompressed";sha256:string;dimensions:number[];affineLps:number[]};
 model:{id:"monai-lung-nodule-ct-retinanet";version:"0.6.9";weightsSha256:string};
 sourceReportStatus:"actual_pretrained_forward_unverified_clinical_use";
 readerReviewStatus:"unsigned_research_draft";
 recordedAt:string;
 candidates:{index:number;score:number;centerLpsMm:number[];
    nativeVoxelIndexHypothesis:number[]|null;extentModelMm:number[];
    readerDecision:ReaderNoduleDecision|"unreviewed";}[];
 totals:{all:number;suspicious:number;dismissed:number;unreviewed:number};
 clinicalDiagnosis:null;
 clinicalNegativeConclusionAllowed:false;
 independentExternalValidation:false;
 cloudUpload:false;
 limitations:string[];
};
export function createNodulePhysicianReview(
 report:BoundNoduleReport,
 native:NoduleNativeSource,
 decisions:Readonly<Record<number,ReaderNoduleDecision|undefined>>,
 recordedAt:string,
):NodulePhysicianReview{
 if(report.schema!=="opus-monai-bound-nodule-inference/v1"||
    report.execution.actualPretrainedInferenceCompleted!==true||
    report.clinicallyValidated!==false||
    report.negativeDiagnosisAllowed!==false||
    report.model.id!=="monai-lung-nodule-ct-retinanet"||
    report.model.version!=="0.6.9"||
    !/^[a-f0-9]{64}$/.test(report.model.weightsSha256)||
    !/^[a-f0-9]{64}$/.test(report.source.sha256)||
    report.source.dimensions.join(",")!==native.dimensions.join(",")||
    report.source.affineLps.join(",")!==native.affineLps.join(",")||
    !Number.isFinite(Date.parse(recordedAt))||
    new Date(recordedAt).toISOString()!==recordedAt||
    report.candidates.length>300)
  throw Error("Не подтверждено происхождение исходной КТ и настоящих находок.");
 const seen=new Set<number>();
 const candidates=report.candidates.map(c=>{
   if(!Number.isSafeInteger(c.index)||c.index<0||seen.has(c.index)||
      !Number.isFinite(c.score)||c.score<0||c.score>1||
      !Array.isArray(c.centerLpsMm)||c.centerLpsMm.length!==3||
      !c.centerLpsMm.every(Number.isFinite)||
      !Array.isArray(c.extentModelMm)||c.extentModelMm.length!==3||
      !c.extentModelMm.every(v=>Number.isFinite(v)&&v>0&&v<=100)||
      (c.nativeVoxelIndexHypothesis!==null&&
       (c.nativeVoxelIndexHypothesis.length!==3||
        !c.nativeVoxelIndexHypothesis.every(Number.isFinite))))
     throw Error("Некорректный кандидат MONAI.");
   seen.add(c.index);
   const decision=decisions[c.index];
   if(decision!==undefined&&decision!=="suspicious_on_review"&&decision!=="dismissed_on_review")
     throw Error("Недопустимый статус врачебного просмотра.");
   return {
     index:c.index,score:c.score,
     centerLpsMm:[...c.centerLpsMm],
     extentModelMm:[...c.extentModelMm],
     nativeVoxelIndexHypothesis:c.nativeVoxelIndexHypothesis===null?null:
       [...c.nativeVoxelIndexHypothesis],
     readerDecision:decision??"unreviewed",
   };
 });
 if(Object.keys(decisions).some(k=>!seen.has(Number(k))||
     !Number.isSafeInteger(Number(k))||String(Number(k))!==k))
   throw Error("Решение не относится к кандидату исходной КТ.");
 return{
   schema:"opus-real-monai-physician-candidate-review/v1",
   source:{format:"NIfTI-1-uncompressed",sha256:report.source.sha256,
     dimensions:[...native.dimensions],affineLps:[...native.affineLps]},
   model:{id:"monai-lung-nodule-ct-retinanet",version:"0.6.9",
     weightsSha256:report.model.weightsSha256},
   sourceReportStatus:"actual_pretrained_forward_unverified_clinical_use",
   readerReviewStatus:"unsigned_research_draft",
   recordedAt,candidates,
   totals:{all:candidates.length,
     suspicious:candidates.filter(c=>c.readerDecision==="suspicious_on_review").length,
     dismissed:candidates.filter(c=>c.readerDecision==="dismissed_on_review").length,
     unreviewed:candidates.filter(c=>c.readerDecision==="unreviewed").length},
   clinicalDiagnosis:null,clinicalNegativeConclusionAllowed:false,
   independentExternalValidation:false,cloudUpload:false,
   limitations:[
     "Оценка врача относится к кандидатам модели, а не ко всем возможным поражениям.",
     "Координаты MONAI в пространстве исходного NIfTI остаются исследовательской гипотезой; визуальное подтверждение обязательно.",
     "Отсутствие или отклонение кандидатов не исключает узлы, рак лёгкого или другую патологию.",
     "Результат неподписан, не имеет независимой клинической валидации и не является окончательным заключением.",
   ],
 };
}
