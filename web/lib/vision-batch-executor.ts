/** Sequential executor for explicitly authorized research images.
 * Calls a supplied provider adapter; never interprets synthetic success as clinical validation.
 * Exact usage receipts are required before continuing to the next batch.
 */
import { createVisionBatches, accountReportedVisionUsage } from "./vision-batch-ledger.ts";
import type { ModelUsage, VisionBatch } from "./vision-batch-ledger.ts";
import type { VisionBudgetPlan } from "./vision-budget-plan.ts";
import { combineVisionBatchEvidence } from "./vision-batch-evidence.ts";
import type { NativeFrameSource } from "./vision-batch-evidence.ts";
import type { EvidenceJson } from "./evidence-json.ts";

export type BatchProviderResult = {
  evidence: EvidenceJson;
  reviewedIndices: number[];
  usage: ModelUsage;
};
export type VisionBatchRunResult = {
  state: "complete" | "budget_exhausted" | "interrupted";
  completedBatches: number;
  failure: string | null;
  evidence: EvidenceJson;
  ledger: ReturnType<typeof accountReportedVisionUsage>;
};
/** The caller must authorize and sanitize image bytes before providing this function.
 * This executor itself does not grant cloud transmission permission.
 */
export async function executeVisionBatches(
  plan: VisionBudgetPlan,
  frames: readonly NativeFrameSource[],
  modality: "CT" | "MR",
  runBatch: (batch: VisionBatch, batchIndex: number, signal?: AbortSignal) => Promise<BatchProviderResult>,
  options: {
    maxFramesPerBatch?: number;
    inputUSDPerMillion?: number;
    outputUSDPerMillion?: number;
    estimatedInputTokensPerFrame?: number;
    estimatedOutputTokensPerBatch?: number;
    signal?: AbortSignal;
  } = {},
): Promise<VisionBatchRunResult> {
  const batches = createVisionBatches(plan, options.maxFramesPerBatch ?? 4);
  if (frames.length !== plan.overviewIndices.length ||
      !frames.every((f,i) => f.index === i) ||
      typeof runBatch !== "function") throw new Error("Source frame count/order mismatch");
  const inputPrice = options.inputUSDPerMillion ?? 0.75;
  const outputPrice = options.outputUSDPerMillion ?? 3.75;
  const inputEstimate = options.estimatedInputTokensPerFrame ?? 280;
  const outputEstimate = options.estimatedOutputTokensPerBatch ?? 400;
  if (![inputPrice,outputPrice,inputEstimate,outputEstimate].every(x => Number.isFinite(x) && x >= 0))
    throw new Error("Invalid provider pricing or estimates");
  const receipts: {batchIndex:number;usage:ModelUsage}[] = [];
  const completed: {batchIndex:number;evidence:EvidenceJson;reviewedIndices:number[]}[] = [];
  let state: VisionBatchRunResult["state"] = "complete";
  let failure: string | null = null;
  for (let i=0;i<batches.length;i++) {
    const batch=batches[i];
    const ledger=accountReportedVisionUsage(plan,batches,receipts,inputPrice,outputPrice);
    const reserve=(batch.indices.length*inputEstimate*inputPrice + outputEstimate*outputPrice)/1_000_000;
    if (ledger.stopBeforeNextBatch || ledger.remainingUSD + 1e-12 < reserve) {
      state="budget_exhausted"; break;
    }
    if (options.signal?.aborted) { state="interrupted"; failure="Aborted"; break; }
    try {
      const result=await runBatch(batch,i,options.signal);
      // Verify source provenance before recording a completed response and its usage.
      combineVisionBatchEvidence(batches,frames,[...completed,{
        batchIndex:i,evidence:result.evidence,reviewedIndices:result.reviewedIndices,
      }],modality);
      accountReportedVisionUsage(plan,batches,[...receipts,{batchIndex:i,usage:result.usage}],inputPrice,outputPrice);
      completed.push({batchIndex:i,evidence:result.evidence,reviewedIndices:result.reviewedIndices});
      receipts.push({batchIndex:i,usage:result.usage});
    } catch {
      // A failed provider call may have consumed billable tokens. Stop rather than
      // assuming zero usage and silently sending subsequent batches.
      state="interrupted";failure="Batch failed or lacked a valid receipt/source binding";break;
    }
  }
  return {state,completedBatches:completed.length,failure,
    evidence:combineVisionBatchEvidence(batches,frames,completed,modality),
    ledger:accountReportedVisionUsage(plan,batches,receipts,inputPrice,outputPrice)};
}
