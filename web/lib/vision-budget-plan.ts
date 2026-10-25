/** Local-only budgeting for two-pass study review. Never sends pixels or grants cloud consent.
 * Token estimates are configuration assumptions, not vendor-billed usage.
 */
export type VisionBudgetPlan = {
  schema: "opus-dual-pass-vision-budget/v1";
  overviewIndices: number[];
  targetedIndices: number[];
  unreviewedIndices: number[];
  overviewCoversAllFrames: boolean;
  estimatedGeminiUSD: number;
  maxGeminiUSD: number;
  requiresExplicitBudgetApproval: boolean;
  transmissionPermitted: false;
  deidentificationVerified: false;
  status: "planned-local-only";
};

export type VisionBudgetOptions = {
  frameCount: number;
  flaggedIndices?: readonly number[];
  overviewTokensPerFrame?: number;
  targetedTokensPerFrame?: number;
  inputUSDPerMillion?: number;
  outputUSDPerMillion?: number;
  estimatedOutputTokens?: number;
  maxGeminiUSD?: number;
  adjacentRadius?: number;
};

export function planBudgetedVisionReview(options: VisionBudgetOptions): VisionBudgetPlan {
  const {
    frameCount, flaggedIndices = [], overviewTokensPerFrame = 280,
    targetedTokensPerFrame = 1120, inputUSDPerMillion = 0.75,
    outputUSDPerMillion = 3.75, estimatedOutputTokens = 2000,
    maxGeminiUSD = 0.30, adjacentRadius = 2,
  } = options;
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 2000 ||
      !Number.isSafeInteger(adjacentRadius) || adjacentRadius < 0 || adjacentRadius > 10 ||
      !Number.isSafeInteger(estimatedOutputTokens) || estimatedOutputTokens < 0 ||
      ![overviewTokensPerFrame,targetedTokensPerFrame,inputUSDPerMillion,
        outputUSDPerMillion,maxGeminiUSD].every(x=>Number.isFinite(x) && x >= 0) ||
      overviewTokensPerFrame === 0 || targetedTokensPerFrame === 0)
    throw new Error("Invalid bounded vision budget");
  const flagged = new Set<number>();
  for (const i of flaggedIndices) {
    if (!Number.isSafeInteger(i) || i < 0 || i >= frameCount)
      throw new Error("Invalid flagged frame index");
    for (let j = Math.max(0,i-adjacentRadius);j<=Math.min(frameCount-1,i+adjacentRadius);j++) flagged.add(j);
  }
  const targetedIndices = [...flagged].sort((a,b)=>a-b);
  // The overview is intentionally exhaustive in the local plan; model context
  // limits must be checked separately before any future network execution.
  const overviewIndices = Array.from({length: frameCount},(_,i)=>i);
  const estimatedGeminiUSD = (
    (frameCount*overviewTokensPerFrame+targetedIndices.length*targetedTokensPerFrame)
    *inputUSDPerMillion + estimatedOutputTokens*outputUSDPerMillion
  )/1000000;
  return {
    schema:"opus-dual-pass-vision-budget/v1", overviewIndices, targetedIndices,
    unreviewedIndices:[], overviewCoversAllFrames:true, estimatedGeminiUSD,
    maxGeminiUSD, requiresExplicitBudgetApproval: estimatedGeminiUSD > maxGeminiUSD,
    transmissionPermitted:false, deidentificationVerified:false,
    status:"planned-local-only",
  };
}
