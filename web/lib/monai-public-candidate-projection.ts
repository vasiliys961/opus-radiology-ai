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
