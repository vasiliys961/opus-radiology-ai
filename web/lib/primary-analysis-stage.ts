/** A single physician workflow never promotes an in-flight or cancelled
 * original pathology model into a combined Gemini/Opus interpretation.
 * Standalone Vision is still available for compatible CT/MR series. */
export type PrimaryAnalysisStage="idle"|"running"|"completed"|"vision-only"|"cancelled";
export function canSubmitCombinedVisionReview(stage:PrimaryAnalysisStage):boolean{
 return stage==="idle"||stage==="completed"||stage==="vision-only";
}
