/** Offline-only vision batch scheduling and provider-reported usage ledger.
 * The ledger cannot send pixels, approve PHI transfer, or infer pathology.
 */
import type { VisionBudgetPlan } from "./vision-budget-plan.ts";

export type VisionBatch = {
  pass: "overview" | "targeted";
  indices: number[];
};
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
};
export type VisionUsageLedger = {
  plannedFrames: number;
  processedOverviewFrames: number;
  processedTargetedFrames: number;
  providerReportedInputTokens: number;
  providerReportedOutputTokens: number;
  totalUSD: number;
  capUSD: number;
  remainingUSD: number;
  stopBeforeNextBatch: boolean;
  completedFullOverview: boolean;
  transmissionPermitted: false;
};

export function createVisionBatches(plan: VisionBudgetPlan, maxFramesPerBatch = 12): VisionBatch[] {
  if (plan.transmissionPermitted !== false || plan.status !== "planned-local-only" ||
      !Number.isSafeInteger(maxFramesPerBatch) || maxFramesPerBatch < 1 || maxFramesPerBatch > 32)
    throw new Error("Invalid local vision batch plan");
  const batches: VisionBatch[] = [];
  for (const [pass, indices] of [
    ["overview", plan.overviewIndices], ["targeted", plan.targetedIndices],
  ] as const) {
    if (indices.some((n,i)=>!Number.isSafeInteger(n)||n<0||(i>0&&n<=indices[i-1])))
      throw new Error("Frame indices must be ascending, unique, and source-bound");
    for (let i=0;i<indices.length;i+=maxFramesPerBatch)
      batches.push({pass,indices:indices.slice(i,i+maxFramesPerBatch)});
  }
  return batches;
}

export function accountReportedVisionUsage(
  plan: VisionBudgetPlan, batches: readonly VisionBatch[],
  completed: readonly { batchIndex: number; usage: ModelUsage }[],
  inputUSDPerMillion = 0.75, outputUSDPerMillion = 3.75,
): VisionUsageLedger {
  if (!Number.isFinite(inputUSDPerMillion)||inputUSDPerMillion<0||
      !Number.isFinite(outputUSDPerMillion)||outputUSDPerMillion<0||
      !Number.isFinite(plan.maxGeminiUSD)||plan.maxGeminiUSD<0)
    throw new Error("Invalid price or cap");
  const seen = new Set<number>();
  let inp=0,out=0,overview=0,targeted=0;
  for (const item of completed) {
    const {batchIndex,usage}=item;
    if (!Number.isSafeInteger(batchIndex)||batchIndex<0||batchIndex>=batches.length||seen.has(batchIndex))
      throw new Error("Duplicate or unknown batch");
    // A batch must be completed in order; an unaccounted failed call must not
    // be silently skipped and treated as zero-cost.
    if (batchIndex!==seen.size) throw new Error("Missing previous usage receipt");
    if (!Number.isSafeInteger(usage.inputTokens)||usage.inputTokens<0||
        !Number.isSafeInteger(usage.outputTokens)||usage.outputTokens<0||
        (usage.reasoningTokens!==undefined&&(!Number.isSafeInteger(usage.reasoningTokens)||usage.reasoningTokens<0)))
      throw new Error("Provider token receipt invalid");
    seen.add(batchIndex);
    inp+=usage.inputTokens;out+=usage.outputTokens;
    if (batches[batchIndex].pass==="overview") overview+=batches[batchIndex].indices.length;
    else targeted+=batches[batchIndex].indices.length;
  }
  const totalUSD=(inp*inputUSDPerMillion+out*outputUSDPerMillion)/1000000;
  const remainingUSD=Math.max(0,plan.maxGeminiUSD-totalUSD);
  return {plannedFrames:plan.overviewIndices.length,processedOverviewFrames:overview,
    processedTargetedFrames:targeted,providerReportedInputTokens:inp,
    providerReportedOutputTokens:out,totalUSD,capUSD:plan.maxGeminiUSD,
    remainingUSD,stopBeforeNextBatch:totalUSD>=plan.maxGeminiUSD,
    completedFullOverview:overview===plan.overviewIndices.length,
    transmissionPermitted:false};
}
