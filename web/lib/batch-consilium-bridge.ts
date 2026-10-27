/** Compose verified batch-level vision evidence with existing detector evidence.
 * The specialist vision adapter is injected, so no patient cloud transfer is enabled here.
 * Opus is called exactly once, after the sequential batch run completes or stops.
 */
import { executeVisionBatches } from "./vision-batch-executor.ts";
import type { BatchProviderResult, VisionBatchRunResult } from "./vision-batch-executor.ts";
import type { VisionBatch } from "./vision-batch-ledger.ts";
import type { VisionBudgetPlan } from "./vision-budget-plan.ts";
import type { NativeFrameSource } from "./vision-batch-evidence.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import { assignImagingSpecialists, CONSILIUM_OPUS_PROMPT } from "./imaging-specialist-consilium.ts";
import type { ImagingStudyProfile } from "./imaging-specialist-consilium.ts";
import type { CompletionCaller, ClinicalDraft } from "./vision-orchestra.ts";
import { parseClinicalDraft, parseStrictObject, readCompletionText } from "./vision-orchestra.ts";
import type { AiProvider } from "./ai-gateway.ts";

export type BatchConsiliumResult = {
  schema: "opus-batch-consilium/v1";
  specialists: string[];
  batch: VisionBatchRunResult;
  detectorEvidence: EvidenceJson[];
  clinicalDraft: ClinicalDraft | null;
  clinicalStatus: "unverified_research_draft" | "not_generated";
};
export async function runBudgetedBatchConsilium(
  plan: VisionBudgetPlan,
  frames: readonly NativeFrameSource[],
  profile: ImagingStudyProfile,
  detectorEvidence: readonly EvidenceJson[],
  reviewBatch: (batch: VisionBatch, batchIndex: number, signal?: AbortSignal) => Promise<BatchProviderResult>,
  options: {
    provider: AiProvider;
    clinicalModel: string;
    call: CompletionCaller;
    signal?: AbortSignal;
    maxFramesPerBatch?: number;
    inputUSDPerMillion?: number;
    outputUSDPerMillion?: number;
  },
): Promise<BatchConsiliumResult> {
  const specialists = assignImagingSpecialists(profile).map(s => s.specialty);
  if (!Array.isArray(detectorEvidence) || detectorEvidence.length > 18 ||
      detectorEvidence.some(e => !validateEvidenceJson(e) || e.modality !== profile.modality))
    throw new Error("Invalid detector evidence");
  if (!["openrouter","polza"].includes(options.provider) ||
      typeof options.clinicalModel !== "string" ||
      options.clinicalModel.length < 1 || options.clinicalModel.length > 160)
    throw new Error("Invalid Opus provider configuration");
  // Batch execution checks exact DICOM frames, sequential receipts and budget before each call.
  const batch = await executeVisionBatches(plan, frames, profile.modality, reviewBatch, {
    signal: options.signal,
    maxFramesPerBatch: options.maxFramesPerBatch,
    inputUSDPerMillion: options.inputUSDPerMillion,
    outputUSDPerMillion: options.outputUSDPerMillion,
  });
  // No findings reviewed: do not generate a plausible-sounding normal report.
  if (batch.completedBatches === 0 || options.signal?.aborted)
    return {schema:"opus-batch-consilium/v1",specialists,batch,
      detectorEvidence:[...detectorEvidence],clinicalDraft:null,clinicalStatus:"not_generated"};
  const response = await options.call({
    provider:options.provider,role:"reasoning",model:options.clinicalModel,temperature:0,
    messages:[
      {role:"system",content:CONSILIUM_OPUS_PROMPT +
        ' Explicitly state partial/missing batches and unresolved findings. Return ONLY JSON {"summary":"unsigned draft","limitations":["text"]}.'},
      {role:"user",content:JSON.stringify({
        profile,
        visionEvidence:batch.evidence,
        detectorEvidence,
        batchState:batch.state,
        completedBatches:batch.completedBatches,
        reviewedFrames:batch.ledger.processedOverviewFrames,
        plannedFrames:batch.ledger.plannedFrames,
      })},
    ],
  },options.signal);
  const clinicalDraft=parseClinicalDraft(parseStrictObject(readCompletionText(response)));
  return {schema:"opus-batch-consilium/v1",specialists,batch,
    detectorEvidence:[...detectorEvidence],clinicalDraft,
    clinicalStatus:"unverified_research_draft"};
}
