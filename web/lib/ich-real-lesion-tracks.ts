/**
 * Research-only contiguous source-space candidate tracks from a REAL
 * pretrained ICH classifier/localizer. A track is a hypothesis requiring
 * independent hemorrhage reference; NEVER a clinical lesion, 3D segmentation,
 * hematoma volume, Dice, or number of diagnosed hemorrhages.
 *
 * The network emits one bounding region per subtype/slice. Different "any"
 * and subtype predictions must not be counted as two distinct lesions.
 */
import type {IchAlternativeCandidate,IchAlternativeClass,IchAlternativeReport} from "./ianpan-ich-report";

export type IchCandidateTrack={
  trackId:string;
  subtype:Exclude<IchAlternativeClass,"any">;
  sourceVoxelBoundingEnvelopeXYZ:[number,number,number,number,number,number];
  modelSliceIndices:number[];
  sourceSliceIndices:number[];
  researchScoreMax:number;
  researchScoreMean:number;
  candidatesGrouped:number;
  modelHeatmapPositivePixelObservations:number;
  originalHemorrhageMaskMatched:false;
  clinicalLesionConfirmed:false;
  measuredHematomaVolumeMl:null;
  diagnosticSensitivity:null;
};

type SourceBound=NonNullable<IchAlternativeCandidate["sourceVoxelProjection"]>;
type SourceCandidate=IchAlternativeCandidate & {sourceVoxelProjection:SourceBound};
type Acc={label:Exclude<IchAlternativeClass,"any">;candidates:SourceCandidate[]};

function boxesOverlapXY(a:SourceBound,b:SourceBound):boolean{
  const A=a.boundingBoxNativeNiftiXYZ,B=b.boundingBoxNativeNiftiXYZ;
  // A one-pixel margin only tolerates quantized boundaries. Do not combine
  // spatially distant spots merely because their subtype is the same.
  return Math.max(A[0],B[0])<=Math.min(A[3],B[3])+1 &&
    Math.max(A[1],B[1])<=Math.min(A[4],B[4])+1;
}
function sourceBound(c:IchAlternativeCandidate):c is SourceCandidate{
  return !!c.sourceVoxelProjection&&
    c.sourceVoxelProjection.independentlyClinicallyVerified===false&&
    c.sourceVoxelProjection.expertMaskCompared===false;
}
export function groupIchResearchSourceCandidates(report:IchAlternativeReport):{
  tracks:IchCandidateTrack[];
  unprojectedModelCandidates:number;
  broadAnyChannelCandidatesNotCountedAsSeparateLesions:number;
}{
  if(report.schema!=="opus-ianpan-genuine-public-ich-research/v1"||
    report.readyForClinicalUse!==false||
    report.modelInputHeatmapsAreSourceAligned!==false||
    report.source.researchRoiVoxelGeometryProjectionAvailable!==true||
    !Array.isArray(report.candidates)||report.candidates.length>384)
    throw Error("ICH исследовательская пространственная группировка недоступна.");
  const dims=report.source.sourceDimensionsXYZ;
  const selected=report.candidates.filter(sourceBound).filter(c=>c.class!=="any")
    .sort((a,b)=>a.sliceIndexModelOrdered-b.sliceIndexModelOrdered||
      a.class.localeCompare(b.class));
  const active:Acc[]=[];
  for(const c of selected){
    const roi=c.sourceVoxelProjection.boundingBoxNativeNiftiXYZ;
    if(!Array.isArray(roi)||roi.length!==6||
       roi.some((n,i)=>!Number.isSafeInteger(n)||n<0||n>=dims[i%3])||
       roi.slice(0,3).some((n,i)=>n>roi[i+3])||
       roi[2]!==roi[5])
      throw Error("Некорректная пространственная координата исследовательской находки.");
    // Slice correspondence: this is a native NIfTI index validated by the
    // source-geometry conversion, not a DICOM SOP instance index.
    const matching=active.filter(group=>{
      const last=group.candidates[group.candidates.length-1];
      if(last.class!==c.class||last.sliceIndexModelOrdered+1!==c.sliceIndexModelOrdered)
        return false;
      const previous=last.sourceVoxelProjection;
      const current=c.sourceVoxelProjection;
      return Math.abs(previous.boundingBoxNativeNiftiXYZ[2]-
        current.boundingBoxNativeNiftiXYZ[2])===1&&
        boxesOverlapXY(previous,current);
    });
    if(matching.length!==1){
      active.push({label:c.class as Exclude<IchAlternativeClass,"any">,candidates:[c]});
    }else{
      matching[0].candidates.push(c);
    }
  }
  const tracks=active.map(({label,candidates},idx):IchCandidateTrack=>{
    const z=candidates.map(c=>c.sourceVoxelProjection.boundingBoxNativeNiftiXYZ);
    const indices=candidates.map(c=>c.sliceIndexModelOrdered);
    const scores=candidates.map(c=>c.rawUncalibratedScore);
    return {
      trackId:label+"/"+String(idx+1),
      subtype:label,
      sourceVoxelBoundingEnvelopeXYZ:[
        Math.min(...z.map(x=>x[0])),Math.min(...z.map(x=>x[1])),Math.min(...z.map(x=>x[2])),
        Math.max(...z.map(x=>x[3])),Math.max(...z.map(x=>x[4])),Math.max(...z.map(x=>x[5])),
      ],
      modelSliceIndices:indices,
      sourceSliceIndices:z.map(x=>x[2]),
      researchScoreMax:Math.max(...scores),
      researchScoreMean:scores.reduce((a,b)=>a+b,0)/scores.length,
      candidatesGrouped:candidates.length,
      modelHeatmapPositivePixelObservations:candidates.reduce((a,c)=>a+c.heatmapPositivePixelsAtPoint5,0),
      originalHemorrhageMaskMatched:false,
      clinicalLesionConfirmed:false,
      measuredHematomaVolumeMl:null,
      diagnosticSensitivity:null,
    };
  }).sort((a,b)=>b.researchScoreMax-a.researchScoreMax);
  return {
    tracks,
    unprojectedModelCandidates:report.candidates.filter(c=>c.class!=="any"&&!sourceBound(c)).length,
    broadAnyChannelCandidatesNotCountedAsSeparateLesions:report.candidates.filter(c=>c.class==="any").length,
  };
}
