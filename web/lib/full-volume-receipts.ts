/** Locally binds each paid Gemini batch to original ordered DICOM frame indices.
 * Native UID, paths, patient metadata and source pixels never enter Opus input.
 */
import {accountReportedVisionUsage} from "./vision-batch-ledger.ts";
import type {VisionBatch,ModelUsage} from "./vision-batch-ledger.ts";
import type {VisionBudgetPlan} from "./vision-budget-plan.ts";
import type {VolumeGeminiBatchResult} from "./approved-volume-batch-review.ts";

export type LocalVolumeFinding={
  sourceIndex:number;pass:"overview"|"targeted";
  anatomy:string;sign:string;uncertainty:string;
};
export type LocalVolumeReceipt={
  batchIndex:number;usage:ModelUsage;findings:LocalVolumeFinding[];
  limitations:string[];
};
export const GEMINI_INPUT_RATE_USD_PER_M=0.75;
export const GEMINI_OUTPUT_RATE_USD_PER_M=3.75;
export const GEMINI_RESERVE_INPUT_PER_FRAME=2500;
export const GEMINI_RESERVE_OUTPUT_PER_BATCH=1800;
function safeText(x:unknown,max:number):x is string{
  return typeof x==="string"&&x.trim().length>0&&x.length<=max;
}
export function appendGeminiVolumeReceipt(
  previous:readonly LocalVolumeReceipt[],batches:readonly VisionBatch[],
  batchIndex:number,answer:VolumeGeminiBatchResult,
):LocalVolumeReceipt[]{
  const batch=batches[batchIndex];
  if(!batch||batchIndex!==previous.length||
     !answer||answer.schema!=="opus-gemini-volume-batch/v1"||
     answer.model!=="google/gemini-3.8-flash"||
     answer.clinicalValidation!==false||answer.sourceBindingsLocalOnly!==true)
    throw Error("Wrong or repeated provider volume batch");
  const ids=batch.indices.map((_,i)=>"frame-"+(i+1));
  if(answer.imagesReviewed!==ids.length||!Array.isArray(answer.reviewedImageIds)||
     answer.reviewedImageIds.length!==ids.length||
     ids.some((id,i)=>answer.reviewedImageIds[i]!==id))
    throw Error("Provider did not review this exact local batch");
  const receipt=answer.receipt;
  if(!receipt||!Number.isSafeInteger(receipt.inputTokens)||
     !Number.isSafeInteger(receipt.outputTokens)||
     receipt.inputTokens<0||receipt.outputTokens<0)
    throw Error("Real Gemini usage receipt missing");
  if(!Array.isArray(answer.observations)||answer.observations.length>18||
     !Array.isArray(answer.limitations)||answer.limitations.length>12||
     !answer.limitations.every(x=>typeof x==="string"&&x.length<=500))
    throw Error("Invalid volume observations");
  const findings=answer.observations.map(o=>{
    const pos=ids.indexOf(o.imageId);
    if(pos<0||!safeText(o.anatomy,180)||!safeText(o.sign,500)||
       !safeText(o.uncertainty,500)||!safeText(o.id,90))
      throw Error("Gemini finding lacks exact source-bound frame");
    return {sourceIndex:batch.indices[pos],pass:batch.pass,
      anatomy:o.anatomy,sign:o.sign,uncertainty:o.uncertainty};
  });
  return [...previous,{
    batchIndex,usage:{inputTokens:receipt.inputTokens,outputTokens:receipt.outputTokens},
    findings,limitations:[...answer.limitations],
  }];
}
export function volumeLedger(plan:VisionBudgetPlan,batches:readonly VisionBatch[],
  receipts:readonly LocalVolumeReceipt[]){
  return accountReportedVisionUsage(plan,batches,receipts.map(({batchIndex,usage})=>({batchIndex,usage})),
    GEMINI_INPUT_RATE_USD_PER_M,GEMINI_OUTPUT_RATE_USD_PER_M);
}
export function canPayForNextBatch(plan:VisionBudgetPlan,batches:readonly VisionBatch[],
  receipts:readonly LocalVolumeReceipt[]):boolean{
  if(receipts.length>=batches.length)return false;
  const ledger=volumeLedger(plan,batches,receipts);
  const next=batches[receipts.length];
  const reserve=(next.indices.length*GEMINI_RESERVE_INPUT_PER_FRAME*GEMINI_INPUT_RATE_USD_PER_M+
    GEMINI_RESERVE_OUTPUT_PER_BATCH*GEMINI_OUTPUT_RATE_USD_PER_M)/1e6;
  return !ledger.stopBeforeNextBatch&&ledger.remainingUSD+1e-12>=reserve;
}
export type SafeVolumeOpusInput={
  schema:"opus-volume-synthesis-request/v1";
  modality:"CT"|"MR";
  plannedFrames:number;
  overviewReviewed:number;
  targetedReviewed:number;
  completedBatches:number;
  totalBatches:number;
  observations:Array<{sliceNumber:number;pass:"overview"|"targeted";
    anatomy:string;sign:string;uncertainty:string}>;
  limitations:string[];
  acknowledgePaidOpusSynthesis:true;
};
/** Explicitly NO SOP UID, filenames, local IDs or patient descriptions. */
export function makeSafeVolumeOpusInput(
  modality:"CT"|"MR",plan:VisionBudgetPlan,
  batches:readonly VisionBatch[],receipts:readonly LocalVolumeReceipt[],
):SafeVolumeOpusInput{
  const ledger=volumeLedger(plan,batches,receipts);
  if(!receipts.length||receipts.length!==batches.length||
     !ledger.completedFullOverview)throw Error("Full Gemini overview must complete before Opus");
  const findings=receipts.flatMap(x=>x.findings);
  if(findings.length>180)throw Error("Too many observations for one safe Opus request");
  const limitations=[...new Set(receipts.flatMap(x=>x.limitations))].slice(0,30);
  const result:SafeVolumeOpusInput={
    schema:"opus-volume-synthesis-request/v1",modality,
    plannedFrames:ledger.plannedFrames,
    overviewReviewed:ledger.processedOverviewFrames,
    targetedReviewed:ledger.processedTargetedFrames,
    completedBatches:receipts.length,totalBatches:batches.length,
    observations:findings.map(f=>({sliceNumber:f.sourceIndex+1,pass:f.pass,
      anatomy:f.anatomy,sign:f.sign,uncertainty:f.uncertainty})),
    limitations,acknowledgePaidOpusSynthesis:true,
  };
  if(JSON.stringify(result).length>110000)throw Error("Opus input context too large");
  return result;
}
