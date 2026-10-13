import type {IchResearchReport} from "./ich-research";
import type {IchReferenceComparison} from "./ich-reference-comparison";

export type IchSliceEvidenceRow={
  nativeSliceIndex:number;predictedVoxels:number;expertVoxels:number;
  overlapVoxels:number;falseNegativeVoxels:number;falsePositiveVoxels:number;
  sliceDice:number|null;
};
export type IchSliceEvidence={
  schema:"opus-ich-native-slice-evidence/v1";
  status:"verified_public_mask_pair_slice_review_not_diagnostic_validation";
  comparisonSchema:"opus-ich-public-expert-mask-comparison/v1";
  evidenceHashes:IchReferenceComparison["evidenceHashes"];
  modelId:"samihs-ich-binary-ct";referenceLabel:number;
  caseCount:1;clinicalValidation:false;limitations:string[];
  sliceAudit:{
    sourceBoundSliceAxis:number;totalSourceSlices:number;
    expertPositiveSlices:number;modelCandidateSlices:number;
    expertPositiveSlicesWithVoxelOverlap:number;
    expertPositiveSlicesWithoutOverlap:number[];
    modelOnlyCandidateSlices:number[];
    sliceEvidence:IchSliceEvidenceRow[];
    clinicalSliceSensitivity:null;originalDicomSopMapped:false;
  };
};
const object=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=="object"||Array.isArray(v))
    throw Error("Некорректный формат срезового отчёта.");
  return v as Record<string,unknown>;
};
const integer=(n:unknown):n is number=>
  typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
const sameArray=(v:unknown,expected:number[])=>Array.isArray(v)&&
  v.length===expected.length&&v.every((x,i)=>x===expected[i]);
export function parseIchSliceEvidence(
  raw:string,comparison:IchReferenceComparison,model:IchResearchReport
):IchSliceEvidence{
  if(raw.length>2*1024*1024)throw Error("Срезовый отчёт превышает 2 МиБ.");
  const root=object(JSON.parse(raw)),h=object(root.evidenceHashes),a=object(root.sliceAudit);
  const hashes=comparison.evidenceHashes;
  if(root.schema!=="opus-ich-native-slice-evidence/v1"||
    root.status!=="verified_public_mask_pair_slice_review_not_diagnostic_validation"||
    root.comparisonSchema!==comparison.schema||
    root.modelId!==comparison.modelId||root.referenceLabel!==comparison.referenceLabel||
    root.caseCount!==1||root.clinicalValidation!==false||
    h.sourceSha256!==hashes.sourceSha256||
    h.predictionSha256!==hashes.predictionSha256||
    h.expertMaskSha256!==hashes.expertMaskSha256||
    a.clinicalSliceSensitivity!==null||a.originalDicomSopMapped!==false||
    !Array.isArray(root.limitations)||root.limitations.length===0||
    root.limitations.some(x=>typeof x!=="string"||x.length>1000))
    throw Error("Срезовый отчёт не связан с текущей КТ, SAMIHS или экспертной маской.");
  const axis=model.source.geometry.sliceAxis;
  const dimension=model.source.geometry.dimensions[axis];
  if(a.sourceBoundSliceAxis!==axis||a.totalSourceSlices!==dimension||
    !Array.isArray(a.sliceEvidence)||a.sliceEvidence.length!==dimension||
    !integer(a.expertPositiveSlices)||!integer(a.modelCandidateSlices)||
    !integer(a.expertPositiveSlicesWithVoxelOverlap))
    throw Error("Ось или число срезов не соответствуют исходной КТ.");
  let tp=0,fp=0,fn=0,ep=0,mp=0,hits=0;
  const missed:number[]=[],modelOnly:number[]=[];
  for(let i=0;i<dimension;i++){
    const row=object(a.sliceEvidence[i]);
    const p=row.predictedVoxels,e=row.expertVoxels,t=row.overlapVoxels;
    if(row.nativeSliceIndex!==i||!integer(p)||!integer(e)||!integer(t)||
      t>Math.min(p,e)||row.falseNegativeVoxels!==e-t||
      row.falsePositiveVoxels!==p-t)
      throw Error("Срезовый отчёт содержит несогласованную маску.");
    const dice=p+e?2*t/(p+e):null;
    if(dice===null?row.sliceDice!==null:
      typeof row.sliceDice!=="number"||!Number.isFinite(row.sliceDice)||
      Math.abs(row.sliceDice-dice)>1e-7)
      throw Error("Недостоверный Dice на срезе.");
    tp+=t;fp+=p-t;fn+=e-t;
    if(e){ep++;if(t)hits++;else missed.push(i);}
    if(p)mp++;
    if(p&&!e)modelOnly.push(i);
  }
  if(tp!==comparison.metrics.truePositiveVoxels||
    fp!==comparison.metrics.falsePositiveVoxels||
    fn!==comparison.metrics.falseNegativeVoxels||
    a.expertPositiveSlices!==ep||a.modelCandidateSlices!==mp||
    a.expertPositiveSlicesWithVoxelOverlap!==hits||
    !sameArray(a.expertPositiveSlicesWithoutOverlap,missed)||
    !sameArray(a.modelOnlyCandidateSlices,modelOnly))
    throw Error("Срезовые результаты противоречат 3D-метрикам экспертной маски.");
  return root as IchSliceEvidence;
}
