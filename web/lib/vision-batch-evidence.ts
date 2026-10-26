/** Join actual per-batch Vision results into Evidence without claiming unseen coverage.
 * Pure function: no API calls, no patient transmission, no invented masks.
 */
import type { EvidenceJson } from "./evidence-json.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import type { VisionBatch } from "./vision-batch-ledger.ts";

export type NativeFrameSource = {
  index: number; seriesUid: string; sopInstanceUid: string; frameIndex: number;
};
export type ReviewedBatch = { batchIndex: number; evidence: EvidenceJson; reviewedIndices: number[] };
export function combineVisionBatchEvidence(
  batches: readonly VisionBatch[], nativeFrames: readonly NativeFrameSource[],
  completed: readonly ReviewedBatch[], modality: "CT"|"MR",
): EvidenceJson {
  if (!batches.length || !nativeFrames.length || !["CT","MR"].includes(modality))
    throw new Error("Missing native study source");
  const source = new Map<number,NativeFrameSource>();
  for (const f of nativeFrames) {
    if (!Number.isSafeInteger(f.index)||f.index<0||!f.seriesUid||!f.sopInstanceUid||
        !Number.isSafeInteger(f.frameIndex)||f.frameIndex<0||source.has(f.index))
      throw new Error("Invalid unique source frame");
    source.set(f.index,f);
  }
  const seenIndices = new Set<number>();
  const allFindings: EvidenceJson["findings"] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  for (let i=0;i<completed.length;i++) {
    const item=completed[i];
    if (item.batchIndex!==i || !batches[i]) throw new Error("Out-of-order or repeated batch");
    const batch=batches[i];
    if (!validateEvidenceJson(item.evidence)||item.evidence.modality!==modality)
      throw new Error("Invalid batch Evidence JSON");
    if (item.reviewedIndices.length!==batch.indices.length ||
      item.reviewedIndices.some((n,j)=>n!==batch.indices[j]||!source.has(n)))
      throw new Error("Only completely source-bound batches may be marked reviewed");
    const permitted = new Set(batch.indices.map(n=>{
      const f=source.get(n)!; return f.seriesUid+"|"+f.sopInstanceUid+"|"+f.frameIndex;
    }));
    for(const n of batch.indices) {seenIndices.add(n);}
    for(const f of item.evidence.findings){
      const key=f.source.seriesUid+"|"+f.source.sopInstanceUid+"|"+f.source.frameIndex;
      if(!permitted.has(key)) throw new Error("Model observation references an unreviewed DICOM frame");
      const id="batch"+i+":"+f.findingId;
      if(seenIds.has(id)) throw new Error("Duplicate finding");
      seenIds.add(id);
      allFindings.push({...f,findingId:id,
        status:"requires_recheck",
        measurements:{diameterMm:null,volumeMl:null},
        limitations:[...f.limitations,"Batch-level research observation; physician confirmation required"].slice(0,20)});
    }
    warnings.push(...item.evidence.warnings.slice(0,3).map(w=>"Batch "+i+": "+w));
  }
  // This is frame coverage, never proof of organ-level diagnostic completeness.
  const overviewBatches=batches.filter(b=>b.pass==="overview").length;
  const overviewDone=completed.filter(x=>batches[x.batchIndex]?.pass==="overview").length;
  const completedAllOverview=overviewDone===overviewBatches;
  if (allFindings.length > 500) throw new Error("Too many findings to represent safely");
  return {
    schema:"opus-evidence/v1",modality,
    coverage:completed.length?"partially_assessed":"not_assessed",
    seriesReviewed:[...new Set([...seenIndices].map(n=>source.get(n)!.seriesUid))],
    findings:allFindings,
    warnings:[
      "Research-only, source-frame-bound vision output; no independent clinical validation.",
      completedAllOverview?"All planned overview frame batches received results; no claim of complete clinical assessment.":
        "Overview incomplete: "+overviewDone+"/"+overviewBatches+" batches received.",
      "Unreviewed and unrepresented anatomy must not be called normal.",
      ...warnings.slice(0,90),
    ].slice(0,100),
  };
}
