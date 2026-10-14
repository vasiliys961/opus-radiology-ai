import test from "node:test";
import assert from "node:assert/strict";
import {parseIchCompletedCase} from "./ich-completed-case.ts";
import type {IchResearchReport} from "./ich-research";
import type {IchReferenceComparison} from "./ich-reference-comparison";
const h=(x:string)=>x.repeat(64);
const model={model:{checkpointSha256:h("a"),wrapperSha256:h("b")},
 source:{sha256:h("c")},prediction:{maskSha256:h("d")}} as IchResearchReport;
const comparison={evidenceHashes:{sourceSha256:h("c"),predictionSha256:h("d"),
 expertMaskSha256:h("e")},metrics:{dice:.5,iou:1/3,hd95Mm:1.2,
 predictedVolumeMl:.3,expertMaskVolumeMl:.2,falseNegativeVoxels:10,
 falsePositiveVoxels:20}} as IchReferenceComparison;
function specimen(){
 return {schema:"opus-ich-first-trained-public-case/v1",
  status:"real_trained_model_and_one_authorized_public_mask_pair_completed",
  modelId:"samihs-ich-binary-ct",
  sourceDatasetCitationUrl:"https://example.org/authorized-source",
  legalRightsIndependentlyVerifiedByOpus:false,operatorAttestedRights:true,
  upstreamModelAuditAttested:true,sourceNativeIndexGridMatch:true,
  evidenceHashes:{...comparison.evidenceHashes},
  checkpointSha256:h("a"),wrapperSha256:h("b"),
  officialSamihsSourceRevision:"f".repeat(40),
  modelExecutionSeconds:24.5,device:"cuda:0",inputFullVolumeProcessed:true,
  clinicalValidation:false,heldOutFromTrainingProven:false,
  originalDicomSopMapped:false,publicPatientDataMustNotBePublished:true,
  files:{modelMask:"samihs-public-ich-mask.nii.gz",
   modelInference:"opus-ich-samihs-public-report.json",
   expertComparison:"ich-expert-3d-comparison.json",
   componentContact:"ich-expert-components.json",
   nativeSliceAudit:"ich-expert-native-slices.json"},
  metrics:{...comparison.metrics,expertFragmentsWithoutContact:2,
   modelFragmentsWithoutContact:3,expertPositiveSlicesWithoutOverlap:4}};
}
test("a complete externally generated case passport matches the imported study",()=>{
 const v=parseIchCompletedCase(JSON.stringify(specimen()),model,comparison);
 assert.equal(v.modelExecutionSeconds,24.5);
 assert.equal(v.metrics.falseNegativeVoxels,10);
 assert.equal(v.clinicalValidation,false);
});
test("refuse forged, unrelated and falsely validated passports",()=>{
 for(const patch of [
  {checkpointSha256:h("f")},{clinicalValidation:true},{device:"cpu"},
  {evidenceHashes:{...comparison.evidenceHashes,expertMaskSha256:h("f")}},
  {metrics:{...specimen().metrics,dice:0.9}}
 ]){
  assert.throws(()=>parseIchCompletedCase(JSON.stringify({...specimen(),...patch}),
   model,comparison));
 }
});
