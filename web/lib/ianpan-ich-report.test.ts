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

test("admitted geometry-only source ROI remains explicitly unvalidated",()=>{
 const r=sample();
 const projection={
  boundingBoxNativeNiftiXYZ:[125,130,12,128,133,12],
  boundingBoxWorldRasMm:[110,124,-26,112.4,126.4,-26],
  projectionMethod:"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1",
  trimmedOutsideOriginalCT:false,independentlyClinicallyVerified:false,
  expertMaskCompared:false
 };
 const mapped={
  ...r,
  source:{...r.source,researchRoiVoxelGeometryProjectionAvailable:true,
   researchRoiClinicalValidation:false},
  candidates:[{...r.candidates[0],sourceVoxelProjection:projection}],
 };
 const result=parseIchAlternativeReport(JSON.stringify(mapped));
 assert.deepEqual(result.candidates[0].sourceVoxelProjection?.boundingBoxNativeNiftiXYZ,
  [125,130,12,128,133,12]);
 assert.equal(result.source.researchRoiClinicalValidation,false);
 assert.throws(()=>parseIchAlternativeReport(JSON.stringify({
  ...mapped,candidates:[{...mapped.candidates[0],sourceVoxelProjection:{
   ...projection,independentlyClinicallyVerified:true
  }}]
 })),/статус проекции/);
 assert.throws(()=>parseIchAlternativeReport(JSON.stringify({
  ...mapped,candidates:[{...mapped.candidates[0],sourceVoxelProjection:{
   ...projection,boundingBoxNativeNiftiXYZ:[125,130,12,513,133,12]
  }}]
 })),/границы проекции/);
 assert.throws(()=>parseIchAlternativeReport(JSON.stringify({
  ...mapped,source:{...r.source}
 })),/источника для/);
});

test("actual authenticated 2026 public CT model run retains 14 hemorrhage proposals without diagnosing",async()=>{
 const {readFileSync}=await import("node:fs");
 const raw=readFileSync(new URL("../public/examples/ich-ianpan-real-figshare-run-38733865982.json",import.meta.url),"utf8");
 const report=parseIchAlternativeReport(raw);
 assert.equal(report.model.id,"ianpan/ct-head-hemorrhage-detection");
 assert.equal(report.source.niftiSha256,"0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95");
 assert.deepEqual(report.source.sourceDimensionsXYZ,[512,512,25]);
 assert.equal(report.source.modelOrderedSliceCount,25);
 assert.equal(report.seriesRawUncalibratedScores.intraparenchymal,0.989428);
 assert.equal(report.seriesRawUncalibratedScores.any,0.993365);
 assert.equal(report.candidates.length,14);
 assert.deepEqual([...new Set(report.candidates.map(c=>c.sliceIndexModelOrdered))],[9,10,11,12,13,14,15]);
 assert.equal(report.candidates[0].class,"intraparenchymal");
 assert.equal(report.candidates[0].rawUncalibratedScore,0.967383);
 assert.deepEqual(report.candidates[0].sourceVoxelProjection?.boundingBoxNativeNiftiXYZ,[143,227,9,177,275,9]);
 assert.equal(report.modelInputHeatmapsAreSourceAligned,false);
 assert.equal(report.negativeDiagnosticConclusionAllowed,false);
 assert.equal(report.readyForClinicalUse,false);
 assert.equal(report.dice,null);
 assert.equal(report.sensitivity,null);
});
