/**
 * Private clinical review navigation: connect a cloud-reported ephemeral
 * frame-N back to the original DICOM FILE ID only in the active browser.
 * Never send this mapping, original UIDs, masks, clinical text or study bytes
 * to a server or provider. SHA here protects mapping integrity, not identity.
 */
import type {SanitizedModelReview} from "./sanitized-cloud-review.ts";

export type LocalReviewedFrame={
  imageId:string;
  reviewedPixelSha256:string;
};
const HASH=/^[0-9a-f]{64}$/;
const FRAME=/^frame-[1-4]$/;
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9._:+/-]{0,159}$/;

export function bindLocalSanitizedReview(
  review:SanitizedModelReview,
  exactLocalFrames:readonly LocalReviewedFrame[],
  originalLocalFileIds:readonly string[],
):ReadonlyMap<string,string>{
  if(review.schema!=="opus-sanitized-cloud-pilot/v1"||
     review.originalDicomSent!==false||
     review.sourceDicomIdentifiersSent!==false||
     review.deidentificationIndependentlyCertified!==false||
     review.coverage!=="sampled-frames-only"||
     !Array.isArray(review.sourceFrames)||!Array.isArray(review.results)||
     review.results.length!==2||
     review.results[0]?.reviewer!=="gemini"||
     review.results[1]?.reviewer!=="opus"||
     !Array.isArray(exactLocalFrames)||exactLocalFrames.length<1||
     exactLocalFrames.length>4||originalLocalFileIds.length!==exactLocalFrames.length||
     review.sourceFrames.length!==exactLocalFrames.length)
    throw Error("review_not_bound_to_local_sampled_DICOM");
  const imageIds=new Set<string>(),fileIds=new Set<string>();
  const mapping=new Map<string,string>();
  for(let i=0;i<exactLocalFrames.length;i++){
    const local=exactLocalFrames[i],remote=review.sourceFrames[i];
    const file=originalLocalFileIds[i];
    if(!local||!remote||!FRAME.test(local.imageId)||local.imageId!==("frame-"+(i+1))||
       imageIds.has(local.imageId)||
       !HASH.test(local.reviewedPixelSha256)||
       remote.imageId!==local.imageId||
       remote.reviewedPixelSha256!==local.reviewedPixelSha256||
       typeof file!=="string"||!file||file.length>300||fileIds.has(file))
      throw Error("different_or_changed_local_source_frame");
    imageIds.add(local.imageId);fileIds.add(file);mapping.set(local.imageId,file);
  }
  for(const output of review.results){
    const frames=output.review.reviewedImageIds;
    if(!Array.isArray(frames)||frames.length===0||frames.length>4||
       frames.some(id=>!imageIds.has(id)))
      throw Error("vision_reviewed_unknown_or_absent_source");
    const ids=new Set<string>();
    for(const observation of output.review.observations){
      if(!observation||typeof observation.imageId!=="string"||
         !imageIds.has(observation.imageId)||
         !frames.includes(observation.imageId)||
         typeof observation.id!=="string"||!NAME.test(observation.id)||
         ids.has(observation.id))
        throw Error("model_finding_not_bound_to_reviewed_image");
      ids.add(observation.id);
    }
  }
  return mapping;
}

/** Never emits the private file ID to network; returns only for local navigation. */
export function sourceFileForObservation(
  review:SanitizedModelReview,
  exactLocalFrames:readonly LocalReviewedFrame[],
  originalLocalFileIds:readonly string[],
  imageId:string,
):string{
  const mapping=bindLocalSanitizedReview(review,exactLocalFrames,originalLocalFileIds);
  const file=mapping.get(imageId);
  if(!file)throw Error("model_observation_outside_local_sampled_source");
  return file;
}

/** Per-frame raw counts, not a false "agreement" or joint diagnosis. */
export function perFrameModelCoverage(review:SanitizedModelReview){
  const ids=review.sourceFrames.map(x=>x.imageId);
  if(ids.length<1||ids.length>4||new Set(ids).size!==ids.length||
     review.results.length!==2)
    throw Error("invalid_model_comparison_coverage");
  return ids.map(imageId=>({
    imageId,
    geminiFindings:review.results[0].review.observations.filter(o=>o.imageId===imageId).length,
    opusFindings:review.results[1].review.observations.filter(o=>o.imageId===imageId).length,
    clinicalAgreementEstablished:false as const,
  }));
}
