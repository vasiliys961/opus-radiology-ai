/** Opt-in local detector execution over exactly the open DICOM series.
 * A target being listed by a consultant never means a trained executor exists.
 * Only explicitly registered, protocol-qualified executors can produce Evidence.
 */
import type { DicomSeries } from "./dicom-series.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import { routeDicomConsilium } from "./dicom-consilium-routing.ts";

export type DetectorExecutor = {
  target: string;
  modality: "CT"|"MR";
  /** Extra sequence, phase, geometry and source checks; must fail closed. */
  eligible: (series:DicomSeries)=>boolean;
  run: (series:DicomSeries,signal?:AbortSignal)=>Promise<EvidenceJson>;
};
export type DetectorDispatch = {
  executed: string[];
  blocked: {target:string;reason:string}[];
  evidence: EvidenceJson[];
};
/** Execute only registered model adapters with independently grounded source findings.
 * The physician's DICOM dataset stays local; this function never calls cloud providers.
 */
export async function dispatchDicomDetectors(
  series:DicomSeries|null,
  registry:readonly DetectorExecutor[],
  signal?:AbortSignal,
):Promise<DetectorDispatch> {
  const route=routeDicomConsilium(series);
  if (route.status==="blocked" || !series)
    return {executed:[],evidence:[],blocked:[{target:"study",reason:route.reason??"Unsupported study"}]};
  if (!Array.isArray(registry)||registry.length>100)
    throw new Error("Invalid executor registry");
  const members=series.members.map(m=>m.metadata);
  const allowedSeries=new Set(members.map(m=>m.seriesUid).filter((s):s is string=>!!s));
  const allowedSop=new Set(members.map(m=>m.sopInstanceUid).filter((s):s is string=>!!s));
  if (allowedSeries.size!==1 || allowedSop.size!==members.length)
    return {executed:[],evidence:[],blocked:[{target:"study",reason:"Source DICOM UIDs unverified"}]};
  const allTargets=new Set(route.detectorTargets);
  const registered=new Map<string,DetectorExecutor>();
  for (const entry of registry) {
    if (!entry||typeof entry.target!=="string"||registered.has(entry.target)||
        typeof entry.eligible!=="function"||typeof entry.run!=="function")
      throw new Error("Invalid or repeated executor");
    registered.set(entry.target,entry);
  }
  const result:DetectorDispatch={executed:[],blocked:[],evidence:[]};
  for (const target of allTargets) {
    if (signal?.aborted) {result.blocked.push({target,reason:"Cancelled"});break;}
    const model=registered.get(target);
    if (!model) {result.blocked.push({target,reason:"No registered executable model"});continue;}
    if (model.modality!==series.modality || !model.eligible(series)) {
      result.blocked.push({target,reason:"Protocol or resources unverified"});continue;
    }
    try {
      const evidence=await model.run(series,signal);
      if (!validateEvidenceJson(evidence)||evidence.modality!==series.modality||
          evidence.seriesReviewed.some(uid=>!allowedSeries.has(uid))||
          evidence.findings.some(f=>!f.source.sopInstanceUid ||
            !allowedSop.has(f.source.sopInstanceUid)||
            f.source.frameIndex!==0 || !allowedSeries.has(f.source.seriesUid)))
        throw new Error("Unverified model source");
      result.executed.push(target);
      result.evidence.push(evidence);
    } catch {
      result.blocked.push({target,reason:"Execution failed or provenance was invalid"});
    }
  }
  return result;
}
