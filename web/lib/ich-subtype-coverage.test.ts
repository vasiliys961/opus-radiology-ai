import test from "node:test";
import assert from "node:assert/strict";
import {parseIchExpertSubtypeCoverage} from "./ich-subtype-coverage.ts";
import type {IchReferenceComparison} from "./ich-reference-comparison";
import type {IchResearchReport} from "./ich-research";

const sha=(x:string)=>x.repeat(64);
const comparison={
 evidenceHashes:{sourceSha256:sha("a"),predictionSha256:sha("b"),
   expertMaskSha256:sha("c")},
 metrics:{truePositiveVoxels:4,falseNegativeVoxels:12,falsePositiveVoxels:2}
} as IchReferenceComparison;
const model={source:{sha256:sha("a"),geometry:{voxelVolumeMl:.002}},
 prediction:{maskSha256:sha("b")}} as IchResearchReport;
function passport(){
 return {
 schema:"opus-ich-original-expert-subtype-coverage/v1",
 sourceOriginalMulticlassExpertRequired:true,modelSubtypeClassifierExecuted:false,
 clinicianReviewRequired:true,clinicalSubtypeSensitivity:null,
 evidenceHashes:{sourceSha256:sha("a"),predictionSha256:sha("b"),
  expertMaskSha256:sha("c"),originalExpertMaskSha256:sha("d"),ontologySha256:sha("e")},
 ontologySourceUrl:"https://example.org/authorized-original-ontology",
 expertVoxelClasses:[
  {sourceLabel:1,expertSubtype:"IPH",expertVoxels:8,expertVolumeMl:.016,
    modelOverlappingExpertVoxels:4,modelMissedExpertVoxels:4,
    voxelCoverageFraction:.5,modelPredictedSubtype:false},
  {sourceLabel:2,expertSubtype:"SAH",expertVoxels:8,expertVolumeMl:.016,
    modelOverlappingExpertVoxels:0,modelMissedExpertVoxels:8,
    voxelCoverageFraction:0,modelPredictedSubtype:false}
 ],
 totalExpertVoxels:16,totalOverlappingExpertVoxels:4,totalMissedExpertVoxels:12
 };
}
test("accepts source-bound IPH/SAH coverage without claiming model subtype",()=>{
 const a=parseIchExpertSubtypeCoverage(JSON.stringify(passport()),comparison,model);
 assert.equal(a.expertVoxelClasses[0].voxelCoverageFraction,.5);
 assert.equal(a.expertVoxelClasses[1].modelMissedExpertVoxels,8);
 assert.equal(a.modelSubtypeClassifierExecuted,false);
 assert.equal(a.clinicalSubtypeSensitivity,null);
});
test("rejects forged model classification, foreign source or wrong subtype false negatives",()=>{
 const p=passport();
 const samples=[
 {...p,modelSubtypeClassifierExecuted:true},
 {...p,evidenceHashes:{...p.evidenceHashes,originalExpertMaskSha256:"bad"}},
 {...p,evidenceHashes:{...p.evidenceHashes,expertMaskSha256:sha("f")}},
 {...p,expertVoxelClasses:[
  {...p.expertVoxelClasses[0],modelMissedExpertVoxels:3},
  p.expertVoxelClasses[1]]},
 {...p,expertVoxelClasses:[
  {...p.expertVoxelClasses[0],expertSubtype:"unknown"},
  p.expertVoxelClasses[1]]},
 {...p,totalMissedExpertVoxels:2},
 {...p,ontologySourceUrl:"http://example.org/ontology"}
 ];
 for(const bad of samples)
  assert.throws(()=>parseIchExpertSubtypeCoverage(JSON.stringify(bad),comparison,model));
});
test("empty reference class must have null coverage denominator",()=>{
 const p=passport();
 p.expertVoxelClasses.push({
  sourceLabel:3,expertSubtype:"SDH",expertVoxels:0,expertVolumeMl:0,
  modelOverlappingExpertVoxels:0,modelMissedExpertVoxels:0,
  voxelCoverageFraction:0,modelPredictedSubtype:false
 });
 assert.throws(()=>parseIchExpertSubtypeCoverage(JSON.stringify(p),comparison,model));
 p.expertVoxelClasses[2].voxelCoverageFraction=null as never;
 assert.equal(parseIchExpertSubtypeCoverage(JSON.stringify(p),comparison,model)
   .expertVoxelClasses[2].voxelCoverageFraction,null);
});
