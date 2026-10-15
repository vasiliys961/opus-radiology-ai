import test from "node:test";
import assert from "node:assert/strict";
import {parseIchAlternativeReport,ICH_CLASSES} from "./ianpan-ich-report.ts";
const s="a".repeat(64);
function sample(){
 return {
 schema:"opus-ianpan-genuine-public-ich-research/v1",
 status:"genuine_pretrained_inference_requires_independent_validation",
 model:{id:"ianpan/ct-head-hemorrhage-detection",revision:"e6d89c2",
  checkpointSha256Verified:true,sha256ByArtifact:{
   "inference.py":"9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb"}},
 source:{niftiSha256:s,sourceDimensionsXYZ:[512,512,34],modelOrderedSliceCount:34,
  publicRightsOperatorAttested:true,huProvenanceOperatorAttestedNotIndependentlyConfirmed:true,
  modelPixelsNotRegisteredToSource:true},
 runtime:{executionDevice:"cpu",elapsedSeconds:35},
 seriesRawUncalibratedScores:Object.fromEntries(ICH_CLASSES.map(k=>[k,0.1])),
 candidates:[{sliceIndexModelOrdered:12,class:"subarachnoid",rawUncalibratedScore:0.91,
  heatmapPositivePixelsAtPoint5:28,modelInputBoundingBoxXY:[10,20,30,40],
  localizationFrame:"preprocessed_512_model_input_not_source_voxel",clinicallyConfirmed:false}],
 thresholdForResearchListing:0.5,diagnosticInterpretation:"research_candidates_only",
 modelInputHeatmapsAreSourceAligned:false,
 sensitivity:null,specificity:null,dice:null,
 negativeDiagnosticConclusionAllowed:false,readyForClinicalUse:false
 };
}
const parse=(r:ReturnType<typeof sample>)=>parseIchAlternativeReport(JSON.stringify(r));
test("accepts research-only six-label classifier data, preserves no-diagnosis status",()=>{
 const r=parse(sample());
 assert.equal(r.candidates[0].class,"subarachnoid");
 assert.equal(r.candidates[0].modelInputBoundingBoxXY?.[2],30);
 assert.equal(r.modelInputHeatmapsAreSourceAligned,false);
 assert.equal(r.negativeDiagnosticConclusionAllowed,false);
 assert.equal(r.readyForClinicalUse,false);
 assert.equal(r.dice,null);
});
test("zero candidates cannot become a normal CT conclusion",()=>{
 const r=sample();r.candidates=[];
 assert.equal(parse(r).negativeDiagnosticConclusionAllowed,false);
});
test("rejects forged clinical and frame claims, invalid boxes, duplicate and NaN scores",()=>{
 const r=sample();
 assert.throws(()=>parse({...r,readyForClinicalUse:true} as never),/статус/);
 assert.throws(()=>parse({...r,modelInputHeatmapsAreSourceAligned:true} as never),/статус/);
 assert.throws(()=>parse({...r,negativeDiagnosticConclusionAllowed:true} as never),/статус/);
 assert.throws(()=>parse({...r,candidates:[r.candidates[0],r.candidates[0]]}),/Повтор/);
 assert.throws(()=>parse({...r,candidates:[{...r.candidates[0],modelInputBoundingBoxXY:[511,20,30,40]}]}),/область/);
 assert.throws(()=>parse({...r,candidates:[{...r.candidates[0],heatmapPositivePixelsAtPoint5:0}]}),/область/);
 assert.throws(()=>parse({...r,candidates:[{...r.candidates[0],rawUncalibratedScore:0.2}]}),/находка/);
 assert.throws(()=>parse({...r,seriesRawUncalibratedScores:{...r.seriesRawUncalibratedScores,any:2}}),/оценок/);
});
test("refuses unlimited files, unexpected origins and invalid model hash",()=>{
 assert.throws(()=>parseIchAlternativeReport("x".repeat(2*1024*1024+1)),/2 МиБ/);
 const r=sample();
 assert.throws(()=>parse({...r,model:{...r.model,revision:"main"}}),/статус/);
 assert.throws(()=>parse({...r,source:{...r.source,niftiSha256:"invalid"}}),/статус/);
 assert.throws(()=>parse({...r,model:{...r.model,sha256ByArtifact:{"inference.py":s}}}),/статус/);
});
