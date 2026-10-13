import test from "node:test";
import assert from "node:assert/strict";
import {parseIchComponentEvidence} from "./ich-component-evidence.ts";
import type {IchReferenceComparison} from "./ich-reference-comparison";
import type {IchResearchReport} from "./ich-research";

const hash=(v:string)=>v.repeat(64);
const comparison={
 schema:"opus-ich-public-expert-mask-comparison/v1",modelId:"samihs-ich-binary-ct",
 referenceLabel:1,evidenceHashes:{sourceSha256:hash("a"),predictionSha256:hash("b"),
 expertMaskSha256:hash("c")},
 metrics:{truePositiveVoxels:2,falsePositiveVoxels:4,falseNegativeVoxels:14}
} as unknown as IchReferenceComparison;
const model={source:{geometry:{dimensions:[12,12,6],voxelVolumeMl:.002}}} as IchResearchReport;
const frag=(i:number,n:number,lo:number[],hi:number[],overlap:number,peers:number[])=>({
 componentIndex:i,voxelCount:n,volumeMl:n*.002,
 boundsVoxelMin:lo,boundsVoxelMax:hi,otherMaskComponentIndices:peers,
 overlapVoxels:overlap,componentOverlapFraction:overlap/n,
 hasAnyVoxelOverlap:overlap>0,ambiguousMultiComponentContact:peers.length>1
});
function document(){
 return {
 schema:"opus-ich-expert-component-contact/v1",
 status:"single_authorized_mask_pair_component_overlap_not_lesion_detection_validation",
 comparisonSchema:comparison.schema,evidenceHashes:comparison.evidenceHashes,
 modelId:comparison.modelId,referenceLabel:1,sourceNativeIndexGridMatch:true,
 caseCount:1,clinicalValidation:false,limitations:["Research only"],
 componentEvidence:{
  connectivity:"6_neighbor_index_space",allComponentsCounted:true,
  reportedLargestPerMaskLimit:128,expertFragmentsTotal:2,predictedFragmentsTotal:2,
  expertFragmentsWithAnyVoxelOverlap:2,expertFragmentsWithZeroOverlap:0,
  predictedFragmentsWithZeroOverlap:1,expertFragmentsContactingMultiplePredictions:0,
  predictedFragmentsContactingMultipleExpertFragments:1,
  largestExpertFragments:[
   frag(0,8,[1,1,1],[2,2,2],1,[0]),
   frag(1,8,[6,1,1],[7,2,2],1,[0])
  ],
  largestPredictedFragments:[
   frag(0,5,[2,1,1],[6,1,1],2,[0,1]),
   frag(1,1,[10,10,4],[10,10,4],0,[])
  ],
  clinicalLesionSensitivity:null,clinicalFalsePositivesPerScan:null,
  hemorrhageSubtypesDetermined:false
 }
 };
}
test("accepts real-compatible source-bound 3D component contacts",()=>{
 const v=parseIchComponentEvidence(JSON.stringify(document()),comparison,model);
 assert.equal(v.componentEvidence.expertFragmentsWithAnyVoxelOverlap,2);
 assert.equal(v.componentEvidence.predictedFragmentsContactingMultipleExpertFragments,1);
 assert.equal(v.clinicalValidation,false);
});
test("refuses wrong model/ref SHA, false lesion claims, altered 3D voxel counts",()=>{
 const base=document();
 const edits=[
  {...base,evidenceHashes:{...base.evidenceHashes,expertMaskSha256:hash("d")}},
  {...base,componentEvidence:{...base.componentEvidence,clinicalLesionSensitivity:0.8}},
  {...base,componentEvidence:{...base.componentEvidence,predictedFragmentsTotal:3}},
  {...base,componentEvidence:{...base.componentEvidence,largestPredictedFragments:[
    {...base.componentEvidence.largestPredictedFragments[0],overlapVoxels:3},
    base.componentEvidence.largestPredictedFragments[1]
  ]}},
  {...base,componentEvidence:{...base.componentEvidence,largestExpertFragments:[
    {...base.componentEvidence.largestExpertFragments[0],boundsVoxelMax:[13,2,2]},
    base.componentEvidence.largestExpertFragments[1]
  ]}}
 ];
 for(const bad of edits)
  assert.throws(()=>parseIchComponentEvidence(JSON.stringify(bad),comparison,model));
});
