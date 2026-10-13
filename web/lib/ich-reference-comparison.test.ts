import test from "node:test";
import assert from "node:assert/strict";
import {parseIchResearchReport} from "./ich-research.ts";
import {parseIchReferenceComparison} from "./ich-reference-comparison.ts";
const sha=(c:string)=>c.repeat(64);
const report=()=>parseIchResearchReport(JSON.stringify({
 schema:"opus-ich-samihs-public-research/v1",researchStatus:"trained_upstream_adapter_executed_public_only",
 model:{id:"samihs-ich-binary-ct",origin:"MooreMuaMu/samihs-ich-segmentation",
   version:"audited",checkpointSha256:sha("a"),wrapperSha256:sha("b"),modelWeightsUsed:true},
 source:{format:"3d-nifti",sha256:sha("c"),fullVolumeProcessed:true,sourceDicomSopBound:false,
   patientData:false,geometry:{dimensions:[32,32,20],voxelVolumeMl:0.001,sliceAxis:2,
   affineRas:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}},
 prediction:{predictedPositiveVoxelCount:100,predictedMaskVolumeMl:0.1,connectedComponentsTotal:1,
  largestComponents:[{componentIndex:0,voxelCount:100,volumeMl:0.1,
   boundsVoxelMin:[1,2,3],boundsVoxelMax:[8,9,10],
   modelProbabilityCalibrated:false,clinicianVerified:false}],
  componentListTruncated:false,maskSha256:sha("d"),
  maskFormat:"3d-binary-nifti-uint8",thresholdUncalibrated:0.5,
  ichSubtype:null,negativeDiagnosisPermitted:false,detectionStatus:"candidates_from_binary_mask"},
 validation:{independentDice:null,sensitivity:null,specificity:null,
   externalCohortEvaluated:false,clinicalValidation:false,physicianReviewRequired:true}
}));
function comparison(){
 return {
 schema:"opus-ich-public-expert-mask-comparison/v1",
 status:"single_public_case_mask_comparison_not_independent_validation",
 modelId:"samihs-ich-binary-ct",
 evidenceHashes:{sourceSha256:sha("c"),predictionSha256:sha("d"),expertMaskSha256:sha("e")},
 referenceLabel:1,referenceRightsAttested:true,sourceNativeIndexGridMatch:true,
 sourceDicomSopBound:false,heldOutFromTrainingProven:false,
 expertAnnotationAuthenticityIndependentlyVerified:false,caseCount:1,
 metrics:{truePositiveVoxels:40,falsePositiveVoxels:60,falseNegativeVoxels:60,
  dice:0.4,iou:0.25,voxelPrecision:0.4,voxelRecall:0.4,
  hd95Mm:null,hd95UnavailableReason:"hd95_roi_memory_limit_exceeded",
  predictedVolumeMl:0.1,expertMaskVolumeMl:0.1,
  volumeErrorMl:0,absoluteVolumeErrorMl:0,relativeVolumeError:0,
  bothMasksEmpty:false,clinicalSensitivity:null,frocFalsePositivesPerScan:null},
 clinicalValidation:false,limitations:["Synthetic numbers for parser test only"]
 };
}
test("source-bound real-result format accepts coherent external metrics without certification",()=>{
 const r=parseIchReferenceComparison(JSON.stringify(comparison()),report());
 assert.equal(r.metrics.dice,0.4);
 assert.equal(r.evidenceHashes.expertMaskSha256,sha("e"));
 assert.equal(r.heldOutFromTrainingProven,false);
 assert.equal(r.clinicalValidation,false);
});
test("rejects invented Dice, false source binding and clinical performance",()=>{
 const base=comparison(),src=report();
 for(const bad of [
  {...base,metrics:{...base.metrics,dice:0.99}},
  {...base,evidenceHashes:{...base.evidenceHashes,sourceSha256:sha("f")}},
  {...base,evidenceHashes:{...base.evidenceHashes,predictionSha256:sha("f")}},
  {...base,clinicalValidation:true},
  {...base,heldOutFromTrainingProven:true},
  {...base,metrics:{...base.metrics,clinicalSensitivity:0.9}},
  {...base,metrics:{...base.metrics,predictedVolumeMl:100}},
  {...base,metrics:{...base.metrics,hd95Mm:2.5}},
 ])assert.throws(()=>parseIchReferenceComparison(JSON.stringify(bad),src));
});
test("empty reference doesn't fabricate recall or external patient validation",()=>{
 const base=comparison();
 const blank={...base,metrics:{...base.metrics,
  truePositiveVoxels:0,falsePositiveVoxels:100,falseNegativeVoxels:0,
  dice:0,iou:0,voxelPrecision:0,voxelRecall:null,
  predictedVolumeMl:0.1,expertMaskVolumeMl:0.0,volumeErrorMl:0.1,
  absoluteVolumeErrorMl:0.1,relativeVolumeError:null,bothMasksEmpty:false}};
 const r=parseIchReferenceComparison(JSON.stringify(blank),report());
 assert.equal(r.metrics.voxelRecall,null);
 assert.equal(r.clinicalValidation,false);
});
