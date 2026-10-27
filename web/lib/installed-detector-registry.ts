/** Installed local executors for the SAME currently opened DICOM series.
 * This is a runtime registry, not the research model inventory. A published
 * checkpoint or archived inference JSON is never sufficient to register.
 *
 * The trusted ICH worker must verify checkpoint bytes and the exact source
 * input digest before returning its native SOP-ordered result. This browser
 * module cannot verify the worker's installed bytes on its own.
 */
import type {DetectorExecutor} from "./dicom-detector-dispatch.ts";
import {createLocalIchExecutor,type TrustedLocalIchRun} from "./local-ich-detector-executor.ts";
import {localLaa950Executor} from "./local-laa950-evidence-executor.ts";
import type {CapturedLocalSpecialist} from "./same-series-r231-cloud-evidence.ts";
import type {CapturedLocalLaa950} from "./same-series-laa950-review.ts";

/** Publisher's original SAMIHS checkpoint, not an inference-success claim. */
export const OFFICIAL_SAMIHS_CHECKPOINT_SHA256 =
  "b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e";

export type InstalledIchRuntime = {
  /** All readiness and digest fields must originate from the trusted local worker. */
  ready: boolean;
  modelId: "samihs-ich-binary-ct";
  checkpointSha256: string;
  dataPolicy: "public-reference-only";
  /** Execute newly opened source images, never replay archived research output. */
  run: TrustedLocalIchRun;
};

export type InstalledDetectorInputs = {
  capturedSpecialist?: CapturedLocalSpecialist | null;
  capturedLaa950?: CapturedLocalLaa950 | null;
  ichRuntime?: InstalledIchRuntime | null;
  /** Caller must separately verify the selected study is lawful public research. */
  publicResearchAuthorized?: boolean;
};

export type InstalledDetectorRegistry = {
  executors: readonly DetectorExecutor[];
  unavailable: readonly {target: string; reason: string}[];
};

/** Fail closed: no ICH model is installed in the browser by default. */
export function installedDetectorRegistry(inputs: InstalledDetectorInputs): InstalledDetectorRegistry {
  const executors: DetectorExecutor[]=[];
  const unavailable: {target: string; reason: string}[]=[];
  const ich=inputs.ichRuntime;
  if (!inputs.publicResearchAuthorized) {
    unavailable.push({target:"intracerebral-hemorrhage",reason:"Public research source not authorized; patient-mode ICH unavailable"});
  } else if (!ich || !ich.ready || ich.dataPolicy!=="public-reference-only" ||
      ich.modelId!=="samihs-ich-binary-ct" ||
      ich.checkpointSha256!==OFFICIAL_SAMIHS_CHECKPOINT_SHA256 ||
      typeof ich.run!=="function") {
    unavailable.push({target:"intracerebral-hemorrhage",reason:"No ready trusted ICH worker with verified official weights"});
  } else {
    executors.push(createLocalIchExecutor(async (series,signal) => {
      const returned=await ich.run(series,signal);
      if (returned.modelId!==ich.modelId)
        throw new Error("ICH worker model identity changed");
      return returned;
    }));
  }
  // This is an already captured, source-bound R231 quantitative measurement,
  // NOT a pathological emphysema detector.
  if (inputs.capturedSpecialist && inputs.capturedLaa950)
    executors.push(localLaa950Executor(inputs.capturedSpecialist,inputs.capturedLaa950));
  return {executors,unavailable};
}
