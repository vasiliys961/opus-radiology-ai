/** Frame-relative CLN localization after SAME-PUBLIC-NIfTI source verification.
 * No NIfTI voxel XYZ, original DICOM UID, SHA, filename, patient position or
 * absolute LPS/RAS coordinates are sent to cloud. Reviewed PNGs are supplied
 * through the separate physician-approved pixel gate.
 *
 * Centroid projection ≠ segmentation outline or verified visual match.
 */
export type ClnFrameRelativeAnchor={
 candidateId:number;
 frameId:string;
 xFraction:number;
 yFraction:number;
 axialSliceOffset:number;
 candidateVolumeMl:number;
};
export type ClnFrameRelativeEvidence={
 schema:"opus-cln-frame-relative-anchors/v1";
 task:"lung_tumor";
 alignment:"same-public-nifti-voxel-to-png";
 candidateAnchors:ClnFrameRelativeAnchor[];
 sourceVoxelCoordinatesSent:false;
 originalDicomIdentifiersSent:false;
 originalDicomSopRegistrationVerified:false;
 clinicalValidation:false;
 researchOnly:true;
};
const four=(n:number)=>Math.round(n*10000)/10000;
export function createClnFrameRelativeEvidence(input:{
 sourceImageSha256:string;
 detectorSourceImageSha256:string;
 imageDimensions:[number,number,number];
 nativeCandidates:readonly {componentId:number;sourceVoxelCentroidIJK:[number,number,number];candidateVolumeMl:number}[];
 reviewedFrames:readonly {frameId:string;sourceAxialIndex:number}[];
}):ClnFrameRelativeEvidence{
 const {sourceImageSha256,detectorSourceImageSha256,imageDimensions,nativeCandidates,reviewedFrames}=input;
 if(!/^[a-f0-9]{64}$/.test(sourceImageSha256)||sourceImageSha256!==detectorSourceImageSha256)
  throw Error("candidate_source_not_bound_to_reviewed_png_volume");
 if(imageDimensions.length!==3||!imageDimensions.every(n=>Number.isSafeInteger(n)&&n>20&&n<=4096))
  throw Error("invalid_native_volume_geometry");
 if(!Array.isArray(nativeCandidates)||!nativeCandidates.length||nativeCandidates.length>20||
    !Array.isArray(reviewedFrames)||!reviewedFrames.length||reviewedFrames.length>4||
    new Set(reviewedFrames.map(f=>f.frameId)).size!==reviewedFrames.length||
    reviewedFrames.some(f=>!/^frame-[1-4]$/.test(f.frameId)||
      !Number.isSafeInteger(f.sourceAxialIndex)||f.sourceAxialIndex<0||
      f.sourceAxialIndex>=imageDimensions[2]))
  throw Error("invalid_source_frame_mapping");
 const seen=new Set<number>();
 const anchors=nativeCandidates.map(c=>{
  if(!Number.isSafeInteger(c.componentId)||c.componentId<1||seen.has(c.componentId)||
     !Array.isArray(c.sourceVoxelCentroidIJK)||c.sourceVoxelCentroidIJK.length!==3||
     c.sourceVoxelCentroidIJK.some((v:number,i:number)=>!Number.isFinite(v)||v<0||v>imageDimensions[i]-1)||
     !Number.isFinite(c.candidateVolumeMl)||c.candidateVolumeMl<=0||c.candidateVolumeMl>100000)
    throw Error("invalid_original_cln_candidate_geometry");
  seen.add(c.componentId);
  const [x,y,z]=c.sourceVoxelCentroidIJK;
  const closest=[...reviewedFrames].sort((a,b)=>
   Math.abs(a.sourceAxialIndex-z)-Math.abs(b.sourceAxialIndex-z))[0];
  // PIL image is built by np.flipud(nativePlane.T):
  // native axis 0 -> PNG pixel X, native axis 1 -> inverted PNG pixel Y.
  const xFraction=four((x+.5)/imageDimensions[0]);
  const yFraction=four((imageDimensions[1]-y-.5)/imageDimensions[1]);
  const axialSliceOffset=four(z-closest.sourceAxialIndex);
  return {candidateId:c.componentId,frameId:closest.frameId,
    xFraction,yFraction,axialSliceOffset,candidateVolumeMl:four(c.candidateVolumeMl)};
 });
 const result:ClnFrameRelativeEvidence={
  schema:"opus-cln-frame-relative-anchors/v1",task:"lung_tumor",
  alignment:"same-public-nifti-voxel-to-png",candidateAnchors:anchors,
  sourceVoxelCoordinatesSent:false,originalDicomIdentifiersSent:false,
  originalDicomSopRegistrationVerified:false,clinicalValidation:false,researchOnly:true,
 };
 if(!validateClnFrameRelativeEvidence(result,reviewedFrames.map(f=>f.frameId)))
  throw Error("untrusted_cln_frame_relative_export");
 return result;
}
export function validateClnFrameRelativeEvidence(
 input:unknown,frameIds:readonly string[],
):input is ClnFrameRelativeEvidence{
 if(!input||typeof input!=="object"||Array.isArray(input))return false;
 const v=input as Partial<ClnFrameRelativeEvidence>;
 if(Object.keys(v).sort().join(",")!==["schema","task","alignment","candidateAnchors",
   "sourceVoxelCoordinatesSent","originalDicomIdentifiersSent",
   "originalDicomSopRegistrationVerified","clinicalValidation","researchOnly"].sort().join(",")||
   v.schema!=="opus-cln-frame-relative-anchors/v1"||v.task!=="lung_tumor"||
   v.alignment!=="same-public-nifti-voxel-to-png"||
   v.sourceVoxelCoordinatesSent!==false||v.originalDicomIdentifiersSent!==false||
   v.originalDicomSopRegistrationVerified!==false||v.clinicalValidation!==false||
   v.researchOnly!==true||!Array.isArray(v.candidateAnchors)||
   !v.candidateAnchors.length||v.candidateAnchors.length>20)return false;
 const seen=new Set<number>();
 return v.candidateAnchors.every(a=>{
  if(!a||typeof a!=="object"||Array.isArray(a)||
     Object.keys(a).sort().join(",")!==["candidateId","frameId","xFraction","yFraction",
       "axialSliceOffset","candidateVolumeMl"].sort().join(",")||
     !Number.isSafeInteger(a.candidateId)||a.candidateId<=0||seen.has(a.candidateId)||
     !frameIds.includes(a.frameId)||
     !Number.isFinite(a.xFraction)||a.xFraction<=0||a.xFraction>=1||
     !Number.isFinite(a.yFraction)||a.yFraction<=0||a.yFraction>=1||
     !Number.isFinite(a.axialSliceOffset)||Math.abs(a.axialSliceOffset)>4096||
     !Number.isFinite(a.candidateVolumeMl)||a.candidateVolumeMl<=0||a.candidateVolumeMl>100000)
    return false;
  seen.add(a.candidateId);return true;
 });
}
