/** The first automatic local-detector -> Gemini -> Opus composition.
 * External Vision is caller-controlled and MUST receive only separately authorized raster copies.
 * Does not authorize transfer, generate images, or pretend a candidate is installed.
 */
import type { DicomSeries } from "./dicom-series.ts";
import type { DetectorExecutor, DetectorDispatch } from "./dicom-detector-dispatch.ts";
import { dispatchDicomDetectors } from "./dicom-detector-dispatch.ts";
import { runGeminiOpusStudyConsilium } from "./gemini-opus-study-consilium.ts";
import type { VisionFrame, CompletionCaller } from "./vision-orchestra.ts";
import type { VisionBudgetPlan } from "./vision-budget-plan.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";
import type { AiProvider } from "./ai-gateway.ts";

export type AutoConsiliumResult = {
  detectorDispatch: DetectorDispatch;
  consilium: Awaited<ReturnType<typeof runGeminiOpusStudyConsilium>> | null;
  state: "complete" | "local_only" | "cancelled";
};
export async function runAutoDicomConsilium(input:{
  series: DicomSeries;
  registeredDetectors: readonly DetectorExecutor[];
  /** A true value must be issued by an external privacy/clinician authorization gate.
   * A UI checkbox or DICOM PatientIdentityRemoved tag alone cannot grant it. */
  authorizedCloudImages: false | {
    frames: readonly {index:number;frame:VisionFrame}[];
    plan:VisionBudgetPlan;
    profile:ImagingStudyProfile;
    provider:AiProvider;
    visionModel:string;
    clinicalModel:string;
    call:CompletionCaller;
  };
  signal?:AbortSignal;
}):Promise<AutoConsiliumResult> {
  const detectorDispatch=await dispatchDicomDetectors(input.series,input.registeredDetectors,input.signal);
  if (input.signal?.aborted)
    return {detectorDispatch,consilium:null,state:"cancelled"};
  if (!input.authorizedCloudImages)
    return {detectorDispatch,consilium:null,state:"local_only"};
  const {profile,frames,plan,provider,visionModel,clinicalModel,call}=input.authorizedCloudImages;
  if (profile.modality!==input.series.modality ||
      !frames.length || frames.some(({frame})=>!input.series.members.some(member=>
        member.metadata.seriesUid===frame.seriesUid &&
        member.metadata.sopInstanceUid===frame.sopInstanceUid)))
    throw new Error("Cloud frames are not source-bound to the active DICOM series");
  const consilium=await runGeminiOpusStudyConsilium({
    images:frames,plan,profile,detectorEvidence:detectorDispatch.evidence,
    provider,visionModel,clinicalModel,call,signal:input.signal,
  });
  return {detectorDispatch,consilium,state:"complete"};
}
