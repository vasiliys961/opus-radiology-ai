/**
 * Research navigation ONLY: hypothesize that MONAI "world" millimetres from
 * the pinned LUNA16 bundle are in the original MetaImage physical frame.
 * Upstream inference uses affine_lps_to_ras=true but independent registration
 * and visual verification have NOT been completed. Never call these verified
 * source voxel coordinates, DICOM LPS, or true-positive lesion locations.
 */
export type MetaImageGeometry = {
  dimensions:number[];
  spacingMm:number[];
  origin:number[];
  directionMatrix:number[][];
};
export type MonaiCandidate = {
  candidateIndex:number;
  centerMonaiWorldMm:number[];
  extentMm:number[];
  rawClassificationScore:number;
  coordinateFrameVerifiedAgainstSource:false;
};
export type CandidateProjectionHypothesis = {
  candidateIndex:number;
  nativeVoxelIndexHypothesis:[number,number,number];
  sourceSliceIndexHypothesis:number;
  rawUncalibratedScore:number;
  alignment:"unverified_monai_world_equals_metaimage_physical_hypothesis";
  sourceFrameIndependentlyVerified:false;
  dicomBound:false;
  truePositiveEstablished:false;
};
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
const triple=(v:unknown,label:string):[number,number,number]=>{
  if(!Array.isArray(v)||v.length!==3||!v.every(finite))throw Error("invalid_"+label);
  return [v[0],v[1],v[2]];
};
function geometryChecked(g:MetaImageGeometry){
  if(!g||!Array.isArray(g.dimensions)||g.dimensions.length!==3||
     g.dimensions.some(n=>!Number.isSafeInteger(n)||n<2||n>1024))
    throw Error("invalid_source_dimensions");
  const spacing=triple(g.spacingMm,"source_spacing");
  if(spacing.some(s=>s<=0||s>20))throw Error("invalid_source_spacing");
  const origin=triple(g.origin,"source_origin");
  if(!Array.isArray(g.directionMatrix)||g.directionMatrix.length!==3)
    throw Error("invalid_source_orientation");
  const matrix=g.directionMatrix.map(row=>triple(row,"source_orientation"));
  for(let a=0;a<3;a++)for(let b=a;b<3;b++){
    const dot=matrix.reduce((v,row)=>v+row[a]*row[b],0);
    if(Math.abs(dot-(a===b?1:0))>1e-4)throw Error("nonorthonormal_source_orientation");
  }
  return {spacing,origin,matrix};
}
/** Returns null when a proposed center is outside the original public scan.
 * Does NOT permit physical-frame hypotheses for arbitrary imported patient CT.
 */
export function projectMonaiCandidateHypothesis(
  g:MetaImageGeometry,c:MonaiCandidate
):CandidateProjectionHypothesis|null{
  const {spacing,origin,matrix}=geometryChecked(g);
  if(!c||!Number.isSafeInteger(c.candidateIndex)||c.candidateIndex<0||
     c.coordinateFrameVerifiedAgainstSource!==false||
     !finite(c.rawClassificationScore)||c.rawClassificationScore<0||c.rawClassificationScore>1)
    throw Error("invalid_unverified_monai_candidate");
  const center=triple(c.centerMonaiWorldMm,"candidate_center");
  const extent=triple(c.extentMm,"candidate_extent");
  if(extent.some(x=>x<=0||x>1000))throw Error("invalid_candidate_extent");
  const delta=center.map((v,i)=>v-origin[i]);
  const index=[0,1,2].map(col=>
    matrix.reduce((sum,row,r)=>sum+row[col]*delta[r],0)/spacing[col]
  ) as [number,number,number];
  if(index.some((v,i)=>v<0||v>g.dimensions[i]-1))return null;
  return {
    candidateIndex:c.candidateIndex,
    nativeVoxelIndexHypothesis:index,
    sourceSliceIndexHypothesis:Math.round(index[2]),
    rawUncalibratedScore:c.rawClassificationScore,
    alignment:"unverified_monai_world_equals_metaimage_physical_hypothesis",
    sourceFrameIndependentlyVerified:false,dicomBound:false,truePositiveEstablished:false,
  };
}

/** Bounded 3D WORLD-axis-aligned model proposal projected to native MetaImage.
 *
 * Project all eight world-space corners and compute the source-axis-aligned
 * envelope. On tilted scans this is an envelope, NOT the true 3D intersection
 * polygon or physician-measured lesion dimensions. For the pinned one-case
 * LUNA16 example source world LPS is audited separately by its evidence gate.
 */
export type CandidateModelBoxProjection={
  candidateIndex:number;
  nativeVoxelBoundingEnvelopeXYZ:[number,number,number,number,number,number];
  sourceSliceIndexRangeInclusive:[number,number];
  truncatedBySourceVolume:boolean;
  geometry:"model_world_mm_axis_aligned_cuboid_to_native_metaimage_envelope";
  clinicalLesionSegmentation:false;
  independentlyConfirmedTumorVolume:false;
};
export function projectMonaiCandidateBoundingBox(
 g:MetaImageGeometry,c:MonaiCandidate
):CandidateModelBoxProjection|null{
 const centerResult=projectMonaiCandidateHypothesis(g,c);
 if(centerResult===null)return null;
 const {spacing,origin,matrix}=geometryChecked(g);
 const half=triple(c.extentMm,"candidate_extent").map(v=>v/2);
 const center=triple(c.centerMonaiWorldMm,"candidate_center");
 const points:number[][]=[];
 for(const a of [-1,1])for(const b of [-1,1])for(const d of [-1,1]){
   const world=[
     center[0]+a*half[0],
     center[1]+b*half[1],
     center[2]+d*half[2],
   ];
   const delta=world.map((v,i)=>v-origin[i]);
   points.push([0,1,2].map(col=>
     matrix.reduce((sum,row,r)=>sum+row[col]*delta[r],0)/spacing[col]
   ));
 }
 const low=[0,1,2].map(j=>Math.min(...points.map(p=>p[j])));
 const high=[0,1,2].map(j=>Math.max(...points.map(p=>p[j])));
 if(low.some((v,i)=>v>g.dimensions[i]-1)||
    high.some(v=>v<0))return null;
 const clippedLow=low.map(v=>Math.max(0,v));
 const clippedHigh=high.map((v,i)=>Math.min(g.dimensions[i]-1,v));
 const sliceMin=Math.max(0,Math.ceil(clippedLow[2]-.5));
 const sliceMax=Math.min(g.dimensions[2]-1,Math.floor(clippedHigh[2]+.5));
 if(sliceMin>sliceMax)return null;
 return {
   candidateIndex:c.candidateIndex,
   nativeVoxelBoundingEnvelopeXYZ:[
     clippedLow[0],clippedLow[1],clippedLow[2],
     clippedHigh[0],clippedHigh[1],clippedHigh[2],
   ],
   sourceSliceIndexRangeInclusive:[sliceMin,sliceMax],
   truncatedBySourceVolume:low.some(v=>v<0)||
     high.some((v,i)=>v>g.dimensions[i]-1),
   geometry:"model_world_mm_axis_aligned_cuboid_to_native_metaimage_envelope",
   clinicalLesionSegmentation:false,
   independentlyConfirmedTumorVolume:false,
 };
}
