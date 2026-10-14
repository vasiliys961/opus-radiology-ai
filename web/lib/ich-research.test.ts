import test from "node:test";
import assert from "node:assert/strict";
import {parseIchResearchReport,buildIchLocalReview} from "./ich-research.ts";
const sha=(letter:string)=>letter.repeat(64);
function specimen(){
 return {
  schema:"opus-ich-samihs-public-research/v1",
  researchStatus:"trained_upstream_adapter_executed_public_only",
  model:{id:"samihs-ich-binary-ct",origin:"MooreMuaMu/samihs-ich-segmentation",
    version:"user-audited-local-checkpoint",checkpointSha256:sha("a"),
    wrapperSha256:sha("b"),modelWeightsUsed:true},
  source:{format:"3d-nifti",sha256:sha("c"),fullVolumeProcessed:true,
    sourceDicomSopBound:false,patientData:false,
    geometry:{dimensions:[32,32,20],voxelVolumeMl:0.001,sliceAxis:2,
      affineRas:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}},
  prediction:{predictedPositiveVoxelCount:100,predictedMaskVolumeMl:0.1,
    connectedComponentsTotal:1,largestComponents:[{
      componentIndex:0,voxelCount:100,volumeMl:0.1,
      boundsVoxelMin:[1,2,3],boundsVoxelMax:[8,9,10],
      modelProbabilityCalibrated:false,clinicianVerified:false}],
    componentListTruncated:false,maskSha256:sha("d"),
    maskFormat:"3d-binary-nifti-uint8",thresholdUncalibrated:0.5,
    ichSubtype:null,negativeDiagnosisPermitted:false,
    detectionStatus:"candidates_from_binary_mask"},
  validation:{independentDice:null,sensitivity:null,specificity:null,
    externalCohortEvaluated:false,clinicalValidation:false,physicianReviewRequired:true}
 };
}
test("accepts bounded trained-model candidate and keeps clinical claims separate",()=>{
 const p=parseIchResearchReport(JSON.stringify(specimen()));
 assert.equal(p.prediction.predictedMaskVolumeMl,0.1);
 assert.equal(p.source.sourceDicomSopBound,false);
 assert.equal(p.validation.independentDice,null);
 const review=buildIchLocalReview(p,true,true,{
   0:{decision:"needs_source_review",note:"Re-evaluate native CT brain window"}
 });
 assert.equal(review.matchedSourceFileSha256,true);
 assert.equal(review.matchedMaskFileSha256,true);
 assert.equal(review.clinicianDiagnosisConfirmed,false);
 assert.equal(review.sourceToDicomSopBound,false);
 assert.match(review.decisions[0].note,/native CT/);
});
test("genuine component peak-k remains bound to native NIfTI box",()=>{
 const raw=specimen();
 const component=raw.prediction.largestComponents[0] as typeof raw.prediction.largestComponents[0] & {
   peakSliceIndexK?:number;peakSliceComponentVoxels?:number
 };
 component.peakSliceIndexK=6;
 component.peakSliceComponentVoxels=12;
 assert.equal(parseIchResearchReport(JSON.stringify(raw))
   .prediction.largestComponents[0].peakSliceIndexK,6);
 component.peakSliceIndexK=15;
 assert.throws(()=>parseIchResearchReport(JSON.stringify(raw)),/срез локализации/);
 component.peakSliceIndexK=6;
 component.peakSliceComponentVoxels=101;
 assert.throws(()=>parseIchResearchReport(JSON.stringify(raw)),/срез локализации/);
});
test("zero-mask prediction is a model non-detection, NEVER a negative diagnosis",()=>{
 const raw=specimen();
 raw.prediction.predictedPositiveVoxelCount=0;
 raw.prediction.predictedMaskVolumeMl=0;
 raw.prediction.connectedComponentsTotal=0;
 raw.prediction.largestComponents=[];
 raw.prediction.detectionStatus="no_mask_candidate_not_a_negative_diagnosis";
 const d=parseIchResearchReport(JSON.stringify(raw));
 assert.equal(d.prediction.negativeDiagnosisPermitted,false);
 assert.equal(buildIchLocalReview(d,false,false,{}).clinicianDiagnosisConfirmed,false);
});
test("rejects a forged clinical status, corrupt volume, impossible geometry and wrong source",()=>{
 const good=specimen();
 for(const bad of [
  {...good,validation:{...good.validation,clinicalValidation:true}},
  {...good,source:{...good.source,sourceDicomSopBound:true}},
  {...good,prediction:{...good.prediction,predictedMaskVolumeMl:50}},
  {...good,prediction:{...good.prediction,ichSubtype:"IPH"}},
  {...good,prediction:{...good.prediction,maskSha256:"unbound"}},
  {...good,source:{...good.source,geometry:{
   ...good.source.geometry,dimensions:[32,32,2000]}}},
 ]){
  assert.throws(()=>parseIchResearchReport(JSON.stringify(bad)));
 }
});
test("review comment limits and no confirmed diagnosis choice",()=>{
 const p=parseIchResearchReport(JSON.stringify(specimen()));
 assert.throws(()=>buildIchLocalReview(p,true,true,{
  0:{decision:"confirmed" as never,note:""}
 }),/врачебное/);
 assert.throws(()=>buildIchLocalReview(p,true,true,{
  0:{decision:"needs_source_review",note:"x".repeat(1001)}
 }),/врачебное/);
});
