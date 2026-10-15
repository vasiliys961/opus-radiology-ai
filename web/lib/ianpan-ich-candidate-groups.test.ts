import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseIchAlternativeReport} from "./ianpan-ich-report.ts";
import {groupIchResearchCandidateRegions} from "./ianpan-ich-candidate-groups.ts";

function realReport(){
 return parseIchAlternativeReport(readFileSync(
   new URL("../public/examples/ianpan-ich-real-figshare-run-38734338486.json",import.meta.url),
   "utf8"
 ));
}
test("real 14 slice-class proposals are ONE research region, not 14 hematomas",()=>{
 const result=groupIchResearchCandidateRegions(realReport());
 assert.equal(result.groups.length,1);
 const group=result.groups[0];
 assert.equal(group.candidateClass,"intraparenchymal");
 assert.equal(group.firstModelSliceZeroBased,9);
 assert.equal(group.lastModelSliceZeroBased,15);
 assert.equal(group.modelSlicesWithRegions,7);
 assert.equal(group.peakRawUncalibratedScore,0.975249);
 assert.equal(result.anyCategoryDuplicatesSuppressed,7);
 assert.equal(result.unlocalizedClassifierEntries,0);
 assert.ok(group.nativeNiftiBoundingEnvelopeXYZ);
 assert.equal(group.projectionClinicallyVerified,false);
 assert.equal(group.actualLesionOrHematomaCountEstablished,false);
 assert.equal(group.hemorrhageVolumeMl,null);
 assert.equal(result.interpretedAsClinicalDiagnosis,false);
});
test("spatially separated source boxes are NEVER joined just because class and slice are adjacent",()=>{
 const r=realReport();
 const modified={...r,candidates:r.candidates.map(c=>
   c.class==="intraparenchymal"&&c.sliceIndexModelOrdered===12?
   {...c,modelInputBoundingBoxXY:[380,380,405,405] as [number,number,number,number]}:c
 )};
 const grouped=groupIchResearchCandidateRegions(modified);
 assert.equal(grouped.groups.filter(g=>g.candidateClass==="intraparenchymal").length,3);
 assert.ok(grouped.groups.every(g=>!g.actualLesionOrHematomaCountEstablished));
});
test("missing native voxel geometry can never be invented by grouping",()=>{
 const r=realReport();
 const modified={...r,candidates:r.candidates.map(c=>
   c.class==="intraparenchymal"&&c.sliceIndexModelOrdered===12?
   {...c,sourceVoxelProjection:undefined}:c
 )};
 const grouped=groupIchResearchCandidateRegions(modified);
 assert.equal(grouped.groups.length,1);
 assert.equal(grouped.groups[0].nativeNiftiBoundingEnvelopeXYZ,null);
});
test("reject forged diagnostic truth-status flags",()=>{
 const r=realReport();
 assert.throws(()=>groupIchResearchCandidateRegions({...r,readyForClinicalUse:true as never}),
    /research_only/);
});
