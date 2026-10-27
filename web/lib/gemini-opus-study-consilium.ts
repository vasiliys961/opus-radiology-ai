/** One callable research pipeline: approved DICOM-bound rasters -> Gemini batches
 * -> measured evidence ledger -> one Opus draft. No authorization is granted here.
 */
import type { VisionFrame, CompletionCaller } from "./vision-orchestra.ts";
import type { VisionBudgetPlan } from "./vision-budget-plan.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import type { AiProvider } from "./ai-gateway.ts";
import { createGeminiBatchReviewer } from "./gemini-vision-batch-adapter.ts";
import { runBudgetedBatchConsilium } from "./batch-consilium-bridge.ts";

export async function runGeminiOpusStudyConsilium(input:{
  plan:VisionBudgetPlan;
  images:readonly {index:number;frame:VisionFrame}[];
  profile:ImagingStudyProfile;
  detectorEvidence:readonly EvidenceJson[];
  provider:AiProvider;
  visionModel:string;
  clinicalModel:string;
  call:CompletionCaller;
  signal?:AbortSignal;
  maxFramesPerBatch?:number;
}) {
  const {images,profile,plan}=input;
  if (!images.length||images.length!==plan.overviewIndices.length||
      images.some((x,i)=>x.index!==i || x.frame.sopInstanceUid===null)||
      !plan.overviewIndices.every((n,i)=>n===i))
    throw new Error("DICOM raster frame identity/order is missing");
  const source=images.map(({index,frame})=>({
    index,seriesUid:frame.seriesUid,sopInstanceUid:frame.sopInstanceUid!,
    frameIndex:frame.frameIndex,
  }));
  const reviewBatch=createGeminiBatchReviewer(images,profile,{
    provider:input.provider,visionModel:input.visionModel,call:input.call,
  });
  return runBudgetedBatchConsilium(plan,source,profile,input.detectorEvidence,
    reviewBatch,{provider:input.provider,clinicalModel:input.clinicalModel,
      call:input.call,signal:input.signal,maxFramesPerBatch:Math.min(4,input.maxFramesPerBatch??4)});
}
