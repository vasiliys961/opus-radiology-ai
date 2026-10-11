import {loadOpenRouterCatalogue, type CatalogFetcher, type ProviderEnv} from "./provider-readiness";
import {syntheticVisionFrames, SYNTHETIC_REGIONS, type SyntheticRegion} from "./synthetic-vision-phantom";
import {runVisionOrchestra, type CompletionCaller, type OrchestraResult} from "./vision-orchestra";
import {validateEvidenceJson} from "./evidence-json";

/**
 * Research sandbox: real provider inference, synthetic geometry ONLY.
 * No uploaded file, DICOM image, clinical text, patient data or custom prompt
 * is accepted from the browser. Strict origin/host checks belong in the route.
 */
export type SyntheticTrialRequest = {
  modality: "CT" | "MR";
  region: SyntheticRegion;
  visionModel: string;
  clinicalModel: string;
  acknowledgePaidSyntheticExperiment: true;
};
export type SyntheticTrialResult = {
  schema: "opus-synthetic-trial/v1";
  sample: "non-patient-mathematical-phantom";
  region: SyntheticRegion;
  patientDataSubmitted: false;
  remoteInferencePerformed: true;
  result: OrchestraResult;
};
export const SYNTHETIC_TRIAL_MAX_COMPLETIONS = 5;
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/:._+-]{0,159}$/;
const TRIAL_FIELDS = ["modality","region","visionModel","clinicalModel","acknowledgePaidSyntheticExperiment"];

export function parseSyntheticTrialInput(value: unknown): SyntheticTrialRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string,unknown>;
  if (Object.keys(v).length !== TRIAL_FIELDS.length ||
      !Object.keys(v).every(x => TRIAL_FIELDS.includes(x)) ||
      (v.modality !== "CT" && v.modality !== "MR") ||
      !SYNTHETIC_REGIONS.includes(v.region as SyntheticRegion) ||
      typeof v.visionModel !== "string" || !MODEL_PATTERN.test(v.visionModel) ||
      typeof v.clinicalModel !== "string" || !MODEL_PATTERN.test(v.clinicalModel) ||
      v.acknowledgePaidSyntheticExperiment !== true) return null;
  return {
    modality: v.modality, region: v.region as SyntheticRegion,
    visionModel: v.visionModel, clinicalModel: v.clinicalModel,
    acknowledgePaidSyntheticExperiment: true,
  };
}
export class SyntheticTrialFailure extends Error {
  constructor(
    public readonly code: "no-key" | "catalog-unavailable" | "unsupported-model" | "invalid-result",
  ) {
    super(code);
  }
}
export async function executeSyntheticTrial(
  input: SyntheticTrialRequest,
  env: ProviderEnv,
  catalogueFetcher: CatalogFetcher,
  call: CompletionCaller,
  signal?: AbortSignal,
): Promise<SyntheticTrialResult> {
  const trusted = parseSyntheticTrialInput(input);
  if (!trusted) throw new SyntheticTrialFailure("unsupported-model");
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new SyntheticTrialFailure("no-key");
  let models;
  try {
    models = await loadOpenRouterCatalogue(key, catalogueFetcher);
  } catch {
    throw new SyntheticTrialFailure("catalog-unavailable");
  }
  const vision = models.find(x => x.id === trusted.visionModel);
  const clinical = models.find(x => x.id === trusted.clinicalModel);
  if (!vision?.acceptsImages || !vision.producesText ||
      !clinical?.acceptsText || !clinical.producesText)
    throw new SyntheticTrialFailure("unsupported-model");
  // Frames are ALWAYS generated from server-owned immutable mathematical
  // fixtures. Even a forged client payload cannot send custom image/text.
  const frames = syntheticVisionFrames(trusted.modality, trusted.region);
  const result = await runVisionOrchestra({
    provider:"openrouter",
    modality: trusted.modality, visionModel: trusted.visionModel,
    clinicalModel: trusted.clinicalModel, frames,
  }, call, signal);
  if (!validateEvidenceJson(result.evidence) ||
      result.clinicalStatus !== "unverified_research_draft" ||
      result.sourceImages.length !== frames.length ||
      result.sourceImages.some((frame,i)=>frame.imageId !== frames[i].imageId ||
        Object.hasOwn(frame,"base64")))
    throw new SyntheticTrialFailure("invalid-result");
  return {
    schema:"opus-synthetic-trial/v1",
    sample:"non-patient-mathematical-phantom",
    region:trusted.region, patientDataSubmitted:false, remoteInferencePerformed:true,
    result,
  };
}
/**
 * Best-effort per-process cost guard for localhost experiments.
 * Not a distributed/production billing quota. Account spend limit required.
 */
export function createSyntheticTrialLimiter(
  maximum = 4, windowMs = 10 * 60_000,
) {
  let occupied = false;
  let starts: number[] = [];
  return {
    acquire(now = Date.now()): (() => void) | null {
      starts = starts.filter(value => value > now - windowMs);
      if (occupied || starts.length >= maximum) return null;
      occupied = true;
      starts.push(now);
      let released = false;
      return () => {
        if (!released) { occupied = false; released = true; }
      };
    },
  };
}
export const sharedSyntheticTrialLimiter = createSyntheticTrialLimiter();
