/** Browser-only streaming preparation of ALL source-verified CT/MR frames.
 * Never authorizes image transfer and never calls an external model.
 * Retains at most one four-frame decoded/OCR batch at a time; the consumer must
 * release each yielded batch before requesting the next one.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planVisionFrameSamples} from "./vision-frame-plan.ts";
import {planBudgetedVisionReview,type VisionBudgetPlan} from "./vision-budget-plan.ts";
import {createVisionBatches,type VisionBatch} from "./vision-batch-ledger.ts";
import {decodeDicomPreview} from "./dicom-lite.ts";
import {MAX_PRIVACY_PIXELS} from "./vision-privacy.ts";
import {autoPrepareVisionPrivacy,type AutomaticPrivacyPreparation} from "./auto-privacy-preparation.ts";

export type VolumeFrameSource={
  index:number; fileId:string; seriesUid:string; sopInstanceUid:string;
  frameIndex:0; slicePositionMm:number|null;
};
export type VolumePreparedBatch={
  batchIndex:number; pass:VisionBatch["pass"]; indices:number[];
  sources:VolumeFrameSource[];
  privacy:AutomaticPrivacyPreparation;
  /** OCR success is not physician pixel approval and is not transmission consent. */
  transmissionPermitted:false;
  physicianReviewed:false;
};
export type VolumeSourcePlan={
  budget:VisionBudgetPlan;
  sourceFrames:VolumeFrameSource[];
  batches:VisionBatch[];
  transmissionPermitted:false;
};
type PrepareOptions={
  flaggedIndices?:readonly number[];
  maxGeminiUSD?:number;
  signal:AbortSignal;
  onProgress?:(message:string)=>void;
  decode?:typeof decodeDicomPreview;
  prepare?:typeof autoPrepareVisionPrivacy;
};
/** Reject missing/ambiguous source geometry before any pixel decoding. */
export function planOriginalVolumeSource(
  series:DicomSeries, options:Pick<PrepareOptions,"flaggedIndices"|"maxGeminiUSD">={},
):VolumeSourcePlan{
  const verify=planVisionFrameSamples([series],series.key,4);
  if(verify.status!=="ready-for-local-preview")throw Error(
    "Full-volume DICOM source not verified: "+verify.blockers.join(" "));
  if(series.modality!=="CT"&&series.modality!=="MR")throw Error("CT/MR only");
  const budget=planBudgetedVisionReview({
    frameCount:series.members.length,
    flaggedIndices:options.flaggedIndices,
    maxGeminiUSD:options.maxGeminiUSD,
  });
  const sourceFrames=series.members.map((member,index)=>({
    index,fileId:member.id,
    seriesUid:member.metadata.seriesUid!,
    sopInstanceUid:member.metadata.sopInstanceUid!,
    frameIndex:0 as const,
    slicePositionMm:member.metadata.imagePositionPatient?
      // This field is a coordinate, NOT the slice-plane projection; physical
      // position is deliberately omitted here until the validated planner
      // exposes all slice normals for the exhaustive volume.
      null:null,
  }));
  if(new Set(sourceFrames.map(f=>f.fileId)).size!==sourceFrames.length)
    throw Error("Duplicate local DICOM file ID");
  const batches=createVisionBatches(budget,4);
  return {budget,sourceFrames,batches,transmissionPermitted:false};
}
/** Each yield is locally OCR-scanned and raster-redacted, but NOT reviewed.
 * A caller must check every outgoing PNG and obtain physician permission
 * before any subsequent provider request. No batches are silently skipped.
 */
export async function* prepareOriginalVolumeBatches(
  series:DicomSeries,
  fileById:ReadonlyMap<string,File>,
  options:PrepareOptions,
):AsyncGenerator<VolumePreparedBatch>{
  const plan=planOriginalVolumeSource(series,options);
  const decode=options.decode??decodeDicomPreview;
  const prepare=options.prepare??autoPrepareVisionPrivacy;
  for(const [batchIndex,batch] of plan.batches.entries()){
    if(options.signal.aborted)throw new DOMException("Volume preparation cancelled","AbortError");
    const sources=batch.indices.map(i=>plan.sourceFrames[i]);
    const previews:string[]=[];
    for(const source of sources){
      if(options.signal.aborted)throw new DOMException("Volume preparation cancelled","AbortError");
      const file=fileById.get(source.fileId);
      if(!file||file.size<=0||file.size>6*1024*1024)
        throw Error("Missing/oversized original DICOM at frame "+(source.index+1));
      const result=await decode(file,{maxPixels:MAX_PRIVACY_PIXELS});
      if(!result.url.startsWith("data:image/png;base64,"))
        throw Error("Original DICOM decoder did not produce PNG");
      previews.push(result.url);
    }
    options.onProgress?.("Local OCR/redaction: "+(batchIndex+1)+"/"+plan.batches.length);
    const privacy=await prepare(previews,series.modality,options.signal,options.onProgress);
    if(privacy.frames.length!==sources.length||
       privacy.frames.some((f,i)=>f.frameId!=="frame-"+(i+1)||
         !privacy.ocr[f.frameId]||
         privacy.ocr[f.frameId].sha256!==f.sha256))
      throw Error("Source-bound local OCR batch incomplete");
    if(options.signal.aborted)throw new DOMException("Volume preparation cancelled","AbortError");
    yield {batchIndex,pass:batch.pass,indices:[...batch.indices],
      sources,privacy,transmissionPermitted:false,physicianReviewed:false};
  }
}
