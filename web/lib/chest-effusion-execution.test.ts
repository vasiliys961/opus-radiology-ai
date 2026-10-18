import test from "node:test";
import assert from "node:assert/strict";
import {parseImportedTask315} from "./chest-effusion-execution.ts";
const H="a".repeat(64),C="b".repeat(64),M="c".repeat(64);
const obj={
 schema:"opus-real-totalseg-ct-effusion-source-proposals/v1",
 model:"TotalSegmentator",modelTask:"pleural_pericard_effusion",officialTaskId:315,
 modelCheckpointSha256ObservedNotSignedPublisherProof:H,
 originalChestCtSha256:C,modelOutputNativeMaskSha256:M,
 originalCTDimensionsXYZ:[16,16,9],
 nativeSpatialUnits:"millimeters",sourceMaskMatchedAtEightPhysicalCornersWithinMm:0.05,
 voxelVolumeMl:0.0015,anatomicalClassLungPleuralIdOneExcludedFromPathology:true,
 anatomicalClassLungPleuralVoxelCountNotFluid:100,
 fluidCandidates:[2,3].map(id=>({
  labelId:id,pathologyClass:id===2?"pleural_effusion":"pericardial_effusion",
  modelPositiveNativeVoxelCount:0,modelUnvalidatedFluidLabelVolumeMl:0,
  nativeSourceSliceIndicesK:[],nativeIndexBoundsXYZMin:null,nativeIndexBoundsXYZMax:null,
  worldRasBoundsMmMin:null,worldRasBoundsMmMax:null,
  clinicalEffusionConfirmed:false,clinicalAbsenceIfEmptyEstablished:false
 })),
 sourceDICOMRescaleIndependentlyVerified:false,clinicalValidation:false,
 clinicalNormalityCanBeConcluded:false,actualPretrainedInferenceProvenByThisMaskAlone:false,
 limitations:["model reference unverified","not diagnosis","no independent clinical benchmark"]
};
const envelope=()=>({
 schema:"opus-real-task315-effusion-execution/v1",
 task:"pleural_pericard_effusion",requestedDevice:"cpu",
 actualPretrainedInferenceClaimed:true,runMode:"isolated-author-installed",
 modelPackageVersion:"2.18.0",observedInstalledWeightFileSha256:H,
 activeWeightsCryptographicallyProven:false,sourceNiftiSha256:C,maskSha256:M,
 sourceDimensions:[16,16,9],clinicalStatus:"unverified_research_draft",
 negativeDiagnosisPermitted:false,evidence:obj,
});
test("Genuine-run envelope imports directly without suggesting validated diagnosis",()=>{
 const parsed=parseImportedTask315(JSON.stringify(envelope()));
 assert.equal(parsed.execution,"reported-pretrained-execution");
 assert.equal(parsed.activeWeightsProven,false);
 assert.equal(parsed.evidence.clinicalNormalityCanBeConcluded,false);
});
test("Original standalone mask evidence stays marked unproved",()=>{
 assert.equal(parseImportedTask315(JSON.stringify(obj)).execution,"source-mask-only");
});
test("Reject fixture mode, forged checkpoint and wrong source",()=>{
 for(const changed of [
  {runMode:"technical-fixture"},{actualPretrainedInferenceClaimed:false},
  {sourceNiftiSha256:H},{maskSha256:C},{activeWeightsCryptographicallyProven:true},
  {negativeDiagnosisPermitted:true}
 ]){
  assert.throws(()=>parseImportedTask315(JSON.stringify({...envelope(),...changed})));
 }
});
