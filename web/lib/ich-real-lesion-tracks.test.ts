import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseIchAlternativeReport} from "./ianpan-ich-report.ts";
import {groupIchResearchSourceCandidates} from "./ich-real-lesion-tracks.ts";

const fixture=JSON.parse(readFileSync(
 new URL("../public/examples/ianpan-ich-real-figshare-run-38734338486.json",import.meta.url),"utf8"
));
const real=()=>parseIchAlternativeReport(JSON.stringify(fixture));

test("genuinely observed original hemorrhagic CT: 14 subtype/any proposals are ONE spatial candidate track across 7 slices",()=>{
 const report=real();
 const grouped=groupIchResearchSourceCandidates(report);
 assert.equal(report.source.niftiSha256,
  "0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95");
 assert.equal(report.seriesRawUncalibratedScores.intraparenchymal,.989428);
 assert.equal(report.seriesRawUncalibratedScores.any,.993365);
 assert.equal(report.candidates.length,14);
 assert.equal(grouped.broadAnyChannelCandidatesNotCountedAsSeparateLesions,7);
 assert.equal(grouped.tracks.length,1);
 const track=grouped.tracks[0];
 assert.equal(track.subtype,"intraparenchymal");
 assert.deepEqual(track.modelSliceIndices,[9,10,11,12,13,14,15]);
 assert.deepEqual(track.sourceSliceIndices,[9,10,11,12,13,14,15]);
 assert.deepEqual(track.sourceVoxelBoundingEnvelopeXYZ,[141,208,9,189,301,15]);
 assert.equal(track.researchScoreMax,.975249);
 assert.equal(track.modelHeatmapPositivePixelObservations,12605);
 assert.equal(track.candidatesGrouped,7);
 assert.equal(track.clinicalLesionConfirmed,false);
 assert.equal(track.measuredHematomaVolumeMl,null);
 assert.equal(track.diagnosticSensitivity,null);
 assert.equal(track.originalHemorrhageMaskMatched,false);
});
test("do not merge independent disjoint regions or nonadjacent model slices",()=>{
 const a=real();
 a.candidates=a.candidates.filter(c=>c.class==="intraparenchymal");
 const changed=a.candidates.map(c=>({...c,
    sourceVoxelProjection:c.sourceVoxelProjection&&({...c.sourceVoxelProjection,
      boundingBoxNativeNiftiXYZ:[...(c.sourceVoxelProjection.boundingBoxNativeNiftiXYZ)] as
       [number,number,number,number,number,number]})}));
 // Physically separate a single (middle) source region.
 const r=changed[3].sourceVoxelProjection!;
 r.boundingBoxNativeNiftiXYZ=[350,350,12,410,410,12];
 const outcome=groupIchResearchSourceCandidates({...a,candidates:changed});
 assert.equal(outcome.tracks.length,3);
 assert.equal(outcome.tracks.reduce((acc,t)=>acc+t.candidatesGrouped,0),7);
 const lost=changed[1];
 changed[1]={...lost,sourceVoxelProjection:null};
 const withMissing=groupIchResearchSourceCandidates({...a,candidates:changed});
 assert.ok(withMissing.unprojectedModelCandidates>=1);
});
test("reject attempted clinically confirmed source masks and impossible native bounding boxes",()=>{
 const r=real();
 assert.equal(groupIchResearchSourceCandidates(r).tracks[0].clinicalLesionConfirmed,false);
 const changed=r.candidates.map(c=>({...c}));
 changed[0]={...changed[0],sourceVoxelProjection:{
   ...changed[0].sourceVoxelProjection!,boundingBoxNativeNiftiXYZ:[143,227,9,999,275,9],
 }};
 assert.throws(()=>groupIchResearchSourceCandidates({...r,candidates:changed}),/Некорректная/);
 assert.throws(()=>groupIchResearchSourceCandidates({...r,readyForClinicalUse:true as never}),/недоступна/);
});
