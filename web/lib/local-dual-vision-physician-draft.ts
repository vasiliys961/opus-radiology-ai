/**
 * Local clinician research adjudication of Gemini/Opus *observations* and
 * optional local R231 segmentation numbers on an exact source-bound CT/MR.
 * No patient identity, original DICOM, local file IDs or cloud transmission.
 * No positive/negative diagnosis, physician login or digital signature.
 */
import {bindLocalSanitizedReview,type LocalReviewedFrame} from "./local-cloud-source-navigation.ts";
import type {SanitizedModelReview} from "./sanitized-cloud-review.ts";

export type ObservationDecision="unreviewed"|"needs_original_source_recheck"|"rejected_by_local_reviewer";
export type LocalObservationAssessment={decision:ObservationDecision;note:string};
export type LocalDualReviewDraft={
 schema:"opus-local-dual-vision-physician-draft/v1";
 provenance:{sourceScope:"sampled-image-frames";modality:"CT"|"MR";
   sourceImagePixelSHA256:string[];clinicalProvenanceServerVerified:false};
 specialistEvidence:SanitizedModelReview["specialistEvidence"]|null;
 observations:{reviewer:"gemini"|"opus";findingId:string;imageId:string;
   anatomy:string;sign:string;uncertainty:string;review:LocalObservationAssessment}[];
 discordantFrameCounts:{frameId:string;gemini:number;opus:number;countsDoNotMeasureAgreement:true}[];
 synthesis:string;
 clinicianIdentityVerified:false;clinicalValidation:false;digitallySigned:false;
 providerCallsMadeForThisDraft:false;externalTransmission:false;
 automaticDiagnosis:false;absenceOfDiseaseEstablished:false;
 limitations:string[];
};

const CLEAN_ID=/^[a-zA-Z0-9][a-zA-Z0-9._:+/-]{0,159}$/;
const BODY=/^[\s\S]{0,4000}$/;
export const findingReviewKey=(reviewer:"gemini"|"opus",imageId:string,findingId:string)=>
  reviewer+":"+imageId+":"+findingId;

export function buildLocalDualReviewDraft(
 review:SanitizedModelReview,
 currentLocalFrames:readonly LocalReviewedFrame[],
 originalPrivateFileIds:readonly string[],
 decisions:Readonly<Record<string,LocalObservationAssessment>>,
 synthesis:string,
):LocalDualReviewDraft{
 // No result from the wrong image or swapped source may be used for adjudication.
 bindLocalSanitizedReview(review,currentLocalFrames,originalPrivateFileIds);
 if(typeof synthesis!=="string"||!BODY.test(synthesis)||
    !Array.isArray(review.results)||review.results.length!==2||
    (review.modality!=="CT"&&review.modality!=="MR"))
  throw Error("invalid_local_physician_draft");
 const seen=new Set<string>();
 const observations:LocalDualReviewDraft["observations"]=[];
 for(const result of review.results){
  if(result.reviewer!=="gemini"&&result.reviewer!=="opus")
    throw Error("unexpected_review_model");
  for(const f of result.review.observations){
   const key=findingReviewKey(result.reviewer,f.imageId,f.id);
   if(seen.has(key)||!CLEAN_ID.test(f.id)||!CLEAN_ID.test(f.imageId))
    throw Error("duplicate_or_invalid_local_observation");
   seen.add(key);
   const assessment=decisions[key]??{decision:"unreviewed",note:""};
   if(!["unreviewed","needs_original_source_recheck","rejected_by_local_reviewer"].includes(assessment.decision)||
      typeof assessment.note!=="string"||assessment.note.length>500||
      /[\u0000-\u0008\u000b-\u001f]/.test(assessment.note))
    throw Error("invalid_clinician_assessment");
   observations.push({reviewer:result.reviewer,findingId:f.id,imageId:f.imageId,
     anatomy:f.anatomy,sign:f.sign,uncertainty:f.uncertainty,
     review:{decision:assessment.decision,note:assessment.note}});
  }
 }
 if(Object.keys(decisions).some(k=>!seen.has(k)))throw Error("foreign_clinician_observation");
 const perFrame=review.sourceFrames.map(f=>({
  frameId:f.imageId,
  gemini:observations.filter(o=>o.reviewer==="gemini"&&o.imageId===f.imageId).length,
  opus:observations.filter(o=>o.reviewer==="opus"&&o.imageId===f.imageId).length,
  countsDoNotMeasureAgreement:true as const,
 }));
 return {
  schema:"opus-local-dual-vision-physician-draft/v1",
  provenance:{sourceScope:"sampled-image-frames",modality:review.modality,
    sourceImagePixelSHA256:currentLocalFrames.map(f=>f.reviewedPixelSha256),
    clinicalProvenanceServerVerified:false},
  specialistEvidence:review.specialistEvidence?{
    model:"lungmask-R231",frameCount:review.specialistEvidence.frameCount,
    rightLungMaskMl:review.specialistEvidence.rightLungMaskMl,
    leftLungMaskMl:review.specialistEvidence.leftLungMaskMl,
    clinicalProvenanceServerVerified:false,
    findingOfPathologyEstablished:false,
  }:null,
  observations,discordantFrameCounts:perFrame,synthesis,
  clinicianIdentityVerified:false,clinicalValidation:false,digitallySigned:false,
  providerCallsMadeForThisDraft:false,externalTransmission:false,
  automaticDiagnosis:false,absenceOfDiseaseEstablished:false,
  limitations:[
   "Неподписанный локальный протокол. Личность автора и клиническая точность не подтверждены.",
   "Обрабатывалась выборка отдельных CT/MR-кадров, а не весь объём; отсутствие заболевания не установлено.",
   "Отметки врача относятся к непроверенным наблюдениям двух LLM; совпадение счётчиков не есть согласие диагнозов.",
   "Прилагаемые сведения R231, если имеются, относятся только к сегментации лёгких, не к патологии.",
   "Врачебные заметки могут быть чувствительными; хранить JSON только локально, не отправлять провайдерам.",
  ],
 };
}
